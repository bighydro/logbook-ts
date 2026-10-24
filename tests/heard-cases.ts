/**
 * `heard/v1` (RFC 0046, *What you heard*, draft, 2026-10-21): the words of a podcast episode or a video
 * the owner played, one line beside the listen or watch it belongs to. `show` prints its row since the
 * reference's #355. `HEARD_CASES` are payloads of the RFC's example line with one field changed, and
 * `expected` is the row the reference's `show` prints for each at its main of a6ee131, captured by
 * running it on a record of them (each line at its own minute of 3 October 2026), never edited by
 * hand. A person in Oslo who does not exist; the show and the episode are made up.
 */

import type { Draft } from "./helpers.js";

/** The RFC's example payload (rfcs/0046-what-you-heard.md, the line), its text a placeholder. */
export const HEARD: Record<string, unknown> = {
  schema: "heard/v1",
  raw_id: "heard:feed:x",
  of: "00000000-0000-4000-8000-000000000001",
  of_kind: "listen",
  media: "episode",
  title: "Episode 12: the east berth",
  by: "Havnepodden",
  text_source: "feed",
  language: "nb",
  format: "vtt",
  chars: 41237,
  words: 7012,
  text: {
    sha256: "a".repeat(64),
    path: `attachments/${"a".repeat(64)}`,
    bytes: 52811,
    media_type: "text/vtt",
  },
};

/** A case: its name, the fields changed (undefined removes one) and the row the reference prints. */
export const HEARD_CASES: Array<[string, Record<string, unknown>, string]> = [
  ["base", {}, "Episode 12: the east berth — Havnepodden · feed · nb · 7,012 words"],
  ["no by", { by: undefined }, "Episode 12: the east berth · feed · nb · 7,012 words"],
  ["by empty", { by: "" }, "Episode 12: the east berth · feed · nb · 7,012 words"],
  ["by blank", { by: "  " }, "Episode 12: the east berth —    · feed · nb · 7,012 words"],
  ["by number", { by: 5 }, "Episode 12: the east berth · feed · nb · 7,012 words"],
  ["by null", { by: null }, "Episode 12: the east berth · feed · nb · 7,012 words"],
  ["title empty", { title: "" }, " — Havnepodden · feed · nb · 7,012 words"],
  ["title none", { title: undefined }, " — Havnepodden · feed · nb · 7,012 words"],
  ["title null", { title: null }, " — Havnepodden · feed · nb · 7,012 words"],
  ["title false", { title: false }, " — Havnepodden · feed · nb · 7,012 words"],
  ["title 0", { title: 0 }, " — Havnepodden · feed · nb · 7,012 words"],
  ["title list", { title: [] }, " — Havnepodden · feed · nb · 7,012 words"],
  ["title obj", { title: {} }, " — Havnepodden · feed · nb · 7,012 words"],
  ["title number", { title: 12 }, "12 — Havnepodden · feed · nb · 7,012 words"],
  ["title padded", { title: "  Ep  " }, "  Ep   — Havnepodden · feed · nb · 7,012 words"],
  ["title newline", { title: "a\nb" }, "a\nb — Havnepodden · feed · nb · 7,012 words"],
  [
    "source none",
    { text_source: undefined },
    "Episode 12: the east berth — Havnepodden · ? · nb · 7,012 words",
  ],
  [
    "source other",
    { text_source: "local" },
    "Episode 12: the east berth — Havnepodden · local · nb · 7,012 words",
  ],
  [
    "source number",
    { text_source: 3 },
    "Episode 12: the east berth — Havnepodden · 3 · nb · 7,012 words",
  ],
  [
    "source empty",
    { text_source: "" },
    "Episode 12: the east berth — Havnepodden · ? · nb · 7,012 words",
  ],
  [
    "lang none",
    { language: undefined },
    "Episode 12: the east berth — Havnepodden · feed · und · 7,012 words",
  ],
  [
    "lang empty",
    { language: "" },
    "Episode 12: the east berth — Havnepodden · feed · und · 7,012 words",
  ],
  [
    "lang number",
    { language: 5 },
    "Episode 12: the east berth — Havnepodden · feed · 5 · 7,012 words",
  ],
  ["words 1", { words: 1 }, "Episode 12: the east berth — Havnepodden · feed · nb · 1 word"],
  ["words 0", { words: 0 }, "Episode 12: the east berth — Havnepodden · feed · nb · 0 words"],
  [
    "words none",
    { words: undefined },
    "Episode 12: the east berth — Havnepodden · feed · nb · 0 words",
  ],
  [
    "words float whole",
    { words: 1000.0 },
    "Episode 12: the east berth — Havnepodden · feed · nb · 1,000 words",
  ],
  [
    "words float",
    { words: 12.5 },
    "Episode 12: the east berth — Havnepodden · feed · nb · 0 words",
  ],
  ["words neg", { words: -3 }, "Episode 12: the east berth — Havnepodden · feed · nb · 0 words"],
  [
    "words string",
    { words: "12" },
    "Episode 12: the east berth — Havnepodden · feed · nb · 0 words",
  ],
  ["words bool", { words: true }, "Episode 12: the east berth — Havnepodden · feed · nb · 0 words"],
  [
    "words big",
    { words: 1234567 },
    "Episode 12: the east berth — Havnepodden · feed · nb · 1,234,567 words",
  ],
  ["by list", { by: ["x"] }, "Episode 12: the east berth · feed · nb · 7,012 words"],
  ["by with dash", { by: "A — B" }, "Episode 12: the east berth — A — B · feed · nb · 7,012 words"],
];

/** The case's payload. */
export function heardPayload(changes: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = { ...HEARD };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete p[key];
    else p[key] = value;
  }
  return p;
}

/** One line per case, ten minutes apart from 06:00Z on 3 October 2026, in the cases' order. */
export const heardLines = (): Draft[] =>
  HEARD_CASES.map(([, changes], i) => ({
    at: `2026-10-03T${String(6 + Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")}:00Z`,
    source: "heard",
    kind: "heard",
    payload: heardPayload(changes),
  }));
