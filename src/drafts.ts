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
 * A proposal is an object whose `kind` says what it proposes: `event`, and since amendment 2 of
 * 2026-10-21 `link`, a line of the unit that belongs to a canonical entity. Its forward compatibility
 * (the amendment of 2026-10-19): a reader shows the proposals of the kinds it knows, counts the others
 * as `proposals_unknown`, and does not call the line malformed for them; a known kind of the wrong
 * shape, or a proposal with no kind, is still malformed. Writers stay strict: `draftProblems`, the
 * whole field table, refuses a kind it does not know. Amendment 2 also adds `extra.evening`, `true` on
 * a draft of the day so far, with `extra.read_until`, the moment it read up to.
 *
 * The reference reads a day's draft on the Day and prints its row in `show`, and checks five fields as
 * it reads (openlogbook 0.6.1, run on synthetic drafts): `read_head`, `read_count`, `language`,
 * `segments` and `supersedes`. Those sentences are its own, word for word, in its order, and like it
 * the check names the first malformed segment only. The proposals and the rest of the field table
 * (unit, subject, source, window, read_policy) have no reference sentence and are checked here in its
 * style (SPEC-QUESTIONS 89); the proposals' and `extra`'s sentences are the reference's, from its
 * output at d053f78 (SPEC-QUESTIONS 117a, 119). `readDraft` is the reader's view, the reference's `malformed` list and its
 * reading of each segment; `draftRow` is the row `show` prints under the `rfc0036` flag. Nothing here
 * writes a draft, and the Day does not show one yet.
 */

import { pyStrip } from "./entities.js";
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

/** The kinds of proposal this implementation knows (draft/v1, the amendments of 2026-10-13 and of 2026-10-21). */
export const PROPOSAL_KINDS = ["event", "link"] as const;
type ProposalKind = (typeof PROPOSAL_KINDS)[number];
/** An event proposal's keys, exactly these. */
const EVENT_KEYS = ["kind", "title", "start", "end", "place", "people", "evidence"];
/** A link proposal's keys (amendment 2): these, and `note` when given. */
const LINK_KEYS = ["kind", "entity", "text", "evidence"];
/** The reference's sentence for a proposal that is not a link of its shape: an event's, or none at all. */
const EVENT_SHAPE =
  "a proposal is {kind: event, title, start, end, place, people, evidence}: start before end, both UTC with a Z, people and evidence lists of ids, evidence not empty";
const LINK_SHAPE =
  "a link is {kind: link, entity, text, evidence, note?}: entity an entity id, text what it says, evidence a non-empty list of line ids, note a string when given";
/** RFC 3339 in UTC with `Z`, on a real calendar day. */
const UTC = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?Z$/;
const isUtc = (v: unknown): v is string => {
  const m = typeof v === "string" ? UTC.exec(v) : null;
  return m !== null && isDayString(m[1]);
};

/** A text with a word in it: not only the whitespace Python's `str.strip()` cuts. */
const hasText = (v: unknown): v is string => typeof v === "string" && pyStrip(v) !== "";

/**
 * A link of amendment 2's shape, as the reference reads one: `entity` and `text` with a word in them,
 * `evidence` a non-empty list of ids none of them empty, `note` a text when given, nothing else.
 */
function linkShaped(p: Fields): boolean {
  const keys = Object.keys(p);
  return (
    LINK_KEYS.every((key) => key in p) &&
    keys.every((key) => LINK_KEYS.includes(key) || key === "note") &&
    hasText(p.entity) &&
    hasText(p.text) &&
    Array.isArray(p.evidence) &&
    p.evidence.length > 0 &&
    p.evidence.every((named) => typeof named === "string" && named !== "") &&
    (!("note" in p) || hasText(p.note))
  );
}

/**
 * A proposal as a reader takes it (forward compatibility, rules 3 and 4): an event of the table's
 * shape or a link of amendment 2's; a kind it does not know, `kind` a non-empty string other than
 * those; or malformed, a known kind of another shape, or not an object naming its kind at all.
 */
function proposalIs(proposal: unknown): ProposalKind | "unknown" | "malformed" {
  if (!isObject(proposal) || typeof proposal.kind !== "string" || proposal.kind === "") {
    return "malformed";
  }
  if (!PROPOSAL_KINDS.includes(proposal.kind as ProposalKind)) return "unknown";
  const p = proposal;
  if (p.kind === "link") return linkShaped(p) ? "link" : "malformed";
  const shaped =
    Object.keys(p).length === EVENT_KEYS.length &&
    EVENT_KEYS.every((key) => key in p) &&
    isText(p.title) &&
    isUtc(p.start) &&
    isUtc(p.end) &&
    Date.parse(p.start) < Date.parse(p.end) &&
    (p.place === null || isText(p.place)) &&
    Array.isArray(p.people) &&
    p.people.every(isText) &&
    isIdList(p.evidence);
  return shaped ? "event" : "malformed";
}

const proposalsOf = (p: Fields): JsonValue[] => (Array.isArray(p.proposals) ? p.proposals : []);

const isCount = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * `extra.read_until`'s form as the reference holds it: a pattern, the calendar not checked, its digits
 * any decimal digit, as Python's `\d` takes them (`٢٠٢٦` passes); nothing after the `Z`.
 */
const READ_UNTIL = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}T\p{Nd}{2}:\p{Nd}{2}:\p{Nd}{2}(\.\p{Nd}+)?Z$/u;

/**
 * What the reference's reader says is wrong with a draft, in its words and its order: `read_head`,
 * `read_count`, `language`, `segments` (the first malformed segment only), `supersedes`, `proposals`
 * (the first malformed proposal only), then `extra` (amendment 2's `evening` and `read_until`). A
 * proposal of a kind the reader does not know is not malformed.
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
  // Amendment 2: `extra.evening` is `true` when present, and then `extra.read_until` is UTC with a Z.
  if ("extra" in p) {
    const extra = p.extra;
    if (!isObject(extra)) {
      problems.push("extra must be an object");
    } else if ("evening" in extra && extra.evening !== true) {
      problems.push("extra.evening is true when present");
    } else if (
      extra.evening === true &&
      (typeof extra.read_until !== "string" || !READ_UNTIL.test(extra.read_until))
    ) {
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
 * rule broken; empty when it is one. The envelope first, then `unit`, `subject` and `window`, then the
 * five fields the reference's reader checks, in its words, and `proposals` and `extra`, then a proposal of a kind
 * a writer may not write (the first only: writers stay strict), then `read_policy`. The tier is the lines'
 * the model read, so it is not checked here but against them (`draftTierProblems`).
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
}

/**
 * An event proposal as a reader shows it: its number, its place in the array from 1, its fields, and
 * whether its evidence is on the unit, as a segment's is.
 */
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

/**
 * A link proposal (amendment 2) as a reader shows it: its number among all the proposals, the entity,
 * what belongs to it (stripped), the note or null, and whether its evidence is on the unit.
 */
export interface DraftLink {
  number: number;
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
  /** The proposals of a kind this reader knows and of their shape, numbered by their place in the array. */
  proposals: DraftProposal[];
  /** How many proposals are of a kind this reader does not know (forward compatibility). */
  proposals_unknown: number;
  /** The link proposals of their shape (amendment 2), numbered by their place among all the proposals. */
  links: DraftLink[];
  /** A draft of the day so far: `extra.evening` is `true` (amendment 2). */
  evening: boolean;
  /** `extra.read_until` as written when it is a string, the moment an evening's draft read up to; else null. */
  read_until: string | null;
  supersedes: string | null;
  malformed: string[];
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
 * their shape are shown, numbered by their place in the array, each supported or not as a segment is;
 * those of a kind this reader does not know are counted and nothing more (draft/v1, forward
 * compatibility of 2026-10-19; amendment 2 of 2026-10-21, as the reference reads it at d053f78, run).
 */
export function readDraft(line: Line, onUnit?: ReadonlySet<string>): DraftRead {
  const p = fieldsOf(line);
  const unit = p.unit;
  const elsewhere =
    unit === "person"
      ? "evidence names a line that is not one of the person's lines in the window"
      : `evidence names a line that is not on the ${pyStr(unit)}`;
  /** Whether evidence rests on the unit's lines, and why not; not checked without them. */
  const onIt = (evidence: string[]): { supported: boolean; why: string | null } => {
    const off = onUnit !== undefined && evidence.some((named) => !onUnit.has(named));
    return { supported: !off, why: off ? elsewhere : null };
  };
  const segments: DraftSegment[] = [];
  for (const segment of Array.isArray(p.segments) ? p.segments : []) {
    if (!isObject(segment)) continue;
    const text = textOf(segment.text);
    const shape = segmentIs(segment);
    if (shape === "malformed") {
      segments.push({ text, evidence: [], supported: false, why: SHAPE });
    } else if (shape === "unsupported") {
      segments.push({ text, evidence: [], supported: false, why: null });
    } else {
      const evidence = [...(segment.evidence as string[])];
      segments.push({ text, evidence, ...onIt(evidence) });
    }
  }
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
        place: e.place as string | null,
        people: [...(e.people as string[])],
        evidence,
        ...onIt(evidence),
      });
    } else if (shape === "link") {
      const evidence = [...(e.evidence as string[])];
      links.push({
        number: i + 1,
        kind: "link",
        entity: e.entity as string,
        text: pyStrip(e.text as string),
        note: typeof e.note === "string" ? e.note : null,
        evidence,
        ...onIt(evidence),
      });
    }
  });
  const extra = isObject(p.extra) ? p.extra : {};
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
    proposals_unknown: unknown,
    links,
    evening: extra.evening === true,
    read_until: typeof extra.read_until === "string" ? extra.read_until : null,
    supersedes: isText(p.supersedes) ? p.supersedes : null,
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
 * of day 2026-06-13 · 5 lines read at bb97e90d · 4 segments, 1 unsupported`, then the proposals counted
 * (` · 1 proposed event · 2 proposed links`: a proposal whose `kind` is `link` is a link, any other an
 * event, whatever its shape, as the reference counts them at d053f78), then ` · supersedes an earlier
 * draft` when it names one. A segment counts as unsupported when it is marked so or malformed; `show`
 * holds no unit to check evidence against.
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
  const linked = proposals.filter((q) => isObject(q) && q.kind === "link").length;
  const events = proposals.length - linked;
  if (events > 0) row += ` · ${events} proposed event${events === 1 ? "" : "s"}`;
  if (linked > 0) row += ` · ${linked} proposed link${linked === 1 ? "" : "s"}`;
  if (truthy(p.supersedes)) row += " · supersedes an earlier draft";
  return row;
}
