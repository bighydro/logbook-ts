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

/** The `<day>.txt` and `<day>.json` files beside a fixture: `logbook day` of the reference on it. */
export function expectedDays(root: string): Array<{ day: string; text: string; json: unknown }> {
  const dir = join(root, "expected-day");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".txt"))
    .sort()
    .map((name) => ({
      day: name.slice(0, 10),
      text: readFileSync(join(dir, name), "utf-8"),
      json: JSON.parse(readFileSync(join(dir, `${name.slice(0, 10)}.json`), "utf-8")) as unknown,
    }));
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

/**
 * A synthetic record under a fresh temp folder: the drafts chained in order (SPEC §3), each in the
 * month file of its `at`, and a logbook.json that names the head. Nothing in it is real.
 */
export function writeRecord(drafts: Draft[], timezone = "Europe/Oslo"): string {
  const root = freshLogbook(timezone);
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
  for (const [rel, text] of files) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text, "utf-8");
  }
  writeMeta(root, { ...readMetaFile(root), seq, head: prev });
  return root;
}

/** A window a trips or countries expectation was captured for: the whole record, one year, or a range. */
export interface ExpectedWindow {
  name: string;
  options: { year?: string; since?: string; until?: string };
  text: string;
  json: unknown;
}

/** `all`, `YYYY` or `YYYY-MM-DD..YYYY-MM-DD` as the options `readTrips` and `rollupCountries` take. */
export function windowOptions(name: string): ExpectedWindow["options"] {
  if (name === "all") return {};
  if (/^\d{4}$/.test(name)) return { year: name };
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(name);
  if (m === null) throw new Error(`not a window: ${name}`);
  return { since: m[1] as string, until: m[2] as string };
}

/** The `<window>.txt` and `<window>.json` files of `expected-trips/` or `expected-countries/` beside a fixture. */
export function expectedWindows(root: string, kind: "trips" | "countries"): ExpectedWindow[] {
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
