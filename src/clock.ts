import { LogbookError } from "./store.js";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export const DAY_MS = 86_400_000;

/** Throws LogbookError unless the zone is one this Node's ICU knows. */
export function checkTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
  } catch {
    throw new LogbookError(`unknown timezone ${timezone}`);
  }
}

/** True for `YYYY-MM-DD` naming a real calendar day. */
export function isDay(day: string): boolean {
  const m = DAY.exec(day);
  if (!m) return false;
  return new Date(dayMs(day)).toISOString().slice(0, 10) === day;
}

/** Midnight UTC of a `YYYY-MM-DD`, in ms. */
export function dayMs(day: string): number {
  const m = DAY.exec(day) as RegExpExecArray;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** The `YYYY-MM-DD` `n` days after `day` (negative for before). */
export function addDays(day: string, n: number): string {
  return new Date(dayMs(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM` of an instant, in UTC: the month file a line written there belongs to. */
export const monthKey = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

export interface Local {
  day: string;
  clock: string;
}

/** Local calendar day and HH:MM of an instant in a zone; undefined when `at` is not a date. */
export type Localize = (at: string | number) => Local | undefined;

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let format = formats.get(timezone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formats.set(timezone, format);
  }
  return format;
}

/** The wall clock an instant shows in a zone. */
export function wallClock(ms: number, timezone: string): Wall {
  const parts = formatter(timezone).formatToParts(new Date(ms));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

const two = (n: number): string => String(n).padStart(2, "0");

export function localizer(timezone: string): Localize {
  return (at) => {
    const ms = typeof at === "number" ? at : Date.parse(at);
    if (Number.isNaN(ms)) return undefined;
    return localOf(ms, timezone);
  };
}

/** Local day and HH:MM of an instant in ms. */
export function localOf(ms: number, timezone: string): Local {
  const w = wallClock(ms, timezone);
  return {
    day: `${w.year}-${two(w.month)}-${two(w.day)}`,
    clock: `${two(w.hour)}:${two(w.minute)}`,
  };
}

/** The zone's offset from UTC at an instant, in ms (positive east). */
export function zoneOffsetMs(ms: number, timezone: string): number {
  const w = wallClock(ms, timezone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  // Rounded to the minute: the instant may carry milliseconds the wall clock does not show.
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant a local wall clock denotes in a zone: `YYYY-MM-DD` plus `HH:MM` (24:00 allowed). A
 * clock a forward transition skips reads on the clock after it (02:30 is 03:30); one a backward
 * transition repeats is its first occurrence.
 */
export function localToMs(day: string, clock: string, timezone: string): number {
  const [h, m] = clock.split(":").map(Number) as [number, number];
  const wall = dayMs(day) + (h * 60 + m) * 60_000;
  let guess = wall - zoneOffsetMs(wall, timezone);
  const offset = zoneOffsetMs(guess, timezone);
  if (wall - offset !== guess) {
    const again = wall - offset;
    guess = zoneOffsetMs(again, timezone) === offset ? again : Math.max(guess, again);
  }
  return guess;
}

/** `±HH:MM` of the zone's offset at an instant. */
export function offsetString(ms: number, timezone: string): string {
  const offset = Math.round(zoneOffsetMs(ms, timezone) / 60_000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}

/** `YYYY-MM-DDTHH:MM:SS±HH:MM`: the instant on the zone's clock, as Python's isoformat spells it. */
export function localIso(ms: number, timezone: string): string {
  const w = wallClock(ms, timezone);
  return `${w.year}-${two(w.month)}-${two(w.day)}T${two(w.hour)}:${two(w.minute)}:${two(w.second)}${offsetString(ms, timezone)}`;
}

/** RFC 3339 UTC with second precision of an instant in ms. */
export function utcIso(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/** The English weekday name of a local day. */
export function weekdayOf(day: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(
    new Date(dayMs(day)),
  );
}

/** The `YYYY-MM-DD` that is `days` calendar days after `day`. */
export function dayAfter(day: string, days: number): string {
  return new Date(dayMs(day) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (`to` minus `from`); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
}

/**
 * The instant, in ms, at which a local day begins in a zone: the first instant whose local clock
 * reads that day at 00:00 (or, when a zone change skips midnight, the first minute of the day).
 */
export function localMidnight(day: string, timezone: string): number {
  const local = localizer(timezone);
  // Start from UTC midnight and correct by the zone's offset there; a zone change between the
  // guess and the answer is caught by a second pass, since offsets move by at most a few hours.
  let guess = dayMs(day);
  for (let pass = 0; pass < 3; pass++) {
    const seen = local(guess) as Local;
    const [hh, mm] = seen.clock.split(":").map(Number) as [number, number];
    const drift = (daysBetween(day, seen.day) * 24 + hh) * 3_600_000 + mm * 60_000;
    if (drift === 0) return guess;
    guess -= drift;
  }
  return guess;
}
