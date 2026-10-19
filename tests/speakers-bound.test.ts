import { afterEach, describe, expect, it, vi } from "vitest";
import { readDay } from "../src/day.js";
import { renderDay } from "../src/dayText.js";
import { FLAGS_ENV } from "../src/flags.js";
import { readPeople, renderPeople } from "../src/people.js";
import { cleanup } from "./helpers.js";
import { observed, SPEAKER_CASES, type SpeakerCase, speakerRecord } from "./speakers-cases.js";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

/**
 * Who spoke, as the reference reads it at b82a11c (0.7.0) under RFC 0038 §3: every expected value is
 * the reference's output on the same record (tests/speakers-cases.ts).
 */
describe("a transcript's voices bound to people (RFC 0038 §3), under the rfc0038 flag", () => {
  for (const c of SPEAKER_CASES) {
    it(c.name, () => {
      vi.stubEnv(FLAGS_ENV, "rfc0038");
      const root = speakerRecord(c);
      const day = readDay(root, { day: "2026-10-03" });
      const people = readPeople(root, {});
      expect(observed(renderDay(day), day, renderPeople(people, {}), people as never)).toEqual(
        c.expected,
      );
    });
  }

  it("binds nothing with the flag off: a voice reads as the source gave it", () => {
    const c = SPEAKER_CASES[0] as SpeakerCase;
    const root = speakerRecord(c);
    const text = renderDay(readDay(root, { day: "2026-10-03" }));
    expect(text).toContain("unplaced      19:00  transcript Middag\n");
    expect(renderPeople(readPeople(root, {}), {}).split("\n")[0]).toBe(
      "0 people · 2026-10-01 – 2026-10-04",
    );
  });
});
