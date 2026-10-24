/**
 * The owner's marks as the reference reads them at b82a11c (0.7.0): stars (RFC 0041, `star/v1`),
 * the keeper's note and `supersedes` (RFC 0024's amendment of 2026-10-14), and the owner's no on a
 * scene (RFC 0040 §5, `scene-review/v1`). Synthetic records of Ines Nordmann's Saturday, 3 October
 * 2026, at home in Oslo; `expected` is the reference's output on each record, captured by running
 * it and never edited by hand. Read by tests/marks.test.ts and, against the reference itself, by
 * tests/cross-impl.test.ts.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { eachLine, monthFiles, parseLine } from "../src/lines.js";
import { pageDigest, pageOf } from "../src/signing.js";
import type { Line } from "../src/types.js";
import { type Draft, writeBareRecord } from "./helpers.js";

/** Every line of a record, in file order. */
function readAll(root: string): Line[] {
  const lines: Line[] = [];
  for (const month of monthFiles(root))
    for (const { raw, row } of eachLine(month.file)) {
      const parsed = parseLine(raw, `${month.rel} line ${row}`);
      if (!("error" in parsed)) lines.push(parsed.line);
    }
  return lines;
}

/** The id `writeBareRecord` gives the line of this seq. */
export const lineId = (seq: number): string =>
  `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;

/** `owner_id` of the records `writeBareRecord` writes. */
const OWNER = "00000000-0000-4000-8000-000000000002";
export const DAY = "2026-10-03";
export const PLACES = {
  Home: { lat: 59.9139, lon: 10.7522, radius_m: 120, kind: "home", country: "NO" },
};

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
const H = home.length;

const event = (title: string): Draft => ({
  at: "2026-10-03T16:00:00Z",
  end: "2026-10-03T18:00:00Z",
  source: "sim-cal",
  kind: "event",
  tier: 1,
  payload: { schema: "event/v1", title, raw_id: title },
});
const note = (text: string, at = "2026-10-03T16:30:00Z"): Draft => ({
  at,
  source: "manual",
  kind: "note",
  payload: { schema: "note/v1", text },
});
const star = (
  seq: number,
  kind: string,
  at: string,
  tier: 1 | 2 | 3 = 1,
  more: Record<string, unknown> = {},
): Draft => ({
  at,
  source: "manual",
  kind: "star",
  tier,
  payload: { schema: "star/v1", line: lineId(seq), kind, ...more },
});
const photo = (file: string, asset: string, at = "2026-10-03T16:40:00Z"): Draft => ({
  at,
  source: "immich",
  kind: "photo",
  tier: 1,
  payload: {
    schema: "photo/v1",
    asset_id: asset,
    file_name: file,
    library: "immich",
    raw_id: asset,
  },
});
const keeper = (
  seq: number,
  file: string,
  asset: string,
  more: Record<string, unknown> = {},
): Draft => ({
  at: "2026-10-03T16:40:00Z",
  source: "manual",
  kind: "keeper",
  tier: 1,
  payload: {
    schema: "keeper/v1",
    lane: "memory",
    photo: { asset_id: asset, file_name: file, library: "immich", line: lineId(seq) },
    source: "manual",
    ...more,
  },
});
const retraction = (seq: number, tier: 1 | 2 | 3 = 1): Draft => ({
  at: "2026-10-05T08:00:00Z",
  source: "manual",
  kind: "retraction",
  tier,
  payload: { schema: "retraction/v1", supersedes: lineId(seq), seq, reason: "unstarred" },
});

const transcript = (title: string, at: string): Draft => ({
  at,
  source: "granola",
  kind: "transcript",
  payload: { schema: "transcript/v1", title, text: "x" },
});
const mail = (subject: string, at: string, thread: string): Draft => ({
  at,
  source: "mail",
  kind: "mail",
  payload: {
    schema: "mail/v1",
    direction: "received",
    from: { email: "ola@example.org", name: "Ola" },
    subject,
    thread,
    raw_id: subject,
  },
});
const call: Draft = {
  at: "2026-10-03T16:25:00Z",
  source: "phone",
  kind: "call",
  tier: 1,
  payload: {
    schema: "call/v1",
    counterparty: { kind: "phone", value: "+447700900123" },
    direction: "outgoing",
    duration_s: 60,
    answered: true,
    raw_id: "c1",
  },
};
const allDay: Draft = {
  at: "2026-10-02T22:00:00Z",
  end: "2026-10-03T22:00:00Z",
  source: "sim-cal",
  kind: "event",
  tier: 1,
  payload: { schema: "event/v1", title: "Fridag", all_day: true, raw_id: "Fridag" },
};
const flight: Draft = {
  at: "2026-10-03T06:10:00Z",
  end: "2026-10-03T07:05:00Z",
  source: "manual",
  kind: "flight",
  tier: 1,
  payload: {
    schema: "flight/v1",
    carrier: "XY",
    number: "123",
    date: "2026-10-03",
    evidence: "declared",
    from: { iata: "OSL" },
    to: { iata: "BGO" },
    actual_departure: "2026-10-03T06:10:00Z",
    actual_arrival: "2026-10-03T07:05:00Z",
    raw_id: "f",
  },
};

const VIDEO = "019cadd3-6bc0-7dcd-9133-0000000005a0";
const DRAFT = "019cadd3-6bc0-7dcd-9133-0000000005b4";
const sceneNo = (
  ref: string,
  scene: Record<string, unknown> | undefined,
  proposal: unknown,
  more: Record<string, unknown> = {},
): Draft => ({
  at: "2026-10-03T18:04:40Z",
  source: "manual",
  kind: "scene-review",
  tier: 2,
  payload: {
    schema: "scene-review/v1",
    ref: { kind: "scene", value: ref },
    ...(scene === undefined ? {} : { scene }),
    verdict: "different",
    proposal: proposal as never,
    draft: DRAFT,
    method: "owner",
    ...more,
  },
});
const place = (id: string, label?: string) => ({
  type: "place",
  id,
  registry: "logbook",
  ...(label === undefined ? {} : { label }),
});
const when = (from: string, to: string, precision: string) => ({ from, to, precision });
const scene = (start: unknown, end: unknown) => ({ video: VIDEO, start_s: start, end_s: end });

/** What the reference prints for one record. */
export interface MarksExpected {
  /** `show <day>`, as the reference prints it. */
  show: string;
  /** `day <day>`, as the reference prints it, readiness and all. */
  day: string;
  /** `stars` of `day <day> --json`; null when the Day has none. */
  stars: unknown;
}

export interface MarksCase {
  name: string;
  lines: Draft[];
  places?: boolean;
  /** The owner signs the day at 22:00 over its page as it stands, these lines (by seq) confirmed and disposed. */
  sign?: { confirmed: number[]; dispositions: Record<number, string> };
  expected: MarksExpected;
}

export const MARKS_CASES: MarksCase[] = [
  {
    name: "a star on an event and on a note; a photo's star is its keeper, with its note",
    lines: [
      ...home,
      event("Middag"),
      note("god mat"),
      photo("IMG_1003.HEIC", "p-1"),
      keeper(H + 3, "IMG_1003.HEIC", "p-1", { note: "the table by the river" }),
      star(H + 1, "event", "2026-10-03T16:00:00Z", 1, { note: "the table by the river" }),
      star(H + 2, "note", "2026-10-03T16:30:00Z", 2),
    ],
    places: true,
    expected: {
      show: "2026-10-03  unsigned\n  hero  IMG_1003.HEIC\n  16:00–18:00  location   sim-phone      7 points\n  18:00  event      sim-cal        Middag\n  18:00  star       manual         ★ event 00000000… · the table by the river\n  18:20  location   sim-phone      1 point\n  18:30  note       manual         god mat\n  18:30  star       manual         ★ note 00000000…\n  18:40  location   sim-phone      1 point\n  18:40  photo      immich         asset_id=p-1, file_name=IMG_1003.HEIC, library=immich, raw_id=p-1\n  18:40  keeper     manual         hero photo (memory): IMG_1003.HEIC · the table by the river\n  19:00–22:40  location   sim-phone      12 points\n",
      day: "2026-10-03  Saturday · unsigned\n  night before  in transit\n  night after   Home · home\n  country       NO (place Home)\n\n  16:00–22:40  stay   Home · 6 h 40 min · 1 event, 1 note, 1 photo, 1 keeper\n      event        ★ Middag 18:00–20:00\n      note         ★ god mat\n      keeper       IMG_1003.HEIC (memory)\n\n  health        no lines\n  sources       sim-phone 21 lines, last 22:40 · manual 4 lines, last 18:40 · immich 1 line, last 18:40 · sim-cal 1 line, last 18:00\n  readiness     mail none · message none · meeting none · location present · photo present · calendar present\n",
      stars: [
        {
          line: "00000000-0000-4000-8000-000000000022",
          star: "00000000-0000-4000-8000-000000000026",
          kind: "event",
          note: "the table by the river",
        },
        {
          line: "00000000-0000-4000-8000-000000000023",
          star: "00000000-0000-4000-8000-000000000027",
          kind: "note",
          note: null,
        },
      ],
    },
  },
  {
    name: "a star given a new note supersedes the first; a star retracted stars nothing",
    lines: [
      ...home,
      event("Middag"),
      note("god mat"),
      star(H + 1, "event", "2026-10-03T16:00:00Z", 1, { note: "first" }),
      star(H + 1, "event", "2026-10-03T16:00:00Z", 1, {
        note: "second",
        supersedes: lineId(H + 3),
      }),
      star(H + 2, "note", "2026-10-03T16:30:00Z", 2, { note: "gone" }),
      retraction(H + 5, 2),
    ],
    places: true,
    expected: {
      show: "2026-10-03  unsigned\n  16:00–18:00  location   sim-phone      7 points\n  18:00  event      sim-cal        Middag\n  18:00  star       manual         ★ event 00000000… · first\n  18:00  star       manual         ★ event 00000000… · second\n  18:20  location   sim-phone      1 point\n  18:30  note       manual         god mat\n  18:30  retracted #26: unstarred\n  18:40–22:40  location   sim-phone      13 points\n",
      day: "2026-10-03  Saturday · unsigned\n  night before  in transit\n  night after   Home · home\n  country       NO (place Home)\n\n  16:00–22:40  stay   Home · 6 h 40 min · 1 event, 1 note\n      event        ★ Middag 18:00–20:00\n      note         god mat\n\n  health        no lines\n  sources       sim-phone 21 lines, last 22:40 · manual 3 lines, last 18:30 · sim-cal 1 line, last 18:00\n  readiness     mail none · message none · meeting none · location present · photo none · calendar present\n",
      stars: [
        {
          line: "00000000-0000-4000-8000-000000000022",
          star: "00000000-0000-4000-8000-000000000025",
          kind: "event",
          note: "second",
        },
      ],
    },
  },
  {
    name: "a star on a line retracted since, on a star, and stars that name nothing",
    lines: [
      ...home,
      note("x"),
      note("y", "2026-10-03T16:35:00Z"),
      star(H + 1, "note", "2026-10-03T16:30:00Z", 2),
      retraction(H + 1, 2),
      star(H + 2, "note", "2026-10-03T16:35:00Z", 2),
      star(H + 5, "star", "2026-10-03T16:35:00Z", 2),

      {
        at: "2026-10-03T16:30:00Z",
        source: "manual",
        kind: "star",
        tier: 2,
        payload: { schema: "star/v1", line: 5, kind: "note" },
      },
      {
        at: "2026-10-03T16:30:00Z",
        source: "manual",
        kind: "star",
        tier: 2,
        payload: { schema: "star/v1" },
      },
    ],
    places: true,
    expected: {
      show: "2026-10-03  unsigned\n  16:00–18:20  location   sim-phone      8 points\n  18:30  retracted #22: unstarred\n  18:30  star       manual         ★ note 00000000…\n  18:30  star       manual         ★ note 5…\n  18:30  star       manual         ★ ? ?…\n  18:35  note       manual         y\n  18:35  star       manual         ★ note 00000000…\n  18:35  star       manual         ★ star 00000000…\n  18:40–22:40  location   sim-phone      13 points\n",
      day: "2026-10-03  Saturday · unsigned\n  night before  in transit\n  night after   Home · home\n  country       NO (place Home)\n\n  16:00–22:40  stay   Home · 6 h 40 min · 1 note\n      note         ★ y\n\n  health        no lines\n  sources       sim-phone 21 lines, last 22:40 · manual 6 lines, last 18:35\n  readiness     mail none · message none · meeting none · location present · photo none · calendar none\n",
      stars: [
        {
          line: "00000000-0000-4000-8000-000000000023",
          star: "00000000-0000-4000-8000-000000000026",
          kind: "note",
          note: null,
        },
      ],
    },
  },
  {
    name: "★ on every row the Day lists, after a disposition, and on an unplaced line",
    lines: [
      ...home,
      event("Middag"), // H+1
      transcript("Prat", "2026-10-03T16:10:00Z"), // H+2
      mail("Båt", "2026-10-03T16:20:00Z", "t1"), // H+3
      call, // H+4
      allDay, // H+5
      flight, // H+6
      transcript("Alene", "2026-10-03T09:00:00Z"), // H+7
      mail("Ute", "2026-10-03T09:10:00Z", "t2"), // H+8
      star(H + 1, "event", "2026-10-03T16:00:00Z"),
      star(H + 2, "transcript", "2026-10-03T16:10:00Z", 2),
      star(H + 3, "mail", "2026-10-03T16:20:00Z", 2),
      star(H + 4, "call", "2026-10-03T16:25:00Z"),
      star(H + 5, "event", "2026-10-02T22:00:00Z"),
      star(H + 6, "flight", "2026-10-03T06:10:00Z"),
      star(H + 7, "transcript", "2026-10-03T09:00:00Z", 2),
      star(H + 8, "mail", "2026-10-03T09:10:00Z", 2),
    ],
    places: true,
    sign: { confirmed: [H + 1, H + 4], dispositions: { [H + 1]: "kept", [H + 4]: "missed" } },
    expected: {
      show: "2026-10-03  signed 2026-10-03 22:00\n  00:00  event      sim-cal        Fridag\n  00:00  star       manual         ★ event 00000000…\n  08:10  flight     manual         XY 123 OSL → BGO, arrives 09:05, declared\n  08:10  star       manual         ★ flight 00000000…\n  11:00  transcript granola        Alene\n  11:00  star       manual         ★ transcript 00000000…\n  11:10  mail       mail           ✉ Ute — Ola\n  11:10  star       manual         ★ mail 00000000…\n  16:00–18:00  location   sim-phone      7 points\n  18:00  event      sim-cal        Middag\n  18:00  star       manual         ★ event 00000000…\n  18:10  transcript granola        Prat\n  18:10  star       manual         ★ transcript 00000000…\n  18:20  location   sim-phone      1 point\n  18:20  mail       mail           ✉ Båt — Ola\n  18:20  star       manual         ★ mail 00000000…\n  18:25  call       phone          → +447700900123, 1 min\n  18:25  star       manual         ★ call 00000000…\n  18:40–22:00  location   sim-phone      11 points\n  22:00  signed-day manual         signed 2026-10-03: 2 lines confirmed of 37 · kept 1, missed 1\n  22:20–22:40  location   sim-phone      2 points\n",
      day: "2026-10-03  Saturday · signed 2026-10-03 22:00\n  night before  in transit\n  night after   Home · home\n  country       NO (place Home)\n  all day       ★ Fridag\n\n  08:10–09:05  flight ★ XY 123  OSL → BGO · declared\n  16:00–22:40  stay   Home · 6 h 40 min · 1 event, 1 transcript, 1 mail thread, 1 call\n      event        ✓ ★ Middag 18:00–20:00\n      transcript   ★ Prat\n      mail         ★ Båt (1 message)\n      call         ✗ ★ 1 min → +447700900123\n\n  unplaced      11:00  transcript ★ Alene\n  unplaced      11:10  mail   ★ Ute\n\n  health        no lines\n  sources       sim-phone 21 lines, last 22:40 · manual 10 lines, last 22:00 · granola 2 lines, last 18:10 · mail 2 lines, last 18:20 · sim-cal 2 lines, last 18:00 · phone 1 line, last 18:25\n  readiness     mail present · message none · meeting present · location present · photo none · calendar present\n",
      stars: [
        {
          line: "00000000-0000-4000-8000-000000000022",
          star: "00000000-0000-4000-8000-000000000030",
          kind: "event",
          note: null,
        },
        {
          line: "00000000-0000-4000-8000-000000000023",
          star: "00000000-0000-4000-8000-000000000031",
          kind: "transcript",
          note: null,
        },
        {
          line: "00000000-0000-4000-8000-000000000024",
          star: "00000000-0000-4000-8000-000000000032",
          kind: "mail",
          note: null,
        },
        {
          line: "00000000-0000-4000-8000-000000000025",
          star: "00000000-0000-4000-8000-000000000033",
          kind: "call",
          note: null,
        },
        {
          line: "00000000-0000-4000-8000-000000000026",
          star: "00000000-0000-4000-8000-000000000034",
          kind: "event",
          note: null,
        },
        {
          line: "00000000-0000-4000-8000-000000000027",
          star: "00000000-0000-4000-8000-000000000035",
          kind: "flight",
          note: null,
        },
        {
          line: "00000000-0000-4000-8000-000000000028",
          star: "00000000-0000-4000-8000-000000000036",
          kind: "transcript",
          note: null,
        },
        {
          line: "00000000-0000-4000-8000-000000000029",
          star: "00000000-0000-4000-8000-000000000037",
          kind: "mail",
          note: null,
        },
      ],
    },
  },
  {
    name: "stars written out of their lines' order, and a star on a line another supersedes",
    lines: [
      ...home,
      note("første", "2026-10-03T16:30:00Z"), // H+1
      note("andre", "2026-10-03T16:31:00Z"), // H+2
      note("tredje", "2026-10-03T16:32:00Z"), // H+3
      event("Middag"), // H+4
      {
        ...event("Middag, flyttet"),
        payload: {
          ...event("x").payload,
          title: "Middag, flyttet",
          raw_id: "flyttet",
          supersedes: lineId(H + 4),
        },
      }, // H+5
      star(H + 3, "note", "2026-10-03T16:32:00Z", 2),
      star(H + 1, "note", "2026-10-03T16:30:00Z", 2),
      star(H + 2, "note", "2026-10-03T16:31:00Z", 2),
      star(H + 4, "event", "2026-10-03T16:00:00Z"),
    ],
    places: true,
    expected: {
      show: "2026-10-03  unsigned\n  16:00–18:00  location   sim-phone      7 points\n  18:00  event      sim-cal        Middag\n  18:00  event      sim-cal        Middag, flyttet\n  18:00  star       manual         ★ event 00000000…\n  18:20  location   sim-phone      1 point\n  18:30  note       manual         første\n  18:30  star       manual         ★ note 00000000…\n  18:31  note       manual         andre\n  18:31  star       manual         ★ note 00000000…\n  18:32  note       manual         tredje\n  18:32  star       manual         ★ note 00000000…\n  18:40–22:40  location   sim-phone      13 points\n",
      day: "2026-10-03  Saturday · unsigned\n  night before  in transit\n  night after   Home · home\n  country       NO (place Home)\n\n  16:00–22:40  stay   Home · 6 h 40 min · 2 events, 3 notes\n      event        ★ Middag 18:00–20:00\n      event        Middag, flyttet 18:00–20:00\n      note         ★ første\n      note         ★ andre\n      note         ★ tredje\n\n  health        no lines\n  sources       sim-phone 21 lines, last 22:40 · manual 7 lines, last 18:32 · sim-cal 2 lines, last 18:00\n  readiness     mail none · message none · meeting none · location present · photo none · calendar present\n",
      stars: [
        {
          line: "00000000-0000-4000-8000-000000000022",
          star: "00000000-0000-4000-8000-000000000028",
          kind: "note",
          note: null,
        },
        {
          line: "00000000-0000-4000-8000-000000000023",
          star: "00000000-0000-4000-8000-000000000029",
          kind: "note",
          note: null,
        },
        {
          line: "00000000-0000-4000-8000-000000000024",
          star: "00000000-0000-4000-8000-000000000027",
          kind: "note",
          note: null,
        },
        {
          line: "00000000-0000-4000-8000-000000000025",
          star: "00000000-0000-4000-8000-000000000030",
          kind: "event",
          note: null,
        },
      ],
    },
  },
  {
    name: "a keeper superseded is no hero; a keeper whose superseder is retracted is none either",
    lines: [
      ...home,
      photo("IMG_1003.HEIC", "p-1"), // H+1
      photo("IMG_2.HEIC", "p-2", "2026-10-03T16:45:00Z"), // H+2
      keeper(H + 1, "IMG_1003.HEIC", "p-1"), // H+3
      keeper(H + 2, "IMG_2.HEIC", "p-2", { supersedes: lineId(H + 3) }), // H+4
      keeper(H + 1, "IMG_1003.HEIC", "p-1", { note: "a" }), // H+5
      keeper(H + 1, "IMG_1003.HEIC", "p-1", { note: "b", supersedes: lineId(H + 5) }), // H+6
      retraction(H + 6),
      keeper(H + 1, "IMG_1003.HEIC", "p-1"), // H+8, beside H+3: both heroes
    ],
    places: true,
    expected: {
      show: "2026-10-03  unsigned\n  hero  IMG_2.HEIC, IMG_1003.HEIC\n  16:00–18:40  location   sim-phone      9 points\n  18:40  photo      immich         asset_id=p-1, file_name=IMG_1003.HEIC, library=immich, raw_id=p-1\n  18:40  keeper     manual         hero photo (memory): IMG_1003.HEIC\n  18:40  keeper     manual         hero photo (memory): IMG_2.HEIC\n  18:40  keeper     manual         hero photo (memory): IMG_1003.HEIC · a\n  18:40  retracted #27: unstarred\n  18:40  keeper     manual         hero photo (memory): IMG_1003.HEIC\n  18:45  photo      immich         asset_id=p-2, file_name=IMG_2.HEIC, library=immich, raw_id=p-2\n  19:00–22:40  location   sim-phone      12 points\n",
      day: "2026-10-03  Saturday · unsigned\n  night before  in transit\n  night after   Home · home\n  country       NO (place Home)\n\n  16:00–22:40  stay   Home · 6 h 40 min · 2 photos, 4 keepers\n      keeper       IMG_1003.HEIC (memory)\n      keeper       IMG_2.HEIC (memory)\n      keeper       IMG_1003.HEIC (memory)\n      keeper       IMG_1003.HEIC (memory)\n\n  health        no lines\n  sources       sim-phone 21 lines, last 22:40 · manual 4 lines, last 18:40 · immich 2 lines, last 18:45\n  readiness     mail none · message none · meeting none · location present · photo present · calendar none\n",
      stars: null,
    },
  },
  {
    name: "the owner's no on a scene: what the proposal named, nothing to name, superseded, retracted",
    lines: [
      sceneNo(`${VIDEO}#t=130.00,170.00`, scene(130, 170), {
        place: place("Hjem", "Hjem"),
        when: null,
        confidence: "medium",
      }),
      sceneNo(`${VIDEO}#t=3700.00,3725.50`, scene(3700, 3725.5), {
        place: null,
        when: when("1994-06-01", "1994-08-31", "season"),
        confidence: "low",
      }),
      sceneNo(`${VIDEO}#t=5.00,9.00`, scene(5, 9), {
        place: { type: "asset", id: "solvind", registry: "logbook", label: "Solvind" },
        when: when("1994-07-14", "1994-07-14", "day"),
        confidence: "high",
        when_confidence: "high",
      }),
      sceneNo(`${VIDEO}#t=10.00,20.00`, undefined, { place: place("Hjem", "Hjem") }),
      sceneNo(`${VIDEO}#t=10.00,20.00`, scene("x", 20), null),
      sceneNo("junk", undefined, null),
      sceneNo(`${VIDEO}#t=30.00,40.00`, scene(30, 40), {
        place: place("Hytta"),
        when: when("1994-07-01", "1994-07-31", "month"),
      }),
      sceneNo(`${VIDEO}#t=50.00,60.00`, scene(50, 60), {
        place: null,
        when: when("1990-01-01", "1995-12-31", "range"),
      }),
      sceneNo(`${VIDEO}#t=70.00,80.00`, scene(70, 80), {}),
      sceneNo(`${VIDEO}#t=80.00,90.00`, scene(80, 90), "weird"),
      sceneNo(`${VIDEO}#t=130.00,170.00`, scene(130, 170), null, { supersedes: lineId(1) }), // 11
      sceneNo(`${VIDEO}#t=3700.00,3725.50`, scene(3700, 3725.5), null, {
        supersedes: lineId(2),
      }), // 12
      retraction(12, 2),
    ],
    expected: {
      show: "2026-10-03  unsigned\n  20:04  scene-review manual         superseded by #11\n  20:04  scene-review manual         scene 1:01:40–1:02:05 ≠ 1994-06-01..1994-08-31\n  20:04  scene-review manual         scene 0:05–0:09 ≠ Solvind, 1994-07-14\n  20:04  scene-review manual         scene ≠ Hjem\n  20:04  scene-review manual         scene: nothing to name\n  20:04  scene-review manual         scene: nothing to name\n  20:04  scene-review manual         scene 0:30–0:40 ≠ Hytta, 1994-07-01..1994-07-31\n  20:04  scene-review manual         scene 0:50–1:00 ≠ 1990-01-01..1995-12-31\n  20:04  scene-review manual         scene 1:10–1:20: nothing to name\n  20:04  scene-review manual         scene 1:20–1:30: nothing to name\n  20:04  scene-review manual         scene 2:10–2:50: nothing to name\n  20:04  retracted #12: unstarred\n",
      day: "2026-10-03  Saturday · unsigned\n  night before  in transit\n  night after   in transit\n  country       unknown\n\n  timeline      nothing logged\n\n  health        no lines\n  sources       manual 11 lines, last 20:04\n  readiness     mail none · message none · meeting none · location none · photo none · calendar none\n",
      stars: null,
    },
  },
];

/**
 * A case's record, with `places.json` beside it when the case has a stay, and the owner's signature
 * over the day's page as it stands when the case signs it (RFC 0034; its digest this
 * implementation's, which reproduces the conformance samples').
 */
export function marksRecord(c: MarksCase): string {
  let lines = c.lines;
  if (c.sign !== undefined) {
    const page = pageOf(readAll(writeBareRecord(lines)), DAY, "Europe/Oslo");
    const sign = c.sign;
    lines = [
      ...lines,
      {
        at: "2026-10-03T20:00:00Z",
        source: "manual",
        kind: "signed-day",
        tier: 1,
        payload: {
          schema: "signed-day/v1",
          day: DAY,
          subject: OWNER,
          confirmed: sign.confirmed.map(lineId),
          page: {
            sha256: pageDigest(
              DAY,
              "Europe/Oslo",
              page.map((l) => l.hash),
            ),
            lines: page.length,
          },
          dispositions: Object.fromEntries(
            Object.entries(sign.dispositions).map(([seq, word]) => [lineId(Number(seq)), word]),
          ),
        },
      },
    ];
  }
  const root = writeBareRecord(lines);
  if (c.places === true)
    writeFileSync(join(root, "places.json"), `${JSON.stringify(PLACES)}\n`, "utf-8");
  return root;
}
