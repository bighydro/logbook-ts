import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { hashLine, ZERO_HASH } from "./chain.js";
import { canonicalize } from "./jcs.js";
import { pyStr } from "./pyrepr.js";
import {
  FORMAT,
  type JsonValue,
  type Line,
  type Meta,
  SEALED_FORMAT,
  type VerifyResult,
} from "./types.js";
import { uuidV7 } from "./uuid.js";
import { CUT_SHORT, readChain, type TailLine, type VerifyStats } from "./verify.js";

export type { TailLine, VerifyStats } from "./verify.js";

export class LogbookError extends Error {
  override readonly name: string = "LogbookError";
}

/** Another writer holds the record's lock and the caller chose not to wait. Nothing was written. */
export class WriterBusy extends LogbookError {
  override readonly name: string = "WriterBusy";
}

/**
 * `logbook.json` moved between the read a line was chained from and the write: a writer that did
 * not take the lock, or took it over wrongly. Nothing was written.
 */
export class HeadMoved extends LogbookError {
  override readonly name: string = "HeadMoved";
}

/**
 * The files end past `logbook.json`, or at its seq under another head, or a month file ends inside
 * its last line: what a crash between a line and `logbook.json`, or inside the line, leaves (SPEC §3,
 * write order and truncation), or a record that only looks like it. A writer refuses, writing
 * nothing, in one sentence naming `repair tail`; the CLI says it as it says a moved head, one line
 * and exit 2, as the reference's does. Not a HeadMoved: reading the head again and retrying, the
 * answer to a head that moved, never mends this.
 */
export class TailAhead extends LogbookError {
  override readonly name: string = "TailAhead";
}

/** `repair tail` would not bring `logbook.json` forward over what the files hold. Nothing was changed. */
export class RepairRefused extends LogbookError {
  override readonly name: string = "RepairRefused";
}

const META_FILE = "logbook.json";
const LOG_DIR = "logbook";
const STATE_DIR = "state";
const LOCK_FILE = "writer.lock";
const RECLAIM_FILE = "writer.lock.reclaim";
/** How often a waiting writer reads the lock again. */
const POLL_MS = 100;
/**
 * Rule A's half second. A lock that names no holder is a writer between its create and its write
 * until it has named none, read after read, for this long, and its mtime is this far past; then it
 * is a leftover of a crash. The reference reads such a lock, sleeps half a second, reads it again.
 */
const GRACE_MS = 500;
/** How long Windows' refusal of a file another process holds open is waited out (patientOnWindows). */
const IN_USE_MS = 5000;
/**
 * The second this process started (`process.uptime` is the process's, in a worker thread too): a
 * lock naming this pid and dated before it was written by an earlier process given the same pid.
 */
const STARTED_SECOND = Math.floor((Date.now() - process.uptime() * 1000) / 1000) * 1000;

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

/**
 * Why this record cannot be read, or undefined when it can: its format is the one carried here, or
 * logbook/0.3, which hashes by the same rule (SPEC §3.1). A 0.1 record must be migrated forward.
 */
export function formatRefusal(meta: Meta): string | undefined {
  if (meta.format === FORMAT || meta.format === SEALED_FORMAT) return undefined;
  const found = typeof meta.format === "string" ? meta.format : "missing";
  return `logbook.json: format is ${found}; this implementation carries ${FORMAT} (and reads ${SEALED_FORMAT}) only (SPEC §3.1); migrate the record first`;
}

/**
 * Why this record cannot be written to, or undefined when it can. A logbook/0.3 record that names
 * recipients seals every tier 2–3 line (SPEC §2, §4), which nothing here can do; one that names none
 * is written plain, as a 0.2 record is.
 */
export function writeRefusal(meta: Meta): string | undefined {
  const refusal = formatRefusal(meta);
  if (refusal) return refusal;
  if (
    meta.format === SEALED_FORMAT &&
    Array.isArray(meta.recipients) &&
    meta.recipients.length > 0
  ) {
    return `logbook.json: the record names recipients, so every tier 2–3 line is sealed (SPEC §4); this implementation cannot seal and appends nothing to it`;
  }
  return undefined;
}

/**
 * SPEC §3: take every line from every file in seq order, check seq, prev, hash, and that
 * logbook.json seq/head match the last line. Reads logbook/0.2 and logbook/0.3, which hash by
 * one rule; a sealed line's `payload_enc` is outside the hash and is never opened here. The month
 * files are streamed (`readChain`): memory is one line per month file, not the record; `stats`
 * says how much was held.
 */
export function verifyLogbook(root: string, stats?: VerifyStats): VerifyResult {
  const meta = readMeta(root);
  const refusal = formatRefusal(meta);
  if (refusal) return { valid: false, lines: 0, head: ZERO_HASH, errors: [refusal] };
  const chain = readChain(root, stats);
  const errors = [...chain.errors, ...metaErrors(meta, chain.count, chain.head)];
  return { valid: errors.length === 0, lines: chain.count, head: chain.head, errors };
}

/** SPEC §3, the last rule: `logbook.json` seq/head match the last line, or 0 and GENESIS when there is none. */
function metaErrors(meta: Meta, count: number, head: string): string[] {
  const errors: string[] = [];
  if (meta.seq !== count)
    errors.push(`logbook.json: seq ${meta.seq} does not match the last line (${count})`);
  if (meta.head !== head)
    errors.push(`logbook.json: head ${meta.head} does not match the last line (${head})`);
  return errors;
}

/** RFC 3339 UTC with second precision, e.g. 2026-03-08T20:00:00Z. */
export function rfc3339(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

export interface WriterLockOptions {
  /**
   * Wait for another writer to finish (the default; a line says so once), or refuse at once with
   * WriterBusy, as the reference's `--no-wait` does.
   */
  wait?: boolean;
  /** What the lock names as its holder, for another writer's message. Defaults to `logbook-ts add`. */
  command?: string;
  /** Where one-line notices go: waiting for another writer, taking over a stale lock. */
  say?: (line: string) => void;
}

/** What `state/writer.lock` holds when it names a holder: a JSON object, whatever is in it. */
type Holder = { [key: string]: JsonValue };

/** A lock file (or the reclaim file) as read on one handle: its bytes and what says it is this file. */
interface Sighting {
  text: string;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
}

/** What a writer says, and under `--no-wait` refuses with, while the lock names no holder and is young. */
const NO_HOLDER_LOCK =
  "another logbook command is taking the lock on this record (state/writer.lock names no holder yet; if none is running, remove it)";
const NO_HOLDER_RECLAIM =
  "another logbook command is taking over a stale lock on this record (state/writer.lock.reclaim names no holder yet; if none is running, remove it)";

/** The locks this thread holds now, by file, with the bytes it wrote: a second take of one is refused. */
const held = new Map<string, string>();

/** Block the thread for `ms`; the lock is taken synchronously, as everything here is. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn`, and on Windows run it again while it fails with EPERM, EACCES or EBUSY, for up to
 * IN_USE_MS. Windows refuses to replace a file another process has open (the rename of
 * `logbook.json` while another writer reads it, before it takes the lock), and Node 20 (libuv before
 * 1.49) removes a file another process has open only when that handle closes, so until then its
 * name can be neither opened nor made again (the lock a waiting writer was reading the moment its
 * holder removed it); a reader that does not share delete (Python's `open`) makes an unlink fail.
 * Each lasts as long as the other process's read; a refusal that outlasts the bound is a real one
 * and is thrown. Elsewhere these errors are real at once.
 */
function patientOnWindows<T>(fn: () => T): T {
  if (process.platform !== "win32") return fn();
  const end = Date.now() + IN_USE_MS;
  for (;;) {
    try {
      return fn();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") || Date.now() >= end) {
        throw err;
      }
      sleep(10);
    }
  }
}

/** Whether a process with this pid exists. Signal 0 tests without sending; EPERM means it exists and is not ours. */
function alive(pid: number | undefined): boolean {
  if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The pid a holder names as the reference reads it: a whole number (Python's `true` and `false`
 * being the ints 1 and 0); anything else, a string of digits among them, names none.
 */
function pidOf(holder: Holder): number | undefined {
  const pid = holder.pid;
  if (pid === true) return 1;
  if (pid === false) return 0;
  return typeof pid === "number" && Number.isInteger(pid) ? pid : undefined;
}

/**
 * Whether a holder may still be writing: its pid names a living process. This process's own pid
 * names a leftover of an earlier process given the same pid when the lock is dated before this
 * process started, as the reference reads it; dated since, it may be another thread's, and is waited for.
 */
function mayHold(holder: Holder): boolean {
  const pid = pidOf(holder);
  if (pid !== process.pid) return alive(pid);
  const since = typeof holder.since === "string" ? Date.parse(holder.since) : Number.NaN;
  return !Number.isNaN(since) && since >= STARTED_SECOND;
}

/** A field of a holder as the reference prints it: `?` when it is missing, `None` for null, Python's str() else. */
function field(holder: Holder, key: string): string {
  return holder[key] === undefined ? "?" : pyStr(holder[key]);
}

/**
 * The holder a lock's bytes name, or undefined when they name none: empty, cut short, not JSON, or
 * JSON that is not an object. A JSON object names a holder whatever it holds, as the reference
 * reads it (`{}` is a holder whose pid is None, so one whose process is gone).
 */
function parseHolder(text: string): Holder | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Holder;
  } catch {
    // names no holder (yet)
  }
  return undefined;
}

/**
 * A file's bytes, inode, size and mtime, read on one handle so they are of one file; undefined when
 * there is no such file.
 */
function look(file: string): Sighting | undefined {
  let fd: number;
  try {
    fd = patientOnWindows(() => openSync(file, "r"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new LogbookError(`${file}: cannot read the writer lock (${(err as Error).message})`);
  }
  try {
    const stat = fstatSync(fd, { bigint: true });
    // A folder by the lock's name opens for reading (on Windows as well, where Node opens folders),
    // and is no lock: said, never read as an empty one, which rule A would then try to remove.
    if (!stat.isFile()) {
      throw new LogbookError(`${file}: cannot read the writer lock (it is not a file)`);
    }
    const bytes = Buffer.alloc(Number(stat.size));
    let got = 0;
    while (got < bytes.length) {
      const n = readSync(fd, bytes, got, bytes.length - got, got);
      if (n === 0) break;
      got += n;
    }
    return {
      text: bytes.subarray(0, got).toString("utf-8"),
      ino: stat.ino,
      size: stat.size,
      mtimeNs: stat.mtimeNs,
    };
  } catch (err) {
    if (err instanceof LogbookError) throw err;
    throw new LogbookError(`${file}: cannot read the writer lock (${(err as Error).message})`);
  } finally {
    closeSync(fd);
  }
}

/** Whether two sightings are of one file, unchanged between them. */
function same(a: Sighting, b: Sighting): boolean {
  return a.text === b.text && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs;
}

/**
 * Rule A, the owner's decision of 15 October: a lock that names no holder is a writer between its
 * create and its write (the reference makes its lock so) until half a second has passed since it was
 * made, by its mtime, and then a leftover of a crash, to be removed and taken. The reference's own
 * steps are kept too: the same file, read again and again, must have named no holder for that half
 * second, so one replaced or touched meanwhile starts it over. Both, before it is a leftover. An
 * mtime ahead of the clock (another machine's, on a shared folder) is a lock not yet half a second
 * old until the clock passes it.
 */
class NoHolder {
  private watching: { sighting: Sighting; since: number } | undefined;
  private first: number | undefined;

  constructor(private readonly sentence: string) {}

  /**
   * Judge a sighting of a file that names no holder: true when it is a leftover; otherwise false,
   * once the writer has said, or under `wait: false` refused, that it waits for whoever is making it.
   */
  leftover(sighting: Sighting, wait: boolean, once: (line: string) => void): boolean {
    const now = performance.now();
    this.first ??= now;
    if (this.watching === undefined || !same(this.watching.sighting, sighting))
      this.watching = { sighting, since: now };
    const watched = now - this.watching.since >= GRACE_MS;
    const made = Number(sighting.mtimeNs / 1_000_000n);
    if (watched && Date.now() - made >= GRACE_MS) return true;
    if (now - this.first >= GRACE_MS) {
      if (!wait) throw new WriterBusy(this.sentence);
      once(`${this.sentence}; waiting`);
    }
    return false;
  }

  /** The file names a holder now, or is gone: the next one that names none is judged afresh. */
  reset(): void {
    this.watching = undefined;
    this.first = undefined;
  }
}

function unlinkQuietly(file: string): void {
  try {
    patientOnWindows(() => unlinkSync(file));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/**
 * Remove `file` only while it is still the one `seen`: read again on one handle right before the
 * unlink. Returns whether it was removed.
 */
function removeIfSame(file: string, seen: Sighting): boolean {
  const now = look(file);
  if (now === undefined || !same(now, seen)) return false;
  unlinkQuietly(file);
  return true;
}

/**
 * `path` was refused as existing by a create, or as missing by an open: a symbolic link to nowhere
 * is both at once, which no retry mends, so it is said instead of looped on.
 */
function refuseDangling(path: string): void {
  let link = false;
  try {
    link = lstatSync(path).isSymbolicLink();
  } catch {
    return;
  }
  if (!link || existsSync(path)) return;
  throw new LogbookError(
    `${path}: cannot take the writer lock (it is a link to nowhere; remove it)`,
  );
}

/**
 * The lock's real path, one key for every spelling of the record (through a symlink, in another
 * case on a case-folding filesystem): what `held` is kept by, so that a second take in the thread
 * that holds the lock is refused by whatever path it names the record.
 */
function lockKey(dir: string): string {
  try {
    return join(realpathSync.native(dir), LOCK_FILE);
  } catch {
    return resolve(dir, LOCK_FILE);
  }
}

/** Remove a file of this process's own that no one else names, if it can be removed now. */
function removeIfPossible(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    // gone already, or held open for a moment by a reader on Windows: a stray temp file, no more
  }
}

/** Make `state/` in the record folder, which must exist: a folder that is no record gets nothing. */
function makeStateDir(dir: string): void {
  try {
    mkdirSync(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return;
    throw new LogbookError(
      `${dir}: cannot make the folder for the writer lock (${(err as Error).message})`,
    );
  }
}

function cannotTake(file: string, err: unknown): LogbookError {
  return new LogbookError(`${file}: cannot take the writer lock (${(err as Error).message})`);
}

/**
 * Create `file` holding `text` in one step, or return false when it already exists. The text is
 * written and fsynced to a temp file of this process beside it, which is then hard-linked to the
 * name: `link`, like the exclusive create (`O_EXCL`) the reference makes its lock with, fails when
 * the name exists, so of two writers racing for it, of either implementation, exactly one gets it,
 * and the file appears with its holder in it, never empty or cut short. A rename would not do: it
 * replaces a name that exists, on every platform Node runs on. A filesystem that cannot link (FAT,
 * some network shares; and a link Windows still refuses after IN_USE_MS) gets the reference's own
 * two steps, the create and then the write, whose moment of an empty lock rule A waits out. A
 * folder that vanished meanwhile (a release removes an empty `state/`) is made again.
 */
function createExclusively(file: string, text: string): boolean {
  const dir = dirname(file);
  const temp = join(dir, `${basename(file)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  let fd: number;
  try {
    fd = openSync(temp, "wx");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      makeStateDir(dir);
      refuseDangling(dir);
      return false;
    }
    throw cannotTake(file, err);
  }
  try {
    try {
      writeSync(fd, text, null, "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    removeIfPossible(temp);
    throw cannotTake(file, err);
  }
  try {
    patientOnWindows(() => linkSync(temp, file));
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      refuseDangling(file);
      return false;
    }
    if (code === "ENOENT") {
      makeStateDir(dir);
      refuseDangling(dir);
      return false;
    }
    return createInTwoSteps(file, text);
  } finally {
    removeIfPossible(temp);
  }
}

/** The reference's way, where `link` is not to be had: the exclusive create, then the write. */
function createInTwoSteps(file: string, text: string): boolean {
  let fd: number;
  try {
    fd = patientOnWindows(() => openSync(file, "wx"));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      refuseDangling(file);
      return false;
    }
    if (code === "ENOENT") {
      makeStateDir(dirname(file));
      refuseDangling(dirname(file));
      return false;
    }
    throw cannotTake(file, err);
  }
  let written: { ino: bigint; nlink: bigint };
  try {
    try {
      writeSync(fd, text, null, "utf-8");
      fsyncSync(fd);
      written = fstatSync(fd, { bigint: true });
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    // The holder could not be written (a full disk): the empty lock this writer made is removed,
    // not left for another to wait out.
    removeIfPossible(file);
    throw cannotTake(file, err);
  }
  // Held between the two steps for longer than rule A's half second, this lock was a leftover to
  // another writer, which removed it: the holder went into a file with no name. Not held, then; the
  // caller reads the lock again and finds that writer's, or none. On POSIX the file's links are
  // down to none; Windows before libuv 1.49 (Node 20) keeps a removed file's name, its links at
  // one, while a handle holds it, and frees it at the close. The name is read once closed, and is
  // this writer's only while it is the same file holding this holder: a freed inode number is
  // soon given again, to the other writer's lock as soon as any.
  if (written.nlink === 0n) return false;
  const now = look(file);
  return now !== undefined && now.ino === written.ino && now.text === text;
}

/** What a take of the lock carries from one read to the next. */
interface Take {
  wait: boolean;
  once: (line: string) => void;
  /** Rule A for `writer.lock`, and for the reclaim file. */
  lock: NoHolder;
  reclaim: NoHolder;
  /** When this writer first found the reclaim file held by a living process, while it still is. */
  reclaimHeld: number | undefined;
}

/**
 * Take the reclaim file, `state/writer.lock.reclaim`, holding this pid, or return false (after a
 * poll when another writer is in the middle of a reclaim): the caller reads the lock again either
 * way. A reclaim whose pid is gone is cleared; one naming this pid is another thread's, unless it
 * was made before this process started; one that names no pid is held to rule A, as the lock is.
 */
function takeReclaim(dir: string, take: Take): boolean {
  const file = join(dir, RECLAIM_FILE);
  if (createExclusively(file, String(process.pid))) {
    take.reclaimHeld = undefined;
    return true;
  }
  const seen = look(file);
  if (seen === undefined) return false;
  if (/^[1-9][0-9]*$/.test(seen.text)) {
    take.reclaim.reset();
    const pid = Number(seen.text);
    const mine = pid === process.pid && Number(seen.mtimeNs / 1_000_000n) >= STARTED_SECOND;
    if (mine || (pid !== process.pid && alive(pid))) {
      // A reclaim takes a moment. One held for half a second is a reclaimer that is stopped, or a
      // leftover whose pid another process was given: waited for with a word, as a lock's holder
      // is, or refused under `wait: false` — never polled in silence for as long as that pid lives.
      take.reclaimHeld ??= performance.now();
      if (performance.now() - take.reclaimHeld >= GRACE_MS) {
        const who = `another logbook command is taking over a stale lock on this record (state/writer.lock.reclaim names pid ${pid})`;
        if (!take.wait) throw new WriterBusy(who);
        take.once(`${who}; waiting`);
      }
      sleep(POLL_MS);
      return false;
    }
    take.reclaimHeld = undefined;
    removeIfSame(file, seen);
    return false;
  }
  take.reclaimHeld = undefined;
  if (take.reclaim.leftover(seen, take.wait, take.once)) removeIfSame(file, seen);
  else sleep(POLL_MS);
  return false;
}

/**
 * Remove the lock, and only the one `seen` — a holder whose process is gone, or a leftover that
 * names none: under the reclaim file, so that two writers that both judged it cannot remove,
 * between them, the lock a third writer took the moment the first had cleared the old one; and read
 * again on one handle right before the unlink, so a lock replaced or written since it was judged is
 * left alone. Returns whether the lock `seen` was removed; the caller reads the lock again
 * afterwards, whatever happened.
 */
function reclaim(dir: string, seen: Sighting, take: Take): boolean {
  if (!takeReclaim(dir, take)) return false;
  const guard = join(dir, RECLAIM_FILE);
  try {
    return removeIfSame(join(dir, LOCK_FILE), seen);
  } finally {
    if (look(guard)?.text === String(process.pid)) unlinkQuietly(guard);
  }
}

/**
 * Take `state/writer.lock` in the record folder, as the reference does (one writer at a time): the
 * file names the holder's `pid`, `command` and `since`, and appears with them in it (see
 * createExclusively). A lock that names a holder whose process lives is waited for, with one line
 * saying so, or refused at once with WriterBusy when `wait` is false, however old its `since`: the
 * reference reclaims by the pid alone. A holder whose pid is gone, or is not a positive whole number,
 * or is this process's own from before it started, is taken over, with one line saying so. A lock
 * that names no holder (empty, cut short, not a JSON object) is held to rule A (NoHolder): read
 * again until it is a leftover, then removed without a word and taken, as the reference removes it.
 * Readers never take it. The lock is the courtesy between writers; what keeps the chain whole is
 * that a writer reads `logbook.json` again before it writes (HeadMoved). Returns the release, which
 * removes the lock only while it is still this writer's.
 */
export function takeWriterLock(root: string, options: WriterLockOptions = {}): () => void {
  const { wait = true, command = "logbook-ts add", say } = options;
  const dir = join(root, STATE_DIR);
  const file = join(dir, LOCK_FILE);
  makeStateDir(dir);
  const key = lockKey(dir);
  const mine = JSON.stringify({ pid: process.pid, command, since: rfc3339(new Date()) });
  const said = new Set<string>();
  const take: Take = {
    wait,
    once: (line) => {
      if (said.has(line)) return;
      said.add(line);
      say?.(line);
    },
    lock: new NoHolder(NO_HOLDER_LOCK),
    reclaim: new NoHolder(NO_HOLDER_RECLAIM),
    reclaimHeld: undefined,
  };
  for (;;) {
    // Read first, so a writer waiting out a long hold polls by reading, not by making temp files.
    const seen = look(file);
    if (seen === undefined) {
      take.lock.reset();
      if (createExclusively(file, mine)) break;
      // Made meanwhile by another writer: read again, after a poll, never in a spin.
      sleep(POLL_MS);
      continue;
    }
    if (seen.text === held.get(key)) {
      throw new LogbookError(
        `${file}: this writer holds the lock on this record already; a second take would wait on itself`,
      );
    }
    const holder = parseHolder(seen.text);
    if (holder === undefined) {
      if (take.lock.leftover(seen, wait, take.once)) reclaim(dir, seen, take);
      else sleep(POLL_MS);
      continue;
    }
    take.lock.reset();
    if (mayHold(holder)) {
      const who = `another logbook command is writing to this record (${field(holder, "command")}, since ${field(holder, "since")})`;
      if (!wait) throw new WriterBusy(who);
      take.once(`${who}; waiting`);
      sleep(POLL_MS);
      continue;
    }
    // Said once it is taken over, not before: a take refused after all (the reclaim file, under
    // `wait: false`) would otherwise have said it took what it left.
    if (reclaim(dir, seen, take)) {
      take.once(
        `a stale lock from ${field(holder, "command")} (pid ${pyStr(holder.pid)}, since ${field(holder, "since")}) whose process is gone; taking it over`,
      );
    }
  }
  held.set(key, mine);
  return () => {
    held.delete(key);
    // Only the lock this writer holds: one another writer holds by then is left to it, as the
    // reference leaves it. One that cannot be read back is not this writer's; a release never
    // throws over what the writer itself threw.
    let ours = false;
    try {
      ours = look(file)?.text === mine;
    } catch {
      // unreadable: left as it is
    }
    if (ours) unlinkQuietly(file);
    try {
      rmdirSync(dir); // only when nothing else lives in state/, as the reference leaves it
    } catch {
      // not empty, or already gone
    }
  };
}

/** Run `fn` holding the writer lock, released however `fn` ends. */
export function withWriterLock<T>(root: string, fn: () => T, options: WriterLockOptions = {}): T {
  const release = takeWriterLock(root, options);
  try {
    return fn();
  } finally {
    release();
  }
}

/** The lock options among a caller's options, without the keys it left undefined. */
function lockOptions(options: WriterLockOptions): WriterLockOptions {
  const lock: WriterLockOptions = {};
  if (options.wait !== undefined) lock.wait = options.wait;
  if (options.command !== undefined) lock.command = options.command;
  if (options.say !== undefined) lock.say = options.say;
  return lock;
}

export interface AddOptions extends WriterLockOptions {
  /** The clock: `at` and `recorded_at`. Defaults to now. */
  now?: Date;
  /** Line id. Defaults to a fresh UUIDv7. */
  id?: string;
}

/**
 * Append one `note/v1` line (tier 2, source manual, tz from logbook.json) and bring logbook.json
 * forward, in the SPEC §3 write order: the line flushed and fsynced to its month file first, then
 * logbook.json written to a temporary file, fsynced and renamed into place. The whole of it holds
 * the writer lock, and `logbook.json` is read again right before the write and the append refused
 * (HeadMoved) when it moved. Refuses a record that is not logbook/0.2 or logbook/0.3 without
 * recipients, or that does not verify.
 */
export function addNote(root: string, text: string, options: AddOptions = {}): Line {
  if (text.trim() === "") throw new LogbookError("nothing to add: the note is empty");
  // Refused before the lock is taken, so a folder that is no record, or one this implementation
  // cannot write to, gets no state/ folder; read again under the lock, where it counts.
  const refusal = writeRefusal(readMeta(root));
  if (refusal) throw new LogbookError(refusal);
  return withWriterLock(root, () => appendNote(root, text, options), lockOptions(options));
}

/** The append, under the lock. */
function appendNote(root: string, text: string, options: AddOptions): Line {
  const meta = readMeta(root);
  const refusal = writeRefusal(meta);
  if (refusal) throw new LogbookError(refusal);
  if (typeof meta.timezone !== "string" || meta.timezone === "") {
    throw new LogbookError("logbook.json: timezone is missing");
  }
  const chain = readChain(root);
  // The shapes a crash leaves are refused in the reference's one sentence each, naming repair tail,
  // whatever else is wrong with the record (its `add` looks at where the files end, no further): a
  // month file cut inside its last line, then the files ending past logbook.json or at its seq under
  // another head. Anything else that does not verify is refused with every problem listed.
  const cut = chain.errors.find((error) => error.endsWith(`: ${CUT_SHORT}`));
  if (cut !== undefined) {
    throw new TailAhead(`${cut}; nothing was written: run \`logbook-ts repair tail\``);
  }
  const lag = tailAhead(meta, chain.last, chain.head);
  if (lag !== undefined) throw new TailAhead(lag);
  const behind = metaErrors(meta, chain.count, chain.head);
  const errors = [...chain.errors, ...behind];
  if (errors.length > 0) {
    throw new LogbookError(
      `refusing to append to a record that does not verify:\n${errors.join("\n")}`,
    );
  }

  const now = options.now ?? new Date();
  const stamp = rfc3339(now);
  const line: Line = {
    id: options.id ?? uuidV7(now),
    seq: chain.count + 1,
    at: stamp,
    end: null,
    tz: meta.timezone,
    source: "manual",
    kind: "note",
    tier: 2,
    payload: { schema: "note/v1", text },
    recorded_at: stamp,
    prev: chain.head,
    hash: "",
  };
  line.hash = hashLine(line);

  // The guard behind the courtesy of the lock: a writer that did not take it, or took it over
  // wrongly, moved the head since the line was chained; then nothing is written.
  const again = readMeta(root);
  if (again.seq !== meta.seq || again.head !== meta.head) {
    throw new HeadMoved(
      `the record's head moved while the line was being prepared: logbook.json named seq ${meta.seq}, head ${meta.head}, and names seq ${again.seq}, head ${again.head} now; nothing was written`,
    );
  }

  appendLine(root, stamp, `${canonicalize(line)}\n`);
  // From the read under the lock, so a key another program changed meanwhile is kept.
  writeMetaDurably(root, { ...again, seq: line.seq, head: line.hash });
  return line;
}

/** A hash as the reference prints it in a sentence: twelve hex digits and an ellipsis. */
function short(hash: unknown): string {
  return `${String(hash).slice(0, 12)}…`;
}

/** Whether `logbook.json` names a seq and a head at all: a whole number from 0, and 64 hex digits. */
function namesAHead(meta: Meta): boolean {
  return (
    typeof meta.seq === "number" &&
    Number.isInteger(meta.seq) &&
    meta.seq >= 0 &&
    typeof meta.head === "string" &&
    /^[0-9a-f]{64}$/.test(meta.head)
  );
}

/**
 * The reference's sentence for a record whose files end — at the seq of their last line, `last`,
 * and its hash — past `logbook.json`, or at its seq under another head; undefined when they end where
 * it says, or before it (no crash leaves that), and when it names no seq and head. Its words, but for
 * the program it names.
 */
function tailAhead(meta: Meta, last: number, head: string): string | undefined {
  if (!namesAHead(meta)) return undefined;
  if (last > meta.seq) {
    return `the files are ahead of logbook.json: they end at seq ${last} head ${short(head)}, logbook.json says seq ${meta.seq} head ${short(meta.head)} (a crash between a line and logbook.json, SPEC §3); nothing was written: run \`logbook-ts repair tail\``;
  }
  if (last === meta.seq && head !== meta.head) {
    return `the files do not end where logbook.json says: they end at seq ${last} head ${short(head)}, logbook.json says seq ${meta.seq} head ${short(meta.head)}; nothing was written: run \`logbook-ts repair tail\``;
  }
  return undefined;
}

/** How many of the lines past the head `repair tail` lists; the rest it counts, as the reference does. */
const LISTED = 20;

export interface RepairTailOptions extends WriterLockOptions {
  /** List the tail and what would be set, and write nothing. */
  dryRun?: boolean;
}

/** What `repair tail` found, and did. */
export interface RepairTail {
  dryRun: boolean;
  /** The seq and head `logbook.json` named. */
  from: { seq: number; head: string };
  /** The seq and head the files end at: what `logbook.json` is, or would be, set to. */
  to: { seq: number; head: string };
  /** Lines past the head; 0 when there was nothing to repair. */
  count: number;
  /** The first twenty of them, in seq order. */
  shown: TailLine[];
  /** Whether `logbook.json` was replaced. */
  written: boolean;
  /** Verify, after the repair. */
  verified?: VerifyResult;
}

/**
 * `repair tail`, decision B (the reference's #294): bring `logbook.json` forward over the tail a
 * crash between a line and `logbook.json` left past it (SPEC §3, write order), only after every line
 * of the record verifies, and never during an append (an append refuses, TailAhead). Under the writer
 * lock throughout, the dry run too, its holder `logbook-ts repair tail`. The chain is read as verify
 * reads it, streamed, one line per month file; of the tail only the first twenty are kept, to list.
 * Refused (RepairRefused, nothing changed): a record this implementation cannot read; a logbook.json
 * that names no seq and head; any fault in the files, before the head or past it, named as verify
 * names it; the files ending before logbook.json; the files ending at its seq under another head; a
 * first line past the head that does not chain from it. Otherwise logbook.json is written through
 * a fsynced temp file and a rename, its other keys kept, and the record verified again. No month
 * file is touched.
 */
export function repairTail(root: string, options: RepairTailOptions = {}): RepairTail {
  // Refused before the lock is taken, as addNote refuses: a folder that is no record, or one whose
  // logbook.json names nothing to bring forward from, gets no state/ folder; read again under the lock.
  repairable(readMeta(root));
  const lock = lockOptions({ command: "logbook-ts repair tail", ...options });
  return withWriterLock(root, () => repairUnderLock(root, options.dryRun === true), lock);
}

/** Refuse a record this implementation cannot read, or a logbook.json that names no seq and head. */
function repairable(meta: Meta): void {
  const refusal = formatRefusal(meta);
  if (refusal) throw new RepairRefused(`${refusal}; nothing was changed`);
  if (!namesAHead(meta)) {
    throw new RepairRefused(
      `logbook.json: seq ${String(meta.seq)}, head ${String(meta.head)} name no line of a chain (a whole number from 0, and 64 hex digits); nothing was changed`,
    );
  }
}

function repairUnderLock(root: string, dryRun: boolean): RepairTail {
  const meta = readMeta(root);
  repairable(meta);
  const from = { seq: meta.seq, head: meta.head };
  let shown: TailLine[] = [];
  let count = 0;
  let first: TailLine | undefined;
  const chain = readChain(root, undefined, {
    at: from.seq,
    begin: () => {
      shown = [];
      count = 0;
      first = undefined;
    },
    tail: (line) => {
      count += 1;
      first ??= line;
      if (shown.length < LISTED) shown.push(line);
    },
  });
  const said = (text: string): RepairRefused => new RepairRefused(`${text}; nothing was changed`);
  if (chain.errors.length > 0) throw said(chain.errors[0] as string);
  const to = { seq: chain.count, head: chain.head };
  const ends = `logbook.json says seq=${from.seq} head=${short(from.head)}, the files end at seq=${to.seq} head=${short(to.head)}`;
  if (to.seq === from.seq && to.head === from.head) {
    return { dryRun, from, to, count: 0, shown: [], written: false };
  }
  if (to.seq < from.seq) {
    throw said(
      `${ends}: the files are behind logbook.json, which no crash leaves (SPEC §3); restore the month files from a backup`,
    );
  }
  if (to.seq === from.seq) {
    throw said(
      `${ends}: no line is past the head and the head is not the files'; run \`logbook-ts verify\``,
    );
  }
  // logbook.json names a line of the chain, or seq 0 and GENESIS; said by the first line past it.
  const next = first as TailLine;
  if (chain.headAt !== from.head) {
    throw said(
      `${next.where}: seq ${next.seq} — prev ${next.prev} does not match previous hash ${from.head}`,
    );
  }
  if (dryRun) return { dryRun, from, to, count, shown, written: false };

  // The guard behind the lock, as in an append: a writer that did not take it moved the head.
  const again = readMeta(root);
  if (again.seq !== meta.seq || again.head !== meta.head) {
    throw new HeadMoved(
      `the record's head moved while the tail was being checked: logbook.json named seq ${meta.seq}, head ${meta.head}, and names seq ${again.seq}, head ${again.head} now; nothing was changed`,
    );
  }
  writeMetaDurably(root, { ...again, seq: to.seq, head: to.head });
  return { dryRun, from, to, count, shown, written: true, verified: verifyLogbook(root) };
}

/**
 * What `repair tail` prints, as the reference prints it: the lines past the head and what is, or
 * would be, set, then verify's verdict after a repair; or that there is nothing to repair. The
 * reference's clauses about its index are left out: this implementation keeps none.
 */
export function repairTailText(report: RepairTail): string {
  if (report.count === 0) {
    return `nothing to repair: the files end where logbook.json says, seq=${report.to.seq} head=${short(report.to.head)}\n`;
  }
  const rows = [
    `logbook.json says seq=${report.from.seq} head=${short(report.from.head)}; the files hold ${report.count} line${report.count === 1 ? "" : "s"} past it, each verified (envelope, seq, prev, hash):`,
    ...report.shown.map((line) => `  seq ${line.seq}  ${line.where}  hash ${short(line.hash)}`),
  ];
  const more = report.count - report.shown.length;
  if (more > 0) rows.push(`  … and ${more} more line${more === 1 ? "" : "s"}`);
  if (!report.written) {
    rows.push(
      `would set logbook.json to seq=${report.to.seq} head=${short(report.to.head)}`,
      "nothing written — run without --dry-run to repair",
    );
    return `${rows.join("\n")}\n`;
  }
  rows.push(`logbook.json: seq ${report.to.seq}, head ${short(report.to.head)}`);
  const verified = report.verified as VerifyResult;
  if (verified.valid) rows.push(`valid — ${verified.lines} lines, head ${verified.head}`);
  else {
    rows.push(
      `invalid after the repair — ${verified.errors.length} error${verified.errors.length === 1 ? "" : "s"}; ${verified.lines} lines read, head ${verified.head}`,
      ...verified.errors.map((error) => `  ${error}`),
    );
  }
  return `${rows.join("\n")}\n`;
}

/**
 * Append a line to the month file of `stamp` and fsync it, and the folder that names the file, and
 * every folder made for it in the one above: the line is on disk before logbook.json names it.
 */
function appendLine(root: string, stamp: string, text: string): void {
  const dir = join(root, LOG_DIR, stamp.slice(0, 4));
  // The folders this append makes, deepest first, found before it makes them and named as `dir`
  // names them. What a recursive mkdir answers need not be spelled so (Windows, Node 22), and a walk
  // up from `dir` that waited to meet it would climb to the root and stay there.
  const making: string[] = [];
  for (let at = dir; !existsSync(at) && dirname(at) !== at; at = dirname(at)) making.push(at);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${stamp.slice(5, 7)}.jsonl`);
  const fd = openSync(file, "a");
  try {
    writeSync(fd, text, null, "utf-8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncFolder(dir);
  for (const made of making) syncFolder(dirname(made));
}

/**
 * Write logbook.json to a sibling temp file, fsynced, then rename it over the target, then fsync
 * the folder: a crash leaves the old file whole, never a half-written one.
 */
function writeMetaDurably(root: string, meta: Meta): void {
  const target = join(root, META_FILE);
  const tmp = join(root, `.${META_FILE}.${process.pid}.tmp`);
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, `${JSON.stringify(meta, null, 2)}\n`, null, "utf-8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    patientOnWindows(() => renameSync(tmp, target));
  } catch (err) {
    removeIfPossible(tmp);
    throw err;
  }
  syncFolder(root);
}

/**
 * fsync a folder, so a name created or renamed in it is on disk too. Node opens a folder on every
 * platform it runs on; a filesystem that will not open or flush one is passed over, since the files'
 * own fsyncs are what SPEC §3 asks for.
 */
function syncFolder(dir: string): void {
  let fd: number;
  try {
    fd = openSync(dir, "r");
  } catch {
    return;
  }
  try {
    fsyncSync(fd);
  } catch {
    // a filesystem that cannot fsync a folder
  } finally {
    closeSync(fd);
  }
}
