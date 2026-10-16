import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readDay } from "../src/day.js";
import { readDayRows, renderDayRows } from "../src/days.js";
import { renderDay } from "../src/dayText.js";
import { FLAGS_ENV } from "../src/flags.js";
import { readPeople, renderPeople } from "../src/people.js";
import { showDay } from "../src/show.js";
import { verifyLogbook } from "../src/store.js";
import {
  expectedDays,
  expectedDaysWindows,
  expectedShows,
  expectedWindows,
  FIXTURES,
} from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * RFC 0037's entities and RFC 0038 §2's voices in a record the reference wrote with its own writers
 * (tests/fixtures/rfc0037-0038-sample/make.py), with `logbook show` and `logbook day` of the reference
 * on every day it has a line, captured beside it (capture-expected-show.mjs, capture-expected-day.mjs).
 * tests/cross-impl.test.ts holds both to the reference itself.
 */
const SAMPLE = join(FIXTURES, "rfc0037-0038-sample");
const VOICE_OR_REPLACED = / · (you|S\d|Kari|Ola|mic)|superseded by #/;

describe("the rfc0037-0038 fixture", () => {
  it("is a valid logbook/0.3 record of 134 lines, as the reference wrote it", () => {
    const result = verifyLogbook(SAMPLE);
    expect(result.errors).toEqual([]);
    expect(result.lines).toBe(134);
    expect(result.head).toBe("ba06dee9074d7aa4272a8d9adda5baed2e82dce0abdcab90dc148d5f7f25caff");
  });
});

describe("show and the Day print it as the reference does, under the rfc0037 and rfc0038 flags", () => {
  for (const { day, raw, text } of expectedShows(SAMPLE)) {
    it(`show ${day}${raw ? " --raw" : ""}`, () => {
      vi.stubEnv(FLAGS_ENV, "rfc0037,rfc0038");
      expect(showDay(SAMPLE, { day, raw }).text).toBe(text);
    });
  }
  it("day, every day with a line, as text and as JSON", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0037,rfc0038");
    for (const expected of expectedDays(SAMPLE)) {
      const day = readDay(SAMPLE, { day: expected.day });
      expect(renderDay(day), expected.day).toBe(expected.text);
      expect(JSON.parse(JSON.stringify(day)), expected.day).toEqual(expected.json);
    }
  });
});

describe("people and days read it as the reference does, under the flags", () => {
  it("people, the whole record and its year, as text and as JSON", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0037,rfc0038");
    for (const expected of expectedWindows(SAMPLE, "people")) {
      const ours = readPeople(SAMPLE, expected.options);
      expect(renderPeople(ours, expected.options)).toBe(expected.text);
      expect(JSON.parse(JSON.stringify(ours))).toEqual(expected.json);
    }
  });
  it("days, the whole record, as text and as JSON Lines", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0037,rfc0038");
    for (const expected of expectedDaysWindows(SAMPLE)) {
      const ours = readDayRows(SAMPLE, expected.options);
      expect(renderDayRows(ours)).toBe(expected.text);
      expect(ours.rows.map((row) => JSON.parse(JSON.stringify(row)))).toEqual(expected.rows);
    }
  });
});

describe("and with the flags off, as before RFC 0038: only the rows of voices and of a recording heard again differ", () => {
  for (const { day, raw, text } of expectedShows(SAMPLE)) {
    it(`show ${day}${raw ? " --raw" : ""}`, () => {
      vi.stubEnv(FLAGS_ENV, "");
      const ours = showDay(SAMPLE, { day, raw }).text.split("\n");
      const theirs = text.split("\n");
      expect(ours).toHaveLength(theirs.length);
      for (const [n, row] of theirs.entries()) {
        if (VOICE_OR_REPLACED.test(row)) expect(ours[n]).not.toBe(row);
        else expect(ours[n]).toBe(row);
      }
    });
  }
});
