/**
 * ` · kept from draft #N` (RFC 0036 rule 3, the reference's #452): since its tag v1.2.0 the reference's
 * `show` says, after a line kept from a draft (`extra.from` naming a line of kind `draft`), which draft
 * it was kept from, and `, superseded by #M` or `, retracted` when that draft no longer stands. Each
 * case is a small synthetic Saturday in Oslo; `expected` is the reference's `show` of the day at
 * 55c6fbd, its location rows left out, captured by running it, never edited by hand. Read here under
 * the rfc0036 flag, as the draft rows are.
 */

import type { Draft } from "./helpers.js";

export const DAY = "2026-06-13";

const id = (seq: number): string => `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;

const location = (at: string): Draft => ({
  at,
  source: "sim-phone",
  kind: "location",
  tier: 1,
  payload: { schema: "location/v1", lat: 59.911, lon: 10.75, accuracy_m: 12 },
});

const draft = (at: string, fields: Record<string, unknown> = {}): Draft => ({
  at,
  source: "model:qwen2.5-7b-instruct",
  kind: "draft",
  payload: {
    schema: "draft/v1",
    unit: "day",
    subject: DAY,
    read_head: "b".repeat(64),
    read_count: 2,
    language: "en",
    segments: [{ text: "A day at the pontoon.", evidence: [id(1)] }],
    ...fields,
  },
});

const note = (at: string, text: string, extra: Record<string, unknown>): Draft => ({
  at,
  source: "manual",
  kind: "note",
  payload: { schema: "note/v1", text, labels: ["learned"], extra },
});

const retraction = (at: string, seq: number): Draft => ({
  at,
  source: "manual",
  kind: "retraction",
  payload: { schema: "retraction/v1", supersedes: id(seq), seq, reason: "wrong" },
});

const MODEL =
  "  21:00  draft      model:qwen2.5-7b-instruct draft of day 2026-06-13 · 2 lines read at bbbbbbbb · 1 segment";
const SUPERSEDING = `${MODEL.replace("21:00", "21:10")} · supersedes an earlier draft`;

/** A case: its name, its record in seq order, and the rows the reference's `show` prints but the track's. */
export const KEPT_CASES: Array<[string, Draft[], string[]]> = [
  [
    "kept from the standing draft",
    [
      location(`${DAY}T05:30:00Z`),
      location(`${DAY}T06:30:00Z`),
      draft(`${DAY}T19:00:00Z`),
      note(`${DAY}T19:30:00Z`, "kept A", { from: id(3) }),
    ],
    [MODEL, "  21:30  note       manual         kept A · kept from draft #3"],
  ],
  [
    "kept from a draft a later one supersedes",
    [
      location(`${DAY}T05:30:00Z`),
      draft(`${DAY}T19:00:00Z`),
      draft(`${DAY}T19:10:00Z`, { supersedes: id(2) }),
      note(`${DAY}T19:30:00Z`, "from A", { from: id(2) }),
      note(`${DAY}T19:31:00Z`, "from B", { from: id(3) }),
    ],
    [
      MODEL,
      SUPERSEDING,
      "  21:30  note       manual         from A · kept from draft #2, superseded by #3",
      "  21:31  note       manual         from B · kept from draft #3",
    ],
  ],
  [
    "the draft that supersedes it, not the latest of the chain",
    [
      location(`${DAY}T05:30:00Z`),
      draft(`${DAY}T19:00:00Z`),
      draft(`${DAY}T19:10:00Z`, { supersedes: id(2) }),
      draft(`${DAY}T19:20:00Z`, { supersedes: id(3) }),
      note(`${DAY}T19:30:00Z`, "from A", { from: id(2) }),
    ],
    [
      MODEL,
      SUPERSEDING,
      SUPERSEDING.replace("21:10", "21:20"),
      "  21:30  note       manual         from A · kept from draft #2, superseded by #3",
    ],
  ],
  [
    "two drafts supersede it: the later",
    [
      location(`${DAY}T05:30:00Z`),
      draft(`${DAY}T19:00:00Z`),
      draft(`${DAY}T19:10:00Z`, { supersedes: id(2) }),
      draft(`${DAY}T19:20:00Z`, { supersedes: id(2) }),
      note(`${DAY}T19:30:00Z`, "from A", { from: id(2) }),
    ],
    [
      MODEL,
      SUPERSEDING,
      SUPERSEDING.replace("21:10", "21:20"),
      "  21:30  note       manual         from A · kept from draft #2, superseded by #4",
    ],
  ],
  [
    "the draft retracted",
    [
      location(`${DAY}T05:30:00Z`),
      draft(`${DAY}T19:00:00Z`),
      retraction(`${DAY}T19:05:00Z`, 2),
      note(`${DAY}T19:30:00Z`, "from A", { from: id(2) }),
    ],
    [
      "  21:00  retracted #2: wrong",
      "  21:30  note       manual         from A · kept from draft #2, retracted",
    ],
  ],
  [
    "the draft retracted and superseded: retracted",
    [
      location(`${DAY}T05:30:00Z`),
      draft(`${DAY}T19:00:00Z`),
      draft(`${DAY}T19:10:00Z`, { supersedes: id(2) }),
      retraction(`${DAY}T19:15:00Z`, 2),
      note(`${DAY}T19:30:00Z`, "from A", { from: id(2) }),
    ],
    [
      "  21:00  retracted #2: wrong",
      SUPERSEDING,
      "  21:30  note       manual         from A · kept from draft #2, retracted",
    ],
  ],
  [
    "the draft that superseded it retracted: it stands again",
    [
      location(`${DAY}T05:30:00Z`),
      draft(`${DAY}T19:00:00Z`),
      draft(`${DAY}T19:10:00Z`, { supersedes: id(2) }),
      retraction(`${DAY}T19:15:00Z`, 3),
      note(`${DAY}T19:30:00Z`, "from A", { from: id(2) }),
    ],
    [
      MODEL,
      "  21:10  retracted #3: wrong",
      "  21:30  note       manual         from A · kept from draft #2",
    ],
  ],
  [
    "a later draft that names nothing supersedes nothing",
    [
      location(`${DAY}T05:30:00Z`),
      draft(`${DAY}T19:00:00Z`),
      draft(`${DAY}T19:10:00Z`),
      note(`${DAY}T19:30:00Z`, "from A", { from: id(2) }),
    ],
    [
      MODEL,
      MODEL.replace("21:00", "21:10"),
      "  21:30  note       manual         from A · kept from draft #2",
    ],
  ],
  [
    "superseded by a note: not a draft",
    [
      location(`${DAY}T05:30:00Z`),
      draft(`${DAY}T19:00:00Z`),
      note(`${DAY}T19:10:00Z`, "a note that supersedes", { supersedes: id(2) }),
      note(`${DAY}T19:30:00Z`, "from A", { from: id(2) }),
    ],
    [
      MODEL,
      "  21:10  note       manual         a note that supersedes",
      "  21:30  note       manual         from A · kept from draft #2",
    ],
  ],
  [
    "superseded by a draft of another day",
    [
      location(`${DAY}T05:30:00Z`),
      draft(`${DAY}T19:00:00Z`),
      draft(`${DAY}T19:10:00Z`, { supersedes: id(2), subject: "2026-06-12" }),
      note(`${DAY}T19:30:00Z`, "from A", { from: id(2) }),
    ],
    [
      MODEL,
      "  21:10  draft      model:qwen2.5-7b-instruct draft of day 2026-06-12 · 2 lines read at bbbbbbbb · 1 segment · supersedes an earlier draft",
      "  21:30  note       manual         from A · kept from draft #2, superseded by #3",
    ],
  ],
  [
    "the draft's kind counts, not its schema",
    [
      location(`${DAY}T05:30:00Z`),
      draft(`${DAY}T19:00:00Z`, { schema: "x/v1" }),
      note(`${DAY}T19:30:00Z`, "from A", { from: id(2) }),
    ],
    [
      "  21:00  draft      model:qwen2.5-7b-instruct language=en, read_count=2, read_head=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, segments=[{'evidence': ['00000000-0000-4000-8000-000000000001'], 'text': 'A day at the pontoon.'}], subject=2026-06-13, unit=day",
      "  21:30  note       manual         from A · kept from draft #2",
    ],
  ],
  [
    "a draft/v1 payload of another kind is no draft",
    [
      location(`${DAY}T05:30:00Z`),
      { ...draft(`${DAY}T19:00:00Z`), kind: "note" },
      note(`${DAY}T19:30:00Z`, "from A", { from: id(2) }),
    ],
    ["  21:00  note       model:qwen2.5-7b-instruct ", "  21:30  note       manual         from A"],
  ],
  [
    "a draft of another day, later in the file",
    [
      location(`${DAY}T05:30:00Z`),
      note(`${DAY}T19:30:00Z`, "before its draft", { from: id(3) }),
      draft(`${DAY}T19:00:00Z`, { subject: "2026-06-12" }),
    ],
    [
      "  21:00  draft      model:qwen2.5-7b-instruct draft of day 2026-06-12 · 2 lines read at bbbbbbbb · 1 segment",
      "  21:30  note       manual         before its draft · kept from draft #3",
    ],
  ],
  [
    "from names no line, a location, a number, nothing",
    [
      location(`${DAY}T05:30:00Z`),
      draft(`${DAY}T19:00:00Z`),
      note(`${DAY}T19:30:00Z`, "from nowhere", { from: id(99) }),
      note(`${DAY}T19:31:00Z`, "from a location", { from: id(1) }),
      note(`${DAY}T19:32:00Z`, "from 2", { from: 2 }),
      note(`${DAY}T19:33:00Z`, "empty from", { from: "" }),
      {
        at: `${DAY}T19:34:00Z`,
        source: "manual",
        kind: "note",
        payload: { schema: "note/v1", text: "from outside extra", from: id(2) },
      },
    ],
    [
      MODEL,
      "  21:30  note       manual         from nowhere",
      "  21:31  note       manual         from a location",
      "  21:32  note       manual         from 2",
      "  21:33  note       manual         empty from",
      "  21:34  note       manual         from outside extra",
    ],
  ],
  [
    "any kind kept: an event, a resolution, a mail",
    [
      location(`${DAY}T05:30:00Z`),
      draft(`${DAY}T19:00:00Z`),
      {
        at: `${DAY}T10:00:00Z`,
        end: `${DAY}T11:00:00Z`,
        source: "manual",
        kind: "event",
        payload: { schema: "event/v1", title: "Sail", extra: { from: id(2) } },
      },
      {
        at: `${DAY}T19:40:00Z`,
        source: "manual",
        kind: "resolution",
        payload: {
          schema: "resolution/v1",
          ref: { kind: "email", value: "ola@example.org" },
          entity: { type: "person", id: id(77), registry: "logbook" },
          label: "Ola Nordmann",
          method: "manual",
          extra: { from: id(2) },
        },
      },
      {
        at: `${DAY}T19:30:00Z`,
        source: "mail",
        kind: "mail",
        payload: {
          schema: "mail/v1",
          raw_id: "a",
          direction: "received",
          from: { email: "x@example.org" },
          subject: "S",
          thread: "t",
          extra: { from: id(2) },
        },
      },
    ],
    [
      "  12:00  event      manual         Sail · kept from draft #2",
      MODEL,
      "  21:30  mail       mail           ✉ S — x@example.org · kept from draft #2",
      "  21:40  resolution manual         entity={'id': '00000000-0000-4000-8000-000000000077', 'registry': 'logbook', 'type': 'person'}, extra={'from': '00000000-0000-4000-8000-000000000002'}, label=Ola Nordmann, method=manual, ref={'kind': 'email', 'value': 'ola@example.org'} · kept from draft #2",
    ],
  ],
  [
    "a kept line retracted is the retraction's row",
    [
      location(`${DAY}T05:30:00Z`),
      draft(`${DAY}T19:00:00Z`),
      note(`${DAY}T19:30:00Z`, "kept then retracted", { from: id(2) }),
      retraction(`${DAY}T19:40:00Z`, 3),
    ],
    [MODEL, "  21:30  retracted #3: wrong"],
  ],
  [
    "a kept line a flight supersedes is the flight's row",
    [
      location(`${DAY}T05:30:00Z`),
      draft(`${DAY}T19:00:00Z`),
      {
        at: `${DAY}T10:00:00Z`,
        end: `${DAY}T11:00:00Z`,
        source: "manual",
        kind: "event",
        payload: { schema: "event/v1", title: "Fly", extra: { from: id(2) } },
      },
      {
        at: `${DAY}T10:00:00Z`,
        end: `${DAY}T11:00:00Z`,
        source: "derive",
        kind: "flight",
        payload: { schema: "flight/v1", from: "OSL", to: "BGO", supersedes: id(3) },
      },
    ],
    [
      "  12:00  event      manual         superseded by #4",
      "  12:00  flight     derive         →",
      MODEL,
    ],
  ],
];

/** The rows of a `show` text the cases hold: every row but the heading and the track's. */
export const keptRows = (text: string): string[] =>
  text
    .split("\n")
    .slice(1)
    .filter((row) => row !== "" && !row.includes("location   sim-phone"));
