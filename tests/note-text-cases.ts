/**
 * A note's text, as the reference prints it at d053f78 (run on a record of these lines; never edited
 * by hand): `show`'s summary takes Python's `str()` of the text (nothing for none, `false` or 0) and
 * strips its end, then its first line that is not blank, ` … (+N lines)` after it; the Day's takes
 * the same `str()`, strips both ends, its first line, `(empty)` when nothing is left, cut to 72
 * characters. Each row: the payload's `text` (undefined: no key), `show`'s summary, the Day's text.
 * tests/notes.test.ts and tests/cross-impl.test.ts read them.
 */

import type { JsonValue } from "../src/types.js";
import type { Draft } from "./helpers.js";

export const DAY = "2026-06-13";

export const NOTE_TEXTS: Array<[JsonValue | undefined, string, string]> = [
  ["\n\nabc", "abc", "abc"],
  ["abc\n\n", "abc", "abc"],
  [42, "42", "42"],
  [undefined, "", "(empty)"],
  [false, "", "(empty)"],
  ["   ", "", "(empty)"],
  ["   x   \n", "   x", "x"],
  ["a\n   \nb", "a … (+2 lines)", "a"],
  [0, "", "(empty)"],
  [["x"], "['x']", "['x']"],
  [{ a: 1 }, "{'a': 1}", "{'a': 1}"],
  [
    "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…",
  ],
  [
    " yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
    " yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
    "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy…",
  ],
  ["\t tab first\nsecond", "\t tab first … (+1 line)", "tab first"],
  ["first\u2028second", "first … (+1 line)", "first"],
  ["  \n  lead blank then\nthird", "  lead blank then … (+1 line)", "lead blank then"],
  [3.5, "3.5", "3.5"],
  [true, "True", "True"],
  ["abc\r\n", "abc", "abc"],
  ["\u00a0nbsp\u00a0", "\u00a0nbsp", "nbsp"],
  ["line1\nline2\nline3", "line1 … (+2 lines)", "line1"],
];

/** The record: two location lines, then one note of each text, ten minutes apart from 08:00 local. */
export function notesRecord(): Draft[] {
  const location = (at: string): Draft => ({
    at,
    source: "sim-phone",
    kind: "location",
    tier: 1,
    payload: { schema: "location/v1", lat: 59.911, lon: 10.75, accuracy_m: 12 },
  });
  const notes = NOTE_TEXTS.map(([text], i): Draft => {
    const at = new Date(Date.UTC(2026, 5, 13, 6 + Math.floor(i / 6), (i % 6) * 10)).toISOString();
    return {
      at: `${at.slice(0, 19)}Z`,
      source: "manual",
      kind: "note",
      payload: { schema: "note/v1", ...(text === undefined ? {} : { text }) },
    };
  });
  return [location("2026-06-13T05:30:00Z"), location("2026-06-13T20:30:00Z"), ...notes];
}
