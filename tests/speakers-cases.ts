/**
 * Who spoke (RFC 0038 §3, RFC 0006's amendment of 2026-10-15): a transcript's voices bound to people
 * by `resolution/v1` lines whose ref is a `speaker`, `<transcript line id>#<label>`. Synthetic records
 * of Ines Nordmann's dinner on 3 October 2026, read by tests/speakers-bound.test.ts against the
 * reference's output at b82a11c (0.7.0), captured by running it on each record (`expected`, never
 * edited by hand), and by tests/cross-impl.test.ts against the reference itself.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Draft, writeBareRecord } from "./helpers.js";

/** The id `writeBareRecord` gives the line of this seq. */
export const lineId = (seq: number): string =>
  `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;

/** `owner_id` of the records `writeBareRecord` writes. */
export const OWNER = "00000000-0000-4000-8000-000000000002";
const OLA = "019cadd3-6bc0-7dcd-9133-000000000301";
const KARI = "019cadd3-6bc0-7dcd-9133-000000000302";
const MINTED = "019cadd3-6bc0-7dcd-9133-000000000303";
const MINTED_2 = "019cadd3-6bc0-7dcd-9133-000000000304";

type Voice = Record<string, unknown> & { label: string };
const voice = (label: string, seconds?: number, more: Record<string, unknown> = {}): Voice => ({
  label,
  ...(seconds === undefined ? {} : { seconds }),
  ...more,
});

function transcript(
  title: string,
  speakers: Voice[],
  more: { at?: string; supersedes?: number; participants?: unknown[] } = {},
): Draft {
  return {
    at: more.at ?? "2026-10-03T17:00:00Z",
    source: "transcription",
    kind: "transcript",
    payload: {
      schema: "transcript/v1",
      title,
      text: "hei",
      speakers,
      diarization: { channels: 1, engine: "pyannote" },
      ...(more.participants === undefined ? {} : { participants: more.participants }),
      ...(more.supersedes === undefined ? {} : { supersedes: lineId(more.supersedes) }),
    },
  };
}

/** The owner's attribution of one voice of the transcript of that seq. */
function speaker(
  seq: number,
  label: string,
  entity: string | undefined,
  more: Record<string, unknown> = {},
): Draft {
  return {
    at: "2026-10-04T08:00:00Z",
    source: "manual",
    kind: "resolution",
    payload: {
      schema: "resolution/v1",
      ref: { kind: "speaker", value: `${lineId(seq)}#${label}` },
      basis: "voice",
      method: "owner",
      ...(entity === undefined
        ? {}
        : { entity: { type: "person", id: entity, registry: "logbook" } }),
      ...more,
    },
  };
}

function email(address: string, entity: string, label: string): Draft {
  return {
    at: "2026-10-01T08:00:00Z",
    source: "manual",
    kind: "resolution",
    payload: {
      schema: "resolution/v1",
      ref: { kind: "email", value: address },
      entity: { type: "person", id: entity, registry: "logbook" },
      label,
      method: "manual",
    },
  };
}

function retraction(seq: number): Draft {
  return {
    at: "2026-10-05T08:00:00Z",
    source: "manual",
    kind: "retraction",
    payload: { schema: "retraction/v1", supersedes: lineId(seq), seq, reason: "test" },
  };
}

/** The owner's phone at home, every twenty minutes from 16:00 to 22:40, Oslo time: one stay. */
const home: Draft[] = [];
for (let h = 14; h <= 20; h++) {
  for (const m of [0, 20, 40]) {
    home.push({
      at: `2026-10-03T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`,
      source: "sim-phone",
      kind: "location",
      tier: 1,
      payload: { schema: "location/v1", lat: 59.9139, lon: 10.7522, accuracy_m: 10 },
    });
  }
}
const T = home.length + 1;

export const PLACES = {
  Home: { lat: 59.9139, lon: 10.7522, radius_m: 120, kind: "home", country: "NO" },
};

const text = (seq: number, label: string, entity: string): Draft => ({
  at: "2026-10-04T08:00:00Z",
  source: "manual",
  kind: "resolution",
  payload: {
    schema: "resolution/v1",
    ref: { kind: "speaker", value: `${lineId(seq)}#${label}` },
    basis: "text",
    confidence: 0.4,
    method: "owner",
    entity: { type: "person", id: entity, registry: "logbook" },
    label: "Ola Nordmann",
    spans: { content: "ab".repeat(32), ranges: [[0, 10]] },
  },
});

/** What the reference prints for one record: the Day's transcript and `with` rows, and `people`. */
export interface SpeakerExpected {
  /** The Day's rows that name a transcript or the company, trimmed. */
  rows: string[];
  /** `speakers` of each transcript of the Day, by line id. */
  speakers: Record<string, unknown[]>;
  /** `with` of each row of the Day's timeline that has one. */
  with: unknown[];
  people: string;
  /** `unnamed` and `not_yet_named` of `people --json`, and each person's `spoke_s`, by name. */
  counts: { unnamed?: number; not_yet_named?: number; spoke_s: Record<string, number | null> };
}

export interface SpeakerCase {
  name: string;
  lines: Draft[];
  /** Write `places.json` beside the record. */
  places?: boolean;
  expected: SpeakerExpected;
}

export const SPEAKER_CASES: SpeakerCase[] = [
  {
    name: "a voice bound to a person, one unnamed, one on the owner's microphone bound to someone else, one bound to the owner",
    lines: [
      email("ola@example.org", OLA, "Ola Nordmann"),
      transcript("Middag", [
        voice("S1", 600, { from_me: true }),
        voice("S2", 300),
        voice("S3", 120),
        voice("S4", 60, { name: "Gjest" }),
        voice("S5", 30),
      ]),
      speaker(2, "S2", OLA, { label: "Ola Nordmann", consent: "unknown" }),
      speaker(2, "S3", MINTED, { unnamed: true, consent: "yes" }),
      speaker(2, "S1", KARI, { label: "Kari Nordmann", basis: "channel" }),
      speaker(2, "S5", OWNER),
    ],
    expected: {
      rows: [
        "unplaced      19:00  transcript Middag · Kari Nordmann 10 min · Ola Nordmann 5 min · Gjest 1 min · you 30 s · 1 unnamed · recorded with consent: unknown",
      ],
      speakers: {
        "00000000-0000-4000-8000-000000000002": [
          {
            label: "S1",
            person: "019cadd3-6bc0-7dcd-9133-000000000302",
            name: "Kari Nordmann",
            seconds: 600,
            basis: "channel",
            consent: "unknown",
            owner: false,
          },
          {
            label: "S2",
            person: "019cadd3-6bc0-7dcd-9133-000000000301",
            name: "Ola Nordmann",
            seconds: 300,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
          {
            label: "S3",
            person: null,
            name: null,
            seconds: 120,
            basis: "voice",
            consent: "yes",
            owner: false,
          },
          {
            label: "S4",
            person: null,
            name: "Gjest",
            seconds: 60,
            basis: null,
            consent: null,
            owner: false,
          },
          {
            label: "S5",
            person: "00000000-0000-4000-8000-000000000002",
            name: null,
            seconds: 30,
            basis: "voice",
            consent: null,
            owner: true,
          },
        ],
      },
      with: [],
      people:
        "2 people · 2026-10-01 – 2026-10-04 · tier 2 · 1 voice not yet named · review speakers · and 1 unnamed\n  Kari Nordmann  transcripts 1\n  Ola Nordmann   transcripts 1\n",
      counts: {
        spoke_s: { "Kari Nordmann": 600, "Ola Nordmann": 300 },
        unnamed: 1,
        not_yet_named: 1,
      },
    },
  },
  {
    name: "consent: a no among the voices wins over unknown; the owner's own says nothing",
    lines: [
      transcript("Middag", [voice("S1", 60), voice("S2", 30), voice("S3", 20)]),
      speaker(1, "S1", OLA, { label: "Ola Nordmann" }),
      speaker(1, "S2", KARI, { label: "Kari Nordmann", consent: "no" }),
      speaker(1, "S3", MINTED, { consent: "yes", unnamed: true }),
    ],
    expected: {
      rows: [
        "unplaced      19:00  transcript Middag · Ola Nordmann 1 min · Kari Nordmann 30 s · 1 unnamed · recorded with consent: no",
      ],
      speakers: {
        "00000000-0000-4000-8000-000000000001": [
          {
            label: "S1",
            person: "019cadd3-6bc0-7dcd-9133-000000000301",
            name: "Ola Nordmann",
            seconds: 60,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
          {
            label: "S2",
            person: "019cadd3-6bc0-7dcd-9133-000000000302",
            name: "Kari Nordmann",
            seconds: 30,
            basis: "voice",
            consent: "no",
            owner: false,
          },
          {
            label: "S3",
            person: null,
            name: null,
            seconds: 20,
            basis: "voice",
            consent: "yes",
            owner: false,
          },
        ],
      },
      with: [],
      people:
        "2 people · 2026-10-03 – 2026-10-04 · tier 2 · and 1 unnamed\n  Kari Nordmann  transcripts 1\n  Ola Nordmann   transcripts 1\n",
      counts: {
        spoke_s: { "Kari Nordmann": 30, "Ola Nordmann": 60 },
        unnamed: 1,
        not_yet_named: 0,
      },
    },
  },
  {
    name: "consent: every voice yes says nothing; the owner's no says nothing",
    lines: [
      transcript("Middag", [voice("S1", 600, { from_me: true }), voice("S2", 300)]),
      speaker(1, "S2", KARI, { label: "Kari Nordmann", consent: "yes" }),
      speaker(1, "S1", OWNER, { consent: "no" }),
    ],
    expected: {
      rows: ["unplaced      19:00  transcript Middag · you 10 min · Kari Nordmann 5 min"],
      speakers: {
        "00000000-0000-4000-8000-000000000001": [
          {
            label: "S1",
            person: "00000000-0000-4000-8000-000000000002",
            name: null,
            seconds: 600,
            basis: "voice",
            consent: "no",
            owner: true,
          },
          {
            label: "S2",
            person: "019cadd3-6bc0-7dcd-9133-000000000302",
            name: "Kari Nordmann",
            seconds: 300,
            basis: "voice",
            consent: "yes",
            owner: false,
          },
        ],
      },
      with: [],
      people: "1 person · 2026-10-03 – 2026-10-04 · tier 2\n  Kari Nordmann  transcripts 1\n",
      counts: { spoke_s: { "Kari Nordmann": 300 } },
    },
  },
  {
    name: "a correction supersedes the first answer; a retracted answer binds nothing",
    lines: [
      transcript("Middag", [
        voice("S1", 600, { from_me: true }),
        voice("S2", 300),
        voice("S3", 100),
      ]),
      speaker(1, "S2", OLA, { label: "Ola Nordmann" }),
      speaker(1, "S2", KARI, { label: "Kari Nordmann", supersedes: lineId(2) }),
      speaker(1, "S3", OLA, { label: "Ola Nordmann" }),
      retraction(4),
    ],
    expected: {
      rows: [
        "unplaced      19:00  transcript Middag · you 10 min · Kari Nordmann 5 min · S3 2 min · recorded with consent: unknown",
      ],
      speakers: {
        "00000000-0000-4000-8000-000000000001": [
          {
            label: "S1",
            person: "00000000-0000-4000-8000-000000000002",
            name: null,
            seconds: 600,
            basis: "channel",
            consent: null,
            owner: true,
          },
          {
            label: "S2",
            person: "019cadd3-6bc0-7dcd-9133-000000000302",
            name: "Kari Nordmann",
            seconds: 300,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
          {
            label: "S3",
            person: null,
            name: null,
            seconds: 100,
            basis: null,
            consent: null,
            owner: false,
          },
        ],
      },
      with: [],
      people:
        "1 person · 2026-10-03 – 2026-10-05 · tier 2 · 1 voice not yet named · review speakers\n  Kari Nordmann  transcripts 1\n",
      counts: { spoke_s: { "Kari Nordmann": 300 }, unnamed: 0, not_yet_named: 1 },
    },
  },
  {
    name: "a voice said to be another voice resolves to whoever that one is",
    lines: [
      transcript("Middag", [voice("S1", 600, { from_me: true }), voice("S2", 300)]),
      transcript("Lunsj", [voice("S1", 50), voice("S2", 40)], { at: "2026-10-03T11:00:00Z" }),
      speaker(1, "S2", OLA, { label: "Ola Nordmann" }),
      speaker(2, "S1", undefined, { alias_of: { kind: "speaker", value: `${lineId(1)}#S2` } }),
    ],
    expected: {
      rows: [
        "unplaced      13:00  transcript Lunsj · Ola Nordmann 50 s · S2 40 s · recorded with consent: unknown",
        "unplaced      19:00  transcript Middag · you 10 min · Ola Nordmann 5 min · recorded with consent: unknown",
      ],
      speakers: {
        "00000000-0000-4000-8000-000000000002": [
          {
            label: "S1",
            person: "019cadd3-6bc0-7dcd-9133-000000000301",
            name: "Ola Nordmann",
            seconds: 50,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
          {
            label: "S2",
            person: null,
            name: null,
            seconds: 40,
            basis: null,
            consent: null,
            owner: false,
          },
        ],
        "00000000-0000-4000-8000-000000000001": [
          {
            label: "S1",
            person: "00000000-0000-4000-8000-000000000002",
            name: null,
            seconds: 600,
            basis: "channel",
            consent: null,
            owner: true,
          },
          {
            label: "S2",
            person: "019cadd3-6bc0-7dcd-9133-000000000301",
            name: "Ola Nordmann",
            seconds: 300,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
        ],
      },
      with: [],
      people:
        "1 person · 2026-10-03 – 2026-10-04 · tier 2 · 1 voice not yet named · review speakers\n  Ola Nordmann  transcripts 2\n",
      counts: { spoke_s: { "Ola Nordmann": 350 }, unnamed: 0, not_yet_named: 1 },
    },
  },
  {
    name: "the voices of a transcript heard again are read by nothing",
    lines: [
      transcript("Middag", [voice("S1", 600, { from_me: true }), voice("S2", 300)]),
      transcript("Middag igjen", [voice("A", 600, { from_me: true }), voice("B", 300)], {
        supersedes: 1,
      }),
      speaker(1, "S2", OLA, { label: "Ola Nordmann" }),
    ],
    expected: {
      rows: ["unplaced      19:00  transcript Middag igjen · you 10 min · B 5 min"],
      speakers: {
        "00000000-0000-4000-8000-000000000002": [
          {
            label: "A",
            person: "00000000-0000-4000-8000-000000000002",
            name: null,
            seconds: 600,
            basis: "channel",
            consent: null,
            owner: true,
          },
          {
            label: "B",
            person: null,
            name: null,
            seconds: 300,
            basis: null,
            consent: null,
            owner: false,
          },
        ],
      },
      with: [],
      people: "0 people · 2026-10-03 – 2026-10-04 · 1 voice not yet named · review speakers\n",
      counts: { spoke_s: {}, unnamed: 0, not_yet_named: 1 },
    },
  },
  {
    name: "the voices of a retracted transcript are read by nothing",
    lines: [
      transcript("Middag", [
        voice("S1", 600, { from_me: true }),
        voice("S2", 300),
        voice("S3", 20),
      ]),
      speaker(1, "S2", OLA, { label: "Ola Nordmann" }),
      retraction(1),
    ],
    expected: {
      rows: [],
      speakers: {},
      with: [],
      people: "0 people · 2026-10-03 – 2026-10-05\n",
      counts: { spoke_s: {} },
    },
  },
  {
    name: "two unnamed people, one of them in two recordings",
    lines: [
      transcript("Middag", [voice("S1", 60), voice("S2", 30)]),
      transcript("Lunsj", [voice("S1", 50)], { at: "2026-10-03T11:00:00Z" }),
      speaker(1, "S1", MINTED, { unnamed: true }),
      speaker(2, "S1", MINTED, { unnamed: true }),
      speaker(1, "S2", MINTED_2, { unnamed: true }),
    ],
    expected: {
      rows: [
        "unplaced      13:00  transcript Lunsj · 1 unnamed · recorded with consent: unknown",
        "unplaced      19:00  transcript Middag · 2 unnamed · recorded with consent: unknown",
      ],
      speakers: {
        "00000000-0000-4000-8000-000000000002": [
          {
            label: "S1",
            person: null,
            name: null,
            seconds: 50,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
        ],
        "00000000-0000-4000-8000-000000000001": [
          {
            label: "S1",
            person: null,
            name: null,
            seconds: 60,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
          {
            label: "S2",
            person: null,
            name: null,
            seconds: 30,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
        ],
      },
      with: [],
      people: "0 people · 2026-10-03 – 2026-10-04 · and 2 unnamed\n",
      counts: { spoke_s: {}, unnamed: 2, not_yet_named: 0 },
    },
  },
  {
    name: "a voice said to be the same as an unnamed one is that unnamed person",
    lines: [
      transcript("Middag", [voice("S1", 60)]),
      transcript("Lunsj", [voice("S1", 50)], { at: "2026-10-03T11:00:00Z" }),
      speaker(1, "S1", MINTED, { unnamed: true }),
      speaker(2, "S1", undefined, { alias_of: { kind: "speaker", value: `${lineId(1)}#S1` } }),
    ],
    expected: {
      rows: [
        "unplaced      13:00  transcript Lunsj · 1 unnamed · recorded with consent: unknown",
        "unplaced      19:00  transcript Middag · 1 unnamed · recorded with consent: unknown",
      ],
      speakers: {
        "00000000-0000-4000-8000-000000000002": [
          {
            label: "S1",
            person: null,
            name: null,
            seconds: 50,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
        ],
        "00000000-0000-4000-8000-000000000001": [
          {
            label: "S1",
            person: null,
            name: null,
            seconds: 60,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
        ],
      },
      with: [],
      people: "0 people · 2026-10-03 – 2026-10-04 · and 1 unnamed\n",
      counts: { spoke_s: {}, unnamed: 1, not_yet_named: 0 },
    },
  },
  {
    name: "a text label named from the words alone",
    lines: [transcript("Middag", [voice("S1", 60), voice("T1")]), text(1, "T1", OLA)],
    expected: {
      rows: [
        "unplaced      19:00  transcript Middag · S1 1 min · Ola Nordmann · recorded with consent: unknown",
      ],
      speakers: {
        "00000000-0000-4000-8000-000000000001": [
          {
            label: "S1",
            person: null,
            name: null,
            seconds: 60,
            basis: null,
            consent: null,
            owner: false,
          },
          {
            label: "T1",
            person: "019cadd3-6bc0-7dcd-9133-000000000301",
            name: "Ola Nordmann",
            seconds: null,
            basis: "text",
            consent: "unknown",
            owner: false,
          },
        ],
      },
      with: [],
      people:
        "1 person · 2026-10-03 – 2026-10-04 · tier 2 · 1 voice not yet named · review speakers\n  Ola Nordmann  transcripts 1\n",
      counts: { spoke_s: { "Ola Nordmann": 0 }, unnamed: 0, not_yet_named: 1 },
    },
  },
  {
    name: "a person without a label, a voice twice, a bogus consent, a line without basis",
    lines: [
      transcript("Middag", [
        voice("S1", 600, { from_me: true }),
        voice("S2", 300),
        voice("S3", 100),
        voice("S4", 50),
        voice("S5", 7, { channel: "system" }),
      ]),
      speaker(1, "S1", OWNER, { consent: "no" }),
      speaker(1, "S2", OLA),
      speaker(1, "S3", KARI, { label: "Kari Nordmann" }),
      speaker(1, "S4", KARI, { label: "Kari Nordmann", consent: "bogus" }),
      {
        at: "2026-10-04T08:00:00Z",
        source: "manual",
        kind: "resolution",
        payload: {
          schema: "resolution/v1",
          ref: { kind: "speaker", value: `${lineId(1)}#S5` },
          method: "owner",
          entity: { type: "person", id: MINTED, registry: "logbook" },
          label: "Per Nordmann",
        },
      },
    ],
    expected: {
      rows: [
        "unplaced      19:00  transcript Middag · you 10 min · S2 5 min · Kari Nordmann 2 min · Kari Nordmann 50 s · Per Nordmann 7 s · recorded with consent: unknown",
      ],
      speakers: {
        "00000000-0000-4000-8000-000000000001": [
          {
            label: "S1",
            person: "00000000-0000-4000-8000-000000000002",
            name: null,
            seconds: 600,
            basis: "voice",
            consent: "no",
            owner: true,
          },
          {
            label: "S2",
            person: "019cadd3-6bc0-7dcd-9133-000000000301",
            name: null,
            seconds: 300,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
          {
            label: "S3",
            person: "019cadd3-6bc0-7dcd-9133-000000000302",
            name: "Kari Nordmann",
            seconds: 100,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
          {
            label: "S4",
            person: "019cadd3-6bc0-7dcd-9133-000000000302",
            name: "Kari Nordmann",
            seconds: 50,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
          {
            label: "S5",
            person: "019cadd3-6bc0-7dcd-9133-000000000303",
            name: "Per Nordmann",
            seconds: 7,
            basis: null,
            consent: "unknown",
            owner: false,
          },
        ],
      },
      with: [],
      people:
        "3 people · 2026-10-03 – 2026-10-04 · tier 2\n  019cadd3-6bc0-7dcd-9133-000000000301  transcripts 1\n  Kari Nordmann                         transcripts 1\n  Per Nordmann                          transcripts 1\n",
      counts: {
        spoke_s: {
          "019cadd3-6bc0-7dcd-9133-000000000301": 300,
          "Kari Nordmann": 150,
          "Per Nordmann": 7,
        },
      },
    },
  },
  {
    name: "at a stay: a voice bound to a person is company, the far end of a call is not",
    lines: [
      ...home,
      transcript("Middag", [
        voice("mic", 600, { from_me: true, channel: "mic" }),
        voice("S2", 300),
        voice("system", 100, { channel: "system" }),
        voice("S4", 60, { name: "Ola Nordmann" }),
      ]),
      speaker(T, "S2", KARI, { label: "Kari Nordmann" }),
      speaker(T, "system", OLA, { label: "Ola Nordmann", basis: "channel" }),
      email("ola@example.org", OLA, "Ola Nordmann"),
    ],
    places: true,
    expected: {
      rows: [
        "transcript   Middag · you 10 min · Kari Nordmann 5 min · Ola Nordmann 2 min · Ola Nordmann 1 min · recorded with consent: unknown",
        "with         Kari Nordmann (transcript)",
      ],
      speakers: {
        "00000000-0000-4000-8000-000000000022": [
          {
            label: "mic",
            person: "00000000-0000-4000-8000-000000000002",
            name: null,
            seconds: 600,
            basis: "channel",
            consent: null,
            owner: true,
          },
          {
            label: "S2",
            person: "019cadd3-6bc0-7dcd-9133-000000000302",
            name: "Kari Nordmann",
            seconds: 300,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
          {
            label: "system",
            person: "019cadd3-6bc0-7dcd-9133-000000000301",
            name: "Ola Nordmann",
            seconds: 100,
            basis: "channel",
            consent: "unknown",
            owner: false,
          },
          {
            label: "S4",
            person: null,
            name: "Ola Nordmann",
            seconds: 60,
            basis: null,
            consent: null,
            owner: false,
          },
        ],
      },
      with: [
        {
          confirmed: [
            {
              person: "019cadd3-6bc0-7dcd-9133-000000000302",
              name: "Kari Nordmann",
              status: "confirmed",
              confidence: 1,
              sources: ["transcript"],
              reasons: ["spoke in Middag"],
              lines: ["00000000-0000-4000-8000-000000000022"],
            },
          ],
          proposed: [],
        },
      ],
      people:
        "2 people · 2026-10-01 – 2026-10-04 · tier 2 · 1 voice not yet named · review speakers\n  Kari Nordmann  transcripts 1 · 1 day · 1 night · last real contact 2026-10-03 (meeting) · Home\n  Ola Nordmann   transcripts 1\n",
      counts: {
        spoke_s: { "Kari Nordmann": 300, "Ola Nordmann": 100 },
        unnamed: 0,
        not_yet_named: 1,
      },
    },
  },
  {
    name: "at a stay: a voice and a participant of the same person are one",
    lines: [
      ...home,
      transcript("Middag", [voice("S2", 300)], {
        participants: [{ name: "Ola", email: "ola@example.org" }],
      }),
      speaker(T, "S2", OLA, { label: "Ola Nordmann" }),
      email("ola@example.org", OLA, "Ola Nordmann"),
    ],
    places: true,
    expected: {
      rows: [
        "transcript   Middag · Ola Nordmann 5 min · recorded with consent: unknown",
        "with         Ola Nordmann (transcript)",
      ],
      speakers: {
        "00000000-0000-4000-8000-000000000022": [
          {
            label: "S2",
            person: "019cadd3-6bc0-7dcd-9133-000000000301",
            name: "Ola Nordmann",
            seconds: 300,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
        ],
      },
      with: [
        {
          confirmed: [
            {
              person: "019cadd3-6bc0-7dcd-9133-000000000301",
              name: "Ola Nordmann",
              status: "confirmed",
              confidence: 1,
              sources: ["transcript"],
              reasons: ["spoke in Middag"],
              lines: ["00000000-0000-4000-8000-000000000022"],
            },
          ],
          proposed: [],
        },
      ],
      people:
        "1 person · 2026-10-01 – 2026-10-04 · tier 2\n  Ola Nordmann  transcripts 1 · 1 day · 1 night · last real contact 2026-10-03 (meeting) · Home\n",
      counts: { spoke_s: { "Ola Nordmann": 300 } },
    },
  },
  {
    name: "at a stay: the voices ahead of the participants, the unnamed counted",
    lines: [
      ...home,
      transcript("Middag", [voice("S1", 300), voice("S2", 200), voice("S3", 100)], {
        participants: [{ name: "Kari", email: "kari@example.org" }],
      }),
      speaker(T, "S1", MINTED, { unnamed: true }),
      speaker(T, "S2", OLA, { label: "Ola Nordmann" }),
      speaker(T, "S3", MINTED_2, { unnamed: true }),
      email("ola@example.org", OLA, "Ola Nordmann"),
      email("kari@example.org", KARI, "Kari Nordmann"),
    ],
    places: true,
    expected: {
      rows: [
        "transcript   Middag · Ola Nordmann 3 min · 2 unnamed · recorded with consent: unknown",
        "with         Ola Nordmann (transcript), Kari Nordmann (transcript) · 2 unnamed",
      ],
      speakers: {
        "00000000-0000-4000-8000-000000000022": [
          {
            label: "S1",
            person: null,
            name: null,
            seconds: 300,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
          {
            label: "S2",
            person: "019cadd3-6bc0-7dcd-9133-000000000301",
            name: "Ola Nordmann",
            seconds: 200,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
          {
            label: "S3",
            person: null,
            name: null,
            seconds: 100,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
        ],
      },
      with: [
        {
          confirmed: [
            {
              person: "019cadd3-6bc0-7dcd-9133-000000000301",
              name: "Ola Nordmann",
              status: "confirmed",
              confidence: 1,
              sources: ["transcript"],
              reasons: ["spoke in Middag"],
              lines: ["00000000-0000-4000-8000-000000000022"],
            },
            {
              person: "019cadd3-6bc0-7dcd-9133-000000000302",
              name: "Kari Nordmann",
              status: "confirmed",
              confidence: 0.9,
              sources: ["transcript"],
              reasons: ["spoke in Middag"],
              lines: ["00000000-0000-4000-8000-000000000022"],
            },
          ],
          proposed: [],
          unnamed: 2,
        },
      ],
      people:
        "2 people · 2026-10-01 – 2026-10-04 · tier 2 · and 2 unnamed\n  Kari Nordmann  transcripts 1 · 1 day · 1 night · last real contact 2026-10-03 (meeting) · Home\n  Ola Nordmann   transcripts 1 · 1 day · 1 night · last real contact 2026-10-03 (meeting) · Home\n",
      counts: {
        spoke_s: { "Kari Nordmann": null, "Ola Nordmann": 200 },
        unnamed: 2,
        not_yet_named: 0,
      },
    },
  },
  {
    name: "at a stay: a text label is company at its own confidence; an unnamed voice alone",
    lines: [
      ...home,
      transcript("Middag", [voice("T1"), voice("S2", 300)]),
      text(T, "T1", OLA),
      speaker(T, "S2", MINTED, { unnamed: true }),
    ],
    places: true,
    expected: {
      rows: [
        "transcript   Middag · Ola Nordmann · 1 unnamed · recorded with consent: unknown",
        "with         Ola Nordmann (transcript) · 1 unnamed",
      ],
      speakers: {
        "00000000-0000-4000-8000-000000000022": [
          {
            label: "T1",
            person: "019cadd3-6bc0-7dcd-9133-000000000301",
            name: "Ola Nordmann",
            seconds: null,
            basis: "text",
            consent: "unknown",
            owner: false,
          },
          {
            label: "S2",
            person: null,
            name: null,
            seconds: 300,
            basis: "voice",
            consent: "unknown",
            owner: false,
          },
        ],
      },
      with: [
        {
          confirmed: [
            {
              person: "019cadd3-6bc0-7dcd-9133-000000000301",
              name: "Ola Nordmann",
              status: "confirmed",
              confidence: 0.4,
              sources: ["transcript"],
              reasons: ["spoke in Middag"],
              lines: ["00000000-0000-4000-8000-000000000022"],
            },
          ],
          proposed: [],
          unnamed: 1,
        },
      ],
      people:
        "1 person · 2026-10-03 – 2026-10-04 · tier 2 · and 1 unnamed\n  Ola Nordmann  transcripts 1 · 1 day · 1 night · last real contact 2026-10-03 (meeting) · Home\n",
      counts: { spoke_s: { "Ola Nordmann": 0 }, unnamed: 1, not_yet_named: 0 },
    },
  },
];

/** A case's record, with `places.json` beside it when the case has a stay. */
export function speakerRecord(c: SpeakerCase): string {
  const root = writeBareRecord(c.lines);
  if (c.places === true)
    writeFileSync(join(root, "places.json"), `${JSON.stringify(PLACES)}\n`, "utf-8");
  return root;
}

/** What `SpeakerExpected` holds, read from a Day's text and JSON and a `people` report. */
export function observed(
  dayText: string,
  dayJson: unknown,
  peopleText: string,
  peopleJson: Record<string, unknown>,
): SpeakerExpected {
  const day = JSON.parse(JSON.stringify(dayJson)) as {
    unplaced: Array<{ line: string; speakers?: unknown[] }>;
    timeline: Array<{
      attached?: { transcripts?: Array<{ line: string; speakers?: unknown[] }> };
      with?: unknown;
    }>;
  };
  const speakers: Record<string, unknown[]> = {};
  for (const t of day.unplaced) if (t.speakers) speakers[t.line] = t.speakers;
  const withs: unknown[] = [];
  for (const r of day.timeline) {
    for (const t of r.attached?.transcripts ?? []) if (t.speakers) speakers[t.line] = t.speakers;
    if (r.with) withs.push(r.with);
  }
  const people = JSON.parse(JSON.stringify(peopleJson)) as {
    people: Array<{ name: string; channels: { transcripts?: { spoke_s?: number } } }>;
    unnamed?: number;
    not_yet_named?: number;
  };
  const spoke: Record<string, number | null> = {};
  for (const p of people.people) spoke[p.name] = p.channels.transcripts?.spoke_s ?? null;
  return {
    rows: dayText
      .split("\n")
      .map((r) => r.trim())
      .filter((r) => r.includes("transcript ") || r.startsWith("with ")),
    speakers,
    with: withs,
    people: peopleText,
    counts: {
      spoke_s: spoke,
      ...("unnamed" in people ? { unnamed: people.unnamed } : {}),
      ...("not_yet_named" in people ? { not_yet_named: people.not_yet_named } : {}),
    },
  };
}
