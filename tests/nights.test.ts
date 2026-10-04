import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type NightsYear, NO_HOME_NIGHTS, renderNights, rollupNights } from "../src/nights.js";
import { verifyLogbook } from "../src/store.js";
import { cleanup, expectedWindows, FIXTURES } from "./helpers.js";

afterEach(cleanup);

const NIGHTS_SAMPLE = join(FIXTURES, "nights-sample");
const TRIPS_SAMPLE = join(FIXTURES, "trips-sample");
const FIXTURE_NAMES = [
  "nights-sample",
  "trips-sample",
  "day-sample",
  "demo-sample",
  "sample-logbook",
  "demo-seed1",
];

describe("the nights fixture", () => {
  it("is a valid logbook/0.2 record", () => {
    expect(verifyLogbook(NIGHTS_SAMPLE).errors).toEqual([]);
  });
});

describe("rollup nights, as the reference's `logbook rollup nights` prints it", () => {
  // tests/fixtures/*/expected-nights/ is the reference's own output on each fixture, captured by
  // tests/fixtures/capture-expected-trips.mjs and never edited; tests/cross-impl.test.ts checks it stays so.
  for (const name of FIXTURE_NAMES) {
    const root = join(FIXTURES, name);
    for (const expected of expectedWindows(root, "nights")) {
      it(`prints ${name} (${expected.name}) as the reference does, as text and as JSON`, () => {
        const nights = rollupNights(root, expected.options);
        expect(JSON.parse(JSON.stringify(nights))).toEqual(expected.json);
        expect(renderNights(nights)).toBe(expected.text);
      });
    }
  }
});

describe("what the nights rollup counts", () => {
  const year = (root: string, y: string, options = {}): NightsYear =>
    rollupNights(root, options).years.find((x) => x.year === y) as NightsYear;

  it("counts every night of a year as home, away or in transit, and the nights aboard per asset", () => {
    expect(year(NIGHTS_SAMPLE, "2026")).toMatchObject({
      home: 2,
      away: 6,
      in_transit: 0,
      aboard: { zeta: 1, alpha: 2 },
    });
    expect(year(TRIPS_SAMPLE, "2026")).toMatchObject({
      home: 3,
      away: 8,
      in_transit: 2,
      aboard: { solvind: 2 },
    });
  });

  it("names no longest trip in a year whose every night is at home", () => {
    expect(year(NIGHTS_SAMPLE, "2025")).toMatchObject({ home: 3, away: 0, longest_trip: null });
    expect(renderNights(rollupNights(NIGHTS_SAMPLE, { year: "2025" }))).toBe(
      "nights 2025-12-29 – 2025-12-31\n  2025  3 home · 0 away · 0 in transit\n",
    );
  });

  it("takes the longest run of nights not at home, the earlier of two as long, nights in transit counted in", () => {
    // Three nights aboard and three at the cabin: the run aboard came first.
    expect(year(NIGHTS_SAMPLE, "2026").longest_trip).toMatchObject({
      start: "2026-01-01",
      end: "2026-01-03",
      nights: 3,
    });
    // The night of the 5th is in transit and opens the run; the trip the reference's `trips` prints there.
    expect(year(TRIPS_SAMPLE, "2026").longest_trip).toMatchObject({
      start: "2026-01-05",
      end: "2026-01-08",
      nights: 4,
    });
  });

  it("clips a run of nights at the turn of the year, each year keeping its part", () => {
    expect(year(TRIPS_SAMPLE, "2025").longest_trip).toMatchObject({
      start: "2025-12-30",
      end: "2025-12-31",
      nights: 2,
    });
    const clipped = rollupNights(TRIPS_SAMPLE, { since: "2025-12-31", until: "2026-01-06" });
    expect(clipped.years.map((y) => [y.year, y.longest_trip?.start, y.longest_trip?.end])).toEqual([
      ["2025", "2025-12-31", "2025-12-31"],
      ["2026", "2026-01-01", "2026-01-03"],
    ]);
  });

  it("carries the first and last location line of each night's stay, a night in transit none, under the year and under the longest trip", () => {
    const y = year(NIGHTS_SAMPLE, "2026");
    expect(y.lines).toHaveLength(2 * (y.home + y.away));
    expect(y.longest_trip?.lines).toEqual(y.lines.slice(0, 6));
    expect(year(TRIPS_SAMPLE, "2026").lines).toHaveLength(22);
  });

  it("lists the nights aboard by asset id in the text, and says `night` for one", () => {
    expect(renderNights(rollupNights(NIGHTS_SAMPLE, { year: "2026" }))).toContain(
      " · 2 nights aboard alpha · 1 night aboard zeta · longest trip ",
    );
  });

  it("counts every night as away without a place of kind home, says so, and still keeps nights in transit apart", () => {
    const sample = rollupNights(join(FIXTURES, "sample-logbook"), {});
    expect(sample.warning).toBe(NO_HOME_NIGHTS);
    expect(sample.years[0]).toMatchObject({ home: 0, away: 0, in_transit: 8 });
    expect(sample.years[0]?.longest_trip).toEqual({
      start: "2026-03-01",
      end: "2026-03-08",
      nights: 8,
      lines: [],
    });
    expect(renderNights(sample)).toBe(
      "nights 2026-03-01 – 2026-03-08\n  (no place of kind home in places.json: every night counts as away)\n  2026  0 home · 0 away · 8 in transit · longest trip 2026-03-01 – 2026-03-08 (8 nights)\n",
    );
  });

  it("prints `nothing in the window` for a window the record has no day in, with no warning", () => {
    const empty = rollupNights(join(FIXTURES, "sample-logbook"), { year: "2030" });
    expect(empty).toEqual({
      kind: "nights",
      window: { since: null, until: null, days: [] },
      years: [],
    });
    expect(renderNights(empty)).toBe("nights\n  nothing in the window\n");
  });
});
