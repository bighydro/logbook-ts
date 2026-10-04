import { isHome } from "./day.js";
import { openWindow, type ReadingStats, readDays, type WindowOptions } from "./reading.js";

/** The longest run of consecutive nights not at home in one year, the nights in transit counted in. */
export interface LongestTrip {
  start: string;
  end: string;
  nights: number;
  /** The first and last location line of each night's stay, per night; a night in transit adds none. */
  lines: string[];
}

export interface NightsYear {
  year: string;
  home: number;
  away: number;
  in_transit: number;
  /** Nights aboard each asset, by id. */
  aboard: Record<string, number>;
  /** The first and last location line of each night's stay, per night, in day order. */
  lines: string[];
  /** null when every night of the year is at home. */
  longest_trip: LongestTrip | null;
}

/** What `rollup nights --json` prints. */
export interface Nights {
  kind: "nights";
  window: { since: string | null; until: string | null; days: string[] };
  warning?: string;
  years: NightsYear[];
}

export const NO_HOME_NIGHTS = "no place of kind home in places.json: every night counts as away";

/**
 * Home, away and in-transit nights per year of the window, the nights aboard each asset and the
 * longest run of nights not at home, as the reference's `logbook rollup nights` sums them (docs/
 * rollups.md, *Countries, flights, nights*): the night of a day is the stay with the longest part in
 * the night window, a run aboard an asset counted whole; it is at home when it lies in a place of
 * kind `home` or within 400 m of one, in transit when there is no such stay, else away. A run of
 * nights not at home is clipped to the year, and the earlier of two as long is named. The window is
 * clipped to the days the track covers (the first to the last location line, an asset's included).
 * Nothing is written.
 */
export function rollupNights(root: string, options: WindowOptions, stats?: ReadingStats): Nights {
  const opened = openWindow(root, options);
  if (opened.window === null)
    return { kind: "nights", window: { since: null, until: null, days: [] }, years: [] };
  const hasHome = opened.places.some((p) => p.kind === "home");
  const years: NightsYear[] = [];
  let year: NightsYear | undefined;
  let run: LongestTrip | undefined;
  const close = (): void => {
    if (run !== undefined && year !== undefined) {
      if (year.longest_trip === null || run.nights > year.longest_trip.nights) {
        year.longest_trip = run;
      }
    }
    run = undefined;
  };
  for (const day of readDays(opened, stats)) {
    const y = day.day.slice(0, 4);
    if (year === undefined || year.year !== y) {
      close();
      year = {
        year: y,
        home: 0,
        away: 0,
        in_transit: 0,
        aboard: {},
        lines: [],
        longest_trip: null,
      };
      years.push(year);
    }
    const night = day.night;
    const lines = night === undefined ? [] : [night.row.first.id, night.row.last.id];
    year.lines.push(...lines);
    if (night !== undefined && hasHome && isHome(night.at, opened.places)) {
      year.home += 1;
      close();
      continue;
    }
    if (night === undefined) year.in_transit += 1;
    else {
      year.away += 1;
      const asset = night.row.asset;
      if (asset !== undefined) year.aboard[asset.id] = (year.aboard[asset.id] ?? 0) + 1;
    }
    if (run === undefined) run = { start: day.day, end: day.day, nights: 0, lines: [] };
    run.end = day.day;
    run.nights += 1;
    run.lines.push(...lines);
  }
  close();
  const out: Nights = { kind: "nights", window: { ...opened.window }, years };
  if (!hasHome) out.warning = NO_HOME_NIGHTS;
  return out;
}

const DASH = "–";
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The text of the rollup, as the reference prints it. */
export function renderNights(n: Nights): string {
  if (n.window.since === null || n.window.until === null)
    return "nights\n  nothing in the window\n";
  const lines = [`nights ${n.window.since} ${DASH} ${n.window.until}`];
  if (n.warning !== undefined) lines.push(`  (${n.warning})`);
  for (const year of n.years) {
    const parts = [`${year.home} home`, `${year.away} away`, `${year.in_transit} in transit`];
    for (const id of Object.keys(year.aboard).sort()) {
      parts.push(`${plural(year.aboard[id] as number, "night")} aboard ${id}`);
    }
    const trip = year.longest_trip;
    if (trip !== null) {
      parts.push(
        `longest trip ${trip.start} ${DASH} ${trip.end} (${plural(trip.nights, "night")})`,
      );
    }
    lines.push(`  ${year.year}  ${parts.join(" · ")}`);
  }
  return `${lines.join("\n")}\n`;
}
