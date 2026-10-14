/**
 * What RFC 0036's four profiles share (goal/v1, review/v1, draft/v1, chapter/v1): the envelope a
 * profile fixes, the standing line of a chain of `supersedes` (SPEC §3: a correction is a new line,
 * never an edit; RFC 0010 rule 2, RFC 0034 rule 3), and the dedupe key a writer holds a new line to.
 * Nothing here reads the record or writes to it: a caller holds the lines.
 */

import { isDay } from "./clock.js";
import { pyRepr } from "./pyrepr.js";
import type { JsonValue, Line } from "./types.js";

/** Which line ids a retraction hides (RFC 0003), as a reader's resolver answers it. */
export interface Retracted {
  has(id: string): boolean;
}

export type Fields = Record<string, JsonValue | undefined>;

export const isObject = (v: unknown): v is Fields =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** The payload as an object; an empty one when the line's payload is not an object. */
export const fieldsOf = (line: Line): Fields => (isObject(line.payload) ? line.payload : {});

/** A string a reader can show: present, and not only blanks. */
export const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** `YYYY-MM-DD`, a real calendar day. */
export const isDayString = (v: unknown): v is string => typeof v === "string" && isDay(v);

/** `one of a, b, c, not 'd'`: a word outside a closed list, with the value as the reference quotes one. */
export const oneOf = (words: readonly string[], value: unknown): string =>
  `one of ${words.join(", ")}, not ${pyRepr(value as JsonValue)}`;

/** What a profile fixes on the envelope; `tier` and `source` are left out where the profile does not fix them. */
export interface Envelope {
  kind: string;
  schema: string;
  tier?: number;
  source?: string;
}

/** The envelope's rules a line of the profile breaks, one sentence each: kind, tier, source, end, schema. */
export function envelopeProblems(line: Line, envelope: Envelope): string[] {
  const problems: string[] = [];
  if (line.kind !== envelope.kind) problems.push(`kind must be ${envelope.kind}`);
  if (envelope.tier !== undefined && line.tier !== envelope.tier) {
    problems.push(`tier must be ${envelope.tier}`);
  }
  if (envelope.source !== undefined && line.source !== envelope.source) {
    problems.push(`source must be ${envelope.source}`);
  }
  if (line.end !== null && line.end !== undefined) problems.push("end must be null");
  if (fieldsOf(line).schema !== envelope.schema) problems.push(`schema must be ${envelope.schema}`);
  return problems;
}

/** The id a line's `supersedes` names, when it names one. */
export const supersedesOf = (line: Line): string | undefined => {
  const named = fieldsOf(line).supersedes;
  return isText(named) ? named : undefined;
};

const bySeq = (a: Line, b: Line): number => a.seq - b.seq;

/**
 * The lines of a profile that stand: of `lines`, those `isProfile` keeps, not retracted, and not named
 * in the `supersedes` of a later line of the profile that is not retracted itself, in `seq` order. A
 * `supersedes` that names a later line, or a line of another profile, supersedes nothing; a retracted
 * rewording leaves the line it named standing (as a retracted signature does, RFC 0034 rule 3).
 */
export function standingLines(
  lines: Iterable<Line>,
  retracted: Retracted,
  isProfile: (line: Line) => boolean,
): Line[] {
  const own = [...lines].filter(isProfile).sort(bySeq);
  const seqOf = new Map(own.map((l) => [l.id, l.seq]));
  const superseded = new Set<string>();
  for (const l of own) {
    if (retracted.has(l.id)) continue;
    const named = supersedesOf(l);
    const earlier = named === undefined ? undefined : seqOf.get(named);
    if (named !== undefined && earlier !== undefined && earlier < l.seq) superseded.add(named);
  }
  return own.filter((l) => !retracted.has(l.id) && !superseded.has(l.id));
}

/**
 * The ids a line's chain of `supersedes` runs back through, the line's own first: each an earlier line
 * of the profile, as `byId` holds them. A cycle or a forward reference ends the walk.
 */
export function lineageOf(line: Line, byId: ReadonlyMap<string, Line>): string[] {
  const out = [line.id];
  const seen = new Set(out);
  let at = line;
  for (;;) {
    const named = supersedesOf(at);
    const earlier = named === undefined ? undefined : byId.get(named);
    if (earlier === undefined || seen.has(earlier.id) || earlier.seq >= at.seq) return out;
    out.push(earlier.id);
    seen.add(earlier.id);
    at = earlier;
  }
}

/**
 * The lines a writer would have refused for their dedupe key: in `seq` order, each line not retracted
 * whose key an earlier line not retracted already holds, with that earlier line. `keyOf` gives
 * undefined for a line without a key (a line of another profile), which is never a duplicate. A
 * retracted line holds no key, so the owner's second opinion after retracting the first is not one;
 * and a line whose `supersedes` names the line holding its key is a new line of it (a chapter closed
 * keeps its name and its first day), which holds the key from then on.
 */
export function duplicates(
  lines: Iterable<Line>,
  retracted: Retracted,
  keyOf: (line: Line) => string | undefined,
): Array<{ line: Line; held: Line }> {
  const held = new Map<string, Line>();
  const out: Array<{ line: Line; held: Line }> = [];
  for (const l of [...lines].sort(bySeq)) {
    if (retracted.has(l.id)) continue;
    const key = keyOf(l);
    if (key === undefined) continue;
    const first = held.get(key);
    if (first === undefined || supersedesOf(l) === first.id) held.set(key, l);
    else out.push({ line: l, held: first });
  }
  return out;
}
