import { closeSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { pyRepr } from "./pyrepr.js";
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

/** Why a row is not a Line: not JSON at all, JSON that gives a member name twice, or JSON that is not an object. */
export type NotALine = { error: string; reason: "not-json" | "duplicate-key" | "not-object" };

/**
 * One row as a Line, or why it is not one. `where` names the file and row for the message. A row that
 * gives a member name twice in one object, at any depth, is no line (SPEC §2), however the name is
 * spelled: it is named as the reference names it, `<where>: duplicate key 'kind'`.
 */
export function parseLine(raw: string, where: string): { line: Line } | NotALine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { error: `${where}: not JSON (${(err as Error).message})`, reason: "not-json" };
  }
  const twice = duplicateKey(raw);
  if (twice !== undefined) {
    return { error: `${where}: duplicate key ${pyRepr(twice)}`, reason: "duplicate-key" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: `${where}: not a JSON object`, reason: "not-object" };
  }
  return { line: parsed as Line };
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const OPEN_ARRAY = 0x5b;
const CLOSE_ARRAY = 0x5d;
const OPEN_OBJECT = 0x7b;
const CLOSE_OBJECT = 0x7d;

/** An open object's member names so far, and the first of them given again. */
interface OpenObject {
  names: Set<string>;
  twice?: string;
}

/**
 * The first member name `text` gives twice in one object, decoded (`"k\u0069nd"` is `kind`), or
 * undefined when it gives none. `text` is JSON that `JSON.parse` took, which keeps the last of two
 * and so cannot tell. Each object is judged as it closes, innermost first, by the first of its names
 * seen before: the name the reference reports (`{"x":1,"x":{"b":1,"b":2}}` names `b`).
 */
function duplicateKey(text: string): string | undefined {
  const open: Array<OpenObject | null> = []; // null for an open array
  let nameNext = false; // the next string is a member name
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === QUOTE) {
      const end = stringEnd(text, i);
      const top = open[open.length - 1];
      if (nameNext && top) {
        const spelled = text.slice(i + 1, end);
        const name = spelled.includes("\\")
          ? (JSON.parse(text.slice(i, end + 1)) as string)
          : spelled;
        if (top.names.has(name)) top.twice ??= name;
        else top.names.add(name);
        nameNext = false;
      }
      i = end;
    } else if (c === OPEN_OBJECT) {
      open.push({ names: new Set() });
      nameNext = true;
    } else if (c === OPEN_ARRAY) {
      open.push(null);
    } else if (c === CLOSE_OBJECT) {
      const closed = open.pop();
      if (closed?.twice !== undefined) return closed.twice;
    } else if (c === CLOSE_ARRAY) {
      open.pop();
    } else if (c === COMMA) {
      nameNext = open[open.length - 1] != null;
    }
  }
  return undefined;
}

/** The index of the quote that closes the string opening at `start`: the first one not escaped. */
function stringEnd(text: string, start: number): number {
  let end = text.indexOf('"', start + 1);
  for (;;) {
    let slashes = 0;
    while (text.charCodeAt(end - 1 - slashes) === BACKSLASH) slashes += 1;
    if (slashes % 2 === 0) return end;
    end = text.indexOf('"', end + 1);
  }
}
