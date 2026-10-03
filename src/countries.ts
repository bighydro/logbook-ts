import { countryAt } from "./day.js";
import { openWindow, type ReadingStats, readDays, type WindowOptions } from "./reading.js";

/** Days per country in one year, from the overnight stay. */
export interface CountryCount {
  country: string;
  days: number;
  dates: string[];
  /** The first and last location line of each night's stay, per date. */
  lines: string[];
  /** How many nights were decided by a place's own country, how many by an airport's zone. */
  by: Record<string, number>;
}

export interface CountryYear {
  year: string;
  /** Most days first, then by country code. */
  countries: CountryCount[];
  in_transit: { days: number; dates: string[]; lines: string[] };
  /** Nights at a stay no place with a country holds and no large airport is within 300 km of. */
  unknown: { days: number; dates: string[]; lines: string[] };
}

/** What `rollup countries --json` prints. */
export interface Countries {
  kind: "countries";
  window: { since: string | null; until: string | null; days: string[] };
  method?: string;
  years: CountryYear[];
}

export const COUNTRIES_METHOD =
  "country of the overnight stay: a place with a country in places.json when the stay lies in it, else the nearest large airport within 300 km (airports table) and its zone's country (zone.tab); coarse near borders and far from airports";

/**
 * Days per country per year from the overnight stay, as the reference's `logbook rollup countries`
 * sums them: the country of a night is its place's own `country`, else the zone of the nearest large
 * airport within 300 km; nights in transit and nights whose country is unknown are kept apart. The
 * window is clipped to the days the track covers (the first to the last location line, an asset's
 * included). Nothing is written.
 */
export function rollupCountries(
  root: string,
  options: WindowOptions,
  stats?: ReadingStats,
): Countries {
  const opened = openWindow(root, options);
  if (opened.window === null)
    return { kind: "countries", window: { since: null, until: null, days: [] }, years: [] };
  const years = new Map<string, CountryYear & { counts: Map<string, CountryCount> }>();
  for (const day of readDays(opened, stats)) {
    const y = day.day.slice(0, 4);
    let year = years.get(y);
    if (year === undefined) {
      year = {
        year: y,
        countries: [],
        in_transit: { days: 0, dates: [], lines: [] },
        unknown: { days: 0, dates: [], lines: [] },
        counts: new Map(),
      };
      years.set(y, year);
    }
    if (day.night === undefined) {
      year.in_transit.days += 1;
      year.in_transit.dates.push(day.day);
      continue;
    }
    const { row, at } = day.night;
    const found = countryAt(at.place, at.lat, at.lon);
    if (found === undefined || found.code === null) {
      year.unknown.days += 1;
      year.unknown.dates.push(day.day);
      year.unknown.lines.push(row.first.id, row.last.id);
      continue;
    }
    let count = year.counts.get(found.code);
    if (count === undefined) {
      count = { country: found.code, days: 0, dates: [], lines: [], by: {} };
      year.counts.set(found.code, count);
    }
    count.days += 1;
    count.dates.push(day.day);
    count.lines.push(row.first.id, row.last.id);
    count.by[found.method] = (count.by[found.method] ?? 0) + 1;
  }
  const out: CountryYear[] = [...years.values()]
    .sort((a, b) => (a.year < b.year ? -1 : 1))
    .map(({ counts, ...year }) => ({
      ...year,
      countries: [...counts.values()].sort(
        (a, b) => b.days - a.days || (a.country < b.country ? -1 : a.country > b.country ? 1 : 0),
      ),
    }));
  return {
    kind: "countries",
    window: { ...opened.window },
    method: COUNTRIES_METHOD,
    years: out,
  };
}

const DASH = "–";

/** The text of the rollup, as the reference prints it. */
export function renderCountries(c: Countries): string {
  if (c.window.since === null || c.window.until === null)
    return "countries\n  nothing in the window\n";
  const lines = [`countries ${c.window.since} ${DASH} ${c.window.until}`];
  for (const year of c.years) {
    const parts = year.countries.map((x) => `${x.country} ${x.days} day${x.days === 1 ? "" : "s"}`);
    parts.push(`in transit ${year.in_transit.days}`);
    if (year.unknown.days) parts.push(`unknown ${year.unknown.days}`);
    lines.push(`  ${year.year}  ${parts.join(" · ")}`);
  }
  lines.push(`  method: ${c.method ?? COUNTRIES_METHOD}`);
  return `${lines.join("\n")}\n`;
}
