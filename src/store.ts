import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { hashLine, ZERO_HASH } from "./chain.js";
import { canonicalize } from "./jcs.js";
import { FORMAT, type Line, type Meta, type VerifyResult } from "./types.js";
import { uuidV7 } from "./uuid.js";

export class LogbookError extends Error {
  override readonly name = "LogbookError";
}

const META_FILE = "logbook.json";
const LOG_DIR = "logbook";
const YEAR = /^\d{4}$/;
const MONTH_FILE = /^(0[1-9]|1[0-2])\.jsonl$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** Read and minimally check `logbook.json`. Throws LogbookError if it is missing or not JSON. */
export function readMeta(root: string): Meta {
  const file = join(root, META_FILE);
  let text: string;
  try {
    text = readFileSync(file, "utf-8");
  } catch (err) {
    throw new LogbookError(`${file}: cannot read logbook.json (${(err as Error).message})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new LogbookError(`${file}: logbook.json is not JSON (${(err as Error).message})`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LogbookError(`${file}: logbook.json must be a JSON object`);
  }
  return parsed as Meta;
}

function formatError(meta: Meta): string | undefined {
  if (meta.format === FORMAT) return undefined;
  const found = typeof meta.format === "string" ? meta.format : "missing";
  return `logbook.json: format is ${found}; this implementation carries ${FORMAT} only (SPEC §3.1); migrate the record first`;
}

interface Located {
  line: Line;
  where: string;
}

/** Every line from every `logbook/<YYYY>/<MM>.jsonl`, in file order, with parse errors reported. */
function readAllLines(root: string, errors: string[]): Located[] {
  const found: Located[] = [];
  const logDir = join(root, LOG_DIR);
  let years: string[];
  try {
    years = readdirSync(logDir);
  } catch {
    return found; // no record yet: an empty logbook
  }
  for (const year of years.filter((y) => YEAR.test(y)).sort()) {
    const yearDir = join(logDir, year);
    let months: string[];
    try {
      months = readdirSync(yearDir);
    } catch {
      continue; // a file named like a year, not a folder
    }
    for (const month of months.filter((m) => MONTH_FILE.test(m)).sort()) {
      const file = join(yearDir, month);
      const text = readFileSync(file, "utf-8");
      const rows = text.split("\n");
      for (let i = 0; i < rows.length; i++) {
        const raw = (rows[i] as string).replace(/\r$/, "");
        if (raw === "") continue;
        const where = `${join(LOG_DIR, year, month)} line ${i + 1}`;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          errors.push(`${where}: not JSON (${(err as Error).message})`);
          continue;
        }
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          errors.push(`${where}: not a JSON object`);
          continue;
        }
        found.push({ line: parsed as Line, where });
      }
    }
  }
  return found;
}

/** Field checks needed before a line can be hashed at all. Returns problems, empty if none. */
function envelopeErrors(line: Line): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(line.seq) || line.seq < 1) problems.push("seq must be an integer ≥ 1");
  for (const key of ["id", "at", "tz", "source", "kind", "recorded_at"] as const) {
    if (typeof line[key] !== "string") problems.push(`${key} must be a string`);
  }
  if (line.end !== null && line.end !== undefined && typeof line.end !== "string") {
    problems.push("end must be a string or null");
  }
  if (line.tier !== 1 && line.tier !== 2 && line.tier !== 3)
    problems.push("tier must be 1, 2 or 3");
  if (line.payload === null || typeof line.payload !== "object" || Array.isArray(line.payload)) {
    problems.push("payload must be an object");
  } else if (typeof line.payload.schema !== "string") {
    problems.push("payload.schema must be a string");
  }
  if (typeof line.prev !== "string" || !HEX64.test(line.prev))
    problems.push("prev must be 64 hex digits");
  if (typeof line.hash !== "string" || !HEX64.test(line.hash))
    problems.push("hash must be 64 hex digits");
  return problems;
}

/**
 * SPEC §3: take every line from every file, order by seq, check seq, prev, hash, and that
 * logbook.json seq/head match the last line. Refuses any format but logbook/0.2.
 */
export function verifyLogbook(root: string): VerifyResult {
  const meta = readMeta(root);
  const refusal = formatError(meta);
  if (refusal) return { valid: false, lines: 0, head: ZERO_HASH, errors: [refusal] };

  const errors: string[] = [];
  const located = readAllLines(root, errors);

  // A line whose seq is not an integer cannot take its place in the chain; every other
  // envelope problem is reported and the line still chains, so one fault yields one error.
  const chain: Located[] = [];
  for (const item of located) {
    const problems = envelopeErrors(item.line);
    if (!Number.isInteger(item.line.seq)) {
      errors.push(`${item.where}: ${problems.join("; ")}`);
      continue;
    }
    if (problems.length)
      errors.push(`${item.where}: seq ${item.line.seq} — ${problems.join("; ")}`);
    chain.push(item);
  }
  chain.sort((a, b) => a.line.seq - b.line.seq);

  let prev = ZERO_HASH;
  let expectedSeq = 1;
  for (const { line, where } of chain) {
    if (line.seq !== expectedSeq) {
      errors.push(`${where}: seq ${line.seq} — expected seq ${expectedSeq}`);
    }
    if (line.prev !== prev) {
      errors.push(
        `${where}: seq ${line.seq} — prev ${line.prev} does not match previous hash ${prev}`,
      );
    }
    let recomputed: string | undefined;
    try {
      recomputed = hashLine(line);
    } catch (err) {
      errors.push(`${where}: seq ${line.seq} — cannot hash (${(err as Error).message})`);
    }
    if (recomputed !== undefined && line.hash !== recomputed) {
      errors.push(
        `${where}: seq ${line.seq} — hash ${line.hash} does not recompute (got ${recomputed})`,
      );
    }
    prev = String(line.hash);
    expectedSeq = line.seq + 1;
  }

  const lines = chain.length;
  const head = lines ? String((chain[lines - 1] as Located).line.hash) : ZERO_HASH;
  if (meta.seq !== lines)
    errors.push(`logbook.json: seq ${meta.seq} does not match the last line (${lines})`);
  if (meta.head !== head)
    errors.push(`logbook.json: head ${meta.head} does not match the last line (${head})`);

  return { valid: errors.length === 0, lines, head, errors };
}

/** RFC 3339 UTC with second precision, e.g. 2026-03-08T20:00:00Z. */
export function rfc3339(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

export interface AddOptions {
  /** The clock: `at` and `recorded_at`. Defaults to now. */
  now?: Date;
  /** Line id. Defaults to a fresh UUIDv7. */
  id?: string;
}

/**
 * Append one `note/v1` line (tier 2, source manual, tz from logbook.json) and update
 * logbook.json atomically. Refuses a record that is not logbook/0.2 or does not verify.
 */
export function addNote(root: string, text: string, options: AddOptions = {}): Line {
  if (text.trim() === "") throw new LogbookError("nothing to add: the note is empty");
  const meta = readMeta(root);
  const refusal = formatError(meta);
  if (refusal) throw new LogbookError(refusal);
  if (typeof meta.timezone !== "string" || meta.timezone === "") {
    throw new LogbookError("logbook.json: timezone is missing");
  }
  const state = verifyLogbook(root);
  if (!state.valid) {
    throw new LogbookError(
      `refusing to append to a record that does not verify:\n${state.errors.join("\n")}`,
    );
  }

  const now = options.now ?? new Date();
  const stamp = rfc3339(now);
  const line: Line = {
    id: options.id ?? uuidV7(now),
    seq: state.lines + 1,
    at: stamp,
    end: null,
    tz: meta.timezone,
    source: "manual",
    kind: "note",
    tier: 2,
    payload: { schema: "note/v1", text },
    recorded_at: stamp,
    prev: state.head,
    hash: "",
  };
  line.hash = hashLine(line);

  const dir = join(root, LOG_DIR, stamp.slice(0, 4));
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${stamp.slice(5, 7)}.jsonl`), `${canonicalize(line)}\n`, "utf-8");

  writeMetaAtomically(root, { ...meta, seq: line.seq, head: line.hash });
  return line;
}

/** Write to a sibling temp file, then rename over logbook.json; a crash leaves the old file intact. */
function writeMetaAtomically(root: string, meta: Meta): void {
  const target = join(root, META_FILE);
  const tmp = join(root, `.${META_FILE}.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
  renameSync(tmp, target);
}
