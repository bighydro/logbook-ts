// Regenerates this fixture from the list below. Run after `pnpm build`:
//   node tests/fixtures/show-sample/make.mjs
// Everything here is synthetic: a person in Oslo who does not exist, contacts from
// reserved example ranges. Days: 2026-03-14 (the day to show), 2026-03-15/16
// (resolutions and retractions), 2026-03-31 22:30Z (which is 2026-04-01 in Oslo).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, hashLine } from "../../../dist/index.js";

const root = dirname(fileURLToPath(import.meta.url));
const TZ = "Europe/Oslo";
const RECORDED = "2026-04-02T18:00:00Z";
const ZERO = "0".repeat(64);
const id = (n) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
const person = (n) => `019c0000-0000-7000-8000-00000000000${n}`;

const point = (at, lat, lon) => ({
  at, end: null, source: "sim-phone", kind: "location", tier: 1,
  payload: { schema: "location/v1", lat, lon, accuracy_m: 10 },
});
const message = (at, chat, sender, text, from_me = false) => ({
  at, end: null, source: "whatsapp", kind: "message", tier: 2,
  payload: { schema: "message/v1", raw_id: at, chat, from_me, ...(sender ? { sender } : {}), text },
});
const note = (at, text) => ({
  at, end: null, source: "manual", kind: "note", tier: 2, payload: { schema: "note/v1", text },
});
const resolution = (at, source, payload) => ({
  at, end: null, source, kind: "resolution", tier: 2, payload: { schema: "resolution/v1", ...payload },
});
const retraction = (at, seq, reason) => ({
  at, end: null, source: "manual", kind: "retraction", tier: 2,
  payload: { schema: "retraction/v1", supersedes: id(seq), seq, reason },
});

const group = { id: "120363000000000001@g.us", type: "group", name: "Sailing club" };
const kari = { id: "4790000002@s.whatsapp.net", type: "direct", name: "Kari" };

const lines = [
  point("2026-03-14T07:12:00Z", 59.911, 10.75),
  point("2026-03-14T07:40:00Z", 59.912, 10.748),
  point("2026-03-14T08:40:00Z", 59.913, 10.742),
  {
    at: "2026-03-14T09:00:00Z", end: "2026-03-14T10:00:00Z", source: "sim-calendar", kind: "event", tier: 1,
    payload: {
      schema: "event/v1", raw_id: "ev-1@2026-03-10T12:00:00Z", title: "Coffee with Ines", all_day: false,
      attendees: [{ ref: { kind: "email", value: "ines@example.org" }, name: "Ines", response: "accepted" }],
    },
  },
  {
    at: "2026-03-14T09:30:00Z", end: null, source: "sim-camera", kind: "photo", tier: 1,
    payload: { schema: "photo/v1", file: "IMG_0101.jpg" },
  },
  message("2026-03-14T11:05:00Z", group, { kind: "handle", value: "236000000000001@lid", name: "Ola N" }, "Regatta moved to Sunday"),
  message("2026-03-14T11:07:00Z", kari, { kind: "phone", value: "+4790000002", name: "Kari M" }, "Hei, lunch?"),
  message("2026-03-14T11:09:00Z", kari, undefined, "On my way", true),
  note("2026-03-14T20:30:00Z", "Regatta Sunday.\nBring the jib."),
  point("2026-03-14T21:00:00Z", 59.911, 10.75),
  note("2026-03-14T21:30:00Z", "typo"),
  point("2026-03-31T22:30:00Z", 59.95, 10.6),
  note("2026-04-01T06:00:00Z", "April"),
  resolution("2026-03-15T09:00:00Z", "ios-contacts", {
    ref: { kind: "email", value: "ines@example.org" },
    entity: { type: "person", id: person(1), registry: "logbook" }, label: "Ines Holm", method: "exact",
  }),
  resolution("2026-03-15T09:00:01Z", "ios-contacts", {
    ref: { kind: "phone", value: "+4790000001" },
    entity: { type: "person", id: person(2), registry: "logbook" }, label: "Ola Nordmann", method: "exact",
  }),
  resolution("2026-03-15T09:00:02Z", "whatsapp-contacts", {
    ref: { kind: "handle", value: "236000000000001@lid" },
    alias_of: { kind: "phone", value: "+4790000001" }, label: "Ola N", method: "exact",
  }),
  resolution("2026-03-15T09:00:03Z", "ios-contacts", {
    ref: { kind: "phone", value: "+4790000002" },
    entity: { type: "person", id: person(3), registry: "logbook" }, label: "Kari Moe", method: "exact",
  }),
  retraction("2026-03-15T10:00:00Z", 17, "wrong contact"),
  retraction("2026-03-15T10:01:00Z", 11, "typo"),
  resolution("2026-03-16T08:00:00Z", "manual", {
    ref: { kind: "email", value: "ines@example.org" },
    entity: { type: "person", id: person(1), registry: "logbook" }, label: "Ines Holm-Berg", method: "owner",
  }),
];

const files = new Map();
let prev = ZERO;
let seq = 0;
for (const content of lines) {
  seq += 1;
  const line = { id: id(seq), seq, ...content, tz: TZ, recorded_at: RECORDED, prev, hash: "" };
  line.hash = hashLine(line);
  prev = line.hash;
  const rel = join("logbook", line.at.slice(0, 4), `${line.at.slice(5, 7)}.jsonl`);
  files.set(rel, (files.get(rel) ?? "") + `${canonicalize(line)}\n`);
}
for (const [rel, text] of files) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text, "utf-8");
}
const meta = {
  format: "logbook/0.2",
  owner_id: "00000000-0000-4000-8000-000000000003",
  created_at: "2026-03-01T06:00:00Z",
  timezone: TZ,
  seq,
  head: prev,
};
writeFileSync(join(root, "logbook.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
process.stdout.write(`${seq} lines, head ${prev}\n`);
