import { afterEach, describe, expect, it } from "vitest";
import { readDay, travelAcrossNights } from "../src/day.js";
import { renderDay } from "../src/dayText.js";
import { cleanup, comparableDayText, writeRecord } from "./helpers.js";
import { NIGHT_TEXT_CASES } from "./night-text-cases.js";

afterEach(cleanup);

describe("the Day's nights and times as the reference's 1.0.0 prints them (its #429, #430)", () => {
  // tests/night-text-cases.ts: each day of each record, the reference's `logbook day` of it, run.
  for (const c of NIGHT_TEXT_CASES) {
    it(c.name, () => {
      const root = writeRecord(c.lines);
      for (const [day, text] of Object.entries(c.expected))
        expect(renderDay(readDay(root, { day })), day).toBe(comparableDayText(text));
    });
  }

  it("a Day read back from its JSON renders its nights with the travel kept beside the Day it came from", () => {
    const c = NIGHT_TEXT_CASES[0] as (typeof NIGHT_TEXT_CASES)[number];
    const day = readDay(writeRecord(c.lines), { day: "2026-03-20" });
    const copy = JSON.parse(JSON.stringify(day)) as typeof day;
    expect(travelAcrossNights(day)).toEqual({ before: false, after: true });
    // Not known by itself: a copy reads every night no stay places as `not recorded`...
    expect(renderDay(copy)).toContain("  night after   not recorded\n");
    // ...and as the original with the travel given.
    expect(renderDay(copy, travelAcrossNights(day))).toBe(renderDay(day));
  });
});
