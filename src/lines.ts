import { closeSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";
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
  /** The byte in the file at which the row starts. */
  offset: number;
}

const NEWLINE = 0x0a;
const NOTHING = Buffer.alloc(0);

/**
 * The non-blank rows of a `.jsonl` file, one at a time, read a chunk at a time from where the last
 * read stopped. No handle is held between reads — each read opens the file, reads and closes it — so
 * any number of readers can stand open at once, and a file is never held open by one left
 * unfinished. What is held is the bytes read and not yet taken: one chunk, or one row longer than it.
 */
export class RowReader {
  /** The byte in the file of `held[0]`. */
  private start = 0;
  /** Bytes read and not yet taken as rows. */
  private held: Buffer = NOTHING;
  /** Whether a read came back empty: the file has nothing past `held`. */
  private ended = false;
  private row = 0;

  constructor(
    readonly file: string,
    private readonly chunkSize = 64 * 1024,
  ) {}

  /** The next non-blank row, or undefined at the end of the file. */
  next(): Row | undefined {
    let from = 0; // the bytes before it are known to hold no newline
    for (;;) {
      const end = this.held.indexOf(NEWLINE, from);
      if (end === -1 && !this.ended) {
        from = this.held.length;
        this.readMore();
        continue;
      }
      if (end === -1 && this.held.length === 0) return undefined;
      // At the end of the file the bytes after its last `\n` are a row too, one with no newline.
      const newline = end !== -1;
      const length = newline ? end : this.held.length;
      const offset = this.start;
      const raw = this.held.toString("utf8", 0, length).replace(/\r$/, "");
      const taken = newline ? length + 1 : length;
      this.held = this.held.subarray(taken);
      this.start += taken;
      this.row += 1;
      from = 0;
      if (raw.trim() !== "") return { raw, row: this.row, newline, offset };
    }
  }

  /** Read on from byte `offset`, the start of row number `row`; what is already held is not read again. */
  seek(offset: number, row: number): void {
    const into = offset - this.start;
    if (into >= 0 && into <= this.held.length) {
      this.held = this.held.subarray(into);
    } else {
      this.held = NOTHING;
      this.ended = false;
    }
    this.start = offset;
    this.row = row - 1;
  }

  private readMore(): void {
    const chunk = Buffer.alloc(this.chunkSize);
    const fd = openSync(this.file, "r");
    let read: number;
    try {
      read = readSync(fd, chunk, 0, this.chunkSize, this.start + this.held.length);
    } finally {
      closeSync(fd);
    }
    if (read === 0) this.ended = true;
    else
      this.held =
        this.held.length === 0
          ? chunk.subarray(0, read)
          : Buffer.concat([this.held, chunk.subarray(0, read)]);
  }
}

/**
 * The non-blank rows of a `.jsonl` file, read through a fixed buffer so a month of a million
 * lines never sits in memory at once, and no handle is held between reads (`RowReader`).
 */
export function* eachLine(file: string, chunkSize = 64 * 1024): Generator<Row> {
  const reader = new RowReader(file, chunkSize);
  for (let row = reader.next(); row !== undefined; row = reader.next()) yield row;
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
