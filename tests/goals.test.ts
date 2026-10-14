import { describe, expect, it } from "vitest";
import {
  DISPOSITIONS,
  GOAL_KIND,
  GOAL_SCHEMA,
  goalProblems,
  HORIZONS,
  isGoal,
  isReview,
  openGoals,
  PERIODS,
  REVIEW_KIND,
  REVIEW_SCHEMA,
  reviewKey,
  reviewProblems,
  reviewRecordProblems,
  standingGoal,
  standingGoals,
  standingReviews,
} from "../src/goals.js";
import { duplicates } from "../src/lineRules.js";
import { edit, GOAL, GOAL_REWORDED, id, line, REVIEW, retractedSet } from "./rfc0036-examples.js";

const none = retractedSet();

describe("goal/v1 (RFC 0036): a goal in the owner's own words", () => {
  it("names the kind, the schema and the three horizons", () => {
    expect([GOAL_KIND, GOAL_SCHEMA]).toEqual(["goal", "goal/v1"]);
    expect(HORIZONS).toEqual(["life", "year", "quarter"]);
  });

  it("the RFC's two example lines are goals with nothing to say against them", () => {
    expect(isGoal(GOAL)).toBe(true);
    expect(goalProblems(GOAL)).toEqual([]);
    expect(goalProblems(GOAL_REWORDED)).toEqual([]);
  });

  it("is the owner's words: kind goal, tier 2, source manual, end null, whatever a producer says", () => {
    expect(goalProblems(edit(GOAL, {}, { tier: 1 }))).toEqual(["tier must be 2"]);
    expect(goalProblems(edit(GOAL, {}, { tier: 3 }))).toEqual(["tier must be 2"]);
    expect(goalProblems(edit(GOAL, {}, { source: "model:qwen2.5-7b-instruct" }))).toEqual([
      "source must be manual",
    ]);
    expect(goalProblems(edit(GOAL, {}, { end: "2026-12-31T00:00:00Z" }))).toEqual([
      "end must be null",
    ]);
    expect(goalProblems(edit(GOAL, {}, { kind: "note" }))).toEqual(["kind must be goal"]);
    expect(goalProblems(edit(GOAL, { schema: "goal/v2" }))).toEqual(["schema must be goal/v1"]);
  });

  it("holds every MUST field of the table to its type", () => {
    expect(goalProblems(edit(GOAL, { text: undefined }))).toEqual([
      "text must be the goal in the owner's words, a string that is not empty",
    ]);
    expect(goalProblems(edit(GOAL, { text: "  " }))).toEqual([
      "text must be the goal in the owner's words, a string that is not empty",
    ]);
    expect(goalProblems(edit(GOAL, { text: 5 }))).toEqual([
      "text must be the goal in the owner's words, a string that is not empty",
    ]);
    expect(goalProblems(edit(GOAL, { horizon: "month" }))).toEqual([
      "horizon must be one of life, year, quarter, not 'month'",
    ]);
    expect(goalProblems(edit(GOAL, { horizon: undefined }))).toEqual([
      "horizon must be one of life, year, quarter, not None",
    ]);
    expect(goalProblems(edit(GOAL, { from: undefined }))).toEqual([
      "from must be YYYY-MM-DD, a real calendar day, the first local day the goal holds for",
    ]);
    expect(goalProblems(edit(GOAL, { from: "2026-02-30" }))).toEqual([
      "from must be YYYY-MM-DD, a real calendar day, the first local day the goal holds for",
    ]);
  });

  it("holds the MAY fields to their type when present, and until to on or after from", () => {
    expect(goalProblems(edit(GOAL, { until: "31.12.2026" }))).toEqual([
      "until must be YYYY-MM-DD, a real calendar day, the last local day the goal holds for",
    ]);
    expect(goalProblems(edit(GOAL, { until: "2025-12-31" }))).toEqual([
      "until is before from: 2025-12-31 < 2026-01-01",
    ]);
    expect(goalProblems(edit(GOAL, { until: "2026-01-01" }))).toEqual([]);
    expect(goalProblems(edit(GOAL, { supersedes: 301 }))).toEqual([
      "supersedes must be the id of the earlier goal line",
    ]);
    expect(goalProblems(edit(GOAL, { supersedes: "" }))).toEqual([
      "supersedes must be the id of the earlier goal line",
    ]);
  });

  it("keeps anything else, under extra or beside it, without a word", () => {
    expect(goalProblems(edit(GOAL, { extra: { mood: "hopeful" }, colour: "blue" }))).toEqual([]);
  });

  it("names every problem a line has, in the field table's order", () => {
    const bad = edit(GOAL, { text: "", horizon: "decade", from: "soon" }, { tier: 3 });
    expect(goalProblems(bad)).toEqual([
      "tier must be 2",
      "text must be the goal in the owner's words, a string that is not empty",
      "horizon must be one of life, year, quarter, not 'decade'",
      "from must be YYYY-MM-DD, a real calendar day, the first local day the goal holds for",
    ]);
  });
});

describe("standing goals (goal/v1 rules 1 and 2)", () => {
  it("rewording supersedes: the March line stands, the January one does not", () => {
    expect(standingGoals([GOAL, GOAL_REWORDED], none).map((l) => l.id)).toEqual([id(302)]);
    expect(standingGoal([GOAL, GOAL_REWORDED], none, id(301))?.id).toBe(id(302));
    expect(standingGoal([GOAL, GOAL_REWORDED], none, id(302))?.id).toBe(id(302));
  });

  it("has no dedupe key: the same text twice is two goals", () => {
    const twice = edit(GOAL, {}, { id: id(303), seq: 50 });
    expect(standingGoals([GOAL, twice], none).map((l) => l.id)).toEqual([id(301), id(303)]);
  });

  it("a retracted goal does not stand, and a retracted rewording leaves the earlier one standing", () => {
    expect(standingGoals([GOAL, GOAL_REWORDED], retractedSet(id(302))).map((l) => l.id)).toEqual([
      id(301),
    ]);
    expect(standingGoals([GOAL], retractedSet(id(301)))).toEqual([]);
  });

  it("a supersedes that names a later line, or a line of another kind, supersedes nothing", () => {
    const backwards = edit(GOAL, { supersedes: id(302) });
    expect(standingGoals([backwards, GOAL_REWORDED], none).map((l) => l.id)).toEqual([id(302)]);
    expect(standingGoals([edit(GOAL, {}, { kind: "note" }), GOAL_REWORDED], none)).toHaveLength(1);
  });

  it("an id that is no goal line has no standing goal", () => {
    expect(standingGoal([GOAL, GOAL_REWORDED], none, id(999))).toBeUndefined();
  });
});

describe("review/v1 (RFC 0036): the owner's verdict on a goal at a date", () => {
  it("names the kind, the schema, the five dispositions and the five periods", () => {
    expect([REVIEW_KIND, REVIEW_SCHEMA]).toEqual(["review", "review/v1"]);
    expect(DISPOSITIONS).toEqual(["advancing", "stalled", "done", "let go", "superseded"]);
    expect(PERIODS).toEqual(["day", "week", "month", "quarter", "year"]);
  });

  it("the RFC's example, backfilled from October to August, is a review with nothing against it", () => {
    expect(isReview(REVIEW)).toBe(true);
    expect(reviewProblems(REVIEW)).toEqual([]);
  });

  it("is the owner's verdict: kind review, tier 2, source manual, end null", () => {
    expect(reviewProblems(edit(REVIEW, {}, { tier: 1, source: "mcp" }))).toEqual([
      "tier must be 2",
      "source must be manual",
    ]);
  });

  it("holds the fields of the table: a goal id, one of exactly five dispositions, a period, a note", () => {
    expect(reviewProblems(edit(REVIEW, { goal: undefined }))).toEqual([
      "goal must be the id of the goal line reviewed",
    ]);
    expect(reviewProblems(edit(REVIEW, { disposition: "let_go" }))).toEqual([
      "disposition must be one of advancing, stalled, done, let go, superseded, not 'let_go'",
    ]);
    expect(reviewProblems(edit(REVIEW, { disposition: "Let go" }))).toEqual([
      "disposition must be one of advancing, stalled, done, let go, superseded, not 'Let go'",
    ]);
    expect(reviewProblems(edit(REVIEW, { period: "fortnight" }))).toEqual([
      "period must be one of day, week, month, quarter, year, not 'fortnight'",
    ]);
    expect(reviewProblems(edit(REVIEW, { note: ["Engine gone"] }))).toEqual([
      "note must be the verdict in the owner's words, a string",
    ]);
    expect(reviewProblems(edit(REVIEW, { note: undefined }))).toEqual([]);
  });

  it("against the record: the goal is a goal line, the date not before its from, nor ahead of the writing", () => {
    const goals = [GOAL, GOAL_REWORDED];
    expect(reviewRecordProblems(REVIEW, goals, none, "Europe/Oslo")).toEqual([]);
    expect(
      reviewRecordProblems(edit(REVIEW, { goal: id(999) }), goals, none, "Europe/Oslo"),
    ).toEqual([`goal names no goal line: ${id(999)}`]);
    expect(reviewRecordProblems(REVIEW, goals, retractedSet(id(302)), "Europe/Oslo")).toEqual([
      `goal names a retracted goal line: ${id(302)}`,
    ]);
    // 23:30 on 31 December in Oslo is 2025, before the goal's from.
    const early = edit(REVIEW, {}, { at: "2025-12-31T22:30:00Z" });
    expect(reviewRecordProblems(early, goals, none, "Europe/Oslo")).toEqual([
      "at is on 2025-12-31, before the goal's from, 2026-01-01",
    ]);
    const ahead = edit(REVIEW, {}, { at: "2026-10-11T18:35:01Z" });
    expect(reviewRecordProblems(ahead, goals, none, "Europe/Oslo")).toEqual([
      "at is more than five minutes after recorded_at, when it was written",
    ]);
    const justSo = edit(REVIEW, {}, { at: "2026-10-11T18:35:00Z" });
    expect(reviewRecordProblems(justSo, goals, none, "Europe/Oslo")).toEqual([]);
  });

  it("dedupes on (goal, period, at): one verdict per goal per period per date", () => {
    expect(reviewKey(REVIEW)).toBe(
      JSON.stringify([id(302), "month", Date.parse("2026-08-31T20:00:00Z")]),
    );
    const again = edit(REVIEW, { note: "Said again." }, { id: id(602), seq: 99 });
    const sameInstant = edit(
      REVIEW,
      {},
      { id: id(603), seq: 100, at: "2026-08-31T22:00:00+02:00" },
    );
    const otherPeriod = edit(REVIEW, { period: "quarter" }, { id: id(604), seq: 101 });
    const found = duplicates([REVIEW, again, sameInstant, otherPeriod], none, reviewKey);
    expect(found.map(({ line: l, held }) => [l.id, held.id])).toEqual([
      [id(602), id(601)],
      [id(603), id(601)],
    ]);
    // A second opinion on the same date is a retraction of the first and a new line.
    expect(duplicates([REVIEW, again], retractedSet(id(601)), reviewKey)).toEqual([]);
  });
});

describe("standing reviews and open goals (review/v1 rules 2 and 3, goal/v1 rule 3)", () => {
  const goals = [GOAL, GOAL_REWORDED];
  const review = (
    n: number,
    at: string,
    disposition: string,
    goal = id(302),
  ): ReturnType<typeof line> =>
    line({
      id: id(600 + n),
      at,
      source: "manual",
      kind: "review",
      tier: 2,
      payload: { schema: "review/v1", goal, disposition, period: "month" },
    });

  it("the standing review of a goal is its latest by at, then seq, whatever order they were written in", () => {
    const august = review(11, "2026-08-31T20:00:00Z", "let go");
    const june = review(12, "2026-06-30T20:00:00Z", "advancing");
    const standing = standingReviews(goals, [august, june], none);
    expect([...standing.keys()]).toEqual([id(302)]);
    expect(standing.get(id(302))?.id).toBe(august.id);
  });

  it("a review of a superseded goal line counts for the goals that supersede it: the chain is one goal", () => {
    const ofJanuary = review(13, "2026-02-28T20:00:00Z", "stalled", id(301));
    expect(standingReviews(goals, [ofJanuary], none).get(id(302))?.id).toBe(ofJanuary.id);
  });

  it("a retracted review does not stand; the one before it does", () => {
    const june = review(14, "2026-06-30T20:00:00Z", "advancing");
    const august = review(15, "2026-08-31T20:00:00Z", "done");
    expect(standingReviews(goals, [june, august], retractedSet(august.id)).get(id(302))?.id).toBe(
      june.id,
    );
  });

  it("open goals: standing, until not past, and not closed by done, let go or superseded", () => {
    expect(openGoals(goals, [], none, "2026-10-13").map((l) => l.id)).toEqual([id(302)]);
    expect(openGoals(goals, [REVIEW], none, "2026-10-13")).toEqual([]);
    expect(openGoals(goals, [], none, "2027-01-01")).toEqual([]);
    expect(openGoals(goals, [], none, "2026-12-31").map((l) => l.id)).toEqual([id(302)]);
    const stalled = review(16, "2026-07-31T20:00:00Z", "stalled");
    expect(openGoals(goals, [stalled], none, "2026-10-13")).toHaveLength(1);
  });

  it("a goal closed and then reviewed advancing is open again: the later verdict stands", () => {
    const done = review(17, "2026-07-31T20:00:00Z", "done");
    const reopened = review(18, "2026-08-31T20:00:00Z", "advancing");
    expect(openGoals(goals, [done, reopened], none, "2026-10-13")).toHaveLength(1);
  });

  it("a goal reviewed superseded is closed whether or not a new goal has been written yet", () => {
    const superseded = review(19, "2026-02-01T20:00:00Z", "superseded", id(301));
    expect(openGoals([GOAL], [superseded], none, "2026-10-13")).toEqual([]);
  });
});
