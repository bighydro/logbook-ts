import {
  checkTimezone,
  DAY_MS,
  dayMs,
  daysBetween,
  isDay,
  type Localize,
  localizer,
  localMidnight,
} from "./clock.js";
import { eachLine, monthFiles, parseLine } from "./lines.js";
import { formatRefusal, LogbookError, readMeta } from "./store.js";
import { padEnd, padStart, plural, withCommas } from "./table.js";

/** A `--since` or `--expect` the command cannot act on; the CLI reports it and exits 2. */
export class BadRange extends LogbookError {}

export interface GapsOptions {
  /** The range starts on this local day instead of each source's first line. */
  since?: string;
  /** Only these sources, in this order; one with no line is listed and flagged. */
  expect?: string[];
  /** The clock. Defaults to now. */
  now?: Date;
}

export interface Silence {
  /** `at` of the line the silence follows, or the local midnight `--since` names, as RFC 3339 UTC. */
  from: string;
  /** `at` of the line that ended it; null while it still runs. */
  to: string | null;
  seconds: number;
}

/** One source's activity over its range, as `sources --gaps --json` prints it. */
export interface SourceActivity {
  source: string;
  lines: number;
  first: string | null;
  last: string | null;
  silence: Silence | null;
  /** Local days of the range with no line, oldest first. */
  missing_days: string[];
  /** Silent a day or more at some point of the range, or no line at all. */
  flagged: boolean;
}

export interface GapsReport {
  since: string | null;
  today: string;
  timezone: string;
  expect: string[] | null;
  sources: SourceActivity[];
  /** The flagged sources, in listing order. */
  flagged: string[];
}

/** What the plain `sources` listing prints: every source with lines, by lines then name. */
export interface SourcesListed {
  timezone: string;
  sources: Array<{ source: string; lines: number; first: string; last: string }>;
}

const SILENT_DAY_MS = DAY_MS;

interface Stamp {
  ms: number;
  at: string;
}

/** What is known of one source after the files read so far. */
interface Tally {
  lines: number;
  first: Stamp | undefined;
  last: Stamp | undefined;
  /** Local day indexes (days since 1970-01-01) with a line. */
  days: Set<number>;
  /** The longest silence between two lines seen so far. */
  gap: { from: Stamp; to: Stamp } | undefined;
  /** The lines of the file being read, sorted at its end. */
  pending: Stamp[];
}

interface Scan {
  timezone: string;
  local: Localize;
  tallies: Map<string, Tally>;
}

/**
 * One pass over every month file, oldest first: each line of a source, in the range, counts
 * towards its lines, its first and last, its local days, and the longest silence between two of
 * its lines. A file's lines are ordered by `at` before the gaps are measured, since a file is in
 * chain order, not time order; the previous file's last line carries over. What is held is one
 * file's stamps per source, never the record.
 */
function scan(root: string, within: (ms: number, day: string) => boolean): Scan {
  const meta = readMeta(root);
  const refusal = formatRefusal(meta);
  if (refusal) throw new LogbookError(refusal);
  const timezone = meta.timezone;
  if (typeof timezone !== "string" || timezone === "") {
    throw new LogbookError("logbook.json: timezone is missing");
  }
  checkTimezone(timezone);
  const local = localizer(timezone);
  const tallies = new Map<string, Tally>();

  const settle = (): void => {
    for (const tally of tallies.values()) {
      if (tally.pending.length === 0) continue;
      tally.pending.sort((a, b) => a.ms - b.ms);
      let previous = tally.last;
      for (const stamp of tally.pending) {
        if (previous !== undefined && stamp.ms > previous.ms) {
          if (
            tally.gap === undefined ||
            stamp.ms - previous.ms > tally.gap.to.ms - tally.gap.from.ms
          ) {
            tally.gap = { from: previous, to: stamp };
          }
        }
        if (previous === undefined || stamp.ms > previous.ms) previous = stamp;
      }
      tally.last = previous;
      tally.pending = [];
    }
  };

  for (const month of monthFiles(root)) {
    for (const { raw, row } of eachLine(month.file)) {
      const parsed = parseLine(raw, `${month.rel} line ${row}`);
      if ("error" in parsed) continue;
      const { line } = parsed;
      if (typeof line.at !== "string") continue;
      const at = local(line.at);
      if (at === undefined) continue;
      const ms = Date.parse(line.at);
      if (!within(ms, at.day)) continue;
      const source = String(line.source);
      let tally = tallies.get(source);
      if (tally === undefined) {
        tally = {
          lines: 0,
          first: undefined,
          last: undefined,
          days: new Set(),
          gap: undefined,
          pending: [],
        };
        tallies.set(source, tally);
      }
      tally.lines += 1;
      const stamp = { ms, at: line.at };
      if (tally.first === undefined || ms < tally.first.ms) tally.first = stamp;
      tally.days.add(dayMs(at.day) / DAY_MS);
      tally.pending.push(stamp);
    }
    settle();
  }
  return { timezone, local, tallies };
}

const utc = (ms: number): string => `${new Date(ms).toISOString().slice(0, 19)}Z`;

/**
 * Where each source went quiet: per source with lines in the range, how many, its last line, the
 * longest silence (between two lines, from the range's start to the first line under `--since`,
 * or since the last line and still running) and the local days with no line. The range runs from
 * each source's first line, or `--since`, to today in the record's zone; a line dated after today
 * is outside it, and today is a missing day only once the source has been silent a full day.
 * Every line counts, retracted or not.
 */
export function sourceGaps(root: string, options: GapsOptions = {}): GapsReport {
  const now = options.now ?? new Date();
  const since = options.since;
  if (since !== undefined && !isDay(since))
    throw new BadRange(`not a date (YYYY-MM-DD): '${since}'`);
  const meta = readMeta(root);
  const timezone = typeof meta.timezone === "string" ? meta.timezone : "";
  const refusal = formatRefusal(meta);
  if (refusal) throw new LogbookError(refusal);
  if (timezone === "") throw new LogbookError("logbook.json: timezone is missing");
  checkTimezone(timezone);
  const local = localizer(timezone);
  const today = (local(now.getTime()) as { day: string }).day;
  if (since !== undefined && since > today) {
    throw new BadRange(`--since ${since} is after today (${today})`);
  }
  const sinceMidnight = since === undefined ? undefined : localMidnight(since, timezone);

  const { tallies } = scan(
    root,
    (ms, day) => day <= today && (sinceMidnight === undefined || ms >= sinceMidnight),
  );
  const todayIndex = dayMs(today) / DAY_MS;

  const activity = (source: string, tally: Tally | undefined): SourceActivity => {
    if (tally === undefined || tally.first === undefined || tally.last === undefined) {
      return {
        source,
        lines: 0,
        first: null,
        last: null,
        silence: null,
        missing_days: [],
        flagged: true,
      };
    }
    const candidates: Silence[] = [];
    if (sinceMidnight !== undefined && tally.first.ms > sinceMidnight) {
      candidates.push({
        from: utc(sinceMidnight),
        to: tally.first.at,
        seconds: (tally.first.ms - sinceMidnight) / 1000,
      });
    }
    if (tally.gap !== undefined) {
      candidates.push({
        from: tally.gap.from.at,
        to: tally.gap.to.at,
        seconds: (tally.gap.to.ms - tally.gap.from.ms) / 1000,
      });
    }
    const running = now.getTime() - tally.last.ms;
    candidates.push({ from: tally.last.at, to: null, seconds: Math.max(0, running) / 1000 });
    let silence = candidates[0] as Silence;
    for (const candidate of candidates)
      if (candidate.seconds > silence.seconds) silence = candidate;

    const startDay = since ?? (local(tally.first.ms) as { day: string }).day;
    const missing: string[] = [];
    const todayMissing = running >= SILENT_DAY_MS;
    for (let index = dayMs(startDay) / DAY_MS; index <= todayIndex; index++) {
      if (tally.days.has(index)) continue;
      if (index === todayIndex && !todayMissing) continue;
      missing.push(new Date(index * DAY_MS).toISOString().slice(0, 10));
    }
    return {
      source,
      lines: tally.lines,
      first: tally.first.at,
      last: tally.last.at,
      silence,
      missing_days: missing,
      flagged: silence.seconds >= SILENT_DAY_MS / 1000,
    };
  };

  let sources: SourceActivity[];
  let expect: string[] | null = null;
  if (options.expect !== undefined) {
    expect = [...new Set(options.expect)];
    sources = expect.map((name) => activity(name, tallies.get(name)));
  } else {
    sources = [...tallies]
      .map(([source, tally]) => activity(source, tally))
      .sort(
        (a, b) => b.lines - a.lines || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0),
      );
  }
  return {
    since: since ?? null,
    today,
    timezone,
    expect,
    sources,
    flagged: expect === null ? [] : sources.filter((s) => s.flagged).map((s) => s.source),
  };
}

/** `93d 13h`, `20h 0m`, `5m`: the whole units of a silence, floored. */
export function spellDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days >= 1) return `${days}d ${hours}h`;
  if (hours >= 1) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Missing days folded into runs: `2026-06-15, 2026-06-21, 2026-07-01..2026-10-02`, three at most, then `+N runs`. */
function spellRuns(days: string[]): string {
  const runs: Array<[string, string]> = [];
  for (const day of days) {
    const last = runs[runs.length - 1];
    if (last !== undefined && daysBetween(last[1], day) === 1) last[1] = day;
    else runs.push([day, day]);
  }
  const shown = runs.slice(0, 3).map(([a, b]) => (a === b ? a : `${a}..${b}`));
  if (runs.length > 3) shown.push(`+${plural(runs.length - 3, "run")}`);
  return shown.join(", ");
}

/** The report as the reference prints it: the table, how many sources, the range and the clock. */
export function gapsText(report: GapsReport): string {
  const local = localizer(report.timezone);
  const clock = (at: string): string => {
    const l = local(at);
    return l === undefined ? at : `${l.day} ${l.clock}`;
  };
  const out: string[] = [];
  if (report.sources.length === 0) {
    out.push("no lines");
  } else {
    const rows = report.sources.map((s) => {
      const silence =
        s.silence === null
          ? "no lines"
          : `${padEnd(spellDuration(s.silence.seconds), 7)} ${
              s.silence.to === null
                ? `since ${clock(s.silence.from)}`
                : `${clock(s.silence.from)} → ${clock(s.silence.to)}`
            }`;
      return {
        mark: report.expect !== null && s.flagged ? "!" : " ",
        source: s.source,
        lines: withCommas(s.lines),
        last: s.last === null ? "-" : clock(s.last),
        silence,
        missing: s.silence === null ? "" : String(s.missing_days.length),
        runs: spellRuns(s.missing_days),
      };
    });
    const w = Math.max(10, ...rows.map((r) => r.source.length));
    const l = Math.max(5, ...rows.map((r) => r.lines.length));
    const s = Math.max("longest silence".length, ...rows.map((r) => r.silence.length));
    const m = 3; // the reference pads the count to three places and lets a longer one push the row
    out.push(
      `  ${padEnd("source", w)}  ${padStart("lines", l)}  ${padEnd("last", 16)}  ${padEnd("longest silence", s)}  missing days`,
    );
    for (const r of rows) {
      let row = `${r.mark} ${padEnd(r.source, w)}  ${padStart(r.lines, l)}  ${padEnd(r.last, 16)}  ${r.silence}`;
      if (r.missing !== "")
        row = `${padEnd(row, row.length - r.silence.length + s)}  ${padStart(r.missing, m)}`;
      if (r.runs !== "") row += `  ${r.runs}`;
      out.push(row);
    }
  }
  out.push("");
  if (report.expect === null) {
    out.push(`${plural(report.sources.length, "source")} with lines`);
  } else if (report.flagged.length === 0) {
    out.push(`${plural(report.expect.length, "expected source")}, none flagged`);
  } else {
    out.push(
      `${report.flagged.length} of ${plural(report.expect.length, "expected source")} flagged: ${report.flagged.join(", ")}`,
    );
  }
  out.push(
    `since ${report.since === null ? "each source's first line" : report.since}, today ${report.today} (${report.timezone}); counted from the month files, every line`,
  );
  return `${out.join("\n")}\n`;
}

/** Every source with lines: how many, and its first and last line. By lines, then by name. */
export function listSources(root: string): SourcesListed {
  const { timezone, tallies } = scan(root, () => true);
  const sources = [...tallies]
    .filter(([, t]) => t.first !== undefined && t.last !== undefined)
    .map(([source, t]) => ({
      source,
      lines: t.lines,
      first: (t.first as Stamp).at,
      last: (t.last as Stamp).at,
    }))
    .sort((a, b) => b.lines - a.lines || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
  return { timezone, sources };
}

/** `  source  lines  first  last` rows in the record's zone, then how many sources. */
export function sourcesText(listed: SourcesListed): string {
  const local = localizer(listed.timezone);
  const clock = (at: string): string => {
    const l = local(at);
    return l === undefined ? at : `${l.day} ${l.clock}`;
  };
  const out: string[] = [];
  if (listed.sources.length === 0) {
    out.push("no lines");
  } else {
    const w = Math.max(10, ...listed.sources.map((s) => s.source.length));
    const l = Math.max(5, ...listed.sources.map((s) => withCommas(s.lines).length));
    out.push(`  ${padEnd("source", w)}  ${padStart("lines", l)}  ${padEnd("first", 16)}  last`);
    for (const s of listed.sources) {
      out.push(
        `  ${padEnd(s.source, w)}  ${padStart(withCommas(s.lines), l)}  ${clock(s.first)}  ${clock(s.last)}`,
      );
    }
  }
  out.push("", `${plural(listed.sources.length, "source")} with lines`);
  return `${out.join("\n")}\n`;
}
