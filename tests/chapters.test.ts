import { describe, expect, it } from "vitest";
import {
  CHAPTER_KIND,
  CHAPTER_SCHEMA,
  chapterClashes,
  chapterKey,
  chapterOf,
  chapterProblems,
  isChapter,
  standingChapters,
} from "../src/chapters.js";
import { duplicates } from "../src/lineRules.js";
import {
  CHAPTER,
  CHAPTER_CLOSED,
  CHAPTER_OPEN,
  edit,
  id,
  retractedSet,
} from "./rfc0036-examples.js";

const none = retractedSet();
const ALL = [CHAPTER, CHAPTER_OPEN, CHAPTER_CLOSED];

describe("chapter/v1 (RFC 0036): a named stretch of the record", () => {
  it("names the kind and the schema", () => {
    expect([CHAPTER_KIND, CHAPTER_SCHEMA]).toEqual(["chapter", "chapter/v1"]);
  });

  it("the RFC's two examples and amendment 1's closing line have nothing against them", () => {
    for (const l of ALL) {
      expect(isChapter(l)).toBe(true);
      expect(chapterProblems(l)).toEqual([]);
    }
  });

  it("is the owner's words: kind chapter, tier 2, source manual, end null", () => {
    expect(
      chapterProblems(
        edit(CHAPTER, {}, { tier: 1, source: "model:x", end: "2026-08-09T00:00:00Z" }),
      ),
    ).toEqual(["tier must be 2", "source must be manual", "end must be null"]);
  });

  it("holds the fields of the table: a name, a first day, a last day not before it, the rules as text", () => {
    expect(chapterProblems(edit(CHAPTER, { name: "" }))).toEqual([
      "name must be the chapter's name in the owner's words, a string that is not empty",
    ]);
    expect(chapterProblems(edit(CHAPTER, { from: "June" }))).toEqual([
      "from must be YYYY-MM-DD, a real calendar day, the chapter's first local day",
    ]);
    expect(chapterProblems(edit(CHAPTER, { to: "2026-08-32" }))).toEqual([
      "to must be YYYY-MM-DD, a real calendar day, the chapter's last local day",
    ]);
    expect(chapterProblems(edit(CHAPTER, { to: "2026-06-19" }))).toEqual([
      "to is before from: 2026-06-19 < 2026-06-20",
    ]);
    expect(chapterProblems(edit(CHAPTER, { to: "2026-06-20" }))).toEqual([]);
    expect(chapterProblems(edit(CHAPTER, { rules: undefined }))).toEqual([
      "rules must be the chapter's rules as plain text, a string, empty when the owner has not said",
    ]);
    expect(chapterProblems(edit(CHAPTER, { rules: ["anchor"] }))).toEqual([
      "rules must be the chapter's rules as plain text, a string, empty when the owner has not said",
    ]);
    expect(chapterProblems(edit(CHAPTER, { rules: "" }))).toEqual([]);
    expect(chapterProblems(edit(CHAPTER, { supersedes: 402 }))).toEqual([
      "supersedes must be the id of the earlier chapter line",
    ]);
  });

  it("dedupes on (name, from): the same name from the same day is the same chapter", () => {
    expect(chapterKey(CHAPTER)).toBe(JSON.stringify(["The Lofoten summer", "2026-06-20"]));
    const again = edit(CHAPTER, { rules: "" }, { id: id(404), seq: 900 });
    const renamed = edit(CHAPTER, { name: "The northern summer" }, { id: id(405), seq: 901 });
    expect(duplicates([CHAPTER, again, renamed], none, chapterKey).map((d) => d.line.id)).toEqual([
      id(404),
    ]);
    // Closing supersedes: the closed line repeats the open one's key, by design a new line of it.
    expect(duplicates(ALL, none, chapterKey)).toEqual([]);
  });
});

describe("the standing chapter of a day (chapter/v1 rules 2, 3 and 4)", () => {
  it("closing supersedes: the open line no longer stands, the closed one does", () => {
    expect(standingChapters(ALL, none).map((l) => l.id)).toEqual([id(401), id(403)]);
  });

  it("a day belongs to the chapter open on it", () => {
    expect(chapterOf(ALL, none, "2026-07-04")).toEqual({
      chapter: { name: "The Lofoten summer", line: id(401), from: "2026-06-20", to: "2026-08-09" },
      clash: [],
    });
    expect(chapterOf(ALL, none, "2026-06-20").chapter?.line).toBe(id(401));
    expect(chapterOf(ALL, none, "2026-08-09").chapter?.line).toBe(id(401));
    expect(chapterOf(ALL, none, "2026-08-10").chapter).toEqual({
      name: "Ashore, fixing things",
      line: id(403),
      from: "2026-08-10",
      to: "2026-11-29",
    });
  });

  it("a day in none has no chapter; an open chapter runs on", () => {
    expect(chapterOf(ALL, none, "2026-06-19")).toEqual({ chapter: null, clash: [] });
    expect(chapterOf(ALL, none, "2026-11-30").chapter).toBeNull();
    expect(chapterOf([CHAPTER, CHAPTER_OPEN], none, "2027-03-01").chapter).toEqual({
      name: "Ashore, fixing things",
      line: id(402),
      from: "2026-08-10",
      to: null,
    });
  });

  it("a retraction of the closing line reopens the chapter", () => {
    expect(chapterOf(ALL, retractedSet(id(403)), "2027-03-01").chapter?.line).toBe(id(402));
  });

  it("two standing chapters open on one day: the later by from, then seq, and the clash marked", () => {
    const overlapping = edit(
      CHAPTER,
      { name: "Bodø, waiting", from: "2026-08-01", to: "2026-08-20" },
      { id: id(406), seq: 950 },
    );
    const lines = [...ALL, overlapping];
    expect(chapterOf(lines, none, "2026-08-05")).toEqual({
      chapter: { name: "Bodø, waiting", line: id(406), from: "2026-08-01", to: "2026-08-20" },
      clash: [id(401)],
    });
    expect(chapterOf(lines, none, "2026-08-15")).toEqual({
      chapter: {
        name: "Ashore, fixing things",
        line: id(403),
        from: "2026-08-10",
        to: "2026-11-29",
      },
      clash: [id(406)],
    });
    expect(chapterClashes(lines, none).map(([a, b]) => [a.id, b.id])).toEqual([
      [id(401), id(406)],
      [id(403), id(406)],
    ]);
    expect(chapterClashes(ALL, none)).toEqual([]);
  });
});
