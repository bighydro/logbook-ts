import { addDays, isDay, localOf, localToMs } from "./clock.js";
import {
  type Attached,
  type Day,
  type DayHealth,
  type DayReader,
  dayOf,
  dayWindow,
  deriveRows,
  type Entry,
  openDayReader,
  readEntries,
  type SegmentEntry,
  type SourceCount,
} from "./day.js";
import { healthText } from "./dayText.js";
import { roundHalfEven, roundTo } from "./geo.js";
import { LogbookError } from "./store.js";

/** The window `days` reads: both bounds default to the days the owner's track covers, else the days with any line. */
export interface DaysOptions {
  from?: string;
  to?: string;
}

/** The night after a day, as a row of `days` carries it. */
export interface DayRowNight {
  where: string | null;
  home: boolean;
  aboard: string | null;
  in_transit: boolean;
  stay: string | null;
  /** Whether the day has a location line at all; without one nothing says the owner moved. */
  located: boolean;
}

export interface DayRowFlight {
  carrier: string | null;
  number: string | null;
  from: string | null;
  to: string | null;
  evidence: string | null;
  line: string;
}

/** One day of a window, composed from its Day: what `days --json` prints, one object per line. */
export interface DayRow {
  day: string;
  weekday: string;
  night: DayRowNight;
  /** The Day's country code. */
  country: string | null;
  /** Whole metres of every move that started on the day, the passages aboard an asset included. */
  moved_m: number;
  flights: DayRowFlight[];
  /** The rows of kind stay or aboard, never a stop; the attachments of every row but a flight; the stay rows with any. */
  stays: { count: number; attached: number; with_attachments: number };
  /** The people confirmed at any row, each once, in the order the rows name them. */
  people: { confirmed: number; names: string[] };
  health: DayHealth | null;
  sources: SourceCount[];
  /** Every usual source with no line on the day. */
  gaps: string[];
}

/** What `days` read: the window, and one row per day of it. */
export interface DayRows {
  /** null when the record has no day at all. */
  since: string | null;
  until: string | null;
  rows: DayRow[];
}

/**
 * A window of days read back one row per day, composed from the Day of each as the reference's
 * `logbook days` prints it: the night after, the country, the kilometres moved, the flights, the
 * stays and what attached, the people confirmed present, the health line, the sources and the
 * gaps: every usual source silent on the day, a source being usual when it has a line on at
 * least four in five of the window's days that have any line. The window is read a calendar month
 * at a time, each with the day before it, and the stays are derived over that reading, as the
 * reference does. Nothing is written.
 */
export function readDayRows(root: string, options: DaysOptions): DayRows {
  for (const bound of [options.from, options.to])
    if (bound !== undefined && !isDay(bound)) throw new LogbookError(`not a day: ${bound}`);
  if (options.from !== undefined && options.to !== undefined && options.from > options.to)
    throw new LogbookError(`range runs backwards: ${options.from} > ${options.to}`);
  const reader = openDayReader(root);
  const covered = coveredDays(reader);
  const since = options.from ?? covered?.first;
  const until = options.to ?? covered?.last;
  if (since === undefined || until === undefined) return { since: null, until: null, rows: [] };
  const rows: DayRow[] = [];
  for (const chunk of monthChunks(since, until)) {
    const { startMs } = dayWindow(reader, chunk.first);
    const { endMs } = dayWindow(reader, chunk.last);
    // One reading per chunk: the stays, moves and runs aboard are derived over the whole of it, so a
    // run aboard that spans days is one row on each, and a move that ends past a day is still that day's.
    const entries = readEntries(reader.files, startMs, endMs, reader.timezone);
    const derived = deriveRows(reader, entries);
    for (let day = chunk.first; day <= chunk.last; day = addDays(day, 1)) {
      const span = dayWindow(reader, day);
      const own = entries.filter((e) => e.ms >= span.startMs && e.ms <= span.endMs);
      rows.push(rowOf(dayOf(reader, day, own, derived), own, reader));
    }
  }
  const usual = usualSources(rows);
  for (const row of rows) {
    const present = new Set(row.sources.map((s) => s.source));
    row.gaps = usual.filter((source) => !present.has(source));
  }
  return { since, until, rows };
}

/** The first and last local day the owner's track covers, else those with any line; undefined on an empty record. */
function coveredDays(reader: DayReader): { first: string; last: string } | undefined {
  const { firstLocation, lastLocation, first, last } = reader.judgements;
  const bounds =
    firstLocation !== undefined && lastLocation !== undefined
      ? [firstLocation, lastLocation]
      : first !== undefined && last !== undefined
        ? [first, last]
        : undefined;
  if (bounds === undefined) return undefined;
  const [a, b] = bounds.map((at) => localOf(Date.parse(at), reader.timezone).day) as [
    string,
    string,
  ];
  return { first: a, last: b };
}

/** The window cut at the turn of each calendar month, so a month's lines are read once and held once. */
function monthChunks(since: string, until: string): Array<{ first: string; last: string }> {
  const chunks: Array<{ first: string; last: string }> = [];
  let first = since;
  while (first <= until) {
    const month = first.slice(0, 7);
    let last = first;
    while (addDays(last, 1) <= until && addDays(last, 1).slice(0, 7) === month)
      last = addDays(last, 1);
    chunks.push({ first, last });
    first = addDays(last, 1);
  }
  return chunks;
}

/** A source is usual when it has a line on at least four in five of the window's days that have any line. */
function usualSources(rows: DayRow[]): string[] {
  const daysWithLines = rows.filter((r) => r.sources.length > 0).length;
  const days = new Map<string, number>();
  for (const row of rows)
    for (const s of row.sources) days.set(s.source, (days.get(s.source) ?? 0) + 1);
  return [...days.entries()]
    .filter(([, n]) => n * 5 >= daysWithLines * 4)
    .map(([source]) => source)
    .sort();
}

const attachedCount = (a: Attached | undefined): number =>
  a === undefined
    ? 0
    : a.events.length +
      a.transcripts.length +
      a.notes.length +
      a.mail.length +
      a.calls.length +
      a.messages.count +
      a.photos.count +
      a.keepers.length;

function rowOf(day: Day, entries: Entry[], reader: DayReader): DayRow {
  const dayStartMs = localToMs(day.day, "00:00", reader.timezone);
  const resolver = reader.judgements.resolver;
  const located = entries.some(
    (e) =>
      e.day === day.day &&
      e.line.kind === "location" &&
      resolver.retractedBy(e.line.id) === undefined,
  );
  const segments = day.timeline.filter((t): t is SegmentEntry => t.kind !== "flight");
  let moved = 0;
  const startedOnDay = (s: SegmentEntry): boolean => Date.parse(s.start) >= dayStartMs;
  for (const s of segments) {
    if (s.kind === "move" && startedOnDay(s)) moved += s.distance_m ?? 0;
    for (const inner of s.inside ?? [])
      if (inner.kind === "move" && startedOnDay(inner)) moved += inner.distance_m ?? 0;
  }
  const stays = segments.filter((s) => s.kind === "stay" || s.kind === "aboard");
  const names: string[] = [];
  const seen = new Set<string>();
  for (const s of segments) {
    for (const p of s.with?.confirmed ?? []) {
      const key = p.person === null ? `name:${p.name}` : `id:${p.person}`;
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(p.name);
    }
  }
  const after = day.nights.after;
  return {
    day: day.day,
    weekday: day.weekday,
    night: {
      where: after.where,
      home: after.home,
      aboard: after.aboard,
      in_transit: after.in_transit,
      stay: after.stay,
      located,
    },
    country: day.country.code,
    moved_m: moved,
    flights: day.flights.map((f) => ({
      carrier: f.carrier,
      number: f.number,
      from: f.from,
      to: f.to,
      evidence: f.evidence,
      line: f.line,
    })),
    stays: {
      count: stays.length,
      attached: segments.reduce((n, s) => n + attachedCount(s.attached), 0),
      with_attachments: stays.filter((s) => attachedCount(s.attached) > 0).length,
    },
    people: { confirmed: names.length, names },
    health: day.health,
    sources: day.sources,
    gaps: [],
  };
}

/** `0.0 km`, `1.1 km`, `119 km`, `1,471 km`: the day's kilometres as the row prints them. */
export function kilometresText(metres: number): string {
  const km = metres / 1000;
  if (km < 100) return `${roundTo(km, 1).toFixed(1)} km`;
  return `${roundHalfEven(km).toLocaleString("en-US")} km`;
}

/** `XY 561 OSL→ZRH`; `BGO→ENGM` without a designator; `?` for an airport the line does not name. */
function flightText(f: DayRowFlight): string {
  const designator = [f.carrier, f.number].filter((x): x is string => x !== null).join(" ");
  const route = `${f.from ?? "?"}→${f.to ?? "?"}`;
  return designator ? `${designator} ${route}` : route;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The text of one row, as the reference prints it: the date and weekday, the night and the country, the kilometres, then the rest. */
export function renderDayRow(row: DayRow): string {
  const night = row.night;
  let where: string;
  if (night.in_transit || night.where === null)
    where = night.located ? "in transit" : "no location";
  else where = night.home || row.country === null ? night.where : `${night.where} ${row.country}`;
  const parts: string[] = [];
  if (row.flights.length) parts.push(row.flights.map(flightText).join(", "));
  if (row.sources.length === 0) parts.push("nothing logged");
  else {
    const attached = row.stays.attached ? ` (${row.stays.attached} attached)` : "";
    parts.push(`${plural(row.stays.count, "stay")}${attached}`);
  }
  if (row.people.confirmed) parts.push(`with ${row.people.confirmed}`);
  const health = healthText(row.health);
  if (health !== undefined) parts.push(health);
  if (row.gaps.length) parts.push(`gap ${row.gaps.join(", ")}`);
  const km = kilometresText(row.moved_m);
  return `${row.day}  ${row.weekday.slice(0, 3)}  ${where.padEnd(28)}${km.padStart(11)}  ${parts.join(" · ")}\n`;
}

/** The text of every row, oldest first. */
export function renderDayRows(read: DayRows): string {
  return read.rows.map(renderDayRow).join("");
}
