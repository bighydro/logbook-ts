/**
 * The Day's reflection (the reference's docs/day.md, *reflection*, since its 0.7.0's `day reflect`):
 * the day's latest reflection, a `note/v1` line labelled `reflection`, in a section of its own below
 * the header and above the timeline, and under `reflection` in `day --json`. Synthetic records of
 * Ines Nordmann's Saturday, 13 June 2026, in Oslo, each with the reference's output at d053f78
 * (`expected`: the section's rows and the JSON key, captured by running it on each record, never
 * edited by hand). tests/reflection.test.ts and tests/cross-impl.test.ts read them.
 */

import type { Draft } from "./helpers.js";

export const DAY = "2026-06-13";

/** The id `writeRecord` gives the line of this seq. */
export const lineId = (seq: number): string =>
  `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;

const location = (at: string): Draft => ({
  at,
  source: "sim-phone",
  kind: "location",
  tier: 1,
  payload: { schema: "location/v1", lat: 59.911, lon: 10.75, accuracy_m: 12 },
});

/** The two location lines every record begins with, seq 1 and 2. */
const TRACK = [location("2026-06-13T05:30:00Z"), location("2026-06-13T20:30:00Z")];

function note(
  at: string,
  text: unknown,
  labels: unknown = ["reflection"],
  more: Partial<Draft> & { payload?: Record<string, unknown> } = {},
): Draft {
  return {
    at,
    source: more.source ?? "manual",
    kind: more.kind ?? "note",
    ...(more.tier === undefined ? {} : { tier: more.tier }),
    payload: {
      schema: "note/v1",
      ...(text === undefined ? {} : { text }),
      ...(labels === undefined ? {} : { labels }),
      ...(more.payload ?? {}),
    },
  } as Draft;
}

const retract = (seq: number): Draft => ({
  at: "2026-06-13T19:30:00Z",
  source: "manual",
  kind: "retraction",
  payload: { schema: "retraction/v1", seq, supersedes: lineId(seq), reason: "typo" },
});

export interface ReflectionCase {
  name: string;
  lines: Draft[];
  /** The reference's output: the section's rows, the blank after it included, and the JSON key; null when the day has none. */
  expected: { rows: string[]; json: Record<string, unknown> | null };
}

const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");

/** The records, without their expected output (`CAPTURED` holds it, by name). */
export const RECORDS: Array<{ name: string; lines: Draft[] }> = [
  { name: "none", lines: [...TRACK, note("2026-06-13T19:00:00Z", "A plain note.", [])] },
  { name: "one", lines: [...TRACK, note("2026-06-13T20:00:00Z", "Quiet day.")] },
  { name: "wrapped at 76 columns", lines: [...TRACK, note("2026-06-13T19:00:00Z", words)] },
  {
    name: "paragraphs, a blank between, a paragraph's indent kept",
    lines: [
      ...TRACK,
      note("2026-06-13T19:00:00Z", "One.\n\nTwo after a blank line.\n   indented three"),
    ],
  },
  {
    name: "tabs to the next eighth column, runs of spaces kept, the trailing ones dropped",
    lines: [
      ...TRACK,
      note("2026-06-13T19:00:00Z", "tab\there and  double  spaces   kept?\ntrailing spaces   \n"),
    ],
  },
  {
    name: "a word longer than the line stays whole; no break at a hyphen",
    lines: [
      ...TRACK,
      note("2026-06-13T19:00:00Z", `${"x".repeat(80)} y\n${"x".repeat(68)} well-known-thing here`),
    ],
  },
  {
    name: "76 columns fit, 77 do not; spaces at the break go",
    lines: [
      ...TRACK,
      note(
        "2026-06-13T19:00:00Z",
        `${"a".repeat(38)} ${"b".repeat(37)}\n${"a".repeat(38)} ${"b".repeat(38)}\n${"a".repeat(70)}      bbb`,
      ),
    ],
  },
  {
    name: "Python's line breaks, a no-break space inside a word, letters counted as one",
    lines: [
      ...TRACK,
      note(
        "2026-06-13T19:00:00Z",
        `one\r\ntwo\rthree\u000bfour\ffive\u2028six\n${"a".repeat(70)}\u00a0bbbbbbbbbb ccc\n${"ø".repeat(80)} æ`,
      ),
    ],
  },
  {
    name: "the latest by its time, not by its seq; a tie goes to the later seq",
    lines: [
      ...TRACK,
      note("2026-06-13T21:00:00Z", "Later at, written first."),
      note("2026-06-13T19:00:00Z", "Earlier at, written second."),
      note("2026-06-13T21:00:00Z", "The same time, written third."),
    ],
  },
  {
    name: "a reflection another names in supersedes still stands, by its time",
    lines: [
      ...TRACK,
      note("2026-06-13T20:00:00Z", "Orig later at."),
      note("2026-06-13T19:00:00Z", "Corr earlier at, supersedes.", ["reflection"], {
        payload: { supersedes: lineId(3) },
      }),
    ],
  },
  {
    name: "a retracted reflection is no reflection",
    lines: [
      ...TRACK,
      note("2026-06-13T18:00:00Z", "Stays."),
      note("2026-06-13T19:00:00Z", "Gone."),
      retract(4),
    ],
  },
  {
    name: "only the label reflection, in a list, of a note/v1 line",
    lines: [
      ...TRACK,
      note("2026-06-13T18:00:00Z", "The one."),
      note("2026-06-13T19:00:00Z", "A string label.", "reflection"),
      note("2026-06-13T19:10:00Z", "Capitalised.", ["Reflection"]),
      note("2026-06-13T19:20:00Z", "Another schema.", ["reflection"], {
        payload: { schema: "note/v2" },
      }),
      note("2026-06-13T19:30:00Z", "Another kind.", ["reflection"], { kind: "message" }),
    ],
  },
  {
    name: "from the door, at tier 3, among other labels",
    lines: [
      ...TRACK,
      note("2026-06-13T19:00:00Z", "From the door.", ["proposal", "reflection"], {
        source: "mcp",
        tier: 3,
      }),
    ],
  },
  {
    name: "a text that is not a string, and one that is not there",
    lines: [...TRACK, note("2026-06-13T19:00:00Z", 42), note("2026-06-13T19:01:00Z", ["a", 1])],
  },
  { name: "no text", lines: [...TRACK, note("2026-06-13T19:01:00Z", undefined)] },
  { name: "only spaces", lines: [...TRACK, note("2026-06-13T19:01:00Z", "   ")] },
  {
    name: "a reflection of the next day is not this day's",
    lines: [...TRACK, note("2026-06-13T22:30:00Z", "00:30 on the 14th.")],
  },
];

/** The reflection section of a Day's text: its row to the blank line before the next section. */
export function reflectionRows(text: string): string[] {
  const rows = text.split("\n");
  const i = rows.findIndex((row) => row.startsWith("  reflection "));
  if (i === -1) return [];
  let j = i + 1;
  while (!(rows[j] === "" && /^ {2}\S/.test(rows[j + 1] ?? ""))) j += 1;
  return rows.slice(i, j + 1);
}

/** The reference's output on each record at d053f78, by name (run; never edited by hand). */
const CAPTURED: Record<string, ReflectionCase["expected"]> = {
  none: {
    rows: [],
    json: null,
  },
  one: {
    rows: ["  reflection    22:00 · manual", "                Quiet day.", ""],
    json: {
      line: "00000000-0000-4000-8000-000000000003",
      seq: 3,
      at: "2026-06-13T20:00:00Z",
      at_local: "2026-06-13T22:00:00+02:00",
      source: "manual",
      text: "Quiet day.",
    },
  },
  "wrapped at 76 columns": {
    rows: [
      "  reflection    21:00 · manual",
      "                word0 word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11",
      "                word12 word13 word14 word15 word16 word17 word18 word19 word20 word21 word22",
      "                word23 word24 word25 word26 word27 word28 word29 word30 word31 word32 word33",
      "                word34 word35 word36 word37 word38 word39",
      "",
    ],
    json: {
      line: "00000000-0000-4000-8000-000000000003",
      seq: 3,
      at: "2026-06-13T19:00:00Z",
      at_local: "2026-06-13T21:00:00+02:00",
      source: "manual",
      text: "word0 word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12 word13 word14 word15 word16 word17 word18 word19 word20 word21 word22 word23 word24 word25 word26 word27 word28 word29 word30 word31 word32 word33 word34 word35 word36 word37 word38 word39",
    },
  },
  "paragraphs, a blank between, a paragraph's indent kept": {
    rows: [
      "  reflection    21:00 · manual",
      "                One.",
      "",
      "                Two after a blank line.",
      "                   indented three",
      "",
    ],
    json: {
      line: "00000000-0000-4000-8000-000000000003",
      seq: 3,
      at: "2026-06-13T19:00:00Z",
      at_local: "2026-06-13T21:00:00+02:00",
      source: "manual",
      text: "One.\n\nTwo after a blank line.\n   indented three",
    },
  },
  "tabs to the next eighth column, runs of spaces kept, the trailing ones dropped": {
    rows: [
      "  reflection    21:00 · manual",
      "                tab     here and  double  spaces   kept?",
      "                trailing spaces",
      "",
    ],
    json: {
      line: "00000000-0000-4000-8000-000000000003",
      seq: 3,
      at: "2026-06-13T19:00:00Z",
      at_local: "2026-06-13T21:00:00+02:00",
      source: "manual",
      text: "tab\there and  double  spaces   kept?\ntrailing spaces   \n",
    },
  },
  "a word longer than the line stays whole; no break at a hyphen": {
    rows: [
      "  reflection    21:00 · manual",
      "                xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "                y",
      "                xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "                well-known-thing here",
      "",
    ],
    json: {
      line: "00000000-0000-4000-8000-000000000003",
      seq: 3,
      at: "2026-06-13T19:00:00Z",
      at_local: "2026-06-13T21:00:00+02:00",
      source: "manual",
      text: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx y\nxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx well-known-thing here",
    },
  },
  "76 columns fit, 77 do not; spaces at the break go": {
    rows: [
      "  reflection    21:00 · manual",
      "                aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "                aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "                bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "                aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "                bbb",
      "",
    ],
    json: {
      line: "00000000-0000-4000-8000-000000000003",
      seq: 3,
      at: "2026-06-13T19:00:00Z",
      at_local: "2026-06-13T21:00:00+02:00",
      source: "manual",
      text: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa      bbb",
    },
  },
  "Python's line breaks, a no-break space inside a word, letters counted as one": {
    rows: [
      "  reflection    21:00 · manual",
      "                one",
      "                two",
      "                three",
      "                four",
      "                five",
      "                six",
      "                aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\u00a0bbbbbbbbbb",
      "                ccc",
      "                øøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøø",
      "                æ",
      "",
    ],
    json: {
      line: "00000000-0000-4000-8000-000000000003",
      seq: 3,
      at: "2026-06-13T19:00:00Z",
      at_local: "2026-06-13T21:00:00+02:00",
      source: "manual",
      text: "one\r\ntwo\rthree\u000bfour\ffive\u2028six\naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\u00a0bbbbbbbbbb ccc\nøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøøø æ",
    },
  },
  "the latest by its time, not by its seq; a tie goes to the later seq": {
    rows: ["  reflection    23:00 · manual", "                The same time, written third.", ""],
    json: {
      line: "00000000-0000-4000-8000-000000000005",
      seq: 5,
      at: "2026-06-13T21:00:00Z",
      at_local: "2026-06-13T23:00:00+02:00",
      source: "manual",
      text: "The same time, written third.",
    },
  },
  "a reflection another names in supersedes still stands, by its time": {
    rows: ["  reflection    22:00 · manual", "                Orig later at.", ""],
    json: {
      line: "00000000-0000-4000-8000-000000000003",
      seq: 3,
      at: "2026-06-13T20:00:00Z",
      at_local: "2026-06-13T22:00:00+02:00",
      source: "manual",
      text: "Orig later at.",
    },
  },
  "a retracted reflection is no reflection": {
    rows: ["  reflection    20:00 · manual", "                Stays.", ""],
    json: {
      line: "00000000-0000-4000-8000-000000000003",
      seq: 3,
      at: "2026-06-13T18:00:00Z",
      at_local: "2026-06-13T20:00:00+02:00",
      source: "manual",
      text: "Stays.",
    },
  },
  "only the label reflection, in a list, of a note/v1 line": {
    rows: ["  reflection    20:00 · manual", "                The one.", ""],
    json: {
      line: "00000000-0000-4000-8000-000000000003",
      seq: 3,
      at: "2026-06-13T18:00:00Z",
      at_local: "2026-06-13T20:00:00+02:00",
      source: "manual",
      text: "The one.",
    },
  },
  "from the door, at tier 3, among other labels": {
    rows: ["  reflection    21:00 · mcp", "                From the door.", ""],
    json: {
      line: "00000000-0000-4000-8000-000000000003",
      seq: 3,
      at: "2026-06-13T19:00:00Z",
      at_local: "2026-06-13T21:00:00+02:00",
      source: "mcp",
      text: "From the door.",
    },
  },
  "a text that is not a string, and one that is not there": {
    rows: ["  reflection    21:01 · manual", "                ['a', 1]", ""],
    json: {
      line: "00000000-0000-4000-8000-000000000004",
      seq: 4,
      at: "2026-06-13T19:01:00Z",
      at_local: "2026-06-13T21:01:00+02:00",
      source: "manual",
      text: "['a', 1]",
    },
  },
  "no text": {
    rows: ["  reflection    21:01 · manual", ""],
    json: {
      line: "00000000-0000-4000-8000-000000000003",
      seq: 3,
      at: "2026-06-13T19:01:00Z",
      at_local: "2026-06-13T21:01:00+02:00",
      source: "manual",
      text: "",
    },
  },
  "only spaces": {
    rows: ["  reflection    21:01 · manual", "", ""],
    json: {
      line: "00000000-0000-4000-8000-000000000003",
      seq: 3,
      at: "2026-06-13T19:01:00Z",
      at_local: "2026-06-13T21:01:00+02:00",
      source: "manual",
      text: "   ",
    },
  },
  "a reflection of the next day is not this day's": {
    rows: [],
    json: null,
  },
};

/** Every record with the reference's output on it. */
export const REFLECTION_CASES: ReflectionCase[] = RECORDS.map((r) => ({
  ...r,
  expected: CAPTURED[r.name] as ReflectionCase["expected"],
}));
