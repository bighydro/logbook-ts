import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NIGHTS_NO_HOME, type Nights, renderNights, rollupNights } from "../src/nights.js";
import { cleanup, expectedWindows, FIXTURES } from "./helpers.js";

afterEach(cleanup);

const TRIPS_SAMPLE = join(FIXTURES, "trips-sample");
const FIXTURE_NAMES = [
  "sample-logbook",
  "demo-seed-1",
  "day-sample",
  "trips-sample",
  "demo-sample",
  "show-sample",
  "profiles-sample",
];

describe("rollup nights, as the reference prints it", () => {
  // tests/fixtures/*/expected-nights/ is the reference's own output on each fixture, captured by
  // tests/fixtures/capture-expected-readers.mjs and never edited; tests/cross-impl.test.ts checks it stays so.
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
  const all = (): Nights => rollupNights(TRIPS_SAMPLE, {});
  const year = (y: string) => all().years.find((x) => x.year === y);

  it("counts each night of a year as home, away or in transit, and the nights aboard each asset", () => {
    expect(year("2025")).toMatchObject({ home: 2, away: 2, in_transit: 0, aboard: {} });
    expect(year("2026")).toMatchObject({ home: 3, away: 8, in_transit: 2, aboard: { solvind: 2 } });
  });

  it("finds the longest run of nights not at home within each year: a trip over the turn of the year is cut there", () => {
    // 2025-12-30 to 2026-01-03 is one trip of five nights; the rollup sees two nights in 2025 and three in 2026.
    expect(year("2025")?.longest_trip).toMatchObject({
      start: "2025-12-30",
      end: "2025-12-31",
      nights: 2,
    });
    // In 2026 the yacht's run, with its night in transit and the night 600 m from home, is the longest: four.
    expect(year("2026")?.longest_trip).toMatchObject({
      start: "2026-01-05",
      end: "2026-01-08",
      nights: 4,
    });
  });

  it("carries the first and last location line of every night's stay, a night in transit adding none", () => {
    const y = year("2026") as NonNullable<ReturnType<typeof year>>;
    expect(y.lines.length).toBe((y.home + y.away) * 2);
    expect(y.longest_trip?.lines.length).toBe(3 * 2);
  });

  it("has no longest trip when every night was at home, and says so when there is no home place", () => {
    const home = rollupNights(join(FIXTURES, "demo-seed-1"), {
      since: "2026-06-01",
      until: "2026-06-05",
    });
    expect(home.years[0]).toMatchObject({ home: 5, away: 0, in_transit: 0, longest_trip: null });
    expect(home.warning).toBeUndefined();
    expect(renderNights(home)).toBe(
      "nights 2026-06-01 – 2026-06-05\n  2026  5 home · 0 away · 0 in transit\n",
    );
    const noHome = rollupNights(join(FIXTURES, "sample-logbook"), {});
    expect(noHome.warning).toBe(NIGHTS_NO_HOME);
    expect(noHome.years[0]).toMatchObject({ home: 0, away: 0, in_transit: 8 });
    expect(renderNights(noHome).split("\n")[1]).toBe(`  (${NIGHTS_NO_HOME})`);
  });

  it("is empty, without a warning, when the window has no days", () => {
    const empty = rollupNights(join(FIXTURES, "sample-logbook"), { year: "2025" });
    expect(empty).toEqual({
      kind: "nights",
      window: { since: null, until: null, days: [] },
      years: [],
    });
    expect(renderNights(empty)).toBe("nights\n  nothing in the window\n");
  });
});
