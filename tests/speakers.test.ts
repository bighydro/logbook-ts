import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localToMs, utcIso } from "../src/clock.js";
import { readDay } from "../src/day.js";
import { renderDay } from "../src/dayText.js";
import { FLAGS_ENV } from "../src/flags.js";
import { showDay } from "../src/show.js";
import { lengthText, speakersJson, voicesOf, voicesSuffix, wholeNumber } from "../src/speakers.js";
import {
  cleanup,
  type Draft,
  expectedDays,
  expectedShows,
  FIXTURES,
  SAMPLE,
  writeRecord,
} from "./helpers.js";

/**
 * A transcript's voices (RFC 0038 §2; RFC 0004's amendment of 2026-10-14) where `show` and the Day
 * print a transcript, under the rfc0038 flag. Every expected row and object below is what the
 * reference (main at 7bcf728) printed for the same lines in a record of its own; the seqs are the
 * same, the ids are this test record's. The people are synthetic.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

const TZ = "Europe/Oslo";
const DAY = "2026-10-06";
const at = (clock: string, day = DAY): string => utcIso(localToMs(day, clock, TZ));
const id = (seq: number): string => `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;

function transcript(
  clock: string,
  title: string,
  voices: unknown,
  more: Record<string, unknown> = {},
  day = DAY,
): Draft {
  const payload: Record<string, unknown> = {
    schema: "transcript/v1",
    provider: "mlx-whisper",
    raw_id: `${title}@${clock}`,
    title,
    participants: [],
    ...more,
  };
  if (voices !== undefined) {
    payload.speakers = voices;
    payload.diarization = { engine: "pyannote", channels: 1 };
  }
  return { at: at(clock, day), end: null, source: "transcription", kind: "transcript", payload };
}

const CALL = [
  { label: "mic", seconds: 201.7, turns: 38, channel: "mic", from_me: true },
  { label: "system", seconds: 188.3, turns: 35, channel: "system", name: "Ola Nordmann" },
];

/** The lines of the first probe, in its order. */
const PROBE: Draft[] = [
  transcript("06:00", "A", CALL),
  transcript("06:10", "B", [
    { label: "S1", seconds: 0, turns: 1 },
    { label: "S2", seconds: 59.4, turns: 4 },
    { label: "S3", seconds: 59.5, turns: 4 },
    { label: "S4", seconds: 60, turns: 4 },
    { label: "S5", seconds: 89.9, turns: 4 },
    { label: "S6", seconds: 90, turns: 4 },
  ]),
  transcript("06:20", "C", [
    { label: "S1", seconds: 3599, turns: 1 },
    { label: "S2", seconds: 3600, turns: 4 },
    { label: "S3", seconds: 3661, turns: 4 },
    { label: "S4", seconds: 7230, turns: 4 },
    { label: "S5", seconds: 0.4, turns: 4 },
    { label: "S6", seconds: 150, turns: 4 },
  ]),
  transcript("06:30", "D", [
    { label: "S1", turns: 3 },
    { label: "Speaker 2", turns: 2, name: "Kari Nordmann" },
  ]),
  transcript("06:40", "E", [{ label: "mic", turns: 3, from_me: true }]),
  transcript("06:50", "F", [
    { label: "mic.1", seconds: 30, turns: 3, channel: "mic" },
    { label: "mic.2", seconds: 40, turns: 3, channel: "mic", from_me: true },
  ]),
  transcript("07:00", "G", []),
  transcript("07:10", "H", "mic,system"),
  transcript("07:20", "I", [{ label: "S1", seconds: 12.5, turns: 3 }, "junk", { seconds: 4 }]),
  transcript("07:30", "J", [{ label: "S1", seconds: 12.5, turns: 3 }], {
    extra: { turns: 7, duration_s: 125 },
  }),
  transcript("07:40", "K", undefined, { extra: { turns: 7, duration_s: 125 } }),
  transcript("07:50", "L", undefined, { extra: { turns: 0, duration_s: 2 } }),
  transcript("08:00", "M", [
    { label: "S1", seconds: "12", turns: 3 },
    { label: "S2", seconds: true, turns: 3 },
    { label: "S3", seconds: -5, turns: 3 },
    { label: 7, turns: 1 },
  ]),
  transcript("08:10", "N", [{ label: "S1", seconds: 12, turns: 3, from_me: true }]),
  transcript("08:20", "O", [{ label: "S1", seconds: 12, turns: 3 }], {
    participants: [{ name: "Ola Nordmann", email: "ola@example.org" }],
  }),
];

const SHOWN = [
  "A · you 3 min · Ola Nordmann 3 min",
  "B · S1 0 s · S2 59 s · S3 60 s · S4 1 min · S5 1 min · S6 2 min",
  "C · S1 60 min · S2 60 min · S3 61 min · S4 120 min · S5 0 s · S6 2 min",
  "D · S1 · Kari Nordmann",
  "E · you",
  "F · mic.1 30 s · you 40 s",
  "G",
  "H",
  "I · S1 12 s",
  "J; 2 min · S1 12 s",
  "K; 7 turns, 2 min",
  "L; 0 turns, 2 s",
  "M · S1 · S2 · S3",
  "N · you 12 s",
  "O — Ola Nordmann · S1 12 s",
];

const rowsOf = (text: string): string[] => text.split("\n").slice(1, -1);

describe("the voices of a transcript, read leniently", () => {
  it("reads a voice whose label is 1 to 64 characters with no # and no line break", () => {
    const p = {
      schema: "transcript/v1",
      speakers: [
        { label: "", turns: 1 },
        { label: "a#b", turns: 1 },
        { label: "a\nb", turns: 1 },
        { label: "x".repeat(64), turns: 1 },
        { label: "y".repeat(65), turns: 1 },
        { label: " S1 ", turns: 1 },
        { label: "   ", turns: 1 },
        { label: "😀".repeat(64), turns: 1 },
      ],
    };
    expect(voicesOf(p).map((v) => v.label)).toEqual([
      "x".repeat(64),
      " S1 ",
      "   ",
      "😀".repeat(64),
    ]);
  });

  it("keeps a name as given, never a blank one; the owner only from `from_me: true`", () => {
    const p = {
      schema: "transcript/v1",
      speakers: [
        { label: "S1", turns: 1, name: "  " },
        { label: "S2", turns: 1, name: 5 },
        { label: "S3", turns: 1, name: " Ola " },
        { label: "S4", turns: 1, from_me: 1 },
        { label: "S5", turns: 1, from_me: "true" },
        { label: "S6", turns: 1, from_me: true, name: "Ines" },
      ],
    };
    expect(voicesSuffix(voicesOf(p))).toBe(" · S1 · S2 ·  Ola  · S4 · S5 · you");
    expect(speakersJson(p)?.map((s) => [s.name, s.owner, s.basis])).toEqual([
      [null, false, null],
      [null, false, null],
      [" Ola ", false, null],
      [null, false, null],
      [null, false, null],
      ["Ines", true, "channel"],
    ]);
  });

  it("gives `day --json`'s object for each voice, and nothing for a line with none it can read", () => {
    expect(speakersJson({ schema: "transcript/v1", speakers: CALL })).toEqual([
      {
        label: "mic",
        person: null,
        name: null,
        seconds: 201.7,
        basis: "channel",
        consent: null,
        owner: true,
      },
      {
        label: "system",
        person: null,
        name: "Ola Nordmann",
        seconds: 188.3,
        basis: null,
        consent: null,
        owner: false,
      },
    ]);
    for (const speakers of [[], "mic,system", { label: "S1", turns: 1 }, [7, null, "S1"]]) {
      expect(
        speakersJson({ schema: "transcript/v1", speakers: speakers as never }),
      ).toBeUndefined();
    }
    expect(speakersJson({ schema: "transcript/v1" })).toBeUndefined();
  });

  it("spells a length as Python's `{:.0f}` does: half to even, every digit, -0 kept", () => {
    expect([59.5, 89.99, 0.5, 1.5, 2.5, 3599, 7230].map(lengthText)).toEqual([
      "60 s",
      "1 min",
      "0 s",
      "2 s",
      "2 s",
      "60 min",
      "120 min",
    ]);
    expect(lengthText(1e300)).toBe(
      "16666666666666667541746004253407004145074476351802652581930901925196707633148469929772856251340797734061740730548064636282375387256007176260746536413111783047473120015442930062297170563246468167656149220582846665751351983982794014667910879046335708242987646480334280713968594491203273114424323342336 min",
    );
    expect(wholeNumber(-0)).toBe("-0");
    // Past 2^53 Python prints the double's exact digits (the checker's probe, reference at 7bcf728).
    expect(lengthText(2 ** 63)).toBe("153722867280912928 min");
    expect(lengthText(1e18)).toBe("16666666666666666 min");
    expect(lengthText(1e21)).toBe("16666666666666665984 min");
  });

  it("reads a length beyond a double as none, where the reference raises", () => {
    // `1` and 400 zeros is a JSON integer the reference's writer accepts and its readers cannot
    // turn into a float (OverflowError); here it is no length (SPEC-QUESTIONS 95g).
    const huge = JSON.parse(
      `{"label": "S1", "seconds": 1${"0".repeat(400)}, "turns": 1}`,
    ) as Record<string, never>;
    const p = { schema: "transcript/v1", speakers: [huge] };
    expect(voicesSuffix(voicesOf(p))).toBe(" · S1");
    expect(speakersJson(p)?.[0]?.seconds).toBeNull();
  });
});

describe("show prints a transcript's voices under the rfc0038 flag, as the reference does", () => {
  it("after the title, the people and the length; the turns dropped beside them", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0038");
    const root = writeRecord(PROBE);
    expect(rowsOf(showDay(root, { day: DAY }).text)).toEqual(
      SHOWN.map((s, n) => `  ${clockOf(n)}  transcript transcription  ${s}`),
    );
  });

  it("and with the flag off, as before: no voices, the turns kept", () => {
    vi.stubEnv(FLAGS_ENV, "");
    const root = writeRecord(PROBE);
    const rows = rowsOf(showDay(root, { day: DAY }).text);
    expect(rows[0]).toBe("  06:00  transcript transcription  A");
    expect(rows[9]).toBe("  07:30  transcript transcription  J; 7 turns, 2 min");
    expect(rows.every((r) => !r.includes(" · "))).toBe(true);
  });
});

function clockOf(n: number): string {
  const minutes = 6 * 60 + 10 * n;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The lines of the supersession probe, in its order; seq 17 is the retraction of seq 16. */
function supersession(): Draft[] {
  const voices = [{ label: "S1", seconds: 600, turns: 3 }];
  const g = (
    clock: string,
    title: string,
    more: Record<string, unknown> = {},
    v?: unknown,
    day = DAY,
  ) => ({
    ...transcript(clock, title, v, more, day),
    source: "granola",
  });
  const note = (clock: string, text: string, more: Record<string, unknown> = {}): Draft => ({
    at: at(clock),
    source: "manual",
    kind: "note",
    payload: { schema: "note/v1", text, ...more },
  });
  return [
    g("09:00", "T1"), // 1
    g("09:00", "T2 heard again", { supersedes: id(1) }, voices), // 2
    g("10:00", "T1b"), // 3
    g("10:00", "T3 next day", { supersedes: id(3) }, voices, "2026-10-07"), // 4
    g("11:00", "T1c"), // 5
    note("11:05", "a note superseding a transcript", { supersedes: id(5) }), // 6
    note("12:00", "plain note"), // 7
    g("12:05", "T4 supersedes note", { supersedes: id(7) }), // 8
    g("13:00", "T5"), // 9
    g("13:01", "T5a", { supersedes: id(9) }), // 10
    g("13:02", "T5b", { supersedes: id(9) }), // 11
    g("14:00", "T6"), // 12
    g("14:01", "T7", { supersedes: id(12) }), // 13
    g("14:02", "T8", { supersedes: id(13) }), // 14
    g("15:00", "T9"), // 15
    g("15:01", "T10 retracted", { supersedes: id(15) }), // 16
    {
      at: at("15:02"),
      source: "manual",
      kind: "retraction",
      payload: { schema: "retraction/v1", supersedes: id(16), seq: 16, reason: "heard wrong" },
    }, // 17
  ];
}

describe("a transcript heard again, under the rfc0038 flag, as the reference reads it", () => {
  it("show marks every line a standing transcript supersedes, whatever its kind", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0038");
    const root = writeRecord(supersession());
    expect(rowsOf(showDay(root, { day: DAY }).text)).toEqual([
      "  09:00  transcript granola        superseded by #2",
      "  09:00  transcript granola        T2 heard again · S1 10 min",
      "  10:00  transcript granola        superseded by #4",
      "  11:00  transcript granola        T1c",
      "  11:05  note       manual         a note superseding a transcript",
      "  12:00  note       manual         superseded by #8",
      "  12:05  transcript granola        T4 supersedes note",
      "  13:00  transcript granola        superseded by #11",
      "  13:01  transcript granola        T5a",
      "  13:02  transcript granola        T5b",
      "  14:00  transcript granola        superseded by #13",
      "  14:01  transcript granola        superseded by #14",
      "  14:02  transcript granola        T8",
      "  15:00  transcript granola        T9",
      "  15:01  retracted #16: heard wrong",
    ]);
  });

  it("the Day leaves out a transcript another transcript of the day supersedes, and counts its line", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0038");
    const root = writeRecord(supersession());
    const day = readDay(root, { day: DAY });
    expect(
      renderDay(day)
        .split("\n")
        .filter((r) => r.startsWith("  unplaced")),
    ).toEqual([
      "  unplaced      09:00  transcript T2 heard again · S1 10 min",
      "  unplaced      10:00  transcript T1b",
      "  unplaced      11:00  transcript T1c",
      "  unplaced      11:05  note   a note superseding a transcript",
      "  unplaced      12:00  note   plain note",
      "  unplaced      12:05  transcript T4 supersedes note",
      "  unplaced      13:01  transcript T5a",
      "  unplaced      13:02  transcript T5b",
      "  unplaced      14:02  transcript T8",
      "  unplaced      15:00  transcript T9",
    ]);
    // The reference: `granola 12 lines, last 15:00 · manual 2 lines, last 12:00`.
    expect(day.sources.find((s) => s.source === "granola")?.lines).toBe(12);
  });

  it("and with the flag off, as before: nothing marked, nothing left out", () => {
    vi.stubEnv(FLAGS_ENV, "");
    const root = writeRecord(supersession());
    const rows = rowsOf(showDay(root, { day: DAY }).text);
    expect(rows[0]).toBe("  09:00  transcript granola        T1");
    expect(rows[5]).toBe("  12:00  note       manual         plain note");
    expect(readDay(root, { day: DAY }).unplaced).toHaveLength(14);
  });
});

describe("the Day names a transcript's voices under the rfc0038 flag, as the reference does", () => {
  it("on an unplaced transcript, as text and under `speakers`; a transcript without voices as before", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0038");
    const root = writeRecord(PROBE);
    const day = readDay(root, { day: DAY });
    expect(
      renderDay(day)
        .split("\n")
        .filter((r) => r.startsWith("  unplaced")),
    ).toEqual(
      [
        "A · you 3 min · Ola Nordmann 3 min",
        "B · S1 0 s · S2 59 s · S3 60 s · S4 1 min · S5 1 min · S6 2 min",
        "C · S1 60 min · S2 60 min · S3 61 min · S4 120 min · S5 0 s · S6 2 min",
        "D · S1 · Kari Nordmann",
        "E · you",
        "F · mic.1 30 s · you 40 s",
        "G",
        "H",
        "I · S1 12 s",
        "J · S1 12 s",
        "K",
        "L",
        "M · S1 · S2 · S3",
        "N · you 12 s",
        "O · S1 12 s",
      ].map((s, n) => `  unplaced      ${clockOf(n)}  transcript ${s}`),
    );
    const json = JSON.parse(JSON.stringify(day)) as { unplaced: Array<Record<string, unknown>> };
    expect(json.unplaced[0]).toEqual({
      kind: "transcript",
      at: "2026-10-06T04:00:00Z",
      end: null,
      title: "A",
      line: id(1),
      speakers: [
        {
          label: "mic",
          person: "00000000-0000-4000-8000-000000000002",
          name: null,
          seconds: 201.7,
          basis: "channel",
          consent: null,
          owner: true,
        },
        {
          label: "system",
          person: null,
          name: "Ola Nordmann",
          seconds: 188.3,
          basis: null,
          consent: null,
          owner: false,
        },
      ],
    });
    for (const n of [6, 7, 10, 11]) expect(json.unplaced[n]).not.toHaveProperty("speakers");
    expect(json.unplaced[12]?.speakers).toHaveLength(3);
  });

  it("on a transcript attached to a stay, and only on the standing one of a recording heard again", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0038");
    const points: Draft[] = [];
    for (let m = 18 * 60; m <= 23 * 60; m += 5) {
      const clock = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      points.push({
        at: at(clock),
        source: "dawarich",
        kind: "location",
        tier: 1,
        payload: {
          schema: "location/v1",
          lat: 59.9139,
          lon: 10.7522,
          accuracy_m: 12,
          raw_id: `p${m}`,
        },
      });
    }
    const room = [
      { label: "S1", seconds: 1862.4, turns: 212 },
      { label: "S2", seconds: 41.5, turns: 4, name: "Kari" },
      { label: "S3", turns: 1, from_me: true, name: "Ines" },
    ];
    const n = points.length;
    const dinner = (more: Record<string, unknown>, voices?: unknown): Draft => ({
      ...transcript("19:40", "Middag", voices, more),
      end: at("20:30"),
      source: "granola",
    });
    const root = writeRecord([
      ...points,
      dinner({}),
      dinner({ supersedes: id(n + 1) }, room),
      {
        ...transcript("21:00", "Kveld", [{ label: "mic", turns: 2, from_me: true, name: "Me" }]),
        source: "granola",
      },
    ]);
    const day = readDay(root, { day: DAY });
    const text = renderDay(day);
    expect(text).toContain("· 2 transcripts\n");
    expect(text).toContain("      transcript   Middag · S1 31 min · Kari 42 s · you\n");
    expect(text).toContain("      transcript   Kveld · you\n");
    const attached = day.timeline.flatMap((e) =>
      "attached" in e && e.attached ? e.attached.transcripts : [],
    );
    expect(JSON.parse(JSON.stringify(attached))).toEqual([
      {
        title: "Middag",
        line: id(n + 2),
        speakers: [
          {
            label: "S1",
            person: null,
            name: null,
            seconds: 1862.4,
            basis: null,
            consent: null,
            owner: false,
          },
          {
            label: "S2",
            person: null,
            name: "Kari",
            seconds: 41.5,
            basis: null,
            consent: null,
            owner: false,
          },
          {
            label: "S3",
            person: "00000000-0000-4000-8000-000000000002",
            name: null,
            seconds: null,
            basis: "channel",
            consent: null,
            owner: true,
          },
        ],
      },
      {
        title: "Kveld",
        line: id(n + 3),
        speakers: [
          {
            label: "mic",
            person: "00000000-0000-4000-8000-000000000002",
            name: null,
            seconds: null,
            basis: "channel",
            consent: null,
            owner: true,
          },
        ],
      },
    ]);
    expect(day.sources.find((s) => s.source === "granola")?.lines).toBe(3);
  });
});

describe("a transcript without voices reads exactly as before, the flag on or off", () => {
  it("in show and in the Day", () => {
    const lines = [
      transcript("09:00", "Plain", undefined, { extra: { turns: 12, duration_s: 2100 } }),
      transcript("10:00", "With people", undefined, {
        participants: [{ name: "Kari Nordmann", email: "kari@example.org" }],
      }),
    ];
    const root = writeRecord(lines);
    vi.stubEnv(FLAGS_ENV, "");
    const before = {
      show: showDay(root, { day: DAY }).text,
      day: JSON.stringify(readDay(root, { day: DAY })),
    };
    vi.stubEnv(FLAGS_ENV, "rfc0038");
    expect(showDay(root, { day: DAY }).text).toBe(before.show);
    expect(JSON.stringify(readDay(root, { day: DAY }))).toBe(before.day);
  });
});

describe("every fixture without voices reads as the reference printed it, the rfc0038 flag on", () => {
  // None of these records has a `speakers` field or a transcript that supersedes a line: with the
  // flag on, show and the Day print them byte for byte as captured from the reference.
  for (const name of ["show-sample", "profiles-sample"]) {
    for (const { day, raw, text } of expectedShows(join(FIXTURES, name))) {
      it(`show ${name} ${day}${raw ? " --raw" : ""}`, () => {
        vi.stubEnv(FLAGS_ENV, "rfc0038");
        expect(showDay(join(FIXTURES, name), { day, raw }).text).toBe(text);
      });
    }
  }
  for (const { day, raw, text } of expectedShows(SAMPLE)) {
    it(`show sample-logbook ${day}${raw ? " --raw" : ""}`, () => {
      vi.stubEnv(FLAGS_ENV, "rfc0038");
      expect(showDay(SAMPLE, { day, raw }).text).toBe(text);
    });
  }
  for (const name of ["day-sample", "demo-sample"]) {
    it(`day ${name}, every day, as text and as JSON`, () => {
      vi.stubEnv(FLAGS_ENV, "rfc0038");
      for (const expected of expectedDays(join(FIXTURES, name))) {
        const day = readDay(join(FIXTURES, name), { day: expected.day });
        expect(renderDay(day)).toBe(expected.text);
        expect(JSON.parse(JSON.stringify(day))).toEqual(expected.json);
      }
    });
  }
});
