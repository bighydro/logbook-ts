/**
 * `chapter/v1` (RFC 0036, draft, 2026-10-13): a named stretch of the record, a sabbatical, a passage,
 * the year after a move. It has a name, a first day, a last day once the owner has closed it, and the
 * chapter's rules in plain text, which a reader prints and derives nothing from. It is the owner's
 * words, so tier 2, MUST, and `source` `manual`. A chapter closed, renamed or moved is a new line with
 * `supersedes` and every field again; a day belongs to the standing chapter open on it.
 *
 * Nothing here writes (`chapter open` and `chapter close` are the reference's, amendment 1), and the
 * Day's header does not name the chapter yet. What is here is the field table checked
 * (`chapterProblems`, in this implementation's words: the reference has no check of its own yet,
 * SPEC-QUESTIONS 88), the dedupe key `(name, from)`, the standing chapters, the chapter of a local day
 * with the clash rule 4 marks, and the clashes a writer would have refused.
 */

import {
  envelopeProblems,
  fieldsOf,
  isDayString,
  isText,
  type Retracted,
  standingLines,
} from "./lineRules.js";
import type { Line } from "./types.js";

export const CHAPTER_KIND = "chapter";
export const CHAPTER_SCHEMA = "chapter/v1";

/** Whether a line is a `chapter/v1` line at all: the kind and the schema. The rest is `chapterProblems`. */
export const isChapter = (line: Line): boolean =>
  line.kind === CHAPTER_KIND && fieldsOf(line).schema === CHAPTER_SCHEMA;

/**
 * Why a line is not a `chapter/v1` line as RFC 0036 defines one, one sentence per rule broken, in the
 * field table's order; empty when it is one. `rules` may be empty; it may not be missing.
 */
export function chapterProblems(line: Line): string[] {
  const p = fieldsOf(line);
  const problems = envelopeProblems(line, {
    kind: CHAPTER_KIND,
    schema: CHAPTER_SCHEMA,
    tier: 2,
    source: "manual",
  });
  if (!isText(p.name)) {
    problems.push(
      "name must be the chapter's name in the owner's words, a string that is not empty",
    );
  }
  const from = isDayString(p.from) ? p.from : undefined;
  if (from === undefined) {
    problems.push("from must be YYYY-MM-DD, a real calendar day, the chapter's first local day");
  }
  if (p.to !== undefined) {
    if (!isDayString(p.to)) {
      problems.push("to must be YYYY-MM-DD, a real calendar day, the chapter's last local day");
    } else if (from !== undefined && p.to < from) {
      problems.push(`to is before from: ${p.to} < ${from}`);
    }
  }
  if (typeof p.rules !== "string") {
    problems.push(
      "rules must be the chapter's rules as plain text, a string, empty when the owner has not said",
    );
  }
  if (p.supersedes !== undefined && !isText(p.supersedes)) {
    problems.push("supersedes must be the id of the earlier chapter line");
  }
  return problems;
}

/** The dedupe key of a chapter (chapter/v1 rule 1): `(name, from)`. Undefined for a line that is not a chapter. */
export function chapterKey(line: Line): string | undefined {
  if (!isChapter(line)) return undefined;
  const p = fieldsOf(line);
  return JSON.stringify([p.name ?? null, p.from ?? null]);
}

/** The standing chapters (chapter/v1 rule 2): not retracted, not named in a later chapter's `supersedes`, in `seq` order. */
export const standingChapters = (lines: Iterable<Line>, retracted: Retracted): Line[] =>
  standingLines(lines, retracted, isChapter);

/** A chapter as the Day's JSON carries it: `{ name, line, from, to }`, `to` null while it is open. */
export interface ChapterState {
  name: string;
  line: string;
  from: string;
  to: string | null;
}

const stateOf = (line: Line): ChapterState => {
  const p = fieldsOf(line);
  return {
    name: String(p.name),
    line: String(line.id),
    from: String(p.from),
    to: isDayString(p.to) ? p.to : null,
  };
};

/** The stretch of a standing chapter, when its days can be read: its first day and its last, or null while open. */
function stretchOf(line: Line): { from: string; to: string | null } | undefined {
  const p = fieldsOf(line);
  if (!isDayString(p.from)) return undefined;
  return { from: p.from, to: isDayString(p.to) ? p.to : null };
}

const isOpenOn = (line: Line, day: string): boolean => {
  const stretch = stretchOf(line);
  return stretch !== undefined && stretch.from <= day && (stretch.to === null || stretch.to >= day);
};

/** Later by `from`, then `seq` (chapter/v1 rule 4). */
const laterFirst = (a: Line, b: Line): number => {
  const fa = String(fieldsOf(a).from);
  const fb = String(fieldsOf(b).from);
  return fa === fb ? b.seq - a.seq : fa < fb ? 1 : -1;
};

/**
 * The chapter of a local day (chapter/v1 rule 3): the standing chapter whose `from` is on or before
 * the day and whose `to` is absent or on or after it; null when the day is in none. When two standing
 * chapters are open on the day anyway (two writers, a retraction that reopened one), the later by
 * `from`, then `seq`, is the day's and the others' ids are the clash (rule 4).
 */
export function chapterOf(
  lines: Iterable<Line>,
  retracted: Retracted,
  day: string,
): { chapter: ChapterState | null; clash: string[] } {
  const open = standingChapters(lines, retracted)
    .filter((l) => isOpenOn(l, day))
    .sort(laterFirst);
  const [first, ...rest] = open;
  return {
    chapter: first === undefined ? null : stateOf(first),
    clash: rest.map((l) => String(l.id)),
  };
}

/**
 * The pairs of standing chapters whose stretches overlap (chapter/v1 rule 4: a writer refuses one,
 * naming the other), the earlier line of each pair first; an open chapter runs on.
 */
export function chapterClashes(lines: Iterable<Line>, retracted: Retracted): Array<[Line, Line]> {
  const standing = standingChapters(lines, retracted).filter((l) => stretchOf(l) !== undefined);
  const out: Array<[Line, Line]> = [];
  for (const [i, a] of standing.entries()) {
    const sa = stretchOf(a) as { from: string; to: string | null };
    for (const b of standing.slice(i + 1)) {
      const sb = stretchOf(b) as { from: string; to: string | null };
      const aEndsBefore = sa.to !== null && sa.to < sb.from;
      const bEndsBefore = sb.to !== null && sb.to < sa.from;
      if (!aEndsBefore && !bEndsBefore) out.push([a, b]);
    }
  }
  return out;
}
