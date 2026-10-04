import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addDays } from "../src/clock.js";
import { rollupNights } from "../src/nights.js";
import { readTrips } from "../src/trips.js";
import { cleanup, tempDir, writeMeta, writeRecord } from "./helpers.js";

afterEach(cleanup);

const HOME = { lat: 59.9139, lon: 10.7522 };
const OFFICE = { lat: 59.91, lon: 10.76 };

/**
 * A record of `months` months of one routine — home, the office, home, a point every ten minutes,
 * a note at lunch — written straight to the month files. The readers over a window never verify,
 * so the chain fields are placeholders; what matters is the shape and the size.
 */
function routine(months: number): string {
  const root = join(tempDir(), "routine");
  mkdirSync(join(root, "logbook", "2025"), { recursive: true });
  mkdirSync(join(root, "logbook", "2026"), { recursive: true });
  writeMeta(root, {
    format: "logbook/0.2",
    owner_id: "00000000-0000-4000-8000-000000000006",
    created_at: "2025-01-01T00:00:00Z",
    timezone: "Europe/Oslo",
    seq: 0,
    head: "0".repeat(64),
  });
  writeFileSync(
    join(root, "places.json"),
    JSON.stringify({
      Home: { ...HOME, radius_m: 120, kind: "home", country: "NO" },
      Office: { ...OFFICE, radius_m: 120, kind: "other" },
    }),
    "utf-8",
  );
  const files = new Map<string, string[]>();
  let seq = 0;
  const line = (at: string, kind: string, payload: Record<string, unknown>): void => {
    seq += 1;
    const month = at.slice(0, 7);
    const list = files.get(month) ?? [];
    list.push(
      JSON.stringify({
        id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
        seq,
        at,
        end: null,
        tz: "Europe/Oslo",
        source: kind === "note" ? "manual" : "sim-phone",
        kind,
        tier: kind === "note" ? 2 : 1,
        payload,
        recorded_at: at,
        prev: "0".repeat(64),
        hash: "0".repeat(64),
      }),
    );
    files.set(month, list);
  };
  let day = "2025-03-01";
  for (let d = 0; d < months * 30; d++) {
    for (let minute = 0; minute < 1440; minute += 10) {
      const atOffice = minute >= 9 * 60 && minute < 17 * 60;
      const where = atOffice ? OFFICE : HOME;
      const at = new Date(Date.parse(`${day}T00:00:00Z`) + minute * 60_000).toISOString();
      line(at.replace(".000Z", "Z"), "location", {
        schema: "location/v1",
        lat: where.lat,
        lon: where.lon,
        accuracy_m: 10,
      });
    }
    line(`${day}T11:00:00Z`, "note", { schema: "note/v1", text: "Lunch at the desk." });
    day = addDays(day, 1);
  }
  for (const [month, lines] of files) {
    writeFileSync(
      join(root, "logbook", month.slice(0, 4), `${month.slice(5, 7)}.jsonl`),
      `${lines.join("\n")}\n`,
      "utf-8",
    );
  }
  return root;
}

describe("the reading of a window", () => {
  it("holds a month's lines and the open stay at most, however long the record", () => {
    const short = { peakHeld: 0 };
    const two = readTrips(routine(2), {}, short);
    const long = { peakHeld: 0 };
    const eight = readTrips(routine(8), {}, long);
    expect(two.trips).toEqual([]);
    expect(eight.trips).toEqual([]);
    expect(eight.window?.days.length).toBeGreaterThanOrEqual(240);
    expect(short.peakHeld).toBeGreaterThan(0);
    // Four times the record, the same high-water mark: one month file's lines plus what is open.
    expect(long.peakHeld).toBeLessThanOrEqual(short.peakHeld * 1.05);
    expect(long.peakHeld).toBeLessThan(31 * 145 * 1.5);
  });
});

describe("the window of the readers over a window", () => {
  const point = (at: string, lat: number, lon: number, subject?: string) => ({
    at,
    source: subject === undefined ? "sim-phone" : "ais",
    kind: "location",
    tier: 1 as const,
    payload: {
      schema: "location/v1",
      lat,
      lon,
      accuracy_m: 10,
      ...(subject === undefined ? {} : { subject, tracker: "aisstream" }),
    },
  });

  it("runs from the first to the last local day with a location line, an asset's included, a note's not", () => {
    // The yacht reports two days before the owner's first point and three days after the last; a note later still.
    const points = [
      point("2026-01-01T10:00:00Z", 59.905, 10.735, "zeta"),
      point("2026-01-07T10:00:00Z", 59.905, 10.735, "zeta"),
      {
        at: "2026-01-09T12:00:00Z",
        source: "manual",
        kind: "note",
        tier: 2 as const,
        payload: { schema: "note/v1", text: "later" },
      },
    ];
    for (
      let ms = Date.parse("2026-01-03T11:00:00Z");
      ms <= Date.parse("2026-01-04T22:50:00Z");
      ms += 600_000
    ) {
      points.push(point(new Date(ms).toISOString().replace(".000Z", "Z"), HOME.lat, HOME.lon));
    }
    const root = writeRecord(points);
    writeFileSync(
      join(root, "places.json"),
      JSON.stringify({ Home: { ...HOME, radius_m: 120, kind: "home", country: "NO" } }),
      "utf-8",
    );
    const nights = rollupNights(root, {});
    expect(nights.window).toMatchObject({ since: "2026-01-01", until: "2026-01-07" });
    expect(nights.years[0]).toMatchObject({ home: 2, away: 0, in_transit: 5 });
    expect(readTrips(root, {}).window?.days).toHaveLength(7);
  });
});
