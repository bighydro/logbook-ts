import { afterEach, describe, expect, it } from "vitest";
import { readDay } from "../src/day.js";
import { renderDay } from "../src/dayText.js";
import { cleanup, writeBareRecord } from "./helpers.js";
import { RECEIPT_CASES } from "./receipts-cases.js";

afterEach(cleanup);

describe("a payment and its receipt counted once, as the reference's Day does at a6ee131 (its #406, run)", () => {
  for (const c of RECEIPT_CASES) {
    it(c.name, () => {
      const root = writeBareRecord(c.lines);
      for (const [day, expected] of Object.entries(c.expected)) {
        const read = readDay(root, { day });
        expect({ day, json: JSON.parse(JSON.stringify(read.spend)) }).toEqual({
          day,
          json: expected.json,
        });
        const row = renderDay(read)
          .split("\n")
          .find((l) => l.startsWith("  spend "));
        expect({ day, text: row?.trim() ?? "" }).toEqual({ day, text: expected.text });
      }
    });
  }
});
