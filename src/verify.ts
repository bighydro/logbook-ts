import { hashLine, ZERO_HASH } from "./chain.js";
import { type MonthFile, monthFiles, parseLine, RowReader } from "./lines.js";
import type { Line } from "./types.js";

const HEX64 = /^[0-9a-f]{64}$/;

/** What is said of the last row of a month file a crash cut inside the line being written (SPEC §3, truncation). */
export const CUT_SHORT = "the file ends inside this line (cut short)";

/**
 * Bytes read at a time from a month file while every file stands open — in the merge, and in the
 * second pass of the sorted read — each with up to this much read and not yet taken.
 */
const OPEN_CHUNK = 16 * 1024;

/** How much verify held, so a test can see the memory does not grow with the record. */
export interface VerifyStats {
  /** Parsed lines waiting at once, at the fullest moment: one per month file at most, beside the line being checked. */
  peakHeld: number;
  /**
   * Where a month file was found out of seq order, as `<file> line N: seq S after T`, when one was.
   * The record is valid for that (SPEC §3: file order is not chain order) and was read again sorted.
   */
  unsorted?: string;
}

/** The chain of a record's files: its count and head, and what is wrong with the files and the chain. */
export interface Chain {
  /** Every problem of the files and the chain; what `logbook.json` says is checked apart. */
  errors: string[];
  count: number;
  head: string;
  /**
   * The seq of the last line taken, whose hash is `head`: where the files end, 0 when they hold no
   * line. `count` when the chain holds; when it does not (a second line of one seq, a gap) the two part.
   */
  last: number;
  /**
   * Under a probe, the hash of the first line taken with the seq it asks about: GENESIS for 0,
   * undefined when no line has that seq. Meaningful only when `errors` is empty.
   */
  headAt?: string;
}

/** A line past the seq a probe asks about, as the walk takes it; nothing more of it is kept. */
export interface TailLine {
  seq: number;
  /** `<file> line <row>`, as the chain's problems name a line. */
  where: string;
  hash: string;
  prev: string;
}

/**
 * What a caller asks of the walk besides the chain (`repair tail`): the hash at one seq, and each
 * line past it, one at a time, in seq order. Nothing is gathered for it: memory stays one line per
 * month file. A caller that takes the lines past it takes `begin` too, so it cannot count a line twice.
 */
export type ChainProbe =
  | {
      /** The seq asked about, usually the one `logbook.json` names: a whole number, 0 for none. */
      at: number;
      tail?: undefined;
      begin?: undefined;
    }
  | {
      at: number;
      /** Each line taken with a seq past `at`, in seq order, after its checks. */
      tail: (line: TailLine) => void;
      /**
       * A walk of the chain begins: once for the merge, and once more when a month file out of seq
       * order sends the record to the sorted read, which takes the lines again from the first, so
       * what `tail` was given before is to be dropped.
       */
      begin: () => void;
    };

/**
 * SPEC §3, the files' side: every line of every month file taken in seq order, wherever it was
 * found, and its seq, prev and hash checked. The files are merged as the reference merges them:
 * each stands open with one parsed line, the least seq is taken and its file read on, so memory is
 * one line per month file however long the record. The writer keeps every file in seq order and the
 * merge relies on it; a file that is not is no fault, and the record is then read again in two
 * passes that keep the seq and place of each line and nothing else. The problems are reported in
 * the order they always were: rows that are no line, then each line's envelope, file by file, then
 * the chain in seq order.
 */
export function readChain(
  root: string,
  stats: VerifyStats = { peakHeld: 0 },
  probe?: ChainProbe,
): Chain {
  const months = monthFiles(root);
  return mergedChain(months, stats, probe) ?? sortedChain(months, stats, probe);
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

/** What is wrong with the files, kept apart by kind so they are reported in one order however the files were read. */
class Problems {
  /** Per file, the row that is no line: at most one, since the file is read no further. */
  private readonly unreadable: Array<string | undefined>;
  /** Per file, the envelope problems of its lines, in row order. */
  private readonly envelope: string[][];
  /** The chain's, in seq order. */
  readonly chain: string[] = [];

  constructor(files: number) {
    this.unreadable = Array.from({ length: files }, () => undefined);
    this.envelope = Array.from({ length: files }, () => []);
  }

  noLine(file: number, problem: string): void {
    this.unreadable[file] = problem;
  }

  ofEnvelope(file: number, problem: string): void {
    (this.envelope[file] as string[]).push(problem);
  }

  list(): string[] {
    return [
      ...this.unreadable.filter((p): p is string => p !== undefined),
      ...this.envelope.flat(),
      ...this.chain,
    ];
  }
}

/** A line read from a month file that can take its place in the chain: its seq is an integer. */
interface Found {
  line: Line;
  where: string;
  row: number;
  offset: number;
}

/** A month file being read: its rows read on as its lines are taken. */
class MonthReader {
  private done = false;
  private readonly reader: RowReader;

  constructor(
    readonly index: number,
    private readonly month: MonthFile,
    private readonly problems: Problems,
    chunkSize: number,
  ) {
    this.reader = new RowReader(month.file, chunkSize);
  }

  /**
   * The file's next line that can chain, its envelope problems said; undefined at the end, or at a
   * row that is no line, after which the file is read no further (SPEC §3, truncation; the
   * reference does the same, SPEC-QUESTIONS 81). A last row the file ends inside — no newline, and
   * not JSON — is said plainly, without the parser's position. A line whose seq is not an integer
   * cannot take a place in the chain: it is said and passed by. Every other envelope problem is
   * said and the line still chains, so one fault yields one error.
   */
  next(): Found | undefined {
    while (!this.done) {
      const row = this.reader.next();
      if (row === undefined) break;
      const where = `${this.month.rel} line ${row.row}`;
      const parsed = parseLine(row.raw, where);
      if ("error" in parsed) {
        const cut = !row.newline && parsed.reason === "not-json";
        this.problems.noLine(this.index, cut ? `${where}: ${CUT_SHORT}` : parsed.error);
        break;
      }
      const { line } = parsed;
      const problems = envelopeErrors(line);
      if (!Number.isInteger(line.seq)) {
        this.problems.ofEnvelope(this.index, `${where}: ${problems.join("; ")}`);
        continue;
      }
      if (problems.length)
        this.problems.ofEnvelope(this.index, `${where}: seq ${line.seq} — ${problems.join("; ")}`);
      return { line, where, row: row.row, offset: row.offset };
    }
    this.done = true;
    return undefined;
  }
}

/** The chain checked line by line in seq order, keeping only what the next line is checked against. */
class Walk {
  count = 0;
  head = ZERO_HASH;
  last = 0;
  /** Under a probe, the hash of the line at the seq it asks about (see Chain.headAt). */
  headAt: string | undefined;
  private expectedSeq = 1;

  constructor(
    private readonly errors: string[],
    private readonly probe?: ChainProbe,
  ) {
    if (probe === undefined) return;
    if (probe.at === 0) this.headAt = ZERO_HASH;
    probe.begin?.();
  }

  take(line: Line, where: string): void {
    if (line.seq !== this.expectedSeq) {
      this.errors.push(`${where}: seq ${line.seq} — expected seq ${this.expectedSeq}`);
    }
    if (line.prev !== this.head) {
      this.errors.push(
        `${where}: seq ${line.seq} — prev ${line.prev} does not match previous hash ${this.head}`,
      );
    }
    let recomputed: string | undefined;
    try {
      recomputed = hashLine(line);
    } catch (err) {
      this.errors.push(`${where}: seq ${line.seq} — cannot hash (${(err as Error).message})`);
    }
    if (recomputed !== undefined && line.hash !== recomputed) {
      this.errors.push(
        `${where}: seq ${line.seq} — hash ${line.hash} does not recompute (got ${recomputed})`,
      );
    }
    this.head = String(line.hash);
    this.last = line.seq;
    this.expectedSeq = line.seq + 1;
    this.count += 1;
    const probe = this.probe;
    if (probe === undefined) return;
    if (line.seq === probe.at && this.headAt === undefined) this.headAt = this.head;
    if (line.seq > probe.at) {
      probe.tail?.({ seq: line.seq, where, hash: this.head, prev: String(line.prev) });
    }
  }

  /** The chain walked so far, with what the probe asked. */
  chain(errors: string[]): Chain {
    const chain: Chain = { errors, count: this.count, head: this.head, last: this.last };
    if (this.headAt !== undefined) chain.headAt = this.headAt;
    return chain;
  }
}

/** A file's next line, waiting in the merge. */
interface Waiting extends Found {
  file: MonthReader;
}

/** Whether `a` is taken before `b`: by seq, then by file, so equal seqs come in file order. */
const before = (a: Waiting, b: Waiting): boolean =>
  a.line.seq < b.line.seq || (a.line.seq === b.line.seq && a.file.index < b.file.index);

/**
 * The merge: one line per file in a heap, the least taken and its file read on. Undefined when a
 * file gives a seq below the one before it, for the merge to be no order then.
 */
function mergedChain(
  months: MonthFile[],
  stats: VerifyStats,
  probe: ChainProbe | undefined,
): Chain | undefined {
  const problems = new Problems(months.length);
  const walk = new Walk(problems.chain, probe);
  const heap = new Heap<Waiting>(before);
  for (const [index, month] of months.entries()) {
    const file = new MonthReader(index, month, problems, OPEN_CHUNK);
    const first = file.next();
    if (first !== undefined) heap.push({ ...first, file });
  }
  stats.peakHeld = Math.max(stats.peakHeld, heap.size);
  for (let taken = heap.pop(); taken !== undefined; taken = heap.pop()) {
    walk.take(taken.line, taken.where);
    const next = taken.file.next();
    if (next === undefined) continue;
    if (next.line.seq < taken.line.seq) {
      stats.unsorted = `${next.where}: seq ${next.line.seq} after ${taken.line.seq}`;
      return undefined;
    }
    heap.push({ ...next, file: taken.file });
    stats.peakHeld = Math.max(stats.peakHeld, heap.size);
  }
  return walk.chain(problems.list());
}

/**
 * The sorted read, for a record with a file out of seq order: a first pass keeps the seq, file, row
 * and byte offset of every line that can chain (24 bytes a line) and says what is wrong with each
 * file as the merge does; the places are put in seq order, file order among equal seqs, and a
 * second pass reads each line again where it lies and walks the chain. One line is held at a time.
 */
function sortedChain(
  months: MonthFile[],
  stats: VerifyStats,
  probe: ChainProbe | undefined,
): Chain {
  const problems = new Problems(months.length);
  const walk = new Walk(problems.chain, probe);
  const places = new Places();
  for (const [index, month] of months.entries()) {
    const file = new MonthReader(index, month, problems, 64 * 1024);
    for (let found = file.next(); found !== undefined; found = file.next())
      places.add(found.line.seq, index, found.row, found.offset);
  }
  const readers = months.map((month) => new RowReader(month.file, OPEN_CHUNK));
  for (const at of places.inSeqOrder()) {
    const { seq, file, row, offset } = places.get(at);
    const month = months[file] as MonthFile;
    const reader = readers[file] as RowReader;
    reader.seek(offset, row);
    const where = `${month.rel} line ${row}`;
    const again = reader.next();
    const parsed = again === undefined ? undefined : parseLine(again.raw, where);
    if (parsed === undefined || "error" in parsed || parsed.line.seq !== seq) {
      problems.chain.push(`${where}: the file changed while it was being verified`);
      continue;
    }
    stats.peakHeld = Math.max(stats.peakHeld, 1);
    walk.take(parsed.line, where);
  }
  return walk.chain(problems.list());
}

/** Where each line lies, and nothing else of it: seq, file, row and byte offset in typed arrays. */
class Places {
  private seqs = new Float64Array(1024);
  private offsets = new Float64Array(1024);
  private files = new Uint32Array(1024);
  private rows = new Uint32Array(1024);
  private size = 0;

  add(seq: number, file: number, row: number, offset: number): void {
    if (this.size === this.seqs.length) this.grow();
    this.seqs[this.size] = seq;
    this.offsets[this.size] = offset;
    this.files[this.size] = file;
    this.rows[this.size] = row;
    this.size += 1;
  }

  get(at: number): { seq: number; file: number; row: number; offset: number } {
    return {
      seq: this.seqs[at] as number,
      file: this.files[at] as number,
      row: this.rows[at] as number,
      offset: this.offsets[at] as number,
    };
  }

  /** The places by seq, and in the order they were added (file, then row) among equal seqs. */
  inSeqOrder(): Uint32Array {
    const order = new Uint32Array(this.size);
    for (let i = 0; i < this.size; i++) order[i] = i;
    const seqs = this.seqs;
    return order.sort((a, b) => (seqs[a] as number) - (seqs[b] as number) || a - b);
  }

  private grow(): void {
    const twice = this.seqs.length * 2;
    const seqs = new Float64Array(twice);
    seqs.set(this.seqs);
    this.seqs = seqs;
    const offsets = new Float64Array(twice);
    offsets.set(this.offsets);
    this.offsets = offsets;
    const files = new Uint32Array(twice);
    files.set(this.files);
    this.files = files;
    const rows = new Uint32Array(twice);
    rows.set(this.rows);
    this.rows = rows;
  }
}

/** A binary heap: the item `before` puts first is on top. */
class Heap<T> {
  private readonly items: T[] = [];

  constructor(private readonly before: (a: T, b: T) => boolean) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(items[i] as T, items[parent] as T)) break;
      [items[i], items[parent]] = [items[parent] as T, items[i] as T];
      i = parent;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length === 0 || last === undefined) return top;
    items[0] = last;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let first = i;
      if (left < items.length && this.before(items[left] as T, items[first] as T)) first = left;
      if (right < items.length && this.before(items[right] as T, items[first] as T)) first = right;
      if (first === i) return top;
      [items[i], items[first]] = [items[first] as T, items[i] as T];
      i = first;
    }
  }
}
