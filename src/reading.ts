import { airportCode, nearestAirport } from "./airports.js";
import { addDays, checkTimezone, isDay, localOf, localToMs, monthKey } from "./clock.js";
import {
  type Company,
  company,
  type Entry,
  type Folded,
  foldEvents,
  type OwnerIdentity,
  ownerIdentity,
  type PeopleContext,
  promotes,
} from "./day.js";
import { eachLine, type MonthFile, monthFiles, parseLine } from "./lines.js";
import { payloadOf } from "./render.js";
import type { Resolver } from "./resolve.js";
import {
  type Asset,
  type Place,
  readAssets,
  readOwnerPolicy,
  readPlaces,
  readStaySettings,
  type StaySettings,
} from "./settings.js";
import { type Judgements, readJudgements } from "./show.js";
import { markSegmentAboard, type Point, type Segment, SegmentStream, type Stay } from "./stays.js";
import { formatRefusal, LogbookError, readMeta } from "./store.js";
import type { Line } from "./types.js";

/** A window of local days: one calendar year, a range, or the whole record; clipped to the days with a location line. */
export interface WindowOptions {
  year?: string;
  since?: string;
  until?: string;
}

export interface Window {
  since: string;
  until: string;
  /** Every local day from `since` to `until`. */
  days: string[];
}

/** A row of a day a trip or a rollup reads: a stay, or a run of stays and moves aboard one asset. */
export interface WindowRow {
  kind: "stay" | "aboard";
  startMs: number;
  endMs: number;
  /** The stay itself, or the stays inside the run. */
  stays: Stay[];
  /** The asset the row is aboard, when it is. */
  asset: Asset | undefined;
  /** The first and last location line of the row. */
  first: Point;
  last: Point;
  /**
   * Who was there, by the evidence of the row's whole span: a stay merges every line that falls in it
   * per person, whatever the day; in a run aboard, a line that falls in an inner stay is that stay's
   * and one that falls in a passage is the run's, each merged apart, so a face tagged at the
   * anchorage proposes nobody the note of the morning confirmed. Entries from several units are not
   * merged here; the readers merge them by person.
   */
  people: Company;
}

/** The night after a day: the row with the longest part inside the night window, and where in it. */
export interface Night {
  row: WindowRow;
  /** The stay that held the longest part of the night: the row's stay, or an inner stay of a run aboard. */
  at: Stay;
}

/** A `flight/v1` line standing, on the local day of its `at`. */
export interface FlightLine {
  line: Line;
  ms: number;
  day: string;
}

/** One local day of a window, as the readers over a window see it. */
export interface DayReading {
  day: string;
  /** The rows that touch the day, in time order. */
  rows: WindowRow[];
  /** The night after the day; undefined when no stay reaches it: in transit. */
  night: Night | undefined;
  flights: FlightLine[];
}

/** How much the reader held at most, so a test can see the memory does not grow with the record. */
export interface ReadingStats {
  /** Lines of one month file buffered, plus everything held across files, at the fullest moment. */
  peakHeld: number;
}

/** A record opened for a window: its settings, its judgements, and the window the options and the track give. */
export interface Opened {
  root: string;
  timezone: string;
  settings: StaySettings;
  places: Place[];
  assets: Asset[];
  judgements: Judgements;
  owner: OwnerIdentity;
  /** null when the record has no day in the window. */
  window: Window | null;
}

const YEAR = /^\d{4}$/;

/**
 * Opens a record for a reader over a window: the options checked, the settings read, one pass over
 * every file for the judgements (who a ref is, what is hidden, what was replaced) and for the first
 * and last day with a location line (an asset's counts), and the window clipped to those days. The
 * record's zone is the clock.
 */
export function openWindow(root: string, options: WindowOptions): Opened {
  const { year, since, until } = options;
  if (year !== undefined && (since !== undefined || until !== undefined))
    throw new LogbookError("give --year, or --since and --until, not both");
  if (year !== undefined && !YEAR.test(year)) throw new LogbookError(`not a year: ${year}`);
  for (const bound of [since, until])
    if (bound !== undefined && !isDay(bound)) throw new LogbookError(`not a day: ${bound}`);
  if (since !== undefined && until !== undefined && since > until)
    throw new LogbookError(`a range that runs backwards: ${since} is after ${until}`);

  const meta = readMeta(root);
  const refusal = formatRefusal(meta);
  if (refusal) throw new LogbookError(refusal);
  const timezone = meta.timezone;
  if (typeof timezone !== "string" || timezone === "")
    throw new LogbookError("logbook.json: timezone is missing");
  checkTimezone(timezone);

  const settings = readStaySettings(root);
  const places = readPlaces(root);
  const assets = readAssets(root);
  const policy = readOwnerPolicy(root);
  const judgements = readJudgements(monthFiles(root));
  const ownerEmails = Array.isArray(meta.owner_emails)
    ? meta.owner_emails.filter((v): v is string => typeof v === "string")
    : [];
  const owner = ownerIdentity(judgements.resolver, policy, ownerEmails, meta.owner_id);

  let window: Window | null = null;
  const { firstLocation, lastLocation } = judgements;
  if (firstLocation !== undefined && lastLocation !== undefined) {
    const first = localOf(Date.parse(firstLocation), timezone).day;
    const last = localOf(Date.parse(lastLocation), timezone).day;
    const from = since ?? (year === undefined ? first : `${year}-01-01`);
    const to = until ?? (year === undefined ? last : `${year}-12-31`);
    const start = from > first ? from : first;
    const end = to < last ? to : last;
    if (start <= end) {
      const days: string[] = [];
      for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
      window = { since: start, until: end, days };
    }
  }
  return { root, timezone, settings, places, assets, judgements, owner, window };
}

/**
 * The days of the window, oldest first, each with its rows, its night and its flights, read in one
 * pass over the month files the window can touch: every file's lines in the window are taken in time
 * order and fed to a stays engine that derives segment by segment, each marked aboard an asset once
 * the asset's fixes around it are in, consecutive segments aboard one asset folded into one row, and
 * a day produced as soon as every row that can touch its night is settled. What is held is one
 * month's lines, the open stay, the rows and evidence of the days still open and the asset fixes
 * around them, never the record.
 */
export function readDays(opened: Opened, stats?: ReadingStats): Generator<DayReading> {
  return readDaysOf(opened, stats ?? { peakHeld: 0 });
}

function* readDaysOf(opened: Opened, stats: ReadingStats): Generator<DayReading> {
  const { window, timezone, settings } = opened;
  if (window === null) return;
  const startMs = localToMs(window.since, "00:00", timezone);
  const endMs = localToMs(addDays(window.until, 1), settings.night[1], timezone);
  const firstMonth = monthKey(startMs);
  const lastMonth = monthKey(endMs);
  const machine = new Machine(opened, window);
  for (const month of monthFiles(opened.root)) {
    const key = `${month.year}-${month.month}`;
    if (key < firstMonth || key > lastMonth) continue;
    const entries = readFile(month, startMs, endMs, timezone);
    for (const entry of entries) {
      machine.feed(entry);
      stats.peakHeld = Math.max(stats.peakHeld, entries.length + machine.held());
      yield* machine.ready;
      machine.ready = [];
    }
  }
  machine.finish();
  yield* machine.ready;
}

/** The lines of one month file whose `at` falls inside the span, retractions aside, in time order. */
function readFile(month: MonthFile, startMs: number, endMs: number, timezone: string): Entry[] {
  const entries: Entry[] = [];
  for (const { raw, row } of eachLine(month.file)) {
    const parsed = parseLine(raw, `${month.rel} line ${row}`);
    if ("error" in parsed) continue; // verify reports it; a reader reads what it can
    const { line } = parsed;
    if (line.kind === "retraction" || typeof line.at !== "string") continue;
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
  entries.sort((a, b) => a.ms - b.ms || a.line.seq - b.line.seq);
  return entries;
}

/** The reader's state between lines: see `readDays`. */
class Machine {
  ready: DayReading[] = [];
  private readonly ctx: PeopleContext;
  private readonly timezone: string;
  private readonly settings: StaySettings;
  private readonly resolver: Resolver;
  private readonly superseded: Map<string, number>;
  private readonly stream: SegmentStream;
  private readonly tracks: Array<{ asset: Asset; points: Point[] }>;
  private readonly byAsset: Map<string, Point[]>;
  private readonly aboardWindowMs: number;
  /** Segments derived, waiting for the asset fixes around them before they are marked aboard. */
  private pending: Segment[] = [];
  /** The run of consecutive segments aboard one asset still open. */
  private run: Segment[] = [];
  /** Rows settled, in time order, still touching a day not produced. */
  private rows: WindowRow[] = [];
  /** Standing lines that attach to a stay, still able to touch a row not settled. */
  private evidence: Entry[] = [];
  private flights = new Map<string, FlightLine[]>();
  private nowMs = Number.NEGATIVE_INFINITY;
  private next: string;
  private readonly until: string;

  constructor(opened: Opened, window: Window) {
    this.ctx = { resolver: opened.judgements.resolver, places: opened.places, owner: opened.owner };
    this.timezone = opened.timezone;
    this.settings = opened.settings;
    this.resolver = opened.judgements.resolver;
    this.superseded = opened.judgements.supersededFlights;
    this.aboardWindowMs = opened.settings.aboard_window_s * 1000;
    this.tracks = opened.assets.map((asset) => ({ asset, points: [] as Point[] }));
    this.byAsset = new Map(this.tracks.map((t) => [t.asset.id, t.points]));
    this.next = window.since;
    this.until = window.until;
    this.stream = new SegmentStream(
      {
        settings: opened.settings,
        places: opened.places,
        attached: (startMs, endMs) =>
          this.evidence.some((e) => e.ms <= endMs && e.endMs >= startMs),
        airportNear: (lat, lon) => {
          const near = nearestAirport(lat, lon, opened.settings.airport_km);
          return near === undefined ? undefined : airportCode(near.airport);
        },
      },
      (segment) => this.pending.push(segment),
    );
  }

  /** What is held across files right now. */
  held(): number {
    return (
      this.pending.length +
      this.run.length +
      this.rows.length +
      this.evidence.length +
      this.tracks.reduce((n, t) => n + t.points.length, 0) +
      this.stream.held
    );
  }

  feed(e: Entry): void {
    this.nowMs = e.ms;
    const line = e.line;
    const standing = this.resolver.retractedBy(line.id) === undefined;
    if (line.kind === "location") {
      if (!standing) return;
      const p = payloadOf(line);
      if (typeof p.lat !== "number" || typeof p.lon !== "number") return;
      const point: Point = { ms: e.ms, lat: p.lat, lon: p.lon, id: line.id, seq: line.seq };
      if (p.subject === undefined || p.subject === null) this.stream.push(point);
      else if (typeof p.subject === "string") this.byAsset.get(p.subject)?.push(point);
    } else if (line.kind === "flight") {
      if (standing && payloadOf(line).schema === "flight/v1" && !this.superseded.has(line.id)) {
        const list = this.flights.get(e.day) ?? [];
        list.push({ line, ms: e.ms, day: e.day });
        this.flights.set(e.day, list);
      }
    } else if (standing && promotes(line) && e.day <= this.until) this.evidence.push(e);
    this.settle(false);
  }

  finish(): void {
    this.stream.finish();
    this.nowMs = Number.POSITIVE_INFINITY;
    this.settle(true);
  }

  /** The instant from which a row may still appear or change. */
  private frontier(): number {
    const candidates = [
      this.stream.openSinceMs,
      this.pending[0]?.startMs,
      this.run[0]?.startMs,
      this.nowMs,
    ].filter((ms): ms is number => ms !== undefined);
    return Math.min(...candidates);
  }

  /** Marks what can be marked, folds the runs, produces the days whose rows are all settled. */
  private settle(force: boolean): void {
    while (this.pending.length) {
      const segment = this.pending[0] as Segment;
      if (!force && segment.endMs + this.aboardWindowMs >= this.nowMs) break;
      this.pending.shift();
      markSegmentAboard(segment, this.tracks, this.settings);
      if (segment.aboard !== undefined) {
        if (this.run.length && (this.run[0] as Segment).aboard?.id !== segment.aboard.id)
          this.closeRun();
        this.run.push(segment);
      } else {
        this.closeRun();
        if (segment.kind === "stay") this.rows.push(this.rowOf([segment], undefined));
      }
    }
    if (force) this.closeRun();
    const frontier = this.frontier();
    // Asset fixes and evidence older than anything still open are not needed again.
    const keepFrom = frontier - this.aboardWindowMs;
    for (const track of this.tracks) {
      let drop = 0;
      while (drop < track.points.length && (track.points[drop] as Point).ms < keepFrom) drop++;
      if (drop) track.points.splice(0, drop);
    }
    this.evidence = this.evidence.filter((e) => e.endMs >= frontier);

    while (this.next <= this.until) {
      const day = this.next;
      const nightEndMs = localToMs(addDays(day, 1), this.settings.night[1], this.timezone);
      if (!force && frontier < nightEndMs) break;
      this.ready.push(this.dayOf(day, nightEndMs));
      const nextStartMs = localToMs(addDays(day, 1), "00:00", this.timezone);
      this.rows = this.rows.filter((r) => r.endMs > nextStartMs);
      this.flights.delete(day);
      this.next = addDays(day, 1);
    }
  }

  /** A run of two or more segments aboard one asset is one row; a single stay aboard is a stay. */
  private closeRun(): void {
    const run = this.run;
    this.run = [];
    if (run.length === 0) return;
    const first = run[0] as Segment;
    if (run.length === 1) {
      if (first.kind === "stay") this.rows.push(this.rowOf([first], first.aboard));
      return;
    }
    this.rows.push(this.rowOf(run, first.aboard));
  }

  private rowOf(segments: Segment[], asset: Asset | undefined): WindowRow {
    const first = segments[0] as Segment;
    const last = segments[segments.length - 1] as Segment;
    const stays = segments.filter((s): s is Stay => s.kind !== "move");
    const startMs = first.startMs;
    const endMs = last.endMs;
    const within = (e: Entry, from: number, to: number): boolean =>
      e.endMs > e.ms ? e.ms < to && e.endMs > from : e.ms >= from && e.ms <= to;
    const attached = this.evidence.filter((e) => within(e, startMs, endMs));
    // The units the company is merged in: the stay; in a run aboard, each inner stay with what falls
    // in it, and the run with what falls in no inner stay (a note written under way).
    const units: Array<{ stays: Stay[]; evidence: Entry[] }> =
      segments.length === 1
        ? [{ stays, evidence: attached }]
        : [
            ...stays.map((stay) => ({
              stays: [stay],
              evidence: attached.filter((e) => within(e, stay.startMs, stay.endMs)),
            })),
            {
              stays,
              evidence: attached.filter(
                (e) => !stays.some((stay) => within(e, stay.startMs, stay.endMs)),
              ),
            },
          ];
    const people: Company = { confirmed: [], proposed: [] };
    for (const unit of units) {
      const timed = unit.evidence.filter(
        (e) => e.line.kind === "event" && payloadOf(e.line).all_day !== true,
      );
      const events: Folded[] = foldEvents(timed);
      const found = company(
        unit.stays,
        {
          events,
          transcripts: unit.evidence.filter((e) => e.line.kind === "transcript"),
          notes: unit.evidence.filter((e) => e.line.kind === "note"),
          photos: unit.evidence.filter((e) => e.line.kind === "photo"),
        },
        this.ctx,
      );
      people.confirmed.push(...found.confirmed);
      people.proposed.push(...found.proposed);
    }
    return {
      kind: segments.length > 1 ? "aboard" : "stay",
      startMs,
      endMs,
      stays,
      asset,
      first: first.kind === "move" ? first.first : first.first,
      last: last.kind === "move" ? last.last : last.last,
      people,
    };
  }

  private dayOf(day: string, nightEndMs: number): DayReading {
    const dayStartMs = localToMs(day, "00:00", this.timezone);
    const dayEndMs = localToMs(addDays(day, 1), "00:00", this.timezone);
    const nightStartMs = localToMs(day, this.settings.night[0], this.timezone);
    const part = (startMs: number, endMs: number, from: number, to: number): number =>
      Math.min(endMs, to) - Math.max(startMs, from);
    let best: { row: WindowRow; overlap: number } | undefined;
    for (const row of this.rows) {
      const overlap = part(row.startMs, row.endMs, nightStartMs, nightEndMs);
      if (overlap > 0 && (best === undefined || overlap > best.overlap)) best = { row, overlap };
    }
    let night: Night | undefined;
    if (best !== undefined) {
      let at: { stay: Stay; overlap: number } | undefined;
      for (const stay of best.row.stays) {
        const overlap = part(stay.startMs, stay.endMs, nightStartMs, nightEndMs);
        if (at === undefined || overlap > at.overlap) at = { stay, overlap };
      }
      night = { row: best.row, at: (at as { stay: Stay }).stay };
    }
    return {
      day,
      rows: this.rows.filter((r) => r.startMs < dayEndMs && r.endMs > dayStartMs),
      night,
      flights: this.flights.get(day) ?? [],
    };
  }
}
