/**
 * A line superseded twice (the reference's issue #321, its docs/SPEC-QUESTIONS.md of 18 October 2026):
 * a line is superseded while at least one line of its kind that is not retracted supersedes it. A
 * retracted superseder supersedes nothing; a superseder superseded in turn still supersedes. The six
 * rows of that question's table, as synthetic records of Ines Nordmann's dinner on 3 October 2026,
 * and the same rule for a flight, a person's name and a person's transcripts. Read by
 * tests/superseded.test.ts against the reference's output and by tests/cross-impl.test.ts against
 * the reference itself.
 */

import type { Draft } from "./helpers.js";

/** The id `writeRecord` gives the line of this seq. */
export const lineId = (seq: number): string =>
  `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;

const OLA = "019cadd3-6bc0-7dcd-9133-000000000301";

/** A transcript of the dinner; `supersedes` the line of that seq; Ola among its participants when `withOla`. */
function transcript(title: string, supersedes?: number, day = "03", withOla = false): Draft {
  return {
    at: `2026-10-${day}T17:00:00Z`,
    source: "sim-rec",
    kind: "transcript",
    payload: {
      schema: "transcript/v1",
      title,
      text: "hei",
      ...(withOla ? { participants: [{ name: "Ola", email: "ola@example.org" }] } : {}),
      ...(supersedes === undefined ? {} : { supersedes: lineId(supersedes) }),
    },
  };
}

/** The retraction of the line of that seq. */
function retraction(seq: number, at = "2026-10-05T18:00:00Z"): Draft {
  return {
    at,
    source: "manual",
    kind: "retraction",
    payload: { schema: "retraction/v1", supersedes: lineId(seq), seq, reason: "test" },
  };
}

/** Ola's address resolved to Ola, under a name; `supersedes` the resolution of that seq. */
function resolution(label: string, supersedes?: number): Draft {
  return {
    at: "2026-10-01T08:00:00Z",
    source: "manual",
    kind: "resolution",
    payload: {
      schema: "resolution/v1",
      ref: { kind: "email", value: "ola@example.org" },
      entity: { type: "person", id: OLA, registry: "logbook" },
      label,
      method: "manual",
      ...(supersedes === undefined ? {} : { supersedes: lineId(supersedes) }),
    },
  };
}

/** A flight of 7 April 2026, declared or tracked; `supersedes` the line of that seq. */
function flight(
  evidence: string,
  departs: string,
  arrives: string,
  supersedes?: number,
  number = "123",
): Draft {
  return {
    at: `2026-04-07T${departs}:00Z`,
    end: `2026-04-07T${arrives}:00Z`,
    source: evidence === "declared" ? "manual" : "flighty",
    kind: "flight",
    tier: 1,
    payload: {
      schema: "flight/v1",
      actual_departure: `2026-04-07T${departs}:00Z`,
      actual_arrival: `2026-04-07T${arrives}:00Z`,
      carrier: "XY",
      number,
      date: "2026-04-07",
      evidence,
      from: { iata: "OSL" },
      to: { iata: "BGO" },
      raw_id: `2026-04-07:XY:${number}@${evidence}${supersedes ?? ""}`,
      role: "passenger",
      ...(supersedes === undefined ? {} : { supersedes: lineId(supersedes) }),
    },
  };
}

function note(supersedes?: number): Draft {
  return {
    at: "2026-04-07T15:00:00Z",
    source: "manual",
    kind: "note",
    payload: {
      schema: "note/v1",
      text: "middag",
      ...(supersedes === undefined ? {} : { supersedes: lineId(supersedes) }),
    },
  };
}

/** The Day's rows of a transcript or a flight, trimmed. */
export const dayRows = (text: string): string[] =>
  text
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r.includes("  transcript ") || r.includes("flight XY"));

/** One case: a record, and what the reference's `show` and Day print of its day. */
export interface SupersededCase {
  name: string;
  lines: Draft[];
  day: string;
  /** `show <day>` of the reference (under the rfc0038 flag here, which marks a transcript). */
  show: string;
  /** The rows the Day lists: its unplaced items, or its timeline's flights. */
  rows: string[];
}

const showOf = (day: string, rows: string[]): string =>
  `${day}  unsigned\n${rows.map((r) => `  ${r}\n`).join("")}`;

const dinner = (rows: string[]): string => showOf("2026-10-03", rows);
const sup = (n: number): string => `19:00  transcript sim-rec        superseded by #${n}`;
const row = (t: string): string => `19:00  transcript sim-rec        ${t}`;
const gone = (n: number): string => `19:00  retracted #${n}: test`;
const unplaced = (t: string): string => `unplaced      19:00  transcript ${t}`;

/** The six rows of the reference's table, each a transcript of the same dinner. */
export const TRANSCRIPT_CASES: SupersededCase[] = [
  {
    name: "B and C supersede A",
    lines: [transcript("A"), transcript("B", 1), transcript("C", 1)],
    day: "2026-10-03",
    show: dinner([sup(3), row("B"), row("C")]),
    rows: [unplaced("B"), unplaced("C")],
  },
  {
    name: "B and C supersede A; C retracted",
    lines: [
      transcript("A"),
      transcript("B", 1),
      transcript("C", 1),
      retraction(3, "2026-10-03T17:00:00Z"),
    ],
    day: "2026-10-03",
    show: dinner([sup(2), row("B"), gone(3)]),
    rows: [unplaced("B")],
  },
  {
    name: "B and C supersede A; B and C retracted",
    lines: [
      transcript("A"),
      transcript("B", 1),
      transcript("C", 1),
      retraction(2, "2026-10-03T17:00:00Z"),
      retraction(3, "2026-10-03T17:00:00Z"),
    ],
    day: "2026-10-03",
    show: dinner([row("A"), gone(2), gone(3)]),
    rows: [unplaced("A")],
  },
  {
    name: "A←B←C",
    lines: [transcript("A"), transcript("B", 1), transcript("C", 2)],
    day: "2026-10-03",
    show: dinner([sup(2), sup(3), row("C")]),
    rows: [unplaced("C")],
  },
  {
    name: "A←B←C; C retracted",
    lines: [
      transcript("A"),
      transcript("B", 1),
      transcript("C", 2),
      retraction(3, "2026-10-03T17:00:00Z"),
    ],
    day: "2026-10-03",
    show: dinner([sup(2), row("B"), gone(3)]),
    rows: [unplaced("B")],
  },
  {
    name: "A←B←C; B retracted",
    lines: [
      transcript("A"),
      transcript("B", 1),
      transcript("C", 2),
      retraction(2, "2026-10-03T17:00:00Z"),
    ],
    day: "2026-10-03",
    show: dinner([row("A"), gone(2), row("C")]),
    rows: [unplaced("A"), unplaced("C")],
  },
  {
    name: "A←B←C; B and C retracted",
    lines: [
      transcript("A"),
      transcript("B", 1),
      transcript("C", 2),
      retraction(2, "2026-10-03T17:00:00Z"),
      retraction(3, "2026-10-03T17:00:00Z"),
    ],
    day: "2026-10-03",
    show: dinner([row("A"), gone(2), gone(3)]),
    rows: [unplaced("A")],
  },
];

const declared = "08:10  flight     manual         XY 123 OSL → BGO, arrives 09:05, declared";
const flightRow = (from: string, to: string, evidence: string): string =>
  `${from}–${to}  flight XY 123  OSL → BGO · ${evidence}`;

/** The same rule for a flight: a tracked line supersedes a declared one, and a retracted one nothing. */
export const FLIGHT_CASES: SupersededCase[] = [
  {
    name: "a tracked flight supersedes the declared one; the tracked one retracted",
    lines: [
      flight("declared", "06:10", "07:05"),
      flight("tracked", "06:12", "07:03", 1),
      retraction(2, "2026-04-07T06:12:00Z"),
    ],
    day: "2026-04-07",
    show: showOf("2026-04-07", [declared, "08:12  retracted #2: test"]),
    rows: [flightRow("08:10", "09:05", "declared")],
  },
  {
    name: "two tracked flights supersede the declared one; the later one retracted",
    lines: [
      flight("declared", "06:10", "07:05"),
      flight("tracked", "06:12", "07:03", 1),
      flight("tracked", "06:13", "07:04", 1),
      retraction(3, "2026-04-07T06:13:00Z"),
    ],
    day: "2026-04-07",
    show: showOf("2026-04-07", [
      "08:10  flight     manual         superseded by #2",
      "08:12  flight     flighty        XY 123 OSL → BGO, arrives 09:03, tracked",
      "08:13  retracted #3: test",
    ]),
    rows: [flightRow("08:12", "09:03", "tracked")],
  },
  {
    // The declared flight is another number, earlier: the reference's Day keeps one flight per
    // carrier, number and date whatever supersedes what (SPEC-QUESTIONS 110), and this case is
    // about the superseding alone.
    name: "declared ← tracked ← tracked; the middle one retracted",
    lines: [
      flight("declared", "04:00", "04:50", undefined, "124"),
      flight("tracked", "06:12", "07:03", 1),
      flight("tracked", "06:13", "07:04", 2),
      retraction(2, "2026-04-07T06:12:00Z"),
    ],
    day: "2026-04-07",
    show: showOf("2026-04-07", [
      "06:00  flight     manual         XY 124 OSL → BGO, arrives 06:50, declared",
      "08:12  retracted #2: test",
      "08:13  flight     flighty        XY 123 OSL → BGO, arrives 09:04, tracked",
    ]),
    rows: [
      "06:00–06:50  flight XY 124  OSL → BGO · declared",
      flightRow("08:13", "09:04", "tracked"),
    ],
  },
  {
    name: "a flight that names a note marks it, whatever its kind; retracted, it marks nothing",
    lines: [note(), flight("declared", "06:10", "07:05", 1), retraction(2, "2026-04-07T06:10:00Z")],
    day: "2026-04-07",
    show: showOf("2026-04-07", [
      "08:10  retracted #2: test",
      "17:00  note       manual         middag",
    ]),
    rows: [],
  },
];

/** A calendar entry of the dinner with Ola among its attendees. */
function calendar(title: string): Draft {
  return {
    at: "2026-10-03T16:00:00Z",
    end: "2026-10-03T18:00:00Z",
    source: "sim-cal",
    kind: "event",
    payload: {
      schema: "event/v1",
      title,
      raw_id: title,
      // The shape the reference's demo writes: `people` takes an attendee by its ref.
      attendees: [
        { name: "Ola", ref: { kind: "email", value: "ola@example.org" }, response: "accepted" },
      ],
    },
  };
}

/** One case of `people`: a record, and the reference's `people` of it. */
export interface PeopleCase {
  name: string;
  lines: Draft[];
  people: string;
}

const ola = (name: string, transcripts: number, until = "2026-10-05"): string =>
  `1 person · 2026-10-01 – ${until} · tier 2\n  ${name}  transcripts ${transcripts}\n`;

/** A person's transcripts and name, under the same rule. */
export const PEOPLE_CASES: PeopleCase[] = [
  {
    name: "a transcript whose two superseders are both retracted counts again",
    lines: [
      resolution("Ola Nordmann"),
      transcript("A", undefined, "03", true),
      transcript("B", 2, "04", true),
      transcript("C", 2, "05", true),
      retraction(3),
      retraction(4),
    ],
    people: ola("Ola Nordmann", 1),
  },
  {
    name: "A←B←C, B retracted: A and C both count",
    lines: [
      resolution("Ola Nordmann"),
      transcript("A", undefined, "03", true),
      transcript("B", 2, "04", true),
      transcript("C", 3, "05", true),
      retraction(3),
    ],
    people: ola("Ola Nordmann", 2),
  },
  {
    name: "A←B←C, C retracted: B counts, A does not",
    lines: [
      resolution("Ola Nordmann"),
      transcript("A", undefined, "03", true),
      transcript("B", 2, "04", true),
      transcript("C", 3, "05", true),
      retraction(4),
    ],
    people: ola("Ola Nordmann", 1),
  },
  {
    name: "a note that names a transcript does not supersede it: a line of another kind",
    lines: [
      resolution("Ola Nordmann"),
      transcript("A", undefined, "03", true),
      {
        at: "2026-10-04T17:00:00Z",
        source: "manual",
        kind: "note",
        payload: { schema: "note/v1", text: "x", supersedes: lineId(2) },
      },
    ],
    people: ola("Ola Nordmann", 1, "2026-10-04"),
  },
  {
    name: "a calendar entry whose one superseder is retracted counts again for its attendee",
    lines: [
      resolution("Ola Nordmann"),
      calendar("Middag"),
      {
        ...calendar("Middag, flyttet"),
        payload: { ...calendar("x").payload, title: "Middag, flyttet", supersedes: lineId(2) },
      },
      retraction(3),
    ],
    people: `1 person · 2026-10-01 – 2026-10-05 · tier 2\n  Ola Nordmann  calendar 1\n`,
  },
  {
    name: "a name whose two correcting resolutions are both retracted stands again",
    lines: [
      resolution("Ola Nordmann"),
      resolution("Ola N", 1),
      resolution("O. Nordmann", 1),
      retraction(2),
      retraction(3),
      transcript("A", undefined, "03", true),
    ],
    people: ola("Ola Nordmann", 1),
  },
  {
    name: "a name corrected twice, the later correction retracted: the earlier correction stands",
    lines: [
      resolution("Ola Nordmann"),
      resolution("Ola N", 1),
      resolution("O. Nordmann", 1),
      retraction(3),
      transcript("A", undefined, "03", true),
    ],
    people: ola("Ola N", 1),
  },
  {
    name: "a name corrected in a chain, the middle one retracted: the last stands",
    lines: [
      resolution("Ola Nordmann"),
      resolution("Ola N", 1),
      resolution("O. Nordmann", 2),
      retraction(2),
      transcript("A", undefined, "03", true),
    ],
    people: ola("O. Nordmann", 1),
  },
];
