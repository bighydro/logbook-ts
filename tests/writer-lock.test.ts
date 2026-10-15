import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsup";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { hashLine } from "../src/chain.js";
import { canonicalize } from "../src/jcs.js";
import { monthFiles } from "../src/lines.js";
import { verifyLogbook } from "../src/store.js";
import type { Line } from "../src/types.js";
import {
  cleanup,
  copySample,
  EXPECTED,
  readLines,
  readMetaFile,
  SAMPLE_MONTH,
  tempDir,
  writeMeta,
} from "./helpers.js";

/**
 * Two real processes on one record. The reference holds `state/writer.lock` for a writer's whole
 * run; this implementation does the same, and here the lock, the wait, the refusal under
 * `--no-wait`, the write order of SPEC §3 (the line fsynced before logbook.json is replaced) and
 * the recovery after a crash between the two are driven from outside, by child processes that run
 * the library itself. Each child imports a bundle of `src/` built once per run (tsup, the build this
 * repository ships with), and injects its fault — a held append, a pause after the scan, a lock
 * taken in two steps and stopped (or killed) between them, a stop before a reclaim, Windows' refusal
 * of a file another process holds, a crash before the metadata rename — by patching `node:fs`
 * before the bundle loads, so nothing in `src/` knows about the tests.
 *
 * Nothing waits on a clock. A child that is to stop somewhere makes a file in the test's gates
 * folder when it gets there and goes on only once the test has made the file it waits for: a
 * barrier, so each test holds whatever the slowest runner does, and a step that takes long is late,
 * never out of order. Where rule A's half second is the subject, the empty lock's mtime is set
 * ahead of the clock (a lock still being made, for as long as the test needs) or behind it (a
 * leftover), so the outcome never hangs on how fast a runner is.
 */
const WORKER = `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";

const [root, text, ...flags] = process.argv.slice(2);
const value = (name) => {
  const i = flags.indexOf(name);
  return i === -1 ? undefined : flags[i + 1];
};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// --gates DIR: reach(name) makes DIR/name, as a child says where it is; pass(name) returns once
// the test has made DIR/name.
const gates = value("--gates");
const reach = (name) => fs.writeFileSync(join(gates, name), "", "utf-8");
const pass = (name) => {
  while (!fs.existsSync(join(gates, name))) sleep(5);
};
const real = {
  openSync: fs.openSync,
  readSync: fs.readSync,
  writeSync: fs.writeSync,
  fsyncSync: fs.fsyncSync,
  renameSync: fs.renameSync,
  linkSync: fs.linkSync,
};
let appendFd = -1;
let scanFd = -1;
let lockFd = -1;
fs.openSync = (path, flags, mode) => {
  const fd = real.openSync(path, flags, mode);
  if (String(path).endsWith(".jsonl") && flags === "a") appendFd = fd;
  if (String(path).endsWith(".jsonl") && flags === "r") scanFd = fd;
  if (String(path).endsWith("writer.lock") && flags === "wx") lockFd = fd;
  return fd;
};
// --hold-append: once the append is fsynced, reach "holding" and pass "release", so the lock is
// held with the line on disk and logbook.json not yet replaced for as long as the test wants.
if (flags.includes("--hold-append")) {
  fs.fsyncSync = (fd) => {
    real.fsyncSync(fd);
    if (fd === appendFd) {
      appendFd = -1; // once: the number is reused by the next open
      reach("holding");
      pass("release");
    }
  };
}
// --two-step: take the lock as the reference does, the exclusive create and then the write (the
// way this implementation takes it where the filesystem cannot link), and between the two reach
// "window" and pass "fill": the lock is there and empty until the test says. With
// --crash-in-window, die there instead, leaving the lock empty, as a writer killed between its
// create and its write leaves it.
if (flags.includes("--two-step")) {
  fs.linkSync = (from, to) => {
    if (String(to).endsWith("writer.lock")) {
      throw Object.assign(new Error("ENOTSUP: operation not supported, link"), { code: "ENOTSUP" });
    }
    return real.linkSync(from, to);
  };
  fs.writeSync = (fd, ...rest) => {
    if (fd === lockFd) {
      lockFd = -1;
      if (flags.includes("--crash-in-window")) process.kill(process.pid, "SIGKILL");
      reach("window");
      pass("fill");
    }
    return real.writeSync(fd, ...rest);
  };
}
// --gate-reclaim: about to take the reclaim file, before the lock is read again and removed,
// reach "reclaiming" and pass "reclaim", so the test can write the lock in between.
if (flags.includes("--gate-reclaim")) {
  const { linkSync } = fs;
  fs.linkSync = (from, to) => {
    if (String(to).endsWith("writer.lock.reclaim")) {
      reach("reclaiming");
      pass("reclaim");
    }
    return linkSync(from, to);
  };
}
// --pause-after-scan: once the month file has been read to its end (the record validated, the
// line about to be chained), reach "paused" and pass "resume", so another writer can move the head.
if (flags.includes("--pause-after-scan")) {
  let paused = false;
  fs.readSync = (fd, ...rest) => {
    const read = real.readSync(fd, ...rest);
    if (fd === scanFd && read === 0 && !paused) {
      paused = true;
      reach("paused");
      pass("resume");
    }
    return read;
  };
}
// --crash-before-meta: die at the rename that would replace logbook.json.
if (flags.includes("--crash-before-meta")) {
  fs.renameSync = (from, to) => {
    if (String(to).endsWith("logbook.json")) process.kill(process.pid, "SIGKILL");
    return real.renameSync(from, to);
  };
}
// --windows-in-use N: run as on Windows, where a name another process holds open refuses for a
// moment: the first N opens of writer.lock for reading, links to it and unlinks of it (a lock
// removed while another writer was reading it, Node 20; a reader that does not share delete) and
// renames onto logbook.json (replaced while another writer reads it) fail with EPERM, as Windows
// fails them. At exit the child says how many of each it refused, so the test sees the retries ran.
const inUse = Number(value("--windows-in-use") ?? 0);
if (inUse) {
  Object.defineProperty(process, "platform", { value: "win32" });
  const refusedSoFar = { open: 0, link: 0, unlink: 0, rename: 0 };
  const refuse = (call, path) => {
    if (refusedSoFar[call] >= inUse) return;
    refusedSoFar[call] += 1;
    throw Object.assign(new Error("EPERM: operation not permitted, " + call + " '" + path + "'"), {
      code: "EPERM",
      syscall: call,
      path,
    });
  };
  const { openSync, linkSync, unlinkSync, renameSync } = fs;
  fs.openSync = (path, flags, mode) => {
    if (String(path).endsWith("writer.lock") && flags === "r") refuse("open", path);
    return openSync(path, flags, mode);
  };
  fs.linkSync = (from, to) => {
    if (String(to).endsWith("writer.lock")) refuse("link", from);
    return linkSync(from, to);
  };
  fs.unlinkSync = (path) => {
    if (String(path).endsWith("writer.lock")) refuse("unlink", path);
    return unlinkSync(path);
  };
  fs.renameSync = (from, to) => {
    if (String(to).endsWith("logbook.json")) refuse("rename", from);
    return renameSync(from, to);
  };
  process.on("exit", () => process.stderr.write("refused " + JSON.stringify(refusedSoFar) + "\\n"));
}
syncBuiltinESMExports();

const { addNote, HeadMoved, WriterBusy } = await import("./logbook-ts.mjs");
// --start: loaded, reach "ready.<pid>" and pass "go", so several children start together.
if (flags.includes("--start")) {
  reach("ready." + process.pid);
  pass("go");
}
const say = (line) => process.stderr.write(line + "\\n");
try {
  for (let i = 0; i < Number(value("--repeat") ?? 1); i++) {
    const line = addNote(root, text, { wait: !flags.includes("--no-wait"), say });
    process.stdout.write(JSON.stringify(line) + "\\n");
  }
} catch (err) {
  process.stderr.write(err.name + ": " + err.message + "\\n");
  process.exit(err instanceof WriterBusy || err instanceof HeadMoved ? 2 : 1);
}
`;

let bundleDir: string;
let worker: string;

beforeAll(async () => {
  bundleDir = mkdtempSync(join(tmpdir(), "logbook-ts-bundle-"));
  await build({
    entry: { "logbook-ts": fileURLToPath(new URL("../src/index.ts", import.meta.url)) },
    outDir: bundleDir,
    outExtension: () => ({ js: ".mjs" }),
    format: ["esm"],
    platform: "node",
    target: "node20",
    dts: false,
    sourcemap: false,
    splitting: false,
    clean: false,
    config: false,
    silent: true,
  });
  worker = join(bundleDir, "worker.mjs");
  writeFileSync(worker, WORKER, "utf-8");
}, 120_000);

afterAll(() => {
  rmSync(bundleDir, { recursive: true, force: true });
});

afterEach(cleanup);

interface Run {
  code: number | null;
  signal: NodeJS.Signals | null;
  out: string;
  err: string;
}

interface Started {
  pid: number;
  done: Promise<Run>;
  /** What the child has written to stderr so far. */
  err: () => string;
  /** Whether the child has exited. */
  exited: () => boolean;
}

/** A child process that appends `text` to `root` through the library, with its faults. */
function start(root: string, text: string, flags: string[] = []): Started {
  const child = spawn(process.execPath, [worker, root, text, ...flags], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  let exited = false;
  child.stdout.setEncoding("utf-8").on("data", (chunk: string) => {
    out += chunk;
  });
  child.stderr.setEncoding("utf-8").on("data", (chunk: string) => {
    err += chunk;
  });
  const done = new Promise<Run>((resolve) => {
    child.on("close", (code, signal) => {
      exited = true;
      resolve({ code, signal, out, err });
    });
  });
  return { pid: child.pid as number, done, err: () => err, exited: () => exited };
}

/**
 * Wait until `test` holds, looking every 20 ms. The bound is a safety net for a hung child, not a
 * step of any test: no test waits for time to pass, only for a child to reach a gate or say a line.
 * A child that exits while it is awaited fails the wait at once, naming what it said.
 */
async function until(test: () => boolean, watching: Started[] = [], ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    const gone = watching.find((child) => child.exited());
    if (gone) throw new Error(`a child exited before the awaited step:\n${gone.err()}`);
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

interface Gates {
  dir: string;
  /** Make the gate a child waits for. */
  open: (name: string) => void;
  /** Whether a child has made this gate. */
  reached: (name: string) => boolean;
}

/** A folder of gates for one test's children (see WORKER). */
function gatesFolder(): Gates {
  const dir = tempDir();
  return {
    dir,
    open: (name) => writeFileSync(join(dir, name), "", "utf-8"),
    reached: (name) => existsSync(join(dir, name)),
  };
}

const lockOf = (root: string): string => join(root, "state", "writer.lock");

/** Whether `text` is a whole lock as this implementation writes it: exactly pid, command and since. */
function isWholeHolder(text: string): boolean {
  try {
    const holder = JSON.parse(text) as Record<string, unknown>;
    return (
      Object.keys(holder).sort().join() === "command,pid,since" &&
      typeof holder.pid === "number" &&
      typeof holder.since === "string"
    );
  } catch {
    return false;
  }
}

/** What a writer says, and under `--no-wait` refuses with, while a lock names no holder and is young. */
const NO_HOLDER_YET =
  "another logbook command is taking the lock on this record (state/writer.lock names no holder yet; if none is running, remove it)";

/** Every row of every month file, in file order: a worker writes into the month of the clock, not the sample's. */
const allRows = (root: string): string[] =>
  monthFiles(root).flatMap((month) =>
    readFileSync(month.file, "utf-8").split("\n").filter(Boolean),
  );
const seqOf = (run: Run): number[] =>
  run.out
    .split("\n")
    .filter(Boolean)
    .map((row) => (JSON.parse(row) as Line).seq);

describe("two processes on one record", () => {
  it("the second waits for the first, says so, and the chain has one line each, in order", async () => {
    const root = copySample();
    const gates = gatesFolder();
    const first = start(root, "first", ["--gates", gates.dir, "--hold-append"]);
    await until(() => gates.reached("holding"), [first]);
    const holder = JSON.parse(readFileSync(lockOf(root), "utf-8")) as Record<string, unknown>;
    expect(holder).toEqual({
      pid: first.pid,
      command: "logbook-ts add",
      since: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
    });

    // The first holds the lock until the second has said it waits.
    const second = start(root, "second");
    await until(() => second.err().endsWith("; waiting\n"), [first, second]);
    gates.open("release");
    const [a, b] = await Promise.all([first.done, second.done]);
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    expect(b.err).toBe(
      `another logbook command is writing to this record (logbook-ts add, since ${String(holder.since)}); waiting\n`,
    );
    expect(a.err).toBe("");
    expect(seqOf(a)).toEqual([33]);
    expect(seqOf(b)).toEqual([34]);
    const result = verifyLogbook(root);
    expect(result.errors).toEqual([]);
    expect(result.lines).toBe(34);
    expect(existsSync(lockOf(root))).toBe(false);
    expect(existsSync(join(root, "state"))).toBe(false);
  }, 30_000);

  it("under --no-wait the second is refused with exit 2 and the reference's sentence, and writes nothing", async () => {
    const root = copySample();
    const gates = gatesFolder();
    const first = start(root, "first", ["--gates", gates.dir, "--hold-append"]);
    await until(() => gates.reached("holding"), [first]);
    // The lock is whole the moment it exists: read as soon as the first holds it, it parses.
    const since = (JSON.parse(readFileSync(lockOf(root), "utf-8")) as { since: string }).since;
    const b = await start(root, "second", ["--no-wait"]).done;
    expect(b.code).toBe(2);
    expect(b.out).toBe("");
    expect(b.err).toBe(
      `WriterBusy: another logbook command is writing to this record (logbook-ts add, since ${since})\n`,
    );
    gates.open("release");
    const a = await first.done;
    expect(a.code).toBe(0);
    expect(verifyLogbook(root)).toMatchObject({ valid: true, lines: 33 });
    expect(allRows(root)).toHaveLength(33);
  }, 60_000);

  it("four writers of three notes each, started together, never share a seq, and the lock is never seen empty or cut short", async () => {
    const root = copySample();
    const gates = gatesFolder();
    const children = ["a", "b", "c", "d"].map((name) =>
      start(root, name, ["--gates", gates.dir, "--start", "--repeat", "3"]),
    );
    // All four loaded and at the start line, then let go at once.
    await until(
      () => readdirSync(gates.dir).filter((name) => name.startsWith("ready.")).length === 4,
      children,
    );
    // An observer reads the lock as often as the event loop lets it while they run: whatever it
    // reads is a whole holder, never the empty or half-written file a reader could once catch.
    let running = true;
    const torn: string[] = [];
    let reads = 0;
    const observer = (async () => {
      while (running) {
        try {
          const text = readFileSync(lockOf(root), "utf-8");
          reads += 1;
          if (!isWholeHolder(text)) torn.push(text);
        } catch {
          // no lock between two writers, or one being removed as it is read
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();
    gates.open("go");
    const runs = await Promise.all(children.map((child) => child.done));
    running = false;
    await observer;

    for (const run of runs) expect(run.code, run.err).toBe(0);
    expect(torn).toEqual([]);
    expect(reads).toBeGreaterThan(0);
    const seqs = runs.flatMap(seqOf).sort((x, y) => x - y);
    expect(seqs).toEqual(Array.from({ length: 12 }, (_, i) => 33 + i));
    const result = verifyLogbook(root);
    expect(result.errors).toEqual([]);
    expect(result.lines).toBe(44);
    expect(existsSync(lockOf(root))).toBe(false);
  }, 60_000);
});

/** Set a file's mtime: ahead of the clock, a lock still being made; behind it, a leftover. */
const setMtime = (file: string, ms: number): void => utimesSync(file, ms / 1000, ms / 1000);

describe("rule A: a lock that names no holder (the reference makes its lock, then writes its holder)", () => {
  it("while it is not half a second old by its mtime it is someone taking it: the second says so and waits, then waits on the holder by name once it is written, then appends after it", async () => {
    const root = copySample();
    const gates = gatesFolder();
    // The first takes the lock in the reference's two steps and stops between them, then holds it
    // at its append: the lock is there, empty, for as long as the test wants, and its mtime ahead
    // of the clock says it was only just made.
    const first = start(root, "first", ["--gates", gates.dir, "--two-step", "--hold-append"]);
    await until(() => gates.reached("window"), [first]);
    expect(readFileSync(lockOf(root), "utf-8")).toBe("");
    setMtime(lockOf(root), Date.now() + 120_000);

    const second = start(root, "second");
    await until(() => second.err().includes(NO_HOLDER_YET), [first, second]);
    expect(second.err()).toBe(`${NO_HOLDER_YET}; waiting\n`);
    expect(readFileSync(lockOf(root), "utf-8")).toBe(""); // the first's lock, still there
    expect(allRows(root)).toHaveLength(32);

    // The first writes its holder and goes on to its append; the second now waits on it by name.
    gates.open("fill");
    await until(() => gates.reached("holding"), [first, second]);
    const holder = JSON.parse(readFileSync(lockOf(root), "utf-8")) as {
      pid: number;
      since: string;
    };
    expect(holder.pid).toBe(first.pid);
    await until(() => second.err().includes("is writing to this record"), [first, second]);
    gates.open("release");

    const [a, b] = await Promise.all([first.done, second.done]);
    expect(a.code, a.err).toBe(0);
    expect(b.code, b.err).toBe(0);
    expect(a.err).toBe("");
    expect(b.err).toBe(
      `${NO_HOLDER_YET}; waiting\n` +
        `another logbook command is writing to this record (logbook-ts add, since ${holder.since}); waiting\n`,
    );
    expect(seqOf(a)).toEqual([33]);
    expect(seqOf(b)).toEqual([34]);
    const result = verifyLogbook(root);
    expect(result.errors).toEqual([]);
    expect(result.lines).toBe(34);
    expect(existsSync(lockOf(root))).toBe(false);
  }, 60_000);

  it("under --no-wait, one not yet half a second old is refused after half a second with exit 2, and left as it is; the first then writes", async () => {
    const root = copySample();
    const gates = gatesFolder();
    const first = start(root, "first", ["--gates", gates.dir, "--two-step"]);
    await until(() => gates.reached("window"), [first]);
    setMtime(lockOf(root), Date.now() + 120_000);

    const b = await start(root, "second", ["--no-wait"]).done;
    expect(b.code).toBe(2);
    expect(b.out).toBe("");
    expect(b.err).toBe(`WriterBusy: ${NO_HOLDER_YET}\n`);
    expect(readFileSync(lockOf(root), "utf-8")).toBe("");
    expect(allRows(root)).toHaveLength(32);

    gates.open("fill");
    const a = await first.done;
    expect(a.code, a.err).toBe(0);
    expect(seqOf(a)).toEqual([33]);
    expect(verifyLogbook(root)).toMatchObject({ valid: true, lines: 33 });
    expect(existsSync(lockOf(root))).toBe(false);
  }, 60_000);

  it("one left by a writer killed between its create and its write is a leftover once half a second has passed: the next writer takes it without a word, under --no-wait too, as the reference does", async () => {
    const root = copySample();
    const killed = await start(root, "never written", ["--two-step", "--crash-in-window"]).done;
    expect(killed.signal ?? killed.code).not.toBe(0);
    expect(readFileSync(lockOf(root), "utf-8")).toBe("");
    expect(allRows(root)).toHaveLength(32);

    const started = Date.now();
    const next = await start(root, "after the crash", ["--no-wait"]).done;
    expect(next.code, next.err).toBe(0);
    expect(next.err).toBe("");
    expect(Date.now() - started).toBeGreaterThanOrEqual(500); // read, read again half a second on
    expect(seqOf(next)).toEqual([33]);
    expect(verifyLogbook(root)).toMatchObject({ valid: true, lines: 33 });
    expect(existsSync(lockOf(root))).toBe(false);
  }, 60_000);

  it("two writers that find the same leftover together: one removes it and takes the lock, the other then waits on that holder; one line each, seqs 33 and 34", async () => {
    const root = copySample();
    const gates = gatesFolder();
    const planted = lockOf(root);
    mkdirSync(join(root, "state"));
    writeFileSync(planted, "", "utf-8");
    setMtime(planted, Date.now() - 10_000);
    const children = ["a", "b"].map((name) => start(root, name, ["--gates", gates.dir, "--start"]));
    await until(
      () => readdirSync(gates.dir).filter((name) => name.startsWith("ready.")).length === 2,
      children,
    );
    gates.open("go");
    const runs = await Promise.all(children.map((child) => child.done));
    for (const run of runs) {
      expect(run.code, run.err).toBe(0);
      // Nothing is said of the leftover; a writer that found the other's lock says it waits.
      expect(run.err).toMatch(
        /^(another logbook command is writing to this record \(logbook-ts add, since \S+\); waiting\n)?$/,
      );
    }
    expect(runs.flatMap(seqOf).sort((x, y) => x - y)).toEqual([33, 34]);
    const result = verifyLogbook(root);
    expect(result.errors).toEqual([]);
    expect(result.lines).toBe(34);
    expect(existsSync(lockOf(root))).toBe(false);
  }, 60_000);

  it("a leftover written to between the judgment and the removal is read again under the reclaim file and left alone: the writer then finds its holder, and under --no-wait refuses", async () => {
    const root = copySample();
    const gates = gatesFolder();
    mkdirSync(join(root, "state"));
    writeFileSync(lockOf(root), "", "utf-8");
    setMtime(lockOf(root), Date.now() - 10_000);
    const waiter = start(root, "not over a live lock", [
      "--gates",
      gates.dir,
      "--gate-reclaim",
      "--no-wait",
    ]);
    await until(() => gates.reached("reclaiming"), [waiter]);
    // A holder that lives (this test's own process) writes itself into the lock in that moment.
    const holder = `{"pid": ${process.pid}, "command": "sync immich", "since": "2026-10-13T06:00:00Z"}`;
    writeFileSync(lockOf(root), holder, "utf-8");
    gates.open("reclaim");
    const run = await waiter.done;
    expect(run.code).toBe(2);
    expect(run.out).toBe("");
    expect(run.err).toBe(
      "WriterBusy: another logbook command is writing to this record (sync immich, since 2026-10-13T06:00:00Z)\n",
    );
    expect(readFileSync(lockOf(root), "utf-8")).toBe(holder);
    expect(readdirSync(join(root, "state"))).toEqual(["writer.lock"]);
    expect(allRows(root)).toHaveLength(32);
  }, 60_000);
});

describe("on Windows, a file another process holds open refuses for a moment", () => {
  it("a lock name not yet free, a lock that cannot yet be removed and a logbook.json being read are tried again, not given up on: the note is written", async () => {
    const root = copySample();
    const run = await start(root, "through Windows' refusals", ["--windows-in-use", "3"]).done;
    expect(run.code, run.err).toBe(0);
    // Three refusals of each call, every one gone through: the retry ran, on every OS CI runs.
    expect(run.err).toBe('refused {"open":3,"link":3,"unlink":3,"rename":3}\n');
    expect(seqOf(run)).toEqual([33]);
    expect(verifyLogbook(root)).toMatchObject({ valid: true, lines: 33 });
    expect(readMetaFile(root).seq).toBe(33);
    expect(existsSync(lockOf(root))).toBe(false);
  }, 60_000);
});

describe("the guard behind the lock", () => {
  it("a writer that ignores the lock and moves the head while a line is being prepared: HeadMoved, exit 2, nothing written", async () => {
    const root = copySample();
    const gates = gatesFolder();
    const paused = start(root, "chained from a head that moved", [
      "--gates",
      gates.dir,
      "--pause-after-scan",
    ]);
    await until(() => gates.reached("paused"), [paused]);

    // A writer that never took the lock: a line chained by hand onto the sample's head, and
    // logbook.json moved to it, as a test fixture is written (tests/helpers.ts).
    const rows = readLines(root);
    const intruder: Line = {
      id: "00000000-0000-4000-8000-000000000033",
      seq: 33,
      at: "2026-03-09T08:00:00Z",
      end: null,
      tz: "Europe/Oslo",
      source: "manual",
      kind: "note",
      tier: 2,
      payload: { schema: "note/v1", text: "written past the lock" },
      recorded_at: "2026-03-09T08:00:00Z",
      prev: EXPECTED.head,
      hash: "",
    };
    intruder.hash = hashLine(intruder);
    writeFileSync(
      join(root, SAMPLE_MONTH),
      `${rows.join("\n")}\n${canonicalize(intruder)}\n`,
      "utf-8",
    );
    writeMeta(root, { ...readMetaFile(root), seq: 33, head: intruder.hash });

    gates.open("resume");
    const run = await paused.done;
    expect(run.code).toBe(2);
    expect(run.out).toBe("");
    expect(run.err).toBe(
      `HeadMoved: the record's head moved while the line was being prepared: logbook.json named seq 32, head ${EXPECTED.head}, and names seq 33, head ${intruder.hash} now; nothing was written\n`,
    );
    expect(readLines(root)).toHaveLength(33);
    const result = verifyLogbook(root);
    expect(result.errors).toEqual([]);
    expect(result.head).toBe(intruder.hash);
    expect(existsSync(lockOf(root))).toBe(false);
  }, 30_000);
});
