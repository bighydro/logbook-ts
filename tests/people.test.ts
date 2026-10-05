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
  });

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
