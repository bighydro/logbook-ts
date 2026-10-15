import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
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

/** The reference CLI on a record: its exit code, stdout and stderr (without what `uv` says of itself). */
function reference(root: string, args: string[]): Ran {
  const result = spawnSync("uv", ["run", "--project", REF as string, "logbook", ...args], {
    cwd: REF,
    encoding: "utf-8",
    env: { ...process.env, LOGBOOK_HOME: root, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
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

/** The reference's words, without the index this implementation does not keep. */
const withoutIndex = (text: string): string =>
  text
    .replace(
      /, and (build no index|extend the index by \d+ lines?|build the index again)[^\n]*/g,
      "",
    )
    .replace(/; (no index|the index)[^\n]*/g, "");

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
