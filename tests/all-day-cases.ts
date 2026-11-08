/**
 * An all-day entry says all day (the reference's #436, CHANGELOG 1.1.0, *Fixed*): an `event/v1` line
 * flagged `all_day`, one that runs from a local midnight to a later one, and one that another calendar
 * carries flagged are all on the Day's `all day` row, two or more joined by ` and `, never in the
 * timeline at `00:00–00:00+1`; and a stay holds none of them, so none gives the day company. With them,
 * the fold of one entry that several calendars carry, as the reference's Day and `show` read it: a
 * timed copy leads its flagged copies, a flagged copy folds whatever its end, and the folded entry
 * stands where its lead does. Synthetic records of a person in Oslo who does not exist, one per case,
 * the entries on 3 September 2026. `expected` is the reference's output at its tag v1.1.0 (512170eb),
 * captured by running it on each record and never edited by hand: `logbook day 2026-09-03` (without its
 * readiness block), its `all_day` and `unplaced` in `--json`, `logbook show 2026-09-03`, and, for the
 * cases at home, the day's `stays` and `people` in `logbook days --json`. tests/all-day.test.ts holds
 * this implementation to them and tests/cross-impl.test.ts holds both to the reference itself.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Draft, writeBareRecord } from "./helpers.js";
import { PLACES } from "./speakers-cases.js";

/** The local midnights around the day in Oslo (UTC+2 in September), and a noon hour. */
const M = "2026-09-02T22:00:00Z";
const M1 = "2026-09-03T22:00:00Z";
const M2 = "2026-09-04T22:00:00Z";
const N = "2026-09-03T10:00:00Z";
const N1 = "2026-09-03T11:00:00Z";

export const DAY = "2026-09-03";

const attendee = (value: string, name: string) => ({
  name,
  ref: { kind: "email", value },
  response: "accepted",
});

/** One calendar entry; `all_day` only when given, as a calendar without the flag writes it. */
function entry(
  at: string,
  end: string | undefined,
  title: string,
  more: Record<string, unknown> = {},
  source = "ics",
): Draft {
  return {
    at,
    ...(end === undefined ? {} : { end }),
    source,
    kind: "event",
    tier: 1,
    payload: { schema: "event/v1", raw_id: `${source}:${title}:${at}`, title, ...more },
  };
}
const flagged = { all_day: true };
const timed = { all_day: false };

/** The people the home cases name, by an email resolution each. */
const PEOPLE: Array<[string, string, string]> = [
  ["019cadd3-6bc0-7dcd-9133-000000000301", "ola@example.org", "Ola Nordmann"],
  ["019cadd3-6bc0-7dcd-9133-000000000302", "kari@example.org", "Kari Nordmann"],
  ["019cadd3-6bc0-7dcd-9133-000000000304", "per@example.org", "Per Hansen"],
];

/** A day at home in Oslo, located every twenty minutes, and the people resolved the week before. */
function atHome(entries: Draft[]): Draft[] {
  const lines: Draft[] = PEOPLE.map(([id, value, label]) => ({
    at: "2026-08-30T08:00:00Z",
    source: "manual",
    kind: "resolution",
    payload: {
      schema: "resolution/v1",
      ref: { kind: "email", value },
      entity: { type: "person", id, registry: "logbook" },
      label,
      method: "manual",
    },
  }));
  lines.push(...entries);
  for (let h = 0; h <= 21; h++)
    for (const m of [0, 20, 40])
      lines.push({
        at: `${DAY}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`,
        source: "sim-phone",
        kind: "location",
        tier: 1,
        payload: { schema: "location/v1", lat: 59.9139, lon: 10.7522, accuracy_m: 10 },
      });
  return lines;
}

export interface AllDayExpected {
  /** `logbook day` as text, without its readiness block. */
  text: string;
  /** `all_day` and `unplaced` of `logbook day --json`. */
  allDay: unknown;
  unplaced: unknown;
  /** `logbook show` of the day. */
  show: string;
  /** For a case at home: the day's `stays` and `people` in `logbook days --json`. */
  days?: { stays: unknown; people: unknown };
  /** For a case at home: each timeline row's `with` in `logbook day --json`. */
  company?: unknown;
}

export interface AllDayCase {
  name: string;
  /** Whether the record is a day at home (stays, and the `days` reader), or the entries alone. */
  home: boolean;
  lines: Draft[];
}

const bare = (name: string, lines: Draft[]): AllDayCase => ({ name, home: false, lines });
const home = (name: string, entries: Draft[]): AllDayCase => ({
  name,
  home: true,
  lines: atHome(entries),
});

export const ALL_DAY_CASES: AllDayCase[] = [
  // The row: two or more entries joined by `and`, in the day's order.
  bare("two flagged entries", [
    entry(M, M1, "Away with Per Hansen", flagged),
    entry(M, M1, "17 May dinner", flagged),
  ]),
  bare("three flagged entries", [
    entry(M, M1, "Boat week", flagged),
    entry(M, M1, "Kari in town", flagged),
    entry(M, M1, "Ferry strike", flagged),
  ]),
  // From a midnight to a later one is all day, flagged or not, with the flag false or absent.
  bare("timed from midnight to midnight", [entry(M, M1, "Kari in town", timed)]),
  bare("no flag, from midnight to midnight", [entry(M, M1, "Kari in town")]),
  bare("timed from midnight to the midnight after next", [entry(M, M2, "Boat week", timed)]),
  bare("a flagged entry, then a timed whole day, then one at ten", [
    entry(M, M1, "Ola's birthday", flagged),
    entry(M, M1, "Kari in town", timed),
    entry("2026-09-03T08:00:00Z", "2026-09-03T09:00:00Z", "Standup"),
  ]),
  bare("a timed whole day first, then a flagged entry", [
    entry(M, M1, "Kari in town", timed),
    entry(M, M1, "Ola's birthday", flagged),
  ]),
  // Not all day: a midnight to a noon, a noon to a midnight, a midnight with no end, a UTC midnight.
  bare("from midnight to noon", [entry(M, "2026-09-03T10:00:00Z", "Haircut", timed)]),
  bare("from noon to midnight", [entry("2026-09-03T10:00:00Z", M1, "Sailing", timed)]),
  bare("a midnight and no end", [entry(M, undefined, "Notion page", {}, "notion")]),
  bare("a UTC midnight to the next", [
    entry("2026-09-03T00:00:00Z", "2026-09-04T00:00:00Z", "Conference", timed),
  ]),
  bare("flagged, at noon", [entry(N, N1, "Ola's birthday", flagged)]),
  // One entry two calendars carry, one flagged and one timed: one entry, the timed copy first.
  bare("flagged in one calendar, timed whole in another", [
    entry(M, M1, "Ola's birthday", flagged, "google"),
    entry(M, M1, "Ola's birthday", timed, "notion"),
  ]),
  bare("timed whole in one calendar, flagged in another", [
    entry(M, M1, "Ola's birthday", timed, "notion"),
    entry(M, M1, "Ola's birthday", flagged, "google"),
  ]),
  bare("timed whole in two calendars", [
    entry(M, M1, "Ola's birthday", timed, "google"),
    entry(M, M1, "Ola's birthday", {}, "notion"),
  ]),
  bare("flagged in two calendars", [
    entry(M, M1, "Ola's birthday", flagged, "google"),
    entry(M, M1, "Ola's birthday", flagged, "notion"),
  ]),
  bare("three calendars, the timed one between", [
    entry(M, M1, "Ola's birthday", flagged, "ics"),
    entry(M, M1, "Ola's birthday", timed, "notion"),
    entry(M, M1, "Ola's birthday", flagged, "google"),
  ]),
  bare("at noon in two calendars, flagged in one", [
    entry(N, N1, "Lunch", flagged, "google"),
    entry(N, N1, "Lunch", timed, "ics"),
  ]),
  bare("at noon in three calendars, flagged in the last", [
    entry(N, N1, "Lunch", {}, "ics"),
    entry(N, N1, "Lunch", {}, "notion"),
    entry(N, N1, "Lunch", flagged, "google"),
  ]),
  bare("one calendar flagged, another timed to a later midnight", [
    entry(M, M1, "Boat week", flagged, "google"),
    entry(M, M2, "Boat week", {}, "notion"),
  ]),
  bare("flagged in two calendars, the ends apart", [
    entry(M, M1, "Boat week", flagged, "google"),
    entry(M, M2, "Boat week", flagged, "notion"),
  ]),
  bare("the folded entry stands where its timed copy does", [
    entry(M, M1, "Ola's birthday", flagged, "google"),
    entry(M, M1, "Kari in town", flagged, "google"),
    entry(M, M1, "Ola's birthday", {}, "notion"),
  ]),
  bare("the timed copy first, the folded entry first", [
    entry(M, M1, "Ola's birthday", {}, "notion"),
    entry(M, M1, "Kari in town", flagged, "google"),
    entry(M, M1, "Ola's birthday", flagged, "google"),
  ]),
  bare("the title of the timed copy, case aside", [
    entry(M, M1, "Ola's Birthday", flagged, "google"),
    entry(M, M1, "ola's birthday ", {}, "notion"),
  ]),
  bare("a flagged copy with no end folds into a timed whole day", [
    entry(M, undefined, "Ola's birthday", flagged, "google"),
    entry(M, M1, "Ola's birthday", {}, "notion"),
  ]),
  // Not one entry: one calendar twice, two timed copies whose ends differ, two starts.
  bare("one calendar, flagged and timed", [
    entry(M, M1, "Ola's birthday", flagged),
    entry(M, M1, "Ola's birthday", timed),
  ]),
  bare("one calendar, timed whole twice", [
    entry(M, M1, "Ola's birthday"),
    entry(M, M1, "Ola's birthday"),
  ]),
  bare("two calendars timed, the ends apart", [
    entry(M, M1, "Boat week", {}, "google"),
    entry(M, M2, "Boat week", {}, "notion"),
  ]),
  bare("two calendars flagged, the starts apart", [
    entry(M, M1, "Ola's birthday", flagged, "google"),
    entry(N, N1, "Ola's birthday", flagged, "notion"),
  ]),
  bare("flagged at noon, timed whole in another calendar", [
    entry(N, N1, "Ola's birthday", flagged, "google"),
    entry(M, M1, "Ola's birthday", {}, "notion"),
  ]),
  bare("flagged at the UTC midnight, timed at the local one", [
    entry("2026-09-03T00:00:00Z", "2026-09-04T00:00:00Z", "Ola's birthday", flagged, "google"),
    entry(M, M1, "Ola's birthday", {}, "notion"),
  ]),
  bare("two calendars at noon, flagged at midnight in a third", [
    entry(N, N1, "Lunch", {}, "ics"),
    entry(M, M1, "Lunch", flagged, "google"),
    entry(N, N1, "Lunch", {}, "notion"),
  ]),
  // At home: an all-day entry is held by no stay and names nobody as company.
  home("at home, timed from midnight to midnight with an attendee", [
    entry(M, M1, "Ola visits", { attendees: [attendee("ola@example.org", "Ola")] }),
  ]),
  home("at home, flagged with an attendee", [
    entry(M, M1, "Kari visits", {
      all_day: true,
      attendees: [attendee("kari@example.org", "Kari")],
    }),
  ]),
  home("at home, lunch at noon that another calendar carries flagged", [
    entry(N, N1, "Lunch", { attendees: [attendee("per@example.org", "Per")] }),
    entry(N, N1, "Lunch", flagged, "google"),
  ]),
  // Located at the stay (`location` a place in places.json), an all-day entry proposes its attendees.
  home("at home, flagged and located with an attendee", [
    entry(M, M1, "Ola visits", {
      all_day: true,
      location: "Home",
      attendees: [attendee("ola@example.org", "Ola")],
    }),
  ]),
  home("at home, timed from midnight to midnight and located with an attendee", [
    entry(M, M1, "Ola visits", {
      all_day: false,
      location: "Home",
      attendees: [attendee("ola@example.org", "Ola")],
    }),
  ]),
  home("at home, flagged and located with an attendee, and no end", [
    entry(M, undefined, "Ola visits", {
      all_day: true,
      location: "Home",
      attendees: [attendee("ola@example.org", "Ola")],
    }),
  ]),
  home("at home, a bare timed copy and a flagged copy located with an attendee", [
    entry(M, M1, "Ola visits", {}, "notion"),
    entry(
      M,
      M1,
      "Ola visits",
      { all_day: true, location: "Home", attendees: [attendee("ola@example.org", "Ola")] },
      "google",
    ),
  ]),
  home("at home, lunch at noon located with an attendee", [
    entry(N, N1, "Lunch", { location: "Home", attendees: [attendee("ola@example.org", "Ola")] }),
  ]),
  home("at home, lunch at noon", [
    entry(N, N1, "Lunch", { attendees: [attendee("per@example.org", "Per")] }),
  ]),
];

/** The record of a case. */
export function allDayRecord(c: AllDayCase): string {
  const root = writeBareRecord(c.lines);
  if (c.home) writeFileSync(join(root, "places.json"), `${JSON.stringify(PLACES)}\n`, "utf-8");
  return root;
}

/** The reference's output on each case at v1.1.0 (512170eb), by case name, as captured (above). */
export const ALL_DAY_EXPECTED: Record<string, AllDayExpected> = {
  "two flagged entries": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Away with Per Hansen and 17 May dinner\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       ics 2 lines, last 00:00\n",
    allDay: [
      {
        title: "Away with Per Hansen",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
      {
        title: "17 May dinner",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000002"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ics            Away with Per Hansen\n  00:00  event      ics            17 May dinner\n",
  },
  "three flagged entries": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Boat week and Kari in town and Ferry strike\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       ics 3 lines, last 00:00\n",
    allDay: [
      {
        title: "Boat week",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
      {
        title: "Kari in town",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000002"],
      },
      {
        title: "Ferry strike",
        line: "00000000-0000-4000-8000-000000000003",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000003"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ics            Boat week\n  00:00  event      ics            Kari in town\n  00:00  event      ics            Ferry strike\n",
  },
  "timed from midnight to midnight": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Kari in town\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       ics 1 line, last 00:00\n",
    allDay: [
      {
        title: "Kari in town",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ics            Kari in town\n",
  },
  "no flag, from midnight to midnight": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Kari in town\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       ics 1 line, last 00:00\n",
    allDay: [
      {
        title: "Kari in town",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ics            Kari in town\n",
  },
  "timed from midnight to the midnight after next": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Boat week\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       ics 1 line, last 00:00\n",
    allDay: [
      {
        title: "Boat week",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ics            Boat week\n",
  },
  "a flagged entry, then a timed whole day, then one at ten": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Ola's birthday and Kari in town\n\n  timeline      nothing logged\n\n  unplaced      10:00–11:00  event  Standup\n\n  health        no lines\n  sources       ics 3 lines, last 10:00\n",
    allDay: [
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
      {
        title: "Kari in town",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000002"],
      },
    ],
    unplaced: [
      {
        kind: "event",
        at: "2026-09-03T08:00:00Z",
        end: "2026-09-03T09:00:00Z",
        title: "Standup",
        line: "00000000-0000-4000-8000-000000000003",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000003"],
      },
    ],
    show: "2026-09-03  unsigned\n  00:00  event      ics            Ola's birthday\n  00:00  event      ics            Kari in town\n  10:00  event      ics            Standup\n",
  },
  "a timed whole day first, then a flagged entry": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Kari in town and Ola's birthday\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       ics 2 lines, last 00:00\n",
    allDay: [
      {
        title: "Kari in town",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000002"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ics            Kari in town\n  00:00  event      ics            Ola's birthday\n",
  },
  "from midnight to noon": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n\n  timeline      nothing logged\n\n  unplaced      00:00–12:00  event  Haircut\n\n  health        no lines\n  sources       ics 1 line, last 00:00\n",
    allDay: [],
    unplaced: [
      {
        kind: "event",
        at: "2026-09-02T22:00:00Z",
        end: "2026-09-03T10:00:00Z",
        title: "Haircut",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
    ],
    show: "2026-09-03  unsigned\n  00:00  event      ics            Haircut\n",
  },
  "from noon to midnight": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n\n  timeline      nothing logged\n\n  unplaced      12:00–00:00+1  event  Sailing\n\n  health        no lines\n  sources       ics 1 line, last 12:00\n",
    allDay: [],
    unplaced: [
      {
        kind: "event",
        at: "2026-09-03T10:00:00Z",
        end: "2026-09-03T22:00:00Z",
        title: "Sailing",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
    ],
    show: "2026-09-03  unsigned\n  12:00  event      ics            Sailing\n",
  },
  "a midnight and no end": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n\n  timeline      nothing logged\n\n  unplaced      00:00  event  Notion page\n\n  health        no lines\n  sources       notion 1 line, last 00:00\n",
    allDay: [],
    unplaced: [
      {
        kind: "event",
        at: "2026-09-02T22:00:00Z",
        end: null,
        title: "Notion page",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["notion"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
    ],
    show: "2026-09-03  unsigned\n  00:00  event      notion         Notion page\n",
  },
  "a UTC midnight to the next": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n\n  timeline      nothing logged\n\n  unplaced      02:00–02:00+1  event  Conference\n\n  health        no lines\n  sources       ics 1 line, last 02:00\n",
    allDay: [],
    unplaced: [
      {
        kind: "event",
        at: "2026-09-03T00:00:00Z",
        end: "2026-09-04T00:00:00Z",
        title: "Conference",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
    ],
    show: "2026-09-03  unsigned\n  02:00  event      ics            Conference\n",
  },
  "flagged, at noon": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Ola's birthday\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       ics 1 line, last 12:00\n",
    allDay: [
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  12:00  event      ics            Ola's birthday\n",
  },
  "flagged in one calendar, timed whole in another": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Ola's birthday · from 2 sources (notion, google)\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 1 line, last 00:00 · notion 1 line, last 00:00\n",
    allDay: [
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["notion", "google"],
        lines: ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000001"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ×2 sources     Ola's birthday\n",
  },
  "timed whole in one calendar, flagged in another": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Ola's birthday · from 2 sources (notion, google)\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 1 line, last 00:00 · notion 1 line, last 00:00\n",
    allDay: [
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["notion", "google"],
        lines: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ×2 sources     Ola's birthday\n",
  },
  "timed whole in two calendars": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Ola's birthday · from 2 sources (google, notion)\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 1 line, last 00:00 · notion 1 line, last 00:00\n",
    allDay: [
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["google", "notion"],
        lines: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ×2 sources     Ola's birthday\n",
  },
  "flagged in two calendars": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Ola's birthday · from 2 sources (google, notion)\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 1 line, last 00:00 · notion 1 line, last 00:00\n",
    allDay: [
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["google", "notion"],
        lines: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ×2 sources     Ola's birthday\n",
  },
  "three calendars, the timed one between": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Ola's birthday · from 3 sources (notion, ics, google)\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 1 line, last 00:00 · ics 1 line, last 00:00 · notion 1 line, last 00:00\n",
    allDay: [
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["notion", "ics", "google"],
        lines: [
          "00000000-0000-4000-8000-000000000002",
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000003",
        ],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ×3 sources     Ola's birthday\n",
  },
  "at noon in two calendars, flagged in one": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Lunch · from 2 sources (ics, google)\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 1 line, last 12:00 · ics 1 line, last 12:00\n",
    allDay: [
      {
        title: "Lunch",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["ics", "google"],
        lines: ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000001"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  12:00  event      ×2 sources     Lunch\n",
  },
  "at noon in three calendars, flagged in the last": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Lunch · from 3 sources (ics, notion, google)\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 1 line, last 12:00 · ics 1 line, last 12:00 · notion 1 line, last 12:00\n",
    allDay: [
      {
        title: "Lunch",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["ics", "notion", "google"],
        lines: [
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000002",
          "00000000-0000-4000-8000-000000000003",
        ],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  12:00  event      ×3 sources     Lunch\n",
  },
  "one calendar flagged, another timed to a later midnight": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Boat week · from 2 sources (notion, google)\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 1 line, last 00:00 · notion 1 line, last 00:00\n",
    allDay: [
      {
        title: "Boat week",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["notion", "google"],
        lines: ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000001"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ×2 sources     Boat week\n",
  },
  "flagged in two calendars, the ends apart": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Boat week · from 2 sources (google, notion)\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 1 line, last 00:00 · notion 1 line, last 00:00\n",
    allDay: [
      {
        title: "Boat week",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["google", "notion"],
        lines: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ×2 sources     Boat week\n",
  },
  "the folded entry stands where its timed copy does": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Kari in town and Ola's birthday · from 2 sources (notion, google)\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 2 lines, last 00:00 · notion 1 line, last 00:00\n",
    allDay: [
      {
        title: "Kari in town",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["google"],
        lines: ["00000000-0000-4000-8000-000000000002"],
      },
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000003",
        sources: ["notion", "google"],
        lines: ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000001"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      google         Kari in town\n  00:00  event      ×2 sources     Ola's birthday\n",
  },
  "the timed copy first, the folded entry first": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Ola's birthday · from 2 sources (notion, google) and Kari in town\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 2 lines, last 00:00 · notion 1 line, last 00:00\n",
    allDay: [
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["notion", "google"],
        lines: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000003"],
      },
      {
        title: "Kari in town",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["google"],
        lines: ["00000000-0000-4000-8000-000000000002"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ×2 sources     Ola's birthday\n  00:00  event      google         Kari in town\n",
  },
  "the title of the timed copy, case aside": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       ola's birthday  · from 2 sources (notion, google)\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 1 line, last 00:00 · notion 1 line, last 00:00\n",
    allDay: [
      {
        title: "ola's birthday ",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["notion", "google"],
        lines: ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000001"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ×2 sources     ola's birthday \n",
  },
  "a flagged copy with no end folds into a timed whole day": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Ola's birthday · from 2 sources (notion, google)\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 1 line, last 00:00 · notion 1 line, last 00:00\n",
    allDay: [
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["notion", "google"],
        lines: ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000001"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ×2 sources     Ola's birthday\n",
  },
  "one calendar, flagged and timed": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Ola's birthday and Ola's birthday\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       ics 2 lines, last 00:00\n",
    allDay: [
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000002"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ics            Ola's birthday\n  00:00  event      ics            Ola's birthday\n",
  },
  "one calendar, timed whole twice": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Ola's birthday and Ola's birthday\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       ics 2 lines, last 00:00\n",
    allDay: [
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000002"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ics            Ola's birthday\n  00:00  event      ics            Ola's birthday\n",
  },
  "two calendars timed, the ends apart": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Boat week and Boat week\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 1 line, last 00:00 · notion 1 line, last 00:00\n",
    allDay: [
      {
        title: "Boat week",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["google"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
      {
        title: "Boat week",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["notion"],
        lines: ["00000000-0000-4000-8000-000000000002"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      google         Boat week\n  00:00  event      notion         Boat week\n",
  },
  "two calendars flagged, the starts apart": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Ola's birthday and Ola's birthday\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 1 line, last 00:00 · notion 1 line, last 12:00\n",
    allDay: [
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["google"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["notion"],
        lines: ["00000000-0000-4000-8000-000000000002"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      google         Ola's birthday\n  12:00  event      notion         Ola's birthday\n",
  },
  "flagged at noon, timed whole in another calendar": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Ola's birthday and Ola's birthday\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 1 line, last 12:00 · notion 1 line, last 00:00\n",
    allDay: [
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["notion"],
        lines: ["00000000-0000-4000-8000-000000000002"],
      },
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["google"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      notion         Ola's birthday\n  12:00  event      google         Ola's birthday\n",
  },
  "flagged at the UTC midnight, timed at the local one": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Ola's birthday and Ola's birthday\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       google 1 line, last 02:00 · notion 1 line, last 00:00\n",
    allDay: [
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["notion"],
        lines: ["00000000-0000-4000-8000-000000000002"],
      },
      {
        title: "Ola's birthday",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["google"],
        lines: ["00000000-0000-4000-8000-000000000001"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      notion         Ola's birthday\n  02:00  event      google         Ola's birthday\n",
  },
  "two calendars at noon, flagged at midnight in a third": {
    text: "2026-09-03  Thursday · unsigned\n  night before  not recorded\n  night after   not recorded\n  country       unknown\n  all day       Lunch\n\n  timeline      nothing logged\n\n  unplaced      12:00–13:00  event  Lunch · from 2 sources (ics, notion)\n\n  health        no lines\n  sources       google 1 line, last 00:00 · ics 1 line, last 12:00 · notion 1 line, last 12:00\n",
    allDay: [
      {
        title: "Lunch",
        line: "00000000-0000-4000-8000-000000000002",
        sources: ["google"],
        lines: ["00000000-0000-4000-8000-000000000002"],
      },
    ],
    unplaced: [
      {
        kind: "event",
        at: "2026-09-03T10:00:00Z",
        end: "2026-09-03T11:00:00Z",
        title: "Lunch",
        line: "00000000-0000-4000-8000-000000000001",
        sources: ["ics", "notion"],
        lines: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000003"],
      },
    ],
    show: "2026-09-03  unsigned\n  00:00  event      google         Lunch\n  12:00  event      ×2 sources     Lunch\n",
  },
  "at home, timed from midnight to midnight with an attendee": {
    text: "2026-09-03  Thursday · unsigned\n  night before  Home · home\n  night after   Home · home\n  country       NO (place Home)\n  all day       Ola visits\n\n  02:00–23:40  stay   Home · 21 h 40 min\n\n  health        no lines\n  sources       sim-phone 66 lines, last 23:40 · ics 1 line, last 00:00\n",
    allDay: [
      {
        title: "Ola visits",
        line: "00000000-0000-4000-8000-000000000004",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000004"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ics            Ola visits · with Ola Nordmann\n  02:00–23:40  location   sim-phone      66 points\n",
    days: {
      stays: {
        count: 1,
        attached: 0,
        with_attachments: 0,
      },
      people: {
        confirmed: 0,
        names: [],
      },
    },
    company: [
      {
        confirmed: [],
        proposed: [],
      },
    ],
  },
  "at home, flagged with an attendee": {
    text: "2026-09-03  Thursday · unsigned\n  night before  Home · home\n  night after   Home · home\n  country       NO (place Home)\n  all day       Kari visits\n\n  02:00–23:40  stay   Home · 21 h 40 min\n\n  health        no lines\n  sources       sim-phone 66 lines, last 23:40 · ics 1 line, last 00:00\n",
    allDay: [
      {
        title: "Kari visits",
        line: "00000000-0000-4000-8000-000000000004",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000004"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ics            Kari visits · with Kari Nordmann\n  02:00–23:40  location   sim-phone      66 points\n",
    days: {
      stays: {
        count: 1,
        attached: 0,
        with_attachments: 0,
      },
      people: {
        confirmed: 0,
        names: [],
      },
    },
    company: [
      {
        confirmed: [],
        proposed: [],
      },
    ],
  },
  "at home, lunch at noon that another calendar carries flagged": {
    text: "2026-09-03  Thursday · unsigned\n  night before  Home · home\n  night after   Home · home\n  country       NO (place Home)\n  all day       Lunch · from 2 sources (ics, google)\n\n  02:00–23:40  stay   Home · 21 h 40 min\n\n  health        no lines\n  sources       sim-phone 66 lines, last 23:40 · google 1 line, last 12:00 · ics 1 line, last 12:00\n",
    allDay: [
      {
        title: "Lunch",
        line: "00000000-0000-4000-8000-000000000004",
        sources: ["ics", "google"],
        lines: ["00000000-0000-4000-8000-000000000004", "00000000-0000-4000-8000-000000000005"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  02:00–11:40  location   sim-phone      30 points\n  12:00  event      ×2 sources     Lunch · with Per Hansen\n  12:00–23:40  location   sim-phone      36 points\n",
    days: {
      stays: {
        count: 1,
        attached: 0,
        with_attachments: 0,
      },
      people: {
        confirmed: 0,
        names: [],
      },
    },
    company: [
      {
        confirmed: [],
        proposed: [],
      },
    ],
  },
  "at home, flagged and located with an attendee": {
    text: "2026-09-03  Thursday · unsigned\n  night before  Home · home\n  night after   Home · home\n  country       NO (place Home)\n  all day       Ola visits\n\n  02:00–23:40  stay   Home · 21 h 40 min\n      with         proposed Ola Nordmann (calendar)\n\n  health        no lines\n  sources       sim-phone 66 lines, last 23:40 · ics 1 line, last 00:00\n",
    allDay: [
      {
        title: "Ola visits",
        line: "00000000-0000-4000-8000-000000000004",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000004"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ics            Ola visits · with Ola Nordmann\n  02:00–23:40  location   sim-phone      66 points\n",
    days: {
      stays: {
        count: 1,
        attached: 0,
        with_attachments: 0,
      },
      people: {
        confirmed: 0,
        names: [],
      },
    },
    company: [
      {
        confirmed: [],
        proposed: [
          {
            person: "019cadd3-6bc0-7dcd-9133-000000000301",
            name: "Ola Nordmann",
            status: "proposed",
            confidence: 0.3,
            sources: ["calendar"],
            reasons: ["attendee of Ola visits (all day)"],
            lines: ["00000000-0000-4000-8000-000000000004"],
          },
        ],
      },
    ],
  },
  "at home, timed from midnight to midnight and located with an attendee": {
    text: "2026-09-03  Thursday · unsigned\n  night before  Home · home\n  night after   Home · home\n  country       NO (place Home)\n  all day       Ola visits\n\n  02:00–23:40  stay   Home · 21 h 40 min\n      with         proposed Ola Nordmann (calendar)\n\n  health        no lines\n  sources       sim-phone 66 lines, last 23:40 · ics 1 line, last 00:00\n",
    allDay: [
      {
        title: "Ola visits",
        line: "00000000-0000-4000-8000-000000000004",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000004"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ics            Ola visits · with Ola Nordmann\n  02:00–23:40  location   sim-phone      66 points\n",
    days: {
      stays: {
        count: 1,
        attached: 0,
        with_attachments: 0,
      },
      people: {
        confirmed: 0,
        names: [],
      },
    },
    company: [
      {
        confirmed: [],
        proposed: [
          {
            person: "019cadd3-6bc0-7dcd-9133-000000000301",
            name: "Ola Nordmann",
            status: "proposed",
            confidence: 0.3,
            sources: ["calendar"],
            reasons: ["attendee of Ola visits (all day)"],
            lines: ["00000000-0000-4000-8000-000000000004"],
          },
        ],
      },
    ],
  },
  "at home, flagged and located with an attendee, and no end": {
    text: "2026-09-03  Thursday · unsigned\n  night before  Home · home\n  night after   Home · home\n  country       NO (place Home)\n  all day       Ola visits\n\n  02:00–23:40  stay   Home · 21 h 40 min\n\n  health        no lines\n  sources       sim-phone 66 lines, last 23:40 · ics 1 line, last 00:00\n",
    allDay: [
      {
        title: "Ola visits",
        line: "00000000-0000-4000-8000-000000000004",
        sources: ["ics"],
        lines: ["00000000-0000-4000-8000-000000000004"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ics            Ola visits · with Ola Nordmann\n  02:00–23:40  location   sim-phone      66 points\n",
    days: {
      stays: {
        count: 1,
        attached: 0,
        with_attachments: 0,
      },
      people: {
        confirmed: 0,
        names: [],
      },
    },
    company: [
      {
        confirmed: [],
        proposed: [],
      },
    ],
  },
  "at home, a bare timed copy and a flagged copy located with an attendee": {
    text: "2026-09-03  Thursday · unsigned\n  night before  Home · home\n  night after   Home · home\n  country       NO (place Home)\n  all day       Ola visits · from 2 sources (notion, google)\n\n  02:00–23:40  stay   Home · 21 h 40 min\n\n  health        no lines\n  sources       sim-phone 66 lines, last 23:40 · google 1 line, last 00:00 · notion 1 line, last 00:00\n",
    allDay: [
      {
        title: "Ola visits",
        line: "00000000-0000-4000-8000-000000000004",
        sources: ["notion", "google"],
        lines: ["00000000-0000-4000-8000-000000000004", "00000000-0000-4000-8000-000000000005"],
      },
    ],
    unplaced: [],
    show: "2026-09-03  unsigned\n  00:00  event      ×2 sources     Ola visits\n  02:00–23:40  location   sim-phone      66 points\n",
    days: {
      stays: {
        count: 1,
        attached: 0,
        with_attachments: 0,
      },
      people: {
        confirmed: 0,
        names: [],
      },
    },
    company: [
      {
        confirmed: [],
        proposed: [],
      },
    ],
  },
  "at home, lunch at noon located with an attendee": {
    text: "2026-09-03  Thursday · unsigned\n  night before  Home · home\n  night after   Home · home\n  country       NO (place Home)\n\n  02:00–23:40  stay   Home · 21 h 40 min · 1 event\n      event        Lunch, from 12:00 to 13:00\n      with         Ola Nordmann (calendar)\n\n  health        no lines\n  sources       sim-phone 66 lines, last 23:40 · ics 1 line, last 12:00\n",
    allDay: [],
    unplaced: [],
    show: "2026-09-03  unsigned\n  02:00–11:40  location   sim-phone      30 points\n  12:00  event      ics            Lunch · with Ola Nordmann\n  12:00–23:40  location   sim-phone      36 points\n",
    days: {
      stays: {
        count: 1,
        attached: 1,
        with_attachments: 1,
      },
      people: {
        confirmed: 1,
        names: ["Ola Nordmann"],
      },
    },
    company: [
      {
        confirmed: [
          {
            person: "019cadd3-6bc0-7dcd-9133-000000000301",
            name: "Ola Nordmann",
            status: "confirmed",
            confidence: 0.8,
            sources: ["calendar"],
            reasons: ["attendee of Lunch"],
            lines: ["00000000-0000-4000-8000-000000000004"],
          },
        ],
        proposed: [],
      },
    ],
  },
  "at home, lunch at noon": {
    text: "2026-09-03  Thursday · unsigned\n  night before  Home · home\n  night after   Home · home\n  country       NO (place Home)\n\n  02:00–23:40  stay   Home · 21 h 40 min · 1 event\n      event        Lunch, from 12:00 to 13:00\n\n  health        no lines\n  sources       sim-phone 66 lines, last 23:40 · ics 1 line, last 12:00\n",
    allDay: [],
    unplaced: [],
    show: "2026-09-03  unsigned\n  02:00–11:40  location   sim-phone      30 points\n  12:00  event      ics            Lunch · with Per Hansen\n  12:00–23:40  location   sim-phone      36 points\n",
    days: {
      stays: {
        count: 1,
        attached: 1,
        with_attachments: 1,
      },
      people: {
        confirmed: 0,
        names: [],
      },
    },
    company: [
      {
        confirmed: [],
        proposed: [],
      },
    ],
  },
};
