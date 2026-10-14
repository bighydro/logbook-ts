// Regenerates this fixture from the list below. Run after `pnpm build`:
//   node tests/fixtures/rfc0036-sample/make.mjs
// The example lines of RFC 0036 (bighydro/logbook `rfcs/0036-*.md`, 2026-10-13) and of its amendment 1
// (PR 269, open at this writing), in the RFC's own words and ids, with the lines the draft of 13 June
// rests on and a later draft that supersedes it, so that `show` can be held to the reference on the
// same record (tests/cross-impl.test.ts, under the rfc0036 flag). Everything is synthetic: Ines and Ola
// Nordmann of Oslo do not exist.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, hashLine } from "../../../dist/index.js";

const root = dirname(fileURLToPath(import.meta.url));
const TZ = "Europe/Oslo";
const ZERO = "0".repeat(64);
const id = (n) => `019cadd3-6bc0-7dcd-9133-${String(n).padStart(12, "0")}`;
const line = (lineId, at, recorded_at, source, kind, tier, payload) => ({ id: lineId, at, end: null, source, kind, tier, payload, recorded_at });
const later = (at) => new Date(Date.parse(at) + 1000).toISOString().replace(".000Z", "Z");

const segments = [
  { text: "A morning at home, then the afternoon at the boat in Vollen.", evidence: [id("a1"), id("a2")] },
  { text: "One photo from the pontoon, the new mooring lines on.", evidence: [id("a3")] },
  { text: "You wrote that the engine sounded right for the first time since May.", evidence: [id("a4")] },
  { text: "Ola came by in the evening.", unsupported: true },
];

const lines = [
  // goal/v1: the year's goal, and the same goal reworded in March.
  line(id(301), "2026-01-04T10:15:00Z", "2026-01-04T10:15:01Z", "manual", "goal", 2, {
    schema: "goal/v1", text: "Sail the boat to Lofoten and back in one summer, without a single night in a marina I didn't choose.",
    horizon: "year", from: "2026-01-01",
  }),
  line(id(302), "2026-03-15T08:40:00Z", "2026-03-15T08:40:01Z", "manual", "goal", 2, {
    schema: "goal/v1", text: "Sail to Lofoten and back between June and August, at anchor more nights than not.",
    horizon: "year", from: "2026-01-01", until: "2026-12-31", supersedes: id(301),
  }),
  // Saturday, 13 June: the morning's steps (tier 3) and the five lines a model read under a ceiling of 2.
  line(id("a0"), "2026-06-13T05:00:00Z", "2026-06-13T20:00:00Z", "sim-watch", "health-sample", 3, {
    schema: "health-sample/v1", raw_id: "steps:2026-06-13T05:00:00Z", type: "steps", value: 4200, unit: "count",
  }),
  line(id("a1"), "2026-06-13T07:30:00Z", "2026-06-13T20:00:00Z", "sim-phone", "location", 1, {
    schema: "location/v1", lat: 59.911, lon: 10.75, accuracy_m: 12,
  }),
  line(id("a2"), "2026-06-13T13:00:00Z", "2026-06-13T20:00:00Z", "sim-phone", "location", 1, {
    schema: "location/v1", lat: 59.8, lon: 10.47, accuracy_m: 12,
  }),
  line(id("a3"), "2026-06-13T14:10:00Z", "2026-06-13T20:00:00Z", "sim-camera", "photo", 1, {
    schema: "photo/v1", file: "IMG_0613.jpg", camera: "SimPhone 3",
  }),
  line(id("a4"), "2026-06-13T16:00:00Z", "2026-06-13T20:00:00Z", "manual", "note", 2, {
    schema: "note/v1", text: "The engine sounded right for the first time since May.",
  }),
  line(id("a5"), "2026-06-13T18:00:00Z", "2026-06-13T20:00:00Z", "sim-phone", "location", 1, {
    schema: "location/v1", lat: 59.911, lon: 10.75, accuracy_m: 12,
  }),
  // draft/v1: the RFC's draft of the day, and the day dreamed again two days on, superseding it.
  line(id("d1"), "2026-06-14T06:10:00Z", "2026-06-14T06:10:01Z", "model:qwen2.5-7b-instruct", "draft", 2, {
    schema: "draft/v1", unit: "day", subject: "2026-06-13",
    read_head: "bb97e90d3f946f6cc637e5e223b080ada65e2beb12b07293727e28d2a279b3d8", read_count: 5, language: "en", segments,
  }),
  line(id("d3"), "2026-06-15T06:10:00Z", "2026-06-15T06:10:01Z", "model:qwen2.5-7b-instruct", "draft", 2, {
    schema: "draft/v1", unit: "day", subject: "2026-06-13", read_head: "HEAD", read_count: 5, language: "en",
    segments: [...segments.slice(0, 3), { text: "The evening was quiet.", unsupported: true }], supersedes: id("d1"),
  }),
  // chapter/v1: the summer on the boat, and the open chapter after it, named the same evening.
  line(id(401), "2026-09-06T17:20:00Z", "2026-09-06T17:20:01Z", "manual", "chapter", 2, {
    schema: "chapter/v1", name: "The Lofoten summer", from: "2026-06-20", to: "2026-08-09",
    rules: "Every night at anchor counts. A marina counts against. The engine is not the point; the boat is.",
  }),
  line(id(402), "2026-09-06T17:25:00Z", "2026-09-06T17:25:01Z", "manual", "chapter", 2, {
    schema: "chapter/v1", name: "Ashore, fixing things", from: "2026-08-10",
    rules: "What counts: the engine rebuilt, the mooring sorted, one weekend a month on the water anyway.",
  }),
  // review/v1: the verdict on August, written in October.
  line(id(601), "2026-08-31T20:00:00Z", "2026-10-11T18:30:00Z", "manual", "review", 2, {
    schema: "review/v1", goal: id(302), disposition: "let go", period: "month",
    note: "Engine gone in Bodø on the 9th. Towed home. Next summer.",
  }),
  // Amendment 1: a person draft, and the open chapter closed in December.
  line(id("d2"), "2026-10-12T06:20:00Z", "2026-10-12T06:20:01Z", "model:qwen2.5-7b-instruct", "draft", 2, {
    schema: "draft/v1", unit: "person", subject: id(501), window: { from: "2026-07-14", to: "2026-10-11" },
    read_head: "34cb1808a3e7cf1e88351f1dedff1cfbc4ab0a3b1846d04150b8b707cc1d0f2c", read_count: 11,
    read_policy: { entry: "dream", max_tier: 2, sha256: "e416f16fa4e6cc7e8b02cb3f6fe761fdcae93e45ee6c6745af647a47e3797f86" },
    language: "en",
    segments: [
      { text: "Most of what passed between you since July is the boat: the engine in Bodø, then the tow home.", evidence: [id("5a1"), id("5a2")] },
      { text: "Ola asked twice in September whether you will keep the berth in Vollen for next summer.", evidence: [id("5a3"), id("5a4")] },
      { text: "The cost of the rebuild seems to weigh on you both.", unsupported: true },
    ],
  }),
  line(id(403), "2026-12-01T19:00:00Z", later("2026-12-01T19:00:00Z"), "manual", "chapter", 2, {
    schema: "chapter/v1", name: "Ashore, fixing things", from: "2026-08-10", to: "2026-11-29",
    rules: "What counts: the engine rebuilt, the mooring sorted, one weekend a month on the water anyway.", supersedes: id(402),
  }),
];

rmSync(join(root, "logbook"), { recursive: true, force: true });
const files = new Map();
let prev = ZERO;
let seq = 0;
for (const content of lines) {
  seq += 1;
  // A draft read the record as it stood: "HEAD" is the head before it.
  if (content.payload.read_head === "HEAD") content.payload.read_head = prev;
  const row = { ...content, seq, tz: TZ, prev, hash: "" };
  row.hash = hashLine(row);
  prev = row.hash;
  const rel = join("logbook", row.at.slice(0, 4), `${row.at.slice(5, 7)}.jsonl`);
  files.set(rel, (files.get(rel) ?? "") + `${canonicalize(row)}\n`);
}
for (const [rel, text] of files) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text, "utf-8");
}
const meta = {
  format: "logbook/0.2",
  owner_id: "00000000-0000-4000-8000-000000000001",
  created_at: "2026-01-01T00:00:00Z",
  timezone: TZ,
  seq,
  head: prev,
};
writeFileSync(join(root, "logbook.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
process.stdout.write(`${seq} lines, head ${prev}\n`);
