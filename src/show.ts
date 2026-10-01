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
}

export interface ShowResult {
  /** The day's heading and one row per line (a run of points, a folded entry: one row), newline-terminated. */
  text: string;
  /** The zone the times were printed in. */
  timezone: string;
  /** Rows printed. */
  rows: number;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DASH = "–";
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
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(utc).toISOString().slice(0, 10) === day;
}

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

/** The `YYYY-MM` keys whose files can hold a line of this local day: the UTC days around it. */
function candidateMonths(day: string): Set<string> {
  const m = DAY.exec(day) as RegExpExecArray;
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const months = new Set<string>();
  for (const offset of [-1, 0, 1]) {
    months.add(new Date(base + offset * 86_400_000).toISOString().slice(0, 7));
  }
  return months;
}

interface Entry {
  line: Line;
  ms: number;
  local: Local;
}

/**
 * One local day of the record, printed as the reference implementation prints it: the day, then
 * one row per line — local time, kind, source, a one-line summary — in the order of `at`, then
 * the day's notes file. Reads the month files around the day, and streams every file once for
 * the resolution, retraction and flight lines; nothing is loaded whole and nothing is written.
 */
export function showDay(root: string, options: ShowOptions): ShowResult {
  if (!isDay(options.day)) throw new LogbookError(`not a day: ${options.day}`);
  const meta = readMeta(root);
  const refusal = formatRefusal(meta);
  if (refusal) throw new LogbookError(refusal);
  const timezone = options.timezone ?? meta.timezone;
  if (typeof timezone !== "string" || timezone === "") {
    throw new LogbookError("logbook.json: timezone is missing; pass --tz");
  }
  checkTimezone(timezone);
  const local = localizer(timezone);

  const files = monthFiles(root);
  const { resolver, supersededFlights } = judgements(files);
  const months = candidateMonths(options.day);
  const entries: Entry[] = [];
  for (const month of files) {
    if (!months.has(`${month.year}-${month.month}`)) continue;
    for (const { raw, row } of eachLine(month.file)) {
      const parsed = parseLine(raw, `${month.rel} line ${row}`);
      if ("error" in parsed) continue; // verify reports it; show reads what it can
      const { line } = parsed;
      if (line.kind === "retraction") continue; // shown where the line it hides is (RFC 0003 rule 3)
      if (typeof line.at !== "string") continue;
      const at = local(line.at);
      if (at === undefined || at.day !== options.day) continue;
      entries.push({ line, ms: Date.parse(line.at), local: at });
    }
  }
  entries.sort((a, b) => a.ms - b.ms || a.line.seq - b.line.seq);

  if (entries.length === 0) {
    return { text: `${options.day}: nothing logged\n`, timezone, rows: 0 };
  }
  const ctx: RenderContext = {
    resolver,
    raw: options.raw === true,
    clock: (at) => local(at)?.clock,
    supersededFlights,
  };
  const rows = toRows(entries, local, ctx);
  const lines = [options.day, ...heroLine(entries, ctx), ...rows, ...notesFile(root, options.day)];
  return { text: `${lines.join("\n")}\n`, timezone, rows: rows.length };
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

/** The judgements the whole record holds: who a ref is, which lines are hidden, which flights replaced. */
function judgements(files: MonthFile[]): {
  resolver: Resolver;
  supersededFlights: Map<string, number>;
} {
  const judged: Line[] = [];
  const supersededFlights = new Map<string, number>();
  for (const month of files) {
    for (const { raw, row } of eachLine(month.file)) {
      const parsed = parseLine(raw, `${month.rel} line ${row}`);
      if ("error" in parsed) continue;
      const { line } = parsed;
      if (line.kind === "resolution" || line.kind === "retraction") judged.push(line);
      else if (line.kind === "flight") {
        const earlier = payloadOf(line).supersedes;
        if (typeof earlier === "string") supersededFlights.set(earlier, line.seq);
      }
    }
  }
  return { resolver: buildResolver(judged), supersededFlights };
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
