import { isHome } from "./day.js";
import { openWindow, type ReadingStats, readDays, type WindowOptions } from "./reading.js";

/** The longest run of consecutive nights not at home in one year: away or in transit. */
export interface LongestTrip {
  start: string;
  end: string;
  nights: number;
  /** The first and last location line of each night's stay; a night in transit adds none. */
  lines: string[];
}

export interface NightsYear {
  year: string;
  home: number;
  away: number;
  in_transit: number;
  /** Nights per asset, by id, in the order the assets first appear. */
  aboard: Record<string, number>;
  /** The first and last location line of every night's stay, in night order. */
  lines: string[];
  /** null when every night of the year was at home. */
  longest_trip: LongestTrip | null;
}

/** What `rollup nights --json` prints. */
export interface Nights {
  kind: "nights";
  window: { since: string | null; until: string | null; days: string[] };
  /** Present when the record has no place of kind `home`: every night then counts as away. */
  warning?: string;
  years: NightsYear[];
}

export const NIGHTS_NO_HOME = "no place of kind home in places.json: every night counts as away";

interface Run {
  start: string;
  end: string;
  nights: number;
  lines: string[];
}

interface Counting extends NightsYear {
  open: Run | undefined;
}

/**
 * Nights per year over a window, as the reference's `logbook rollup nights` sums them: home, away
 * and in transit, the nights aboard each asset, and the longest run of consecutive nights not at
 * home, counted within the year; a night is home when its stay lies in a place of kind `home` or
 * within 400 m of one, never aboard an asset, as the Day decides it. Without a home place every
 * night is away and the rollup says so. The window is clipped to the days the track covers.
 * Nothing is written.
 */
export function rollupNights(root: string, options: WindowOptions, stats?: ReadingStats): Nights {
  const opened = openWindow(root, options);
  if (opened.window === null)
    return { kind: "nights", window: { since: null, until: null, days: [] }, years: [] };
  const hasHome = opened.places.some((p) => p.kind === "home");
  const years = new Map<string, Counting>();
  const close = (year: Counting): void => {
    const run = year.open;
    year.open = undefined;
    if (run === undefined) return;
    if (year.longest_trip === null || run.nights > year.longest_trip.nights)
      year.longest_trip = { start: run.start, end: run.end, nights: run.nights, lines: run.lines };
  };
  let current: Counting | undefined;
  for (const day of readDays(opened, stats)) {
    const y = day.day.slice(0, 4);
    let year = years.get(y);
    if (year === undefined) {
      if (current !== undefined) close(current); // a run does not cross the turn of the year
      year = {
        year: y,
        home: 0,
        away: 0,
        in_transit: 0,
        aboard: {},
        lines: [],
        longest_trip: null,
        open: undefined,
      };
      years.set(y, year);
    }
    current = year;
    let lines: string[] = [];
    let home = false;
    if (day.night === undefined) year.in_transit += 1;
    else {
      const { row, at } = day.night;
      lines = [row.first.id, row.last.id];
      home = hasHome && row.asset === undefined && isHome(at, opened.places);
      if (home) year.home += 1;
      else year.away += 1;
      if (row.asset !== undefined) year.aboard[row.asset.id] = (year.aboard[row.asset.id] ?? 0) + 1;
      year.lines.push(...lines);
    }
    if (home) close(year);
    else if (year.open === undefined)
      year.open = { start: day.day, end: day.day, nights: 1, lines: [...lines] };
    else {
      year.open.end = day.day;
      year.open.nights += 1;
      year.open.lines.push(...lines);
    }
  }
  for (const year of years.values()) close(year);
  const sorted = [...years.values()]
    .sort((a, b) => (a.year < b.year ? -1 : 1))
    .map(({ open: _open, ...year }) => year);
  return hasHome
    ? { kind: "nights", window: { ...opened.window }, years: sorted }
    : { kind: "nights", window: { ...opened.window }, warning: NIGHTS_NO_HOME, years: sorted };
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
    for (const [asset, count] of Object.entries(year.aboard))
      parts.push(`${plural(count, "night")} aboard ${asset}`);
    const trip = year.longest_trip;
    if (trip !== null)
      parts.push(
        `longest trip ${trip.start} ${DASH} ${trip.end} (${plural(trip.nights, "night")})`,
      );
    lines.push(`  ${year.year}  ${parts.join(" · ")}`);
  }
  return `${lines.join("\n")}\n`;
}
