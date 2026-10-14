import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FLAGS_ENV } from "../src/flags.js";
import { showDay } from "../src/show.js";
import { verifyLogbook } from "../src/store.js";
import { expectedShows, FIXTURES } from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** RFC 0036's example lines, with `logbook show` of the reference on each day (capture-expected-show.mjs). */
const RFC0036 = join(FIXTURES, "rfc0036-sample");
const DRAFT_OR_CHAPTER = /^ {2}\d\d:\d\d {2}(draft|chapter) /m;

describe("the rfc0036 fixture", () => {
  it("is a valid logbook/0.2 record of fifteen lines", () => {
    const result = verifyLogbook(RFC0036);
    expect(result.errors).toEqual([]);
    expect(result.lines).toBe(15);
  });
});

describe("show prints RFC 0036's lines as the reference does, under the rfc0036 flag", () => {
  for (const { day, raw, text } of expectedShows(RFC0036)) {
    it(`${day}${raw ? " --raw" : ""}`, () => {
      vi.stubEnv(FLAGS_ENV, "rfc0036");
      expect(showDay(RFC0036, { day, raw }).text).toBe(text);
    });
  }
});

describe("and with the flag off, as it did before RFC 0036", () => {
  for (const { day, raw, text } of expectedShows(RFC0036)) {
    it(`${day}${raw ? " --raw" : ""}`, () => {
      vi.stubEnv(FLAGS_ENV, "");
      const ours = showDay(RFC0036, { day, raw }).text;
      if (DRAFT_OR_CHAPTER.test(text)) {
        // A draft or a chapter prints the generic `key=value` row, not the reference's.
        expect(ours).not.toBe(text);
        expect(ours.split("\n")[0]).toBe(text.split("\n")[0]);
      } else {
        expect(ours).toBe(text);
      }
    });
  }
});
