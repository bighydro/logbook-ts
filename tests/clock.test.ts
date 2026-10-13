import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays, dayMs, isDay, localIso, localOf, localToMs } from "../src/clock.js";

describe("the day helpers in the years 0000–0099", () => {
  // `Date.UTC` reads a year from 0 to 99 as 1900 plus it, so `0099-03-01` was no day (isDay false)
  // and its midnight landed in 1999; Intl names the year 0000 as 1 (1 BC) and prints 99 for 0099.
  // A `YYYY-MM-DD` is any four digits, so each is the year it spells.

  it("0099-03-01 is a day, and its midnight is in the year 99, not 1999", () => {
    expect(isDay("0099-03-01")).toBe(true);
    expect(dayMs("0099-03-01")).toBe(Date.parse("0099-03-01T00:00:00Z"));
    expect(new Date(dayMs("0099-03-01")).toISOString()).toBe("0099-03-01T00:00:00.000Z");
  });

  it("knows the leap years there: 0096 and 0000 have a 29 February, 0099 has none", () => {
    expect(isDay("0096-02-29")).toBe(true);
    expect(isDay("0000-02-29")).toBe(true);
    expect(isDay("0099-02-29")).toBe(false);
  });

  it("counts days across the turn of the year 100", () => {
    expect(addDays("0099-12-31", 1)).toBe("0100-01-01");
    expect(addDays("0100-01-01", -1)).toBe("0099-12-31");
    expect(addDays("0000-01-01", 365)).toBe("0000-12-31");
  });

  it("reads an instant of 0099 and of 0000 on a zone's clock as the four-digit year it is", () => {
    expect(localOf(Date.parse("0099-03-01T12:00:00Z"), "UTC")).toEqual({
      day: "0099-03-01",
      clock: "12:00",
    });
    expect(localOf(Date.parse("0000-06-01T12:00:00Z"), "UTC").day).toBe("0000-06-01");
    expect(localIso(Date.parse("0099-12-31T23:30:00Z"), "UTC")).toBe("0099-12-31T23:30:00+00:00");
  });

  it("finds the instant of a local midnight in 0099 and reads it back, in UTC and in Oslo", () => {
    expect(localToMs("0099-03-01", "00:00", "UTC")).toBe(Date.parse("0099-03-01T00:00:00Z"));
    const oslo = localToMs("0099-03-01", "00:00", "Europe/Oslo");
    expect(Math.abs(oslo - Date.parse("0099-03-01T00:00:00Z"))).toBeLessThan(2 * 3_600_000);
    expect(localOf(oslo, "Europe/Oslo")).toEqual({ day: "0099-03-01", clock: "00:00" });
    // the local day can be a year ahead of UTC's: 23:30 on the last day of 99 is 0100 in Oslo
    expect(localOf(Date.parse("0099-12-31T23:30:00Z"), "Europe/Oslo").day).toBe("0100-01-01");
  });

  it("every day from 0000-01-01 to 9999-12-31 is a day whose midnight is its own", () => {
    const first = Date.parse("0000-01-01T00:00:00Z");
    const last = Date.parse("9999-12-31T00:00:00Z");
    fc.assert(
      fc.property(fc.integer({ min: 0, max: (last - first) / 86_400_000 }), (n) => {
        const ms = first + n * 86_400_000;
        const day = new Date(ms).toISOString().slice(0, 10);
        expect(isDay(day)).toBe(true);
        expect(dayMs(day)).toBe(ms);
        expect(localOf(ms, "UTC").day).toBe(day);
      }),
      { numRuns: 500, examples: [[0], [36_219], [36_524], [36_525]] },
    );
  });
});
