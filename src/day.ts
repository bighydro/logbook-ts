import { airportAt, airportCode, countryOfZone, nearestAirport } from "./airports.js";
import {
  addDays,
  checkTimezone,
  isDay,
  localIso,
  localOf,
  localToMs,
  monthKey,
  utcIso,
  weekdayOf,
} from "./clock.js";
import { coordinates, distanceM, mean, roundHalfEven, roundTo } from "./geo.js";
import { eachLine, type MonthFile, monthFiles, parseLine } from "./lines.js";
import { keeperPhoto, payloadOf } from "./render.js";
import { asRef, type Ref, type Resolver } from "./resolve.js";
import {
  type Asset,
  type OwnerPolicy,
  type Place,
  readAssets,
  readOwnerPolicy,
  readPlaces,
  readStaySettings,
  type StaySettings,
} from "./settings.js";
import { readJudgements } from "./show.js";
import {
  deriveSegments,
  judged,
  markAboard,
  type Point,
  type Segment,
  type Span,
  type Stay,
} from "./stays.js";
import { formatRefusal, LogbookError, readMeta } from "./store.js";
import type { JsonValue, Line, Payload } from "./types.js";

export interface DayOptions {
  /** The local day, `YYYY-MM-DD`, in the record's zone. */
  day: string;
}

/** Where a night was spent: the longest stay in the night window, or in transit. */
export interface DayNight {
  day: string;
  where: string | null;
  home: boolean;
  aboard: string | null;
  in_transit: boolean;
  stay: string | null;
  /** The night's `lat` and `lon`: the stay's centre, or aboard an asset the anchorage it lay at. */
  position: { lat: number; lon: number } | null;
  lines: string[];
}

/** The country the day counts for, and how it was decided. */
export interface DayCountry {
  code: string | null;
  /** `place` (the place's own country) or `airport` (the nearest large airport's zone). */
  method: string | null;
  by: string | null;
  /** `night` when read from the night's stay, `longest stay` from the day's when the night is in transit. */
  from: string | null;
}

/** One calendar entry, the copies several calendars carry folded into it. */
export interface AttachedEvent {
  title: string;
  start: string;
  end: string | null;
  line: string;
  sources: string[];
  lines: string[];
}

export interface AllDayEntry {
  title: string;
  line: string;
  sources: string[];
  lines: string[];
}

export interface AttachedMail {
  subject: string;
  thread: string;
  messages: number;
  lines: string[];
}

export interface AttachedCall {
  who: string;
  direction: string | null;
  answered: boolean;
  duration_s: number;
  line: string;
}

/** What fell inside a row of the day. */
export interface Attached {
  events: AttachedEvent[];
  transcripts: Array<{ title: string; line: string }>;
  notes: Array<{ text: string; line: string }>;
  mail: AttachedMail[];
  calls: AttachedCall[];
  messages: { count: number; lines: string[] };
  photos: { count: number; lines: string[] };
  keepers: Array<{ name: string; lane: string | null; line: string }>;
}

/** Someone there, by the record's evidence. */
export interface Person {
  /** The entity id, or null for a name the record resolves to no person. */
  person: string | null;
  name: string;
  status: "confirmed" | "proposed";
  confidence: number;
  sources: string[];
  reasons: string[];
  lines: string[];
}

export interface Company {
  confirmed: Person[];
  proposed: Person[];
}

export interface WithinDay {
  start: string;
  end: string;
  duration_s: number;
}

/** A stay, stop, move, or a run aboard an asset, as a row of the day. */
export interface SegmentEntry {
  id: string;
  kind: "stay" | "stop" | "move" | "aboard";
  start: string;
  end: string;
  start_local: string;
  end_local: string;
  within_day: WithinDay;
  duration_s: number;
  where: string | null;
  place: string | null;
  lat: number | null;
  lon: number | null;
  aboard: string | null;
  asset?: { id: string; name: string; kind: string };
  mode: string | null;
  distance_m: number | null;
  airports: string[];
  points: number;
  promoted: boolean;
  gap: boolean;
  inside?: SegmentEntry[];
  lines: { first: string; last: string };
  attached?: Attached;
  with?: Company;
  /** The ids of the flight lines standing that this move covers. */
  flights?: string[];
}

/** A `flight/v1` line standing, as a row of the day. */
export interface FlightEntry {
  id: string;
  kind: "flight";
  start: string;
  end: string | null;
  start_local: string;
  end_local: string | null;
  carrier: string | null;
  number: string | null;
  from: string | null;
  to: string | null;
  evidence: string | null;
  role: string | null;
  aircraft: JsonValue | null;
  line: string;
}

export type TimelineEntry = SegmentEntry | FlightEntry;

/** A line of the day that fell inside no stay or move. */
export interface UnplacedEntry {
  kind: string;
  at: string;
  end: string | null;
  /** The event's title, the transcript's, the note's first line, the mail's subject, the call's counterparty. */
  title: string;
  line: string;
  sources?: string[];
  lines?: string[];
}

export interface DayHealth {
  sleep_h: number | null;
  steps: number | null;
  resting_hr: number | null;
  hrv: number | null;
  lines: string[];
}

export interface SourceCount {
  source: string;
  lines: number;
  first: string;
  newest: string;
}

/** The Day: what `day --json` prints, and what the text is rendered from. */
export interface Day {
  day: string;
  weekday: string;
  tz: string;
  nights: { before: DayNight; after: DayNight };
  country: DayCountry;
  all_day: AllDayEntry[];
  timeline: TimelineEntry[];
  flights: FlightEntry[];
  unplaced: UnplacedEntry[];
  /** null when no health line is on the day. */
  health: DayHealth | null;
  sources: SourceCount[];
}

/** A line read for the day, with its instant and span in ms. */
export interface Entry {
  line: Line;
  ms: number;
  endMs: number;
  /** The local day of `at`. */
  day: string;
}

/** What deciding who was there needs: who a ref is, the named places, and who the owner is. */
export interface PeopleContext {
  resolver: Resolver;
  places: Place[];
  owner: OwnerIdentity;
}

interface Context extends PeopleContext {
  timezone: string;
  day: string;
  dayStartMs: number;
  dayEndMs: number;
  supersededFlights: Map<string, number>;
  settings: StaySettings;
}

const SOURCE_RANK: Record<string, number> = { calendar: 0, transcript: 1, note: 2, photo: 3 };
const CONFIDENCE: Record<string, number> = {
  calendar: 0.8,
  transcript: 0.9,
  note: 1.0,
  photo: 0.5,
};
/** A note's first line is cut to this many characters, the last an ellipsis. */
const NOTE_WIDTH = 72;
/** The nearest large airport within this many km names a place's country (README, countries). */
const COUNTRY_AIRPORT_KM = 300;
/** The city of the nearest large airport within this many km labels an unnamed stay. */
const CITY_AIRPORT_KM = 30;
/** An unnamed stay is labelled `near` the nearest named place within this many km, else by a city. */
const NEAR_PLACE_KM = 5;
/** A night whose stay centre is within this of a home place is at home whatever the radius. */
const HOME_M = 400;
/** A calendar entry held within this of the stay places its attendees there. */
const HELD_AT_M = 1000;
/** A calendar entry with no location confirms its attendees when it overlaps the stay by more than this. */
const HELD_OVERLAP_S = 3600;

/**
 * One calendar day of the record read back as the reference's `logbook day` prints it: the nights
 * either side, the country, the timeline of stays, stops, moves and flights with what attached to
 * each and who was there, the lines placed nowhere, the health line and the sources. Derived every
 * time from the lines; nothing is written.
 */
export function readDay(root: string, options: DayOptions): Day {
  const { day } = options;
  if (!isDay(day)) throw new LogbookError(`not a day: ${day}`);
  const meta = readMeta(root);
  const refusal = formatRefusal(meta);
  if (refusal) throw new LogbookError(refusal);
  const timezone = meta.timezone;
  if (typeof timezone !== "string" || timezone === "") {
    throw new LogbookError("logbook.json: timezone is missing");
  }
  checkTimezone(timezone);

  const settings = readStaySettings(root);
  const places = readPlaces(root);
  const assets = readAssets(root);
  const policy = readOwnerPolicy(root);
  const files = monthFiles(root);
  const { resolver, supersededFlights } = readJudgements(files);

  // The window: the day before (its night is the night before) to the end of the night after.
  const before = addDays(day, -1);
  const after = addDays(day, 1);
  const windowStartMs = localToMs(before, "00:00", timezone);
  const windowEndMs = localToMs(after, settings.night[1], timezone);
  const dayStartMs = localToMs(day, "00:00", timezone);
  const dayEndMs = localToMs(after, "00:00", timezone);
  const entries = readWindow(files, windowStartMs, windowEndMs, timezone);
  const standing = (e: Entry): boolean => resolver.retractedBy(e.line.id) === undefined;

  const ownerEmails = Array.isArray(meta.owner_emails)
    ? meta.owner_emails.filter((v): v is string => typeof v === "string")
    : [];
  const owner = ownerIdentity(resolver, policy, ownerEmails, meta.owner_id);
  const ctx: Context = {
    timezone,
    day,
    dayStartMs,
    dayEndMs,
    resolver,
    supersededFlights,
    places,
    settings,
    owner,
  };

  // The tracks: the owner's points, and each registered asset's.
  const ownerPoints: Point[] = [];
  const tracks = assets.map((asset) => ({ asset, points: [] as Point[] }));
  const byAsset = new Map(tracks.map((t) => [t.asset.id, t.points]));
  for (const e of entries) {
    if (e.line.kind !== "location" || !standing(e)) continue;
    const p = payloadOf(e.line);
    if (typeof p.lat !== "number" || typeof p.lon !== "number") continue;
    const point: Point = { ms: e.ms, lat: p.lat, lon: p.lon, id: e.line.id, seq: e.line.seq };
    if (p.subject === undefined || p.subject === null) ownerPoints.push(point);
    else if (typeof p.subject === "string") byAsset.get(p.subject)?.push(point);
  }
  const byTime = (a: Point, b: Point) => a.ms - b.ms || a.seq - b.seq;
  ownerPoints.sort(byTime);
  for (const t of tracks) t.points.sort(byTime);

  const evidence: Span[] = entries
    .filter((e) => standing(e) && promotes(e.line))
    .map((e) => ({ startMs: e.ms, endMs: e.endMs }));
  const segments = deriveSegments(ownerPoints, {
    settings,
    places,
    evidence,
    airportNear: (lat, lon) => {
      const near = nearestAirport(lat, lon, settings.airport_km);
      return near === undefined ? undefined : airportCode(near.airport);
    },
  });
  markAboard(segments, tracks, settings);

  // The day's own lines: everything whose `at` is on the day, retractions aside.
  const dayLines = entries.filter((e) => e.day === day && e.line.kind !== "retraction");
  const dayStanding = dayLines.filter(standing);

  const flights = dayStanding
    .filter(
      (e) =>
        e.line.kind === "flight" &&
        payloadOf(e.line).schema === "flight/v1" &&
        !supersededFlights.has(e.line.id),
    )
    .map((e) => flightEntry(e, ctx));

  const allDay = foldEvents(
    dayStanding.filter((e) => e.line.kind === "event" && payloadOf(e.line).all_day === true),
  ).map(({ title, line, sources, lines }) => ({ title, line, sources, lines }));

  // The rows: the segments of the window, a run aboard one asset folded into one, those that touch
  // the day. A run is folded over the whole window, so one that began the day before is still one
  // container today, whole.
  const rows = aboardRuns(segments);
  const dayRows = rows.filter((r) => r.startMs < dayEndMs && r.endMs > dayStartMs);
  const { timeline, unplaced } = buildTimeline(dayRows, flights, dayStanding, ctx);

  const nightBefore = nightOf(before, rows, ctx);
  const nightAfter = nightOf(day, rows, ctx);

  return {
    day,
    weekday: weekdayOf(day),
    tz: timezone,
    nights: { before: nightBefore, after: nightAfter },
    country: countryOf(nightAfter, rows, ctx),
    all_day: allDay,
    timeline,
    flights,
    unplaced,
    health: health(entries.filter(standing), ctx),
    sources: sources(dayStanding),
  };
}

/** Every line of the month files the window can touch whose `at` falls inside it, in file order. */
function readWindow(files: MonthFile[], startMs: number, endMs: number, timezone: string): Entry[] {
  const firstMonth = monthKey(startMs);
  const lastMonth = monthKey(endMs);
  const entries: Entry[] = [];
  for (const month of files) {
    const key = `${month.year}-${month.month}`;
    if (key < firstMonth || key > lastMonth) continue;
    for (const { raw, row } of eachLine(month.file)) {
      const parsed = parseLine(raw, `${month.rel} line ${row}`);
      if ("error" in parsed) continue; // verify reports it; a reader reads what it can
      const { line } = parsed;
      if (typeof line.at !== "string") continue;
      const ms = Date.parse(line.at);
      if (Number.isNaN(ms) || ms < startMs || ms > endMs) continue;
      const end = typeof line.end === "string" ? Date.parse(line.end) : Number.NaN;
      entries.push({
        line,
        ms,
        endMs: Number.isNaN(end) || end < ms ? ms : end,
        day: localOf(ms, timezone).day,
      });
    }
  }
  entries.sort((a, b) => a.ms - b.ms || a.line.seq - b.line.seq);
  return entries;
}

/** Whether a line standing promotes a short cluster to a stay: something happened there. */
export function promotes(line: Line): boolean {
  switch (line.kind) {
    case "event":
    case "transcript":
    case "note":
    case "call":
    case "message":
    case "photo":
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Rows: segments, and runs of segments aboard one asset

/**
 * A stay aboard an asset is a container: the run of consecutive segments aboard one asset, with
 * at least one stay in it, is one row from the first's start to the last's end, the run inside it.
 * A move aboard with no stay either side (a ferry walked on and off) stays a move.
 */
interface AboardRun {
  kind: "aboard";
  asset: Asset;
  segments: Segment[];
  startMs: number;
  endMs: number;
}

type Row = Segment | AboardRun;

function aboardRuns(segments: Segment[]): Row[] {
  const rows: Row[] = [];
  let i = 0;
  while (i < segments.length) {
    const first = segments[i] as Segment;
    let j = i + 1;
    while (
      first.aboard !== undefined &&
      j < segments.length &&
      (segments[j] as Segment).aboard?.id === first.aboard.id
    )
      j += 1;
    const run = segments.slice(i, j);
    if (first.aboard !== undefined && run.some(isStay)) {
      rows.push({
        kind: "aboard",
        asset: first.aboard,
        segments: run,
        startMs: first.startMs,
        endMs: (run[run.length - 1] as Segment).endMs,
      });
    } else rows.push(...run);
    i = Math.max(j, i + 1);
  }
  return rows;
}

const isStay = (s: Segment): s is Stay => s.kind !== "move";

/** The inner stay of a run spent longest at: the run's centre, and the coordinate in its id. */
function centreOf(run: AboardRun): Stay | undefined {
  let centre: Stay | undefined;
  for (const s of run.segments) {
    if (isStay(s) && (centre === undefined || s.endMs - s.startMs > centre.endMs - centre.startMs))
      centre = s;
  }
  return centre;
}

/** The id a night names a row by: a stay's own, a run's as a stay at its centre. */
function rowStayId(row: Row): string {
  if (row.kind !== "aboard") return segmentId(row);
  const centre = centreOf(row);
  const at = centre === undefined ? "" : `@${coordinates(centre.lat, centre.lon)}`;
  return `stay:owner:${stamp(row.startMs)}${at}`;
}

const stamp = (ms: number): string => {
  const d = new Date(Math.floor(ms / 60_000) * 60_000);
  return `${d.toISOString().slice(0, 10).replace(/-/g, "")}T${d.toISOString().slice(11, 16).replace(":", "")}Z`;
};

function segmentId(segment: Segment): string {
  if (segment.kind === "move") return `move:owner:${stamp(segment.startMs)}`;
  return `${segment.kind}:owner:${stamp(segment.startMs)}@${coordinates(segment.lat, segment.lon)}`;
}

/**
 * The label of a stay: its place; the airport it is at; else its coordinates, with the nearest
 * named place within 5 km (`59.9200,10.7400 near Home, 1.0 km`) or, failing one, the city of the
 * nearest large airport within 30 km.
 */
function whereOf(stay: Stay, places: Place[]): string {
  if (stay.place !== undefined) return stay.place.name;
  const at = airportAt(stay.lat, stay.lon);
  if (at !== undefined) return `${airportCode(at)}, ${at.city}`;
  const coords = coordinates(stay.lat, stay.lon);
  let nearest: { place: Place; m: number } | undefined;
  for (const place of places) {
    const m = distanceM(stay.lat, stay.lon, place.lat, place.lon);
    if (m <= NEAR_PLACE_KM * 1000 && (nearest === undefined || m < nearest.m))
      nearest = { place, m };
  }
  if (nearest !== undefined)
    return `${coords} near ${nearest.place.name}, ${(nearest.m / 1000).toFixed(1)} km`;
  const near = nearestAirport(stay.lat, stay.lon, CITY_AIRPORT_KM);
  return near === undefined ? coords : `${coords} (${near.airport.city})`;
}

function withinDay(startMs: number, endMs: number, ctx: Context): WithinDay {
  const start = Math.max(startMs, ctx.dayStartMs);
  const end = Math.min(endMs, ctx.dayEndMs);
  return {
    start: utcIso(start),
    end: utcIso(end),
    duration_s: roundHalfEven((end - start) / 1000),
  };
}

function segmentEntry(segment: Segment, ctx: Context): SegmentEntry {
  const base = {
    id: segmentId(segment),
    kind: segment.kind,
    start: utcIso(segment.startMs),
    end: utcIso(segment.endMs),
    start_local: localIso(segment.startMs, ctx.timezone),
    end_local: localIso(segment.endMs, ctx.timezone),
    within_day: withinDay(segment.startMs, segment.endMs, ctx),
    duration_s: roundHalfEven((segment.endMs - segment.startMs) / 1000),
  };
  if (segment.kind === "move") {
    return {
      ...base,
      where: null,
      place: null,
      lat: null,
      lon: null,
      aboard: segment.aboard?.id ?? null,
      mode: segment.mode,
      distance_m: segment.distanceM,
      airports: [...segment.airports],
      points: segment.interior.length,
      promoted: false,
      gap: segment.gap,
      lines: { first: segment.first.id, last: segment.last.id },
    };
  }
  return {
    ...base,
    where: whereOf(segment, ctx.places),
    place: segment.place?.name ?? null,
    lat: roundTo(segment.lat, 6),
    lon: roundTo(segment.lon, 6),
    aboard: segment.aboard?.id ?? null,
    mode: null,
    distance_m: null,
    airports: [],
    points: segment.inside.length,
    promoted: segment.promoted,
    gap: false,
    lines: { first: segment.first.id, last: segment.last.id },
  };
}

function runEntry(run: AboardRun, ctx: Context): SegmentEntry {
  // The container is the whole run: its span, points, lines and centre. Inside it are the rows
  // that touch the day, and the distance is theirs.
  const today = run.segments.filter((s) => s.startMs < ctx.dayEndMs && s.endMs > ctx.dayStartMs);
  const inside = today.map((s) => segmentEntry(s, ctx));
  const centre = centreOf(run);
  const first = run.segments[0] as Segment;
  const last = run.segments[run.segments.length - 1] as Segment;
  return {
    id: `aboard:${run.asset.id}:${stamp(run.startMs)}`,
    kind: "aboard",
    start: utcIso(run.startMs),
    end: utcIso(run.endMs),
    start_local: localIso(run.startMs, ctx.timezone),
    end_local: localIso(run.endMs, ctx.timezone),
    within_day: withinDay(run.startMs, run.endMs, ctx),
    duration_s: roundHalfEven((run.endMs - run.startMs) / 1000),
    where: `aboard ${run.asset.name}`,
    place: null,
    lat: centre === undefined ? null : roundTo(centre.lat, 6),
    lon: centre === undefined ? null : roundTo(centre.lon, 6),
    aboard: run.asset.id,
    asset: { id: run.asset.id, name: run.asset.name, kind: run.asset.kind },
    mode: null,
    distance_m: today.reduce((sum, s) => sum + (s.kind === "move" ? s.distanceM : 0), 0),
    airports: [],
    points: run.segments.reduce((sum, s) => sum + judged(s).length, 0),
    promoted: false,
    gap: false,
    inside,
    lines: { first: first.first.id, last: last.last.id },
  };
}

// ---------------------------------------------------------------------------------------------
// The timeline: rows with what attached and who was there, the flights, the unplaced

const text = (value: JsonValue | undefined): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

function obj(value: JsonValue | undefined): { [key: string]: JsonValue } | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

/** An airline designator in a calendar title: `LX 561`, `XY561`. */
const DESIGNATOR = /\b([A-Z]{2})\s?(\d{1,4})\b/;

function eventKey(e: Entry): { span: string; title: string; flight: string | undefined } {
  const title = text(payloadOf(e.line).title) ?? "";
  const m = DESIGNATOR.exec(title);
  return {
    span: `${e.ms}|${typeof e.line.end === "string" ? e.line.end : ""}`,
    title: title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " "),
    flight: m ? `${m[1]}${m[2]}` : undefined,
  };
}

export interface Folded extends AttachedEvent {
  entries: Entry[];
}

/**
 * One calendar entry several calendars carry is one event: the same start and end, and the same
 * title (case, accents and whitespace aside) or the same flight in the title, from two or more
 * sources (SPEC-QUESTIONS 28). One calendar holding an entry twice is still two events.
 */
export function foldEvents(events: Entry[]): Folded[] {
  const out: Folded[] = [];
  const taken = new Set<string>();
  for (let i = 0; i < events.length; i++) {
    const first = events[i] as Entry;
    if (taken.has(first.line.id)) continue;
    const key = eventKey(first);
    const members = [first];
    for (let j = i + 1; j < events.length; j++) {
      const other = events[j] as Entry;
      if (taken.has(other.line.id)) continue;
      const k = eventKey(other);
      if (
        k.span === key.span &&
        (k.title === key.title || (key.flight !== undefined && k.flight === key.flight))
      )
        members.push(other);
    }
    const sources = [...new Set(members.map((m) => String(m.line.source)))];
    const group = sources.length >= 2 ? members : [first];
    for (const m of group) taken.add(m.line.id);
    out.push({
      title: text(payloadOf(first.line).title) ?? "",
      start: first.line.at,
      end: typeof first.line.end === "string" ? first.line.end : null,
      line: first.line.id,
      sources: sources.length >= 2 ? sources : [String(first.line.source)],
      lines: group.map((m) => m.line.id),
      entries: group,
    });
  }
  return out;
}

const emptyAttached = (): Attached => ({
  events: [],
  transcripts: [],
  notes: [],
  mail: [],
  calls: [],
  messages: { count: 0, lines: [] },
  photos: { count: 0, lines: [] },
  keepers: [],
});

/** A note's first line, cut to 72 characters with an ellipsis. */
export function noteText(body: string): string {
  const first = body.split(/\r\n|\r|\n/)[0] ?? "";
  const chars = Array.from(first);
  return chars.length > NOTE_WIDTH ? `${chars.slice(0, NOTE_WIDTH - 1).join("")}…` : first;
}

function callEntry(e: Entry, ctx: Context): AttachedCall {
  const p = payloadOf(e.line);
  const ref = asRef(p.counterparty);
  const who = (ref && ctx.resolver.name(ref)) ?? ref?.value ?? "withheld";
  return {
    who,
    direction: text(p.direction) ?? null,
    answered: p.answered === true,
    duration_s: typeof p.duration_s === "number" ? p.duration_s : 0,
    line: e.line.id,
  };
}

function flightEntry(e: Entry, ctx: Context): FlightEntry {
  const p = payloadOf(e.line);
  const code = (o: JsonValue | undefined): string | null =>
    text(obj(o)?.iata) ?? text(obj(o)?.icao) ?? null;
  const end = typeof e.line.end === "string" ? e.line.end : null;
  return {
    id: e.line.id,
    kind: "flight",
    start: e.line.at,
    end,
    start_local: localIso(e.ms, ctx.timezone),
    end_local: end === null ? null : localIso(e.endMs, ctx.timezone),
    carrier: text(p.carrier) ?? null,
    number: text(p.number) ?? null,
    from: code(p.from),
    to: code(p.to),
    evidence: text(p.evidence) ?? null,
    role: text(p.role) ?? null,
    aircraft: obj(p.aircraft) ?? null,
    line: e.line.id,
  };
}

/** Whether a line falls inside a row: a span overlaps it for longer than nothing, an instant lies within it. */
const overlaps = (rowStart: number, rowEnd: number, start: number, end: number): boolean =>
  end > start ? start < rowEnd && end > rowStart : start >= rowStart && start <= rowEnd;

interface Placed {
  row: Row;
  entry: SegmentEntry;
  attached: Attached;
  /** The evidence attached, for the company. */
  events: Folded[];
  transcripts: Entry[];
  notes: Entry[];
  photos: Entry[];
}

function buildTimeline(
  rows: Row[],
  flights: FlightEntry[],
  lines: Entry[],
  ctx: Context,
): { timeline: TimelineEntry[]; unplaced: UnplacedEntry[] } {
  const placed: Placed[] = rows.map((row) => ({
    row,
    entry: row.kind === "aboard" ? runEntry(row, ctx) : segmentEntry(row, ctx),
    attached: emptyAttached(),
    events: [],
    transcripts: [],
    notes: [],
    photos: [],
  }));
  const holds = (p: Placed, startMs: number, endMs: number): boolean =>
    !(p.row.kind === "move" && p.row.gap) && overlaps(p.row.startMs, p.row.endMs, startMs, endMs);
  const unplaced: UnplacedEntry[] = [];

  const events = foldEvents(
    lines.filter((e) => e.line.kind === "event" && payloadOf(e.line).all_day !== true),
  );
  for (const event of events) {
    const first = event.entries[0] as Entry;
    const attached: AttachedEvent = {
      title: event.title,
      start: event.start,
      end: event.end,
      line: event.line,
      sources: event.sources,
      lines: event.lines,
    };
    let where = 0;
    for (const p of placed) {
      if (!holds(p, first.ms, first.endMs)) continue;
      p.attached.events.push(attached);
      p.events.push(event);
      where += 1;
    }
    if (where === 0)
      unplaced.push({
        kind: "event",
        at: event.start,
        end: event.end,
        title: event.title,
        line: event.line,
        sources: event.sources,
        lines: event.lines,
      });
  }

  const mailByRow = new Map<Placed, Entry[]>();
  for (const e of lines) {
    const kind = e.line.kind;
    if (kind === "event" || kind === "location" || kind === "flight") continue;
    const p = payloadOf(e.line);
    let where = 0;
    for (const row of placed) {
      if (!holds(row, e.ms, e.endMs)) continue;
      where += 1;
      switch (kind) {
        case "transcript":
          row.attached.transcripts.push({ title: text(p.title) ?? "transcript", line: e.line.id });
          row.transcripts.push(e);
          break;
        case "note":
          row.attached.notes.push({ text: noteText(text(p.text) ?? ""), line: e.line.id });
          row.notes.push(e);
          break;
        case "mail": {
          const list = mailByRow.get(row) ?? [];
          list.push(e);
          mailByRow.set(row, list);
          break;
        }
        case "call":
          row.attached.calls.push(callEntry(e, ctx));
          break;
        case "message":
          row.attached.messages.count += 1;
          row.attached.messages.lines.push(e.line.id);
          break;
        case "photo":
          row.attached.photos.count += 1;
          row.attached.photos.lines.push(e.line.id);
          row.photos.push(e);
          break;
        case "keeper":
          row.attached.keepers.push({
            name: keeperPhoto(p),
            lane: text(p.lane) ?? null,
            line: e.line.id,
          });
          break;
        default:
          where -= 1; // not something a row attaches
      }
    }
    if (where === 0) {
      switch (kind) {
        case "transcript":
        case "note":
        case "mail":
        case "call": {
          const label =
            kind === "transcript"
              ? (text(p.title) ?? "transcript")
              : kind === "note"
                ? noteText(text(p.text) ?? "")
                : kind === "mail"
                  ? (text(p.subject) ?? "(no subject)")
                  : (asRef(p.counterparty)?.value ?? "withheld");
          unplaced.push({
            kind,
            at: e.line.at,
            end: typeof e.line.end === "string" ? e.line.end : null,
            title: label,
            line: e.line.id,
          });
          break;
        }
        default:
      }
    }
  }
  for (const [row, mails] of mailByRow) {
    const threads = new Map<string, Entry[]>();
    for (const e of mails) {
      const thread = text(payloadOf(e.line).thread) ?? e.line.id;
      const list = threads.get(thread) ?? [];
      list.push(e);
      threads.set(thread, list);
    }
    for (const [thread, list] of threads) {
      row.attached.mail.push({
        subject: text(payloadOf((list[0] as Entry).line).subject) ?? "(no subject)",
        thread,
        messages: list.length,
        lines: list.map((e) => e.line.id),
      });
    }
  }

  const timeline: TimelineEntry[] = [];
  for (const p of placed) {
    const entry = p.entry;
    entry.attached = p.attached;
    entry.with =
      p.row.kind === "move"
        ? { confirmed: [], proposed: [] }
        : company(
            p.row.kind === "aboard"
              ? p.row.segments.filter((s): s is Stay => s.kind !== "move")
              : [p.row],
            p,
            ctx,
          );
    if (p.row.kind === "move") {
      const move = p.row;
      entry.flights = flights
        .filter((f) =>
          overlaps(
            move.startMs,
            move.endMs,
            Date.parse(f.start),
            f.end === null ? Date.parse(f.start) : Date.parse(f.end),
          ),
        )
        .map((f) => f.id);
    }
    timeline.push(entry);
  }
  const startOf = (t: TimelineEntry): number => Date.parse(t.start);
  const merged: TimelineEntry[] = [...timeline, ...flights];
  merged.sort((a, b) => startOf(a) - startOf(b) || rank(a) - rank(b));
  unplaced.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { timeline: merged, unplaced };
}

const rank = (t: TimelineEntry): number => (t.kind === "flight" ? 1 : 0);

/** `→ Ola Nordmann, 15 min`: the call as a row prints it. */
export function callText(call: AttachedCall): string {
  const outgoing = call.direction === "outgoing";
  const parts = [`${outgoing ? "→" : "←"} ${call.who}`];
  if (!call.answered) parts.push(outgoing ? "no answer" : "missed");
  else if (call.duration_s >= 60) parts.push(`${Math.floor(call.duration_s / 60)} min`);
  else parts.push(`${call.duration_s} s`);
  return parts.join(", ");
}

// ---------------------------------------------------------------------------------------------
// Who was there

export interface OwnerIdentity {
  ids: Set<string>;
  names: Set<string>;
}

/** Who the owner is: `owner_id` and `owner_emails` in logbook.json, the resolution lines naming those, `policy/owner.json`. */
export function ownerIdentity(
  resolver: Resolver,
  policy: OwnerPolicy,
  ownerEmails: string[],
  ownerId: JsonValue | undefined,
): OwnerIdentity {
  const ids = new Set<string>();
  const names = new Set<string>(policy.names.map((n) => n.toLowerCase()));
  if (typeof ownerId === "string") ids.add(ownerId);
  const refs: Ref[] = [
    ...ownerEmails.map((value) => ({ kind: "email", value })),
    ...policy.emails.map((value) => ({ kind: "email", value })),
    ...policy.phones.map((value) => ({ kind: "phone", value })),
  ];
  for (const ref of refs) {
    const entity = resolver.entity(ref);
    if (entity === undefined) continue;
    ids.add(entity.id);
    if (entity.label !== undefined) names.add(entity.label.toLowerCase());
  }
  for (const [id, label] of resolver.people()) if (ids.has(id)) names.add(label.toLowerCase());
  return { ids, names };
}

interface Found {
  person: string | null;
  name: string;
  source: string;
  reason: string;
  line: string;
  confirms: boolean;
  confidence: number;
}

/** Someone evidence names: a person the record resolves, or a name alone (`id` null) when it does not. */
interface Someone {
  id: string | null;
  name: string;
}

/** Who a ref is: the person the record resolves it to, else the name the source gave, else nobody; never the owner. */
function personOf(
  ref: Ref | undefined,
  fallback: string | undefined,
  ctx: PeopleContext,
): Someone | undefined {
  const entity = ref === undefined ? undefined : ctx.resolver.entity(ref);
  if (entity !== undefined && entity.type === "person" && entity.label !== undefined) {
    if (ctx.owner.ids.has(entity.id) || ctx.owner.names.has(entity.label.toLowerCase()))
      return undefined;
    return { id: entity.id, name: entity.label };
  }
  if (fallback === undefined || ctx.owner.names.has(fallback.toLowerCase())) return undefined;
  return { id: null, name: fallback };
}

/** The attendees of a calendar entry, in its order: the people the record names, else by their display name. */
function attendees(e: Entry, ctx: PeopleContext): Someone[] {
  const list = payloadOf(e.line).attendees;
  if (!Array.isArray(list)) return [];
  const out: Someone[] = [];
  for (const item of list) {
    const ref = typeof item === "string" ? { kind: "email", value: item } : asRef(obj(item)?.ref);
    const person = personOf(ref, text(obj(item)?.name), ctx);
    if (person !== undefined && !out.some((o) => identity(o) === identity(person)))
      out.push(person);
  }
  return out;
}

/** What two mentions share to be one person: the entity id, or the name when the record has none. */
const identity = (who: Someone): string => (who.id === null ? `name:${who.name}` : `id:${who.id}`);

/** Names a transcript gives a speaker that are nobody: `Speaker A`, `me`, `Unknown`. */
const NOBODY = /^(speaker\s+\S+|me|unknown)$/i;

/** Whether a timed calendar entry was held at the stay: its location, or a long overlap with no location. */
function heldAt(event: Entry, stays: Stay[], ctx: PeopleContext): boolean {
  const p = payloadOf(event.line);
  const location = text(p.location);
  if (location !== undefined) {
    const place = ctx.places.find((pl) => pl.name.toLowerCase() === location.toLowerCase());
    if (place === undefined) return false;
    return stays.some((s) => distanceM(place.lat, place.lon, s.lat, s.lon) <= HELD_AT_M);
  }
  return stays.some(
    (s) => Math.min(event.endMs, s.endMs) - Math.max(event.ms, s.startMs) > HELD_OVERLAP_S * 1000,
  );
}

/** A note's `with <name>`: every person the record names who follows a `with` in one sentence. */
function namedWith(body: string, ctx: PeopleContext): Array<Someone & { index: number }> {
  const out: Array<Someone & { index: number }> = [];
  const people = ctx.resolver.people();
  let offset = 0;
  for (const sentence of body.split(/(?<=[.!?;\n])/)) {
    const m = /\bwith\b/i.exec(sentence);
    if (m !== null) {
      for (const [id, name] of people) {
        if (ctx.owner.ids.has(id) || ctx.owner.names.has(name.toLowerCase())) continue;
        const at = sentence.indexOf(name, m.index + m[0].length);
        if (at === -1) continue;
        if (!out.some((o) => o.id === id)) out.push({ id, name, index: offset + at });
      }
    }
    offset += sentence.length;
  }
  return out.sort((a, b) => a.index - b.index);
}

/** The evidence attached to a stay or a run aboard that can say who was there. */
export interface RowEvidence {
  events: Folded[];
  transcripts: Entry[];
  notes: Entry[];
  photos: Entry[];
}

/**
 * The company of a stay or a run aboard (`stays`: the stay, or the stays inside the run), from the
 * evidence attached to it: confirmed by an attendee of a timed calendar entry held at the stay, a
 * participant of a transcript the record resolves, a note that says `with <name>`; proposed by a
 * face the library tagged. The owner is never their own company.
 */
export function company(stays: Stay[], p: RowEvidence, ctx: PeopleContext): Company {
  const found: Found[] = [];
  for (const event of p.events) {
    const first = event.entries[0] as Entry;
    if (!heldAt(first, stays, ctx)) continue;
    for (const who of attendees(first, ctx)) {
      found.push({
        person: who.id,
        name: who.name,
        source: "calendar",
        reason: `attendee of ${event.title}`,
        line: event.line,
        confirms: true,
        confidence: CONFIDENCE.calendar as number,
      });
    }
  }
  for (const t of p.transcripts) {
    const payload = payloadOf(t.line);
    const title = text(payload.title) ?? "transcript";
    if (!Array.isArray(payload.participants)) continue;
    for (const item of payload.participants) {
      const o = obj(item);
      if (o === undefined) continue;
      const refs: Ref[] = [];
      const email = text(o.email);
      const phone = text(o.phone);
      const provider = text(o.provider_id);
      if (email !== undefined) refs.push({ kind: "email", value: email });
      if (phone !== undefined) refs.push({ kind: "phone", value: phone });
      if (provider !== undefined) refs.push({ kind: "provider_id", value: provider });
      const name = text(o.name);
      let who: Someone | undefined;
      for (const ref of refs) {
        who = personOf(ref, undefined, ctx);
        if (who !== undefined) break;
      }
      if (who === undefined && name !== undefined && !NOBODY.test(name.trim()))
        who = personOf(undefined, name, ctx);
      if (who === undefined) continue;
      found.push({
        person: who.id,
        name: who.name,
        source: "transcript",
        reason: `spoke in ${title}`,
        line: t.line.id,
        confirms: true,
        confidence: CONFIDENCE.transcript as number,
      });
    }
  }
  for (const n of p.notes) {
    for (const who of namedWith(text(payloadOf(n.line).text) ?? "", ctx)) {
      found.push({
        person: who.id,
        name: who.name,
        source: "note",
        reason: `note says with ${who.name}`,
        line: n.line.id,
        confirms: true,
        confidence: CONFIDENCE.note as number,
      });
    }
  }
  for (const photo of p.photos) {
    const payload = payloadOf(photo.line);
    const library = text(payload.library);
    if (!Array.isArray(payload.people) || library === undefined) continue;
    const name = keeperPhotoName(payload);
    for (const face of payload.people) {
      if (typeof face !== "string") continue;
      const who = personOf(
        { kind: "provider_id", value: `${library}:${face}` },
        `${library}:${face}`,
        ctx,
      );
      if (who === undefined) continue;
      found.push({
        person: who.id,
        name: who.name,
        source: "photo",
        reason: `face in ${name}`,
        line: photo.line.id,
        confirms: false,
        confidence: CONFIDENCE.photo as number,
      });
    }
  }

  const people = new Map<string, Person & { order: number; confirms: boolean }>();
  let order = 0;
  for (const f of found) {
    const key = identity({ id: f.person, name: f.name });
    let person = people.get(key);
    if (person === undefined) {
      person = {
        person: f.person,
        name: f.name,
        status: "proposed",
        confidence: 0,
        sources: [],
        reasons: [],
        lines: [],
        order: order++,
        confirms: false,
      };
      people.set(key, person);
    }
    person.confirms = person.confirms || f.confirms;
    person.confidence = Math.max(person.confidence, f.confidence);
    person.sources.push(f.source);
    person.reasons.push(f.reason);
    person.lines.push(f.line);
  }
  const finish = (person: Person & { order: number; confirms: boolean }): Person => {
    const idx = person.sources.map((_, i) => i);
    idx.sort(
      (a, b) =>
        (SOURCE_RANK[person.sources[a] as string] ?? 9) -
          (SOURCE_RANK[person.sources[b] as string] ?? 9) || a - b,
    );
    const sources: string[] = [];
    const reasons: string[] = [];
    const lines: string[] = [];
    for (const i of idx) {
      const source = person.sources[i] as string;
      if (!sources.includes(source)) sources.push(source);
      reasons.push(person.reasons[i] as string);
      lines.push(person.lines[i] as string);
    }
    return {
      person: person.person,
      name: person.name,
      status: person.confirms ? "confirmed" : "proposed",
      confidence: person.confidence,
      sources,
      reasons,
      lines,
    };
  };
  // The surest first: by confidence, then as the evidence named them.
  const all = [...people.values()]
    .sort((a, b) => b.confidence - a.confidence || a.order - b.order)
    .map(finish);
  return {
    confirmed: all.filter((x) => x.status === "confirmed"),
    proposed: all.filter((x) => x.status === "proposed"),
  };
}

/** How a photo is named in a reason: its file name, else its asset id, else its id. */
function keeperPhotoName(p: Payload): string {
  return text(p.file_name) ?? text(p.asset_id) ?? "?";
}

// ---------------------------------------------------------------------------------------------
// Nights and the country

/** The home place a stay's centre is within 400 m of, if any; a stay at that place counts. */
function homeOf(stay: Stay, places: Place[]): Place | undefined {
  if (stay.place?.kind === "home") return stay.place;
  return places.find(
    (p) => p.kind === "home" && distanceM(stay.lat, stay.lon, p.lat, p.lon) <= HOME_M,
  );
}

/** Whether a night at this stay is at home: in a place of kind `home`, or within 400 m of one whatever its radius. */
export function isHome(stay: Stay, places: Place[]): boolean {
  return homeOf(stay, places) !== undefined;
}

const position = (at: { lat: number; lon: number }): { lat: number; lon: number } => ({
  lat: roundTo(at.lat, 6),
  lon: roundTo(at.lon, 6),
});

/** The part of a span inside a window, in ms; nothing when they do not meet. */
const overlapMs = (
  startMs: number,
  endMs: number,
  windowStart: number,
  windowEnd: number,
): number => Math.min(endMs, windowEnd) - Math.max(startMs, windowStart);

/**
 * The night of a day: the stay with the longest part inside the night window, a stay aboard an
 * asset counted whole, so a passage through the night is a night aboard; none is in transit. A
 * night aboard carries the asset's position: the inner stay that held the longest part of the
 * night window. A night within 400 m of a home place names that place.
 */
function nightOf(day: string, rows: Row[], ctx: Context): DayNight {
  const startMs = localToMs(day, ctx.settings.night[0], ctx.timezone);
  const endMs = localToMs(addDays(day, 1), ctx.settings.night[1], ctx.timezone);
  let best: { row: Stay | AboardRun; overlap: number } | undefined;
  for (const row of rows) {
    if (row.kind === "move") continue;
    const overlap = overlapMs(row.startMs, row.endMs, startMs, endMs);
    if (overlap > 0 && (best === undefined || overlap > best.overlap)) best = { row, overlap };
  }
  if (best === undefined) {
    return {
      day,
      where: null,
      home: false,
      aboard: null,
      in_transit: true,
      stay: null,
      position: null,
      lines: [],
    };
  }
  const { row } = best;
  if (row.kind === "aboard") {
    let at: { stay: Stay; overlap: number } | undefined;
    for (const s of row.segments) {
      if (!isStay(s)) continue;
      const overlap = overlapMs(s.startMs, s.endMs, startMs, endMs);
      if (overlap > 0 && (at === undefined || overlap > at.overlap)) at = { stay: s, overlap };
    }
    const anchorage = at?.stay ?? centreOf(row);
    const first = row.segments[0] as Segment;
    const last = row.segments[row.segments.length - 1] as Segment;
    return {
      day,
      where: `aboard ${row.asset.name}`,
      home: false,
      aboard: row.asset.id,
      in_transit: false,
      stay: rowStayId(row),
      position: anchorage === undefined ? null : position(anchorage),
      lines: [first.first.id, last.last.id],
    };
  }
  const home = homeOf(row, ctx.places);
  return {
    day,
    where: row.place?.name ?? home?.name ?? whereOf(row, ctx.places),
    home: home !== undefined,
    aboard: row.aboard?.id ?? null,
    in_transit: false,
    stay: segmentId(row),
    position: position(row),
    lines: [row.first.id, row.last.id],
  };
}

/**
 * The country of the day: the night's place, or the nearest large airport to the night's position;
 * when the night is in transit, the longest stay of the day decides.
 */
function countryOf(night: DayNight, rows: Row[], ctx: Context): DayCountry {
  let row: Stay | AboardRun | undefined;
  let from: string | null = null;
  if (night.stay !== null) {
    row = rows.find((r): r is Stay | AboardRun => r.kind !== "move" && rowStayId(r) === night.stay);
    from = "night";
  } else {
    let longest = 0;
    for (const r of rows) {
      if (r.kind === "move") continue;
      const part = overlapMs(r.startMs, r.endMs, ctx.dayStartMs, ctx.dayEndMs);
      if (part > longest) {
        longest = part;
        row = r;
      }
    }
    if (row !== undefined) from = "longest stay";
  }
  if (row === undefined) return { code: null, method: null, by: null, from: null };
  const place = row.kind === "aboard" ? undefined : row.place;
  const at = night.position ?? (row.kind === "aboard" ? centreOf(row) : row);
  if (at === undefined) return { code: null, method: null, by: null, from };
  const country = countryAt(place, at.lat, at.lon);
  if (country === undefined) return { code: null, method: null, by: null, from };
  return { ...country, from };
}

/**
 * The country a position counts for, as `rollup countries` decides it: the place's own `country`
 * when the stay lies in a named place that has one, else the zone of the nearest large airport
 * within 300 km; undefined when no airport is that near.
 */
export function countryAt(
  place: Place | undefined,
  lat: number,
  lon: number,
): { code: string | null; method: string; by: string } | undefined {
  if (place?.country !== undefined) return { code: place.country, method: "place", by: place.name };
  const near = nearestAirport(lat, lon, COUNTRY_AIRPORT_KM);
  if (near === undefined) return undefined;
  return {
    code: countryOfZone(near.airport.tz) ?? null,
    method: "airport",
    by: airportCode(near.airport),
  };
}

// ---------------------------------------------------------------------------------------------
// Health and sources

const ASLEEP = new Set(["asleep", "core", "deep", "rem"]);

/** The night's sleep, the day's steps and resting heart rate from the `health-sample/v1` lines standing. */
function health(entries: Entry[], ctx: Context): DayHealth | null {
  const samples = entries.filter(
    (e) => e.line.kind === "health" && payloadOf(e.line).schema === "health-sample/v1",
  );
  // A correction that supersedes a line wins over it.
  const corrected = new Set<string>();
  for (const e of samples) {
    const s = payloadOf(e.line).supersedes;
    if (typeof s === "string") corrected.add(s);
  }
  const standing = samples.filter((e) => !corrected.has(e.line.id));
  const used: Entry[][] = [];
  const value = (e: Entry): number | undefined => {
    const v = payloadOf(e.line).value;
    return typeof v === "number" ? v : undefined;
  };

  // Sleep: the night that ends on the day, its asleep stages, per device the union, the longest device.
  const byDevice = new Map<string, Entry[]>();
  for (const e of standing) {
    const p = payloadOf(e.line);
    if (p.type !== "sleep" || typeof p.stage !== "string" || !ASLEEP.has(p.stage)) continue;
    if (localOf(e.endMs, ctx.timezone).day !== ctx.day) continue;
    const device = text(p.device) ?? "";
    const list = byDevice.get(device) ?? [];
    list.push(e);
    byDevice.set(device, list);
  }
  let sleep: { seconds: number; lines: Entry[] } | undefined;
  for (const list of byDevice.values()) {
    const spans = list.map((e) => [e.ms, e.endMs] as [number, number]).sort((a, b) => a[0] - b[0]);
    let seconds = 0;
    let cursor = -Infinity;
    for (const [s, e] of spans) {
      const start = Math.max(s, cursor);
      if (e > start) seconds += (e - start) / 1000;
      cursor = Math.max(cursor, e);
    }
    if (sleep === undefined || seconds > sleep.seconds) sleep = { seconds, lines: list };
  }
  if (sleep !== undefined) used.push(sleep.lines);

  // Steps: the larger device per quarter hour, summed.
  const buckets = new Map<string, Entry>();
  for (const e of standing) {
    const p = payloadOf(e.line);
    if (p.type !== "steps" || e.day !== ctx.day || value(e) === undefined) continue;
    const key = e.line.at;
    const current = buckets.get(key);
    if (current === undefined || (value(e) as number) > (value(current) as number))
      buckets.set(key, e);
  }
  let steps: number | null = null;
  if (buckets.size > 0) {
    steps = roundHalfEven([...buckets.values()].reduce((sum, e) => sum + (value(e) as number), 0));
    used.push([...buckets.values()]);
  }

  const meanOf = (type: string, convert: (v: number, unit: string) => number): number | null => {
    const readings = standing.filter(
      (e) => payloadOf(e.line).type === type && e.day === ctx.day && value(e) !== undefined,
    );
    if (readings.length === 0) return null;
    used.push(readings);
    return roundHalfEven(
      mean(readings.map((e) => convert(value(e) as number, text(payloadOf(e.line).unit) ?? ""))),
    );
  };
  const resting = meanOf("resting_hr", (v, unit) => (unit === "count/s" ? v * 60 : v));
  const hrv = meanOf("hrv", (v) => v);

  // The lines each number came from: the night's stages, the winning quarter hours, the readings.
  const lines: string[] = [];
  for (const group of used) {
    group.sort((a, b) => a.ms - b.ms || a.line.seq - b.line.seq);
    for (const e of group) if (!lines.includes(e.line.id)) lines.push(e.line.id);
  }
  if (lines.length === 0) return null;
  return {
    sleep_h: sleep === undefined ? null : roundTo(sleep.seconds / 3600, 1),
    steps,
    resting_hr: resting,
    hrv,
    lines,
  };
}

/** Every source with a line standing on the day: how many, its first and newest. Most lines first, then by name. */
function sources(lines: Entry[]): SourceCount[] {
  const counts = new Map<string, SourceCount & { firstMs: number; newestMs: number }>();
  for (const e of lines) {
    const source = String(e.line.source);
    const current = counts.get(source);
    if (current === undefined) {
      counts.set(source, {
        source,
        lines: 1,
        first: e.line.at,
        newest: e.line.at,
        firstMs: e.ms,
        newestMs: e.ms,
      });
      continue;
    }
    current.lines += 1;
    if (e.ms < current.firstMs) {
      current.first = e.line.at;
      current.firstMs = e.ms;
    }
    if (e.ms > current.newestMs) {
      current.newest = e.line.at;
      current.newestMs = e.ms;
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.lines - a.lines || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0))
    .map(({ source, lines, first, newest }) => ({ source, lines, first, newest }));
}
