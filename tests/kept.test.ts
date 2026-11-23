import { afterEach, describe, expect, it, vi } from "vitest";
import { FLAGS_ENV } from "../src/flags.js";
import { showDay } from "../src/show.js";
import { cleanup, writeRecord } from "./helpers.js";
import { DAY, KEPT_CASES, keptRows } from "./kept-cases.js";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("a line kept from a draft names it in show (RFC 0036 rule 3), as the reference prints it at 55c6fbd (its #452, run)", () => {
  for (const [name, record, expected] of KEPT_CASES) {
    it(name, () => {
      vi.stubEnv(FLAGS_ENV, "rfc0036");
      expect(keptRows(showDay(writeRecord(record), { day: DAY }).text)).toEqual(expected);
    });
  }

  it("without the rfc0036 flag a kept line reads as before", () => {
    const [, record] = KEPT_CASES[0] as (typeof KEPT_CASES)[number];
    expect(showDay(writeRecord(record), { day: DAY }).text).toContain(
      "  21:30  note       manual         kept A\n",
    );
  });
});
