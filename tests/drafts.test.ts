import { describe, expect, it } from "vitest";
import {
  DRAFT_KIND,
  DRAFT_SCHEMA,
  draftKey,
  draftProblems,
  draftRow,
  draftTierProblems,
  isDraft,
  readDraft,
  standingDrafts,
  UNITS,
  unitKey,
} from "../src/drafts.js";
import { duplicates } from "../src/lineRules.js";
import type { JsonValue } from "../src/types.js";
import {
  DAY_LINES,
  DRAFT,
  edit,
  id,
  line,
  PERSON_DRAFT,
  retractedSet,
} from "./rfc0036-examples.js";

const none = retractedSet();
const SHAPE = "a segment is {text, evidence} or {text, unsupported: true}, nothing else";
const malformedSegment = (n: number): string => `segment ${n} is malformed: ${SHAPE}`;
const withSegments = (...segments: JsonValue[]) => edit(DRAFT, { segments });
const ON_DAY = new Set(DAY_LINES.map((l) => l.id));

describe("draft/v1 (RFC 0036): what a model wrote about a unit of the record", () => {
  it("names the kind, the schema and the units, amendment 1's person among them", () => {
    expect([DRAFT_KIND, DRAFT_SCHEMA]).toEqual(["draft", "draft/v1"]);
    expect(UNITS).toEqual([
      "day",
      "journey",
      "event",
      "week",
      "month",
      "year",
      "chapter",
      "person",
    ]);
  });

  it("the RFC's example of 13 June, and amendment 1's person draft, have nothing against them", () => {
    expect(isDraft(DRAFT)).toBe(true);
    expect(draftProblems(DRAFT)).toEqual([]);
    expect(draftProblems(PERSON_DRAFT)).toEqual([]);
  });

  it("is a model's: source model:<name>, never manual and never an adapter; end null", () => {
    for (const source of ["manual", "dream", "model:", "qwen2.5-7b-instruct"]) {
      expect(draftProblems(edit(DRAFT, {}, { source }))).toEqual([
        "source must be model:<name>, the model as its runner names it",
      ]);
    }
    expect(draftProblems(edit(DRAFT, {}, { end: "2026-06-14T06:11:00Z" }))).toEqual([
      "end must be null",
    ]);
    expect(draftProblems(edit(DRAFT, {}, { kind: "note" }))).toEqual(["kind must be draft"]);
  });

  it("has no tier of its own: the highest among the lines it read, any of 1 to 3", () => {
    for (const tier of [1, 2, 3]) expect(draftProblems(edit(DRAFT, {}, { tier }))).toEqual([]);
  });

  it("holds unit to the eight, and subject to the unit's form", () => {
    expect(draftProblems(edit(DRAFT, { unit: "fortnight" }))).toEqual([
      "unit must be one of day, journey, event, week, month, year, chapter, person, not 'fortnight'",
    ]);
    const subject = (unit: string, value: JsonValue | undefined) =>
      draftProblems(edit(DRAFT, { unit, subject: value }));
    expect(subject("day", "13 June")).toEqual([
      "subject of a day draft must be the local day, YYYY-MM-DD",
    ]);
    expect(subject("day", ["2026-06-13"])).toEqual([
      "subject of a day draft must be the local day, YYYY-MM-DD",
    ]);
    expect(subject("week", "2026-W24")).toEqual([]);
    expect(subject("week", "2026-W00")).toEqual([
      "subject of a week draft must be the ISO week, YYYY-Www",
    ]);
    // 2025 began on a Wednesday and has 52 ISO weeks; 2026 began on a Thursday, and 2020 on a
    // Wednesday in a leap year: each has 53.
    expect(subject("week", "2025-W53")).toEqual([
      "subject of a week draft must be the ISO week, YYYY-Www",
    ]);
    expect(subject("week", "2026-W53")).toEqual([]);
    expect(subject("week", "2020-W53")).toEqual([]);
    expect(subject("month", "2026-06")).toEqual([]);
    expect(subject("month", "2026-13")).toEqual([
      "subject of a month draft must be the month, YYYY-MM",
    ]);
    expect(subject("year", "2026")).toEqual([]);
    expect(subject("year", 2026)).toEqual(["subject of a year draft must be the year, YYYY"]);
    for (const unit of ["journey", "event", "chapter"]) {
      expect(subject(unit, [id("a1")])).toEqual([]);
      expect(subject(unit, [id("a1"), id("a2")])).toEqual([]);
      for (const bad of [id("a1"), [], [id("a1"), 5], [""]] as JsonValue[]) {
        expect(subject(unit, bad)).toEqual([
          `subject of a ${unit} draft must be the ids of the lines the unit is, as an array`,
        ]);
      }
    }
  });

  it("amendment 1: a person draft names one person and the window it read; no other unit has one", () => {
    expect(draftProblems(edit(PERSON_DRAFT, { subject: [id(501)] }))).toEqual([
      "subject of a person draft must be one canonical person id, as a string",
    ]);
    expect(draftProblems(edit(PERSON_DRAFT, { window: undefined }))).toEqual([
      "window must be { from, to }, two local days YYYY-MM-DD, both inclusive: the stretch of the person the model read",
    ]);
    expect(draftProblems(edit(PERSON_DRAFT, { window: { from: "2026-07-14" } }))).toEqual([
      "window must be { from, to }, two local days YYYY-MM-DD, both inclusive: the stretch of the person the model read",
    ]);
    expect(
      draftProblems(edit(PERSON_DRAFT, { window: { from: "2026-10-11", to: "2026-07-14" } })),
    ).toEqual(["window runs backwards: from 2026-10-11 is after to 2026-07-14"]);
    expect(
      draftProblems(edit(DRAFT, { window: { from: "2026-06-01", to: "2026-06-13" } })),
    ).toEqual(["window is for a person draft only; the subject of a day draft bounds it"]);
  });

  it("amendment 1: read_policy, when present, is { entry, max_tier, sha256 }", () => {
    expect(draftProblems(edit(DRAFT, { read_policy: undefined }))).toEqual([]);
    for (const bad of [
      "dream",
      { entry: "dream", max_tier: 2 },
      { entry: "", max_tier: 2, sha256: "e".repeat(64) },
      { entry: "dream", max_tier: 4, sha256: "e".repeat(64) },
      { entry: "dream", max_tier: true, sha256: "e".repeat(64) },
      { entry: "dream", max_tier: 2, sha256: "E".repeat(64) },
    ] as JsonValue[]) {
      expect(draftProblems(edit(PERSON_DRAFT, { read_policy: bad }))).toEqual([
        "read_policy must be { entry, max_tier, sha256 }: the policy entry read through, its ceiling then (0 to 3), and the sha256 of policy/crossing.json as read, 64 lowercase hex characters",
      ]);
    }
  });
});

describe("draft/v1: the fields the reference's reader checks, in its words (openlogbook 0.6.1, run)", () => {
  it("read_head is the record's head, 64 lowercase hex characters", () => {
    for (const bad of [undefined, null, 5, "abc", "BB97E90D".repeat(8)] as Array<
      JsonValue | undefined
    >) {
      expect(draftProblems(edit(DRAFT, { read_head: bad }))).toEqual([
        "read_head must be the record's head, 64 lowercase hex characters",
      ]);
    }
  });

  it("read_count is how many lines were read: an integer, 0 or more, never a string or a boolean", () => {
    expect(draftProblems(edit(DRAFT, { read_count: 0 }))).toEqual([]);
    for (const bad of [undefined, null, -1, 1.5, "5", true] as Array<JsonValue | undefined>) {
      expect(draftProblems(edit(DRAFT, { read_count: bad }))).toEqual([
        "read_count must be how many lines of the unit the model read",
      ]);
    }
  });

  it("language is a BCP 47 tag: two or three letters, then subtags of two to eight", () => {
    for (const ok of [
      "en",
      "nb",
      "EN",
      "en-GB",
      "nb-NO",
      "zh-Hant-TW",
      "de-CH-1996",
      "en-GB-oxendict",
    ]) {
      expect(draftProblems(edit(DRAFT, { language: ok }))).toEqual([]);
    }
    for (const bad of [
      undefined,
      "",
      5,
      "english",
      "x",
      "e",
      "abcd",
      "en_GB",
      "en-",
      "en--GB",
      "en-a",
      "en-abcdefghi",
      " en",
      "1en",
      "x-private",
      "i-klingon",
    ] as Array<JsonValue | undefined>) {
      expect(draftProblems(edit(DRAFT, { language: bad }))).toEqual([
        "language must be a BCP 47 tag, en or nb",
      ]);
    }
  });

  it("segments is a non-empty list", () => {
    for (const bad of [undefined, [], "text", { text: "x" }] as Array<JsonValue | undefined>) {
      expect(draftProblems(edit(DRAFT, { segments: bad }))).toEqual([
        "segments must be a non-empty list",
      ]);
    }
  });

  it("the segment rule: {text, evidence} or {text, unsupported: true}, and no third shape", () => {
    const ok: JsonValue[] = [
      { text: "x", evidence: [id("a1")] },
      { text: "x", evidence: [id("a1"), id("a1")] },
      { text: "x", unsupported: true },
      { text: "x", evidence: [id("a1")], extra: 1 },
      { text: "line one\nline two", evidence: [id("a1")] },
    ];
    for (const segment of ok) expect(draftProblems(withSegments(segment))).toEqual([]);
    const bad: JsonValue[] = [
      { text: "x", evidence: [id("a1")], unsupported: true },
      { text: "x" },
      { text: "x", evidence: [] },
      { text: "x", unsupported: false },
      { text: "x", unsupported: "yes" },
      { text: "x", unsupported: true, evidence: null },
      { text: "x", evidence: [id("a1")], unsupported: false },
      { text: "x", evidence: [id("a1")], unsupported: null },
      { text: "x", evidence: id("a1") },
      { text: "x", evidence: [5] },
      { text: "x", evidence: [""] },
      { text: "", evidence: [id("a1")] },
      { text: "   ", evidence: [id("a1")] },
      { text: 5, evidence: [id("a1")] },
      { evidence: [id("a1")] },
      "text",
    ];
    for (const segment of bad) {
      expect(draftProblems(withSegments({ text: "y", unsupported: true }, segment))).toEqual([
        malformedSegment(2),
      ]);
    }
  });

  it("names the first malformed segment only, as the reference does", () => {
    const line = withSegments(
      { text: "a", evidence: [id("a1")] },
      { text: "b", evidence: [] },
      { text: "c", unsupported: false },
    );
    expect(draftProblems(line)).toEqual([malformedSegment(2)]);
  });

  it("supersedes, when the key is there, names the earlier draft: an empty or null one does not", () => {
    expect(draftProblems(edit(DRAFT, { supersedes: id("d0") }))).toEqual([]);
    for (const bad of [5, "", null] as JsonValue[]) {
      expect(draftProblems(edit(DRAFT, { supersedes: bad }))).toEqual([
        "supersedes must be the id of the earlier draft",
      ]);
    }
  });

  it("names every problem in the reference's order", () => {
    const bad = edit(DRAFT, {
      read_count: "x",
      read_head: 5,
      language: 5,
      segments: [],
      supersedes: 5,
    });
    expect(draftProblems(bad)).toEqual([
      "read_head must be the record's head, 64 lowercase hex characters",
      "read_count must be how many lines of the unit the model read",
      "language must be a BCP 47 tag, en or nb",
      "segments must be a non-empty list",
      "supersedes must be the id of the earlier draft",
    ]);
  });
});

describe("a draft read on its unit (draft/v1 rules 3 and 6; the reference's Day, run)", () => {
  it("the example of 13 June: three supported segments with their evidence, one set apart", () => {
    const read = readDraft(DRAFT, ON_DAY);
    expect(read).toEqual({
      line: id("d1"),
      seq: DRAFT.seq,
      source: "model:qwen2.5-7b-instruct",
      model: "qwen2.5-7b-instruct",
      tier: 2,
      at: "2026-06-14T06:10:00Z",
      unit: "day",
      subject: "2026-06-13",
      read_head: "bb97e90d3f946f6cc637e5e223b080ada65e2beb12b07293727e28d2a279b3d8",
      read_count: 5,
      language: "en",
      segments: [
        {
          text: "A morning at home, then the afternoon at the boat in Vollen.",
          evidence: [id("a1"), id("a2")],
          supported: true,
          why: null,
        },
        {
          text: "One photo from the pontoon, the new mooring lines on.",
          evidence: [id("a3")],
          supported: true,
          why: null,
        },
        {
          text: "You wrote that the engine sounded right for the first time since May.",
          evidence: [id("a4")],
          supported: true,
          why: null,
        },
        { text: "Ola came by in the evening.", evidence: [], supported: false, why: null },
      ],
      unsupported: 1,
      proposals: [],
      proposals_unknown: 0,
      links: [],
      evening: false,
      read_until: null,
      supersedes: null,
      malformed: [],
    });
  });

  it("a segment whose evidence names a line not on the day is unsupported, and says why", () => {
    for (const other of [id(301), id("d1"), id("9ff")]) {
      const read = readDraft(withSegments({ text: "x", evidence: [id("a1"), other] }), ON_DAY);
      expect(read.segments).toEqual([
        {
          text: "x",
          evidence: [id("a1"), other],
          supported: false,
          why: "evidence names a line that is not on the day",
        },
      ]);
      expect(read.unsupported).toBe(1);
      expect(read.malformed).toEqual([]);
    }
  });

  it("amendment 1: on a person, the why names the person's lines in the window", () => {
    const read = readDraft(PERSON_DRAFT, new Set([id("5a1"), id("5a2"), id("5a3")]));
    expect(read.segments[1]?.why).toBe(
      "evidence names a line that is not one of the person's lines in the window",
    );
    expect(read.unsupported).toBe(2);
  });

  it("without the unit's lines, the evidence is not checked", () => {
    expect(readDraft(withSegments({ text: "x", evidence: [id(301)] })).unsupported).toBe(0);
  });

  it("a malformed segment is treated as unsupported and the line is said to be malformed", () => {
    const read = readDraft(
      withSegments(
        { text: "a", evidence: [id("a1")] },
        { text: "", evidence: [id("a3")] },
        { text: 5, evidence: [id("a3")] },
        "not a segment",
        { text: "c", unsupported: true },
      ),
      ON_DAY,
    );
    expect(read.segments).toEqual([
      { text: "a", evidence: [id("a1")], supported: true, why: null },
      { text: "(no text)", evidence: [], supported: false, why: SHAPE },
      { text: "5", evidence: [], supported: false, why: SHAPE },
      { text: "c", evidence: [], supported: false, why: null },
    ]);
    expect(read.unsupported).toBe(3);
    expect(read.malformed).toEqual([malformedSegment(2)]);
  });

  it("the malformed list is the reference reader's: what it checks, nothing else", () => {
    const read = readDraft(
      edit(DRAFT, { unit: "fortnight", language: "english" }, { source: "manual" }),
    );
    expect(read.malformed).toEqual(["language must be a BCP 47 tag, en or nb"]);
  });
});

/** An event proposal of the example's day, every key the RFC's table names, each of its type. */
const EVENT = {
  kind: "event",
  title: "At the boat in Vollen",
  start: "2026-06-13T12:00:00Z",
  end: "2026-06-13T16:00:00Z",
  place: null,
  people: [],
  evidence: [id("a2"), id("a3")],
};
/** An event as a reader shows it, numbered, its evidence on the day. */
const shown = (number: number, event: Record<string, JsonValue> = EVENT) => ({
  number,
  ...event,
  supported: true,
  why: null,
});
/**
 * A kind no amendment names yet: what a newer writer might write. (`link` was this stand-in until
 * draft/v1's amendment 2 of 2026-10-21 named it.)
 */
const LINK = { kind: "merge", from: id("a3"), to: id("a4") };
const withProposals = (...proposals: JsonValue[]) => edit(DRAFT, { proposals });
/** The reference's sentence for a proposal that is not an event of the table's shape and not a link (its output at d053f78). */
const EVENT_SHAPE =
  "a proposal is {kind: event, title, start, end, place, people, evidence}: start before end, both UTC with a Z, people and evidence lists of ids, evidence not empty";
const NO_KIND = EVENT_SHAPE;
const malformedProposal = (n: number, why: string): string => `proposal ${n} is malformed: ${why}`;

describe("a draft's proposals (draft/v1, amendment of 2026-10-13, and forward compatibility of 2026-10-19)", () => {
  it("a draft that proposes nothing has no proposals and none unknown", () => {
    const read = readDraft(DRAFT, ON_DAY);
    expect([read.proposals, read.proposals_unknown, read.malformed]).toEqual([[], 0, []]);
  });

  it("an unknown kind beside a valid event: the event is shown, one is counted, the line is not malformed", () => {
    const read = readDraft(withProposals(EVENT, LINK), ON_DAY);
    expect(read.proposals).toEqual([shown(1)]);
    expect(read.proposals_unknown).toBe(1);
    expect(read.malformed).toEqual([]);
  });

  it("numbers do not move: a proposal keeps its place in the array, the unknown ones counted in it", () => {
    const read = readDraft(withProposals(LINK, { ...LINK, kind: "goal" }, EVENT), ON_DAY);
    expect(read.proposals).toEqual([shown(3)]);
    expect(read.proposals_unknown).toBe(2);
    expect(read.malformed).toEqual([]);
  });

  it("a malformed event is still malformed: the valid ones are shown and the line is said to be malformed", () => {
    const bad = { ...EVENT, title: "" };
    const read = readDraft(withProposals(EVENT, bad, LINK), ON_DAY);
    expect(read.proposals).toEqual([shown(1)]);
    expect(read.proposals_unknown).toBe(1);
    expect(read.malformed).toEqual([malformedProposal(2, EVENT_SHAPE)]);
  });

  it("every way an event can be of the wrong shape, each malformed, the first one named", () => {
    const { place: _place, ...noPlace } = EVENT;
    const shapes: JsonValue[] = [
      { ...EVENT, title: 5 },
      { ...EVENT, title: "  " },
      { ...EVENT, start: "2026-06-13 12:00:00" },
      { ...EVENT, start: "2026-06-13T12:00:00+02:00" },
      { ...EVENT, start: "2026-02-30T12:00:00Z" },
      { ...EVENT, end: null },
      { ...EVENT, start: "2026-06-13T16:00:00Z" },
      { ...EVENT, start: "2026-06-13T17:00:00Z" },
      { ...EVENT, place: 5 },
      { ...EVENT, place: "" },
      { ...EVENT, people: "Ola" },
      { ...EVENT, people: [5] },
      { ...EVENT, evidence: [] },
      { ...EVENT, evidence: "x" },
      { ...EVENT, colour: "blue" },
      noPlace,
    ];
    for (const shape of shapes) {
      const read = readDraft(withProposals(shape, { ...EVENT, title: "" }), ON_DAY);
      expect({ shape, proposals: read.proposals, malformed: read.malformed }).toEqual({
        shape,
        proposals: [],
        malformed: [malformedProposal(1, EVENT_SHAPE)],
      });
      expect(read.proposals_unknown).toBe(0);
    }
  });

  it("an event with a place and people is shown with them", () => {
    const named = { ...EVENT, place: "Vollen", people: [id(501)] };
    expect(readDraft(withProposals(named)).proposals).toEqual([shown(1, named)]);
  });

  it("a proposal that is not an object, or names no kind, is malformed, not unknown", () => {
    for (const bad of [
      "event",
      5,
      null,
      [EVENT],
      {},
      { ...LINK, kind: "" },
      { ...LINK, kind: 5 },
    ]) {
      const read = readDraft(withProposals(LINK, bad as JsonValue), ON_DAY);
      expect({ bad, malformed: read.malformed }).toEqual({
        bad,
        malformed: [malformedProposal(2, NO_KIND)],
      });
      expect(read.proposals_unknown).toBe(1);
    }
  });

  it("proposals that are not a list are malformed; absent, there are none", () => {
    for (const bad of ["event", 5, {}, null]) {
      const read = readDraft(edit(DRAFT, { proposals: bad as JsonValue }), ON_DAY);
      expect(read.malformed).toEqual(["proposals must be a list"]);
      expect([read.proposals, read.proposals_unknown]).toEqual([[], 0]);
    }
    expect(readDraft(withProposals(), ON_DAY).malformed).toEqual([]);
  });

  it("the writer stays strict: draftProblems refuses a kind it does not know, as a writer does", () => {
    expect(draftProblems(withProposals(EVENT))).toEqual([]);
    expect(draftProblems(withProposals(EVENT, LINK))).toEqual([
      "proposal 2 is of a kind a writer may not write: kind must be one of event, link, not 'merge'",
    ]);
    expect(draftProblems(withProposals({ ...EVENT, title: "" }, LINK, { kind: "goal" }))).toEqual([
      malformedProposal(1, EVENT_SHAPE),
      "proposal 2 is of a kind a writer may not write: kind must be one of event, link, not 'merge'",
    ]);
    // In the field table's order: `supersedes`, then `proposals`, then amendment 1's `read_policy`.
    expect(
      draftProblems(edit(DRAFT, { supersedes: 5, proposals: [LINK], read_policy: "x" })),
    ).toEqual([
      "supersedes must be the id of the earlier draft",
      "proposal 1 is of a kind a writer may not write: kind must be one of event, link, not 'merge'",
      "read_policy must be { entry, max_tier, sha256 }: the policy entry read through, its ceiling then (0 to 3), and the sha256 of policy/crossing.json as read, 64 lowercase hex characters",
    ]);
  });
});

/** A link proposal of the example's day (draft/v1 amendment 2): an entity, what belongs to it, the lines it rests on. */
const A_LINK = { kind: "link", entity: id(601), text: "Crew list", evidence: [id("a4")] };
const LINK_SHAPE =
  "a link is {kind: link, entity, text, evidence, note?}: entity an entity id, text what it says, evidence a non-empty list of line ids, note a string when given";
const shownLink = (number: number, link: Record<string, JsonValue> = A_LINK) => ({
  number,
  kind: "link",
  entity: link.entity,
  text: link.text,
  note: link.note ?? null,
  evidence: link.evidence,
  supported: true,
  why: null,
});
const withExtra = (extra: JsonValue) => edit(DRAFT, { extra });

describe("draft/v1 amendment 2 (2026-10-21): a link, the evening, as the reference reads them at d053f78 (run)", () => {
  it("a link is a known kind: shown under links, numbered by its place among all the proposals", () => {
    const read = readDraft(withProposals(EVENT, A_LINK), ON_DAY);
    expect([read.proposals, read.links, read.proposals_unknown, read.malformed]).toEqual([
      [shown(1)],
      [shownLink(2)],
      0,
      [],
    ]);
    const first = readDraft(withProposals(A_LINK, EVENT, LINK, A_LINK), ON_DAY);
    expect([first.proposals, first.links, first.proposals_unknown]).toEqual([
      [shown(2)],
      [shownLink(1), shownLink(4)],
      1,
    ]);
  });

  it("a link's note is kept when given; its text is shown stripped, its entity and note as written", () => {
    const noted = { ...A_LINK, note: "from the pontoon" };
    expect(readDraft(withProposals(noted), ON_DAY).links).toEqual([shownLink(1, noted)]);
    const padded = { ...A_LINK, entity: " e ", text: " t ", note: " n " };
    expect(readDraft(withProposals(padded), ON_DAY).links).toEqual([
      { ...shownLink(1, padded), text: "t" },
    ]);
    // Any entity id the line names, not only a canonical id's form; any evidence id but an empty one.
    const loose = { ...A_LINK, entity: "crew", evidence: [id("a4"), id("a4")] };
    expect(readDraft(withProposals(loose), ON_DAY).links).toEqual([shownLink(1, loose)]);
    const spaces = { ...A_LINK, evidence: ["  "] };
    expect(readDraft(withProposals(spaces), ON_DAY)).toMatchObject({
      links: [
        {
          ...shownLink(1, spaces),
          supported: false,
          why: "evidence names a line that is not on the day",
        },
      ],
      malformed: [],
    });
  });

  it("a link resting on a line not of the unit is shown unsupported, and says why, as an event is", () => {
    const off = { ...A_LINK, evidence: [id("a4"), id("9ff")] };
    const event = { ...EVENT, evidence: [id("a2"), id("9ff")] };
    const read = readDraft(withProposals(event, off), ON_DAY);
    const why = "evidence names a line that is not on the day";
    expect(read.proposals).toEqual([{ ...shown(1, event), supported: false, why }]);
    expect(read.links).toEqual([{ ...shownLink(2, off), supported: false, why }]);
    expect(read.malformed).toEqual([]);
    // Without the unit's lines the evidence is not checked.
    expect(readDraft(withProposals(off)).links).toEqual([shownLink(1, off)]);
  });

  it("a link of the wrong shape is malformed, in the reference's words, and not shown", () => {
    const bare = A_LINK;
    const shapes: JsonValue[] = [
      { kind: "link" },
      { kind: "link", from: id("a3"), to: id("a4") },
      { ...bare, entity: "" },
      { ...bare, entity: " " },
      { ...bare, entity: 5 },
      { kind: "link", text: "t", evidence: [id("a4")] },
      { ...bare, text: "" },
      { ...bare, text: "  " },
      { ...bare, text: 5 },
      { ...bare, evidence: [] },
      { ...bare, evidence: [""] },
      { ...bare, evidence: [5] },
      { ...bare, evidence: id("a4") },
      { ...bare, note: "" },
      { ...bare, note: " " },
      { ...bare, note: null },
      { ...bare, note: 5 },
      { ...bare, ref: "x" },
    ];
    for (const shape of shapes) {
      const read = readDraft(withProposals(shape, A_LINK), ON_DAY);
      expect({ shape, links: read.links, malformed: read.malformed }).toEqual({
        shape,
        links: [shownLink(2)],
        malformed: [malformedProposal(1, LINK_SHAPE)],
      });
      expect(read.proposals_unknown).toBe(0);
    }
    // `Link` and ` link` are not `link`: kinds it does not know, counted.
    for (const kind of ["Link", " link"]) {
      const read = readDraft(withProposals({ ...A_LINK, kind }), ON_DAY);
      expect([read.links, read.proposals_unknown, read.malformed]).toEqual([[], 1, []]);
    }
  });

  it("a proposal that is not an object or names no kind takes the event's sentence; the first malformed is named", () => {
    const read = readDraft(withProposals("x", { kind: "link" }, A_LINK), ON_DAY);
    expect([read.links, read.malformed]).toEqual([
      [shownLink(3)],
      [malformedProposal(1, EVENT_SHAPE)],
    ]);
  });

  it("the writer knows link too: a kind outside event and link is refused", () => {
    expect(draftProblems(withProposals(EVENT, A_LINK))).toEqual([]);
    expect(draftProblems(withProposals(A_LINK, LINK))).toEqual([
      "proposal 2 is of a kind a writer may not write: kind must be one of event, link, not 'merge'",
    ]);
  });

  it("extra.evening: true on a draft of the day so far, with extra.read_until, the moment read up to", () => {
    const read = readDraft(
      withExtra({ evening: true, read_until: "2026-06-13T18:00:00Z" }),
      ON_DAY,
    );
    expect([read.evening, read.read_until, read.malformed]).toEqual([
      true,
      "2026-06-13T18:00:00Z",
      [],
    ]);
    // The reference's form is a pattern: a fraction is one, and the calendar is not checked.
    // Its digits are any decimal digit, as Python's `\d` takes them.
    for (const at of [
      "2026-06-13T18:00:00.5Z",
      "2026-02-30T18:00:00Z",
      "2026-06-13T25:61:60Z",
      "٢٠٢٦-06-13T18:00:00Z",
    ]) {
      expect(readDraft(withExtra({ evening: true, read_until: at })).malformed).toEqual([]);
    }
    expect(readDraft(DRAFT).evening).toBe(false);
    expect(readDraft(withExtra({ other: 1 })).malformed).toEqual([]);
  });

  it("an evening draft's read_until is RFC 3339 UTC with a Z; extra.evening is true when present; extra is an object", () => {
    const READ_UNTIL =
      "an evening draft's extra.read_until is the moment it read up to, UTC with a Z";
    for (const at of [
      undefined,
      5,
      "yesterday",
      "2026-06-13T18:00Z",
      "2026-06-13T18:00:00z",
      "2026-6-13T18:00:00Z",
      "2026-06-13 18:00:00Z",
      "2026-06-13T18:00:00.Z",
      "2026-06-13T20:00:00+02:00",
      "2026-06-13T18:00:00+00:00",
      "2026-06-13T18:00:00Z\n",
    ]) {
      const read = readDraft(
        withExtra(at === undefined ? { evening: true } : { evening: true, read_until: at }),
      );
      expect({ at, malformed: read.malformed }).toEqual({ at, malformed: [READ_UNTIL] });
      expect(read.evening).toBe(true);
      // The value is shown as written when it is a string, else null.
      expect(read.read_until).toBe(typeof at === "string" ? at : null);
    }
    for (const evening of [false, null, 1, "yes"]) {
      const read = readDraft(withExtra({ evening, read_until: "2026-06-13T18:00:00Z" }));
      expect([read.evening, read.malformed]).toEqual([
        false,
        ["extra.evening is true when present"],
      ]);
    }
    // read_until without evening is not checked, and shown when it is a string.
    expect(readDraft(withExtra({ read_until: "yesterday" }))).toMatchObject({
      evening: false,
      read_until: "yesterday",
      malformed: [],
    });
    expect(readDraft(withExtra({ read_until: 5 })).read_until).toBeNull();
    for (const extra of [null, "x", [], 5]) {
      const read = readDraft(withExtra(extra));
      expect([read.evening, read.read_until, read.malformed]).toEqual([
        false,
        null,
        ["extra must be an object"],
      ]);
    }
  });

  it("names every problem in the reference's order: the reader's fields, segments, supersedes, proposals, then extra", () => {
    const read = readDraft(
      edit(DRAFT, {
        read_count: -1,
        segments: [{ text: "x" }],
        supersedes: 5,
        proposals: [{ kind: "link" }],
        extra: { evening: false },
      }),
    );
    expect(read.malformed).toEqual([
      "read_count must be how many lines of the unit the model read",
      malformedSegment(1),
      "supersedes must be the id of the earlier draft",
      malformedProposal(1, LINK_SHAPE),
      "extra.evening is true when present",
    ]);
  });
});

describe("draft/v1 rules 1, 2 and the tier", () => {
  it("dedupes on (source, unit, subject, read_head), and on the window too for a person", () => {
    expect(draftKey(DRAFT)).toBe(
      JSON.stringify([
        "model:qwen2.5-7b-instruct",
        "day",
        "2026-06-13",
        "bb97e90d3f946f6cc637e5e223b080ada65e2beb12b07293727e28d2a279b3d8",
      ]),
    );
    const again = edit(DRAFT, {}, { id: id("d3"), seq: 900 });
    const moved = edit(DRAFT, { read_head: "c".repeat(64) }, { id: id("d4"), seq: 901 });
    const otherModel = edit(DRAFT, {}, { id: id("d5"), seq: 902, source: "model:other" });
    expect(
      duplicates([DRAFT, again, moved, otherModel], none, draftKey).map((d) => d.line.id),
    ).toEqual([id("d3")]);
    const otherWindow = edit(
      PERSON_DRAFT,
      { window: { from: "2026-09-01", to: "2026-10-11" } },
      { id: id("d6"), seq: 903 },
    );
    expect(duplicates([PERSON_DRAFT, otherWindow], none, draftKey)).toEqual([]);
  });

  it("the standing draft of a unit: the latest not retracted and not named in a later draft's supersedes", () => {
    const later = edit(
      DRAFT,
      { read_head: "c".repeat(64), supersedes: id("d1") },
      { id: id("d7"), seq: 910 },
    );
    const ofDay = unitKey("day", "2026-06-13");
    expect(standingDrafts([DRAFT, later], none).get(ofDay)?.id).toBe(id("d7"));
    expect(standingDrafts([DRAFT, later], retractedSet(id("d7"))).get(ofDay)?.id).toBe(id("d1"));
    expect(standingDrafts([DRAFT], retractedSet(id("d1"))).get(ofDay)).toBeUndefined();
    const anotherDay = edit(DRAFT, { subject: "2026-06-12" }, { id: id("d8"), seq: 911 });
    expect(standingDrafts([DRAFT, anotherDay], none).get(ofDay)?.id).toBe(id("d1"));
  });

  it("a person's standing draft is the latest of the subject, whatever its window", () => {
    const narrower = edit(
      PERSON_DRAFT,
      { window: { from: "2026-09-01", to: "2026-10-11" } },
      { id: id("d9"), seq: 920 },
    );
    expect(standingDrafts([PERSON_DRAFT, narrower], none).get(unitKey("person", id(501)))?.id).toBe(
      id("d9"),
    );
  });

  it("the tier is never below a line the draft cites: every cited line is a line it read", () => {
    expect(draftTierProblems(DRAFT, DAY_LINES)).toEqual([]);
    expect(draftTierProblems(edit(DRAFT, {}, { tier: 1 }), DAY_LINES)).toEqual([
      `tier is 1, below the tier 2 of ${id("a4")}, a line it cites; a draft's tier is the highest among the lines it read`,
    ]);
    // The morning's steps (tier 3) were outside its reading, and it cites none: tier 2 holds.
    const steps = line({
      id: id("a0"),
      at: "2026-06-13T06:00:00Z",
      source: "sim-watch",
      kind: "health-sample",
      tier: 3,
      payload: { schema: "health-sample/v1", type: "steps", value: 4200 },
    });
    expect(draftTierProblems(DRAFT, [steps, ...DAY_LINES])).toEqual([]);
  });
});

describe("the row show prints for a draft, as the reference prints it (run)", () => {
  const row = (payload: Record<string, JsonValue | undefined>) =>
    draftRow(edit(DRAFT, payload).payload as never);

  it("the example: the unit and subject, the count and head read, the segments and how many unsupported", () => {
    expect(draftRow(DRAFT.payload as never)).toBe(
      "draft of day 2026-06-13 · 5 lines read at bb97e90d · 4 segments, 1 unsupported",
    );
  });

  it("one line, one segment, none unsupported; and a draft that supersedes another", () => {
    expect(row({ read_count: 1, segments: [{ text: "x", evidence: [id("a1")] }] })).toBe(
      "draft of day 2026-06-13 · 1 line read at bb97e90d · 1 segment",
    );
    expect(row({ supersedes: id("d0") })).toBe(
      "draft of day 2026-06-13 · 5 lines read at bb97e90d · 4 segments, 1 unsupported · supersedes an earlier draft",
    );
    for (const value of ["", null]) {
      expect(row({ supersedes: value })).toBe(
        "draft of day 2026-06-13 · 5 lines read at bb97e90d · 4 segments, 1 unsupported",
      );
    }
  });

  it("an array subject joined, a person by id, and what a malformed line prints", () => {
    expect(row({ unit: "event", subject: [id("a1"), id("a2")] })).toContain(
      `draft of event ${id("a1")}, ${id("a2")} · `,
    );
    expect(row({ unit: "person", subject: id(501) })).toContain(`draft of person ${id(501)} · `);
    expect(row({ unit: undefined, subject: undefined })).toBe(
      "draft of None None · 5 lines read at bb97e90d · 4 segments, 1 unsupported",
    );
    expect(row({ read_count: undefined })).toBe(
      "draft of day 2026-06-13 · None lines read at bb97e90d · 4 segments, 1 unsupported",
    );
    expect(row({ read_count: true })).toBe(
      "draft of day 2026-06-13 · True line read at bb97e90d · 4 segments, 1 unsupported",
    );
    expect(row({ read_head: undefined })).toBe(
      "draft of day 2026-06-13 · 5 lines read at  · 4 segments, 1 unsupported",
    );
    expect(row({ read_head: 5 })).toBe(
      "draft of day 2026-06-13 · 5 lines read at 5 · 4 segments, 1 unsupported",
    );
    expect(row({ segments: "text" })).toBe(
      "draft of day 2026-06-13 · 5 lines read at bb97e90d · 0 segments",
    );
    expect(row({ segments: ["text"] })).toBe(
      "draft of day 2026-06-13 · 5 lines read at bb97e90d · 1 segment, 1 unsupported",
    );
    expect(
      row({
        segments: [
          { text: "x", unsupported: true },
          { text: "y", evidence: [] },
        ],
      }),
    ).toBe("draft of day 2026-06-13 · 5 lines read at bb97e90d · 2 segments, 2 unsupported");
  });

  it("counts the proposals: a link by its kind, every other proposal as an event, whatever its shape", () => {
    const base = "draft of day 2026-06-13 · 5 lines read at bb97e90d · 4 segments, 1 unsupported";
    expect(row({ proposals: [EVENT] })).toBe(`${base} · 1 proposed event`);
    expect(row({ proposals: [A_LINK] })).toBe(`${base} · 1 proposed link`);
    expect(row({ proposals: [EVENT, EVENT, A_LINK, A_LINK, LINK] })).toBe(
      `${base} · 3 proposed events · 2 proposed links`,
    );
    // The row counts the array as written: a malformed link is a link, a non-object an event.
    expect(row({ proposals: ["x", { kind: "link" }, { kind: 5 }] })).toBe(
      `${base} · 2 proposed events · 1 proposed link`,
    );
    for (const none of [[], {}, "text", null]) expect(row({ proposals: none })).toBe(base);
    expect(row({ proposals: [A_LINK], supersedes: id("d0") })).toBe(
      `${base} · 1 proposed link · supersedes an earlier draft`,
    );
  });
});
