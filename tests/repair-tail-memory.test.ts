import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsup";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashLine, ZERO_HASH } from "../src/chain.js";
import { canonicalize } from "../src/jcs.js";
import type { Line } from "../src/types.js";

/*
 * A tighter bound on what repair tail keeps of the tail than tests/verify-memory.test.ts asks: that
 * test caps the heap at half a 57 MiB record of 25,000 lines of 2 KiB, which bounds the parsed
 * lines (2 KiB each) but not the rows past the head (`TailLine`: seq, where, hash, prev — some
 * 330 bytes each, 8 MiB for 25,000, well under its 28 MiB cap). Here the lines are short, so the
 * rows are what would weigh: 120,000 of them need more than 32 MiB kept (measured: 39.7 MiB used
 * at a 64 MiB cap; out of memory at 32), and the repair, which keeps twenty, gets by in 8 MiB
 * (5.3 MiB used). The cap is 16 MiB. Synthetic notes about nobody.
 */
const NOTES = 120_000;
const MONTHS = 12;
const CAP_MIB = 16;

const CHILD = `import { readFileSync } from "node:fs";
import { repairTail, verifyLogbook } from "./logbook-ts.mjs";
const root = process.argv[2];
const mib = (bytes) => Math.round((bytes / 1048576) * 10) / 10;
const report = {};
let started = performance.now();
const dry = repairTail(root, { dryRun: true });
report.dry = { count: dry.count, shown: dry.shown.length, written: dry.written, ms: Math.round(performance.now() - started) };
started = performance.now();
const done = repairTail(root);
report.repair = { count: done.count, written: done.written, to: done.to, valid: done.verified.valid, ms: Math.round(performance.now() - started) };
report.heapUsedMiB = mib(process.memoryUsage().heapUsed);
report.peakRssMiB = mib(process.resourceUsage().maxRSS * 1024);
process.stdout.write(JSON.stringify(report));
`;

/** The control: every row past the head kept, as a probe that forgot its bound would keep them. */
const KEEP_CHILD = `import { readChain } from "./verify.mjs";
const root = process.argv[2];
const kept = [];
const chain = readChain(root, { peakHeld: 0 }, { at: 0, begin: () => kept.splice(0), tail: (row) => kept.push(row) });
process.stdout.write(JSON.stringify({ kept: kept.length, errors: chain.errors.length }));
`;

let work: string;
let root: string;
let head: string;

function writeRecord(dir: string): string {
  mkdirSync(join(dir, "logbook", "2025"), { recursive: true });
  const batches = new Map<string, string[]>();
  const flush = (): void => {
    for (const [month, rows] of batches) {
      appendFileSync(join(dir, "logbook", "2025", `${month}.jsonl`), rows.join(""), "utf-8");
    }
    batches.clear();
  };
  let prev = ZERO_HASH;
  for (let i = 0; i < NOTES; i++) {
    const seq = i + 1;
    const month = String((i % MONTHS) + 1).padStart(2, "0");
    const at = `2025-${month}-01T00:00:00Z`;
    const line: Line = {
      id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      seq,
      at,
      end: null,
      tz: "Europe/Oslo",
      source: "manual",
      kind: "note",
      tier: 2,
      payload: { schema: "note/v1", text: `n${seq}` },
      recorded_at: at,
      prev,
      hash: "",
    };
    line.hash = hashLine(line);
    prev = line.hash;
    const rows = batches.get(month) ?? [];
    rows.push(`${canonicalize(line)}\n`);
    batches.set(month, rows);
    if (seq % 6000 === 0) flush();
  }
  flush();
  writeFileSync(
    join(dir, "logbook.json"),
    `${JSON.stringify(
      {
        format: "logbook/0.2",
        owner_id: "00000000-0000-4000-8000-000000000002",
        created_at: "2025-01-01T00:00:00Z",
        timezone: "Europe/Oslo",
        seq: 0,
        head: ZERO_HASH,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  return prev;
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "logbook-ts-repair-memory-"));
  await build({
    entry: {
      "logbook-ts": fileURLToPath(new URL("../src/index.ts", import.meta.url)),
      verify: fileURLToPath(new URL("../src/verify.ts", import.meta.url)),
    },
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
  writeFileSync(join(work, "repair.mjs"), CHILD, "utf-8");
  writeFileSync(join(work, "keep.mjs"), KEEP_CHILD, "utf-8");
  root = join(work, "record");
  mkdirSync(root);
  head = writeRecord(root);
}, 120_000);

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

/**
 * A child is waited for synchronously, which the test's own timeout cannot end: one that has not
 * ended within it is killed, and the test fails saying so, instead of holding the run for ever.
 */
const BOUNDED = { timeout: 110_000, killSignal: "SIGKILL" } as const;

describe("repair tail of a tail of 120,000 short lines, the whole record past the head", () => {
  it(`the control: keeping every row past the head does not fit in ${CAP_MIB} MiB of old space`, () => {
    const child = spawnSync(
      process.execPath,
      [`--max-old-space-size=${CAP_MIB}`, join(work, "keep.mjs"), root],
      { cwd: work, encoding: "utf-8", maxBuffer: 1 << 20, ...BOUNDED },
    );
    expect(child.error, "the child did not end in time").toBeUndefined();
    expect(child.status).not.toBe(0);
    expect(child.stderr).toMatch(/heap out of memory/);
  }, 120_000);

  it(`the dry run and the repair get by in ${CAP_MIB} MiB: the rows past the head are not kept, twenty are listed`, () => {
    const child = spawnSync(
      process.execPath,
      [`--max-old-space-size=${CAP_MIB}`, join(work, "repair.mjs"), root],
      { cwd: work, encoding: "utf-8", maxBuffer: 1 << 20, ...BOUNDED },
    );
    expect(child.error, "the child did not end in time").toBeUndefined();
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
    const report = JSON.parse(child.stdout) as {
      dry: { count: number; shown: number; written: boolean };
      repair: {
        count: number;
        written: boolean;
        to: { seq: number; head: string };
        valid: boolean;
      };
    };
    console.info(
      `repair tail of ${NOTES} short lines, old space capped at ${CAP_MIB} MiB: ${child.stdout}`,
    );
    expect(report.dry).toMatchObject({ count: NOTES, shown: 20, written: false });
    expect(report.repair).toMatchObject({
      count: NOTES,
      written: true,
      to: { seq: NOTES, head },
      valid: true,
    });
  }, 120_000);
});
