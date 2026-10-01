import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eachLine, type MonthFile, monthFiles, parseLine } from "./lines.js";
import {
  keeperPhoto,
  payloadOf,
  points,
  type RenderContext,
  retracted,
  splitLines,
  summarize,
  underneath,
} from "./render.js";
import { buildResolver, type Resolver } from "./resolve.js";
import { formatRefusal, LogbookError, readMeta } from "./store.js";
import type { Line } from "./types.js";

export interface ShowOptions {
  /** The local day, `YYYY-MM-DD`. */
  day: string;
  /** An IANA zone. Defaults to `timezone` in logbook.json. */
  timezone?: string;
  /** Print every ref as the source gave it, and the whole text of a note or a mail. */
  raw?: boolean;
  /** Keep only lines of these payload schemas (`note/v1`, or `note` for every version). */
  profiles?: string[];
}

/** A range of local days; a missing bound is the record's first or last day. */
export interface ShowRangeOptions {
  since?: string;
  until?: string;
  timezone?: string;
  raw?: boolean;
  profiles?: string[];
}

export interface ShowResult {
  /** The day's heading and one row per line (a run of points, a folded entry: one row), newline-terminated. */
  text: string;
  /** The zone the times were printed in. */
  timezone: string;
  /** Rows printed. */
  rows: number;
}

/** One day of a range, as `show` prints it. Only days with a line are produced. */
export interface DayShown extends ShowResult {
  day: string;
}

export interface ShowRange {
  timezone: string;
  /** The bounds as resolved; undefined when the record has no dated line to take one from. */
  since: string | undefined;
  until: string | undefined;
  /** The days with lines, oldest first, each produced once every file that can hold it is read. */
  days: Generator<DayShown>;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DASH = "–";
const DAY_MS = 86_400_000;
/** Two calendar entries from different sources this close, with one title, are one entry. */
const FOLD_WINDOW_MS = 5 * 60_000;
/** An airline designator in a calendar title: `LX 561`, `XY561`. */
const DESIGNATOR = /\b([A-Z]{2})\s?(\d{1,4})\b/;

/** Throws LogbookError unless the zone is one this Node's ICU knows. */
export function checkTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
  } catch {
    throw new LogbookError(`unknown timezone ${timezone}`);
  }
}

/** True for `YYYY-MM-DD` naming a real calendar day. */
export function isDay(day: string): boolean {
  const m = DAY.exec(day);
  if (!m) return false;
  return new Date(dayMs(day)).toISOString().slice(0, 10) === day;
}

/** Midnight UTC of a `YYYY-MM-DD`, in ms. */
function dayMs(day: string): number {
  const m = DAY.exec(day) as RegExpExecArray;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** `YYYY-MM` of an instant, in UTC: the month file a line written there belongs to. */
const monthKey = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

interface Local {
  day: string;
  clock: string;
}

/** Local calendar day and HH:MM of an instant in a zone; undefined when `at` is not a date. */
type Localize = (at: string) => Local | undefined;

function localizer(timezone: string): Localize {
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return (at) => {
    const ms = Date.parse(at);
    if (Number.isNaN(ms)) return undefined;
    const parts = format.formatToParts(new Date(ms));
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
    return {
      day: `${get("year")}-${get("month")}-${get("day")}`,
      clock: `${get("hour")}:${get("minute")}`,
    };
  };
}

interface Entry {
  line: Line;
  ms: number;
  local: Local;
}

/**
 * One local day of the record, printed as the reference implementation prints it: the day, then
 * one row per line — local time, kind, source, a one-line summary — in the order of `at`, then
 * the day's notes file. `<day>: nothing logged` when it has no line.
 */
export function showDay(root: string, options: ShowOptions): ShowResult {
  if (!isDay(options.day)) throw new LogbookError(`not a day: ${options.day}`);
  const { day, ...rest } = options;
  const range = showRange(root, { ...rest, since: day, until: day });
  for (const shown of range.days) return shown;
  return { text: `${day}: nothing logged\n`, timezone: range.timezone, rows: 0 };
}

/** The days of a range that have lines, oldest first; see `showRange`. */
export function* showDays(root: string, options: ShowRangeOptions): Generator<DayShown> {
  yield* showRange(root, options).days;
}

/**
 * A range of local days, streamed: every file is read once for the judgements the whole record
 * holds (resolutions, retractions, superseded flights) and for its first and last day; then only
 * the month files the range can touch are read, in order, each line going to its local day, and a
 * day is produced as soon as every file that can hold one of its lines has been read. What is held
 * at any moment is the lines of the days still open — at most a month's worth of the range, never
 * the record — so the memory does not grow with the record.
 */
export function showRange(root: string, options: ShowRangeOptions): ShowRange {
  for (const bound of [options.since, options.until]) {
    if (bound !== undefined && !isDay(bound)) throw new LogbookError(`not a day: ${bound}`);
  }
  const meta = readMeta(root);
  const refusal = formatRefusal(meta);
  if (refusal) throw new LogbookError(refusal);
  const timezone = options.timezone ?? meta.timezone;
  if (typeof timezone !== "string" || timezone === "") {
    throw new LogbookError("logbook.json: timezone is missing; pass --tz");
  }
  checkTimezone(timezone);
  const local = localizer(timezone);

  const keep = profileFilter(options.profiles);
  const files = monthFiles(root);
  const { resolver, supersededFlights, first, last } = judgements(files);
  const since = options.since ?? (first === undefined ? undefined : local(first)?.day);
  const until = options.until ?? (last === undefined ? undefined : local(last)?.day);
  const ctx: RenderContext = {
    resolver,
    raw: options.raw === true,
    clock: (at) => local(at)?.clock,
    supersededFlights,
  };
  // A bound past the record's other end (or a record with no dated line) is an empty range, not an error.
  const days =
    since === undefined || until === undefined || since > until
      ? (function* () {})()
      : streamDays(root, files, since, until, local, timezone, ctx, keep);
  return { timezone, since, until, days };
}

/**
 * Whether a line's `payload.schema` is one of the profiles asked for: the schema itself, or its
 * name before `/v` when the profile was given without a version. No profiles keeps every line.
 */
function profileFilter(profiles: string[] | undefined): (line: Line) => boolean {
  if (profiles === undefined || profiles.length === 0) return () => true;
  const wanted = new Set(profiles);
  return (line) => {
    const schema = line.payload?.schema;
    if (typeof schema !== "string") return false;
    if (wanted.has(schema)) return true;
    const slash = schema.indexOf("/v");
    return slash !== -1 && wanted.has(schema.slice(0, slash));
  };
}

function* streamDays(
  root: string,
  files: MonthFile[],
  since: string,
  until: string,
  local: Localize,
  timezone: string,
  ctx: RenderContext,
  keep: (line: Line) => boolean,
): Generator<DayShown> {
  // A local day's lines sit in the month files of the UTC days around it (SPEC §2, §3.2).
  const firstMonth = monthKey(dayMs(since) - DAY_MS);
  const lastMonth = monthKey(dayMs(until) + DAY_MS);
  /** The last month file that can hold a line of this local day. */
  const closes = (day: string): string => monthKey(dayMs(day) + DAY_MS);
  const open = new Map<string, Entry[]>();

  const flush = function* (through: string | undefined): Generator<DayShown> {
    const ready = [...open.keys()]
      .filter((day) => through === undefined || closes(day) <= through)
      .sort();
    for (const day of ready) {
      const entries = open.get(day) as Entry[];
      open.delete(day);
      yield renderDay(root, day, entries, local, timezone, ctx);
    }
  };

  for (const month of files) {
    const key = `${month.year}-${month.month}`;
    if (key < firstMonth || key > lastMonth) continue;
    for (const { raw, row } of eachLine(month.file)) {
      const parsed = parseLine(raw, `${month.rel} line ${row}`);
      if ("error" in parsed) continue; // verify reports it; show reads what it can
      const { line } = parsed;
      if (line.kind === "retraction") continue; // shown where the line it hides is (RFC 0003 rule 3)
      if (typeof line.at !== "string" || !keep(line)) continue;
      const at = local(line.at);
      if (at === undefined || at.day < since || at.day > until) continue;
      const entries = open.get(at.day) ?? [];
      entries.push({ line, ms: Date.parse(line.at), local: at });
      open.set(at.day, entries);
    }
    yield* flush(key);
  }
  yield* flush(undefined);
}

function renderDay(
  root: string,
  day: string,
  entries: Entry[],
  local: Localize,
  timezone: string,
  ctx: RenderContext,
): DayShown {
  entries.sort((a, b) => a.ms - b.ms || a.line.seq - b.line.seq);
  const rows = toRows(entries, local, ctx);
  const lines = [day, ...heroLine(entries, ctx), ...rows, ...notesFile(root, day)];
  return { day, text: `${lines.join("\n")}\n`, timezone, rows: rows.length };
}

/**
 * `  hero  <photo>[, <photo> (art)]…`: the day's keeper lines standing (RFC 0024 rule 4), the
 * `memory` lane first and every other lane marked `(art)`, as the reference prints them. Nothing
 * when the day has no keeper standing.
 */
function heroLine(entries: Entry[], ctx: RenderContext): string[] {
  const keepers = entries.filter(
    (e) => e.line.kind === "keeper" && ctx.resolver.retractedBy(e.line.id) === undefined,
  );
  const memory = keepers.filter((e) => payloadOf(e.line).lane === "memory");
  const others = keepers.filter((e) => payloadOf(e.line).lane !== "memory");
  const items = [
    ...memory.map((e) => keeperPhoto(payloadOf(e.line))),
    ...others.map((e) => `${keeperPhoto(payloadOf(e.line))} (art)`),
  ];
  return items.length ? [`  hero  ${items.join(", ")}`] : [];
}

/**
 * The judgements the whole record holds — who a ref is, which lines are hidden, which flights
 * replaced — and the first and last instant a listed line has, read in one pass over every file.
 */
function judgements(files: MonthFile[]): {
  resolver: Resolver;
  supersededFlights: Map<string, number>;
  first: string | undefined;
  last: string | undefined;
} {
  const judged: Line[] = [];
  const supersededFlights = new Map<string, number>();
  let first: { at: string; ms: number } | undefined;
  let last: { at: string; ms: number } | undefined;
  for (const month of files) {
    for (const { raw, row } of eachLine(month.file)) {
      const parsed = parseLine(raw, `${month.rel} line ${row}`);
      if ("error" in parsed) continue;
      const { line } = parsed;
      if (line.kind === "resolution" || line.kind === "retraction") judged.push(line);
      if (line.kind === "retraction") continue;
      if (line.kind === "flight") {
        const earlier = payloadOf(line).supersedes;
        if (typeof earlier === "string") supersededFlights.set(earlier, line.seq);
      }
      if (typeof line.at !== "string") continue;
      const ms = Date.parse(line.at);
      if (Number.isNaN(ms)) continue;
      if (first === undefined || ms < first.ms) first = { at: line.at, ms };
      if (last === undefined || ms > last.ms) last = { at: line.at, ms };
    }
  }
  return { resolver: buildResolver(judged), supersededFlights, first: first?.at, last: last?.at };
}

/** `notes/<YYYY>/<day>.md`, when the day has one: a heading, then its lines two spaces in. */
function notesFile(root: string, day: string): string[] {
  const file = join(root, "notes", day.slice(0, 4), `${day}.md`);
  if (!existsSync(file)) return [];
  return ["  — note —", ...splitLines(readFileSync(file, "utf-8")).map((row) => `  ${row}`)];
}

function toRows(entries: Entry[], local: Localize, ctx: RenderContext): string[] {
  const rows: string[] = [];
  const folded = foldEvents(entries, ctx);
  const remaining = entries.filter((e) => !folded.hidden.has(e.line.id));
  let i = 0;
  while (i < remaining.length) {
    const entry = remaining[i] as Entry;
    const sources = folded.sources.get(entry.line.id);
    let run = i + 1;
    if (isPoint(entry, ctx) && sources === undefined) {
      const subject = subjectOf(entry);
      while (
        run < remaining.length &&
        isPoint(remaining[run] as Entry, ctx) &&
        (remaining[run] as Entry).line.source === entry.line.source &&
        subjectOf(remaining[run] as Entry) === subject
      )
        run += 1;
      const last = remaining[run - 1] as Entry;
      const until =
        (typeof last.line.end === "string" ? local(last.line.end)?.clock : undefined) ??
        last.local.clock;
      const time = run - i > 1 ? `${entry.local.clock}${DASH}${until}` : entry.local.clock;
      rows.push(
        row(time, String(entry.line.kind), String(entry.line.source), points(run - i, subject)),
      );
    } else {
      const retraction = ctx.resolver.retractedBy(entry.line.id);
      if (retraction !== undefined) rows.push(`  ${entry.local.clock}  ${retracted(retraction)}`);
      else {
        const source = sources ?? String(entry.line.source);
        rows.push(
          row(entry.local.clock, String(entry.line.kind), source, summarize(entry.line, ctx)),
        );
        rows.push(...underneath(entry.line, ctx));
      }
    }
    i = run;
  }
  return rows;
}

/** `  HH:MM  kind       source         text` — the kind to ten columns, the source to fourteen. */
function row(time: string, kind: string, source: string, text: string): string {
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - [...s].length));
  return `  ${time}  ${pad(kind, 10)} ${pad(source, 14)} ${text}`;
}

function isPoint(entry: Entry, ctx: RenderContext): boolean {
  return entry.line.kind === "location" && ctx.resolver.retractedBy(entry.line.id) === undefined;
}

function subjectOf(entry: Entry): string | undefined {
  const subject = payloadOf(entry.line).subject;
  return typeof subject === "string" ? subject : undefined;
}

/** What two calendar titles must share to be one entry: the words, or the flight they name. */
function eventKeys(entry: Entry): { title: string; flight: string | undefined } {
  const raw = payloadOf(entry.line).title;
  const title = typeof raw === "string" ? raw : "";
  const m = DESIGNATOR.exec(title);
  return {
    title: title.trim().toLowerCase().replace(/\s+/g, " "),
    flight: m ? `${m[1]}${m[2]}` : undefined,
  };
}

/**
 * One calendar entry that several sources carry prints once: `event/v1` lines with one title (case
 * and spacing aside), or naming the same flight, from different sources, starting within five
 * minutes of the first, fold into the first's row with every source in its source column.
 */
function foldEvents(
  entries: Entry[],
  ctx: RenderContext,
): { hidden: Set<string>; sources: Map<string, string> } {
  const hidden = new Set<string>();
  const sources = new Map<string, string>();
  const events = entries.filter(
    (e) => e.line.kind === "event" && ctx.resolver.retractedBy(e.line.id) === undefined,
  );
  for (let i = 0; i < events.length; i++) {
    const first = events[i] as Entry;
    if (hidden.has(first.line.id)) continue;
    const key = eventKeys(first);
    const group = [String(first.line.source)];
    for (let j = i + 1; j < events.length; j++) {
      const other = events[j] as Entry;
      if (other.ms - first.ms > FOLD_WINDOW_MS) break;
      if (hidden.has(other.line.id) || group.includes(String(other.line.source))) continue;
      const otherKey = eventKeys(other);
      const same =
        otherKey.title === key.title ||
        (key.flight !== undefined && otherKey.flight === key.flight);
      if (!same) continue;
      hidden.add(other.line.id);
      group.push(String(other.line.source));
    }
    if (group.length > 1) sources.set(first.line.id, group.join("+"));
  }
  return { hidden, sources };
}
