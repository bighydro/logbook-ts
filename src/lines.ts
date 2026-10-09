import { closeSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Line } from "./types.js";

const LOG_DIR = "logbook";
const YEAR = /^\d{4}$/;
const MONTH_FILE = /^(0[1-9]|1[0-2])\.jsonl$/;

export interface MonthFile {
  year: string;
  /** Two digits, "01" to "12". */
  month: string;
  /** Absolute path. */
  file: string;
  /** `logbook/<YYYY>/<MM>.jsonl`, for messages. */
  rel: string;
}

/** Every `logbook/<YYYY>/<MM>.jsonl` under the root, oldest first. Empty when there is no record yet. */
export function monthFiles(root: string): MonthFile[] {
  const found: MonthFile[] = [];
  const logDir = join(root, LOG_DIR);
  let years: string[];
  try {
    years = readdirSync(logDir);
  } catch {
    return found;
  }
  for (const year of years.filter((y) => YEAR.test(y)).sort()) {
    let names: string[];
    try {
      names = readdirSync(join(logDir, year));
    } catch {
      continue; // a file named like a year, not a folder
    }
    for (const name of names.filter((m) => MONTH_FILE.test(m)).sort()) {
      found.push({
        year,
        month: name.slice(0, 2),
        file: join(logDir, year, name),
        rel: join(LOG_DIR, year, name),
      });
    }
  }
  return found;
}

export interface Row {
  /** The row without its newline or a trailing `\r`. Never empty or blank. */
  raw: string;
  /** 1-based, counting blank rows too. */
  row: number;
  /** Whether the row ended with `\n`. False only for the last row of a file that ends inside it. */
  newline: boolean;
}

/**
 * The non-blank rows of a `.jsonl` file, read through a fixed buffer so a month of a million
 * lines never sits in memory at once. The handle is closed before the generator returns.
 */
export function* eachLine(file: string, chunkSize = 64 * 1024): Generator<Row> {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(chunkSize);
    const decoder = new StringDecoder("utf8");
    let pending = "";
    let row = 0;
    for (;;) {
      const read = readSync(fd, buffer, 0, chunkSize, null);
      const text = read === 0 ? decoder.end() : decoder.write(buffer.subarray(0, read));
      pending += text;
      const parts = pending.split("\n");
      pending = read === 0 ? "" : (parts.pop() as string);
      const last = parts.length - 1;
      for (const [index, part] of parts.entries()) {
        row += 1;
        const raw = part.replace(/\r$/, "");
        // At the end of the file the text after its last `\n` is a row too, one with no newline.
        const newline = !(read === 0 && index === last);
        if (raw.trim() !== "") yield { raw, row, newline };
      }
      if (read === 0) return;
    }
  } finally {
    closeSync(fd);
  }
}

/** Why a row is not a Line: not JSON at all, or JSON that is not an object. */
export type NotALine = { error: string; reason: "not-json" | "not-object" };

/** One row as a Line, or why it is not one. `where` names the file and row for the message. */
export function parseLine(raw: string, where: string): { line: Line } | NotALine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { error: `${where}: not JSON (${(err as Error).message})`, reason: "not-json" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: `${where}: not a JSON object`, reason: "not-object" };
  }
  return { line: parsed as Line };
}
