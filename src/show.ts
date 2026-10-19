import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chapterOf, isChapter } from "./chapters.js";
import {
  checkTimezone,
  DAY_MS,
  dayMs,
  isDay,
  type Local,
  type Localize,
  localizer,
  monthKey,
} from "./clock.js";
import { checkDayStart } from "./dayStart.js";
import { isOn, RFC0036, RFC0038, RFC0040, RFC0041 } from "./flags.js";
import { isGoal } from "./goals.js";
import { eachLine, type MonthFile, monthFiles, parseLine } from "./lines.js";
import { pyStr } from "./pyrepr.js";
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
import {
  isSignedDay,
  SIGNED_DAY_KIND,
  type SignedState,
  signedState,
  signedStateText,
  sortPage,
  standingSignatures,
} from "./signing.js";
import { formatRefusal, LogbookError, readMeta } from "./store.js";
import type { JsonValue, Line } from "./types.js";

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

/** One row of a day: a line, a run of points, a folded calendar entry, or a hidden line's mark. */
export interface ShownRow {
  /** Local `HH:MM` of the row's first line. */
  time: string;
  /** Local `HH:MM` a run of points ends at; absent on every other row. */
  until?: string;
  kind: string;
  /** The line's source, or `×N sources` for a folded calendar entry. */
  source: string;
  /** The text column: the summary, with refs rendered as names (or raw), or `retracted #seq: reason`. */
  summary: string;
  /** The retraction that hides this row's line, when one does. */
  retraction?: Line;
  /** The lines behind the row, in order: one, the points of a run, or the entries folded. */
  lines: Line[];
}

/** A hero photo of the day: a keeper line standing (RFC 0024 rule 4). */
export interface ShownHero {
  /** The photo as the keeper names it: `file_name`, else `asset_id`, else the photo line's id, else `?`. */
  photo: string;
  /** The keeper's `lane` as written; null when it has none. */
  lane: JsonValue;
  /** The keeper line's id. */
  line: string;
}

/** A day as `show --json` prints it: what the text shows, with the lines behind every row. */
export interface DayDetail {
  day: string;
  timezone: string;
  hero: ShownHero[];
  rows: ShownRow[];
  /** The day's standing signature (RFC 0034 rule 6), or null when the day is unsigned. */
  signed: SignedState | null;
  /** The text of `notes/<YYYY>/<day>.md`, when the file exists. */
  note?: string;
}

export interface ShowResult {
  /** The day's heading and one row per line (a run of points, a folded entry: one row), newline-terminated. */
  text: string;
  /** The zone the times were printed in. */
  timezone: string;
  /** Rows printed. */
  rows: number;
  /** The same day, structured. */
  detail: DayDetail;
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

const DASH = "–";
/** An airline designator in a calendar title: `LX 561`, `XY561`. */
const DESIGNATOR = /\b([A-Z]{2})\s?(\d{1,4})\b/;

export { checkTimezone, isDay };

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
  return {
    text: `${day}: nothing logged\n`,
    timezone: range.timezone,
    rows: 0,
    detail: { day, timezone: range.timezone, hero: [], rows: [], signed: null },
  };
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
  checkDayStart(meta);
  const timezone = options.timezone ?? meta.timezone;
  if (typeof timezone !== "string" || timezone === "") {
    throw new LogbookError("logbook.json: timezone is missing; pass --tz");
  }
  checkTimezone(timezone);
  const local = localizer(timezone);

  const keep = profileFilter(options.profiles);
  const files = monthFiles(root);
  const judgements = readJudgements(files);
  const { resolver, supersededFlights, first, last, signatures } = judgements;
  const since = options.since ?? (first === undefined ? undefined : local(first)?.day);
  const until = options.until ?? (last === undefined ? undefined : local(last)?.day);
  const ctx: RenderContext = {
    resolver,
    raw: options.raw === true,
    clock: (at) => local(at)?.clock,
    supersededFlights,
    rfc0036: isOn(RFC0036),
    rfc0038: isOn(RFC0038),
    rfc0040: isOn(RFC0040),
    rfc0041: isOn(RFC0041),
    supersededByTranscript: judgements.supersededByTranscript,
    replacedBy: (line) => judgements.supersededSameKind.get(`${line.kind}\u0000${line.id}`),
    goalText: (goalId) => goalText(judgements, goalId),
    chapterOf: isOn(RFC0036) ? (day) => chapterHeading(judgements, day) : undefined,
  };
  // The standing signature per day (RFC 0034 rule 3): the owner's, not retracted.
  const owner = typeof meta.owner_id === "string" ? meta.owner_id : undefined;
  const standing = standingSignatures(
    signatures,
    { has: (id) => resolver.retractedBy(id) !== undefined },
    owner,
  );
  // A bound past the record's other end (or a record with no dated line) is an empty range, not an error.
  const days =
    since === undefined || until === undefined || since > until
      ? (function* () {})()
      : streamDays(root, files, since, until, local, timezone, ctx, keep, standing);
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
  standing: Map<string, Line>,
): Generator<DayShown> {
  // A local day's lines sit in the month files of the UTC days around it (SPEC §2, §3.2).
  const firstMonth = monthKey(dayMs(since) - DAY_MS);
  const lastMonth = monthKey(dayMs(until) + DAY_MS);
  /** The last month file that can hold a line of this local day. */
  const closes = (day: string): string => monthKey(dayMs(day) + DAY_MS);
  const open = new Map<string, Entry[]>();
  // The page of each open day (RFC 0034): every line on it whatever `--profile` keeps, the
  // signatures aside, so the digest is over the page as shown and not over the rows filtered.
  const pages = new Map<string, Line[]>();

  const flush = function* (through: string | undefined): Generator<DayShown> {
    const ready = [...open.keys()]
      .filter((day) => through === undefined || closes(day) <= through)
      .sort();
    for (const day of ready) {
      const entries = open.get(day) as Entry[];
      open.delete(day);
      const page = sortPage(pages.get(day) ?? []);
      pages.delete(day);
      const signed = signedState(standing.get(day), timezone, page, day);
      yield renderDay(root, day, entries, local, timezone, ctx, signed);
    }
    // A signed day with every line filtered out is not shown, as an empty day is not; its page
    // is dropped with the days flushed.
    for (const day of [...pages.keys()]) {
      if (!open.has(day) && (through === undefined || closes(day) <= through)) pages.delete(day);
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
      if (typeof line.at !== "string") continue;
      const at = local(line.at);
      if (at === undefined || at.day < since || at.day > until) continue;
      if (line.kind !== SIGNED_DAY_KIND) pages.set(at.day, [...(pages.get(at.day) ?? []), line]);
      if (!keep(line)) continue;
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
  signed: SignedState | null,
): DayShown {
  entries.sort((a, b) => a.ms - b.ms || a.line.seq - b.line.seq);
  const hero = heroes(entries, ctx);
  const built = toRows(entries, local, ctx);
  const note = notesFile(root, day);
  const text = [
    // The header says whether the owner signed the day (RFC 0034 rule 6), and, under the rfc0036
    // flag, the chapter the day is in (RFC 0036, chapter/v1 rules 3 and 4).
    `${day}  ${signedStateText(signed)}${ctx.chapterOf?.(day) ?? ""}`,
    ...heroLine(hero),
    ...built.flatMap(({ row, under }) => [rowText(row), ...under]),
    ...(note === undefined ? [] : ["  — note —", ...splitLines(note).map((r) => `  ${r}`)]),
  ];
  const detail: DayDetail = { day, timezone, hero, rows: built.map((b) => b.row), signed };
  if (note !== undefined) detail.note = note;
  return { day, text: `${text.join("\n")}\n`, timezone, rows: built.length, detail };
}

/**
 * The day's keeper lines standing (RFC 0024 rule 4, and its amendment of 2026-10-14: `supersedes` is
 * read), the `memory` lane first, then the rest. A keeper another keeper of the day names in
 * `supersedes` is no hero, as the reference's `show` reads it at 0.7.0: even when that keeper is
 * retracted (SPEC-QUESTIONS 109).
 */
function heroes(entries: Entry[], ctx: RenderContext): ShownHero[] {
  const replaced = new Set<string>();
  for (const e of entries) {
    const earlier = e.line.kind === "keeper" ? payloadOf(e.line).supersedes : undefined;
    if (typeof earlier === "string") replaced.add(earlier);
  }
  const keepers = entries.filter(
    (e) =>
      e.line.kind === "keeper" &&
      ctx.resolver.retractedBy(e.line.id) === undefined &&
      !replaced.has(e.line.id),
  );
  const hero = (e: Entry): ShownHero => {
    const p = payloadOf(e.line);
    return { photo: keeperPhoto(p), lane: p.lane ?? null, line: e.line.id };
  };
  return [
    ...keepers.filter((e) => payloadOf(e.line).lane === "memory").map(hero),
    ...keepers.filter((e) => payloadOf(e.line).lane !== "memory").map(hero),
  ];
}

/** `  hero  <photo>[, <photo> (art)]…`, as the reference prints it: every lane but `memory` is `(art)`. */
function heroLine(hero: ShownHero[]): string[] {
  if (hero.length === 0) return [];
  const items = hero.map((h) => (h.lane === "memory" ? h.photo : `${h.photo} (art)`));
  return [`  hero  ${items.join(", ")}`];
}

/** The judgements the whole record holds, read in one pass over every file. */
export interface Judgements {
  resolver: Resolver;
  /**
   * For a line a flight line supersedes, whatever its kind: the seq of the last flight line that
   * names it and is not retracted (a retracted one supersedes nothing, the reference's #321).
   */
  supersededFlights: Map<string, number>;
  /**
   * The lines superseded as SPEC §3.2 reads it since the reference's #321 (its docs/SPEC-QUESTIONS.md,
   * 18 October 2026): a line is superseded while at least one line of its own kind that is not
   * retracted names it in `supersedes`; a superseder superseded in turn still supersedes. Keyed by
   * `<kind>\u0000<id>`; ask it through `isSuperseded`.
   */
  supersededByKind: Set<string>;
  /**
   * For a line of a kind that the reference marks when a later line of its own kind replaces it
   * (`goal`, `chapter`): that line's seq, the latest standing one when several do. A retracted line
   * replaces nothing.
   */
  supersededSameKind: Map<string, number>;
  /**
   * For a line a transcript line supersedes, whatever its kind (a recording heard again, RFC 0038
   * §2.8): the transcript's seq, the latest standing one when several do. A retracted one replaces
   * nothing. Read under the rfc0038 flag.
   */
  supersededByTranscript: Map<string, number>;
  /** Every `goal/v1` line by id, standing or not: a review names its goal by the id it had. */
  goals: Map<string, Line>;
  /** Every `chapter/v1` line, in file order: the day's chapter is read from the standing ones. */
  chapters: Line[];
  /** Every `signed-day/v1` line (RFC 0034), standing or not, in file order; `standingSignatures` picks per day. */
  signatures: Line[];
  /** The first and last instant a listed line has, as written. */
  first: string | undefined;
  last: string | undefined;
  /** The first and last instant of any line, a retraction included: the days `people` reads over. */
  firstLine: string | undefined;
  lastLine: string | undefined;
  /** The first and last instant of any location line, whatever its subject: the days the track covers. */
  firstLocation: string | undefined;
  lastLocation: string | undefined;
}

/** Whether a line is superseded: a line of its own kind that is not retracted names it (#321). */
export function isSuperseded(
  judgements: Pick<Judgements, "supersededByKind">,
  line: Line,
): boolean {
  return judgements.supersededByKind.has(`${line.kind}\u0000${line.id}`);
}

/** The kinds whose lines the reference marks `superseded by #N` when a later line of the kind replaces them. */
const SAME_KIND = new Set(["goal", "chapter", "scene-review"]);

/**
 * The judgements the whole record holds — who a ref is, which lines are hidden, which lines
 * replaced — and the first and last instant a listed line has, read in one pass over every file.
 */
export function readJudgements(files: MonthFile[]): Judgements {
  const judged: Line[] = [];
  const replacing = new Map<string, Array<{ id: string; seq: number }>>();
  const goals = new Map<string, Line>();
  const chapters: Line[] = [];
  const signatures: Line[] = [];
  let first: { at: string; ms: number } | undefined;
  let last: { at: string; ms: number } | undefined;
  let firstLine: { at: string; ms: number } | undefined;
  let lastLine: { at: string; ms: number } | undefined;
  let firstLocation: { at: string; ms: number } | undefined;
  let lastLocation: { at: string; ms: number } | undefined;
  for (const month of files) {
    for (const { raw, row } of eachLine(month.file)) {
      const parsed = parseLine(raw, `${month.rel} line ${row}`);
      if ("error" in parsed) continue;
      const { line } = parsed;
      if (line.kind === "resolution" || line.kind === "retraction") judged.push(line);
      if (typeof line.at === "string") {
        const ms = Date.parse(line.at);
        if (!Number.isNaN(ms)) {
          if (firstLine === undefined || ms < firstLine.ms) firstLine = { at: line.at, ms };
          if (lastLine === undefined || ms > lastLine.ms) lastLine = { at: line.at, ms };
        }
      }
      if (line.kind === "retraction") continue;
      if (isSignedDay(line)) signatures.push(line);
      if (isGoal(line)) goals.set(line.id, line);
      if (isChapter(line)) chapters.push(line);
      const earlier = payloadOf(line).supersedes;
      if (typeof earlier === "string") {
        // Who supersedes what is settled once the retractions are all read, below.
        const key = `${line.kind}\u0000${earlier}`;
        const by = replacing.get(key);
        if (by === undefined) replacing.set(key, [{ id: line.id, seq: line.seq }]);
        else by.push({ id: line.id, seq: line.seq });
      }
      if (typeof line.at !== "string") continue;
      const ms = Date.parse(line.at);
      if (Number.isNaN(ms)) continue;
      if (first === undefined || ms < first.ms) first = { at: line.at, ms };
      if (last === undefined || ms > last.ms) last = { at: line.at, ms };
      // Any location line bounds the track, an asset's or an unregistered subject's as much as
      // the owner's: the reference's window on the conformance sample ends on a vessel's line.
      if (line.kind === "location") {
        if (firstLocation === undefined || ms < firstLocation.ms)
          firstLocation = { at: line.at, ms };
        if (lastLocation === undefined || ms > lastLocation.ms) lastLocation = { at: line.at, ms };
      }
    }
  }
  const resolver = buildResolver(judged);
  const supersededByKind = new Set<string>();
  const supersededFlights = new Map<string, number>();
  const supersededSameKind = new Map<string, number>();
  const supersededByTranscript = new Map<string, number>();
  for (const [key, by] of replacing) {
    const earlier = key.slice(key.indexOf("\u0000") + 1);
    const kind = key.slice(0, key.indexOf("\u0000"));
    // A retracted line supersedes nothing (the reference's #321): retracting every line that
    // supersedes a line stands it again.
    const standing = by.filter((b) => resolver.retractedBy(b.id) === undefined);
    if (standing.length === 0) continue;
    supersededByKind.add(key);
    const seq = Math.max(...standing.map((b) => b.seq));
    // A flight and a transcript mark the line they replace whatever its kind; a goal is marked
    // only by a goal, a chapter by a chapter, so those are keyed by kind and id.
    if (kind === "flight") supersededFlights.set(earlier, seq);
    if (kind === "transcript") supersededByTranscript.set(earlier, seq);
    else if (SAME_KIND.has(kind)) supersededSameKind.set(key, seq);
  }
  return {
    resolver,
    supersededFlights,
    supersededByKind,
    supersededSameKind,
    supersededByTranscript,
    goals,
    chapters,
    signatures,
    first: first?.at,
    last: last?.at,
    firstLine: firstLine?.at,
    lastLine: lastLine?.at,
    firstLocation: firstLocation?.at,
    lastLocation: lastLocation?.at,
  };
}

/** The text of `notes/<YYYY>/<day>.md`, when the day has one. */
function notesFile(root: string, day: string): string | undefined {
  const file = join(root, "notes", day.slice(0, 4), `${day}.md`);
  return existsSync(file) ? readFileSync(file, "utf-8") : undefined;
}

/** A row and the lines printed under it (a mail's body with `--raw`), which the JSON leaves out. */
interface Built {
  row: ShownRow;
  under: string[];
}

function toRows(entries: Entry[], local: Localize, ctx: RenderContext): Built[] {
  const rows: Built[] = [];
  const folded = foldEvents(entries, ctx);
  const remaining = entries.filter((e) => !folded.hidden.has(e.line.id));
  let i = 0;
  while (i < remaining.length) {
    const entry = remaining[i] as Entry;
    const fold = folded.groups.get(entry.line.id);
    let run = i + 1;
    if (isPoint(entry, ctx) && fold === undefined) {
      const subject = subjectOf(entry);
      while (
        run < remaining.length &&
        isPoint(remaining[run] as Entry, ctx) &&
        (remaining[run] as Entry).line.source === entry.line.source &&
        subjectOf(remaining[run] as Entry) === subject
      )
        run += 1;
      const last = remaining[run - 1] as Entry;
      const row: ShownRow = {
        time: entry.local.clock,
        kind: String(entry.line.kind),
        source: String(entry.line.source),
        summary: points(run - i, subject),
        lines: remaining.slice(i, run).map((e) => e.line),
      };
      if (run - i > 1) {
        row.until =
          (typeof last.line.end === "string" ? local(last.line.end)?.clock : undefined) ??
          last.local.clock;
      }
      rows.push({ row, under: [] });
    } else {
      const retraction = ctx.resolver.retractedBy(entry.line.id);
      const row: ShownRow = {
        time: entry.local.clock,
        kind: String(entry.line.kind),
        source: fold?.sources ?? String(entry.line.source),
        summary: retraction === undefined ? summarize(entry.line, ctx) : retracted(retraction),
        lines: [entry.line, ...(fold?.lines ?? [])],
      };
      if (retraction !== undefined) row.retraction = retraction;
      rows.push({ row, under: retraction === undefined ? underneath(entry.line, ctx) : [] });
    }
    i = run;
  }
  return rows;
}

/** `  HH:MM  kind       source         text` — the kind to ten columns, the source to fourteen. */
function rowText(row: ShownRow): string {
  const time = row.until === undefined ? row.time : `${row.time}${DASH}${row.until}`;
  if (row.retraction !== undefined) return `  ${time}  ${row.summary}`;
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - [...s].length));
  return `  ${time}  ${pad(row.kind, 10)} ${pad(row.source, 14)} ${row.summary}`;
}

function isPoint(entry: Entry, ctx: RenderContext): boolean {
  return entry.line.kind === "location" && ctx.resolver.retractedBy(entry.line.id) === undefined;
}

function subjectOf(entry: Entry): string | undefined {
  const subject = payloadOf(entry.line).subject;
  return typeof subject === "string" ? subject : undefined;
}

/**
 * What two calendar entries must share to be one: the span, and the title (case, accents and
 * whitespace aside: `Zürich` is `zurich`, `ø` stays `ø`) or the flight the title names.
 */
function eventKeys(entry: Entry): { span: string; title: string; flight: string | undefined } {
  const raw = payloadOf(entry.line).title;
  const title = typeof raw === "string" ? raw : "";
  const m = DESIGNATOR.exec(title);
  return {
    span: `${entry.ms}|${typeof entry.line.end === "string" ? entry.line.end : ""}`,
    title: title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " "),
    flight: m ? `${m[1]}${m[2]}` : undefined,
  };
}

/** A folded entry: the source column (`×N sources`), and the lines folded into the first. */
interface Fold {
  sources: string;
  lines: Line[];
}

/**
 * One calendar entry that several sources carry prints once, as the reference does: `event/v1`
 * lines with the same start and end, and one title (case, accents and whitespace aside) or naming
 * the same flight, from two or more sources, fold into the first's row with `×N sources` — N the
 * distinct sources — in its source column. One calendar holding an entry twice is still two rows;
 * a retracted line is neither folded nor counted (SPEC-QUESTIONS 28).
 */
function foldEvents(
  entries: Entry[],
  ctx: RenderContext,
): { hidden: Set<string>; groups: Map<string, Fold> } {
  const hidden = new Set<string>();
  const groups = new Map<string, Fold>();
  const events = entries.filter(
    (e) => e.line.kind === "event" && ctx.resolver.retractedBy(e.line.id) === undefined,
  );
  for (let i = 0; i < events.length; i++) {
    const first = events[i] as Entry;
    if (hidden.has(first.line.id)) continue;
    const key = eventKeys(first);
    const sources = new Set([String(first.line.source)]);
    const members: Entry[] = [];
    for (let j = i + 1; j < events.length; j++) {
      const other = events[j] as Entry;
      if (other.ms !== first.ms) break;
      if (hidden.has(other.line.id)) continue;
      const otherKey = eventKeys(other);
      const same =
        otherKey.span === key.span &&
        (otherKey.title === key.title ||
          (key.flight !== undefined && otherKey.flight === key.flight));
      if (!same) continue;
      members.push(other);
      sources.add(String(other.line.source));
    }
    if (sources.size < 2) continue;
    for (const member of members) hidden.add(member.line.id);
    groups.set(first.line.id, {
      sources: `×${sources.size} sources`,
      lines: members.map((m) => m.line),
    });
  }
  return { hidden, groups };
}

/**
 * A goal's current text, as the reference's review row names it: the text of the last goal line
 * that rewords the one `goalId` names (each the latest standing line that `supersedes` the one
 * before); undefined when no goal line standing has that id. Python's `str()` of the text.
 */
function goalText(judgements: Judgements, goalId: string): string | undefined {
  const { goals, resolver, supersededSameKind } = judgements;
  let goal = goals.get(goalId);
  if (goal === undefined || resolver.retractedBy(goal.id) !== undefined) return undefined;
  const seen = new Set<string>([goal.id]);
  for (;;) {
    const by = supersededSameKind.get(`goal\u0000${goal.id}`);
    const next = by === undefined ? undefined : [...goals.values()].find((g) => g.seq === by);
    if (next === undefined || seen.has(next.id)) break;
    seen.add(next.id);
    goal = next;
  }
  return pyStr(payloadOf(goal).text);
}

/** ` · chapter <name>[, clashes with <name>…]` for a day a standing chapter holds, else empty. */
function chapterHeading(judgements: Judgements, day: string): string {
  const retracted = { has: (id: string) => judgements.resolver.retractedBy(id) !== undefined };
  const { chapter, clash } = chapterOf(judgements.chapters, retracted, day);
  if (chapter === null) return "";
  const nameOf = (id: string): string =>
    pyStr(payloadOf(judgements.chapters.find((c) => c.id === id) as Line).name);
  const name = nameOf(chapter.line);
  return clash.length
    ? ` · chapter ${name}, clashes with ${clash.map(nameOf).join(", ")}`
    : ` · chapter ${name}`;
}
