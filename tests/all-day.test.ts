import { afterEach, describe, expect, it } from "vitest";
import { readDay } from "../src/day.js";
import { readDayRows } from "../src/days.js";
import { renderDay } from "../src/dayText.js";
import { showDay } from "../src/show.js";
import { ALL_DAY_CASES, ALL_DAY_EXPECTED, allDayRecord, DAY } from "./all-day-cases.js";
import { cleanup } from "./helpers.js";

afterEach(cleanup);

describe("an all-day entry says all day, as the reference reads it at v1.1.0 (its #436, run)", () => {
  for (const c of ALL_DAY_CASES) {
    it(c.name, () => {
      const expected = ALL_DAY_EXPECTED[c.name];
      if (expected === undefined) throw new Error(`no expected output for ${c.name}`);
      const root = allDayRecord(c);
      const day = readDay(root, { day: DAY });
      expect(renderDay(day)).toBe(expected.text);
      expect(JSON.parse(JSON.stringify({ allDay: day.all_day, unplaced: day.unplaced }))).toEqual({
        allDay: expected.allDay,
        unplaced: expected.unplaced,
      });
      expect(showDay(root, { day: DAY }).text).toBe(expected.show);
      if (expected.company !== undefined)
        expect(
          JSON.parse(
            JSON.stringify(day.timeline.map((t) => ("with" in t ? t.with : null) ?? null)),
          ),
        ).toEqual(expected.company);
      if (expected.days !== undefined) {
        const read = readDayRows(root, {}).rows.find((d) => d.day === DAY);
        expect(JSON.parse(JSON.stringify({ stays: read?.stays, people: read?.people }))).toEqual(
          expected.days,
        );
      }
    });
  }
});
