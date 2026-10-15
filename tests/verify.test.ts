import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashLine, ZERO_HASH } from "../src/chain.js";
import { canonicalize } from "../src/jcs.js";
import { addNote, type VerifyStats, verifyLogbook } from "../src/store.js";
import type { Line } from "../src/types.js";
import { type ChainProbe, readChain, type TailLine } from "../src/verify.js";
import { cleanup, tempDir, writeMeta } from "./helpers.js";

// Every handle opened and closed goes through here to the real calls, so a test can count the files
// verify holds open at once. Nothing else changes.
const handles = vi.hoisted(() => ({ open: new Set<number>(), most: 0 }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>): number => {
      const fd = fs.openSync(...args);
      handles.open.add(fd);
      handles.most = Math.max(handles.most, handles.open.size);
      return fd;
    },
    closeSync: (fd: number): void => {
      handles.open.delete(fd);
      fs.closeSync(fd);
    },
  };
});

afterEach(cleanup);

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
      payload: { schema: "note/v1", text: `note ${seq}, Oslo` },
      recorded_at: "2026-10-01T12:00:00Z",
      prev,
      hash: "",
    };
    line.hash = hashLine(line);
    prev = line.hash;
    return line;
  });
}

/**
 * A bare record holding `files`, each `logbook/<YYYY>/<MM>.jsonl` (given as `YYYY/MM`) with its rows
 * in the order given — a line, or text that is no line — and a logbook.json naming `seq` and `head`.
 */
function record(files: Record<string, Array<Line | string>>, seq: number, head: string): string {
  const root = join(tempDir(), "record");
  for (const [month, rows] of Object.entries(files)) {
    const [year, mm] = month.split("/") as [string, string];
    mkdirSync(join(root, "logbook", year), { recursive: true });
    const text = rows.map((row) => (typeof row === "string" ? row : canonicalize(row)));
    writeFileSync(join(root, "logbook", year, `${mm}.jsonl`), `${text.join("\n")}\n`, "utf-8");
  }
  writeMeta(root, {
    format: "logbook/0.2",
    owner_id: "00000000-0000-4000-8000-000000000002",
    created_at: "2026-01-01T00:00:00Z",
    timezone: "Europe/Oslo",
    seq,
    head,
  });
  return root;
}

const rel = (month: string): string => {
  const [year, mm] = month.split("/") as [string, string];
  return join("logbook", year, `${mm}.jsonl`);
};

/**
 * `at` of `count` notes spread over the first `months` months of 2026, each in the next month
 * round: every month file is open in the merge from its first line to its last.
 */
const cycling = (count: number, months: number): string[] =>
  Array.from({ length: count }, (_, i) => {
    const round = Math.floor(i / months);
    const two = (n: number): string => String(n).padStart(2, "0");
    return `2026-${two((i % months) + 1)}-${two(Math.floor(round / 24) + 1)}T${two(round % 24)}:00:00Z`;
  });

/** The record's lines laid out by the month of their `at`, each file in seq order: as a writer leaves them. */
function placed(lines: Line[]): Record<string, Line[]> {
  const files: Record<string, Line[]> = {};
  for (const line of lines) {
    const month = `${line.at.slice(0, 4)}/${line.at.slice(5, 7)}`;
    files[month] = [...(files[month] ?? []), line];
  }
  return files;
}

describe("verifyLogbook streams the month files in seq order (SPEC §3)", () => {
  it("holds one parsed line per month file however long the record: 6 for 60 lines and for 600", () => {
    for (const count of [60, 600]) {
      const lines = chained(cycling(count, 6));
      const last = lines[count - 1] as Line;
      const root = record(placed(lines), last.seq, last.hash);
      const stats: VerifyStats = { peakHeld: 0 };
      const result = verifyLogbook(root, stats);
      expect(result).toEqual({ valid: true, lines: count, head: last.hash, errors: [] });
      expect(stats.peakHeld).toBe(6);
      expect(stats.unsorted).toBeUndefined();
    }
  });

  it("holds no month file open between reads: one handle at a time, though twelve files stand open in the merge", () => {
    const lines = chained(cycling(240, 12));
    const last = lines[239] as Line;
    const root = record(placed(lines), last.seq, last.hash);
    handles.most = 0;
    const stats: VerifyStats = { peakHeld: 0 };
    expect(verifyLogbook(root, stats).valid).toBe(true);
    expect(stats.peakHeld).toBe(12);
    expect(handles.most).toBe(1);
    expect(handles.open.size).toBe(0);
  });

  it("a record whose March lines sit in the January file verifies normally: placement is the writer's (SPEC §2)", () => {
    const lines = chained([
      "2026-01-05T10:00:00Z",
      "2026-03-02T10:00:00Z",
      "2026-03-03T10:00:00Z",
      "2026-02-01T10:00:00Z",
      "2026-03-04T10:00:00Z",
    ]);
    const [one, two, three, four, five] = lines as [Line, Line, Line, Line, Line];
    const root = record(
      { "2026/01": [one, two, three], "2026/02": [four], "2026/03": [five] },
      5,
      five.hash,
    );
    const stats: VerifyStats = { peakHeld: 0 };
    expect(verifyLogbook(root, stats)).toEqual({
      valid: true,
      lines: 5,
      head: five.hash,
      errors: [],
    });
    expect(stats.unsorted).toBeUndefined();
    expect(stats.peakHeld).toBeLessThanOrEqual(3);
  });

  it("a month file out of seq order is no fault (SPEC §3): the record is read again sorted, and named", () => {
    const lines = chained([
      "2026-05-01T10:00:00Z",
      "2026-04-01T10:00:00Z",
      "2026-05-02T10:00:00Z",
      "2026-04-02T10:00:00Z",
      "2026-05-03T10:00:00Z",
    ]);
    const [one, two, three, four, five] = lines as [Line, Line, Line, Line, Line];
    const root = record({ "2026/04": [four, two], "2026/05": [one, three, five] }, 5, five.hash);
    const stats: VerifyStats = { peakHeld: 0 };
    expect(verifyLogbook(root, stats)).toEqual({
      valid: true,
      lines: 5,
      head: five.hash,
      errors: [],
    });
    expect(stats.unsorted).toBe(`${rel("2026/04")} line 2: seq 2 after 4`);
    // and the line appended to it still chains
    const added = addNote(root, "after a sorted read", { now: new Date("2026-05-04T10:00:00Z") });
    expect(added).toMatchObject({ seq: 6, prev: five.hash });
    expect(verifyLogbook(root)).toMatchObject({ valid: true, lines: 6, head: added.hash });
  });

  it("reports what is wrong in the order it always has: rows that are no line, then envelopes by file, then the chain, then logbook.json", () => {
    const lines = chained([
      "2026-05-01T10:00:00Z",
      "2026-04-01T10:00:00Z",
      "2026-05-02T10:00:00Z",
      "2026-04-02T10:00:00Z",
      "2026-05-03T10:00:00Z",
    ]);
    const [one, two, three, four, five] = lines as [Line, Line, Line, Line, Line];
    const tier4 = { ...four, tier: 4 } as unknown as Line;
    const stringSeq = { ...three, seq: "3" } as unknown as Line;
    const root = record(
      { "2026/04": [two, tier4], "2026/05": [one, stringSeq, "{oops", five] },
      5,
      five.hash,
    );
    const result = verifyLogbook(root);
    const april = rel("2026/04");
    const may = rel("2026/05");
    expect(result.errors.map((e) => e.replace(/not JSON \(.*\)$/, "not JSON"))).toEqual([
      `${may} line 3: not JSON`,
      `${april} line 2: seq 4 — tier must be 1, 2 or 3`,
      `${may} line 2: seq must be an integer ≥ 1`,
      `${april} line 2: seq 4 — expected seq 3`,
      `${april} line 2: seq 4 — prev ${three.hash} does not match previous hash ${two.hash}`,
      `${april} line 2: seq 4 — hash ${four.hash} does not recompute (got ${hashLine(tier4)})`,
      "logbook.json: seq 5 does not match the last line (3)",
      `logbook.json: head ${five.hash} does not match the last line (${four.hash})`,
    ]);
    expect([result.lines, result.head]).toEqual([3, four.hash]);
  });

  it("whatever the files and their order, a record verifies to the same seq, head and problems as one file in seq order", () => {
    // The oracle is the plainest layout: every line in one file, in seq order. Any other — the
    // lines spread over several month files, each in seq order (the merge) or shuffled (the sorted
    // read again) — must give the same answer, but for where each problem was found.
    const faults = fc.record({
      tampered: fc.option(fc.nat(), { nil: undefined }),
      deleted: fc.option(fc.nat(), { nil: undefined }),
      copied: fc.option(fc.nat(), { nil: undefined }),
      tier4: fc.option(fc.nat(), { nil: undefined }),
      stringSeq: fc.option(fc.nat(), { nil: undefined }),
    });
    const layout = fc.record({
      files: fc.integer({ min: 1, max: 4 }),
      picks: fc.array(fc.nat(), { minLength: 40, maxLength: 40 }),
      shuffled: fc.boolean(),
      order: fc.array(fc.nat(), { minLength: 40, maxLength: 40 }),
    });
    const withoutWhere = (errors: string[]): string[] =>
      errors.map((e) => e.replace(/^logbook[/\\]\d{4}[/\\]\d{2}\.jsonl line \d+: /, "")).sort();
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), faults, layout, (count, f, how) => {
        let lines: Line[] = chained(cycling(count, 3));
        const at = (n: number | undefined): number | undefined =>
          n === undefined ? undefined : n % lines.length;
        const tampered = at(f.tampered);
        if (tampered !== undefined) {
          const line = lines[tampered] as Line;
          lines[tampered] = { ...line, payload: { ...line.payload, text: "changed" } };
        }
        const tier4 = at(f.tier4);
        if (tier4 !== undefined) lines[tier4] = { ...(lines[tier4] as Line), tier: 4 as 1 };
        const stringSeq = at(f.stringSeq);
        if (stringSeq !== undefined) {
          const line = lines[stringSeq] as Line;
          lines[stringSeq] = { ...line, seq: String(line.seq) as unknown as number };
        }
        const copied = at(f.copied);
        if (copied !== undefined) lines.splice(copied, 0, lines[copied] as Line);
        const deleted = at(f.deleted);
        if (deleted !== undefined && lines.length > 1)
          lines = lines.filter((_, i) => i !== deleted);
        const last = lines[lines.length - 1] as Line;

        const oracle = verifyLogbook(record({ "2026/01": lines }, count, String(last.hash)));
        const spread: Record<string, Line[]> = {};
        lines.forEach((line, i) => {
          const month = `2026/0${((how.picks[i] ?? 0) % how.files) + 1}`;
          spread[month] = [...(spread[month] ?? []), line];
        });
        if (how.shuffled) {
          for (const rows of Object.values(spread)) {
            const keys = rows.map((_, i) => how.order[i] ?? 0);
            const sorted = rows.map((row, i) => ({ row, key: keys[i] as number, i }));
            sorted.sort((a, b) => a.key - b.key || a.i - b.i);
            rows.splice(0, rows.length, ...sorted.map((s) => s.row));
          }
        }
        const stats: VerifyStats = { peakHeld: 0 };
        const result = verifyLogbook(record(spread, count, String(last.hash)), stats);
        expect([result.valid, result.lines, result.head]).toEqual([
          oracle.valid,
          oracle.lines,
          oracle.head,
        ]);
        expect(withoutWhere(result.errors)).toEqual(withoutWhere(oracle.errors));
        expect(stats.peakHeld).toBeLessThanOrEqual(Object.keys(spread).length);
        cleanup();
      }),
      { numRuns: 150 },
    );
  }, 60_000);
});

describe("readChain's probe: the hash at one seq and the lines past it, holding none of them (repair tail)", () => {
  /** What a probe saw: the walks begun, the hash at `at`, and each line past it as it was taken. */
  function probe(
    root: string,
    at: number,
  ): { begun: number; headAt: string | undefined; tail: TailLine[]; peakHeld: number } {
    const tail: TailLine[] = [];
    let begun = 0;
    const watch: ChainProbe = {
      at,
      begin: () => {
        begun += 1;
        tail.splice(0);
      },
      tail: (line) => tail.push(line),
    };
    const stats: VerifyStats = { peakHeld: 0 };
    const chain = readChain(root, stats, watch);
    expect(chain.errors).toEqual([]);
    return { begun, headAt: chain.headAt, tail, peakHeld: stats.peakHeld };
  }

  it("names the hash of the line at the seq asked, GENESIS at 0 and nothing past the end, and gives each line past it in seq order with where it lies", () => {
    const lines = chained(cycling(12, 3));
    const last = lines[11] as Line;
    const root = record(placed(lines), last.seq, last.hash);
    const seen = probe(root, 9);
    expect(seen.begun).toBe(1);
    expect(seen.headAt).toBe((lines[8] as Line).hash);
    expect(seen.tail).toEqual(
      lines.slice(9).map((line) => ({
        seq: line.seq,
        where: `${rel(`2026/${line.at.slice(5, 7)}`)} line ${Math.floor((line.seq - 1) / 3) + 1}`,
        hash: line.hash,
        prev: line.prev,
      })),
    );
    expect(seen.peakHeld).toBe(3);
    expect(probe(root, 0)).toMatchObject({ headAt: ZERO_HASH });
    expect(probe(root, 0).tail).toHaveLength(12);
    expect(probe(root, 12)).toMatchObject({ headAt: last.hash, tail: [] });
    expect(probe(root, 13)).toMatchObject({ headAt: undefined, tail: [] });
  });

  it("when a file out of seq order sends the record to the sorted read, begins again, and gives the tail once, in seq order", () => {
    const lines = chained([
      "2026-05-01T10:00:00Z",
      "2026-04-01T10:00:00Z",
      "2026-05-02T10:00:00Z",
      "2026-04-02T10:00:00Z",
      "2026-05-03T10:00:00Z",
    ]);
    const [one, two, three, four, five] = lines as [Line, Line, Line, Line, Line];
    const root = record({ "2026/04": [four, two], "2026/05": [one, three, five] }, 5, five.hash);
    const seen = probe(root, 2);
    expect(seen.begun).toBe(2);
    expect(seen.headAt).toBe(two.hash);
    expect(seen.tail.map((line) => [line.seq, line.where])).toEqual([
      [3, `${rel("2026/05")} line 2`],
      [4, `${rel("2026/04")} line 1`],
      [5, `${rel("2026/05")} line 3`],
    ]);
    expect(seen.peakHeld).toBeLessThanOrEqual(2); // the merge's two files, before it gave way
  });

  it("whatever the files and their order, the hash at the seq asked and the lines past it are those of one file in seq order", () => {
    const layout = fc.record({
      count: fc.integer({ min: 1, max: 30 }),
      at: fc.nat(),
      files: fc.integer({ min: 1, max: 4 }),
      picks: fc.array(fc.nat(), { minLength: 30, maxLength: 30 }),
      shuffled: fc.boolean(),
      order: fc.array(fc.nat(), { minLength: 30, maxLength: 30 }),
    });
    fc.assert(
      fc.property(layout, (how) => {
        const lines = chained(cycling(how.count, 3));
        const last = lines[how.count - 1] as Line;
        const at = how.at % (how.count + 1);
        const spread: Record<string, Line[]> = {};
        lines.forEach((line, i) => {
          const month = `2026/0${((how.picks[i] ?? 0) % how.files) + 1}`;
          spread[month] = [...(spread[month] ?? []), line];
        });
        if (how.shuffled) {
          for (const rows of Object.values(spread)) {
            const sorted = rows.map((row, i) => ({ row, key: how.order[i] ?? 0, i }));
            sorted.sort((a, b) => a.key - b.key || a.i - b.i);
            rows.splice(0, rows.length, ...sorted.map((s) => s.row));
          }
        }
        const without = (seen: ReturnType<typeof probe>) => ({
          headAt: seen.headAt,
          tail: seen.tail.map(({ seq, hash, prev }) => ({ seq, hash, prev })),
        });
        const one = probe(record({ "2026/01": lines }, how.count, last.hash), at);
        const many = probe(record(spread, how.count, last.hash), at);
        expect(without(many)).toEqual(without(one));
        expect(one.headAt).toBe(at === 0 ? ZERO_HASH : (lines[at - 1] as Line).hash);
        expect(one.tail.map((line) => line.seq)).toEqual(lines.slice(at).map((line) => line.seq));
        expect(many.peakHeld).toBeLessThanOrEqual(Object.keys(spread).length);
        cleanup();
      }),
      { numRuns: 150 },
    );
  }, 60_000);

  it("holds one parsed line per month file with a probe as without one: 6 for 600 lines, the whole record past the head", () => {
    const lines = chained(cycling(600, 6));
    const last = lines[599] as Line;
    const root = record(placed(lines), last.seq, last.hash);
    let count = 0;
    const stats: VerifyStats = { peakHeld: 0 };
    const chain = readChain(root, stats, { at: 0, tail: () => (count += 1) });
    expect([chain.count, chain.head, chain.headAt]).toEqual([600, last.hash, ZERO_HASH]);
    expect(count).toBe(600);
    expect(stats.peakHeld).toBe(6);
  });
});
