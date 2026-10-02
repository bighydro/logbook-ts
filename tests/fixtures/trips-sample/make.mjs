// Regenerates this fixture from the lists below. Run after `pnpm build`:
//   node tests/fixtures/trips-sample/make.mjs
// Seventeen days of a person in Oslo who does not exist, over the turn of the year 2025–26, laid
// out so that every rule `trips` and `rollup countries` follow has a case: a trip of five nights
// across the year boundary with a flight in on its first day, one in the middle and one out on
// the day after it (that one without a designator), two nights in one hotel as two stays and two
// more as one stay (the lines are not repeated), a night at an airport hotel (labelled by the
// airport), a named place visited on the trip and a stop at another, a person named at home on the
// morning of departure and one at the office on the day of return, people confirmed by two
// calendar entries, by one, and by a note, a face the library tagged (proposed, never listed), an
// attendee no resolution line names, two photos of a confirmed person (one taken where the stay is, one
// carrying the coordinates of another place) and a face tagged at a stay the day after a calendar
// entry confirmed its owner there, a
// calendar entry of thirteen guests (the list stops at twelve), a trip aboard a yacht with a night
// at each of two anchorages and a last night at a flat 600 m from home (away: the 400 m rule), a
// night the tracker slept through before it (in transit), a night 300 m from home (home, by the
// same rule), two nights at a camp on the ice sheet that no airport is near (country unknown), and
// a tracker silent on the last evening (in transit, alone: not a trip). Everything is synthetic:
// example.org addresses, airline XY, MMSI 999000001.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, hashLine } from "../../../dist/index.js";

const root = dirname(fileURLToPath(import.meta.url));
const TZ = "Europe/Oslo";
const RECORDED = "2026-01-14T18:00:00Z";
const ZERO = "0".repeat(64);
const id = (n) => `00000000-0000-4000-8000-0000000005${String(n).padStart(2, "0")}`;
const KARI = "00000000-0000-4000-8000-000000000005"; // owner_id: the owner's own entity
const person = (n) => `019c0000-0000-7000-8000-0000000002${String(n).padStart(2, "0")}`;
const INES = person(1);
const LIV = person(2);
const PER = person(3);
const FREJA = person(4);
const JONAS = person(5);
const ANDERS = person(6);
const OLA = person(7);
const GUESTS = Array.from({ length: 13 }, (_, i) => ({
  id: person(10 + i),
  name: `Guest ${String(i + 1).padStart(2, "0")}`,
  email: `guest${String(i + 1).padStart(2, "0")}@example.org`,
}));

/** `YYYY-MM-DD HH:MM` on the Oslo clock (UTC+1 in winter) as an RFC 3339 UTC instant. */
const utc = (local) => new Date(`${local.replace(" ", "T")}:00+01:00`).toISOString().replace(".000Z", "Z");

const line = (at, end, source, kind, tier, payload) => ({ at: utc(at), end: end === null ? null : utc(end), source, kind, tier, payload });
const point = (at, lat, lon, subject) =>
  line(at, null, subject ? "ais" : "sim-phone", "location", 1, {
    schema: "location/v1", lat, lon, accuracy_m: 10, ...(subject ? { subject, tracker: "aisstream" } : {}),
  });
const resolution = (ref, entity, label) =>
  line("2025-12-01 07:00", null, "manual", "resolution", 2, {
    schema: "resolution/v1", ref, entity: { type: "person", id: entity, registry: "logbook" }, label, method: "owner",
  });
const email = (value) => ({ kind: "email", value });
const attendee = (ref, name) => ({ ref, name, response: "accepted" });
const event = (at, end, title, extra = {}) =>
  line(at, end, "sim-calendar", "event", 1, { schema: "event/v1", raw_id: `${title}@${at}`, title, all_day: false, ...extra });
const note = (at, text) => line(at, null, "manual", "note", 2, { schema: "note/v1", text });
const flight = (at, end, source, evidence, from, to, designator, date) =>
  line(at, end, source, "flight", 1, {
    schema: "flight/v1",
    raw_id: `${date}:${designator ? `${designator[0]}:${designator[1]}` : "leg"}@${evidence}`,
    date,
    ...(designator ? { carrier: designator[0], number: designator[1] } : {}),
    from, to, actual_departure: utc(at), actual_arrival: utc(end), role: "passenger", evidence,
    observations: [{ evidence, source }],
  });

/** Points every `stepMin` minutes from `from` to `to` (inclusive of both ends) along a straight line. */
function track(startAt, endAt, from, to, stepMin, subject) {
  const out = [];
  const start = Date.parse(utc(startAt));
  const end = Date.parse(utc(endAt));
  const n = Math.round((end - start) / (stepMin * 60_000));
  for (let i = 0; i <= n; i++) {
    const f = n === 0 ? 0 : i / n;
    const at = new Date(start + i * stepMin * 60_000).toISOString().replace(".000Z", "Z");
    out.push({
      ...point("2025-12-01 00:00", +(from[0] + (to[0] - from[0]) * f).toFixed(6), +(from[1] + (to[1] - from[1]) * f).toFixed(6), subject),
      at,
    });
  }
  return out;
}
/** Points every `stepMin` minutes staying at one spot, from `startAt` to `endAt` inclusive. */
const still = (startAt, endAt, at, stepMin = 5, subject) => track(startAt, endAt, at, at, stepMin, subject);
/** A journey, its two ends left out (they are the last and first points of the stays around it). */
const go = (startAt, endAt, from, to, stepMin = 5, subject) => track(startAt, endAt, from, to, stepMin, subject).slice(1, -1);
/** The same as `still`, the first instant left out (it is the last of the span before). */
const stillAfter = (startAt, endAt, at, stepMin = 5, subject) => still(startAt, endAt, at, stepMin, subject).slice(1);

const HOME = [59.9139, 10.7522];
const OFFICE = [59.91, 10.76];
const MARINA = [59.905, 10.735];
const OSL = [60.1939, 11.1004];
const HAM = [53.6304, 9.9882];
const HOTEL_A = [53.57, 10.013]; // unnamed, no place within 5 km; Hamburg's airport is the nearest
const MESSE = [53.54, 9.92]; // a named place abroad, no country given
const KIOSK = [53.545, 9.925]; // a named place for a ten-minute stop
const CPH = [55.6179, 12.656];
const AIRPORT_HOTEL = [55.62, 12.65]; // within 3.5 km of the airport's reference point
const HOTEL_B = [55.685, 12.55]; // unnamed; Copenhagen is the nearest large airport's city
const ANCHORAGE_1 = [59.8, 10.6];
const ANCHORAGE_2 = [59.75, 10.55];
const FLAT = [59.9193, 10.7522]; // 600 m north of home: away
const NEAR_HOME = [59.9166, 10.7522]; // 300 m north of home: home, whatever the radius
const CAMP = [76.0, -40.0]; // the ice sheet: no large airport within 300 km

const lines = [
  // --- who the record names ----------------------------------------------------------------
  resolution(email("kari.nordmann@example.org"), KARI, "Kari Nordmann"),
  resolution({ kind: "provider_id", value: "immich:f_00" }, KARI, "Kari Nordmann"),
  resolution(email("ines@example.org"), INES, "Ines Holm"),
  resolution(email("liv@example.org"), LIV, "Liv Berg"),
  resolution(email("per@example.org"), PER, "Per Hansen"),
  resolution(email("freja@example.org"), FREJA, "Freja Lund"),
  resolution({ kind: "provider_id", value: "immich:f_04" }, FREJA, "Freja Lund"),
  resolution({ kind: "provider_id", value: "immich:f_77" }, JONAS, "Jonas Weber"),
  resolution(email("anders@example.org"), ANDERS, "Anders Vik"),
  resolution(email("ola@example.org"), OLA, "Ola Nordmann"),
  ...GUESTS.map((g) => resolution(email(g.email), g.id, g.name)),
  resolution({ kind: "provider_id", value: "immich:f_10" }, GUESTS[0].id, GUESTS[0].name),

  // --- 2025-12-28 Sun, 12-29 Mon: at home, a day at the office -------------------------------
  ...still("2025-12-28 12:00", "2025-12-29 08:30", HOME),
  ...go("2025-12-29 08:30", "2025-12-29 08:50", HOME, OFFICE),
  ...still("2025-12-29 08:50", "2025-12-29 17:00", OFFICE),
  event("2025-12-29 10:00", "2025-12-29 11:00", "Weekly", { location: "Office", attendees: [attendee(email("liv@example.org"), "Liv Berg")] }),
  ...go("2025-12-29 17:00", "2025-12-29 17:20", OFFICE, HOME),
  ...still("2025-12-29 17:20", "2025-12-30 06:00", HOME),

  // --- 2025-12-30 Tue: to Hamburg; the trip begins -------------------------------------------
  note("2025-12-30 05:30", "Packing with Ines Holm."),
  ...go("2025-12-30 06:00", "2025-12-30 06:45", HOME, OSL),
  ...still("2025-12-30 06:45", "2025-12-30 08:00", OSL),
  flight("2025-12-30 08:00", "2025-12-30 09:30", "flighty", "tracked", { iata: "OSL", icao: "ENGM" }, { iata: "HAM", icao: "EDDH" }, ["XY", "101"], "2025-12-30"),
  ...go("2025-12-30 08:00", "2025-12-30 09:30", OSL, HAM, 15),
  ...still("2025-12-30 09:30", "2025-12-30 10:15", HAM),
  ...go("2025-12-30 10:15", "2025-12-30 10:45", HAM, HOTEL_A),
  ...still("2025-12-30 10:45", "2025-12-31 10:00", HOTEL_A),

  // --- 2025-12-31 Wed: a day at the Messe, a stop at the Kiosk, the same hotel ----------------
  ...go("2025-12-31 10:00", "2025-12-31 10:30", HOTEL_A, MESSE),
  ...still("2025-12-31 10:30", "2025-12-31 17:30", MESSE),
  event("2025-12-31 11:00", "2025-12-31 12:00", "Keynote", { location: "Messe", attendees: [attendee(email("liv@example.org"), "Liv Berg"), attendee(email("per@example.org"), "Per Hansen"), attendee(email("kari.nordmann@example.org"), "Kari Nordmann"), attendee(email("nobody@example.org"), "Nils Nobody")] }),
  note("2025-12-31 12:30", "Lunch with Freja Lund."),
  line("2025-12-31 13:00", null, "immich", "photo", 1, { schema: "photo/v1", raw_id: "p1", asset_id: "p-1", library: "immich", file_name: "IMG_1231.HEIC", media: "image", faces: 2, people: ["f_77", "f_00"] }),
  // Two photos of Freja, who the note confirms: one taken where the stay is, one with the coordinates of the hotel across town.
  line("2025-12-31 14:00", null, "immich", "photo", 1, { schema: "photo/v1", raw_id: "p2", asset_id: "p-2", library: "immich", file_name: "IMG_1231b.HEIC", media: "image", lat: MESSE[0], lon: MESSE[1], faces: 1, people: ["f_04"] }),
  line("2025-12-31 15:00", null, "immich", "photo", 1, { schema: "photo/v1", raw_id: "p3", asset_id: "p-3", library: "immich", file_name: "IMG_1231c.HEIC", media: "image", lat: HOTEL_A[0], lon: HOTEL_A[1], faces: 1, people: ["f_04"] }),
  ...go("2025-12-31 17:30", "2025-12-31 17:35", MESSE, KIOSK),
  ...still("2025-12-31 17:35", "2025-12-31 17:45", KIOSK),
  ...go("2025-12-31 17:45", "2025-12-31 18:15", KIOSK, HOTEL_A),
  ...still("2025-12-31 18:15", "2026-01-01 10:30", HOTEL_A),

  // --- 2026-01-01 Thu: a flight in the middle of the trip, a night at the airport hotel -------
  ...go("2026-01-01 10:30", "2026-01-01 11:00", HOTEL_A, HAM),
  ...still("2026-01-01 11:00", "2026-01-01 12:30", HAM),
  flight("2026-01-01 12:30", "2026-01-01 13:30", "manual", "declared", { iata: "HAM" }, { iata: "CPH" }, ["XY", "202"], "2026-01-01"),
  ...go("2026-01-01 12:30", "2026-01-01 13:30", HAM, CPH, 15),
  ...still("2026-01-01 13:30", "2026-01-01 14:00", CPH),
  ...go("2026-01-01 14:00", "2026-01-01 14:10", CPH, AIRPORT_HOTEL),
  ...still("2026-01-01 14:10", "2026-01-02 09:00", AIRPORT_HOTEL),
  event("2026-01-01 19:00", "2026-01-01 21:00", "Dinner", { attendees: [attendee(email("liv@example.org"), "Liv Berg")] }),

  // --- 2026-01-02 Fri, 01-03 Sat: two nights in one hotel in town, thirteen guests ------------
  ...go("2026-01-02 09:00", "2026-01-02 09:45", AIRPORT_HOTEL, HOTEL_B),
  ...still("2026-01-02 09:45", "2026-01-04 09:00", HOTEL_B),
  event("2026-01-02 15:00", "2026-01-02 17:00", "Nytårskur", { attendees: GUESTS.map((g) => attendee(email(g.email), g.name)) }),
  // The first guest's face the day after, at the same stay: a proposal on a day nothing confirms them.
  line("2026-01-03 12:00", null, "immich", "photo", 1, { schema: "photo/v1", raw_id: "p4", asset_id: "p-4", library: "immich", file_name: "IMG_0103.HEIC", media: "image", faces: 1, people: ["f_10"] }),

  // --- 2026-01-04 Sun: home, by the office; the day after the trip --------------------------
  ...go("2026-01-04 09:00", "2026-01-04 09:45", HOTEL_B, CPH),
  ...still("2026-01-04 09:45", "2026-01-04 11:00", CPH),
  flight("2026-01-04 11:00", "2026-01-04 12:10", "flight-inference", "inferred", { iata: "CPH" }, { icao: "ENGM" }, undefined, "2026-01-04"),
  ...go("2026-01-04 11:00", "2026-01-04 12:10", CPH, OSL, 10),
  ...still("2026-01-04 12:10", "2026-01-04 12:40", OSL),
  ...go("2026-01-04 12:40", "2026-01-04 13:25", OSL, OFFICE),
  ...still("2026-01-04 13:25", "2026-01-04 14:30", OFFICE),
  event("2026-01-04 13:30", "2026-01-04 14:00", "Debrief", { location: "Office", attendees: [attendee(email("anders@example.org"), "Anders Vik")] }),
  ...go("2026-01-04 14:30", "2026-01-04 14:50", OFFICE, HOME),
  ...still("2026-01-04 14:50", "2026-01-05 19:00", HOME),

  // --- 2026-01-05 Mon: the tracker sleeps from 19:00; the night is in transit -----------------
  // --- 2026-01-06 Tue to 01-08 Thu: aboard Solvind, two anchorages, then a flat near home -----
  ...still("2026-01-05 06:00", "2026-01-06 10:00", MARINA, 10, "solvind"),
  ...still("2026-01-06 08:00", "2026-01-06 10:00", MARINA),
  ...go("2026-01-06 10:00", "2026-01-06 13:00", MARINA, ANCHORAGE_1),
  ...go("2026-01-06 10:00", "2026-01-06 13:00", MARINA, ANCHORAGE_1, 10, "solvind"),
  ...still("2026-01-06 13:00", "2026-01-07 10:00", ANCHORAGE_1),
  ...still("2026-01-06 13:00", "2026-01-07 10:00", ANCHORAGE_1, 10, "solvind"),
  note("2026-01-06 14:00", "At anchor with Ola Nordmann."),
  ...go("2026-01-07 10:00", "2026-01-07 12:00", ANCHORAGE_1, ANCHORAGE_2),
  ...go("2026-01-07 10:00", "2026-01-07 12:00", ANCHORAGE_1, ANCHORAGE_2, 10, "solvind"),
  ...still("2026-01-07 12:00", "2026-01-08 09:00", ANCHORAGE_2),
  ...still("2026-01-07 12:00", "2026-01-08 09:00", ANCHORAGE_2, 10, "solvind"),
  ...go("2026-01-08 09:00", "2026-01-08 12:00", ANCHORAGE_2, MARINA),
  ...go("2026-01-08 09:00", "2026-01-08 12:00", ANCHORAGE_2, MARINA, 10, "solvind"),
  ...still("2026-01-08 12:00", "2026-01-08 12:30", MARINA),
  ...still("2026-01-08 12:00", "2026-01-09 00:00", MARINA, 10, "solvind"),
  ...go("2026-01-08 12:30", "2026-01-08 12:45", MARINA, FLAT),
  ...still("2026-01-08 12:45", "2026-01-09 09:00", FLAT),

  // --- 2026-01-09 Fri: home, then a night 300 m from home ------------------------------------
  ...go("2026-01-09 09:00", "2026-01-09 09:15", FLAT, HOME),
  ...still("2026-01-09 09:15", "2026-01-09 18:00", HOME),
  ...still("2026-01-09 18:05", "2026-01-10 09:00", NEAR_HOME),

  // --- 2026-01-10 Sat to 01-12 Mon: two nights at a camp on the ice sheet ----------------------
  ...still("2026-01-10 09:05", "2026-01-10 13:00", HOME),
  ...still("2026-01-10 14:00", "2026-01-12 10:00", CAMP, 30),
  ...still("2026-01-12 11:00", "2026-01-13 20:00", HOME),
  // --- 2026-01-13 Tue: the tracker is silent from 20:00; the night is in transit, alone ------
];

lines.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.kind === "location" ? 0 : 1) - (b.kind === "location" ? 0 : 1));
let prev = ZERO;
const byMonth = new Map();
lines.forEach((l, i) => {
  const full = { id: id(i), seq: i + 1, ...l, tz: TZ, recorded_at: RECORDED, prev, hash: "" };
  full.hash = hashLine(full);
  prev = full.hash;
  const month = full.at.slice(0, 7);
  byMonth.set(month, [...(byMonth.get(month) ?? []), canonicalize(full)]);
});
rmSync(join(root, "logbook"), { recursive: true, force: true });
for (const [month, out] of byMonth) {
  const dir = join(root, "logbook", month.slice(0, 4));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${month.slice(5, 7)}.jsonl`), `${out.join("\n")}\n`, "utf-8");
}
mkdirSync(join(root, "policy"), { recursive: true });
const meta = {
  format: "logbook/0.2",
  owner_id: KARI,
  created_at: "2025-12-01T07:00:00Z",
  timezone: TZ,
  owner_emails: ["kari.nordmann@example.org"],
  seq: lines.length,
  head: prev,
};
writeFileSync(join(root, "logbook.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
writeFileSync(join(root, "places.json"), `${JSON.stringify({
  Home: { lat: HOME[0], lon: HOME[1], radius_m: 120, kind: "home", country: "NO" },
  Office: { lat: OFFICE[0], lon: OFFICE[1], radius_m: 120, kind: "other" },
  Marina: { lat: MARINA[0], lon: MARINA[1], radius_m: 150, kind: "asset-berth", tags: ["boat"] },
  Messe: { lat: MESSE[0], lon: MESSE[1], radius_m: 200, kind: "other" },
  Kiosk: { lat: KIOSK[0], lon: KIOSK[1], radius_m: 50, kind: "other" },
}, null, 2)}\n`, "utf-8");
writeFileSync(join(root, "assets.json"), `${JSON.stringify({ assets: [{ id: "solvind", kind: "yacht", name: "Solvind", mmsi: "999000001" }] }, null, 2)}\n`, "utf-8");
writeFileSync(join(root, "policy", "owner.json"), `${JSON.stringify({ names: ["Kari"], emails: [], phones: [] }, null, 2)}\n`, "utf-8");
writeFileSync(join(root, "policy", "stays.json"), `${JSON.stringify({
  stay_min_s: 1200, stop_min_s: 180, merge_gap_s: 600, radius_m: 150, airport_km: 8, night: ["22:00", "08:00"],
  modes: { walk_max_kmh: 7, car_max_kmh: 130, flight_min_kmh: 150 }, aboard_window_s: 300,
}, null, 2)}\n`, "utf-8");
process.stdout.write(`trips-sample: ${lines.length} lines, head ${prev}\n`);
