/**
 * `draft/v1` (RFC 0036, draft, 2026-10-13, with amendment 1, open at this writing): a model's text about
 * one unit of the record, kept under one rule. Every segment points at the line ids it rests on, or is
 * marked unsupported, and a reader never shows an unsupported sentence as fact. A draft is a proposal:
 * nothing in it is a fact of the record until the owner confirms it through an act of their own.
 *
 * The line: `kind` `draft`, `source` `model:<name>` (never `manual`, never an adapter), `end` null,
 * and a tier that is the highest among the lines the model read, not only those it cites, so a reader
 * can hold it to no less than the lines a segment cites (`draftTierProblems`). The payload: `unit`
 * (`day`, `journey`, `event`, `week`, `month`, `year`, `chapter`, and amendment 1's `person`), the
 * `subject` in the unit's form, `read_head`, `read_count`, `language`, `segments`, `supersedes`, and
 * the amendment of 2026-10-13's `proposals`, MAY; amendment 1 adds `window`, MUST on a person and
 * absent elsewhere, and `read_policy`, SHOULD.
 *
 * A proposal is an object whose `kind` says what it proposes: `event`, and since amendment 2
 * (2026-10-21) `link`, a line of the unit that belongs to an idea or an org. Its forward compatibility
 * (the amendment of 2026-10-19): a reader shows the proposals of the kinds it knows, counts the others
 * as `proposals_unknown`, and does not call the line malformed for them; a known kind of the wrong
 * shape, or a proposal with no kind, is still malformed. Writers stay strict: `draftProblems`, the
 * whole field table, refuses a kind it does not know.
 *
 * The reference reads a day's draft on the Day and prints its row in `show`, and checks as it reads
 * (openlogbook 0.6.1, and its main at 6ee01c2, 2026-10-22, run on synthetic drafts): `read_head`,
 * `read_count`, `language`, `segments`, `supersedes`, `proposals` and `extra`. Those sentences are its
 * own, word for word, in its order, and like it the check names the first malformed segment and the
 * first malformed proposal only. The rest of the field table (unit, subject, source, window,
 * read_policy) has no reference sentence yet and is checked here in its style (SPEC-QUESTIONS 89).
 * `readDraft` is the reader's view of the line alone: the reference's `malformed` list, its reading of
 * each segment and its part, the proposals and links, and what `extra` says of the evening and of what
 * the writer marked and dropped; what the reference's Day reads beside the line (the lenses of
 * `policy/questions.json`, the story's closing line, the signature, what was kept and confirmed) is
 * not read here (SPEC-QUESTIONS 119). `draftRow` is the row `show` prints under the `rfc0036` flag.
 * Nothing here writes a draft, and the Day does not show one yet.
 */

import {
  envelopeProblems,
  type Fields,
  fieldsOf,
  isDayString,
  isObject,
  isText,
  oneOf,
  type Retracted,
  standingLines,
} from "./lineRules.js";
import { pyStr } from "./pyrepr.js";
import type { JsonValue, Line, Payload } from "./types.js";

export const DRAFT_KIND = "draft";
export const DRAFT_SCHEMA = "draft/v1";
/** The units a draft is about; `person` is amendment 1's. */
export const UNITS = [
  "day",
  "journey",
  "event",
  "week",
  "month",
  "year",
  "chapter",
  "person",
] as const;
export type Unit = (typeof UNITS)[number];
const MODEL_SOURCE = /^model:.+$/;
const HEX64 = /^[0-9a-f]{64}$/;
/** A BCP 47 tag as the reference accepts one: a language of two or three letters, subtags of two to eight. */
const BCP47 = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;
const WEEK = /^(\d{4})-W(\d{2})$/;

/** The one shape rule (RFC 0036, the evidence rule), as the reference says it. */
const SHAPE = "a segment is {text, evidence} or {text, unsupported: true}, nothing else";
const NO_TEXT = "(no text)";

/** Whether a line is a `draft/v1` line at all: the kind and the schema. The rest is `draftProblems`. */
export const isDraft = (line: Line): boolean =>
  line.kind === DRAFT_KIND && fieldsOf(line).schema === DRAFT_SCHEMA;

/** ISO 8601 weeks in a year: 53 when it begins on a Thursday, or on a Wednesday in a leap year. */
function isoWeeks(year: number): number {
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return jan1 === 4 || (leap && jan1 === 3) ? 53 : 52;
}

const isIsoWeek = (v: unknown): boolean => {
  const m = typeof v === "string" ? WEEK.exec(v) : null;
  if (m === null) return false;
  const week = Number(m[2]);
  return week >= 1 && week <= isoWeeks(Number(m[1]));
};

const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(isText);

/** What the subject of each unit is, as the field table says it. */
const SUBJECTS: Record<Unit, [(v: unknown) => boolean, string]> = {
  day: [isDayString, "the local day, YYYY-MM-DD"],
  week: [isIsoWeek, "the ISO week, YYYY-Www"],
  month: [(v) => typeof v === "string" && MONTH.test(v), "the month, YYYY-MM"],
  year: [(v) => typeof v === "string" && YEAR.test(v), "the year, YYYY"],
  journey: [isIdList, "the ids of the lines the unit is, as an array"],
  event: [isIdList, "the ids of the lines the unit is, as an array"],
  chapter: [isIdList, "the ids of the lines the unit is, as an array"],
  person: [isText, "one canonical person id, as a string"],
};

const isUnit = (v: unknown): v is Unit => typeof v === "string" && UNITS.includes(v as Unit);

/** A segment as the field table has it: an object with text and either evidence or `unsupported: true`. */
function segmentIs(segment: unknown): "supported" | "unsupported" | "malformed" {
  if (!isObject(segment) || !isText(segment.text)) return "malformed";
  if ("unsupported" in segment) {
    return segment.unsupported === true && !("evidence" in segment) ? "unsupported" : "malformed";
  }
  return isIdList(segment.evidence) ? "supported" : "malformed";
}

/** The kinds of proposal this implementation knows (draft/v1, the amendment of 2026-10-13 and amendment 2). */
export const PROPOSAL_KINDS = ["event", "link"] as const;
type ProposalKind = (typeof PROPOSAL_KINDS)[number];
/** An event proposal's keys: these, `place` among them the one that may be left out. */
const EVENT_KEYS = ["kind", "title", "start", "end", "place", "people", "evidence"];
/** A link proposal's keys: these, `note` the one that may be left out. */
const LINK_KEYS = ["kind", "entity", "text", "evidence", "note"];
/** The reference's sentences (its main at 6ee01c2, run): one for a link, one for every other malformed proposal. */
const EVENT_SHAPE =
  "a proposal is {kind: event, title, start, end, place, people, evidence}: start before end, both UTC with a Z, people and evidence lists of ids, evidence not empty";
const LINK_SHAPE =
  "a link is {kind: link, entity, text, evidence, note?}: entity an entity id, text what it says, evidence a non-empty list of line ids, note a string when given";
/** RFC 3339 in UTC with `Z`, the fraction kept to compare by. */
const UTC = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.(\d+))?Z$/;
/** An instant of an event, on a real calendar day: its second and its fraction, to compare to the last digit. */
function utcOf(v: unknown): [number, string] | undefined {
  const m = typeof v === "string" ? UTC.exec(v) : null;
  if (m === null || !isDayString(m[1])) return undefined;
  return [Date.parse(`${m[0].slice(0, 19)}Z`), (m[3] ?? "").replace(/0+$/, "")];
}
const before = (a: [number, string], b: [number, string]): boolean =>
  a[0] !== b[0] ? a[0] < b[0] : a[1].padEnd(b[1].length, "0") < b[1].padEnd(a[1].length, "0");

/** A list of ids as a proposal names them: each a non-empty string (the list itself may be empty here). */
const isIds = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string" && x !== "");
const hasOnly = (p: Fields, keys: readonly string[]): boolean =>
  Object.keys(p).every((key) => keys.includes(key));

/**
 * A proposal as a reader takes it (forward compatibility, rules 3 and 4): an event or a link of its
 * shape; a kind it does not know, `kind` a non-blank string other than these, matched as written; or
 * malformed: an event or a link of another shape, or not an object naming its kind at all.
 */
function proposalIs(proposal: unknown): ProposalKind | "unknown" | "malformed" {
  if (!isObject(proposal) || !isText(proposal.kind)) return "malformed";
  const p = proposal;
  if (p.kind === "event") {
    const start = utcOf(p.start);
    const end = utcOf(p.end);
    const shaped =
      hasOnly(p, EVENT_KEYS) &&
      isText(p.title) &&
      start !== undefined &&
      end !== undefined &&
      before(start, end) &&
      (p.place === undefined || p.place === null || isText(p.place)) &&
      isIds(p.people) &&
      isIds(p.evidence) &&
      p.evidence.length > 0;
    return shaped ? "event" : "malformed";
  }
  if (p.kind === "link") {
    const shaped =
      hasOnly(p, LINK_KEYS) &&
      isText(p.entity) &&
      isText(p.text) &&
      isIds(p.evidence) &&
      p.evidence.length > 0 &&
      (p.note === undefined || isText(p.note));
    return shaped ? "link" : "malformed";
  }
  return "unknown";
}

const proposalsOf = (p: Fields): JsonValue[] => (Array.isArray(p.proposals) ? p.proposals : []);

const isCount = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * `extra.read_until` as the reference's reader takes it: the shape of an instant in UTC, its calendar
 * unchecked, its digits any decimal digit, as Python's `\d` takes them (`٢٠٢٦` passes); nothing after the `Z`.
 */
const READ_UNTIL = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}T\p{Nd}{2}:\p{Nd}{2}:\p{Nd}{2}(\.\p{Nd}+)?Z$/u;

/**
 * What the reference's reader says is wrong with a draft, in its words and its order: `read_head`,
 * `read_count`, `language`, `segments` (the first malformed segment only), `supersedes`, `proposals`
 * (the first malformed proposal only), then `extra`: an object, its `evening` true when present, and
 * then its `read_until` an instant in UTC. A proposal of a kind the reader does not know is not malformed.
 */
function readerProblems(p: Fields): string[] {
  const problems: string[] = [];
  if (typeof p.read_head !== "string" || !HEX64.test(p.read_head)) {
    problems.push("read_head must be the record's head, 64 lowercase hex characters");
  }
  if (!isCount(p.read_count)) {
    problems.push("read_count must be how many lines of the unit the model read");
  }
  if (typeof p.language !== "string" || !BCP47.test(p.language)) {
    problems.push("language must be a BCP 47 tag, en or nb");
  }
  const segments = p.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    problems.push("segments must be a non-empty list");
  } else {
    const first = segments.findIndex((s) => segmentIs(s) === "malformed");
    if (first !== -1) problems.push(`segment ${first + 1} is malformed: ${SHAPE}`);
  }
  if ("supersedes" in p && !isText(p.supersedes)) {
    problems.push("supersedes must be the id of the earlier draft");
  }
  if (p.proposals !== undefined && !Array.isArray(p.proposals)) {
    problems.push("proposals must be a list");
  } else {
    const proposals = proposalsOf(p);
    const first = proposals.findIndex((proposal) => proposalIs(proposal) === "malformed");
    if (first !== -1) {
      const link = isObject(proposals[first]) && proposals[first].kind === "link";
      problems.push(`proposal ${first + 1} is malformed: ${link ? LINK_SHAPE : EVENT_SHAPE}`);
    }
  }
  const extra = p.extra;
  if (extra !== undefined && !isObject(extra)) {
    problems.push("extra must be an object");
  } else if (isObject(extra) && "evening" in extra) {
    if (extra.evening !== true) {
      problems.push("extra.evening is true when present");
    } else if (typeof extra.read_until !== "string" || !READ_UNTIL.test(extra.read_until)) {
      problems.push(
        "an evening draft's extra.read_until is the moment it read up to, UTC with a Z",
      );
    }
  }
  return problems;
}

const isPolicy = (v: unknown): boolean =>
  isObject(v) &&
  isText(v.entry) &&
  typeof v.max_tier === "number" &&
  Number.isInteger(v.max_tier) &&
  v.max_tier >= 0 &&
  v.max_tier <= 3 &&
  typeof v.sha256 === "string" &&
  HEX64.test(v.sha256);

/**
 * Why a line is not a `draft/v1` line as RFC 0036 and its amendment 1 define one, one sentence per
 * rule broken; empty when it is one. The envelope first, then `unit`, `subject` and `window`, then
 * what the reference's reader checks, in its words (`read_head`, `read_count`, `language`, `segments`,
 * `supersedes`, `proposals` and `extra`), then a proposal of a kind a writer may not write (the first
 * only: writers stay strict on the kind), then `read_policy`. A proposal's shape is the reader's: an
 * event may leave `place` out and an id is any non-empty string, as the reference's reader takes them
 * (SPEC-QUESTIONS 120, 121); no writer sentence of the reference says more. The tier is the lines' the
 * model read, so it is not checked here but against them (`draftTierProblems`).
 */
export function draftProblems(line: Line): string[] {
  const p = fieldsOf(line);
  const problems = envelopeProblems(line, { kind: DRAFT_KIND, schema: DRAFT_SCHEMA });
  if (typeof line.source !== "string" || !MODEL_SOURCE.test(line.source)) {
    problems.splice(1, 0, "source must be model:<name>, the model as its runner names it");
  }
  const unit = isUnit(p.unit) ? p.unit : undefined;
  if (unit === undefined) {
    problems.push(`unit must be ${oneOf(UNITS, p.unit)}`);
  } else {
    const [fits, what] = SUBJECTS[unit];
    if (!fits(p.subject)) problems.push(`subject of a ${unit} draft must be ${what}`);
  }
  if (unit === "person") {
    const window = p.window;
    if (!isObject(window) || !isDayString(window.from) || !isDayString(window.to)) {
      problems.push(
        "window must be { from, to }, two local days YYYY-MM-DD, both inclusive: the stretch of the person the model read",
      );
    } else if (window.from > window.to) {
      problems.push(`window runs backwards: from ${window.from} is after to ${window.to}`);
    }
  } else if (unit !== undefined && p.window !== undefined) {
    problems.push(`window is for a person draft only; the subject of a ${unit} draft bounds it`);
  }
  problems.push(...readerProblems(p));
  const proposals = proposalsOf(p);
  const unknown = proposals.findIndex((proposal) => proposalIs(proposal) === "unknown");
  if (unknown !== -1) {
    const kind = (proposals[unknown] as Fields).kind;
    problems.push(
      `proposal ${unknown + 1} is of a kind a writer may not write: kind must be ${oneOf(PROPOSAL_KINDS, kind)}`,
    );
  }
  if (p.read_policy !== undefined && !isPolicy(p.read_policy)) {
    problems.push(
      "read_policy must be { entry, max_tier, sha256 }: the policy entry read through, its ceiling then (0 to 3), and the sha256 of policy/crossing.json as read, 64 lowercase hex characters",
    );
  }
  return problems;
}

/**
 * Whether the draft's tier holds against the lines it cites (SPEC §4: derived data inherits the
 * highest tier of its evidence). The evidence of a draft is every line the model read, which no reader
 * can list, but every line a segment cites was read, so the tier is never below the highest of them.
 * `lines` are lines of the record; those no segment cites are ignored. Empty when it holds.
 */
export function draftTierProblems(line: Line, lines: Iterable<Line>): string[] {
  const cited = new Set<string>();
  const segments = fieldsOf(line).segments;
  for (const segment of Array.isArray(segments) ? segments : []) {
    if (segmentIs(segment) === "supported") {
      for (const named of (segment as Fields).evidence as string[]) cited.add(named);
    }
  }
  let highest: Line | undefined;
  for (const l of lines) {
    if (cited.has(l.id) && (highest === undefined || l.tier > highest.tier)) highest = l;
  }
  if (highest === undefined || line.tier >= highest.tier) return [];
  return [
    `tier is ${line.tier}, below the tier ${highest.tier} of ${highest.id}, a line it cites; a draft's tier is the highest among the lines it read`,
  ];
}

/** One segment as a reader shows it: supported with its evidence, or set apart, and why when it is not the writer's mark. */
export interface DraftSegment {
  text: string;
  evidence: string[];
  supported: boolean;
  /** Why a segment is shown unsupported when its writer did not mark it so; null otherwise. */
  why: string | null;
  /** The part of the dream it belongs to (`story`, `lens:<id>`, …), from `extra.parts`; null when none is read. */
  part: string | null;
  /** On an `ideas` segment, the idea it moved, from `extra.ideas`; absent when none is named. */
  entity?: string;
  /** On a sentence that can be kept (learned, decided, an idea, the photo), its number; absent otherwise. */
  keep?: number;
}

/** An event proposal as a reader shows it: its number, its place in the array from 1, its fields, and its evidence read. */
export interface DraftProposal {
  number: number;
  kind: "event";
  title: string;
  start: string;
  end: string;
  place: string | null;
  people: string[];
  evidence: string[];
  supported: boolean;
  why: string | null;
}

/** A link proposal as a reader shows it (amendment 2), numbered by its place among all the proposals. */
export interface DraftLink {
  number: number;
  /** The number it is kept by (`day sign --keep`): its own. */
  keep: number;
  kind: "link";
  entity: string;
  text: string;
  note: string | null;
  evidence: string[];
  supported: boolean;
  why: string | null;
}

/** A draft as a reader reads it: the line's fields, its segments read, and what the reference's reader says is malformed. */
export interface DraftRead {
  line: string;
  seq: number;
  source: string;
  /** The model, as `source` names it after `model:`; null when it does not. */
  model: string | null;
  tier: number;
  at: string;
  unit: JsonValue;
  subject: JsonValue;
  read_head: JsonValue;
  read_count: JsonValue;
  language: JsonValue;
  segments: DraftSegment[];
  /** How many segments are shown unsupported: marked, malformed, or resting on a line not of the unit. */
  unsupported: number;
  /** The event proposals of their shape, numbered by their place in the array. */
  proposals: DraftProposal[];
  /** The link proposals of their shape, numbered by their place in the array (amendment 2). */
  links: DraftLink[];
  /** How many proposals are of a kind this reader does not know (forward compatibility). */
  proposals_unknown: number;
  supersedes: string | null;
  /** Read before the day ended (`extra.evening: true`; amendment 2). */
  evening: boolean;
  /** `extra.read_until` as written, when it is a string; null otherwise. */
  read_until: string | null;
  /** What the writer marked unsupported, and dropped, by why, as `extra` gives them when they are objects. */
  marked: Fields;
  dropped: Fields;
  dropped_links: Fields;
  dropped_segments: Fields;
  malformed: string[];
}

/** The parts of a day's draft (dream-day/3's `day` among them), beside `lens:<id>` (docs/dream.md). */
const DAY_PARTS = [
  "story",
  "day",
  "threads",
  "learned",
  "decision",
  "ideas",
  "questions",
  "people",
  "promises",
  "photo",
];
const isPart = (v: unknown): v is string =>
  typeof v === "string" && (DAY_PARTS.includes(v) || (v.startsWith("lens:") && v.length > 5));

/**
 * Each segment's part and an idea's entity, as the reference's Day reads them from `extra` (its main at
 * 6ee01c2, run): `extra.parts` is a list, one per segment read, and is read only when it is exactly as
 * long, a part outside the day's being none; `extra.ideas` names, by a segment's number from 1, the
 * idea an `ideas` segment moved, `{segment, entity}` an integer and a string, the last entry winning.
 */
function partsOf(segments: DraftSegment[], extra: Fields): void {
  const parts = extra.parts;
  if (!Array.isArray(parts) || parts.length !== segments.length) return;
  segments.forEach((segment, i) => {
    const part = parts[i];
    segment.part = isPart(part) ? part : null;
  });
  for (const named of Array.isArray(extra.ideas) ? extra.ideas : []) {
    if (!isObject(named) || typeof named.entity !== "string") continue;
    const n = named.segment;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) continue;
    const segment = segments[n - 1];
    if (segment?.part === "ideas") segment.entity = named.entity;
  }
}

/** The parts whose sentence can be kept (`day sign --keep`): learned, decided, an idea, the photo of the day. */
const KEPT_PARTS = ["learned", "decision", "ideas", "photo"];

/**
 * What can be kept is numbered after the proposals, as the reference's Day numbers it at its main of
 * a6ee131 (run; docs/signed-day.md, *Keep and sign*): a link keeps its own number, and each sentence
 * of a keepable part, in order, the next numbers after every entry of `proposals` (the unknown and the
 * malformed among them), whether or not it is supported. `kept`, the line that kept it, is the Day's
 * reading of the record, not the line's (SPEC-QUESTIONS 119).
 */
function keepsOf(segments: DraftSegment[], proposals: number): void {
  let next = proposals;
  for (const segment of segments) {
    if (segment.part !== null && KEPT_PARTS.includes(segment.part)) {
      next += 1;
      segment.keep = next;
    }
  }
}

const textOf = (v: JsonValue | undefined): string =>
  typeof v === "string"
    ? v.trim() === ""
      ? NO_TEXT
      : v
    : v === undefined || v === null
      ? NO_TEXT
      : pyStr(v);

/**
 * A draft as a reader shows it (draft/v1 rules 3 and 6). A segment with evidence is supported when
 * every id it names is a line of the unit (`onUnit`, the ids of the unit's lines, when the reader holds
 * the record; without it the ids are not checked); one that names another is shown unsupported and
 * says why. A segment the writer marked `unsupported` is shown so. A malformed segment is treated as
 * unsupported and the line is said to be malformed; one that is not an object is not shown at all. All
 * as the reference's Day reads a day's draft (openlogbook 0.6.1, run). The event and link proposals of
 * their shape are shown, numbered by their place in the array, their evidence read as a segment's;
 * those of a kind this reader does not know are counted and nothing more (draft/v1, forward
 * compatibility of 2026-10-19, and amendment 2). Each segment's part and an idea's entity are read
 * from `extra` (`partsOf`), and the evening and the writer's counts beside them, as the reference's Day
 * reads them at its main of 6ee01c2 (run).
 */
export function readDraft(line: Line, onUnit?: ReadonlySet<string>): DraftRead {
  const p = fieldsOf(line);
  const unit = p.unit;
  const elsewhere =
    unit === "person"
      ? "evidence names a line that is not one of the person's lines in the window"
      : `evidence names a line that is not on the ${pyStr(unit)}`;
  const read = (evidence: string[]): { supported: boolean; why: string | null } => {
    const off = onUnit !== undefined && evidence.some((named) => !onUnit.has(named));
    return { supported: !off, why: off ? elsewhere : null };
  };
  const extra = isObject(p.extra) ? p.extra : {};
  const segments: DraftSegment[] = [];
  for (const segment of Array.isArray(p.segments) ? p.segments : []) {
    if (!isObject(segment)) continue;
    const text = textOf(segment.text);
    const shape = segmentIs(segment);
    if (shape === "malformed") {
      segments.push({ text, evidence: [], supported: false, why: SHAPE, part: null });
    } else if (shape === "unsupported") {
      segments.push({ text, evidence: [], supported: false, why: null, part: null });
    } else {
      const evidence = [...(segment.evidence as string[])];
      segments.push({ text, evidence, ...read(evidence), part: null });
    }
  }
  partsOf(segments, extra);
  keepsOf(segments, Array.isArray(p.proposals) ? p.proposals.length : 0);
  const proposals: DraftProposal[] = [];
  const links: DraftLink[] = [];
  let unknown = 0;
  proposalsOf(p).forEach((proposal, i) => {
    const shape = proposalIs(proposal);
    if (shape === "unknown") unknown += 1;
    const e = proposal as Fields;
    if (shape === "event") {
      const evidence = [...(e.evidence as string[])];
      proposals.push({
        number: i + 1,
        kind: "event",
        title: e.title as string,
        start: e.start as string,
        end: e.end as string,
        place: (e.place ?? null) as string | null,
        people: [...(e.people as string[])],
        evidence,
        ...read(evidence),
      });
    } else if (shape === "link") {
      const evidence = [...(e.evidence as string[])];
      links.push({
        number: i + 1,
        keep: i + 1,
        kind: "link",
        entity: e.entity as string,
        text: e.text as string,
        note: (e.note ?? null) as string | null,
        evidence,
        ...read(evidence),
      });
    }
  });
  // A copy, as every list here is: what a reader hands back never reaches into the line.
  const counts = (v: JsonValue | undefined): Fields => (isObject(v) ? structuredClone(v) : {});
  const source = String(line.source);
  return {
    line: String(line.id),
    seq: line.seq,
    source,
    model: source.startsWith("model:") ? source.slice("model:".length) : null,
    tier: line.tier,
    at: String(line.at),
    unit: unit ?? null,
    subject: p.subject ?? null,
    read_head: p.read_head ?? null,
    read_count: p.read_count ?? null,
    language: p.language ?? null,
    segments,
    unsupported: segments.filter((s) => !s.supported).length,
    proposals,
    links,
    proposals_unknown: unknown,
    supersedes: isText(p.supersedes) ? p.supersedes : null,
    evening: extra.evening === true,
    read_until: typeof extra.read_until === "string" ? extra.read_until : null,
    marked: counts(extra.marked),
    dropped: counts(extra.dropped),
    dropped_links: counts(extra.dropped_links),
    dropped_segments: counts(extra.dropped_segments),
    malformed: readerProblems(p),
  };
}

const canonicalSubject = (v: JsonValue | undefined): JsonValue => v ?? null;

/**
 * The unit a draft is of, as a key: `unit` and `subject`, as written. A person's is its subject alone,
 * whatever its window (amendment 1: the standing person draft is the latest of the subject).
 */
export const unitKey = (unit: JsonValue | undefined, subject: JsonValue | undefined): string =>
  JSON.stringify([unit ?? null, canonicalSubject(subject)]);

/**
 * The dedupe key of a draft (draft/v1 rule 1): `(source, unit, subject, read_head)`, and for a person
 * `(source, unit, subject, window, read_head)`. Undefined for a line that is not a draft.
 */
export function draftKey(line: Line): string | undefined {
  if (!isDraft(line)) return undefined;
  const p = fieldsOf(line);
  const window = isObject(p.window) ? [p.window.from ?? null, p.window.to ?? null] : null;
  const key: JsonValue[] = [String(line.source), p.unit ?? null, canonicalSubject(p.subject)];
  if (p.unit === "person") key.push(window);
  key.push(p.read_head ?? null);
  return JSON.stringify(key);
}

/**
 * The standing draft of each unit (draft/v1 rule 2), by `unitKey`: of the drafts not retracted and not
 * named in a later draft's `supersedes`, the latest by `seq`.
 */
export function standingDrafts(lines: Iterable<Line>, retracted: Retracted): Map<string, Line> {
  const out = new Map<string, Line>();
  for (const draft of standingLines(lines, retracted, isDraft)) {
    const p = fieldsOf(draft);
    out.set(unitKey(p.unit, p.subject), draft);
  }
  return out;
}

/** Python's truth of a JSON value: false for null, false, 0, an empty string, list or object. */
const truthy = (v: JsonValue | undefined): boolean =>
  v !== undefined &&
  v !== null &&
  v !== false &&
  v !== 0 &&
  v !== "" &&
  !(Array.isArray(v) && v.length === 0) &&
  !(isObject(v) && Object.keys(v).length === 0);

/**
 * The row `show` prints for a draft line, as the reference prints it (openlogbook 0.6.1, run): `draft
 * of day 2026-06-13 · 5 lines read at bb97e90d · 4 segments, 1 unsupported`, then the proposals it
 * holds, ` · 1 proposed event · 2 proposed links` (every entry of a `proposals` list that is not a
 * link counts as an event, its kind and shape unread; the reference at 6ee01c2, run), then ` ·
 * supersedes an earlier draft` when it names one. A segment counts as unsupported when it is marked
 * so or malformed; `show` holds no unit to check evidence against.
 */
export function draftRow(p: Payload): string {
  const subject = Array.isArray(p.subject) ? p.subject.map(pyStr).join(", ") : pyStr(p.subject);
  const count = p.read_count;
  const one = count === 1 || count === true;
  const head = truthy(p.read_head) ? pyStr(p.read_head).slice(0, 8) : "";
  const segments = Array.isArray(p.segments) ? p.segments : [];
  const unsupported = segments.filter((s) => segmentIs(s) !== "supported").length;
  let row = `draft of ${pyStr(p.unit)} ${subject} · ${pyStr(count)} line${one ? "" : "s"} read at ${head}`;
  row += ` · ${segments.length} segment${segments.length === 1 ? "" : "s"}`;
  if (unsupported > 0) row += `, ${unsupported} unsupported`;
  const proposals = Array.isArray(p.proposals) ? p.proposals : [];
  const links = proposals.filter((x) => isObject(x) && x.kind === "link").length;
  const events = proposals.length - links;
  if (events > 0) row += ` · ${events} proposed event${events === 1 ? "" : "s"}`;
  if (links > 0) row += ` · ${links} proposed link${links === 1 ? "" : "s"}`;
  if (truthy(p.supersedes)) row += " · supersedes an earlier draft";
  return row;
}
