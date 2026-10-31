import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type People, readPeople, renderPeople } from "../src/people.js";
import { cleanup, expectedWindows, FIXTURES, writeRecord } from "./helpers.js";

afterEach(cleanup);

const DEMO = join(FIXTURES, "demo-seed1");
const FIXTURE_NAMES = [
  "sample-logbook",
  "demo-seed1",
  "day-sample",
  "trips-sample",
  "demo-sample",
  "show-sample",
  "profiles-sample",
];

describe("people, as the reference's `logbook people` prints them", () => {
  // tests/fixtures/*/expected-people/ is the reference's own output on each fixture, captured by
  // tests/fixtures/capture-expected-readers.mjs and never edited; tests/cross-impl.test.ts checks it stays so.
  for (const name of FIXTURE_NAMES) {
    const root = join(FIXTURES, name);
    for (const expected of expectedWindows(root, "people")) {
      it(`prints ${name} (${expected.name}) as the reference does, as text and as JSON`, () => {
        const people = readPeople(root, expected.options);
        expect(JSON.parse(JSON.stringify(people))).toEqual(expected.json);
        expect(renderPeople(people, expected.options)).toBe(expected.text);
      });
    }
  }
});

describe("what people knows of each person", () => {
  const all = (): People => readPeople(DEMO, {});
  const person = (name: string) => all().people.find((p) => p.name === name);

  it("spans the record's days with a line of any kind, not the track alone, and names the report's tier", () => {
    const report = all();
    expect(report.window).toEqual({ since: "2026-05-31", until: "2026-06-30" });
    expect(report.tier).toBe(2);
    expect(report.people.length).toBe(12);
  });

  it("counts each channel with its lines, first and last day, highest tier and last line", () => {
    const ola = person("Ola Nordmann");
    expect(Object.keys(ola?.channels ?? {})).toEqual(["messages", "calls", "calendar", "faces"]);
    expect(ola?.channels.messages).toMatchObject({
      lines: 52,
      first: "2026-06-01",
      last: "2026-06-30",
      tier: 2,
    });
    expect(ola?.channels.calls).toMatchObject({ lines: 7, tier: 1 });
    expect(ola?.refs).toEqual([
      { kind: "email", value: "ola.nordmann@example.org" },
      { kind: "phone", value: "+447700900001" },
      { kind: "provider_id", value: "immich:f_01" },
    ]);
  });

  it("counts the days together from the confirmed set only, the nights under one roof, and the places by days there", () => {
    const ola = person("Ola Nordmann");
    expect(ola).toMatchObject({ days: 3, nights: 2 });
    expect(ola?.places).toEqual([
      { where: "Marina", days: 2 },
      { where: "Cabin", days: 1 },
    ]);
    // Kari's two tagged faces propose her and confirm nothing: no day together, no real contact.
    expect(person("Kari Nordmann")).toMatchObject({
      days: 0,
      nights: 0,
      places: [],
      lines: [],
      last_real_contact: null,
    });
  });

  it("names the last real contact: a meeting first on its day, else a message or an answered call; a mail is never one", () => {
    expect(person("Per Hansen")?.last_real_contact).toMatchObject({
      day: "2026-06-30",
      via: "meeting",
    });
    expect(person("Ola Nordmann")?.last_real_contact).toMatchObject({
      day: "2026-06-30",
      via: "message",
    });
    expect(person("Eva Nordmann")?.last_real_contact).toMatchObject({
      day: "2026-06-28",
      via: "call",
    });
    expect(person("Nils Haug")?.last_real_contact).toBeNull();
    // The seed-1 demo record read whole four times: about four and a half seconds alone, more than
    // five on a Windows runner busy with the test files that run children beside it. What is named
    // is the measure here, not the time.
  }, 20_000);

  it("orders people by days together, then by the latest contact, then by name", () => {
    expect(all().people.map((p) => p.name)).toEqual([
      "Per Hansen",
      "Liv Berg",
      "Ola Nordmann",
      "Anders Vik",
      "Freja Lund",
      "Sigrid Moen",
      "Jonas Weber",
      "Marta Keller",
      "Eva Nordmann",
      "Tore Dahl",
      "Kari Nordmann",
      "Nils Haug",
    ]);
  });

  it("says so when the year has no days, and lists nobody for a record without people", () => {
    const empty = readPeople(DEMO, { year: "2025" });
    expect(empty).toEqual({ window: null, tier: null, people: [] });
    expect(renderPeople(empty, { year: "2025" })).toBe(
      "no people: the record has no days in 2025\n",
    );
    const nobody = readPeople(
      writeRecord([
        {
          at: "2026-04-01T10:00:00Z",
          source: "manual",
          kind: "note",
          payload: { schema: "note/v1", text: "alone" },
        },
      ]),
      {},
    );
    expect(nobody).toEqual({
      window: { since: "2026-04-01", until: "2026-04-01" },
      tier: null,
      people: [],
    });
    expect(renderPeople(nobody)).toBe("0 people · 2026-04-01 – 2026-04-01\n");
  });

  it("never lists the owner, and gives the owner's lines in a direct chat to the one person who wrote in it", () => {
    const names = all().people.map((p) => p.name);
    expect(names).not.toContain("Ines Nordmann");
    // 52 messages with Ola: his and the owner's replies in their direct chat, both counted to him.
    const ola = person("Ola Nordmann");
    expect(ola?.channels.messages?.lines).toBe(52);
  });
});

describe("three things the reference's people does that no fixture showed", () => {
  // Each found running the reference (main at 7bcf728, and at 09e2967 before RFC 0038 alike) on the
  // same lines in a record of its own; the expected text is its output.
  const id = (seq: number): string => `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  const ola = {
    at: "2026-06-01T08:00:00Z",
    source: "manual",
    kind: "resolution",
    payload: {
      schema: "resolution/v1",
      ref: { kind: "email", value: "ola@example.org" },
      entity: { type: "person", id: "019cadd3-6bc0-7dcd-9133-000000000002", registry: "logbook" },
      label: "Ola Nordmann",
      method: "owner",
    },
  };
  const transcript = (at: string, raw: string, more: Record<string, unknown> = {}) => ({
    at,
    source: "granola",
    kind: "transcript",
    payload: {
      schema: "transcript/v1",
      raw_id: raw,
      title: raw,
      participants: [{ name: "Ola Nordmann", email: "ola@example.org" }],
      ...more,
    },
  });
  const retraction = (at: string, seq: number) => ({
    at,
    source: "manual",
    kind: "retraction",
    payload: { schema: "retraction/v1", supersedes: id(seq), seq, reason: "no" },
  });

  // Since the reference's #321 (0.7.0) a retracted line supersedes nothing, and a line of another
  // kind none: `c`, whose one superseder is retracted, counts again (3 at 7bcf728, 4 at b82a11c).
  it("counts no transcript a standing transcript supersedes; one only a retracted line names counts", () => {
    const root = writeRecord([
      ola, // 1
      transcript("2026-06-02T08:00:00Z", "a"), // 2
      transcript("2026-06-02T08:00:00Z", "a2", { supersedes: id(2) }), // 3
      transcript("2026-06-03T08:00:00Z", "b"), // 4
      transcript("2026-06-04T08:00:00Z", "b2", { supersedes: id(4) }), // 5
      transcript("2026-06-05T08:00:00Z", "c"), // 6
      transcript("2026-06-05T08:01:00Z", "c2", { supersedes: id(6) }), // 7
      retraction("2026-06-05T09:00:00Z", 7), // 8
      {
        at: "2026-06-06T08:00:00Z",
        source: "manual",
        kind: "note",
        payload: { schema: "note/v1", text: "with Ola Nordmann" },
      }, // 9
      transcript("2026-06-06T08:01:00Z", "n2", { supersedes: id(9) }), // 10
    ]);
    const people = readPeople(root, {});
    expect(renderPeople(people, {})).toBe(
      "1 person · 2026-06-01 – 2026-06-06 · tier 2\n  Ola Nordmann  transcripts 4\n",
    );
  });

  it("ends a window over the whole record on the last line, a retraction included", () => {
    const root = writeRecord([
      ola,
      transcript("2026-06-02T08:00:00Z", "a"),
      {
        at: "2026-06-03T08:00:00Z",
        source: "manual",
        kind: "note",
        payload: { schema: "note/v1", text: "x" },
      },
      retraction("2026-06-20T08:00:00Z", 3),
    ]);
    expect(renderPeople(readPeople(root, {}), {}).split("\n")[0]).toBe(
      "1 person · 2026-06-01 – 2026-06-20 · tier 2",
    );
  });

  it("takes no transcript a line supersedes as evidence of a day together", () => {
    // The dinner heard again in tests/fixtures/rfc0037-0038-sample: the reference names the line
    // that supersedes the first as the last real contact and the one line of the day together.
    const root = join(FIXTURES, "rfc0037-0038-sample");
    const ola = readPeople(root, {}).people.find((p) => p.name === "Ola Nordmann");
    expect(ola?.last_real_contact).toEqual({
      day: "2026-10-06",
      via: "meeting",
      line: "01a13fb4-841e-700f-b408-b0fc79a3cf10",
    });
    expect(ola?.lines).toEqual(["01a13fb4-841e-700f-b408-b0fc79a3cf10"]);
  });

  it("reads an attendee by its `ref` alone, as RFC 0009 shapes it: an `email` key beside it names nobody", () => {
    // Run on the reference at 2c3e158 (v1.0.0), and at 6ee01c2 alike: an attendee `{email, name}`
    // with no `ref` is no calendar evidence for the person that address resolves to.
    const event = (raw: string, attendee: Record<string, unknown>) => ({
      at: "2026-06-01T10:00:00Z",
      end: "2026-06-01T10:30:00Z",
      source: "sim-cal",
      kind: "event",
      tier: 1 as const,
      payload: { schema: "event/v1", raw_id: raw, title: "Meet", attendees: [attendee] },
    });
    const root = writeRecord([
      ola,
      event("a", { email: "ola@example.org", name: "Ola" }),
      event("b", { ref: { kind: "email", value: "ola@example.org" } }),
    ]);
    expect(renderPeople(readPeople(root, {}), {})).toBe(
      "1 person · 2026-06-01 – 2026-06-01 · tier 2\n  Ola Nordmann  calendar 1\n",
    );
  });

  it("says `person` for one and `people` for none", () => {
    const root = writeRecord([
      {
        at: "2026-06-02T08:00:00Z",
        source: "manual",
        kind: "note",
        payload: { schema: "note/v1", text: "x" },
      },
    ]);
    expect(renderPeople(readPeople(root, {}), {})).toBe("0 people · 2026-06-02 – 2026-06-02\n");
  });
});
