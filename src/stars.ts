/**
 * RFC 0041, `star/v1` (draft, 2026-10-14): the owner's mark on one line of the record, *this one*.
 * Read behind the `rfc0041` flag (`flags.ts`) as the reference's `show` and Day print it since its
 * 0.7.0, matched by running it, never by reading it.
 *
 * - `starProblems` holds a line to the RFC's table and line rules: `kind` `star`, `source`
 *   `manual`, `end` null, the payload's `line` and `kind` (MUST), `note` one line (MAY),
 *   `supersedes` (MAY); `starLineProblems` holds it to the line it stars (`at` and `tier` the
 *   starred line's, rule 5's kinds). The sentences are this implementation's: the reference's
 *   validator, if it has one, is not read here.
 * - `standingStars`: the standing star of each line (rule 3): the latest star naming it that is not
 *   retracted and not named in the `supersedes` of a later star that is not retracted itself (the
 *   reference's #321); a star on a retracted line, or on a star, a keeper, a retraction or a draft
 *   (rule 5), stars nothing. A star on a line another supersedes still stands, as the reference
 *   reads it (SPEC-QUESTIONS 114).
 * - `starRow`: `show`'s row, `★ event 019cadd3… · the table by the river`.
 *
 * A photo is starred with `keeper/v1` (rule 2), read where keepers are read.
 */

import { pyRepr, pyStr } from "./pyrepr.js";
import type { JsonValue, Line, Payload } from "./types.js";

export const STAR_KIND = "star";
export const STAR_SCHEMA = "star/v1";

/** The kinds a star never names (rule 5): a mark on a mark, an unmarking, a model's draft. */
export const UNSTARRABLE: ReadonlySet<string> = new Set(["star", "keeper", "retraction", "draft"]);

const isText = (v: JsonValue | undefined): v is string => typeof v === "string" && v !== "";

/** Whether a line is a `star/v1` line. */
export const isStar = (line: Line): boolean =>
  line.kind === STAR_KIND && line.payload?.schema === STAR_SCHEMA;

/** Every way a line is not a `star/v1` line by RFC 0041's table, in words; empty when it is one. */
export function starProblems(line: Line): string[] {
  const problems: string[] = [];
  const p: Payload = line.payload ?? { schema: "" };
  if (line.kind !== STAR_KIND) problems.push(`kind must be star, not ${pyRepr(line.kind)}`);
  if (line.source !== "manual") problems.push("source must be manual: a star is the owner's act");
  if (line.end !== null) problems.push("end must be null");
  if (p.schema !== STAR_SCHEMA) problems.push(`schema must be ${STAR_SCHEMA}`);
  if (!isText(p.line)) problems.push("line must be the id of the starred line");
  if (!isText(p.kind)) problems.push("kind must be the starred line's kind");
  if ("note" in p) {
    if (typeof p.note !== "string") problems.push("note must be text");
    else if (/[\r\n]/.test(p.note)) problems.push("note must be one line");
  }
  if ("supersedes" in p && !isText(p.supersedes))
    problems.push("supersedes must be the id of the star this one replaces");
  return problems;
}

/**
 * Every way a star does not fit the line it stars (RFC 0041's line rules and rule 5), in words;
 * empty when it fits. `starred` is the line its `line` names, undefined when the record has none.
 */
export function starLineProblems(star: Line, starred: Line | undefined): string[] {
  const p: Payload = star.payload ?? { schema: "" };
  if (starred === undefined)
    return [`line names ${pyRepr(p.line)}, which is no line of the record`];
  const problems: string[] = [];
  if (UNSTARRABLE.has(starred.kind))
    problems.push(`a ${starred.kind} line is never starred (rule 5)`);
  if (star.at !== starred.at) problems.push("at must be the starred line's at");
  if (star.tier !== starred.tier) problems.push("tier must be the starred line's tier");
  if (p.kind !== starred.kind)
    problems.push(`kind must be ${pyRepr(starred.kind)}, the line's kind`);
  return problems;
}

/** A line's standing star, as the Day's `stars` gives it. */
export interface StarJson {
  /** The starred line's id. */
  line: string;
  /** The star line's id. */
  star: string;
  kind: string;
  note: string | null;
}

/**
 * The standing star of each line of `lines` (rule 3), by the starred line's id, in the starred
 * lines' `seq` order. `lines` are the lines a reader holds (a day's), retractions aside; `retracted` says
 * whether a line is retracted.
 */
export function standingStars(
  lines: readonly Line[],
  retracted: (id: string) => boolean,
): Map<string, StarJson> {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const stars = lines.filter((l) => isStar(l) && !retracted(l.id));
  const superseded = new Set<string>();
  for (const s of stars) {
    const earlier = s.payload.supersedes;
    if (typeof earlier === "string") superseded.add(earlier);
  }
  const found = new Map<string, { seq: number; star: StarJson }>();
  for (const s of [...stars].sort((a, b) => a.seq - b.seq)) {
    if (superseded.has(s.id)) continue;
    const target = s.payload.line;
    if (typeof target !== "string") continue;
    const starred = byId.get(target);
    if (starred === undefined || retracted(starred.id) || UNSTARRABLE.has(starred.kind)) continue;
    const kind = s.payload.kind;
    const note = s.payload.note;
    found.set(target, {
      seq: s.seq,
      star: {
        line: target,
        star: s.id,
        kind: typeof kind === "string" ? kind : starred.kind,
        note: typeof note === "string" ? note : null,
      },
    });
  }
  // By the starred line's seq, as the reference's Day lists them.
  const seqOf = (id: string): number => byId.get(id)?.seq ?? 0;
  return new Map(
    [...found.entries()]
      .sort((a, b) => seqOf(a[0]) - seqOf(b[0]))
      .map(([id, { star }]) => [id, star]),
  );
}

const truthy = (v: JsonValue | undefined): boolean =>
  v !== undefined && v !== null && v !== false && v !== 0 && v !== "";

/**
 * `show`'s row of a star, as the reference prints it: `★`, the starred line's kind, the first eight
 * characters of its id and `…`, then ` · <note>` when it has one; `?` for a field that is not there.
 */
export function starRow(p: Payload): string {
  const kind = truthy(p.kind) ? pyStr(p.kind) : "?";
  const line = truthy(p.line) ? [...pyStr(p.line)].slice(0, 8).join("") : "?";
  const note = truthy(p.note) ? ` · ${pyStr(p.note)}` : "";
  return `★ ${kind} ${line}…${note}`;
}
