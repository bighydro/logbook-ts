import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { addNote } from "../src/store.js";
import type { Line } from "../src/types.js";
import {
  cleanup,
  copySample,
  cutInsideLastLine,
  EXPECTED,
  readMetaFile,
  tempDir,
  writeMeta,
} from "./helpers.js";

/**
 * The writer, held to the reference by running both: the lock's sentences and rule A (an empty lock
 * a crash left is taken after half a second, without a word, under --no-wait too), the refusal of an
 * append while the files end past logbook.json, and `repair tail` with and without --dry-run and its
 * refusals (decision B; the reference's #294). Each case is built once and copied, one copy for each
 * implementation. It needs a clone of https://github.com/bighydro/logbook named by LOGBOOK_REF, with
 * `uv` on the path, as tests/cross-impl.test.ts does; without LOGBOOK_REF it is skipped.
 *
 * Where the two differ on purpose the difference is taken out before the comparison, and named:
 * this implementation names its own program (`logbook-ts repair tail`, `logbook-ts verify`) and keeps
 * no index, so the reference's index clauses are dropped (SPEC-QUESTIONS 92).
 */
const REF = process.env.LOGBOOK_REF;
const ready = REF !== undefined && existsSync(join(REF, "pyproject.toml"));

afterEach(cleanup);

interface Ran {
  code: number | null;
  out: string;
  err: string;
}

/**
 * The reference CLI on a record: its exit code, stdout and stderr (without what `uv` says of itself).
 * It keeps its index outside the record, under the cache folder by the record's owner id, which
 * every copy of the sample shares; each run gets an empty cache of its own, so what it says of its
 * index never depends on another run.
 */
function reference(root: string, args: string[]): Ran {
  const result = spawnSync("uv", ["run", "--project", REF as string, "logbook", ...args], {
    cwd: REF,
    encoding: "utf-8",
    env: {
      ...process.env,
      LOGBOOK_HOME: root,
      XDG_CACHE_HOME: tempDir(),
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
  });
  if (result.error) throw result.error;
  const err = result.stderr
    .split("\n")
    .filter((row) => !/^warning: .*`UV_/.test(row))
    .join("\n");
  return { code: result.status, out: result.stdout, err };
}

/** This implementation's CLI on a record, in process. */
function ours(argv: string[]): Ran {
  let out = "";
  let err = "";
  const code = main(argv, {
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}

/** Our words, with our program's name where the reference names its own. */
const asReference = (text: string): string =>
  text
    .replaceAll("`logbook-ts repair tail`", "`logbook repair tail`")
    .replaceAll("`logbook-ts verify`", "`logbook verify`");

/**
 * The reference's words, without the index this implementation does not keep: whatever follows the
 * head on the line that says what is, or would be, set (`, and build no index (…)`, `, and rebuild
 * the index, N lines`, `; no index (…)`, `; index rebuilt, N lines`, …).
 */
const withoutIndex = (text: string): string =>
  text
    .replace(/^(would set logbook\.json to seq=\d+ head=[0-9a-f]{12}…),[^\n]*$/gm, "$1")
    .replace(/^(logbook\.json: seq \d+, head [0-9a-f]{12}…);[^\n]*$/gm, "$1");

/** Two copies of a record, the reference's and ours. */
function twice(root: string): [string, string] {
  const theirs = join(tempDir(), "theirs");
  const mine = join(tempDir(), "ours");
  cpSync(root, theirs, { recursive: true });
  cpSync(root, mine, { recursive: true });
  return [theirs, mine];
}

const metaText = (root: string): string => readFileSync(join(root, "logbook.json"), "utf-8");

/**
 * The sample with `extra` notes added in October 2026 and logbook.json set back to `seq`, as a
 * crash between a line and logbook.json leaves it. The lines are written by this implementation;
 * both read the same files.
 */
function lagging(extra: number, seq: number): { root: string; lines: Line[] } {
  const root = copySample();
  const lines: Line[] = [];
  for (let i = 0; i < extra; i++) {
    lines.push(
      addNote(root, `note ${i + 1}, Oslo`, { now: new Date(`2026-10-0${i + 1}T10:00:00Z`) }),
    );
  }
  const head = seq === 32 ? EXPECTED.head : seq < 32 ? undefined : (lines[seq - 33] as Line).hash;
  if (head === undefined) throw new Error("set back into the sample: give the head");
  writeMeta(root, { ...readMetaFile(root), seq, head });
  return { root, lines };
}

/** A living process that is neither this one nor the reference's: a detached sleeper's pid. */
function livingPid(): number {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child.pid as number;
}

describe.skipIf(!ready)(
  "the reference and logbook-ts on the files ahead of logbook.json (decision B)",
  () => {
    it("both refuse an append with exit 2 and the same sentence, and write nothing: the files past logbook.json, and the same seq under another head", () => {
      const { root } = lagging(1, 32);
      const [theirs, mine] = twice(root);
      const r = reference(theirs, ["add", "two"]);
      const o = ours(["add", mine, "two"]);
      expect(r.code).toBe(2);
      expect(o.code).toBe(2);
      expect(asReference(o.err)).toBe(r.err);
      expect(metaText(theirs)).toBe(metaText(root));
      expect(metaText(mine)).toBe(metaText(root));

      const other = copySample();
      writeMeta(other, { ...readMetaFile(other), head: "a".repeat(64) });
      const [theirs2, mine2] = twice(other);
      const r2 = reference(theirs2, ["add", "two"]);
      const o2 = ours(["add", mine2, "two"]);
      expect([r2.code, o2.code]).toEqual([2, 2]);
      expect(asReference(o2.err)).toBe(r2.err);
    }, 120_000);

    it("repair tail --dry-run lists the same lines and the same target, exits 0, and writes nothing: a lag of one, of two across month files, and from seq 0 (twenty listed, the rest counted)", () => {
      for (const [extra, seq] of [
        [1, 32],
        [2, 32],
        [0, 0],
      ] as const) {
        const root =
          seq === 0
            ? (() => {
                const r = copySample();
                writeMeta(r, { ...readMetaFile(r), seq: 0, head: "0".repeat(64) });
                return r;
              })()
            : lagging(extra, seq).root;
        const [theirs, mine] = twice(root);
        const r = reference(theirs, ["repair", "tail", "--dry-run"]);
        const o = ours(["repair", "tail", mine, "--dry-run"]);
        expect([r.code, o.code]).toEqual([0, 0]);
        expect(o.out).toBe(withoutIndex(r.out));
        expect(metaText(theirs)).toBe(metaText(root));
        expect(metaText(mine)).toBe(metaText(root));
      }
    }, 120_000);

    it("repair tail brings logbook.json to the same seq and head, both say so and verify, exit 0; then each appends the next seq; on a current record both say there is nothing to repair", () => {
      const { root } = lagging(2, 33);
      const [theirs, mine] = twice(root);
      const r = reference(theirs, ["repair", "tail"]);
      const o = ours(["repair", "tail", mine]);
      expect([r.code, o.code]).toEqual([0, 0]);
      expect(o.out).toBe(withoutIndex(r.out));
      expect(readMetaFile(mine)).toEqual(readMetaFile(theirs));
      expect(reference(theirs, ["repair", "tail"]).out).toBe(ours(["repair", "tail", mine]).out);
      expect(reference(theirs, ["add", "after"]).code).toBe(0);
      expect(ours(["add", mine, "after"]).out).toMatch(/^added seq 35 /);
    }, 120_000);

    it("repair tail refuses alike, exit 2, changing nothing: the files behind logbook.json, the same seq under another head, a tail torn inside its last line; and a tail line that does not recompute, each naming it in its own verify's words", () => {
      const behind = copySample();
      writeMeta(behind, { ...readMetaFile(behind), seq: 33 });
      const other = copySample();
      writeMeta(other, { ...readMetaFile(other), head: "a".repeat(64) });
      const torn = lagging(2, 33).root;
      cutInsideLastLine(torn, join("logbook", "2026", "10.jsonl"));
      writeMeta(torn, { ...readMetaFile(torn), seq: 32, head: EXPECTED.head });
      for (const root of [behind, other, torn]) {
        const [theirs, mine] = twice(root);
        const r = reference(theirs, ["repair", "tail"]);
        const o = ours(["repair", "tail", mine]);
        expect([r.code, o.code]).toEqual([2, 2]);
        expect(asReference(o.err)).toBe(r.err);
        expect(metaText(theirs)).toBe(metaText(root));
        expect(metaText(mine)).toBe(metaText(root));
      }

      const { root: wrong } = lagging(2, 32);
      const october = join(wrong, "logbook", "2026", "10.jsonl");
      const rows = readFileSync(october, "utf-8").split("\n").filter(Boolean);
      const line = JSON.parse(rows[1] as string) as Line;
      rows[1] = JSON.stringify({ ...line, payload: { ...line.payload, text: "edited" } });
      writeFileSync(october, `${rows.join("\n")}\n`, "utf-8");
      const [theirs, mine] = twice(wrong);
      const r = reference(theirs, ["repair", "tail"]);
      const o = ours(["repair", "tail", mine]);
      expect([r.code, o.code]).toEqual([2, 2]);
      expect(r.err).toMatch(
        /^repair tail: line 34: hash does not recompute; id \S+; nothing was changed\n$/,
      );
      expect(o.err).toMatch(
        /^repair tail: \S+ line 2: seq 34 — hash \S+ does not recompute \(got \S+\); nothing was changed\n$/,
      );
      expect(metaText(mine)).toBe(metaText(wrong));
    }, 120_000);
  },
);

describe.skipIf(!ready)("the reference and logbook-ts on the writer lock (rule A)", () => {
  /** A copy of the sample holding `state/writer.lock` with these bytes, and this mtime when given. */
  function locked(bytes: string, mtimeMs?: number): string {
    const root = copySample();
    mkdirSync(join(root, "state"));
    const lock = join(root, "state", "writer.lock");
    writeFileSync(lock, bytes, "utf-8");
    if (mtimeMs !== undefined) utimesSync(lock, mtimeMs / 1000, mtimeMs / 1000);
    return root;
  }

  it("an empty lock a crash left is taken after half a second without a word, under --no-wait too, by both", () => {
    for (const bytes of ["", '{"pid": 12', "garbage"]) {
      const [theirs, mine] = twice(locked(bytes, Date.now() - 10_000));
      for (const [run, root] of [
        [() => reference(theirs, ["--no-wait", "add", "over a leftover"]), theirs],
        [() => ours(["add", mine, "over a leftover", "--no-wait"]), mine],
      ] as const) {
        const started = Date.now();
        const ran = run();
        expect(ran.code, ran.err).toBe(0);
        expect(ran.err).toBe("");
        expect(Date.now() - started).toBeGreaterThanOrEqual(450);
        expect(existsSync(join(root, "state"))).toBe(false);
      }
    }
  }, 120_000);

  it("a holder whose process is gone is taken over with the same sentence, its fields printed alike", () => {
    for (const bytes of [
      "{}",
      '{"pid": 999999999, "command": "sync immich", "since": "2026-10-13T06:00:00Z"}',
      '{"pid": "x", "command": ["a"], "since": {"x": 1}}',
    ]) {
      const [theirs, mine] = twice(locked(bytes));
      const r = reference(theirs, ["add", "after a stale lock"]);
      const o = ours(["add", mine, "after a stale lock"]);
      expect([r.code, o.code]).toEqual([0, 0]);
      expect(o.err).toBe(r.err);
    }
  }, 120_000);

  it("a holder that lives is refused under --no-wait with exit 2 and the same sentence, its lock left as it is", () => {
    const pid = livingPid();
    const bytes = `{"pid": ${pid}, "command": "sync immich", "since": "2026-10-13T06:00:00Z"}`;
    const [theirs, mine] = twice(locked(bytes));
    const r = reference(theirs, ["--no-wait", "add", "held"]);
    const o = ours(["add", mine, "held", "--no-wait"]);
    expect([r.code, o.code]).toEqual([2, 2]);
    expect(o.err).toBe(r.err);
    expect(readFileSync(join(theirs, "state", "writer.lock"), "utf-8")).toBe(bytes);
    expect(readFileSync(join(mine, "state", "writer.lock"), "utf-8")).toBe(bytes);
    const rr = reference(theirs, ["--no-wait", "repair", "tail"]);
    const or = ours(["repair", "tail", mine, "--no-wait"]);
    expect([rr.code, or.code]).toEqual([2, 2]);
    expect(or.err).toBe(rr.err);
    process.kill(pid);
  }, 120_000);
});

/** A copy of `root` holding `state/writer.lock` with these bytes, and this mtime when given. */
function planted(root: string, bytes: string, mtimeMs?: number): string {
  mkdirSync(join(root, "state"), { recursive: true });
  const lock = join(root, "state", "writer.lock");
  writeFileSync(lock, bytes, "utf-8");
  if (mtimeMs !== undefined) utimesSync(lock, mtimeMs / 1000, mtimeMs / 1000);
  return lock;
}

/** A process that sets `file`'s mtime to now every 50 ms for `ms`, so the file is never half a second unchanged. */
function toucher(file: string, ms: number): ReturnType<typeof spawn> {
  return spawn(
    process.execPath,
    [
      "-e",
      `const fs = require("node:fs"); const [file, ms] = process.argv.slice(1); const end = Date.now() + Number(ms);
       (function touch() { if (Date.now() > end) return; try { const now = Date.now() / 1000; fs.utimesSync(file, now, now); } catch {} setTimeout(touch, 50); })();`,
      file,
      String(ms),
    ],
    { stdio: "ignore" },
  );
}

/** Wait until `file`'s mtime is past `ms`: the toucher has begun, so the lock is not a leftover when it is read. */
function touchedSince(file: string, ms: number): void {
  const end = Date.now() + 30_000;
  while (statSync(file).mtimeMs <= ms) {
    if (Date.now() > end) throw new Error(`${file} was never touched`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

/** Row `row` (1-based) of a month file rewritten by `edit`, re-serialized by JSON.stringify. */
function rewriteRow(root: string, rel: string, row: number, edit: (line: Line) => Line): void {
  const file = join(root, rel);
  const rows = readFileSync(file, "utf-8").split("\n").filter(Boolean);
  rows[row - 1] = JSON.stringify(edit(JSON.parse(rows[row - 1] as string) as Line));
  writeFileSync(file, `${rows.join("\n")}\n`, "utf-8");
}

const OCTOBER = join("logbook", "2026", "10.jsonl");
const NO_HOLDER_YET =
  "another logbook command is taking the lock on this record (state/writer.lock names no holder yet; if none is running, remove it)";

/**
 * Where the two are held to differ on purpose, both behaviours are pinned here, named as the
 * difference they are, so a change on either side is seen: (a) the reference judges a lock that names
 * no holder by one half-second poll from its first read; this implementation requires the half
 * second of its own reading of one unchanged file. Neither reads the mtime as an age (SPEC-QUESTIONS
 * 91: the reference's rule alone, the owner's decision of 16 October).
 * (b) the reference's `repair tail` checks the lines past the head only, applies, and reports a fault
 * before the head afterwards; this implementation verifies the whole chain first and refuses.
 */
describe.skipIf(!ready)("the reference and logbook-ts: rule A at its edges", () => {
  it("an empty lock made this instant (mtime now) is taken by both after half a second without a word, under --no-wait too", () => {
    const [theirs, mine] = twice(copySample());
    for (const [run, root] of [
      [() => reference(theirs, ["--no-wait", "add", "over a lock made now"]), theirs],
      [() => ours(["add", mine, "over a lock made now", "--no-wait"]), mine],
    ] as const) {
      planted(root, "");
      const started = Date.now();
      const ran = run();
      expect(ran.code, ran.err).toBe(0);
      expect(ran.err).toBe("");
      expect(Date.now() - started).toBeGreaterThanOrEqual(450);
      expect(existsSync(join(root, "state"))).toBe(false);
    }
  }, 120_000);

  it("an empty lock whose mtime is ahead of the clock (another machine's, on a shared folder) is taken by both after half a second without a word, under --no-wait too: neither reads the mtime as an age", () => {
    const [theirs, mine] = twice(copySample());
    for (const [run, root] of [
      [() => reference(theirs, ["--no-wait", "add", "over a lock dated ahead"]), theirs],
      [() => ours(["add", mine, "over a lock dated ahead", "--no-wait"]), mine],
    ] as const) {
      planted(root, "", Date.now() + 3_600_000);
      const started = Date.now();
      const ran = run();
      expect(ran.code, ran.err).toBe(0);
      expect(ran.err).toBe("");
      expect(Date.now() - started).toBeGreaterThanOrEqual(450);
      expect(existsSync(join(root, "state"))).toBe(false);
    }
  }, 120_000);

  it("deliberate difference (a): an empty lock touched during the half second — the reference removes it all the same; this implementation starts its half second over, and under --no-wait refuses", async () => {
    const [theirs, mine] = twice(copySample());
    const theirLock = planted(theirs, "", Date.now() - 10_000);
    const t1 = toucher(theirLock, 2_000);
    touchedSince(theirLock, Date.now() - 5_000);
    const r = reference(theirs, ["--no-wait", "add", "over a lock being touched"]);
    expect(r.code, r.err).toBe(0);
    expect(r.err).toBe("");
    await new Promise((resolve) => t1.on("close", resolve));

    const myLock = planted(mine, "", Date.now() - 10_000);
    const t2 = toucher(myLock, 2_000);
    touchedSince(myLock, Date.now() - 5_000);
    const o = ours(["add", mine, "over a lock being touched", "--no-wait"]);
    expect(o.code).toBe(2);
    expect(o.err).toBe(`add: ${NO_HOLDER_YET}; --no-wait, so not waiting\n`);
    await new Promise((resolve) => t2.on("close", resolve));
    expect(readFileSync(myLock, "utf-8")).toBe("");
  }, 120_000);

  it("repair tail under an empty leftover lock: both take it after half a second without a word, the dry run too, and bring logbook.json to the same head", () => {
    const { root } = lagging(1, 32);
    const [theirs, mine] = twice(root);
    for (const [run, record] of [
      [() => reference(theirs, ["--no-wait", "repair", "tail", "--dry-run"]), theirs],
      [() => ours(["repair", "tail", mine, "--dry-run", "--no-wait"]), mine],
      [() => reference(theirs, ["--no-wait", "repair", "tail"]), theirs],
      [() => ours(["repair", "tail", mine, "--no-wait"]), mine],
    ] as const) {
      planted(record, "", Date.now() - 10_000);
      const started = Date.now();
      const ran = run();
      expect(ran.code, ran.err).toBe(0);
      expect(ran.err).toBe("");
      expect(Date.now() - started).toBeGreaterThanOrEqual(450);
      expect(existsSync(join(record, "state"))).toBe(false);
    }
    expect(readMetaFile(mine)).toEqual(readMetaFile(theirs));
  }, 120_000);
});

describe.skipIf(!ready)("the reference and logbook-ts: decision B at its edges", () => {
  it("deliberate difference (b): a line before the head that does not recompute, with a lag — the reference's dry run lists the tail (exit 0) and its repair sets logbook.json forward and then reports the record invalid (exit 1); this implementation refuses both, exit 2, changing nothing", () => {
    const { root } = lagging(1, 32);
    rewriteRow(root, join("logbook", "2026", "03.jsonl"), 10, (line) => ({
      ...line,
      payload: { ...line.payload, text: "edited" },
    }));
    const [theirs, mine] = twice(root);

    const dry = reference(theirs, ["repair", "tail", "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.out).toMatch(
      /^logbook\.json says seq=32 head=58bfa9e704e3…; the files hold 1 line past it/,
    );
    expect(metaText(theirs)).toBe(metaText(root));
    const applied = reference(theirs, ["repair", "tail"]);
    expect(applied.code).toBe(1);
    expect(applied.out).toMatch(
      /\nINVALID — 1 problem\(s\) after the repair; 33 lines read, head [0-9a-f]{64}:\n {2}line 10: hash does not recompute\nnot tried again: run `logbook verify` and look at the report\n$/,
    );
    expect(readMetaFile(theirs).seq).toBe(33);

    for (const flags of [["--dry-run"], []]) {
      const o = ours(["repair", "tail", mine, ...flags]);
      expect(o.code).toBe(2);
      expect(o.out).toBe("");
      expect(o.err).toMatch(
        /^repair tail: \S+ line 10: seq 10 — hash [0-9a-f]{64} does not recompute \(got [0-9a-f]{64}\); nothing was changed\n$/,
      );
      expect(metaText(mine)).toBe(metaText(root));
    }
  }, 120_000);

  it("add on a lagging record whose tail does not verify — torn inside its last line, a hash that does not recompute, a prev that is not the line before, a second line of one seq — refuses with exit 2 and the reference's one sentence naming repair tail, writing nothing", () => {
    const cases: Array<[string, (root: string) => void]> = [
      [
        "torn",
        (root) => {
          cutInsideLastLine(root, OCTOBER);
          writeMeta(root, { ...readMetaFile(root), seq: 32, head: EXPECTED.head });
        },
      ],
      [
        "torn, logbook.json at the line before the cut",
        (root) => {
          cutInsideLastLine(root, OCTOBER);
        },
      ],
      [
        "hash",
        (root) =>
          rewriteRow(root, OCTOBER, 2, (line) => ({
            ...line,
            payload: { ...line.payload, text: "edited" },
          })),
      ],
      [
        "prev",
        (root) => rewriteRow(root, OCTOBER, 2, (line) => ({ ...line, prev: "c".repeat(64) })),
      ],
      [
        "seq",
        (root) => {
          const rows = readFileSync(join(root, OCTOBER), "utf-8").split("\n").filter(Boolean);
          writeFileSync(join(root, OCTOBER), `${rows[0]}\n${rows[0]}\n`, "utf-8");
        },
      ],
    ];
    for (const [name, damage] of cases) {
      const { root } = lagging(2, 32);
      damage(root);
      const [theirs, mine] = twice(root);
      const r = reference(theirs, ["add", "two"]);
      const o = ours(["add", mine, "two"]);
      expect(r.code, name).toBe(2);
      expect(r.err.split("\n").filter(Boolean), name).toHaveLength(1);
      expect(r.err, name).toMatch(/nothing was written: run `logbook repair tail`\n$/);
      expect(o.code, name).toBe(2);
      expect(asReference(o.err), name).toBe(r.err);
      expect(metaText(mine)).toBe(metaText(root));
    }
  }, 120_000);

  it("deliberate difference (SPEC-QUESTIONS 92): a logbook.json whose head is not sixty-four hex digits — the reference's repair tail says its same-seq sentence and its add refuses with exit 2; this implementation's repair tail refuses in its own sentence (exit 2) and its add as a record that does not verify (exit 1)", () => {
    const root = copySample();
    writeMeta(root, { ...readMetaFile(root), head: "abc" });
    const [theirs, mine] = twice(root);
    const r = reference(theirs, ["repair", "tail"]);
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      "repair tail: logbook.json says seq=32 head=abc…, the files end at seq=32 head=58bfa9e704e3…: no line is past the head and the head is not the files'; run `logbook verify`; nothing was changed\n",
    );
    const o = ours(["repair", "tail", mine]);
    expect(o.code).toBe(2);
    expect(o.err).toBe(
      "repair tail: logbook.json: seq 32, head abc name no line of a chain (a whole number from 0, and 64 hex digits); nothing was changed\n",
    );
    const ra = reference(theirs, ["add", "two"]);
    expect(ra.code).toBe(2);
    expect(ra.err).toBe(
      "add: the files do not end where logbook.json says: they end at seq 32 head 58bfa9e704e3…, logbook.json says seq 32 head abc…; nothing was written: run `logbook repair tail`\n",
    );
    const oa = ours(["add", mine, "two"]);
    expect(oa.code).toBe(1);
    expect(oa.err).toMatch(/^error: refusing to append to a record that does not verify:\n/);
    expect(metaText(mine)).toBe(metaText(root));
    expect(metaText(theirs)).toBe(metaText(root));
  }, 120_000);
});
