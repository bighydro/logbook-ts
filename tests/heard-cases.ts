/**
 * RFC 0046, `heard/v1` (draft, 2026-10-21): the words of a podcast episode or a video the owner
 * played, one line beside the listen or watch it belongs to. The payloads tests/heard.test.ts holds
 * `show`'s row to, each with the summary the reference prints for it at d053f78 (its output, run on
 * a record of these lines, never edited by hand), and the record tests/cross-impl.test.ts runs the
 * reference on.
 */

import type { JsonValue, Payload } from "../src/types.js";
import type { Draft } from "./helpers.js";

const lineId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** The RFC's §4 line for an episode of a feed, its text in the store by digest. */
export const HEARD: Payload = {
  schema: "heard/v1",
  raw_id: "heard:feed:0123456789abcdef",
  of: lineId(2),
  of_kind: "listen",
  media: "episode",
  title: "Anchors that hold",
  by: "The Harbour Hour",
  text_source: "feed",
  language: "en",
  text: {
    sha256: "a".repeat(64),
    path: `attachments/${"a".repeat(64)}`,
    bytes: 4100,
    media_type: "text/vtt",
  },
  format: "vtt",
  chars: 3900,
  words: 700,
};

/** The payload with these fields set, or removed where the value is undefined. */
export function heardWith(fields: Record<string, JsonValue | undefined>): Payload {
  const p: Record<string, JsonValue> = { ...HEARD };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) delete p[key];
    else p[key] = value;
  }
  return p as Payload;
}

/** Each payload change and the summary the reference prints for it. */
export const HEARD_ROWS: Array<[Record<string, JsonValue | undefined>, string]> = [
  [{}, "Anchors that hold — The Harbour Hour · feed · en · 700 words"],
  [{ by: undefined }, "Anchors that hold · feed · en · 700 words"],
  [{ by: "" }, "Anchors that hold · feed · en · 700 words"],
  [{ by: 5 }, "Anchors that hold · feed · en · 700 words"],
  [{ by: ["x"] }, "Anchors that hold · feed · en · 700 words"],
  [{ by: "   " }, "Anchors that hold —     · feed · en · 700 words"],
  [{ title: "  pad  ", by: "  b  " }, "  pad   —   b   · feed · en · 700 words"],
  [{ title: undefined }, " — The Harbour Hour · feed · en · 700 words"],
  [{ title: "" }, " — The Harbour Hour · feed · en · 700 words"],
  [{ title: 5 }, "5 — The Harbour Hour · feed · en · 700 words"],
  [{ title: true }, "True — The Harbour Hour · feed · en · 700 words"],
  [{ title: ["a"] }, "['a'] — The Harbour Hour · feed · en · 700 words"],
  [{ title: null }, " — The Harbour Hour · feed · en · 700 words"],
  [{ title: false }, " — The Harbour Hour · feed · en · 700 words"],
  [{ title: 0 }, " — The Harbour Hour · feed · en · 700 words"],
  [{ title: [] }, " — The Harbour Hour · feed · en · 700 words"],
  [{ title: {} }, " — The Harbour Hour · feed · en · 700 words"],
  [{ text_source: undefined }, "Anchors that hold — The Harbour Hour · ? · en · 700 words"],
  [{ text_source: "" }, "Anchors that hold — The Harbour Hour · ? · en · 700 words"],
  [{ text_source: false }, "Anchors that hold — The Harbour Hour · ? · en · 700 words"],
  [{ text_source: " " }, "Anchors that hold — The Harbour Hour ·   · en · 700 words"],
  [{ text_source: 5 }, "Anchors that hold — The Harbour Hour · 5 · en · 700 words"],
  [{ language: undefined }, "Anchors that hold — The Harbour Hour · feed · und · 700 words"],
  [{ language: "" }, "Anchors that hold — The Harbour Hour · feed · und · 700 words"],
  [{ language: 0 }, "Anchors that hold — The Harbour Hour · feed · und · 700 words"],
  [{ language: 5 }, "Anchors that hold — The Harbour Hour · feed · 5 · 700 words"],
  [
    { by: "", language: "und", text_source: "captions", media: "video", of_kind: "watch" },
    "Anchors that hold · captions · und · 700 words",
  ],
  [{ words: 1 }, "Anchors that hold — The Harbour Hour · feed · en · 1 word"],
  [{ words: 0 }, "Anchors that hold — The Harbour Hour · feed · en · 0 words"],
  [{ words: 999 }, "Anchors that hold — The Harbour Hour · feed · en · 999 words"],
  [{ words: 7012 }, "Anchors that hold — The Harbour Hour · feed · en · 7,012 words"],
  [{ words: 1234567 }, "Anchors that hold — The Harbour Hour · feed · en · 1,234,567 words"],
  [{ words: 2.0 }, "Anchors that hold — The Harbour Hour · feed · en · 2 words"],
  [{ words: 1000.0 }, "Anchors that hold — The Harbour Hour · feed · en · 1,000 words"],
  [
    { words: 1e20 },
    "Anchors that hold — The Harbour Hour · feed · en · 100,000,000,000,000,000,000 words",
  ],
  [{ words: undefined }, "Anchors that hold — The Harbour Hour · feed · en · 0 words"],
  [{ words: 3.5 }, "Anchors that hold — The Harbour Hour · feed · en · 0 words"],
  [{ words: -5 }, "Anchors that hold — The Harbour Hour · feed · en · 0 words"],
  [{ words: -0.0 }, "Anchors that hold — The Harbour Hour · feed · en · 0 words"],
  [{ words: true }, "Anchors that hold — The Harbour Hour · feed · en · 0 words"],
  [{ words: "12" }, "Anchors that hold — The Harbour Hour · feed · en · 0 words"],
];

/** A record of one day, a location, a listen and a heard line of each payload of `HEARD_ROWS`, in their order. */
export function heardDay(): Draft[] {
  const location: Draft = {
    at: "2026-06-13T05:30:00Z",
    source: "sim-phone",
    kind: "location",
    tier: 1,
    payload: { schema: "location/v1", lat: 59.911, lon: 10.75, accuracy_m: 12 },
  };
  const listen: Draft = {
    at: "2026-06-13T06:40:00Z",
    end: "2026-06-13T07:20:00Z",
    source: "apple-podcasts",
    kind: "listen",
    payload: {
      schema: "listen/v1",
      raw_id: "ap:1",
      media: "episode",
      title: "Anchors that hold",
      show: "The Harbour Hour",
      service: "apple-podcasts",
      duration_s: 2400,
      played_s: 2400,
    },
  };
  return [location, listen, ...HEARD_ROWS.map(([fields]) => heardLine(heardWith(fields)))];
}

/** A heard line of this payload, at the listen's moment, as RFC 0046 §4 places it. */
export const heardLine = (payload: Payload): Draft => ({
  at: "2026-06-13T06:40:00Z",
  end: "2026-06-13T07:20:00Z",
  source: "heard",
  kind: "heard",
  payload,
});
