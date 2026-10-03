// Regenerates this fixture from the lists below. Run after `pnpm build`:
//   node tests/fixtures/nights-sample/make.mjs
// Eleven days of a person in Oslo who does not exist, over the turn of the year 2025–26, laid out
// for the rules `rollup nights` follows that the other fixtures have no case of: a year whose every
// night is at home (no longest trip), nights aboard two yachts, the one boarded later with more
// nights (the text lists them by id, Alpha before Zeta), and two runs away of three nights each,
// one aboard and one at a cabin, so the longest trip is a tie and the earlier run is named. The
// rest is a day at home between them and a last evening at home. Everything is synthetic: the
// yachts carry MMSIs 999000011 and 999000012, which do not exist.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, hashLine } from "../../../dist/index.js";

const root = dirname(fileURLToPath(import.meta.url));
const TZ = "Europe/Oslo";
const RECORDED = "2026-01-09T18:00:00Z";
const ZERO = "0".repeat(64);
const id = (n) => `00000000-0000-4000-8000-0000000006${String(n).padStart(2, "0")}`;
const KARI = "00000000-0000-4000-8000-000000000006";

/** `YYYY-MM-DD HH:MM` on the Oslo clock (UTC+1 in winter) as an RFC 3339 UTC instant. */
const utc = (local) => new Date(`${local.replace(" ", "T")}:00+01:00`).toISOString().replace(".000Z", "Z");
const point = (at, lat, lon, subject) => ({
  at,
  end: null,
  source: subject ? "ais" : "sim-phone",
  kind: "location",
  tier: 1,
  payload: { schema: "location/v1", lat, lon, accuracy_m: 10, ...(subject ? { subject, tracker: "aisstream" } : {}) },
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
    out.push(point(at, +(from[0] + (to[0] - from[0]) * f).toFixed(6), +(from[1] + (to[1] - from[1]) * f).toFixed(6), subject));
  }
  return out;
}
/** Points every `stepMin` minutes staying at one spot, from `startAt` to `endAt` inclusive. */
const still = (startAt, endAt, at, stepMin = 10, subject) => track(startAt, endAt, at, at, stepMin, subject);
/** A journey, its two ends left out (they are the last and first points of the stays around it). */
const go = (startAt, endAt, from, to, stepMin = 5, subject) => track(startAt, endAt, from, to, stepMin, subject).slice(1, -1);

const HOME = [59.9139, 10.7522];
const MARINA = [59.905, 10.735]; // Zeta's berth
const BERTH = [59.9, 10.72]; // Alpha's berth, a named place
const ANCHORAGE_1 = [59.8, 10.6];
const ANCHORAGE_2 = [59.75, 10.55];
const ANCHORAGE_3 = [59.7, 10.5];
const CABIN = [60.6, 9.1]; // unnamed, in the mountains

const lines = [
  // --- 2025-12-29 Mon to 12-31 Wed: three nights at home; the year has no night away -----------
  ...still("2025-12-29 12:00", "2026-01-01 09:00", HOME),

  // --- 2026-01-01 Thu: aboard Zeta to the first anchorage ----------------------------------------
  ...still("2026-01-01 06:00", "2026-01-01 11:00", MARINA, 10, "zeta"),
  ...go("2026-01-01 09:00", "2026-01-01 10:00", HOME, MARINA),
  ...still("2026-01-01 10:00", "2026-01-01 11:00", MARINA),
  ...go("2026-01-01 11:00", "2026-01-01 13:00", MARINA, ANCHORAGE_1),
  ...go("2026-01-01 11:00", "2026-01-01 13:00", MARINA, ANCHORAGE_1, 10, "zeta"),
  ...still("2026-01-01 13:00", "2026-01-02 09:00", ANCHORAGE_1),
  ...still("2026-01-01 13:00", "2026-01-02 09:00", ANCHORAGE_1, 10, "zeta"),

  // --- 2026-01-02 Fri: back to the marina, over to Alpha, two nights aboard her -----------------
  ...go("2026-01-02 09:00", "2026-01-02 11:00", ANCHORAGE_1, MARINA),
  ...go("2026-01-02 09:00", "2026-01-02 11:00", ANCHORAGE_1, MARINA, 10, "zeta"),
  ...still("2026-01-02 11:00", "2026-01-04 00:00", MARINA, 10, "zeta"),
  ...still("2026-01-02 11:00", "2026-01-02 11:30", MARINA),
  ...still("2026-01-02 06:00", "2026-01-02 13:00", BERTH, 10, "alpha"),
  ...go("2026-01-02 11:30", "2026-01-02 12:00", MARINA, BERTH),
  ...still("2026-01-02 12:00", "2026-01-02 13:00", BERTH),
  ...go("2026-01-02 13:00", "2026-01-02 15:00", BERTH, ANCHORAGE_2),
  ...go("2026-01-02 13:00", "2026-01-02 15:00", BERTH, ANCHORAGE_2, 10, "alpha"),
  ...still("2026-01-02 15:00", "2026-01-03 10:00", ANCHORAGE_2),
  ...still("2026-01-02 15:00", "2026-01-03 10:00", ANCHORAGE_2, 10, "alpha"),
  ...go("2026-01-03 10:00", "2026-01-03 12:00", ANCHORAGE_2, ANCHORAGE_3),
  ...go("2026-01-03 10:00", "2026-01-03 12:00", ANCHORAGE_2, ANCHORAGE_3, 10, "alpha"),
  ...still("2026-01-03 12:00", "2026-01-04 09:00", ANCHORAGE_3),
  ...still("2026-01-03 12:00", "2026-01-04 09:00", ANCHORAGE_3, 10, "alpha"),

  // --- 2026-01-04 Sun: ashore, a night at home ---------------------------------------------------
  ...go("2026-01-04 09:00", "2026-01-04 11:00", ANCHORAGE_3, BERTH),
  ...go("2026-01-04 09:00", "2026-01-04 11:00", ANCHORAGE_3, BERTH, 10, "alpha"),
  ...still("2026-01-04 11:00", "2026-01-04 11:30", BERTH),
  ...still("2026-01-04 11:00", "2026-01-05 00:00", BERTH, 10, "alpha"),
  ...go("2026-01-04 11:30", "2026-01-04 12:00", BERTH, HOME),
  ...still("2026-01-04 12:00", "2026-01-05 08:00", HOME),

  // --- 2026-01-05 Mon to 01-07 Wed: three nights at a cabin, as many as aboard -----------------
  ...go("2026-01-05 08:00", "2026-01-05 10:00", HOME, CABIN),
  ...still("2026-01-05 10:00", "2026-01-08 09:00", CABIN),

  // --- 2026-01-08 Thu: home for the evening ----------------------------------------------------
  ...go("2026-01-08 09:00", "2026-01-08 11:00", CABIN, HOME),
  ...still("2026-01-08 11:00", "2026-01-08 23:50", HOME),
];

lines.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
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
  Marina: { lat: MARINA[0], lon: MARINA[1], radius_m: 150, kind: "asset-berth", tags: ["boat"] },
  Berth: { lat: BERTH[0], lon: BERTH[1], radius_m: 150, kind: "asset-berth", tags: ["boat"] },
}, null, 2)}\n`, "utf-8");
writeFileSync(join(root, "assets.json"), `${JSON.stringify({ assets: [
  { id: "zeta", kind: "yacht", name: "Zeta", mmsi: "999000011" },
  { id: "alpha", kind: "yacht", name: "Alpha", mmsi: "999000012" },
] }, null, 2)}\n`, "utf-8");
writeFileSync(join(root, "policy", "owner.json"), `${JSON.stringify({ names: ["Kari"], emails: [], phones: [] }, null, 2)}\n`, "utf-8");
writeFileSync(join(root, "policy", "stays.json"), `${JSON.stringify({
  stay_min_s: 1200, stop_min_s: 180, merge_gap_s: 600, radius_m: 150, airport_km: 8, night: ["22:00", "08:00"],
  modes: { walk_max_kmh: 7, car_max_kmh: 130, flight_min_kmh: 150 }, aboard_window_s: 300,
}, null, 2)}\n`, "utf-8");
process.stdout.write(`nights-sample: ${lines.length} lines, head ${prev}\n`);
