/**
 * The example lines of RFC 0036 (bighydro/logbook, `rfcs/0036-*.md`, 2026-10-13) and of its amendment 1
 * (PR 269, branch `rfc/0036-amendment-1`, open at this writing), as the RFC prints them, with the envelope
 * fields the RFC leaves out (`id`, `seq`, `recorded_at`, `prev`, `hash`) filled in. The ids are the RFC's
 * own where it names them: the goals `…0301` and `…0302`, the day's evidence `…00a1`–`…00a4`, the person
 * `…0501` and their lines `…05a1`–`…05a4`. Ines and Ola Nordmann of Oslo do not exist.
 */
import type { JsonValue, Line } from "../src/types.js";

export const OWNER = "00000000-0000-4000-8000-000000000001";
export const id = (n: string | number): string =>
  `019cadd3-6bc0-7dcd-9133-${String(n).padStart(12, "0")}`;

let seq = 0;

/** A line of the RFC's examples: the envelope filled, the hash a placeholder (no chain is checked here). */
export function line(
  fields: {
    id: string;
    at: string;
    source: string;
    kind: string;
    tier: number;
    payload: Record<string, JsonValue>;
    end?: JsonValue;
    recorded_at?: string;
    seq?: number;
  },
  // biome-ignore lint/suspicious/noExplicitAny: a test builds invalid lines on purpose.
): Line & Record<string, any> {
  seq += 1;
  return {
    end: null,
    tz: "Europe/Oslo",
    recorded_at: fields.at,
    prev: "0".repeat(64),
    hash: "0".repeat(64),
    seq,
    ...fields,
  } as unknown as Line;
}

/** A copy of `l` with `payload` fields set (a value of `undefined` removes the key) and envelope fields set. */
export function edit(
  l: Line,
  payload: Record<string, JsonValue | undefined> = {},
  envelope: Record<string, JsonValue | undefined> = {},
): Line {
  const p: Record<string, JsonValue | undefined> = { ...(l.payload as Record<string, JsonValue>) };
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined) delete p[k];
    else p[k] = v;
  }
  const out: Record<string, JsonValue | undefined> = {
    ...(l as unknown as Record<string, JsonValue>),
  };
  for (const [k, v] of Object.entries(envelope)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  out.payload = p as JsonValue;
  return out as unknown as Line;
}

// -- goal/v1 ----------------------------------------------------------------------------------------------

/** Ines writes the year's goal on the first Sunday of January, for a year that began on the 1st. */
export const GOAL = line({
  id: id(301),
  at: "2026-01-04T10:15:00Z",
  source: "manual",
  kind: "goal",
  tier: 2,
  payload: {
    schema: "goal/v1",
    text: "Sail the boat to Lofoten and back in one summer, without a single night in a marina I didn't choose.",
    horizon: "year",
    from: "2026-01-01",
  },
});

/** The same goal reworded in March, superseding it. */
export const GOAL_REWORDED = line({
  id: id(302),
  at: "2026-03-15T08:40:00Z",
  source: "manual",
  kind: "goal",
  tier: 2,
  payload: {
    schema: "goal/v1",
    text: "Sail to Lofoten and back between June and August, at anchor more nights than not.",
    horizon: "year",
    from: "2026-01-01",
    until: "2026-12-31",
    supersedes: id(301),
  },
});

// -- review/v1 --------------------------------------------------------------------------------------------

/** In October, Ines writes down that she let the year's sailing goal go in August; dated August. */
export const REVIEW = line({
  id: id(601),
  at: "2026-08-31T20:00:00Z",
  recorded_at: "2026-10-11T18:30:00Z",
  source: "manual",
  kind: "review",
  tier: 2,
  payload: {
    schema: "review/v1",
    goal: id(302),
    disposition: "let go",
    period: "month",
    note: "Engine gone in Bodø on the 9th. Towed home. Next summer.",
  },
});

// -- draft/v1 ---------------------------------------------------------------------------------------------

/** The five lines a local model read of Saturday, 13 June 2026, under a ceiling of 2. */
export const DAY_LINES = [
  line({
    id: id("a1"),
    at: "2026-06-13T07:30:00Z",
    source: "sim-phone",
    kind: "location",
    tier: 1,
    payload: { schema: "location/v1", lat: 59.911, lon: 10.75, accuracy_m: 12 },
  }),
  line({
    id: id("a2"),
    at: "2026-06-13T13:00:00Z",
    source: "sim-phone",
    kind: "location",
    tier: 1,
    payload: { schema: "location/v1", lat: 59.8, lon: 10.47, accuracy_m: 12 },
  }),
  line({
    id: id("a3"),
    at: "2026-06-13T14:10:00Z",
    source: "sim-camera",
    kind: "photo",
    tier: 1,
    payload: { schema: "photo/v1", file: "IMG_0613.jpg" },
  }),
  line({
    id: id("a4"),
    at: "2026-06-13T16:00:00Z",
    source: "manual",
    kind: "note",
    tier: 2,
    payload: { schema: "note/v1", text: "The engine sounded right for the first time since May." },
  }),
  line({
    id: id("a5"),
    at: "2026-06-13T18:00:00Z",
    source: "sim-phone",
    kind: "location",
    tier: 1,
    payload: { schema: "location/v1", lat: 59.911, lon: 10.75, accuracy_m: 12 },
  }),
];

/** The fourth sentence rests on nothing and says so. */
export const DRAFT = line({
  id: id("d1"),
  at: "2026-06-14T06:10:00Z",
  source: "model:qwen2.5-7b-instruct",
  kind: "draft",
  tier: 2,
  payload: {
    schema: "draft/v1",
    unit: "day",
    subject: "2026-06-13",
    read_head: "bb97e90d3f946f6cc637e5e223b080ada65e2beb12b07293727e28d2a279b3d8",
    read_count: 5,
    language: "en",
    segments: [
      {
        text: "A morning at home, then the afternoon at the boat in Vollen.",
        evidence: [id("a1"), id("a2")],
      },
      { text: "One photo from the pontoon, the new mooring lines on.", evidence: [id("a3")] },
      {
        text: "You wrote that the engine sounded right for the first time since May.",
        evidence: [id("a4")],
      },
      { text: "Ola came by in the evening.", unsupported: true },
    ],
  },
});

/** Amendment 1: what has passed between Ines and Ola since the middle of July, under the `dream` entry. */
export const PERSON_DRAFT = line({
  id: id("d2"),
  at: "2026-10-12T06:20:00Z",
  source: "model:qwen2.5-7b-instruct",
  kind: "draft",
  tier: 2,
  payload: {
    schema: "draft/v1",
    unit: "person",
    subject: id(501),
    window: { from: "2026-07-14", to: "2026-10-11" },
    read_head: "34cb1808a3e7cf1e88351f1dedff1cfbc4ab0a3b1846d04150b8b707cc1d0f2c",
    read_count: 11,
    read_policy: {
      entry: "dream",
      max_tier: 2,
      sha256: "e416f16fa4e6cc7e8b02cb3f6fe761fdcae93e45ee6c6745af647a47e3797f86",
    },
    language: "en",
    segments: [
      {
        text: "Most of what passed between you since July is the boat: the engine in Bodø, then the tow home.",
        evidence: [id("5a1"), id("5a2")],
      },
      {
        text: "Ola asked twice in September whether you will keep the berth in Vollen for next summer.",
        evidence: [id("5a3"), id("5a4")],
      },
      { text: "The cost of the rebuild seems to weigh on you both.", unsupported: true },
    ],
  },
});

// -- chapter/v1 -------------------------------------------------------------------------------------------

/** Named in September: the summer on the boat, from casting off in June to the tow into Bodø. */
export const CHAPTER = line({
  id: id(401),
  at: "2026-09-06T17:20:00Z",
  source: "manual",
  kind: "chapter",
  tier: 2,
  payload: {
    schema: "chapter/v1",
    name: "The Lofoten summer",
    from: "2026-06-20",
    to: "2026-08-09",
    rules:
      "Every night at anchor counts. A marina counts against. The engine is not the point; the boat is.",
  },
});

/** The open chapter after it, named the same evening. */
export const CHAPTER_OPEN = line({
  id: id(402),
  at: "2026-09-06T17:25:00Z",
  source: "manual",
  kind: "chapter",
  tier: 2,
  payload: {
    schema: "chapter/v1",
    name: "Ashore, fixing things",
    from: "2026-08-10",
    rules:
      "What counts: the engine rebuilt, the mooring sorted, one weekend a month on the water anyway.",
  },
});

/** Amendment 1, `chapter close --to 2026-11-29`: a third line that supersedes the second, every field again. */
export const CHAPTER_CLOSED = line({
  id: id(403),
  at: "2026-12-01T19:00:00Z",
  source: "manual",
  kind: "chapter",
  tier: 2,
  payload: {
    schema: "chapter/v1",
    name: "Ashore, fixing things",
    from: "2026-08-10",
    to: "2026-11-29",
    rules:
      "What counts: the engine rebuilt, the mooring sorted, one weekend a month on the water anyway.",
    supersedes: id(402),
  },
});

/** A retraction of `target` (RFC 0003), as a reader's `retracted` set sees it. */
export const retractedSet = (...ids: string[]): { has(id: string): boolean } => new Set(ids);
