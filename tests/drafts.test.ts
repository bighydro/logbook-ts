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
          part: null,
        },
        {
          text: "One photo from the pontoon, the new mooring lines on.",
          evidence: [id("a3")],
          supported: true,
          why: null,
          part: null,
        },
        {
          text: "You wrote that the engine sounded right for the first time since May.",
          evidence: [id("a4")],
          supported: true,
          why: null,
          part: null,
        },
        {
          text: "Ola came by in the evening.",
          evidence: [],
          supported: false,
          why: null,
          part: null,
        },
      ],
      unsupported: 1,
      proposals: [],
      links: [],
      proposals_unknown: 0,
      supersedes: null,
      evening: false,
      read_until: null,
      marked: {},
      dropped: {},
      dropped_links: {},
      dropped_segments: {},
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
          part: null,
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
      { text: "a", evidence: [id("a1")], supported: true, why: null, part: null },
      { text: "(no text)", evidence: [], supported: false, why: SHAPE, part: null },
      { text: "5", evidence: [], supported: false, why: SHAPE, part: null },
      { text: "c", evidence: [], supported: false, why: null, part: null },
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
/** How a reader shows that event: numbered, its evidence on the day. */
const shownEvent = (number: number, event: Record<string, JsonValue> = EVENT) => ({
  number,
  ...event,
  supported: true,
  why: null,
});
/** A link proposal (draft/v1 amendment 2, 2026-10-21): a line of the day that belongs to an idea. */
const IDEA = id(401);
const LINK = { kind: "link", entity: IDEA, text: "Crew list", evidence: [id("a4")] };
const shownLink = (number: number, link: Record<string, JsonValue> = LINK) => ({
  number,
  kind: "link",
  entity: link.entity,
  text: link.text,
  note: link.note ?? null,
  evidence: link.evidence,
  supported: true,
  why: null,
});
/** A kind no amendment names yet: what a newer writer might write. */
const GOAL = { kind: "goal", from: id("a3"), to: id("a4") };
const withProposals = (...proposals: JsonValue[]) => edit(DRAFT, { proposals });
/** The reference's sentences (6ee01c2, run): one for a link, one for every other malformed proposal. */
const EVENT_SHAPE =
  "a proposal is {kind: event, title, start, end, place, people, evidence}: start before end, both UTC with a Z, people and evidence lists of ids, evidence not empty";
const LINK_SHAPE =
  "a link is {kind: link, entity, text, evidence, note?}: entity an entity id, text what it says, evidence a non-empty list of line ids, note a string when given";
const malformedProposal = (n: number, why: string): string => `proposal ${n} is malformed: ${why}`;

describe("a draft's proposals (draft/v1, amendment of 2026-10-13, forward compatibility of 2026-10-19, amendment 2 of 2026-10-21; the reference at 6ee01c2, run)", () => {
  it("a draft that proposes nothing has no proposals, no links and none unknown", () => {
    const read = readDraft(DRAFT, ON_DAY);
    expect([read.proposals, read.links, read.proposals_unknown, read.malformed]).toEqual([
      [],
      [],
      0,
      [],
    ]);
  });

  it("an unknown kind beside a valid event: the event is shown, one is counted, the line is not malformed", () => {
    const read = readDraft(withProposals(EVENT, GOAL), ON_DAY);
    expect(read.proposals).toEqual([shownEvent(1)]);
    expect(read.proposals_unknown).toBe(1);
    expect(read.malformed).toEqual([]);
  });

  it("numbers do not move: a proposal keeps its place in the array, the unknown ones counted in it", () => {
    const read = readDraft(withProposals(GOAL, { ...GOAL, kind: "task" }, EVENT), ON_DAY);
    expect(read.proposals).toEqual([shownEvent(3)]);
    expect(read.proposals_unknown).toBe(2);
    expect(read.malformed).toEqual([]);
  });

  it("a kind is matched as written: `Link` is a kind the reader does not know", () => {
    const read = readDraft(withProposals(EVENT, { ...LINK, kind: "Link" }), ON_DAY);
    expect([read.proposals, read.links, read.proposals_unknown]).toEqual([[shownEvent(1)], [], 1]);
  });

  it("a malformed event is still malformed: the valid ones are shown and the line is said to be malformed", () => {
    const bad = { ...EVENT, title: "" };
    const read = readDraft(withProposals(EVENT, bad, GOAL), ON_DAY);
    expect(read.proposals).toEqual([shownEvent(1)]);
    expect(read.proposals_unknown).toBe(1);
    expect(read.malformed).toEqual([malformedProposal(2, EVENT_SHAPE)]);
    const first = readDraft(withProposals(bad, EVENT), ON_DAY);
    expect([first.proposals, first.malformed]).toEqual([
      [shownEvent(2)],
      [malformedProposal(1, EVENT_SHAPE)],
    ]);
  });

  it("every way an event can be of the wrong shape, each malformed, the first one named", () => {
    const shapes: JsonValue[] = [
      { ...EVENT, title: 5 },
      { ...EVENT, title: "  " },
      { ...EVENT, start: "2026-06-13 12:00:00" },
      { ...EVENT, start: "2026-06-13T12:00:00+02:00" },
      { ...EVENT, start: "2026-06-13T12:00:00+00:00" },
      // The reference's `day` stops on this one (SPEC-QUESTIONS 121); here it is malformed.
      { ...EVENT, start: "2026-02-30T12:00:00Z" },
      { ...EVENT, end: null },
      { ...EVENT, start: "2026-06-13T16:00:00Z" },
      { ...EVENT, start: "2026-06-13T17:00:00Z" },
      { ...EVENT, place: 5 },
      { ...EVENT, place: "" },
      { ...EVENT, place: "  " },
      { ...EVENT, people: "Ola" },
      { ...EVENT, people: [5] },
      { ...EVENT, people: [""] },
      { ...EVENT, evidence: [] },
      { ...EVENT, evidence: "x" },
      { ...EVENT, evidence: [""] },
      { ...EVENT, colour: "blue" },
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

  it("an event may leave `place` out, read as null, and names an id as any non-empty string", () => {
    const { place: _place, ...noPlace } = EVENT;
    expect(readDraft(withProposals(noPlace), ON_DAY)).toMatchObject({
      proposals: [shownEvent(1)],
      malformed: [],
    });
    const blanks = { ...EVENT, people: ["  "] };
    expect(readDraft(withProposals(blanks), ON_DAY).proposals).toEqual([shownEvent(1, blanks)]);
  });

  it("start before end to the last digit of the fraction, not to the millisecond", () => {
    const close = {
      ...EVENT,
      start: "2026-06-13T12:00:00.1234Z",
      end: "2026-06-13T12:00:00.1235Z",
    };
    expect(readDraft(withProposals(close), ON_DAY).proposals).toEqual([shownEvent(1, close)]);
    const coarse = { ...EVENT, start: "2026-06-13T12:00:00.5Z", end: "2026-06-13T12:00:00.50Z" };
    expect(readDraft(withProposals(coarse), ON_DAY).malformed).toEqual([
      malformedProposal(1, EVENT_SHAPE),
    ]);
  });

  it("an event whose evidence names a line not on the day is shown unsupported, and says why", () => {
    for (const evidence of [[id(301)], [id("a2"), id(301)], ["  "]]) {
      const off = { ...EVENT, evidence };
      expect(readDraft(withProposals(off), ON_DAY).proposals).toEqual([
        {
          ...shownEvent(1, off),
          supported: false,
          why: "evidence names a line that is not on the day",
        },
      ]);
    }
  });

  it("an event with a place and people is shown with them", () => {
    const named = { ...EVENT, place: "Vollen", people: [id(501)] };
    expect(readDraft(withProposals(named)).proposals).toEqual([shownEvent(1, named)]);
  });

  it("a proposal that is not an object, or names no kind, is malformed in the event's words", () => {
    for (const bad of [
      "event",
      5,
      null,
      [EVENT],
      {},
      { ...GOAL, kind: "" },
      { ...GOAL, kind: "  " },
      { ...GOAL, kind: 5 },
    ]) {
      const read = readDraft(withProposals(GOAL, bad as JsonValue, EVENT), ON_DAY);
      expect({ bad, malformed: read.malformed }).toEqual({
        bad,
        malformed: [malformedProposal(2, EVENT_SHAPE)],
      });
      expect([read.proposals, read.proposals_unknown]).toEqual([[shownEvent(3)], 1]);
    }
  });

  it("proposals that are not a list are malformed; absent, there are none", () => {
    for (const bad of ["event", 5, {}, null]) {
      const read = readDraft(edit(DRAFT, { proposals: bad as JsonValue }), ON_DAY);
      expect(read.malformed).toEqual(["proposals must be a list"]);
      expect([read.proposals, read.links, read.proposals_unknown]).toEqual([[], [], 0]);
    }
    expect(readDraft(withProposals(), ON_DAY).malformed).toEqual([]);
  });

  it("the writer stays strict: draftProblems refuses a kind it does not know, as a writer does", () => {
    expect(draftProblems(withProposals(EVENT))).toEqual([]);
    expect(draftProblems(withProposals(EVENT, LINK))).toEqual([]);
    expect(draftProblems(withProposals(EVENT, GOAL))).toEqual([
      "proposal 2 is of a kind a writer may not write: kind must be one of event, link, not 'goal'",
    ]);
    expect(draftProblems(withProposals({ ...EVENT, title: "" }, GOAL, { kind: "task" }))).toEqual([
      malformedProposal(1, EVENT_SHAPE),
      "proposal 2 is of a kind a writer may not write: kind must be one of event, link, not 'goal'",
    ]);
    // In the field table's order: `supersedes`, then `proposals`, then amendment 1's `read_policy`.
    expect(
      draftProblems(edit(DRAFT, { supersedes: 5, proposals: [GOAL], read_policy: "x" })),
    ).toEqual([
      "supersedes must be the id of the earlier draft",
      "proposal 1 is of a kind a writer may not write: kind must be one of event, link, not 'goal'",
      "read_policy must be { entry, max_tier, sha256 }: the policy entry read through, its ceiling then (0 to 3), and the sha256 of policy/crossing.json as read, 64 lowercase hex characters",
    ]);
  });
});

describe("a draft's links (draft/v1 amendment 2, 2026-10-21; the reference at 6ee01c2, run)", () => {
  it("a link is known: shown under links, numbered by its place among all the proposals, never counted unknown", () => {
    const read = readDraft(withProposals(LINK, { ...LINK, text: "Two" }, EVENT, GOAL), ON_DAY);
    expect(read.links).toEqual([shownLink(1), shownLink(2, { ...LINK, text: "Two" })]);
    expect(read.proposals).toEqual([shownEvent(3)]);
    expect([read.proposals_unknown, read.malformed]).toEqual([1, []]);
  });

  it("a note, when given, is shown; absent, it is null", () => {
    const noted = { ...LINK, note: "from the evening's note" };
    expect(readDraft(withProposals(noted), ON_DAY).links).toEqual([shownLink(1, noted)]);
  });

  it("the entity is any non-blank string, and evidence ids any non-empty string, repeated or not", () => {
    for (const link of [
      { ...LINK, entity: "crew" },
      { ...LINK, evidence: [id("a4"), id("a4")] },
    ]) {
      expect(readDraft(withProposals(link), ON_DAY).links).toEqual([shownLink(1, link)]);
    }
  });

  it("a link whose evidence names a line not on the day is shown unsupported, and says why", () => {
    for (const evidence of [[id(301)], [id("a4"), id(301)], ["  "]]) {
      const off = { ...LINK, evidence };
      expect(readDraft(withProposals(off), ON_DAY).links).toEqual([
        {
          ...shownLink(1, off),
          supported: false,
          why: "evidence names a line that is not on the day",
        },
      ]);
    }
  });

  it("every way a link can be of the wrong shape, each malformed in the link's words, the first one named", () => {
    const { entity: _entity, ...noEntity } = LINK;
    const shapes: JsonValue[] = [
      // The shape a stand-in for an unknown kind had here before amendment 2 named `link`.
      { kind: "link", from: id("a3"), to: id("a4") },
      { ...LINK, ref: "x" },
      noEntity,
      { ...LINK, entity: 5 },
      { ...LINK, entity: "" },
      { ...LINK, entity: "  " },
      { ...LINK, text: "" },
      { ...LINK, text: "  " },
      { ...LINK, text: 5 },
      { ...LINK, evidence: [] },
      { ...LINK, evidence: id("a4") },
      { ...LINK, evidence: [5] },
      { ...LINK, evidence: [""] },
      { ...LINK, note: "" },
      { ...LINK, note: "  " },
      { ...LINK, note: null },
      { ...LINK, note: 3 },
    ];
    for (const shape of shapes) {
      const read = readDraft(withProposals(shape, { ...EVENT, title: "" }, LINK), ON_DAY);
      expect({ shape, links: read.links, malformed: read.malformed }).toEqual({
        shape,
        links: [shownLink(3)],
        malformed: [malformedProposal(1, LINK_SHAPE)],
      });
      expect([read.proposals, read.proposals_unknown]).toEqual([[], 0]);
    }
  });
});

describe("what a draft's extra tells a reader (dream-day/4 and draft/v1 amendment 2; the reference at 6ee01c2, run)", () => {
  const FIVE = [
    { text: "S1", evidence: [id("a1")] },
    { text: "S2", evidence: [id("a4")] },
    { text: "S3", evidence: [id("a3")] },
    { text: "S4", evidence: [id("a4")] },
    { text: "S5", unsupported: true },
  ];
  const withExtra = (extra: JsonValue, segments: JsonValue[] = FIVE) =>
    readDraft(edit(DRAFT, { segments, extra }), ON_DAY);
  const parts = (extra: JsonValue, segments: JsonValue[] = FIVE) =>
    withExtra(extra, segments).segments.map((s) => s.part);

  it("each segment's part, from extra.parts: the day's parts, dream-day/3's and dream-day/4's, and lens:<id>", () => {
    expect(parts({ parts: ["day", "threads", "questions", "people", "promises"] })).toEqual([
      "day",
      "threads",
      "questions",
      "people",
      "promises",
    ]);
    expect(parts({ parts: ["story", "decision", "photo", "lens:money", "ideas"] })).toEqual([
      "story",
      "decision",
      "photo",
      "lens:money",
      "ideas",
    ]);
    expect(
      parts({ parts: ["learned", "lens:a:b", "lens: x", "lens:x\ny", "lens:Boat X"] }),
    ).toEqual(["learned", "lens:a:b", "lens: x", "lens:x\ny", "lens:Boat X"]);
  });

  it("a part the day's draft does not have is null: another unit's, another case, `lens:` alone, not a string", () => {
    expect(parts({ parts: ["month", "where", "goals", "next_month", "question"] })).toEqual(
      Array(5).fill(null),
    );
    expect(parts({ parts: ["arc", "rule", "held", "closed", "Story"] })).toEqual(
      Array(5).fill(null),
    );
    expect(parts({ parts: ["foo", "lens:", "week", 5, null] })).toEqual(Array(5).fill(null));
  });

  it("extra.parts is read only when it is a list as long as the segments read", () => {
    for (const extra of [
      { parts: ["story", "learned"] },
      { parts: ["story", "learned", "ideas", "ideas", "photo", "story"] },
      { parts: "story" },
      {},
    ]) {
      expect(parts(extra)).toEqual(Array(5).fill(null));
    }
    // A segment that is not an object is not read, so two parts for one segment read are none.
    expect(
      parts({ parts: ["story", "photo"] }, ["x", { text: "b", evidence: [id("a1")] }]),
    ).toEqual([null]);
    expect(parts({ parts: ["story", "photo"] }, [{ text: "a" }, FIVE[0] as JsonValue])).toEqual([
      "story",
      "photo",
    ]);
  });

  it("an ideas segment carries the idea it moved, from extra.ideas by segment number from 1; the last entry wins", () => {
    const ideas = withExtra({
      parts: ["ideas", "ideas", "story", "ideas", "ideas"],
      ideas: [
        { segment: 0, entity: "E0" },
        { segment: 1, entity: "E1" },
        { segment: 3, entity: "E3" },
        { segment: 4, entity: "first" },
        { segment: 4, entity: "E4" },
        { segment: 9, entity: "E9" },
      ],
    }).segments;
    expect(ideas.map((s) => ("entity" in s ? s.entity : "-"))).toEqual(["E1", "-", "-", "E4", "-"]);
  });

  it("an entry of extra.ideas that is not {segment: an integer, entity: a string} is passed by", () => {
    const ideas = withExtra({
      parts: ["ideas", "ideas", "ideas", "ideas", "ideas"],
      ideas: [
        { segment: "1", entity: "E1" },
        { segment: 2, entity: 5 },
        { segment: 3 },
        7,
        { segment: 4, entity: "" },
        { segment: true, entity: "T" },
        { segment: 2.5, entity: "F" },
        { segment: 5, entity: { id: 1 } },
      ],
    }).segments;
    expect(ideas.map((s) => ("entity" in s ? s.entity : "-"))).toEqual(["-", "-", "-", "", "-"]);
    expect(
      withExtra({ parts: Array(5).fill("ideas"), ideas: { segment: 1, entity: "X" } }).segments.map(
        (s) => "entity" in s,
      ),
    ).toEqual(Array(5).fill(false));
  });

  it("the evening: extra.evening true and read_until the moment read up to, else false and read_until as written", () => {
    expect(withExtra({ evening: true, read_until: "2026-06-13T18:00:00Z" })).toMatchObject({
      evening: true,
      read_until: "2026-06-13T18:00:00Z",
      malformed: [],
    });
    expect(withExtra({ read_until: "x" })).toMatchObject({
      evening: false,
      read_until: "x",
      malformed: [],
    });
    expect(withExtra({})).toMatchObject({ evening: false, read_until: null, malformed: [] });
    for (const read_until of [
      "2026-06-13T18:00:00.123456Z",
      "2026-02-30T18:00:00Z",
      "2026-06-13T24:00:00Z",
    ]) {
      expect(withExtra({ evening: true, read_until }).malformed).toEqual([]);
    }
  });

  it("extra.evening is true when present; an evening draft's read_until is UTC with a Z", () => {
    for (const evening of [false, null, 1, "true"]) {
      expect(withExtra({ evening, read_until: "2026-06-13T18:00:00Z" })).toMatchObject({
        evening: false,
        read_until: "2026-06-13T18:00:00Z",
        malformed: ["extra.evening is true when present"],
      });
    }
    for (const read_until of [
      undefined,
      5,
      "yesterday",
      "2026-06-13T18:00:00+00:00",
      "2026-06-13T18:00Z",
      "2026-06-13t18:00:00z",
      "2026-06-13 18:00:00Z",
    ]) {
      const read = withExtra(
        read_until === undefined ? { evening: true } : { evening: true, read_until },
      );
      expect({ read_until, evening: read.evening, malformed: read.malformed }).toEqual({
        read_until,
        evening: true,
        malformed: [
          "an evening draft's extra.read_until is the moment it read up to, UTC with a Z",
        ],
      });
      expect(read.read_until).toBe(typeof read_until === "string" ? read_until : null);
    }
  });

  it("extra, when the key is there, is an object; null is not one", () => {
    for (const extra of ["x", [], 5, null]) {
      expect(withExtra(extra).malformed).toEqual(["extra must be an object"]);
    }
  });

  it("what the writer marked and dropped, by why, as written when it is an object", () => {
    const read = withExtra({
      marked: { "a number beside a person": 2 },
      dropped: { questions: 1 },
      dropped_links: { "an id the material did not give": 1 },
      dropped_segments: { x: 3 },
    });
    expect([read.marked, read.dropped, read.dropped_links, read.dropped_segments]).toEqual([
      { "a number beside a person": 2 },
      { questions: 1 },
      { "an id the material did not give": 1 },
      { x: 3 },
    ]);
    const odd = withExtra({
      marked: [1],
      dropped: "x",
      dropped_links: { a: "b", c: -1, d: 1.5, e: true },
      dropped_segments: null,
    });
    expect([odd.marked, odd.dropped, odd.dropped_links, odd.dropped_segments]).toEqual([
      {},
      {},
      { a: "b", c: -1, d: 1.5, e: true },
      {},
    ]);
  });

  it("hands back copies: changing what it read never changes the line", () => {
    const draft = edit(DRAFT, {
      proposals: [EVENT, LINK],
      extra: {
        marked: { a: 1 },
        dropped: { b: 2 },
        dropped_links: { c: 3 },
        dropped_segments: { d: 4 },
      },
    });
    const before = JSON.stringify(draft);
    const read = readDraft(draft, ON_DAY);
    for (const counts of [read.marked, read.dropped, read.dropped_links, read.dropped_segments]) {
      counts.x = 99;
    }
    read.proposals[0]?.evidence.push("x");
    read.links[0]?.evidence.push("x");
    read.segments[0]?.evidence.push("x");
    expect(JSON.stringify(draft)).toBe(before);
  });

  it("names every problem in the reference's order, extra's last", () => {
    const read = readDraft(
      edit(DRAFT, {
        read_head: "x",
        read_count: -1,
        language: "english",
        segments: [{ text: "x" }],
        supersedes: 5,
        proposals: [{ kind: "link" }],
        extra: { evening: 1 },
      }),
      ON_DAY,
    );
    expect(read.malformed).toEqual([
      "read_head must be the record's head, 64 lowercase hex characters",
      "read_count must be how many lines of the unit the model read",
      "language must be a BCP 47 tag, en or nb",
      malformedSegment(1),
      "supersedes must be the id of the earlier draft",
      malformedProposal(1, LINK_SHAPE),
      "extra.evening is true when present",
    ]);
    expect(
      readDraft(edit(DRAFT, { supersedes: 5, proposals: "x", extra: "x" }), ON_DAY).malformed,
    ).toEqual([
      "supersedes must be the id of the earlier draft",
      "proposals must be a list",
      "extra must be an object",
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

  it("the proposals it holds, events and links, each counted when there is one (the reference at 6ee01c2, run)", () => {
    const event = { kind: "event" };
    const link = { kind: "link" };
    const head = "draft of day 2026-06-13 · 5 lines read at bb97e90d · 4 segments, 1 unsupported";
    expect(row({ proposals: [event] })).toBe(`${head} · 1 proposed event`);
    expect(row({ proposals: [link] })).toBe(`${head} · 1 proposed link`);
    expect(row({ proposals: [link, event, link] })).toBe(
      `${head} · 1 proposed event · 2 proposed links`,
    );
    // Every entry that is not a link counts as an event, whatever its kind or shape.
    expect(row({ proposals: [{ kind: "task" }, 5, {}, { kind: "Link" }, link] })).toBe(
      `${head} · 4 proposed events · 1 proposed link`,
    );
    expect(row({ proposals: [event, link, link], supersedes: id("d0") })).toBe(
      `${head} · 1 proposed event · 2 proposed links · supersedes an earlier draft`,
    );
    for (const none of [[], "x", { kind: "event" }, null]) {
      expect(row({ proposals: none as JsonValue })).toBe(head);
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
});
