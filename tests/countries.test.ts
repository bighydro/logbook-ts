import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Countries, renderCountries, rollupCountries } from "../src/countries.js";
import { cleanup, expectedWindows, FIXTURES } from "./helpers.js";

afterEach(cleanup);

const TRIPS_SAMPLE = join(FIXTURES, "trips-sample");

describe("rollup countries, as the reference prints it", () => {
  for (const name of [
    "trips-sample",
    "nights-sample",
    "day-sample",
    "demo-sample",
    "sample-logbook",
    "demo-seed1",
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
