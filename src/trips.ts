import { airportAt, airportCode, nearestAirport } from "./airports.js";
import { addDays } from "./clock.js";
import { isHome, type Person } from "./day.js";
import { coordinates, distanceM, roundTo } from "./geo.js";
import {
  type DayReading,
  type FlightLine,
  openWindow,
  type ReadingStats,
  readDays,
  type Window,
  type WindowOptions,
  type WindowRow,
} from "./reading.js";
import { payloadOf } from "./render.js";
import type { Asset, Place } from "./settings.js";
import type { Stay } from "./stays.js";
import type { JsonValue } from "./types.js";

/** Someone confirmed present on a trip, with the lines that put them there. */
export interface TripPerson {
  /** The entity id, or null for a name the record resolves to no person. */
  id: string | null;
  name: string;
  confidence: number;
  lines: string[];
}

/** A `flight/v1` line standing on one of the trip's days. */
export interface TripFlight {
  date: string;
  carrier: string | null;
  number: string | null;
  from: string | null;
  to: string | null;
  evidence: string | null;
  lines: string[];
}

/** A run of consecutive days whose night was away from home or in transit (ADR 0019). */
export interface Trip {
  /** `trip:<first day>:<last day>`, reproducible from the record; never a line's id. */
  id: string;
  start: string;
  end: string;
  /** The day after the last night. */
  until: string;
  nights: number;
  in_transit: number;
  /** The asset every night with a stay was aboard, else null. */
  asset: string | null;
  nights_aboard: Record<string, number>;
  /** The night places in order, consecutive nights at one place as one. */
  route: string[];
  /** The named places stayed at, home aside, from the first day to the day after. */
  places: string[];
  /** At most twelve, most evidence first. */
  people: TripPerson[];
  flights_in: TripFlight[];
  flights_out: TripFlight[];
  flights: TripFlight[];
  lines: string[];
}

/** What `trips --json` prints. */
export interface Trips {
  window: Window | null;
  trips: Trip[];
  warning?: string;
}

export const NO_HOME =
  "no place of kind home in places.json: nothing is away from home, so there are no trips";
/** `trips` lists at most this many names, most evidence first. */
const PEOPLE_LIMIT = 12;
/** Two consecutive night places this close are one route element. */
const ROUTE_FOLD_M = 200;
/** An unnamed stay with a named place within this many km reads as its coordinates near that place. */
const NEAR_PLACE_KM = 5;
/** The city of the nearest large airport within this many km labels an unnamed stay otherwise. */
const CITY_AIRPORT_KM = 30;

/**
 * The trips of a window, derived from the nights of its days as the reference's `logbook trips`
 * does: a trip is a run of consecutive days whose overnight stay is outside every home region (a
 * place of kind `home`, or within 400 m of one) or in transit, with at least one night at a stay;
 * its route is the night places in order, its places the named places stayed at from its first day
 * to the day after, its people those confirmed present there, its flights those of the same days,
 * the first day's as `in` and the day after's as `out`. Nothing is written.
 */
export function readTrips(root: string, options: WindowOptions, stats?: ReadingStats): Trips {
  const opened = openWindow(root, options);
  if (opened.window === null) return { window: null, trips: [] };
  const window = opened.window;
  if (!opened.places.some((p) => p.kind === "home")) return { window, trips: [], warning: NO_HOME };
  const trips: Trip[] = [];
  let run: DayReading[] = [];
  // A run closes at the next night at home, which is the trip's day after.
  const close = (after: DayReading | undefined): void => {
    if (run.some((d) => d.night !== undefined)) trips.push(tripOf(run, after, opened.places));
    run = [];
  };
  for (const day of readDays(opened, stats)) {
    const home = day.night !== undefined && isHome(day.night.at, opened.places);
    if (home) close(day);
    else run.push(day);
  }
  close(undefined);
  return { window, trips };
}

function tripOf(run: DayReading[], after: DayReading | undefined, places: Place[]): Trip {
  const first = run[0] as DayReading;
  const last = run[run.length - 1] as DayReading;
  const until = addDays(last.day, 1);
  const nights = run.length;
  const inTransit = run.filter((d) => d.night === undefined).length;
  // The nights aboard, by asset id, as the reference orders them in the text and the JSON alike.
  const counted = new Map<string, number>();
  for (const d of run) {
    const asset = d.night?.row.asset;
    if (asset !== undefined) counted.set(asset.id, (counted.get(asset.id) ?? 0) + 1);
  }
  const aboard: Record<string, number> = {};
  for (const id of [...counted.keys()].sort()) aboard[id] = counted.get(id) as number;
  const assets = Object.keys(aboard);
  const asset =
    assets.length === 1 && (aboard[assets[0] as string] as number) + inTransit === nights
      ? (assets[0] as string)
      : null;

  // The route: the night places in order, consecutive nights at one place as one.
  const route: string[] = [];
  let previous: { label: string; at: Stay; aboard: boolean } | undefined;
  for (const d of run) {
    if (d.night === undefined) continue;
    const isAboard = d.night.row.asset !== undefined;
    const label = isAboard
      ? `aboard ${(d.night.row.asset as Asset).name}`
      : labelOf(d.night.at, places);
    const same =
      previous !== undefined &&
      (previous.label === label ||
        (!previous.aboard &&
          !isAboard &&
          distanceM(previous.at.lat, previous.at.lon, d.night.at.lat, d.night.at.lon) <=
            ROUTE_FOLD_M));
    if (!same) route.push(label);
    previous = { label, at: d.night.at, aboard: isAboard };
  }

  // The places and the people: from every row of the trip's days, the day after included.
  const days = after === undefined ? run : [...run, after];
  const rows: WindowRow[] = [];
  for (const d of days) for (const row of d.rows) if (!rows.includes(row)) rows.push(row);
  const named: string[] = [];
  for (const row of rows)
    for (const stay of row.stays)
      if (
        stay.place !== undefined &&
        stay.place.kind !== "home" &&
        !named.includes(stay.place.name)
      )
        named.push(stay.place.name);
  const people = peopleOf(rows);

  // The flights of the same days.
  const flights = days.flatMap((d) => d.flights).map(flightOf);
  const flightsIn = first.flights.map(flightOf);
  const flightsOut = after === undefined ? [] : after.flights.map(flightOf);

  const lines: string[] = [];
  const add = (id: string): void => {
    if (!lines.includes(id)) lines.push(id);
  };
  for (const d of run) {
    if (d.night === undefined) continue;
    add(d.night.row.first.id);
    add(d.night.row.last.id);
  }
  for (const f of flights) for (const id of f.lines) add(id);
  for (const p of people) for (const id of p.lines) add(id);
  return {
    id: `trip:${first.day}:${last.day}`,
    start: first.day,
    end: last.day,
    until,
    nights,
    in_transit: inTransit,
    asset,
    nights_aboard: aboard,
    route,
    places: named,
    people,
    flights_in: flightsIn,
    flights_out: flightsOut,
    flights,
    lines,
  };
}

/** The people confirmed at the rows, each once, most evidence first and then by name; at most twelve. */
function peopleOf(rows: WindowRow[]): TripPerson[] {
  const people = new Map<string, TripPerson>();
  const add = (p: Person): void => {
    const key = p.person === null ? `name:${p.name}` : `id:${p.person}`;
    let person = people.get(key);
    if (person === undefined) {
      person = { id: p.person, name: p.name, confidence: 0, lines: [] };
      people.set(key, person);
    }
    person.confidence = Math.max(person.confidence, p.confidence);
    for (const id of p.lines) if (!person.lines.includes(id)) person.lines.push(id);
  };
  for (const row of rows) for (const p of row.people.confirmed) add(p);
  return [...people.values()]
    .sort(
      (a, b) => b.lines.length - a.lines.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    )
    .slice(0, PEOPLE_LIMIT);
}

const text = (value: JsonValue | undefined): string | null =>
  typeof value === "string" && value !== "" ? value : null;

function flightOf(f: FlightLine): TripFlight {
  const p = payloadOf(f.line);
  const code = (o: JsonValue | undefined): string | null => {
    if (o === null || typeof o !== "object" || Array.isArray(o)) return null;
    return text(o.iata) ?? text(o.icao);
  };
  return {
    date: text(p.date) ?? f.day,
    carrier: text(p.carrier),
    number: text(p.number),
    from: code(p.from),
    to: code(p.to),
    evidence: text(p.evidence),
    lines: [f.line.id],
  };
}

/**
 * The label of a night place on a route: the named place; the airport it is at (`CPH, Copenhagen`);
 * else its coordinates, `near <place>, x km` for the nearest named place within 5 km, else with the
 * city of the nearest large airport within 30 km in parentheses, else alone.
 */
export function labelOf(stay: Stay, places: Place[]): string {
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
    return `${coords} near ${nearest.place.name}, ${roundTo(nearest.m / 1000, 1).toFixed(1)} km`;
  const near = nearestAirport(stay.lat, stay.lon, CITY_AIRPORT_KM);
  return near === undefined ? coords : `${coords} (${near.airport.city})`;
}

const DASH = "–";
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The text of the trips, as the reference's `logbook trips` prints it; `assets` names the ones aboard. */
export function renderTrips(trips: Trips, assets: Asset[]): string {
  if (trips.window === null) return "no trips: the record has no days\n";
  const head = `trips ${trips.window.since} ${DASH} ${trips.window.until}`;
  if (trips.warning !== undefined) return `${head}: ${trips.warning}\n`;
  if (trips.trips.length === 0) return `${head}: no trips\n`;
  const name = (id: string): string => assets.find((a) => a.id === id)?.name ?? id;
  const lines = [`${head}: ${plural(trips.trips.length, "trip")}`];
  for (const t of trips.trips) {
    let nights = plural(t.nights, "night");
    if (t.asset !== null) {
      nights += ` aboard ${name(t.asset)}`;
      if (t.in_transit) nights += ` (${t.in_transit} in transit)`;
    } else {
      const parts = Object.entries(t.nights_aboard).map(([id, n]) => `${n} aboard ${name(id)}`);
      if (t.in_transit) parts.push(`${t.in_transit} in transit`);
      if (parts.length) nights += ` (${parts.join(", ")})`;
    }
    const parts = [nights, `route ${t.route.join(" → ")}`];
    for (const f of t.flights_in) parts.push(`in ${flightText(f)}`);
    for (const f of t.flights_out) parts.push(`out ${flightText(f)}`);
    if (t.places.length) parts.push(`places ${t.places.join(", ")}`);
    if (t.people.length) parts.push(`with ${t.people.map((p) => p.name).join(", ")}`);
    parts.push(t.id);
    lines.push(`  ${t.start} ${DASH} ${t.end}  ${parts.join(" · ")}`);
  }
  return `${lines.join("\n")}\n`;
}

/** `XY 101 OSL → HAM`; `CPH → ENGM` for a flight without a designator. */
function flightText(f: TripFlight): string {
  const designator = [f.carrier, f.number].filter((x): x is string => x !== null).join(" ");
  return `${designator ? `${designator} ` : ""}${f.from ?? "None"} → ${f.to ?? "None"}`;
}
