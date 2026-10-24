/**
 * Lines the reference's writers write since its main of 21 October that no reader here was changed
 * for: the keep-and-sign notes of `day sign --keep`, `--word` and `--done` (its #374; `note/v1`
 * labelled `task`, `learned`, `idea`, `decision`, `word`, `intention`, with `extra.from`,
 * `extra.segment`, `extra.proposal`, `extra.revisit` and `extra.entity` as docs/signed-day.md, *Keep
 * and sign*, writes them), and a mail line with Gmail's tab and the list headers (RFC 0015's amendment
 * of 2026-10-20, its #341). A synthetic Saturday in Oslo; tests/cross-impl.test.ts holds `show`, the
 * Day, `days` and `people` of both implementations alike on it.
 */

import type { Draft } from "./helpers.js";

export const DAY = "2026-06-13";

const lineId = (seq: number): string => `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;

const location = (at: string): Draft => ({
  at,
  source: "sim-phone",
  kind: "location",
  tier: 1,
  payload: { schema: "location/v1", lat: 59.911, lon: 10.75, accuracy_m: 12 },
});

function note(at: string, text: string, label: string, extra: Record<string, unknown>): Draft {
  return {
    at,
    source: "manual",
    kind: "note",
    payload: { schema: "note/v1", text, labels: [label], extra },
  };
}

/** The record, in seq order: the track, a draft, what was kept of it and the day's answers, a mail. */
export function octoberRecord(): Draft[] {
  const draft = lineId(3);
  return [
    location("2026-06-13T05:30:00Z"),
    location("2026-06-13T20:30:00Z"),
    {
      at: "2026-06-13T19:00:00Z",
      source: "model:qwen2.5-7b-instruct",
      kind: "draft",
      payload: {
        schema: "draft/v1",
        unit: "day",
        subject: DAY,
        read_head: "b".repeat(64),
        read_count: 2,
        language: "en",
        segments: [{ text: "A day at the pontoon.", evidence: [lineId(1)] }],
      },
    },
    note("2026-06-13T19:30:00Z", "The new reefing lines run cleanly.", "learned", {
      from: draft,
      segment: { part: "learned", n: 1 },
      proposal: { part: "learned", text: "The new reefing lines run cleanly." },
    }),
    note("2026-06-13T19:31:00Z", "Haul out in October, not November.", "decision", {
      from: draft,
      segment: { part: "decision", n: 1 },
      proposal: { part: "decision", text: "Haul out in October, not November." },
      revisit: "2026-09-01",
    }),
    note("2026-06-13T19:32:00Z", "The winter refit moved on.", "idea", {
      from: draft,
      entity: "019cadd3-6bc0-7dcd-9133-000000000aaa",
    }),
    note("2026-06-13T19:33:00Z", "calm", "word", {}),
    note("2026-06-13T19:34:00Z", "Order the new fenders", "task", {
      row: "notion:0123",
      answer: "done",
    }),
    note("2026-06-13T19:35:00Z", "Sail on Sunday if the wind holds.", "intention", {}),
    {
      at: "2026-06-13T12:00:00Z",
      source: "mail",
      kind: "mail",
      payload: {
        schema: "mail/v1",
        raw_id: "a:1",
        direction: "received",
        from: { email: "letters@example.org", name: "Harbour letters" },
        to: [{ email: "ines.nordmann@example.org" }],
        subject: "This week at the harbour",
        thread: "t1",
        labels: ["Category Promotions"],
        extra: {
          gmail_category: "promotions",
          list: { unsubscribe: true, one_click: true, id: "letters.example.org" },
        },
      },
    },
  ];
}
