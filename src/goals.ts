/**
 * `goal/v1` and `review/v1` (RFC 0036, draft, 2026-10-13): a goal in the owner's own words, and the
 * owner's verdict on it at a date. Both are the owner's words, so both are tier 2, MUST, and `source`
 * `manual`, as `note/v1` is (SPEC §4: notes, decisions, confirmations are tier 2): a writer never
 * lowers it and no import option moves it. A goal reworded is a new goal line carrying `supersedes`;
 * what became of a goal is a review line, never an edit; a later review stands over an earlier one.
 *
 * Nothing here writes: the writers (`goal add`, `goal review`, RFC 0036 amendment 1) are the
 * reference's. What is here is each profile's field table checked (`goalProblems`, `reviewProblems`),
 * the rules a writer holds a review to against the record (`reviewRecordProblems`), the dedupe key of
 * a review (`reviewKey`; a goal has none), the standing goal of a chain, the standing review of a
 * goal and the open goals. The reference prints no refusal of its own for these profiles yet (it has
 * no writer and no reader that checks them, openlogbook 0.6.1), so the sentences are this
 * implementation's, in the style of the reference's `signing.validate` (SPEC-QUESTIONS 88). The
 * profiles are new, not RFC 0031 freezes: their schemas may change while RFC 0036 is a draft.
 */

import { localDayOf } from "./dayStart.js";
import {
  envelopeProblems,
  type Fields,
  fieldsOf,
  isDayString,
  isText,
  lineageOf,
  oneOf,
  type Retracted,
  standingLines,
} from "./lineRules.js";
import type { Line } from "./types.js";

export const GOAL_KIND = "goal";
export const GOAL_SCHEMA = "goal/v1";
export const REVIEW_KIND = "review";
export const REVIEW_SCHEMA = "review/v1";
/** The owner's words: tier 2, MUST (SPEC §4, as `note/v1`). */
const OWNER_TIER = 2;
const OWNER_SOURCE = "manual";

/** The kind of goal, which the owner knows when writing and a reader groups by. */
export const HORIZONS = ["life", "year", "quarter"] as const;
/** Exactly five: two open verdicts, two closings, and the one that points at another goal. */
export const DISPOSITIONS = ["advancing", "stalled", "done", "let go", "superseded"] as const;
export type GoalDisposition = (typeof DISPOSITIONS)[number];
/** The dispositions that close a goal; `advancing` and `stalled` keep it open. */
export const CLOSING: readonly GoalDisposition[] = ["done", "let go", "superseded"];
/** The stretch a verdict covers, the one that holds `at`. */
export const PERIODS = ["day", "week", "month", "quarter", "year"] as const;
/** How far ahead of its writer's clock a review's `at` may be (RFC 0034 amendment 2's rule). */
export const AHEAD_MS = 5 * 60_000;

const isWord = (words: readonly string[], v: unknown): boolean =>
  typeof v === "string" && words.includes(v);

/** Whether a line is a `goal/v1` line at all: the kind and the schema. The rest is `goalProblems`. */
export const isGoal = (line: Line): boolean =>
  line.kind === GOAL_KIND && fieldsOf(line).schema === GOAL_SCHEMA;

/** Whether a line is a `review/v1` line at all: the kind and the schema. The rest is `reviewProblems`. */
export const isReview = (line: Line): boolean =>
  line.kind === REVIEW_KIND && fieldsOf(line).schema === REVIEW_SCHEMA;

function supersedesProblem(p: Fields, what: string): string[] {
  return p.supersedes !== undefined && !isText(p.supersedes)
    ? [`supersedes must be the id of the earlier ${what} line`]
    : [];
}

/**
 * Why a line is not a `goal/v1` line as RFC 0036 defines one, one sentence per rule broken, in the
 * field table's order; empty when it is one. Anything else in the payload is the owner's to keep.
 */
export function goalProblems(line: Line): string[] {
  const p = fieldsOf(line);
  const problems = envelopeProblems(line, {
    kind: GOAL_KIND,
    schema: GOAL_SCHEMA,
    tier: OWNER_TIER,
    source: OWNER_SOURCE,
  });
  if (!isText(p.text)) {
    problems.push("text must be the goal in the owner's words, a string that is not empty");
  }
  if (!isWord(HORIZONS, p.horizon)) problems.push(`horizon must be ${oneOf(HORIZONS, p.horizon)}`);
  const from = isDayString(p.from) ? p.from : undefined;
  if (from === undefined) {
    problems.push(
      "from must be YYYY-MM-DD, a real calendar day, the first local day the goal holds for",
    );
  }
  if (p.until !== undefined) {
    if (!isDayString(p.until)) {
      problems.push(
        "until must be YYYY-MM-DD, a real calendar day, the last local day the goal holds for",
      );
    } else if (from !== undefined && p.until < from) {
      problems.push(`until is before from: ${p.until} < ${from}`);
    }
  }
  problems.push(...supersedesProblem(p, "goal"));
  return problems;
}

/**
 * Why a line is not a `review/v1` line as RFC 0036 defines one, one sentence per rule broken, in the
 * field table's order; empty when it is one. What the line says about the record (that its goal is a
 * goal line, that its date is not before the goal's) is `reviewRecordProblems`.
 */
export function reviewProblems(line: Line): string[] {
  const p = fieldsOf(line);
  const problems = envelopeProblems(line, {
    kind: REVIEW_KIND,
    schema: REVIEW_SCHEMA,
    tier: OWNER_TIER,
    source: OWNER_SOURCE,
  });
  if (!isText(p.goal)) problems.push("goal must be the id of the goal line reviewed");
  if (!isWord(DISPOSITIONS, p.disposition)) {
    problems.push(`disposition must be ${oneOf(DISPOSITIONS, p.disposition)}`);
  }
  if (!isWord(PERIODS, p.period)) problems.push(`period must be ${oneOf(PERIODS, p.period)}`);
  if (p.note !== undefined && typeof p.note !== "string") {
    problems.push("note must be the verdict in the owner's words, a string");
  }
  return problems;
}

/**
 * The rules a writer holds a review to against the record (review/v1 rule 4, RFC 0036 amendment 1's
 * `goal review`): its `goal` names a goal line that is not retracted; its `at` is not on a local day
 * before that goal's `from`, in the record's zone; and its `at` is not more than five minutes after
 * its own `recorded_at`, the writer's clock. Backfilling, an `at` long before `recorded_at`, is a
 * feature. Empty when the line breaks none of them.
 */
export function reviewRecordProblems(
  line: Line,
  goals: Iterable<Line>,
  retracted: Retracted,
  timezone: string,
  dayStart?: string,
): string[] {
  const problems: string[] = [];
  const named = fieldsOf(line).goal;
  const goal = [...goals].find((l) => isGoal(l) && l.id === named);
  if (typeof named === "string" && goal === undefined) {
    problems.push(`goal names no goal line: ${named}`);
  } else if (goal !== undefined && retracted.has(goal.id)) {
    problems.push(`goal names a retracted goal line: ${goal.id}`);
  }
  const at = Date.parse(String(line.at));
  const from = goal === undefined ? undefined : fieldsOf(goal).from;
  if (!Number.isNaN(at) && isDayString(from)) {
    const day = localDayOf(at, timezone, dayStart);
    if (day < from) problems.push(`at is on ${day}, before the goal's from, ${from}`);
  }
  const written = Date.parse(String(line.recorded_at));
  if (!Number.isNaN(at) && !Number.isNaN(written) && at - written > AHEAD_MS) {
    problems.push("at is more than five minutes after recorded_at, when it was written");
  }
  return problems;
}

/**
 * The dedupe key of a review (review/v1 rule 1): `(goal, period, at)`, `at` as the instant it names, so
 * one moment spelled in two offsets is one date. Undefined for a line that is not a review.
 */
export function reviewKey(line: Line): string | undefined {
  if (!isReview(line)) return undefined;
  const p = fieldsOf(line);
  const at = Date.parse(String(line.at));
  return JSON.stringify([p.goal ?? null, p.period ?? null, Number.isNaN(at) ? line.at : at]);
}

/**
 * The standing goals (goal/v1 rule 2): the goal lines not retracted and not named in a later goal's
 * `supersedes`, in `seq` order. There is no dedupe key: the same text twice is two goals.
 */
export const standingGoals = (lines: Iterable<Line>, retracted: Retracted): Line[] =>
  standingLines(lines, retracted, isGoal);

/** Each standing goal with the ids of its chain, its own first: the goal lines it rewords, back to the first. */
function chains(lines: Iterable<Line>, retracted: Retracted): Array<{ goal: Line; ids: string[] }> {
  const all = [...lines].filter(isGoal);
  const byId = new Map(all.map((l) => [l.id, l]));
  return standingGoals(all, retracted).map((goal) => ({ goal, ids: lineageOf(goal, byId) }));
}

/**
 * The standing goal of the chain the goal line `goalId` belongs to: the latest standing goal that
 * rewords it, or that is it. Undefined when no standing goal's chain holds it.
 */
export function standingGoal(
  lines: Iterable<Line>,
  retracted: Retracted,
  goalId: string,
): Line | undefined {
  let found: Line | undefined;
  for (const { goal, ids } of chains(lines, retracted)) {
    if (ids.includes(goalId) && (found === undefined || goal.seq > found.seq)) found = goal;
  }
  return found;
}

/**
 * The standing review of each standing goal (review/v1 rule 2), by the standing goal's id: of the
 * reviews not retracted that name a line of its chain (a review of a superseded goal line counts for
 * the goals that supersede it), the latest by `at`, then `seq`. A goal with none is unreviewed and is
 * not in the map.
 */
export function standingReviews(
  goals: Iterable<Line>,
  reviews: Iterable<Line>,
  retracted: Retracted,
): Map<string, Line> {
  const out = new Map<string, Line>();
  const live = [...reviews].filter((l) => isReview(l) && !retracted.has(l.id));
  const later = (a: Line, b: Line): boolean => {
    const ta = Date.parse(String(a.at));
    const tb = Date.parse(String(b.at));
    return ta > tb || (ta === tb && a.seq > b.seq);
  };
  for (const { goal, ids } of chains(goals, retracted)) {
    for (const review of live) {
      if (!ids.includes(String(fieldsOf(review).goal))) continue;
      const held = out.get(goal.id);
      if (held === undefined || later(review, held)) out.set(goal.id, review);
    }
  }
  return out;
}

/**
 * The open goals on `today` (goal/v1 rule 3): the standing goals whose `until` is absent or not yet
 * past and whose standing review does not close them (`done`, `let go`, `superseded`), in `seq` order.
 */
export function openGoals(
  goals: Iterable<Line>,
  reviews: Iterable<Line>,
  retracted: Retracted,
  today: string,
): Line[] {
  const all = [...goals];
  const verdicts = standingReviews(all, reviews, retracted);
  return standingGoals(all, retracted).filter((goal) => {
    const until = fieldsOf(goal).until;
    if (isDayString(until) && today > until) return false;
    const verdict = verdicts.get(goal.id);
    const word = verdict === undefined ? undefined : fieldsOf(verdict).disposition;
    return !CLOSING.includes(word as GoalDisposition);
  });
}
