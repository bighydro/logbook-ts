import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashLine } from "../src/chain.js";
import { canonicalize } from "../src/jcs.js";
import type { Line } from "../src/types.js";

export const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
export const SAMPLE = join(FIXTURES, "sample-logbook");
export const EXPECTED = JSON.parse(readFileSync(join(FIXTURES, "expected.json"), "utf-8")) as {
  format: string;
  seq: number;
  head: string;
};

/** The Level 2 sample: the same week with its tiers 2–3 sealed (SPEC §4, RFC 0029), read keyless here. */
export const SAMPLE_SEALED = join(FIXTURES, "sample-logbook-sealed");
export const EXPECTED_SEALED = JSON.parse(
  readFileSync(join(FIXTURES, "expected-sealed.json"), "utf-8"),
) as { format: string; seq: number; head: string };

const made: string[] = [];

/** A fresh temp folder, removed by `cleanup()`. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "logbook-ts-"));
  made.push(dir);
  return dir;
}

/** A writable copy of the conformance sample. */
export function copySample(): string {
  const dir = join(tempDir(), "sample");
  cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}

/** An empty logbook: logbook.json only, seq 0, head of sixty-four zeros. */
export function freshLogbook(timezone = "Europe/Oslo", format = "logbook/0.2"): string {
  const dir = join(tempDir(), "fresh");
  cpSync(SAMPLE, dir, { recursive: true, filter: (src) => !src.endsWith(".jsonl") });
  rmSync(join(dir, "logbook"), { recursive: true, force: true });
  writeMeta(dir, {
    format,
    owner_id: "00000000-0000-4000-8000-000000000002",
    created_at: "2026-01-01T00:00:00Z",
    timezone,
    seq: 0,
    head: "0".repeat(64),
  });
  return dir;
}

export function readMetaFile(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, "logbook.json"), "utf-8")) as Record<string, unknown>;
}

export function writeMeta(root: string, meta: Record<string, unknown>): void {
  writeFileSync(join(root, "logbook.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
}

export const SAMPLE_MONTH = join("logbook", "2026", "03.jsonl");

export function readLines(root: string, rel = SAMPLE_MONTH): string[] {
  return readFileSync(join(root, rel), "utf-8").split("\n").filter(Boolean);
}

export function writeLines(root: string, lines: string[], rel = SAMPLE_MONTH): void {
  writeFileSync(join(root, rel), `${lines.join("\n")}\n`, "utf-8");
}

/** A writable copy of a fixture's record: `logbook.json`, the month files and what else it holds, without the expected output beside it. */
export function copyFixture(name: string): string {
  const dir = join(tempDir(), name);
  cpSync(join(FIXTURES, name), dir, {
    recursive: true,
    filter: (src) => !src.includes("expected-"),
  });
  return dir;
}

/**
 * The torn record a crash leaves (SPEC §3, truncation): the month file `rel` cut halfway into its
 * last row, and `logbook.json` behind the files, never ahead (SPEC §3, write order), naming the line
 * before the cut. Returns the number of the cut row in its file, and the `seq` and `hash` of the last
 * whole line (0 and sixty-four zeros when the file held one line and it is cut).
 */
export function cutInsideLastLine(
  root: string,
  rel: string,
): { row: number; seq: number; head: string } {
  const file = join(root, rel);
  const bytes = readFileSync(file);
  const text = bytes.toString("utf-8");
  const rows = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  const last = Buffer.from(rows[rows.length - 1] as string, "utf-8");
  const kept = bytes.subarray(0, bytes.length - last.length - (text.endsWith("\n") ? 1 : 0));
  writeFileSync(file, Buffer.concat([kept, last.subarray(0, Math.floor(last.length / 2))]));
  const before =
    rows.length > 1 ? (JSON.parse(rows[rows.length - 2] as string) as Line) : undefined;
  const seq = before ? before.seq : 0;
  const head = before ? String(before.hash) : "0".repeat(64);
  writeMeta(root, { ...readMetaFile(root), seq, head });
  return { row: rows.length, seq, head };
}

export function cleanup(): void {
  while (made.length) {
    const dir = made.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** The `<day>.txt` and `<day>.raw.txt` files beside a fixture: `logbook show` of the reference on it. */
export function expectedShows(root: string): Array<{ day: string; raw: boolean; text: string }> {
  const dir = join(root, "expected-show");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".txt"))
    .sort()
    .map((name) => ({
      day: name.slice(0, 10),
      raw: name.endsWith(".raw.txt"),
      text: readFileSync(join(dir, name), "utf-8"),
    }));
}

/**
 * The reference's Day without its `readiness` block (RFC 0034, the per-class readiness of the
 * day's sources), which this implementation does not read yet (SPEC-QUESTIONS 79): the text
 * without the `readiness` row, the JSON without the key. What is left is compared whole.
 */
export function comparableDayText(text: string): string {
  return text.replace(/^ {2}readiness {5}.*\n/m, "");
}

export function comparableDayJson(json: unknown): unknown {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return json;
  const { readiness: _dropped, ...rest } = json as Record<string, unknown>;
  return rest;
}

/**
 * The `<day>.txt` and `<day>.json` files beside a fixture: `logbook day` of the reference on it, as
 * captured (`raw`) and without the readiness block (`text`, `json`).
 */
export function expectedDays(
  root: string,
): Array<{ day: string; text: string; json: unknown; raw: { text: string; json: unknown } }> {
  const dir = join(root, "expected-day");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".txt"))
    .sort()
    .map((name) => {
      const text = readFileSync(join(dir, name), "utf-8");
      const json = JSON.parse(
        readFileSync(join(dir, `${name.slice(0, 10)}.json`), "utf-8"),
      ) as unknown;
      return {
        day: name.slice(0, 10),
        text: comparableDayText(text),
        json: comparableDayJson(json),
        raw: { text, json },
      };
    });
}

/** The content of one line to write with `writeRecord`: the envelope minus what the chain fills in. */
export interface Draft {
  at: string;
  end?: string | null;
  source: string;
  kind: string;
  tier?: 1 | 2 | 3;
  payload: Record<string, unknown>;
}

/** The drafts chained in order (SPEC §3): the text of each month file by its relative path, the seq and the head. */
function chainDrafts(
  drafts: Draft[],
  timezone: string,
): { files: Map<string, string>; seq: number; head: string } {
  const files = new Map<string, string>();
  let prev = "0".repeat(64);
  let seq = 0;
  for (const draft of drafts) {
    seq += 1;
    const line: Line = {
      id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      seq,
      at: draft.at,
      end: draft.end ?? null,
      tz: timezone,
      source: draft.source,
      kind: draft.kind,
      tier: draft.tier ?? 2,
      payload: draft.payload as Line["payload"],
      recorded_at: "2026-10-01T12:00:00Z",
      prev,
      hash: "",
    };
    line.hash = hashLine(line);
    prev = line.hash;
    const rel = join("logbook", draft.at.slice(0, 4), `${draft.at.slice(5, 7)}.jsonl`);
    files.set(rel, `${files.get(rel) ?? ""}${canonicalize(line)}\n`);
  }
  return { files, seq, head: prev };
}

function writeMonthFiles(root: string, files: Map<string, string>): void {
  for (const [rel, text] of files) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text, "utf-8");
  }
}

/**
 * A synthetic record under a fresh temp folder: the drafts chained in order (SPEC §3), each in the
 * month file of its `at`, and a logbook.json that names the head, beside the sample's places and
 * settings. Nothing in it is real.
 */
export function writeRecord(drafts: Draft[], timezone = "Europe/Oslo"): string {
  const root = freshLogbook(timezone);
  const { files, seq, head } = chainDrafts(drafts, timezone);
  writeMonthFiles(root, files);
  writeMeta(root, { ...readMetaFile(root), seq, head });
  return root;
}

/**
 * The same record with nothing beside it: logbook.json and the month files only, no copy of the
 * sample's folders, so a test that writes hundreds of records (a property) costs a few files each.
 */
export function writeBareRecord(drafts: Draft[], timezone = "Europe/Oslo"): string {
  const root = join(tempDir(), "bare");
  mkdirSync(root);
  const { files, seq, head } = chainDrafts(drafts, timezone);
  writeMonthFiles(root, files);
  writeMeta(root, {
    format: "logbook/0.2",
    owner_id: "00000000-0000-4000-8000-000000000002",
    created_at: "2026-01-01T00:00:00Z",
    timezone,
    seq,
    head,
  });
  return root;
}

/** A window a trips, countries or nights expectation was captured for: the whole record, one year, or a range. */
export interface ExpectedWindow {
  name: string;
  options: { year?: string; since?: string; until?: string };
  text: string;
  json: unknown;
}

/** `all`, `YYYY` or `YYYY-MM-DD..YYYY-MM-DD` as the options `readTrips`, `rollupCountries` and `rollupNights` take. */
export function windowOptions(name: string): ExpectedWindow["options"] {
  if (name === "all") return {};
  if (/^\d{4}$/.test(name)) return { year: name };
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(name);
  if (m === null) throw new Error(`not a window: ${name}`);
  return { since: m[1] as string, until: m[2] as string };
}

/** The `<window>.txt` and `<window>.json` files of `expected-<kind>/` beside a fixture: `trips`, `countries`, `nights` or `people`. */
export function expectedWindows(root: string, kind: string): ExpectedWindow[] {
  const dir = join(root, `expected-${kind}`);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".txt"))
    .sort()
    .map((file) => {
      const name = file.slice(0, -4);
      return {
        name,
        options: windowOptions(name),
        text: readFileSync(join(dir, file), "utf-8"),
        json: JSON.parse(readFileSync(join(dir, `${name}.json`), "utf-8")) as unknown,
      };
    });
}

/** A window `days` output was captured for: the whole record, or `--from`/`--to`. */
export interface ExpectedDays {
  name: string;
  options: { from?: string; to?: string };
  text: string;
  /** One object per line of the JSON Lines output. */
  rows: unknown[];
}

/** `all` or `YYYY-MM-DD..YYYY-MM-DD` as the options `readDayRows` takes. */
export function daysOptions(name: string): ExpectedDays["options"] {
  if (name === "all") return {};
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(name);
  if (m === null) throw new Error(`not a window of days: ${name}`);
  return { from: m[1] as string, to: m[2] as string };
}

/** The `<window>.txt` and `<window>.jsonl` files of `expected-days/` beside a fixture. */
export function expectedDaysWindows(root: string): ExpectedDays[] {
  const dir = join(root, "expected-days");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".txt"))
    .sort()
    .map((file) => {
      const name = file.slice(0, -4);
      return {
        name,
        options: daysOptions(name),
        text: readFileSync(join(dir, file), "utf-8"),
        rows: readFileSync(join(dir, `${name}.jsonl`), "utf-8")
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line) as unknown),
      };
    });
}
