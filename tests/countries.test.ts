import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Countries, renderCountries, rollupCountries } from "../src/countries.js";
import { cleanup, expectedWindows, FIXTURES } from "./helpers.js";

afterEach(cleanup);

const TRIPS_SAMPLE = join(FIXTURES, "trips-sample");

describe("rollup countries, as the reference prints it", () => {
  // The conformance sample and the seed-1 demo record among them: the sample's window ends on a
  // vessel's location line, which this implementation once left out of the track.
  for (const name of [
    "trips-sample",
    "day-sample",
    "demo-sample",
    "sample-logbook",
    "demo-seed-1",
    "show-sample",
    "profiles-sample",
  ]) {
    const root = join(FIXTURES, name);
    for (const expected of expectedWindows(root, "countries")) {
      it(`prints ${name} (${expected.name}) as the reference does, as text and as JSON`, () => {
        const countries = rollupCountries(root, expected.options);
        expect(JSON.parse(JSON.stringify(countries))).toEqual(expected.json);
        expect(renderCountries(countries)).toBe(expected.text);
      });
    }
  }
});

describe("what the countries rollup counts", () => {
  const all = (): Countries => rollupCountries(TRIPS_SAMPLE, {});
  const year = (y: string) => all().years.find((x) => x.year === y);

  it("counts each day for the country of its overnight stay, per year, most days first and then by name", () => {
    expect(year("2025")?.countries.map((c) => `${c.country} ${c.days}`)).toEqual(["DE 2", "NO 2"]);
    expect(year("2026")?.countries.map((c) => `${c.country} ${c.days}`)).toEqual(["NO 6", "DK 3"]);
  });

  it("takes the country from the place when the stay lies in one with a country, else from the nearest large airport's zone", () => {
    expect(year("2026")?.countries[0]?.by).toEqual({ place: 2, airport: 4 });
    expect(year("2025")?.countries[0]?.by).toEqual({ airport: 2 });
  });

  it("keeps nights in transit and nights no airport is near apart, with the lines of the latter", () => {
    expect(year("2026")?.in_transit).toEqual({
      days: 2,
      dates: ["2026-01-05", "2026-01-13"],
      lines: [],
    });
    expect(year("2026")?.unknown).toMatchObject({ days: 2, dates: ["2026-01-10", "2026-01-11"] });
    expect(year("2026")?.unknown.lines).toHaveLength(4);
  });

  it("says so when the window has no days", () => {
    const none = rollupCountries(TRIPS_SAMPLE, { year: "2024" });
    expect(none).toEqual({
      kind: "countries",
      window: { since: null, until: null, days: [] },
      years: [],
    });
    expect(renderCountries(none)).toBe("countries\n  nothing in the window\n");
  });
});

describe("the countries rollup on the records SPEC §6.1 compares implementations on", () => {
  it("counts the conformance sample's eight nights in transit over the window its vessel's line closes", () => {
    const c = rollupCountries(join(FIXTURES, "sample-logbook"), {});
    expect(c.window.since).toBe("2026-03-01");
    expect(c.window.until).toBe("2026-03-08");
    expect(c.years[0]).toMatchObject({ year: "2026", countries: [], in_transit: { days: 8 } });
  });

  it("counts the seed-1 demo's June: 25 nights in Norway, three in Switzerland, two in Denmark, none in transit", () => {
    const c = rollupCountries(join(FIXTURES, "demo-seed-1"), {});
    expect(c.years[0]?.countries.map((x) => `${x.country} ${x.days}`)).toEqual([
      "NO 25",
      "CH 3",
      "DK 2",
    ]);
    expect(c.years[0]?.countries[0]?.by).toEqual({ place: 18, airport: 7 });
    expect(c.years[0]?.in_transit.days).toBe(0);
  });
});
