import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FLAGS_ENV } from "../src/flags.js";
import { showDay } from "../src/show.js";
import { verifyLogbook } from "../src/store.js";
import { cleanup, type Draft, expectedShows, FIXTURES, writeRecord } from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

/** RFC 0036's example lines, with `logbook show` of the reference on each day (capture-expected-show.mjs). */
const RFC0036 = join(FIXTURES, "rfc0036-sample");
const RFC0036_ROW = /^ {2}\d\d:\d\d {2}(draft|chapter|goal|review) /m;
/** The chapter the reference names after the signed state (its #275); not printed with the flag off. */
const CHAPTER_HEADER = / · chapter .*$/;

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
      const header = text.split("\n")[0] as string;
      if (RFC0036_ROW.test(text) || CHAPTER_HEADER.test(header)) {
        // A draft, a goal, a review or a chapter prints the generic row, not the reference's, and
        // the heading names no chapter.
        expect(ours).not.toBe(text);
        expect(ours.split("\n")[0]).toBe(header.replace(CHAPTER_HEADER, ""));
      } else {
        expect(ours).toBe(text);
      }
    });
  }

  it("prints a goal by its text and a review as key=value, as before", () => {
    vi.stubEnv(FLAGS_ENV, "");
    expect(showDay(RFC0036, { day: "2026-01-04" }).text.split("\n")[1]).toBe(
      "  11:15  goal       manual         Sail the boat to Lofoten and back in one summer, without a single night in a marina I didn't choose.",
    );
    expect(showDay(RFC0036, { day: "2026-08-31" }).text.split("\n")[1]).toBe(
      "  22:00  review     manual         disposition=let go, goal=019cadd3-6bc0-7dcd-9133-000000000302, note=Engine gone in Bodø on the 9th. Towed home. Next summer., period=month",
    );
  });
});

describe("RFC 0036's rows on lines the examples do not have, as the reference printed them", () => {
  // Every expected row below is what `logbook show` of the reference (main at 7bcf728) printed for
  // the same lines in a record of its own (the seqs are the same; the ids are the test record's).
  const id = (seq: number): string => `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  const at = (day: string, clock: string): string => `${day}T${clock}:00Z`;
  const line = (when: string, kind: string, payload: Record<string, unknown>): Draft => ({
    at: when,
    source: "manual",
    kind,
    payload,
  });
  const goal = (when: string, p: Record<string, unknown>) =>
    line(when, "goal", { schema: "goal/v1", ...p });
  const review = (when: string, p: Record<string, unknown>) =>
    line(when, "review", { schema: "review/v1", ...p });
  const chapter = (when: string, p: Record<string, unknown>) =>
    line(when, "chapter", { schema: "chapter/v1", rules: "", ...p });
  const retract = (when: string, seq: number) =>
    line(when, "retraction", { schema: "retraction/v1", supersedes: id(seq), seq, reason: "no" });
  const d5 = "2027-01-05";
  const d6 = "2027-01-06";
  const d7 = "2027-01-07";
  const drafts: Draft[] = [
    goal(at(d5, "09:00"), { text: "Goal one.", horizon: "year", from: "2027-01-01" }), // 1
    goal(at(d5, "09:01"), { text: "Goal two, no from." }), // 2
    goal(at(d5, "09:02"), { text: "Goal three.", horizon: "quarter", until: "2027-03-31" }), // 3
    goal(at(d5, "09:03"), { horizon: "year", from: "2027-01-01" }), // 4
    goal(at(d5, "09:04"), { text: "Goal five.", horizon: "life", from: "2027-01-01" }), // 5
    goal(at(d5, "09:05"), { text: "Five, retracted.", horizon: "life", supersedes: id(5) }), // 6
    retract(at(d5, "09:05"), 6), // 7
    goal(at(d5, "09:06"), { text: "Goal six.", horizon: "year", from: "2027-01-01" }), // 8
    line(at(d5, "09:07"), "note", { schema: "note/v1", text: "a note", supersedes: id(8) }), // 9
    goal(at(d5, "09:08"), { text: "Seven a.", horizon: "year", from: "2027-01-01" }), // 10
    goal(at(d5, "09:09"), { text: "Seven b.", horizon: "year", supersedes: id(10) }), // 11
    goal(at(d5, "09:10"), { text: "Seven c.", horizon: "year", supersedes: id(11) }), // 12
    goal(at(d5, "09:11"), { text: "Eight.", horizon: "year", from: "2027-01-01" }), // 13
    goal(at(d5, "09:12"), { text: "Eight x.", horizon: "year", supersedes: id(13) }), // 14
    goal(at(d5, "09:13"), { text: "Eight y.", horizon: "year", supersedes: id(13) }), // 15
    review(at(d6, "09:00"), { goal: id(10), disposition: "advancing", period: "month" }), // 16
    review(at(d6, "09:01"), { goal: id(999), disposition: "stalled", period: "week" }), // 17
    review(at(d6, "09:02"), { goal: id(1), disposition: "done" }), // 18
    review(at(d6, "09:03"), { goal: id(6), disposition: "let go", period: "year" }), // 19
    review(at(d6, "09:04"), { goal: id(4), disposition: "advancing", period: "day" }), // 20
    review(at(d6, "09:05"), { goal: id(13), disposition: "advancing", period: "day" }), // 21
    chapter(at(d7, "09:00"), { name: "Winter", from: "2027-01-01", to: "2027-02-28" }), // 22
    chapter(at(d7, "09:01"), { name: "Spring", from: "2027-03-01" }), // 23
    chapter(at(d7, "09:02"), {
      name: "Spring again",
      from: "2027-03-01",
      to: "2027-05-31",
      supersedes: id(23),
    }), // 24
    chapter(at(d7, "09:03"), { name: "No from" }), // 25
    chapter(at(d7, "09:04"), { from: "2027-06-01" }), // 26
    chapter(at(d7, "09:05"), { name: "Clash", from: "2027-01-06", to: "2027-01-08" }), // 27
  ];

  it("prints goals, reviews and chapters, and the day's chapter in the heading", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0036");
    const root = writeRecord(drafts, "UTC");
    const rows = (day: string) => showDay(root, { day }).text.split("\n").filter(Boolean);
    expect(rows(d5)).toEqual([
      "2027-01-05  unsigned · chapter Winter",
      "  09:00  goal       manual         Goal one.  (year, from 2027-01-01)",
      "  09:01  goal       manual         Goal two, no from.  (None, from None)",
      "  09:02  goal       manual         Goal three.  (quarter, from None, until 2027-03-31)",
      "  09:03  goal       manual         None  (year, from 2027-01-01)",
      "  09:04  goal       manual         Goal five.  (life, from 2027-01-01)",
      "  09:05  retracted #6: no",
      "  09:06  goal       manual         Goal six.  (year, from 2027-01-01)",
      "  09:07  note       manual         a note",
      "  09:08  goal       manual         Seven a.  (year, from 2027-01-01) · superseded by #11",
      "  09:09  goal       manual         Seven b.  (year, from None) · superseded by #12",
      "  09:10  goal       manual         Seven c.  (year, from None)",
      "  09:11  goal       manual         Eight.  (year, from 2027-01-01) · superseded by #15",
      "  09:12  goal       manual         Eight x.  (year, from None)",
      "  09:13  goal       manual         Eight y.  (year, from None)",
    ]);
    expect(rows(d6)).toEqual([
      "2027-01-06  unsigned · chapter Clash, clashes with Winter",
      "  09:00  review     manual         advancing · month · Seven c.",
      `  09:01  review     manual         stalled · week · goal ${id(999)}`,
      "  09:02  review     manual         done · None · Goal one.",
      `  09:03  review     manual         let go · year · goal ${id(6)}`,
      "  09:04  review     manual         advancing · day · None",
      "  09:05  review     manual         advancing · day · Eight y.",
    ]);
    expect(rows(d7)).toEqual([
      "2027-01-07  unsigned · chapter Clash, clashes with Winter",
      "  09:00  chapter    manual         Winter  2027-01-01 – 2027-02-28",
      "  09:01  chapter    manual         Spring  2027-03-01 – · superseded by #24",
      "  09:02  chapter    manual         Spring again  2027-03-01 – 2027-05-31",
      "  09:03  chapter    manual         No from  None –",
      "  09:04  chapter    manual         None  2027-06-01 –",
      "  09:05  chapter    manual         Clash  2027-01-06 – 2027-01-08",
    ]);
  });
});
