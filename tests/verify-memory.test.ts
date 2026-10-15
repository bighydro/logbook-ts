import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsup";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashLine, ZERO_HASH } from "../src/chain.js";
import { canonicalize } from "../src/jcs.js";
import { monthFiles } from "../src/lines.js";
import { verifyLogbook } from "../src/store.js";
import type { Line } from "../src/types.js";

/**
 * The control: a record of 25,000 synthetic notes of about 2 KiB each (some 57 MiB in 38 month
 * files, every fiftieth note backfilled a year back so the files interleave in the chain)
 * is verified, then appended to, by a process of its own that runs the library from a bundle of
 * `src/`, with V8's old space capped at half the record's size. Verify used to keep every parsed
 * line and sort them — it needed 96 MiB of old space for this record, on Node 20 and 22 alike — and
 * `add` verifies before it appends; the merge keeps one line per month file and gets by in 8 MiB.
 * The cap is the bound asserted, with room on both sides: a heap limit is V8's on every platform,
 * where resident memory is the allocator's and the OS's. The child also reports what it measured
 * (peak RSS, heap, time), which the test prints and does not assert.
 */
const NOTES = 25_000;
const TEXT_BYTES = 2_000;

const CHILD = `import { addNote, verifyLogbook } from "./logbook-ts.mjs";
const root = process.argv[2];
const mib = (bytes) => Math.round((bytes / 1048576) * 10) / 10;
const peakRss = () => mib(process.resourceUsage().maxRSS * 1024);
const report = { before: { peakRssMiB: peakRss(), heapMiB: mib(process.memoryUsage().heapUsed) } };
let started = performance.now();
const stats = { peakHeld: 0 };
const verified = verifyLogbook(root, stats);
report.verify = {
  valid: verified.valid,
  lines: verified.lines,
  head: verified.head,
  errors: verified.errors.slice(0, 3),
  peakHeld: stats.peakHeld,
  unsorted: stats.unsorted ?? null,
  ms: Math.round(performance.now() - started),
  peakRssMiB: peakRss(),
};
started = performance.now();
const added = addNote(root, "one more, after 25,000", { now: new Date("2026-10-13T12:00:00Z") });
report.add = { seq: added.seq, ms: Math.round(performance.now() - started), peakRssMiB: peakRss() };
const again = verifyLogbook(root);
report.again = { valid: again.valid, lines: again.lines, head: again.head };
report.heapLimitMiB = mib((await import("node:v8")).getHeapStatistics().heap_size_limit);
process.stdout.write(JSON.stringify(report));
`;

/**
 * The repair of a tail, on the same record: logbook.json set back to seq 0 and GENESIS, so every
 * line is past its head — the most a crash could leave, and a tail of the whole record. The append
 * is refused (TailAhead), the dry run lists twenty lines and counts the rest, the repair brings
 * logbook.json forward, all under the same cap: the repair reads the chain as verify does.
 */
const REPAIR_CHILD = `import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addNote, repairTail, verifyLogbook } from "./logbook-ts.mjs";
const root = process.argv[2];
const mib = (bytes) => Math.round((bytes / 1048576) * 10) / 10;
const peakRss = () => mib(process.resourceUsage().maxRSS * 1024);
const metaFile = join(root, "logbook.json");
const meta = JSON.parse(readFileSync(metaFile, "utf-8"));
writeFileSync(metaFile, JSON.stringify({ ...meta, seq: 0, head: "0".repeat(64) }, null, 2) + "\\n", "utf-8");
const report = {};
try {
  addNote(root, "not past a tail");
  report.add = "appended";
} catch (err) {
  report.add = err.name;
}
let started = performance.now();
const dry = repairTail(root, { dryRun: true });
report.dry = { count: dry.count, shown: dry.shown.length, written: dry.written, ms: Math.round(performance.now() - started), peakRssMiB: peakRss() };
started = performance.now();
const done = repairTail(root);
report.repair = { count: done.count, written: done.written, to: done.to, ms: Math.round(performance.now() - started), peakRssMiB: peakRss() };
const again = verifyLogbook(root);
report.again = { valid: again.valid, lines: again.lines, head: again.head };
report.heapLimitMiB = mib((await import("node:v8")).getHeapStatistics().heap_size_limit);
process.stdout.write(JSON.stringify(report));
`;

let work: string;
let root: string;
let head: string;
let recordBytes = 0;

/** `at` of the i-th note: every 45 minutes from 2024-08-01, every fiftieth a year earlier (from 2023-08). */
function atOf(i: number): string {
  const ms = Date.parse("2024-08-01T00:00:00Z") + i * 45 * 60_000;
  return new Date(i % 50 === 49 ? ms - 365 * 86_400_000 : ms).toISOString().replace(".000Z", "Z");
}

/** The notes chained in order and written month file by month file, a batch at a time: nothing real in them. */
function writeRecord(dir: string): string {
  const filler = "Synthetic note about the harbour in Oslo; nobody here exists. ".repeat(40);
  const batches = new Map<string, string[]>();
  const flush = (): void => {
    for (const [month, rows] of batches) {
      mkdirSync(join(dir, "logbook", month.slice(0, 4)), { recursive: true });
      appendFileSync(
        join(dir, "logbook", month.slice(0, 4), `${month.slice(5, 7)}.jsonl`),
        rows.join(""),
        "utf-8",
      );
    }
    batches.clear();
  };
  let prev = ZERO_HASH;
  for (let i = 0; i < NOTES; i++) {
    const seq = i + 1;
    const at = atOf(i);
    const text = `note ${seq}: ${filler}`.slice(0, TEXT_BYTES);
    const line: Line = {
      id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      seq,
      at,
      end: null,
      tz: "Europe/Oslo",
      source: "manual",
      kind: "note",
      tier: 2,
      payload: { schema: "note/v1", text },
      recorded_at: at,
      prev,
      hash: "",
    };
    line.hash = hashLine(line);
    prev = line.hash;
    const month = at.slice(0, 7);
    const rows = batches.get(month) ?? [];
    rows.push(`${canonicalize(line)}\n`);
    batches.set(month, rows);
    if (seq % 1000 === 0) flush();
  }
  flush();
  writeFileSync(
    join(dir, "logbook.json"),
    `${JSON.stringify(
      {
        format: "logbook/0.2",
        owner_id: "00000000-0000-4000-8000-000000000002",
        created_at: "2024-08-01T00:00:00Z",
        timezone: "Europe/Oslo",
        seq: NOTES,
        head: prev,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  return prev;
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "logbook-ts-memory-"));
  await build({
    entry: { "logbook-ts": fileURLToPath(new URL("../src/index.ts", import.meta.url)) },
    outDir: work,
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
  writeFileSync(join(work, "child.mjs"), CHILD, "utf-8");
  writeFileSync(join(work, "repair.mjs"), REPAIR_CHILD, "utf-8");
  root = join(work, "record");
  mkdirSync(root);
  head = writeRecord(root);
  for (const month of monthFiles(root)) recordBytes += statSync(month.file).size;
}, 120_000);

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("verify and add in a fresh process on 25,000 notes of about 2 KiB", () => {
  it("verify, then add, with the heap capped at half the record: memory does not grow with the record", () => {
    const capMiB = Math.floor(recordBytes / 1048576 / 2);
    expect(capMiB).toBeGreaterThanOrEqual(24); // the record is some 57 MiB: the cap is no toy
    const months = monthFiles(root).length;
    const child = spawnSync(
      process.execPath,
      [`--max-old-space-size=${capMiB}`, join(work, "child.mjs"), root],
      { cwd: work, encoding: "utf-8", maxBuffer: 1 << 20 },
    );
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
    const report = JSON.parse(child.stdout) as {
      verify: { valid: boolean; lines: number; head: string; peakHeld: number; unsorted: null };
      add: { seq: number };
      again: { valid: boolean; lines: number };
    };
    console.info(
      `25,000 notes, ${(recordBytes / 1048576).toFixed(1)} MiB in ${months} month files, old space capped at ${capMiB} MiB: ${child.stdout}`,
    );
    expect(report.verify).toMatchObject({ valid: true, lines: NOTES, head, unsorted: null });
    expect(report.verify.peakHeld).toBeGreaterThan(0);
    expect(report.verify.peakHeld).toBeLessThanOrEqual(months);
    expect(report.add.seq).toBe(NOTES + 1);
    expect(report.again).toMatchObject({ valid: true, lines: NOTES + 1 });
  }, 120_000);

  it("repair tail of a tail the whole record long, after an append it refuses, with the heap capped at half the record: memory does not grow with the tail", () => {
    const capMiB = Math.floor(recordBytes / 1048576 / 2);
    const months = monthFiles(root).length;
    const lines = verifyLogbook(root).lines; // 25,001 after the first test's append, 25,000 alone
    const child = spawnSync(
      process.execPath,
      [`--max-old-space-size=${capMiB}`, join(work, "repair.mjs"), root],
      // Waited for synchronously, which the test's timeout cannot end: killed if it has not ended.
      { cwd: work, encoding: "utf-8", maxBuffer: 1 << 20, timeout: 110_000, killSignal: "SIGKILL" },
    );
    expect(child.error, "the child did not end in time").toBeUndefined();
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
    const report = JSON.parse(child.stdout) as {
      add: string;
      dry: { count: number; shown: number; written: boolean };
      repair: { count: number; written: boolean; to: { seq: number } };
      again: { valid: boolean; lines: number };
    };
    console.info(
      `repair tail of ${lines} lines in ${months} month files, old space capped at ${capMiB} MiB: ${child.stdout}`,
    );
    expect(report.add).toBe("TailAhead");
    expect(report.dry).toMatchObject({ count: lines, shown: 20, written: false });
    expect(report.repair).toMatchObject({ count: lines, written: true, to: { seq: lines } });
    expect(report.again).toMatchObject({ valid: true, lines });
  }, 120_000);
});
