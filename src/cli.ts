import { localOf } from "./clock.js";
import { renderCountries, rollupCountries } from "./countries.js";
import { readDay } from "./day.js";
import { type DaysOptions, readDayRows, renderDayRow } from "./days.js";
import { renderDay } from "./dayText.js";
import { renderNights, rollupNights } from "./nights.js";
import { readPeople, renderPeople } from "./people.js";
import type { WindowOptions } from "./reading.js";
import { readAssets } from "./settings.js";
import { isDay, type ShowRangeOptions, type ShowResult, showDay, showRange } from "./show.js";
import { BadRange, gapsText, listSources, sourceGaps, sourcesText } from "./sources.js";
import { collectStats, statsText } from "./stats.js";
import { addNote, LogbookError, readMeta, verifyLogbook } from "./store.js";
import { readTrips, renderTrips } from "./trips.js";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const USAGE = `usage:
  logbook-ts verify <root>            check the chain; print "valid — N lines, head <hex>", or the
                                      errors after "invalid — N errors; M lines read, head <hex>"
  logbook-ts add <root> "<text>"      append one note (note/v1, tier 2, source manual)
  logbook-ts show <root> --day YYYY-MM-DD [--tz <zone>] [--raw] [--profile <schema>] [--json]
                                      print the day as the reference does: local time, kind, source,
                                      summary, then the day's notes file (--tz defaults to
                                      logbook.json; --raw prints refs as given and bodies whole;
                                      --profile keeps lines of that payload schema only, "note/v1"
                                      or "note" for any version, repeatable or comma-separated;
                                      --json prints the day as one JSON object, every row with its
                                      summary and the lines behind it)
  logbook-ts show <root> [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--tz <zone>] [--raw] [--profile <schema>] [--json]
                                      the same for every day of the range that has a line, oldest
                                      first, streamed, one object per line with --json; a missing
                                      bound is the record's first or last day
  logbook-ts day <root> [YYYY-MM-DD] [--json]
                                      the day read back whole, as the reference's \`logbook day\`
                                      prints it: the nights either side, the country, the timeline
                                      of stays, stops, moves and flights with what attached to each
                                      and who was there, what was placed nowhere, the health line,
                                      the sources; today in the record's zone when no day is given;
                                      --json prints the Day as one object, every row with its lines
  logbook-ts people <root> [--year YYYY] [--json]
                                      everyone the record names, never the owner, as the reference's
                                      \`logbook people\` prints it: the channels they are heard on,
                                      the days and nights together (the confirmed set only), the
                                      last real contact and the places shared; the whole record, or
                                      one year; --json prints the report as one object
  logbook-ts days <root> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json]
                                      a window of days one line each, as the reference's \`logbook
                                      days\` prints it: the night after and the country, the
                                      kilometres moved, the flights, the stays and what attached,
                                      the people confirmed present, the health line, and the usual
                                      sources silent that day; both bounds default to the days the
                                      track covers; --json prints one object per day (JSON Lines)
  logbook-ts stats <root> [--json]    one screen of what the record holds: lines by kind, source,
                                      year, tier and month, retractions, resolutions, attachments
                                      referenced and present; --json gives the same as one object
  logbook-ts sources <root>           every source with lines: how many, its first and last line
  logbook-ts sources <root> --gaps [--since YYYY-MM-DD] [--expect <source>...] [--json]
                                      per source: its last line, the longest silence and the days
                                      with no line, from its first line (or --since) to today;
                                      --expect lists only those sources, marks one silent a day or
                                      more, or with no line, with "!" and exits 1
  logbook-ts trips <root> [--year YYYY | --since YYYY-MM-DD --until YYYY-MM-DD] [--json]
                                      the trips of the window, as the reference's \`logbook trips\`
                                      prints them: every run of nights away from home or in transit,
                                      with its nights (aboard an asset when they were), its route,
                                      the flights in and out, the named places and who was there;
                                      the whole record when no window is given, clipped to the days
                                      the track covers; --json prints the trips as one object
  logbook-ts rollup countries <root> [--year YYYY | --since YYYY-MM-DD --until YYYY-MM-DD] [--json]
                                      days per country per year from the overnight stay, in transit
                                      and unknown apart, with the method; --json as one object
  logbook-ts rollup nights <root> [--year YYYY | --since YYYY-MM-DD --until YYYY-MM-DD] [--json]
                                      per year: nights at home (in a place of kind home, or within
                                      400 m of one), away and in transit, the nights aboard each
                                      asset, and the longest run of nights not at home; --json as
                                      one object, every number with its lines

<root> is the folder that holds logbook.json and logbook/<YYYY>/<MM>.jsonl.
`;

export interface MainOptions {
  /** The clock `sources --gaps` measures today and the running silence by. Defaults to now. */
  now?: Date;
}

/** Run the CLI without touching process globals. Returns the exit code. */
export function main(argv: string[], io: Io, options: MainOptions = {}): number {
  const [command, root, ...rest] = argv;
  if (command === "--help" || command === "-h" || command === "help") {
    io.stdout(USAGE);
    return 0;
  }
  try {
    switch (command) {
      case "verify": {
        if (root === undefined || rest.length) return usage(io);
        const result = verifyLogbook(root);
        if (result.valid) {
          io.stdout(`valid — ${result.lines} lines, head ${result.head}\n`);
          return 0;
        }
        // SPEC §3: an invalid record still reports the seq and head of the lines read, so the
        // owner of a torn record learns which prefix of the chain is intact.
        io.stderr(
          `invalid — ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}; ${result.lines} lines read, head ${result.head}\n`,
        );
        for (const error of result.errors) io.stderr(`  ${error}\n`);
        return 1;
      }
      case "add": {
        if (root === undefined || rest.length === 0) return usage(io);
        const line = addNote(root, rest.join(" "));
        io.stdout(`added seq ${line.seq} ${line.id} at ${line.at}, head ${line.hash}\n`);
        return 0;
      }
      case "show": {
        if (root === undefined) return usage(io);
        const flags = parseShowFlags(rest);
        if (flags === undefined) return usage(io);
        const { day, json, ...range } = flags;
        const print = (result: ShowResult, first: boolean): void => {
          if (json) io.stdout(`${JSON.stringify(result.detail)}\n`);
          else io.stdout(first ? result.text : `\n${result.text}`);
        };
        if (day !== undefined) {
          print(showDay(root, { day, ...range }), true);
          return 0;
        }
        const shown = showRange(root, range);
        let count = 0;
        for (const result of shown.days) {
          print(result, count === 0);
          count += 1;
        }
        if (count === 0 && !json) {
          const span = [shown.since, shown.until].filter((d) => d !== undefined);
          io.stdout(`${span.length ? `${[...new Set(span)].join("–")}: ` : ""}nothing logged\n`);
        }
        return 0;
      }
      case "trips": {
        if (root === undefined) return usage(io);
        const flags = parseWindowFlags(rest);
        if (flags === undefined) return usage(io);
        const { json, ...window } = flags;
        const trips = readTrips(root, window);
        io.stdout(json ? `${JSON.stringify(trips)}\n` : renderTrips(trips, readAssets(root)));
        return 0;
      }
      case "rollup": {
        const [rollupRoot, ...flagsGiven] = rest;
        if ((root !== "countries" && root !== "nights") || rollupRoot === undefined)
          return usage(io);
        const flags = parseWindowFlags(flagsGiven);
        if (flags === undefined) return usage(io);
        const { json, ...window } = flags;
        if (root === "nights") {
          const nights = rollupNights(rollupRoot, window);
          io.stdout(json ? `${JSON.stringify(nights)}\n` : renderNights(nights));
          return 0;
        }
        const countries = rollupCountries(rollupRoot, window);
        io.stdout(json ? `${JSON.stringify(countries)}\n` : renderCountries(countries));
        return 0;
      }
      case "day": {
        if (root === undefined) return usage(io);
        let day: string | undefined;
        let json = false;
        for (const arg of rest) {
          if (arg === "--json" && !json) json = true;
          else if (day === undefined && isDay(arg)) day = arg;
          else return usage(io);
        }
        const read = readDay(root, { day: day ?? today(root) });
        io.stdout(json ? `${JSON.stringify(read)}\n` : renderDay(read));
        return 0;
      }
      case "people": {
        if (root === undefined) return usage(io);
        const flags = parseWindowFlags(rest);
        if (flags === undefined || flags.since !== undefined || flags.until !== undefined)
          return usage(io);
        const { json, ...window } = flags;
        const people = readPeople(root, window);
        io.stdout(json ? `${JSON.stringify(people)}\n` : renderPeople(people, window));
        return 0;
      }
      case "days": {
        if (root === undefined) return usage(io);
        const flags = parseDaysFlags(rest);
        if (flags === undefined) return usage(io);
        const { json, ...bounds } = flags;
        if (bounds.from !== undefined && bounds.to !== undefined && bounds.from > bounds.to) {
          io.stderr(`days: range runs backwards: ${bounds.from} > ${bounds.to}\n`);
          return 2;
        }
        const read = readDayRows(root, bounds);
        for (const row of read.rows) {
          io.stdout(json ? `${JSON.stringify(row)}\n` : renderDayRow(row));
        }
        return 0;
      }
      case "stats": {
        if (root === undefined) return usage(io);
        if (rest.length > 1 || (rest.length === 1 && rest[0] !== "--json")) return usage(io);
        const stats = collectStats(root);
        io.stdout(rest.length === 1 ? `${JSON.stringify(stats, null, 2)}\n` : statsText(stats));
        return 0;
      }
      case "sources": {
        if (root === undefined) return usage(io);
        const flags = parseSourcesFlags(rest);
        if (flags === undefined) return usage(io);
        if (!flags.gaps) {
          if (flags.since !== undefined || flags.expect !== undefined || flags.json) {
            io.stderr("sources: --since, --expect and --json go with --gaps\n");
            return 2;
          }
          io.stdout(sourcesText(listSources(root)));
          return 0;
        }
        const gaps: Parameters<typeof sourceGaps>[1] = {};
        if (flags.since !== undefined) gaps.since = flags.since;
        if (flags.expect !== undefined) gaps.expect = flags.expect;
        if (options.now !== undefined) gaps.now = options.now;
        let report: ReturnType<typeof sourceGaps>;
        try {
          report = sourceGaps(root, gaps);
        } catch (err) {
          if (err instanceof BadRange) {
            io.stderr(`sources: ${err.message}\n`);
            return 2;
          }
          throw err;
        }
        io.stdout(flags.json ? `${JSON.stringify(report, null, 2)}\n` : gapsText(report));
        return report.flagged.length ? 1 : 0;
      }
      default:
        return usage(io);
    }
  } catch (err) {
    if (err instanceof LogbookError) {
      io.stderr(`error: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

type ShowFlags = ShowRangeOptions & { day?: string; json?: boolean };

/**
 * `--day D`, `--since D`, `--until D`, `--tz Z`, `--profile P[,P…]` (each also as `--flag=value`,
 * `--profile` repeatable), `--raw` and `--json`; undefined on anything else, a bad day, an empty
 * profile, a range that runs backwards, or `--day` with a bound.
 */
function parseShowFlags(args: string[]): ShowFlags | undefined {
  const days: Record<"--day" | "--since" | "--until", string | undefined> = {
    "--day": undefined,
    "--since": undefined,
    "--until": undefined,
  };
  let timezone: string | undefined;
  let raw = false;
  let json = false;
  const profiles: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const take = (): string | undefined => (eq === -1 ? args[++i] : arg.slice(eq + 1));
    switch (name) {
      case "--day":
      case "--since":
      case "--until": {
        const value = take();
        if (value === undefined || !isDay(value)) return undefined;
        days[name] = value;
        break;
      }
      case "--tz":
        timezone = take();
        break;
      case "--profile": {
        const given = take();
        if (given === undefined) return undefined;
        for (const profile of given.split(",")) {
          if (profile === "") return undefined;
          profiles.push(profile);
        }
        break;
      }
      case "--raw":
        if (eq !== -1) return undefined;
        raw = true;
        break;
      case "--json":
        if (eq !== -1) return undefined;
        json = true;
        break;
      default:
        return undefined;
    }
  }
  const { "--day": day, "--since": since, "--until": until } = days;
  if (timezone === "") return undefined;
  if (day !== undefined && (since !== undefined || until !== undefined)) return undefined;
  if (day === undefined && since === undefined && until === undefined) return undefined;
  if (since !== undefined && until !== undefined && since > until) return undefined;
  const flags: ShowFlags = { raw };
  if (json) flags.json = true;
  if (profiles.length) flags.profiles = profiles;
  if (day !== undefined) flags.day = day;
  if (since !== undefined) flags.since = since;
  if (until !== undefined) flags.until = until;
  if (timezone !== undefined) flags.timezone = timezone;
  return flags;
}

/**
 * `--year YYYY`, `--since D`, `--until D` (each also as `--flag=value`) and `--json`; undefined on
 * anything else, a bad day or year, a range that runs backwards, or `--year` with a bound.
 */
function parseWindowFlags(args: string[]): (WindowOptions & { json?: boolean }) | undefined {
  const flags: WindowOptions & { json?: boolean } = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const take = (): string | undefined => (eq === -1 ? args[++i] : arg.slice(eq + 1));
    switch (name) {
      case "--year": {
        const value = take();
        if (value === undefined || !/^\d{4}$/.test(value) || flags.year !== undefined)
          return undefined;
        flags.year = value;
        break;
      }
      case "--since":
      case "--until": {
        const value = take();
        if (value === undefined || !isDay(value)) return undefined;
        if (name === "--since") flags.since = value;
        else flags.until = value;
        break;
      }
      case "--json":
        if (eq !== -1) return undefined;
        flags.json = true;
        break;
      default:
        return undefined;
    }
  }
  if (flags.year !== undefined && (flags.since !== undefined || flags.until !== undefined))
    return undefined;
  if (flags.since !== undefined && flags.until !== undefined && flags.since > flags.until)
    return undefined;
  return flags;
}

/** `--from D`, `--to D` (each also as `--flag=value`) and `--json`; undefined on anything else or a bad day. */
function parseDaysFlags(args: string[]): (DaysOptions & { json?: boolean }) | undefined {
  const flags: DaysOptions & { json?: boolean } = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const take = (): string | undefined => (eq === -1 ? args[++i] : arg.slice(eq + 1));
    switch (name) {
      case "--from":
      case "--to": {
        const value = take();
        if (value === undefined || !isDay(value)) return undefined;
        if (name === "--from") flags.from = value;
        else flags.to = value;
        break;
      }
      case "--json":
        if (eq !== -1) return undefined;
        flags.json = true;
        break;
      default:
        return undefined;
    }
  }
  return flags;
}

/** Today's date on the record's clock. */
function today(root: string): string {
  const timezone = readMeta(root).timezone;
  return localOf(Date.now(), typeof timezone === "string" && timezone !== "" ? timezone : "UTC")
    .day;
}

interface SourcesFlags {
  gaps: boolean;
  since?: string;
  expect?: string[];
  json: boolean;
}

/**
 * `--gaps`, `--since D` (also `--since=D`; the day is checked later, so the message can name it),
 * `--expect S [S…]` (the names until the next flag, or comma-separated) and `--json`; undefined on
 * anything else or on a flag without its value.
 */
function parseSourcesFlags(args: string[]): SourcesFlags | undefined {
  const flags: SourcesFlags = { gaps: false, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    switch (name) {
      case "--gaps":
      case "--json":
        if (eq !== -1) return undefined;
        flags[name === "--gaps" ? "gaps" : "json"] = true;
        break;
      case "--since": {
        const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
        if (value === undefined || value === "" || value.startsWith("--")) return undefined;
        flags.since = value;
        break;
      }
      case "--expect": {
        const names = eq === -1 ? [] : [arg.slice(eq + 1)];
        while (eq === -1 && i + 1 < args.length && !(args[i + 1] as string).startsWith("--")) {
          names.push(args[++i] as string);
        }
        const expect = names.flatMap((n) => n.split(",")).filter((n) => n !== "");
        if (expect.length === 0) return undefined;
        flags.expect = [...(flags.expect ?? []), ...expect];
        break;
      }
      default:
        return undefined;
    }
  }
  return flags;
}

function usage(io: Io): number {
  io.stderr(USAGE);
  return 2;
}
