import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAssets } from "../src/settings.js";
import { verifyLogbook } from "../src/store.js";
import { readTrips, renderTrips, type Trip } from "../src/trips.js";
import { cleanup, copySample, expectedWindows, FIXTURES, tempDir } from "./helpers.js";

afterEach(cleanup);

const TRIPS_SAMPLE = join(FIXTURES, "trips-sample");
const FIXTURE_NAMES = [
  "trips-sample",
  "nights-sample",
  "day-sample",
  "demo-sample",
  "sample-logbook",
  "demo-seed1",
];

/** A writable copy of a fixture, without the expected output beside it. */
function copyOf(name: string): string {
  const copy = join(tempDir(), name);
  cpSync(join(FIXTURES, name), copy, {
    recursive: true,
    filter: (src) => !src.includes("expected-"),
  });
  return copy;
}

describe("the trips fixture", () => {
  it("is a valid logbook/0.2 record", () => {
    expect(verifyLogbook(TRIPS_SAMPLE).errors).toEqual([]);
  });
});

describe("trips, as the reference's `logbook trips` prints them", () => {
  // tests/fixtures/*/expected-trips/ is the reference's own output on each fixture, captured by
  // tests/fixtures/capture-expected-trips.mjs and never edited; tests/cross-impl.test.ts checks it stays so.
  for (const name of FIXTURE_NAMES) {
    const root = join(FIXTURES, name);
    for (const expected of expectedWindows(root, "trips")) {
      it(`prints ${name} (${expected.name}) as the reference does, as text and as JSON`, () => {
        const trips = readTrips(root, expected.options);
        expect(JSON.parse(JSON.stringify(trips))).toEqual(expected.json);
        expect(renderTrips(trips, readAssets(root))).toBe(expected.text);
      });
    }
  }
});

describe("what a trip is", () => {
  const all = () => readTrips(TRIPS_SAMPLE, {});
  const trip = (index: number): Trip => all().trips[index] as Trip;

  it("is a run of days whose night is away or in transit, over the turn of the year, with its id from its days", () => {
    expect(all().trips.map((t) => t.id)).toEqual([
      "trip:2025-12-30:2026-01-03",
      "trip:2026-01-05:2026-01-08",
      "trip:2026-01-10:2026-01-11",
    ]);
    expect(trip(0)).toMatchObject({
      start: "2025-12-30",
      end: "2026-01-03",
      until: "2026-01-04",
      nights: 5,
    });
  });

  it("counts a night the tracker slept through as in transit and part of the trip, but a run of such nights alone is no trip", () => {
    expect(trip(1)).toMatchObject({ start: "2026-01-05", nights: 4, in_transit: 1 });
    expect(all().window?.until).toBe("2026-01-13"); // the last night is in transit, after a night at home
    expect(all().trips).toHaveLength(3);
  });

  it("reads a night 300 m from home as home whatever the place's radius, and one 600 m away as away, labelled near home", () => {
    expect(trip(1).route).toEqual(["aboard Solvind", "59.9193,10.7522 near Home, 0.6 km"]);
    expect(trip(1).end).toBe("2026-01-08"); // the night of the 9th, 300 m from home, is at home
  });

  it("names the asset when every night with a stay was aboard it, and counts the nights aboard otherwise", () => {
    expect(trip(1)).toMatchObject({ asset: null, nights_aboard: { solvind: 2 } });
    const clipped = readTrips(TRIPS_SAMPLE, { since: "2025-12-31", until: "2026-01-06" });
    expect(clipped.trips[1]).toMatchObject({ asset: "solvind", nights: 2, in_transit: 1 });
  });

  it("folds consecutive nights at one place into one route element and labels an airport hotel by its airport", () => {
    expect(trip(0).route).toEqual([
      "53.5700,10.0130 (Hamburg)",
      "CPH, Copenhagen",
      "55.6850,12.5500 (Copenhagen)",
    ]);
    expect(trip(2).route).toEqual(["76.0000,-40.0000"]);
  });

  it("lists the named places stayed at from the first day to the day after, never home, never a stop", () => {
    expect(trip(0).places).toEqual(["Messe", "Office"]);
  });

  it("lists at most twelve people, most evidence first and then by name, each with the lines that put them there", () => {
    const people = trip(0).people;
    expect(people.map((p) => `${p.name} ${p.lines.length} ${p.confidence}`)).toEqual([
      "Freja Lund 3 1", // a note, and two photos taken during the stay, wherever their coordinates say
      "Guest 01 2 0.8", // a calendar entry, and a face tagged at the same stay the day after
      "Liv Berg 2 0.8", // two calendar entries at two stays
      "Anders Vik 1 0.8", // at the office on the day after the last night
      ...Array.from({ length: 8 }, (_, i) => `Guest ${String(i + 2).padStart(2, "0")} 1 0.8`),
    ]);
    expect(trip(1).people.map((p) => p.name)).toEqual(["Ola Nordmann"]);
    expect(trip(2).people).toEqual([]);
  });

  it("takes the flights of its first day as in, of the day after as out, and lists every flight in between", () => {
    expect(trip(0).flights_in.map((f) => `${f.carrier} ${f.number} ${f.from} → ${f.to}`)).toEqual([
      "XY 101 OSL → HAM",
    ]);
    expect(trip(0).flights_out.map((f) => `${f.carrier} ${f.number} ${f.from} → ${f.to}`)).toEqual([
      "null null CPH → ENGM",
    ]);
    expect(trip(0).flights.map((f) => f.date)).toEqual(["2025-12-30", "2026-01-01", "2026-01-04"]);
  });

  it("carries the lines behind it: the night stays once each, the flights, the people listed", () => {
    expect(trip(0).lines).toHaveLength(19);
    expect(trip(1).lines).toHaveLength(5); // the run aboard is one stay over two nights
  });

  it("clips the window to the record's days and to the year or range asked for", () => {
    const year = readTrips(TRIPS_SAMPLE, { year: "2025" });
    expect(year.window).toMatchObject({ since: "2025-12-28", until: "2025-12-31" });
    expect(year.trips.map((t) => t.id)).toEqual(["trip:2025-12-30:2025-12-31"]);
    expect(year.trips[0]?.flights_out).toEqual([]); // the day after is outside the window
    const wide = readTrips(TRIPS_SAMPLE, { since: "2025-01-01", until: "2027-01-01" });
    expect(wide.window).toMatchObject({ since: "2025-12-28", until: "2026-01-13" });
    expect(wide.window?.days).toHaveLength(17);
  });

  it("says so when the window has no days", () => {
    const none = readTrips(TRIPS_SAMPLE, { year: "2024" });
    expect(none).toEqual({ window: null, trips: [] });
    expect(renderTrips(none, [])).toBe("no trips: the record has no days\n");
  });

  it("says so when there are days but no trips", () => {
    const quiet = readTrips(TRIPS_SAMPLE, { since: "2025-12-28", until: "2025-12-29" });
    expect(quiet.trips).toEqual([]);
    expect(renderTrips(quiet, [])).toBe("trips 2025-12-28 – 2025-12-29: no trips\n");
  });

  it("warns, and finds no trips, when places.json names no home", () => {
    const copy = copyOf("trips-sample");
    const places = JSON.parse(readFileSync(join(copy, "places.json"), "utf-8")) as Record<
      string,
      Record<string, unknown>
    >;
    (places.Home as Record<string, unknown>).kind = "other";
    writeFileSync(join(copy, "places.json"), JSON.stringify(places), "utf-8");
    const trips = readTrips(copy, {});
    expect(trips.trips).toEqual([]);
    expect(trips.warning).toBe(
      "no place of kind home in places.json: nothing is away from home, so there are no trips",
    );
    expect(renderTrips(trips, [])).toBe(
      "trips 2025-12-28 – 2026-01-13: no place of kind home in places.json: nothing is away from home, so there are no trips\n",
    );
  });

  it("reads the conformance sample, which has no places, without a word about them", () => {
    const trips = readTrips(copySample(), {});
    expect(trips.trips).toEqual([]);
    expect(trips.warning).toMatch(/no place of kind home/);
  });

  it("refuses a bound that is not a day, a range that runs backwards, and a year with a bound", () => {
    expect(() => readTrips(TRIPS_SAMPLE, { since: "2026-01-32" })).toThrow(/not a day/);
    expect(() => readTrips(TRIPS_SAMPLE, { since: "2026-01-05", until: "2026-01-04" })).toThrow(
      /backwards/,
    );
    expect(() => readTrips(TRIPS_SAMPLE, { year: "2026", since: "2026-01-05" })).toThrow(
      /not both/,
    );
  });
});
