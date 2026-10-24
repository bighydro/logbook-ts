import { afterEach, describe, expect, it } from "vitest";
import { readDayRows } from "../src/days.js";
import { cleanup } from "./helpers.js";
import { caseDay, WITH_CASES, withRecord } from "./with-cases.js";

afterEach(cleanup);

describe("who a note says was there (SPEC §3.2.5 rule 3), as the reference reads it at 6ee01c2 (run)", () => {
  it("every case of tests/with-cases.ts names the people the reference names, in its order", () => {
    const rows = readDayRows(withRecord(), {}).rows;
    const names = new Map(rows.map((r) => [r.day, r.people.names]));
    for (const [i, c] of WITH_CASES.entries()) {
      expect({ text: c.text, names: names.get(caseDay(i)) }).toEqual({
        text: c.text,
        names: c.expected,
      });
    }
  });
});
