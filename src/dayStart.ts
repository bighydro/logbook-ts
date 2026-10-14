/**
 * Where the owner's day begins (RFC 0036, draft): `"day_start": "HH:MM"` in `logbook.json`, a clock
 * from `00:00` to `23:59`; absent, `00:00`, the calendar day, which is what every record written so
 * far has. The lines do not change: a line's `at` is the instant the thing happened, as always, and
 * the setting is a reader's. The local day of an instant is its calendar date in the record's zone,
 * except that an instant whose local wall clock is before `day_start` belongs to the date before;
 * the comparison is on the wall clock after localising, so a change of offset in the night moves no
 * line.
 *
 * A reader that finds the key and either does not implement the RFC or cannot parse the value MUST
 * say so and MUST NOT group by day as if the key were absent: it refuses the command that groups,
 * naming the key and the value. Under the `rfc0036` flag every reader here that groups lines by day
 * (`show`, `day`, `days`, `trips`, the rollups, `people`, `stats`, `sources --gaps`) checks the key
 * first: a value that is not a clock is refused in the reference's words (openlogbook 0.6.1, run on
 * the conformance sample with the key set), and a clock other than midnight is refused too, since
 * none of them puts a line on a day by it yet. `verify`, `add` and the list of sources never group
 * by day and never look. With the flag off the key is not read, as before this RFC.
 */

import { addDays, localOf } from "./clock.js";
import { isOn, RFC0036 } from "./flags.js";
import { pyRepr } from "./pyrepr.js";
import { LogbookError } from "./store.js";
import type { JsonValue, Meta } from "./types.js";

/** The key in `logbook.json`. */
export const DAY_START = "day_start";
/** The day as the calendar has it: what an absent key means. */
export const DEFAULT_DAY_START = "00:00";
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `logbook.json` sets a `day_start` that a reader here cannot group lines by. */
export class DayStartError extends LogbookError {
  override readonly name = "DayStartError";
}

/**
 * The record's `day_start`: the clock written, or `00:00` when the key is absent or null (the
 * reference reads null as absent). A value that is not a clock `HH:MM` from `00:00` to `23:59` is
 * refused in the reference's words.
 */
export function readDayStart(meta: Meta): string {
  const value = meta[DAY_START];
  if (value === undefined || value === null) return DEFAULT_DAY_START;
  if (typeof value === "string" && CLOCK.test(value)) return value;
  throw new DayStartError(
    `logbook.json has day_start ${pyRepr(value as JsonValue)}, which is not a clock from 00:00 to 23:59 written HH:MM; a reader that groups lines by day refuses rather than guess (RFC 0036): write it as "06:00", or remove the key for midnight`,
  );
}

/**
 * For a reader that groups lines by day: under the `rfc0036` flag, the record's `day_start` when a
 * reader here can group by it (midnight), else refused, naming the key and the value. With the flag
 * off the key is not read and the calendar day is returned, as before RFC 0036.
 */
export function checkDayStart(meta: Meta): string {
  if (!isOn(RFC0036)) return DEFAULT_DAY_START;
  const dayStart = readDayStart(meta);
  if (dayStart !== DEFAULT_DAY_START) {
    throw new DayStartError(
      `logbook.json has day_start ${pyRepr(dayStart)}, and this implementation does not yet put a line on a day by it; a reader that groups lines by day refuses rather than guess (RFC 0036)`,
    );
  }
  return dayStart;
}

/**
 * The local day of an instant (RFC 0036): its calendar date in `timezone`, the date before when its
 * wall clock there reads earlier than `dayStart`.
 */
export function localDayOf(ms: number, timezone: string, dayStart = DEFAULT_DAY_START): string {
  const { day, clock } = localOf(ms, timezone);
  return clock < dayStart ? addDays(day, -1) : day;
}

/** Today in the record's zone, by the same rule: at 05:59 with `06:00`, it is still yesterday. */
export const localToday = (now: Date, timezone: string, dayStart = DEFAULT_DAY_START): string =>
  localDayOf(now.getTime(), timezone, dayStart);
