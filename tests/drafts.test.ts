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
/** A kind no amendment names yet (RFC 0043 proposes `link`): what a newer writer might write. */
const LINK = { kind: "link", from: id("a3"), to: id("a4") };
const withProposals = (...proposals: JsonValue[]) => edit(DRAFT, { proposals });
const EVENT_SHAPE =
  "an event proposal is {kind, title, start, end, place, people, evidence}, each of its type, start before end, nothing else";
const NO_KIND = "a proposal is an object that names its kind";
const malformedProposal = (n: number, why: string): string => `proposal ${n} is malformed: ${why}`;

describe("a draft's proposals (draft/v1, amendment of 2026-10-13, and forward compatibility of 2026-10-19)", () => {
  it("a draft that proposes nothing has no proposals and none unknown", () => {
    const read = readDraft(DRAFT, ON_DAY);
    expect([read.proposals, read.proposals_unknown, read.malformed]).toEqual([[], 0, []]);
  });

  it("an unknown kind beside a valid event: the event is shown, one is counted, the line is not malformed", () => {
    const read = readDraft(withProposals(EVENT, LINK), ON_DAY);
    expect(read.proposals).toEqual([{ number: 1, ...EVENT }]);
    expect(read.proposals_unknown).toBe(1);
    expect(read.malformed).toEqual([]);
  });

  it("numbers do not move: a proposal keeps its place in the array, the unknown ones counted in it", () => {
    const read = readDraft(withProposals(LINK, { ...LINK, kind: "goal" }, EVENT), ON_DAY);
    expect(read.proposals).toEqual([{ number: 3, ...EVENT }]);
    expect(read.proposals_unknown).toBe(2);
    expect(read.malformed).toEqual([]);
  });

  it("a malformed event is still malformed: the valid ones are shown and the line is said to be malformed", () => {
    const bad = { ...EVENT, title: "" };
    const read = readDraft(withProposals(EVENT, bad, LINK), ON_DAY);
    expect(read.proposals).toEqual([{ number: 1, ...EVENT }]);
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
    expect(readDraft(withProposals(named)).proposals).toEqual([{ number: 1, ...named }]);
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
      "proposal 2 is of a kind a writer may not write: kind must be one of event, not 'link'",
    ]);
    expect(draftProblems(withProposals({ ...EVENT, title: "" }, LINK, { kind: "goal" }))).toEqual([
      malformedProposal(1, EVENT_SHAPE),
      "proposal 2 is of a kind a writer may not write: kind must be one of event, not 'link'",
    ]);
    // In the field table's order: `supersedes`, then `proposals`, then amendment 1's `read_policy`.
    expect(
      draftProblems(edit(DRAFT, { supersedes: 5, proposals: [LINK], read_policy: "x" })),
    ).toEqual([
      "supersedes must be the id of the earlier draft",
      "proposal 1 is of a kind a writer may not write: kind must be one of event, not 'link'",
      "read_policy must be { entry, max_tier, sha256 }: the policy entry read through, its ceiling then (0 to 3), and the sha256 of policy/crossing.json as read, 64 lowercase hex characters",
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
});
