import { afterEach, describe, expect, it } from "vitest";
import { readDay } from "../src/day.js";
import { renderDay } from "../src/dayText.js";
import { cleanup, writeRecord } from "./helpers.js";
import { DAY, REFLECTION_CASES, reflectionRows } from "./reflection-cases.js";

afterEach(cleanup);

describe("the Day's reflection, as the reference's Day shows it at d053f78 (run)", () => {
  for (const c of REFLECTION_CASES) {
    it(c.name, () => {
      const day = readDay(writeRecord(c.lines), { day: DAY });
      const json = JSON.parse(JSON.stringify(day)) as { reflection?: unknown };
      if (c.expected.json === null) expect("reflection" in json).toBe(false);
      else expect(json.reflection).toEqual(c.expected.json);
      expect(reflectionRows(renderDay(day))).toEqual(c.expected.rows);
    });
  }

  it("sits below the header and above the timeline", () => {
    const one = REFLECTION_CASES.find((c) => c.name === "one");
    const rows = renderDay(readDay(writeRecord(one?.lines ?? []), { day: DAY })).split("\n");
    expect(rows.slice(3, 8)).toEqual([
      "  country       NO (nearest airport OSL)",
      "",
      "  reflection    22:00 · manual",
      "                Quiet day.",
      "",
    ]);
    expect(rows[8]).toMatch(/^ {2}07:30–22:30 {2}stay/);
  });
});
