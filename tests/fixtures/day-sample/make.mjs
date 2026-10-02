// Regenerates this fixture from the lists below. Run after `pnpm build`:
//   node tests/fixtures/day-sample/make.mjs
// Six days of a person in Oslo who does not exist, laid out so that every rule `day` follows has
// a case: a stop with nothing attached, a tracker silent for an afternoon (a gap, and lines placed
// nowhere), a flight between two airports with a declared line a tracked one supersedes and an
// inferred leg with no designator, a night in a hotel labelled by the nearest airport's city, a
// run aboard a yacht with a berth, a passage and an anchorage, a night in transit, a day with no
// line at all, calendar entries held at the stay and not, an all-day entry of one day and of a
// week, a transcript, mail threads, calls answered and not, faces the library tagged, the owner's
// own face, address and name (never their own company), a retracted note, a superseded note, two
// devices' sleep and steps, a corrected resting heart rate. Everything is synthetic: example.org
// addresses, reserved phone ranges, airline XY, MMSI 999000001.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, hashLine } from "../../../dist/index.js";

const root = dirname(fileURLToPath(import.meta.url));
const TZ = "Europe/Oslo";
const RECORDED = "2026-04-12T18:00:00Z";
const ZERO = "0".repeat(64);
const id = (n) => `00000000-0000-4000-8000-0000000004${String(n).padStart(2, "0")}`;
const KARI = "00000000-0000-4000-8000-000000000004"; // owner_id: the owner's own entity
const OLA = "019c0000-0000-7000-8000-000000000101";
const INES = "019c0000-0000-7000-8000-000000000102";

const line = (at, end, source, kind, tier, payload) => ({ at, end, source, kind, tier, payload });
const point = (at, lat, lon, subject) =>
  line(at, null, subject ? "ais" : "sim-phone", "location", 1, {
    schema: "location/v1", lat, lon, accuracy_m: 10, ...(subject ? { subject, tracker: "aisstream" } : {}),
  });
const resolution = (ref, entity, label) =>
  line("2026-04-01T06:00:00Z", null, "manual", "resolution", 2, {
    schema: "resolution/v1", ref, entity: { type: "person", id: entity, registry: "logbook" }, label, method: "owner",
  });
const email = (value) => ({ kind: "email", value });
const phone = (value) => ({ kind: "phone", value });
const attendee = (ref, name) => ({ ref, name, response: "accepted" });
const event = (at, end, title, extra = {}) =>
  line(at, end, "sim-calendar", "event", 1, { schema: "event/v1", raw_id: `${title}@${at}`, title, all_day: false, ...extra });
const note = (at, text, extra = {}) => line(at, null, "manual", "note", 2, { schema: "note/v1", text, ...extra });
const health = (at, end, type, value, unit, extra = {}) =>
  line(at, end, "apple-health", "health", 3, { schema: "health-sample/v1", raw_id: `${type}:${at}:${extra.device ?? "Watch"}`, type, value, unit, device: "Watch", ...extra });

/** Points every `stepMin` minutes from `from` to `to` (inclusive of both ends) along a straight line. */
function track(startAt, endAt, from, to, stepMin, subject) {
  const out = [];
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  const n = Math.round((end - start) / (stepMin * 60_000));
  for (let i = 0; i <= n; i++) {
    const f = n === 0 ? 0 : i / n;
    const at = new Date(start + i * stepMin * 60_000).toISOString().replace(".000Z", "Z");
    out.push(point(at, +(from[0] + (to[0] - from[0]) * f).toFixed(6), +(from[1] + (to[1] - from[1]) * f).toFixed(6), subject));
  }
  return out;
}
/** Points every `stepMin` minutes staying at one spot, from `startAt` to `endAt` inclusive. */
const still = (startAt, endAt, at, stepMin = 5, subject) => track(startAt, endAt, at, at, stepMin, subject);
/** The same, the first instant left out (it is the last of the span before). */
const stillAfter = (startAt, endAt, at, stepMin = 5, subject) => still(startAt, endAt, at, stepMin, subject).slice(1);

const HOME = [59.9139, 10.7522];
const OFFICE = [59.91, 10.76];
const CAFE = [59.912, 10.756]; // a stop on the way, unnamed
const FAR_CAFE = [59.94, 10.7]; // where the tracker woke up again
const OSL = [60.1939, 11.1004];
const BGO = [60.2934, 5.2181];
const HOTEL = [60.39, 5.32]; // unnamed; Bergen is the nearest large airport's city
const BERTH = [60.395, 5.31]; // the yacht's berth, a named place of kind asset-berth
const ANCHORAGE = [60.3, 5.2];

const lines = [
  // --- who the record names ----------------------------------------------------------------
  resolution(email("kari.nordmann@example.org"), KARI, "Kari Nordmann"),
  resolution({ kind: "provider_id", value: "immich:f_00" }, KARI, "Kari Nordmann"),
  resolution(email("ola@example.org"), OLA, "Ola Nordmann"),
  resolution(phone("+4790000001"), OLA, "Ola Nordmann"),
  resolution({ kind: "provider_id", value: "immich:f_01" }, OLA, "Ola Nordmann"),
  resolution(email("ines@example.org"), INES, "Ines Holm"),
  resolution(phone("+4790000002"), INES, "Ines Holm"),

  // --- 2026-04-05 evening: the night before Monday, at home -----------------------------------
  ...still("2026-04-05T16:00:00Z", "2026-04-06T07:00:00Z", HOME),
  health("2026-04-05T22:30:00Z", "2026-04-06T00:30:00Z", "sleep", 7200, "s", { stage: "core" }),
  health("2026-04-06T00:30:00Z", "2026-04-06T00:35:00Z", "sleep", 300, "s", { stage: "awake" }),
  health("2026-04-06T00:35:00Z", "2026-04-06T02:00:00Z", "sleep", 5100, "s", { stage: "deep" }),
  health("2026-04-06T02:00:00Z", "2026-04-06T03:00:00Z", "sleep", 3600, "s", { stage: "rem" }),
  health("2026-04-06T03:00:00Z", "2026-04-06T05:00:00Z", "sleep", 7200, "s", { stage: "core" }),
  health("2026-04-06T03:00:00Z", "2026-04-06T05:00:00Z", "sleep", 7200, "s", { stage: "core", raw_id: "sleep:again" }), // the night synced twice
  health("2026-04-05T22:00:00Z", "2026-04-06T05:30:00Z", "sleep", 27000, "s", { stage: "in_bed", device: "Phone" }),
  health("2026-04-05T22:30:00Z", "2026-04-06T04:00:00Z", "sleep", 19800, "s", { stage: "asleep", device: "Phone" }),
  health("2026-04-06T04:00:00Z", null, "resting_hr", 55, "bpm"),
  health("2026-04-06T04:30:00Z", null, "hrv", 42, "ms"),
  health("2026-04-06T05:00:00Z", null, "resting_hr", 70, "bpm"), // #id 17, corrected below
  health("2026-04-06T06:00:00Z", "2026-04-06T06:15:00Z", "steps", 120, "count"),
  health("2026-04-06T06:00:00Z", "2026-04-06T06:15:00Z", "steps", 100, "count", { device: "Phone" }),
  health("2026-04-06T06:15:00Z", "2026-04-06T06:30:00Z", "steps", 80, "count"),
  health("2026-04-06T06:15:00Z", "2026-04-06T06:30:00Z", "steps", 200, "count", { device: "Phone" }),
  health("2026-04-06T06:30:00Z", "2026-04-06T06:45:00Z", "steps", 50, "count"),
  health("2026-04-06T06:45:00Z", "2026-04-06T07:00:00Z", "steps", 1000, "count"), // #id 23, retracted below

  // --- 2026-04-06, Monday: home, a stop, the office, a silent afternoon ------------------------
  line("2026-04-05T22:00:00Z", "2026-04-06T22:00:00Z", "sim-calendar", "event", 1, {
    schema: "event/v1", raw_id: "allday-1", title: "Ines in town", all_day: true, attendees: [attendee(email("ines@example.org"), "Ines Holm")],
  }),
  point("2026-04-06T07:05:00Z", 59.913, 10.754),
  ...still("2026-04-06T07:10:00Z", "2026-04-06T07:15:00Z", CAFE),
  ...still("2026-04-06T07:20:00Z", "2026-04-06T12:00:00Z", OFFICE),
  event("2026-04-06T08:00:00Z", "2026-04-06T08:45:00Z", "Weekly planning", {
    location: "Office",
    attendees: [attendee(email("ola@example.org"), "Ola Nordmann"), attendee(email("kari.nordmann@example.org"), "Kari Nordmann"), attendee(email("per@example.org"), "Per")],
  }),
  line("2026-04-06T09:00:00Z", "2026-04-06T09:30:00Z", "granola", "transcript", 2, {
    schema: "transcript/v1", provider: "granola", raw_id: "t-1", title: "Standup",
    participants: [{ name: "Ola Nordmann", email: "ola@example.org" }, { name: "Speaker A" }, { name: "Ines Holm", email: "ines@example.org" }],
  }),
  line("2026-04-06T09:10:00Z", null, "whatsapp", "message", 2, { schema: "message/v1", raw_id: "m1", chat: { id: "c1", type: "direct", name: "Ola" }, from_me: false, sender: { kind: "phone", value: "+4790000001" }, text: "coffee?" }),
  line("2026-04-06T09:12:00Z", null, "whatsapp", "message", 2, { schema: "message/v1", raw_id: "m2", chat: { id: "c1", type: "direct", name: "Ola" }, from_me: true, text: "yes" }),
  line("2026-04-06T10:00:00Z", null, "mail", "mail", 2, { schema: "mail/v1", raw_id: "a:1", thread: "t1", from: { email: "ola@example.org", name: "Ola Nordmann" }, subject: "Berth", direction: "received", size: 100 }),
  line("2026-04-06T10:30:00Z", null, "mail", "mail", 2, { schema: "mail/v1", raw_id: "a:2", thread: "t1", from: { email: "ola@example.org", name: "Ola Nordmann" }, subject: "Re: Berth", direction: "received", size: 100 }),
  line("2026-04-06T10:45:00Z", null, "ios-calls", "call", 1, { schema: "call/v1", raw_id: "c1", direction: "outgoing", answered: false, duration_s: 0, counterparty: phone("+4790000001"), service: "cellular" }),
  line("2026-04-06T11:00:00Z", "2026-04-06T11:00:45Z", "ios-calls", "call", 1, { schema: "call/v1", raw_id: "c2", direction: "incoming", answered: true, duration_s: 45, counterparty: phone("+4790000002"), service: "cellular" }),
  line("2026-04-06T11:30:00Z", null, "immich", "photo", 1, { schema: "photo/v1", raw_id: "p1", asset_id: "p-1", library: "immich", file_name: "IMG_0406.HEIC", media: "image", faces: 3, people: ["f_01", "f_99", "f_00"], favorite: true }),
  line("2026-04-06T11:30:00Z", null, "keeper-inference", "keeper", 1, { schema: "keeper/v1", raw_id: `${id(40)}:memory`, photo: { line: id(40), asset_id: "p-1", library: "immich", file_name: "IMG_0406.HEIC" }, at: "2026-04-06T11:30:00Z", lane: "memory", source: "immich" }),
  note("2026-04-06T11:45:00Z", "Lunch with Ola Nordmann and Kari at the office. Ines came by.\nSecond line, never shown."),
  // the tracker is silent from 12:00 to 16:00 UTC; what happened then is placed nowhere
  note("2026-04-06T13:00:00Z", "Walked along the river with Ines Holm."),
  event("2026-04-06T13:30:00Z", "2026-04-06T14:30:00Z", "Dentist"),
  line("2026-04-06T14:00:00Z", "2026-04-06T14:10:00Z", "ios-calls", "call", 1, { schema: "call/v1", raw_id: "c3", direction: "outgoing", answered: true, duration_s: 600, counterparty: phone("+4790000002"), service: "cellular" }),
  line("2026-04-06T14:30:00Z", null, "mail", "mail", 2, { schema: "mail/v1", raw_id: "a:3", thread: "t2", from: { email: "ines@example.org", name: "Ines Holm" }, subject: "Tromsø", direction: "received", size: 100 }),
  line("2026-04-06T15:00:00Z", "2026-04-06T15:20:00Z", "granola", "transcript", 2, { schema: "transcript/v1", provider: "granola", raw_id: "t-2", title: "River talk", participants: [{ name: "Ines Holm", email: "ines@example.org" }] }),
  line("2026-04-06T15:30:00Z", null, "immich", "photo", 1, { schema: "photo/v1", raw_id: "p2", asset_id: "p-2", library: "immich", file_name: "IMG_0406b.HEIC", media: "image", faces: 0, people: [] }),
  ...still("2026-04-06T16:00:00Z", "2026-04-06T16:30:00Z", FAR_CAFE),
  ...track("2026-04-06T16:30:00Z", "2026-04-06T16:50:00Z", FAR_CAFE, HOME, 5).slice(1),
  ...still("2026-04-06T16:55:00Z", "2026-04-07T05:00:00Z", HOME),
  note("2026-04-06T18:00:00Z", "A note I took back."), // #id, retracted below
  note("2026-04-06T18:30:00Z", "Draft of the evening note."), // superseded by the next
  note("2026-04-06T18:35:00Z", "Final evening note with Ola Nordmann.", { supersedes: "SUPERSEDED-DRAFT" }),
  line("2026-04-06T20:00:00Z", null, "logbook", "retraction", 2, { schema: "retraction/v1", supersedes: "RETRACTED-NOTE", seq: 0, reason: "not mine" }),
  line("2026-04-06T20:01:00Z", null, "logbook", "retraction", 2, { schema: "retraction/v1", supersedes: "RETRACTED-STEPS", seq: 0, reason: "a test walk" }),
  health("2026-04-06T20:30:00Z", null, "resting_hr", 59, "bpm", { raw_id: "resting_hr:fix", supersedes: "CORRECTED-RESTING" }),

  // --- 2026-04-07, Tuesday: a flight to Bergen, a hotel ------------------------------------------
  ...track("2026-04-07T05:00:00Z", "2026-04-07T05:40:00Z", HOME, OSL, 10).slice(1),
  ...stillAfter("2026-04-07T05:40:00Z", "2026-04-07T06:40:00Z", OSL),
  event("2026-04-07T06:00:00Z", "2026-04-07T07:05:00Z", "Flight to Bergen (XY 123)"),
  line("2026-04-07T06:10:00Z", "2026-04-07T07:05:00Z", "manual", "flight", 1, {
    schema: "flight/v1", raw_id: "2026-04-07:XY:123@declared", date: "2026-04-07", carrier: "XY", number: "123", from: { iata: "OSL" }, to: { iata: "BGO" },
    actual_departure: "2026-04-07T06:10:00Z", actual_arrival: "2026-04-07T07:05:00Z", role: "passenger", evidence: "declared", observations: [{ evidence: "declared", source: "manual" }],
  }),
  line("2026-04-07T06:12:00Z", "2026-04-07T07:03:00Z", "flighty", "flight", 1, {
    schema: "flight/v1", raw_id: "fx-123", date: "2026-04-07", carrier: "XY", number: "123", from: { iata: "OSL", icao: "ENGM" }, to: { iata: "BGO", icao: "ENBR" },
    actual_departure: "2026-04-07T06:12:00Z", actual_arrival: "2026-04-07T07:03:00Z", aircraft: { type: "A320", registration: "ZZ-ABC" }, role: "passenger", evidence: "tracked",
    observations: [{ evidence: "declared", source: "manual", line: "DECLARED-FLIGHT" }, { evidence: "tracked", source: "flighty" }], supersedes: "DECLARED-FLIGHT",
  }),
  ...still("2026-04-07T08:00:00Z", "2026-04-07T08:20:00Z", BGO),
  ...track("2026-04-07T08:20:00Z", "2026-04-07T08:50:00Z", BGO, HOTEL, 10).slice(1, -1),
  ...still("2026-04-07T08:50:00Z", "2026-04-08T07:00:00Z", HOTEL),
  event("2026-04-07T09:00:00Z", "2026-04-07T09:30:00Z", "Coffee", { attendees: [attendee(email("ola@example.org"), "Ola Nordmann")] }),
  event("2026-04-07T10:00:00Z", "2026-04-07T11:00:00Z", "Site visit", { location: "Office", attendees: [attendee(email("ola@example.org"), "Ola Nordmann")] }),
  event("2026-04-07T12:00:00Z", "2026-04-07T13:00:00Z", "Boat talk", { extra: { lat: 60.3901, lon: 5.3201 }, attendees: [attendee(email("ola@example.org"), "Ola Nordmann")] }),
  line("2026-04-07T15:00:00Z", "2026-04-07T17:00:00Z", "flight-inference", "flight", 1, {
    schema: "flight/v1", raw_id: "2026-04-07:leg", date: "2026-04-07", from: { iata: "BGO" }, to: { icao: "ENGM" }, role: "passenger", evidence: "inferred", observations: [{ evidence: "inferred", source: "flight-inference" }],
  }),
  event("2026-04-07T17:00:00Z", "2026-04-07T19:00:00Z", "Dinner", { attendees: [attendee(email("ines@example.org"), "Ines Holm")] }),
  health("2026-04-07T10:00:00Z", "2026-04-07T10:15:00Z", "steps", 500, "count"),
  health("2026-04-07T22:00:00Z", "2026-04-08T05:00:00Z", "sleep", 25200, "s", { stage: "asleep" }),

  // --- 2026-04-08, Wednesday: aboard Solvind from the berth to an anchorage ----------------------
  line("2026-04-07T22:00:00Z", "2026-04-14T22:00:00Z", "sim-calendar", "event", 1, {
    schema: "event/v1", raw_id: "allday-2", title: "Boat week", all_day: true, attendees: [attendee(email("ines@example.org"), "Ines Holm")],
  }),
  ...still("2026-04-07T06:00:00Z", "2026-04-08T09:00:00Z", BERTH, 10, "solvind"),
  ...track("2026-04-08T07:00:00Z", "2026-04-08T07:15:00Z", HOTEL, BERTH, 5).slice(1),
  ...stillAfter("2026-04-08T07:15:00Z", "2026-04-08T09:00:00Z", BERTH),
  ...track("2026-04-08T09:00:00Z", "2026-04-08T11:00:00Z", BERTH, ANCHORAGE, 5).slice(1),
  ...track("2026-04-08T09:00:00Z", "2026-04-08T11:00:00Z", BERTH, ANCHORAGE, 5, "solvind").slice(1),
  ...stillAfter("2026-04-08T11:00:00Z", "2026-04-09T00:00:00Z", ANCHORAGE),
  ...stillAfter("2026-04-08T11:00:00Z", "2026-04-09T23:00:00Z", ANCHORAGE, 60, "solvind"),
  note("2026-04-08T12:00:00Z", "Anchored with Ola Nordmann. Grilled."),
  line("2026-04-08T13:00:00Z", null, "immich", "photo", 1, { schema: "photo/v1", raw_id: "p3", asset_id: "p-3", library: "immich", file_name: "IMG_0408.HEIC", media: "image", faces: 1, people: ["f_01"] }),

  // --- 2026-04-09, Thursday: the tracker silent all day, the night in transit ---------------------
  // --- 2026-04-10, Friday: home again from 08:00 local; 2026-04-11 has no line at all ---------
  ...still("2026-04-10T06:00:00Z", "2026-04-10T22:00:00Z", HOME),
  note("2026-04-10T10:00:00Z", "Coffee with Kari."),
];

// Ids, and the references between lines, resolved by position in the list above.
const find = (pred) => lines.findIndex(pred);
const fix = (key, from, to) => {
  const i = find((l) => l.payload[key] === from);
  lines[i].payload[key] = id(to);
};
fix("supersedes", "SUPERSEDED-DRAFT", find((l) => l.payload.text === "Draft of the evening note."));
fix("supersedes", "RETRACTED-NOTE", find((l) => l.payload.text === "A note I took back."));
fix("supersedes", "RETRACTED-STEPS", find((l) => l.payload.value === 1000));
fix("supersedes", "CORRECTED-RESTING", find((l) => l.payload.value === 70));
fix("supersedes", "DECLARED-FLIGHT", find((l) => l.payload.raw_id === "2026-04-07:XY:123@declared"));
lines.find((l) => l.payload.raw_id === "fx-123").payload.observations[0].line = id(find((l) => l.payload.raw_id === "2026-04-07:XY:123@declared"));
for (const l of lines) if (l.kind === "retraction") l.payload.seq = lines.findIndex((x, i) => id(i) === l.payload.supersedes) + 1;
{
  const photo = find((l) => l.payload.raw_id === "p1");
  const keeper = lines.find((l) => l.kind === "keeper");
  keeper.payload.photo.line = id(photo);
  keeper.payload.raw_id = `${id(photo)}:memory`;
}

let prev = ZERO;
const out = [];
lines.forEach((l, i) => {
  const full = { id: id(i), seq: i + 1, ...l, tz: TZ, recorded_at: RECORDED, prev, hash: "" };
  full.hash = hashLine(full);
  prev = full.hash;
  out.push(canonicalize(full));
});
rmSync(join(root, "logbook"), { recursive: true, force: true });
mkdirSync(join(root, "logbook", "2026"), { recursive: true });
mkdirSync(join(root, "policy"), { recursive: true });
writeFileSync(join(root, "logbook", "2026", "04.jsonl"), `${out.join("\n")}\n`, "utf-8");
const meta = {
  format: "logbook/0.2",
  owner_id: KARI,
  created_at: "2026-04-01T06:00:00Z",
  timezone: TZ,
  owner_emails: ["kari.nordmann@example.org"],
  seq: out.length,
  head: prev,
};
writeFileSync(join(root, "logbook.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
writeFileSync(join(root, "places.json"), `${JSON.stringify({
  Home: { lat: HOME[0], lon: HOME[1], radius_m: 120, kind: "home", country: "NO" },
  Office: { lat: OFFICE[0], lon: OFFICE[1], radius_m: 120, kind: "other" },
  Marina: { lat: 59.905, lon: 10.735, radius_m: 150, kind: "asset-berth", tags: ["boat"] },
  Berth: { lat: BERTH[0], lon: BERTH[1], radius_m: 150, kind: "asset-berth", tags: ["boat"] },
}, null, 2)}\n`, "utf-8");
writeFileSync(join(root, "assets.json"), `${JSON.stringify({ assets: [{ id: "solvind", kind: "yacht", name: "Solvind", mmsi: "999000001" }] }, null, 2)}\n`, "utf-8");
writeFileSync(join(root, "policy", "owner.json"), `${JSON.stringify({ names: ["Kari"], emails: [], phones: [] }, null, 2)}\n`, "utf-8");
writeFileSync(join(root, "policy", "stays.json"), `${JSON.stringify({
  stay_min_s: 1200, stop_min_s: 180, merge_gap_s: 600, radius_m: 150, airport_km: 8, night: ["22:00", "08:00"],
  modes: { walk_max_kmh: 7, car_max_kmh: 130, flight_min_kmh: 150 }, aboard_window_s: 300,
}, null, 2)}\n`, "utf-8");
process.stdout.write(`day-sample: ${out.length} lines, head ${prev}\n`);
