import { describe, expect, it } from "vitest";
import {
  addDays,
  isDay,
  localIso,
  localOf,
  localToMs,
  offsetString,
  weekdayOf,
} from "../src/clock.js";
import { coordinates, distanceM, fsum, mean, roundHalfEven, roundTo } from "../src/geo.js";

describe("distances", () => {
  it("are great-circle metres on a sphere of 6,371 km", () => {
    expect(distanceM(0, 0, 0, 0)).toBe(0);
    expect(distanceM(60.1939, 11.1004, 47.4581, 8.5481)).toBeCloseTo(1_425_8e2, -3); // OSL to ZRH
    expect(
      distanceM(59.9139, 10.7522, 59.9139 + 360 / (2 * Math.PI * 6_371_000), 10.7522),
    ).toBeCloseTo(1, 6);
  });

  it("label a place as lat,lon to four decimals", () => {
    expect(coordinates(59.913889, 10.752209)).toBe("59.9139,10.7522");
    expect(coordinates(47.4581, 8.5)).toBe("47.4581,8.5000");
  });
});

describe("sums and rounding, as Python spells them", () => {
  it("fsum is exact whatever the order of the terms", () => {
    expect(fsum([0.1, 0.2, 0.3])).toBe(0.6);
    expect(fsum([1e100, 1, -1e100])).toBe(1);
    const lons = [10.75805, 10.760023, 10.759739, 10.759741, 10.759628, 10.75966];
    expect(fsum(lons)).toBe(fsum([...lons].reverse()));
    expect(roundTo(mean(lons), 6)).toBe(10.759474); // a plain sum lands on 10.759473
  });

  it("roundTo rounds by the double's exact value, half to even on an exact tie", () => {
    expect(roundTo(6.25, 1)).toBe(6.2);
    expect(roundTo(6.35, 1)).toBe(6.3); // 6.35 is below the tie as a double, as Python prints 6.3
    expect(roundTo(6.55, 1)).toBe(6.5);
    expect(roundTo(0.125, 2)).toBe(0.12);
    expect(roundTo(0.375, 2)).toBe(0.38);
    expect(roundTo(-6.25, 1)).toBe(-6.2);
    expect(roundTo(59.9101708333, 6)).toBe(59.910171);
  });

  it("roundHalfEven is Python's round()", () => {
    expect(roundHalfEven(0.5)).toBe(0);
    expect(roundHalfEven(1.5)).toBe(2);
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(2.51)).toBe(3);
    expect(roundHalfEven(-0.5) === 0).toBe(true);
    expect(roundHalfEven(-1.5)).toBe(-2);
  });
});

describe("the clock", () => {
  it("turns a local wall clock into an instant and back", () => {
    const ms = localToMs("2026-06-08", "04:55", "Europe/Oslo");
    expect(new Date(ms).toISOString()).toBe("2026-06-08T02:55:00.000Z");
    expect(localOf(ms, "Europe/Oslo")).toEqual({ day: "2026-06-08", clock: "04:55" });
    expect(localIso(ms, "Europe/Oslo")).toBe("2026-06-08T04:55:00+02:00");
    expect(offsetString(ms, "Europe/Oslo")).toBe("+02:00");
    expect(offsetString(ms, "America/New_York")).toBe("-04:00");
    expect(offsetString(ms, "UTC")).toBe("+00:00");
    expect(localToMs("2026-06-08", "24:00", "Europe/Oslo")).toBe(
      localToMs("2026-06-09", "00:00", "Europe/Oslo"),
    );
  });

  it("knows the winter clock and the day a transition skips an hour", () => {
    expect(new Date(localToMs("2026-01-15", "00:00", "Europe/Oslo")).toISOString()).toBe(
      "2026-01-14T23:00:00.000Z",
    );
    // 2026-03-29 02:30 Oslo does not exist; it reads as 03:30 on the clock after the gap, 01:30Z.
    expect(new Date(localToMs("2026-03-29", "02:30", "Europe/Oslo")).toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
    expect(new Date(localToMs("2026-03-29", "03:30", "Europe/Oslo")).toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
    expect(new Date(localToMs("2026-03-29", "00:00", "Europe/Oslo")).toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
  });

  it("names days", () => {
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2028-02-29")).toBe(true);
    expect(addDays("2026-06-01", -1)).toBe("2026-05-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOf("2026-06-08")).toBe("Monday");
    expect(weekdayOf("2026-06-13")).toBe("Saturday");
  });
});
