import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashLine, ZERO_HASH } from "../src/chain.js";
import { canonicalize } from "../src/jcs.js";
import {
  addNote,
  HeadMoved,
  LogbookError,
  RepairRefused,
  repairTail,
  TailAhead,
  type VerifyStats,
  verifyLogbook,
} from "../src/store.js";
import type { Line } from "../src/types.js";
import { readChain } from "../src/verify.js";
import {
  cleanup,
  copyFixture,
  EXPECTED_SEALED,
  readLines,
  readMetaFile,
  SAMPLE_MONTH,
  tempDir,
  writeMeta,
} from "./helpers.js";

/*
 * Crash recovery (repair tail, and the append's refusal) on the streaming readChain, against an
 * oracle — the same lines in one file in seq order — over layouts, faults and edges. Synthetic data
 * only: the notes are about nobody. `node:fs` passes through to the real
 * calls unless a hook is set: `onOpen` lets a test act as a writer that ignores the lock, in the
 * middle of the chain walk; `log` records opens, writes, fsyncs, closes, renames and mkdirs so the
 * SPEC §3 write order can be read back.
 */
const hooks = vi.hoisted(() => ({
  onOpen: undefined as ((path: string, flags: unknown) => void) | undefined,
  log: undefined as string[] | undefined,
}));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  /** Log `name` with the arguments `shown` (the first `shown` of them), then make the real call with all of them. */
  const call = <T>(
    name: string,
    fn: (...args: unknown[]) => T,
    args: unknown[],
    shown = args.length,
  ): T => {
    hooks.log?.push(`${name} ${args.slice(0, shown).map(String).join(" ")}`);
    return fn(...args);
  };
  return {
    ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>): number => {
      hooks.onOpen?.(String(args[0]), args[1]);
      const fd = fs.openSync(...args);
      hooks.log?.push(`open ${fd} ${String(args[0])} ${String(args[1])}`);
      return fd;
    },
    writeSync: (...args: unknown[]) =>
      call("write", fs.writeSync as (...a: unknown[]) => number, args, 1),
    fsyncSync: (...args: unknown[]) =>
      call("fsync", fs.fsyncSync as (...a: unknown[]) => void, args),
    closeSync: (...args: unknown[]) =>
      call("close", fs.closeSync as (...a: unknown[]) => void, args),
    renameSync: (...args: unknown[]) =>
      call("rename", fs.renameSync as (...a: unknown[]) => void, args),
    mkdirSync: (...args: unknown[]) =>
      call("mkdir", fs.mkdirSync as (...a: unknown[]) => string | undefined, args, 1),
    writeFileSync: (...args: unknown[]) =>
      call("writeFile", fs.writeFileSync as (...a: unknown[]) => void, args, 1),
    appendFileSync: (...args: unknown[]) =>
      call("appendFile", fs.appendFileSync as (...a: unknown[]) => void, args, 1),
  };
});

afterEach(() => {
  hooks.onOpen = undefined;
  hooks.log = undefined;
  cleanup();
});

const short = (hash: string): string => `${hash.slice(0, 12)}…`;

/** `n` synthetic notes chained in order (SPEC §3), at the times given; nothing in them is real. */
function chained(ats: string[]): Line[] {
  let prev = ZERO_HASH;
  return ats.map((at, i) => {
    const seq = i + 1;
    const line: Line = {
      id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      seq,
      at,
      end: null,
      tz: "Europe/Oslo",
      source: "manual",
      kind: "note",
      tier: 2,
      payload: { schema: "note/v1", text: `note ${seq}, Ola Nordmann of Oslo, who does not exist` },
      recorded_at: "2026-10-01T12:00:00Z",
      prev,
      hash: "",
    };
    line.hash = hashLine(line);
    prev = line.hash;
    return line;
  });
}

/** `at` of `count` notes spread round-robin over the first `months` months of 2026. */
const cycling = (count: number, months: number): string[] =>
  Array.from({ length: count }, (_, i) => {
    const round = Math.floor(i / months);
    const two = (n: number): string => String(n).padStart(2, "0");
    return `2026-${two((i % months) + 1)}-${two(Math.floor(round / 24) + 1)}T${two(round % 24)}:00:00Z`;
  });

const MOST = 45;

/** How a chain is laid out over month files: which file each line goes to, shuffled or not, with blank rows, CRLF, a missing final newline. */
interface Layout {
  count: number;
  at: number;
  files: number;
  picks: number[];
  shuffled: boolean;
  order: number[];
  blanks: number[];
  crlf: boolean[];
  noFinalNewline: boolean[];
}

const layoutArb = fc.record({
  count: fc.integer({ min: 1, max: MOST }),
  at: fc.nat(),
  files: fc.integer({ min: 1, max: 5 }),
  picks: fc.array(fc.nat(), { minLength: MOST, maxLength: MOST }),
  shuffled: fc.boolean(),
  order: fc.array(fc.nat(), { minLength: MOST, maxLength: MOST }),
  blanks: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: MOST, maxLength: MOST }),
  crlf: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
  noFinalNewline: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
});

const META = {
  format: "logbook/0.2",
  owner_id: "00000000-0000-4000-8000-000000000002",
  created_at: "2026-01-01T00:00:00Z",
  timezone: "Europe/Oslo",
  note: "a key repair tail must keep",
};

/** The rows of each month file, laid out by `how`; `where` is each seq's `<file> line <row>` as verify names it. */
function layRows(
  lines: Line[],
  how: Layout,
): { rows: Map<string, string[]>; where: Map<number, string>; rels: string[] } {
  const spread: Line[][] = Array.from({ length: how.files }, () => []);
  for (const [i, line] of lines.entries()) {
    (spread[(how.picks[i] ?? 0) % how.files] as Line[]).push(line);
  }
  if (how.shuffled) {
    for (const rows of spread) {
      const keyed = rows.map((row, i) => ({ row, key: how.order[i] ?? 0, i }));
      keyed.sort((a, b) => a.key - b.key || a.i - b.i);
      rows.splice(0, rows.length, ...keyed.map((k) => k.row));
    }
  }
  const rows = new Map<string, string[]>();
  const where = new Map<number, string>();
  const rels: string[] = [];
  spread.forEach((lines, f) => {
    if (lines.length === 0) return;
    const rel = join("logbook", "2026", `${String(f + 1).padStart(2, "0")}.jsonl`);
    const out: string[] = [];
    for (const line of lines) {
      const blanks = how.blanks[line.seq - 1] ?? 0;
      for (let b = 0; b < blanks; b++) out.push(b % 2 ? " \t" : "");
      out.push(canonicalize(line));
      where.set(line.seq, `${rel} line ${out.length}`);
    }
    rows.set(rel, out);
    rels.push(rel);
  });
  return { rows, where, rels };
}

function writeRows(root: string, rows: Map<string, string[]>, how: Layout): void {
  for (const [rel, out] of rows) {
    const f = Number(rel.slice(-8, -6)) - 1;
    const eol = how.crlf[f] ? "\r\n" : "\n";
    let text = out.join(eol);
    if (!how.noFinalNewline[f]) text += eol;
    mkdirSync(join(root, "logbook", "2026"), { recursive: true });
    writeFileSync(join(root, rel), text, "utf-8");
  }
}

/**
 * A record of `lines` laid out by `how`, logbook.json set back to `at` as a crash leaves it: the
 * hash of the line at `at` in `chain` (the lines as chained, before any fault), GENESIS for 0.
 */
function lagging(
  lines: Line[],
  how: Layout,
  at: number,
  chain: Line[] = lines,
): { root: string; where: Map<number, string>; rels: string[] } {
  const root = join(tempDir(), "record");
  mkdirSync(root);
  const { rows, where, rels } = layRows(lines, how);
  writeRows(root, rows, how);
  const head = at === 0 ? ZERO_HASH : (chain[at - 1] as Line).hash;
  writeMeta(root, { ...META, seq: at, head });
  return { root, where, rels };
}

/** Every byte of the record's files, to show nothing moved. */
function snapshot(root: string): Record<string, string> {
  const taken: Record<string, string> = {};
  taken["logbook.json"] = readFileSync(join(root, "logbook.json"), "utf-8");
  const dir = join(root, "logbook", "2026");
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      taken[name] = readFileSync(join(dir, name)).toString("base64");
    }
  }
  return taken;
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

describe("repair tail and the append's refusal against an oracle: one file in seq order", () => {
  it("whatever the layout — files, shuffled files, blank rows, CRLF, no final newline — the dry run's count, rows, first row and target are the chain's; the repair writes only logbook.json, keeps its keys, and verifies; the append refuses first, in the reference's sentence", () => {
    fc.assert(
      fc.property(layoutArb, (how) => {
        const n = how.count;
        const lines = chained(cycling(n, 3));
        const last = lines[n - 1] as Line;
        const at = how.at % (n + 1);
        const { root, where } = lagging(lines, how, at);
        const before = snapshot(root);
        const headAt = at === 0 ? ZERO_HASH : (lines[at - 1] as Line).hash;
        const expectedRows = lines.slice(at, at + 20).map((line) => ({
          seq: line.seq,
          where: where.get(line.seq),
          hash: line.hash,
          prev: line.prev,
        }));

        // Memory: the probe holds one parsed line per month file, as verify does.
        const stats: VerifyStats = { peakHeld: 0 };
        let given = 0;
        const chain = readChain(root, stats, {
          at,
          begin: () => {
            given = 0;
          },
          tail: () => (given += 1),
        });
        expect(chain.errors).toEqual([]);
        expect(given).toBe(n - at);
        expect(stats.peakHeld).toBeLessThanOrEqual(
          new Set([...where.values()].map((w) => w.split(" line ")[0])).size,
        );

        // The append: TailAhead while the files are past logbook.json, nothing written.
        if (at < n) {
          const err = thrown(() => addNote(root, "after the crash"));
          expect(err).toBeInstanceOf(TailAhead);
          expect((err as Error).message).toBe(
            `the files are ahead of logbook.json: they end at seq ${n} head ${short(last.hash)}, logbook.json says seq ${at} head ${short(headAt)} (a crash between a line and logbook.json, SPEC §3); nothing was written: run \`logbook-ts repair tail\``,
          );
          expect(snapshot(root)).toEqual(before);
        }

        // The dry run against the oracle.
        const dry = repairTail(root, { dryRun: true });
        expect(dry.written).toBe(false);
        expect(dry.count).toBe(n - at);
        expect(dry.shown.length).toBeLessThanOrEqual(20);
        expect(dry.shown).toEqual(at < n ? expectedRows : []);
        expect(dry.from).toEqual({ seq: at, head: headAt });
        expect(dry.to).toEqual({ seq: n, head: last.hash });
        expect(snapshot(root)).toEqual(before);
        expect(existsSync(join(root, "state"))).toBe(false);

        // The repair: logbook.json alone changes, its other keys kept.
        const done = repairTail(root);
        expect(done.written).toBe(at < n);
        expect(done.count).toBe(dry.count);
        expect(done.shown).toEqual(dry.shown);
        expect(done.to).toEqual(dry.to);
        const after = snapshot(root);
        for (const [name, bytes] of Object.entries(before)) {
          if (name !== "logbook.json") expect(after[name]).toBe(bytes);
        }
        expect(readMetaFile(root)).toEqual({ ...META, seq: n, head: last.hash });
        if (at < n) expect(done.verified).toMatchObject({ valid: true, lines: n, head: last.hash });
        expect(verifyLogbook(root)).toMatchObject({ valid: true, lines: n, head: last.hash });
        expect(existsSync(join(root, "state"))).toBe(false);

        // And the next append chains from the head the repair set.
        const added = addNote(root, "after the repair", { now: new Date("2026-12-31T10:00:00Z") });
        expect(added).toMatchObject({ seq: n + 1, prev: last.hash });
        cleanup();
      }),
      { numRuns: 120 },
    );
  }, 120_000);

  /** A fault to plant: in the lines, in a file, or in logbook.json. */
  const faultArb = fc.oneof(
    fc.record({ kind: fc.constant("tamper" as const), i: fc.nat() }),
    fc.record({ kind: fc.constant("fork" as const), i: fc.nat(), into: fc.nat() }),
    fc.record({ kind: fc.constant("gap" as const), i: fc.nat() }),
    fc.record({ kind: fc.constant("string-seq" as const), i: fc.nat() }),
    fc.record({ kind: fc.constant("torn" as const), f: fc.nat() }),
    fc.record({ kind: fc.constant("behind" as const), k: fc.integer({ min: 1, max: 3 }) }),
    fc.constant({ kind: "other-head" as const }),
    fc.constant({ kind: "never-held" as const }),
    fc.record({ kind: fc.constant("bad-meta" as const), v: fc.integer({ min: 0, max: 11 }) }),
  );

  const BAD_META: Array<Record<string, unknown>> = [
    { seq: "3" },
    { seq: 1.5 },
    { seq: -1 },
    { seq: null },
    { seq: true },
    { seq: undefined },
    { head: "A".repeat(64) },
    { head: "a".repeat(63) },
    { head: "a".repeat(65) },
    { head: "" },
    { head: null },
    { head: undefined },
  ];

  it("a fault anywhere — a line that does not recompute, a second line of one seq, a gap, a seq that is no integer, a torn row, logbook.json behind or at another head or naming no line — is refused by the dry run and the repair alike, nothing changed; the append refuses too, in a crash's sentence where the reference's does", () => {
    fc.assert(
      fc.property(layoutArb, faultArb, (how, fault) => {
        const n = how.count;
        let lines = chained(cycling(n, 3));
        const at = how.at % (n + 1);
        if (fault.kind === "never-held") fc.pre(at < n);
        if (fault.kind === "gap") fc.pre(n >= 2);
        if (fault.kind === "tamper") {
          const i = fault.i % n;
          const line = lines[i] as Line;
          lines[i] = { ...line, payload: { ...line.payload, text: "changed on disk" } };
        }
        if (fault.kind === "string-seq") {
          const i = fault.i % n;
          lines[i] = {
            ...(lines[i] as Line),
            seq: String((lines[i] as Line).seq) as unknown as number,
          };
        }
        const chain = lines;
        if (fault.kind === "gap") lines = lines.filter((_, i) => i !== fault.i % (n - 1));
        const { root, rels } = lagging(lines, how, at, chain);
        if (fault.kind === "fork" || fault.kind === "torn") {
          const rel = rels[(fault.kind === "fork" ? fault.into : fault.f) % rels.length] as string;
          const file = join(root, rel);
          const text = readFileSync(file, "utf-8");
          const dup = canonicalize(
            lines[fault.kind === "fork" ? fault.i % lines.length : 0] as Line,
          );
          const extra =
            fault.kind === "fork" ? `${dup}\n` : dup.slice(0, Math.floor(dup.length / 2));
          writeFileSync(file, `${text}${text.endsWith("\n") ? "" : "\n"}${extra}`, "utf-8");
        }
        const meta = readMetaFile(root);
        if (fault.kind === "behind") writeMeta(root, { ...meta, seq: n + fault.k });
        if (fault.kind === "other-head") writeMeta(root, { ...meta, seq: n, head: "a".repeat(64) });
        if (fault.kind === "never-held") writeMeta(root, { ...meta, head: "b".repeat(64) });
        if (fault.kind === "bad-meta") {
          const bad = { ...meta, ...BAD_META[fault.v] };
          for (const key of Object.keys(bad)) if (bad[key] === undefined) delete bad[key];
          writeMeta(root, bad);
        }
        const before = snapshot(root);

        for (const dryRun of [true, false]) {
          const err = thrown(() => repairTail(root, { dryRun }));
          expect(err).toBeInstanceOf(RepairRefused);
          const message = (err as Error).message;
          expect(message).toMatch(/; nothing was changed$/);
          if (fault.kind === "torn")
            expect(message).toMatch(/the file ends inside this line \(cut short\)/);
          if (fault.kind === "fork") expect(message).toMatch(/expected seq/);
          if (fault.kind === "behind")
            expect(message).toMatch(/the files are behind logbook\.json/);
          if (fault.kind === "other-head") expect(message).toMatch(/the head is not the files'/);
          if (fault.kind === "never-held")
            expect(message).toMatch(/prev .* does not match previous hash b{64}/);
          if (fault.kind === "bad-meta") expect(message).toMatch(/name no line of a chain/);
          expect(snapshot(root)).toEqual(before);
          expect(existsSync(join(root, "state"))).toBe(false);
        }

        // The append refuses in a crash's one sentence where the reference's `add` does, which looks
        // at where the files end and no further: a month file cut inside its last line, or the files
        // ending (at their last line's seq and hash) past logbook.json or at its seq under another
        // head; anything else as a record that does not verify.
        const err = thrown(() => addNote(root, "no"));
        expect(err).toBeInstanceOf(LogbookError);
        const ends = readChain(root);
        const named = readMetaFile(root);
        const namesAHead =
          Number.isInteger(named.seq) &&
          (named.seq as number) >= 0 &&
          typeof named.head === "string" &&
          /^[0-9a-f]{64}$/.test(named.head);
        const crash =
          fault.kind === "torn" ||
          (namesAHead &&
            (ends.last > (named.seq as number) ||
              (ends.last === named.seq && ends.head !== named.head)));
        expect(err instanceof TailAhead).toBe(crash);
        if (fault.kind === "torn")
          expect((err as Error).message).toMatch(
            /\(cut short\); nothing was written: run `logbook-ts repair tail`$/,
          );
        if (!crash)
          expect((err as Error).message).toMatch(
            /^refusing to append to a record that does not verify/,
          );
        expect(snapshot(root)).toEqual(before);
        expect(existsSync(join(root, "state"))).toBe(false);
        cleanup();
      }),
      { numRuns: 160 },
    );
  }, 120_000);
});

describe("repair tail, targeted", () => {
  const HOW: Layout = {
    count: 6,
    at: 0,
    files: 2,
    picks: [0, 1, 0, 1, 0, 1],
    shuffled: false,
    order: [],
    blanks: [0, 0, 0, 0, 0, 0],
    crlf: [false, false],
    noFinalNewline: [false, false],
  };

  it("a logbook/0.3 record that names recipients: the append refuses as it cannot seal (not TailAhead), repair tail brings logbook.json forward over the sealed tail and keeps the recipients", () => {
    const root = copyFixture("sample-logbook-sealed");
    const rows = readLines(root, SAMPLE_MONTH);
    const line31 = JSON.parse(rows[30] as string) as Line;
    const line32 = JSON.parse(rows[31] as string) as Line;
    const meta = readMetaFile(root);
    writeMeta(root, { ...meta, seq: 31, head: line31.hash });
    const err = thrown(() => addNote(root, "cannot seal"));
    expect(err).toBeInstanceOf(LogbookError);
    expect(err).not.toBeInstanceOf(TailAhead);
    expect((err as Error).message).toMatch(/names recipients/);
    const dry = repairTail(root, { dryRun: true });
    expect(dry).toMatchObject({
      count: 1,
      written: false,
      to: { seq: 32, head: EXPECTED_SEALED.head },
    });
    expect(dry.shown).toEqual([
      { seq: 32, where: `${SAMPLE_MONTH} line 32`, hash: line32.hash, prev: line31.hash },
    ]);
    const done = repairTail(root);
    expect(done.written).toBe(true);
    expect(done.verified).toMatchObject({ valid: true, lines: 32, head: EXPECTED_SEALED.head });
    expect(readMetaFile(root)).toEqual({ ...meta, seq: 32, head: EXPECTED_SEALED.head });
    expect(readLines(root, SAMPLE_MONTH)).toEqual(rows);
  });

  it("a writer that ignored the lock and replaced logbook.json while the chain was being read: HeadMoved, and what it wrote is left as it is", () => {
    const lines = chained(cycling(6, 2));
    const { root } = lagging(lines, HOW, 2);
    const intruder = { ...readMetaFile(root), seq: 4, head: (lines[3] as Line).hash };
    let moved = false;
    hooks.onOpen = (path) => {
      if (!moved && path.endsWith(".jsonl")) {
        moved = true;
        writeMeta(root, intruder);
      }
    };
    const err = thrown(() => repairTail(root));
    hooks.onOpen = undefined;
    expect(moved).toBe(true);
    expect(err).toBeInstanceOf(HeadMoved);
    expect(err).not.toBeInstanceOf(TailAhead);
    expect((err as Error).message).toMatch(/nothing was changed$/);
    expect(readMetaFile(root)).toEqual(intruder);
    expect(existsSync(join(root, "state"))).toBe(false);
    // A repair after it starts from the head the intruder named.
    expect(repairTail(root)).toMatchObject({ written: true, count: 2, from: { seq: 4 } });
    expect(verifyLogbook(root)).toMatchObject({ valid: true, lines: 6 });
  });

  it("a writer that ignored the lock and changed another key of logbook.json, not seq or head, while the chain was being read: the repair passes the HeadMoved check and keeps that key, writing from logbook.json as read under the lock", () => {
    const lines = chained(cycling(6, 2));
    const { root } = lagging(lines, HOW, 2);
    const intruder = { ...readMetaFile(root), timezone: "Europe/Stockholm" };
    let moved = false;
    hooks.onOpen = (path) => {
      if (!moved && path.endsWith(".jsonl")) {
        moved = true;
        writeMeta(root, intruder);
      }
    };
    const done = repairTail(root);
    hooks.onOpen = undefined;
    expect(moved).toBe(true);
    expect(done.written).toBe(true);
    expect(readMetaFile(root)).toEqual({
      ...META,
      timezone: "Europe/Stockholm",
      seq: 6,
      head: (lines[5] as Line).hash,
    });
  });

  it("SPEC §3 write order: no month file is opened for writing; logbook.json is written to a sibling temp file, fsynced, closed, renamed over the target, and the folder fsynced, in that order", () => {
    const lines = chained(cycling(6, 2));
    const { root } = lagging(lines, HOW, 3);
    hooks.log = [];
    const done = repairTail(root);
    const log = hooks.log;
    hooks.log = undefined;
    expect(done.written).toBe(true);
    // The month files: read-only, and never written through any other call.
    expect(log.filter((l) => l.includes(".jsonl") && !l.endsWith(" r"))).toEqual([]);
    expect(log.filter((l) => /^(writeFile|appendFile) /.test(l))).toEqual([]);
    // The writes: the lock's own temp file, and logbook.json's.
    const opensForWriting = log.filter((l) => /^open \d+ .* (w|wx|a)$/.test(l));
    expect(opensForWriting).toHaveLength(2);
    const tmpOpen = log.findIndex((l) => /^open \d+ .*[/\\]\.logbook\.json\.\d+\.tmp w$/.test(l));
    expect(tmpOpen).toBeGreaterThan(-1);
    const fd = (log[tmpOpen] as string).split(" ")[1];
    const tmp = (log[tmpOpen] as string).slice(`open ${fd} `.length, -2);
    const target = join(root, "logbook.json");
    expect(log.slice(tmpOpen + 1, tmpOpen + 5)).toEqual([
      `write ${fd}`,
      `fsync ${fd}`,
      `close ${fd}`,
      `rename ${tmp} ${target}`,
    ]);
    const folderOpen = log[tmpOpen + 5] as string;
    expect(folderOpen).toMatch(
      new RegExp(`^open \\d+ ${root.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")} r$`),
    );
    const folderFd = folderOpen.split(" ")[1];
    expect(log.slice(tmpOpen + 6, tmpOpen + 8)).toEqual([`fsync ${folderFd}`, `close ${folderFd}`]);
    // Every write before the rename went to the temp file; none to logbook.json itself.
    expect(log.filter((l) => l === `open ${fd} ${target} w`)).toEqual([]);
    expect(existsSync(tmp)).toBe(false);
  });

  it("a folder that is no record: refused by logbook.json, and no state/ folder is made for the lock there (as add makes none)", () => {
    const empty = tempDir();
    hooks.log = [];
    const err = thrown(() => repairTail(empty, { dryRun: true }));
    const log = hooks.log;
    hooks.log = undefined;
    expect(err).toBeInstanceOf(LogbookError);
    expect((err as Error).message).toMatch(/cannot read logbook\.json/);
    expect(existsSync(join(empty, "state"))).toBe(false);
    // logbook.json is read before the lock is taken: no state/ folder or lock is made and removed.
    expect(log.filter((l) => l.includes(join(empty, "state")))).toEqual([]);
  });

  it("no folder at all: refused as logbook.json that cannot be read, not as a lock folder that cannot be made", () => {
    const missing = join(tempDir(), "nowhere");
    const gone = thrown(() => repairTail(missing));
    expect(gone).toBeInstanceOf(LogbookError);
    expect((gone as Error).message).toMatch(/cannot read logbook\.json/);
  });

  it("seq 0 under a head that is not GENESIS is refused: the first line does not chain from it; seq 0 and GENESIS on an empty record is nothing to repair", () => {
    const lines = chained(cycling(3, 1));
    const { root } = lagging(lines, { ...HOW, count: 3, files: 1 }, 0);
    writeMeta(root, { ...readMetaFile(root), head: "c".repeat(64) });
    const before = snapshot(root);
    const err = thrown(() => repairTail(root));
    expect(err).toBeInstanceOf(RepairRefused);
    expect((err as Error).message).toBe(
      `${join("logbook", "2026", "01.jsonl")} line 1: seq 1 — prev ${ZERO_HASH} does not match previous hash ${"c".repeat(64)}; nothing was changed`,
    );
    expect(snapshot(root)).toEqual(before);

    const bare = join(tempDir(), "bare");
    mkdirSync(bare);
    writeMeta(bare, { ...META, seq: 0, head: ZERO_HASH });
    expect(repairTail(bare)).toMatchObject({
      count: 0,
      written: false,
      to: { seq: 0, head: ZERO_HASH },
    });
    writeMeta(bare, { ...META, seq: 0, head: "c".repeat(64) });
    expect((thrown(() => repairTail(bare)) as Error).message).toMatch(/the head is not the files'/);
  });
});
