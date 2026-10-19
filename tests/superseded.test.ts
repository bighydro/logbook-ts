import { afterEach, describe, expect, it, vi } from "vitest";
import { readDay } from "../src/day.js";
import { renderDay } from "../src/dayText.js";
import { FLAGS_ENV } from "../src/flags.js";
import { readPeople, renderPeople } from "../src/people.js";
import { buildResolver } from "../src/resolve.js";
import { showDay } from "../src/show.js";
import type { Line } from "../src/types.js";
import { cleanup, writeRecord } from "./helpers.js";
import {
  dayRows,
  FLIGHT_CASES,
  lineId,
  PEOPLE_CASES,
  type SupersededCase,
  TRANSCRIPT_CASES,
} from "./superseded-cases.js";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

/**
 * A line is superseded while at least one line of its kind that is not retracted supersedes it
 * (the reference's issue #321, decided 18 October 2026). Every expected value below is the
 * reference's output at b82a11c (0.7.0) on the same record, read by running it.
 */
describe("a line superseded twice: any superseder that is not retracted", () => {
  const check = (c: SupersededCase): void => {
    const root = writeRecord(c.lines);
    expect(showDay(root, { day: c.day }).text).toBe(c.show);
    expect(dayRows(renderDay(readDay(root, { day: c.day })))).toEqual(c.rows);
  };

  for (const c of TRANSCRIPT_CASES) {
    it(`transcripts: ${c.name}`, () => {
      vi.stubEnv(FLAGS_ENV, "rfc0038");
      check(c);
    });
  }

  for (const c of FLIGHT_CASES) {
    it(`flights: ${c.name}`, () => check(c));
  }

  for (const c of PEOPLE_CASES) {
    it(`people: ${c.name}`, () => {
      const root = writeRecord(c.lines);
      expect(renderPeople(readPeople(root, {}), {})).toBe(c.people);
    });
  }
});

describe("buildResolver: a retracted resolution supersedes nothing", () => {
  const email = { kind: "email", value: "ola@example.org" };
  const resolution = (seq: number, label: string, supersedes?: number): Line =>
    ({
      id: lineId(seq),
      seq,
      kind: "resolution",
      payload: {
        schema: "resolution/v1",
        ref: email,
        entity: { type: "person", id: "019cadd3-6bc0-7dcd-9133-000000000301" },
        label,
        ...(supersedes === undefined ? {} : { supersedes: lineId(supersedes) }),
      },
    }) as unknown as Line;
  const retract = (seq: number, target: number): Line =>
    ({
      id: lineId(seq),
      seq,
      kind: "retraction",
      payload: { schema: "retraction/v1", supersedes: lineId(target) },
    }) as unknown as Line;

  it("stands the first again when every line that superseded it is retracted", () => {
    const r = buildResolver([
      resolution(1, "Ola Nordmann"),
      resolution(2, "Ola N", 1),
      resolution(3, "O. Nordmann", 1),
      retract(4, 2),
      retract(5, 3),
    ]);
    expect(r.name(email)).toBe("Ola Nordmann");
  });

  it("keeps the first superseded while one superseder stands, and a superseded superseder still supersedes", () => {
    expect(
      buildResolver([
        resolution(1, "Ola Nordmann"),
        resolution(2, "Ola N", 1),
        resolution(3, "O. Nordmann", 1),
        retract(4, 3),
      ]).name(email),
    ).toBe("Ola N");
    expect(
      buildResolver([
        resolution(1, "Ola Nordmann"),
        resolution(2, "Ola N", 1),
        resolution(3, "O. Nordmann", 2),
        retract(4, 3),
      ]).name(email),
    ).toBe("Ola N");
  });
});
