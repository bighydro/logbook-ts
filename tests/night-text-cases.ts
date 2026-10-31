/**
 * The Day's text of the reference's 1.0.0 (its #429 and #430), on records no fixture holds: a night no
 * stay places reads `in transit` only while a move the Day lists or a standing flight crosses the night
 * window, else `not recorded` (a flight that lands at 22:00 or leaves at 07:59 crosses it, one that
 * leaves at 08:00 does not, one with no end counts by its departure, the evening flight before the day
 * counts though the Day does not list it, a move counts only on the Day that lists it); an event's
 * title before its time, `from 2 sources (…)`, and an end on a later day kept (`23:30–03:00+1`), at
 * local midnight too. Synthetic days in Oslo, March 2026; `expected` is the reference's `logbook day`
 * on each day of each record (2c3e158), readiness and all, captured by running it and never edited by
 * hand. Read by tests/night-text.test.ts and, against the reference itself, by tests/cross-impl.test.ts.
 */

import type { Draft } from "./helpers.js";

export interface NightTextCase {
  name: string;
  lines: Draft[];
  /** Each day read, and the reference's `logbook day` of it. */
  expected: Record<string, string>;
}

const flight = (n: number, at: string, end: string | null): Draft => ({
  at,
  end,
  source: "manual",
  kind: "flight",
  tier: 1,
  payload: {
    schema: "flight/v1",
    actual_departure: at,
    ...(end === null ? {} : { actual_arrival: end }),
    carrier: "XY",
    number: String(100 + n),
    date: at.slice(0, 10),
    evidence: "declared",
    from: { iata: "OSL" },
    to: { iata: "BGO" },
    raw_id: `f${n}`,
    role: "passenger",
    observations: [{ evidence: "declared", source: "manual" }],
  },
});

const event = (
  raw: string,
  at: string,
  end: string | null,
  source: string,
  title: string,
  allDay = false,
): Draft => ({
  at,
  end,
  source,
  kind: "event",
  tier: 1,
  payload: { schema: "event/v1", raw_id: raw, title, ...(allDay ? { all_day: true } : {}) },
});

const iso = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");

/** A stay from `a` to `b`, a move of a few hundred metres every five minutes to `c`, a stay to `d` (UTC). */
function track(a: string, b: string, c: string, d: string): Draft[] {
  const out: Draft[] = [];
  const point = (ms: number, step: number): Draft => ({
    at: iso(ms),
    source: "sim-phone",
    kind: "location",
    tier: 1,
    payload: { schema: "location/v1", lat: 59.91 + 0.005 * step, lon: 10.75, accuracy_m: 10 },
  });
  let ms = Date.parse(a);
  let step = 0;
  for (; ms < Date.parse(b); ms += 600_000) out.push(point(ms, 0));
  for (; ms < Date.parse(c); ms += 300_000) out.push(point(ms, ++step));
  for (; ms < Date.parse(d); ms += 600_000) out.push(point(ms, step));
  return out;
}

export const NIGHT_TEXT_CASES: NightTextCase[] = [
  {
    name: "flights across the night window, and at its edges",
    lines: [
      flight(1, "2026-03-20T10:00:00Z", "2026-03-20T12:00:00Z"),
      flight(2, "2026-03-20T22:30:00Z", "2026-03-21T02:00:00Z"),
      flight(3, "2026-03-22T20:00:00Z", "2026-03-22T21:00:00Z"),
      flight(4, "2026-03-24T07:00:00Z", "2026-03-24T08:00:00Z"),
      flight(5, "2026-03-26T06:59:00Z", "2026-03-26T08:00:00Z"),
      flight(6, "2026-03-27T21:00:00Z", null),
      flight(7, "2026-03-29T19:00:00Z", null),
      flight(8, "2026-03-17T22:00:00Z", "2026-03-17T23:00:00Z"),
    ],
    expected: {
      "2026-03-17":
        "2026-03-17  Tuesday · unsigned\n  night before  not recorded\n  night after   in transit\n  country       unknown\n\n  23:00–00:00+1 flight XY 108  OSL → BGO · declared\n\n  health        no lines\n  sources       manual 1 line, last 23:00\n  readiness     mail none · message none · meeting none · location none · photo none · calendar none\n",
      "2026-03-18":
        "2026-03-18  Wednesday · unsigned\n  night before  in transit\n  night after   not recorded\n  country       unknown\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       none\n  readiness     mail none · message none · meeting none · location none · photo none · calendar none\n",
      "2026-03-19":
        "2026-03-19  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       none\n  readiness     mail none · message none · meeting none · location none · photo none · calendar none\n",
      "2026-03-20":
        "2026-03-20  Friday · unsigned\n  night before  not recorded\n  night after   in transit\n  country       unknown\n\n  11:00–13:00  flight XY 101  OSL → BGO · declared\n  23:30–03:00+1 flight XY 102  OSL → BGO · declared\n\n  health        no lines\n  sources       manual 2 lines, last 23:30\n  readiness     mail none · message none · meeting none · location none · photo none · calendar none\n",
      "2026-03-21":
        "2026-03-21  Saturday · unsigned\n  night before  in transit\n  night after   not recorded\n  country       unknown\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       none\n  readiness     mail none · message none · meeting none · location none · photo none · calendar none\n",
      "2026-03-22":
        "2026-03-22  Sunday · unsigned\n  night before  not recorded\n  night after   in transit\n  country       unknown\n\n  21:00–22:00  flight XY 103  OSL → BGO · declared\n\n  health        no lines\n  sources       manual 1 line, last 21:00\n  readiness     mail none · message none · meeting none · location none · photo none · calendar none\n",
      "2026-03-23":
        "2026-03-23  Monday · unsigned\n  night before  in transit\n  night after   not recorded\n  country       unknown\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       none\n  readiness     mail none · message none · meeting none · location none · photo none · calendar none\n",
      "2026-03-24":
        "2026-03-24  Tuesday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n\n  08:00–09:00  flight XY 104  OSL → BGO · declared\n\n  health        no lines\n  sources       manual 1 line, last 08:00\n  readiness     mail none · message none · meeting none · location none · photo none · calendar none\n",
      "2026-03-25":
        "2026-03-25  Wednesday · unsigned\n  night before  not recorded\n  night after   in transit\n  country       unknown\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       none\n  readiness     mail none · message none · meeting none · location none · photo none · calendar none\n",
      "2026-03-26":
        "2026-03-26  Thursday · unsigned\n  night before  in transit\n  night after   not recorded\n  country       unknown\n\n  07:59–09:00  flight XY 105  OSL → BGO · declared\n\n  health        no lines\n  sources       manual 1 line, last 07:59\n  readiness     mail none · message none · meeting none · location none · photo none · calendar none\n",
      "2026-03-27":
        "2026-03-27  Friday · unsigned\n  night before  not recorded\n  night after   in transit\n  country       unknown\n\n  22:00        flight XY 106  OSL → BGO · declared\n\n  health        no lines\n  sources       manual 1 line, last 22:00\n  readiness     mail none · message none · meeting none · location none · photo none · calendar none\n",
      "2026-03-28":
        "2026-03-28  Saturday · unsigned\n  night before  in transit\n  night after   not recorded\n  country       unknown\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       none\n  readiness     mail none · message none · meeting none · location none · photo none · calendar none\n",
      "2026-03-29":
        "2026-03-29  Sunday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n\n  21:00        flight XY 107  OSL → BGO · declared\n\n  health        no lines\n  sources       manual 1 line, last 21:00\n  readiness     mail none · message none · meeting none · location none · photo none · calendar none\n",
      "2026-03-30":
        "2026-03-30  Monday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       none\n  readiness     mail none · message none · meeting none · location none · photo none · calendar none\n",
    },
  },
  {
    name: "a move across the night counts on the Day that lists it",
    lines: [
      ...track(
        "2026-03-20T12:00:00Z",
        "2026-03-20T20:30:00Z",
        "2026-03-21T07:30:00Z",
        "2026-03-21T12:00:00Z",
      ),
      ...track(
        "2026-03-24T12:00:00Z",
        "2026-03-24T19:00:00Z",
        "2026-03-24T21:00:00Z",
        "2026-03-25T00:00:00Z",
      ),
    ],
    expected: {
      "2026-03-20":
        "2026-03-20  Friday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       NO (nearest airport OSL) · from the longest stay\n\n  13:00–21:30  stay   59.9100,10.7500 · 8 h 30 min\n\n  health        no lines\n  sources       sim-phone 81 lines, last 23:55\n  readiness     mail none · message none · meeting none · location present · photo none · calendar none\n",
      "2026-03-21":
        "2026-03-21  Saturday · unsigned\n  night before  in transit\n  night after   not recorded\n  country       NO (nearest airport OSL) · from the longest stay\n\n  00:00–08:25  move   73.4 km · 8 h 25 min · walk\n  08:25–12:50  stay   60.5700,10.7500 · 4 h 25 min\n\n  health        no lines\n  sources       sim-phone 129 lines, last 12:50\n  readiness     mail none · message none · meeting none · location present · photo none · calendar none\n",
      "2026-03-24":
        "2026-03-24  Tuesday · unsigned\n  night before  not recorded\n  night after   60.0300,10.7500 (Oslo) · away\n  country       NO (nearest airport OSL)\n\n  13:00–20:00  stay   59.9100,10.7500 · 7 h\n  20:00–21:55  move   13.3 km · 1 h 55 min · walk\n  21:55–24:00  stay   60.0300,10.7500 (Oslo) · 2 h 5 min\n\n  health        no lines\n  sources       sim-phone 78 lines, last 23:50\n  readiness     mail none · message none · meeting none · location present · photo none · calendar none\n",
      "2026-03-25":
        "2026-03-25  Wednesday · unsigned\n  night before  60.0300,10.7500 (Oslo) · away\n  night after   not recorded\n  country       NO (nearest airport OSL) · from the longest stay\n\n  00:00–00:50  stay   60.0300,10.7500 (Oslo) · 50 min\n\n  health        no lines\n  sources       sim-phone 6 lines, last 00:50\n  readiness     mail none · message none · meeting none · location present · photo none · calendar none\n",
    },
  },
  {
    name: "an event's title before its time, its sources by name, an end on a later day",
    lines: [
      event("1", "2026-03-20T08:00:00Z", "2026-03-20T09:00:00Z", "ios-calendar", "Boat survey"),
      event("2", "2026-03-20T08:00:00Z", "2026-03-20T09:00:00Z", "ics", "boat survey"),
      event("3", "2026-03-20T12:00:00Z", null, "ics", "Dentist"),
      event("4", "2026-03-20T12:00:00Z", null, "ios-calendar", "Dentist"),
      event("5", "2026-03-20T15:00:00Z", null, "ios-calendar", "Call"),
      event("6", "2026-03-20T16:00:00Z", "2026-03-21T01:00:00Z", "ios-calendar", "Late party"),
      event("7", "2026-03-19T23:00:00Z", "2026-03-20T23:00:00Z", "ios-calendar", "Holiday", true),
      event("8", "2026-03-19T23:00:00Z", "2026-03-20T23:00:00Z", "ics", "Holiday", true),
      event("9", "2026-03-20T21:00:00Z", "2026-03-20T23:00:00Z", "ios-calendar", "To midnight"),
    ],
    expected: {
      "2026-03-20":
        "2026-03-20  Friday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Holiday · from 2 sources (ios-calendar, ics)\n\n  timeline      nothing logged\n\n  unplaced      09:00–10:00  event  Boat survey · from 2 sources (ios-calendar, ics)\n  unplaced      13:00  event  Dentist · from 2 sources (ics, ios-calendar)\n  unplaced      16:00  event  Call\n  unplaced      17:00–02:00+1  event  Late party\n  unplaced      22:00–00:00+1  event  To midnight\n\n  health        no lines\n  sources       ios-calendar 6 lines, last 22:00 · ics 3 lines, last 13:00\n  readiness     mail none · message none · meeting none · location none · photo none · calendar present\n",
    },
  },
];

/** The days each case reads. */
export const NIGHT_TEXT_DAYS: Record<string, string[]> = {
  "flights across the night window, and at its edges": [
    "2026-03-17",
    "2026-03-18",
    "2026-03-19",
    "2026-03-20",
    "2026-03-21",
    "2026-03-22",
    "2026-03-23",
    "2026-03-24",
    "2026-03-25",
    "2026-03-26",
    "2026-03-27",
    "2026-03-28",
    "2026-03-29",
    "2026-03-30",
  ],
  "a move across the night counts on the Day that lists it": [
    "2026-03-20",
    "2026-03-21",
    "2026-03-24",
    "2026-03-25",
  ],
  "an event's title before its time, its sources by name, an end on a later day": ["2026-03-20"],
};
