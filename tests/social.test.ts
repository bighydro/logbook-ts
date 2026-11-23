import { afterEach, describe, expect, it, vi } from "vitest";
import { FLAGS_ENV } from "../src/flags.js";
import { readPeople } from "../src/people.js";
import { showDay } from "../src/show.js";
import { socialRow } from "../src/social.js";
import { cleanup, writeBareRecord } from "./helpers.js";
import { DAY, SOCIAL_CASES, socialLines, socialPayload } from "./social-cases.js";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("social/v1 (RFC 0048): show's row, as the reference prints it at 55c6fbd (its #440, run)", () => {
  it("every case of tests/social-cases.ts", () => {
    for (const [name, changes, expected] of SOCIAL_CASES) {
      expect({ name, row: socialRow(socialPayload(changes) as never) }).toEqual({
        name,
        row: expected,
      });
    }
  });

  it("show prints the rows under the rfc0048 flag, in the cases' order, and as a kind it does not know without it", () => {
    const root = writeBareRecord(socialLines());
    vi.stubEnv(FLAGS_ENV, "rfc0048");
    const rows = showDay(root, { day: DAY })
      .text.split("\n")
      .filter((row) => row.includes("  social     instagram      "))
      .map((row) => row.slice("  08:00  social     instagram      ".length));
    expect(rows.slice(0, SOCIAL_CASES.length)).toEqual(SOCIAL_CASES.map(([, , row]) => row));
    // social/v2 is not this profile: its fields, as any kind not known.
    expect(rows.at(-1)).toMatch(/^action=follow, counterpart=/);
    vi.stubEnv(FLAGS_ENV, "");
    const off = showDay(root, { day: DAY }).text;
    expect(off).not.toContain("followed by @ola.example");
    expect(off).toContain(
      "action=followed_by, counterpart={'kind': 'handle', 'value': 'instagram:ola.example'}",
    );
  });

  it("a handle resolved to a person makes no act of it company: people lists no one", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0048");
    expect(readPeople(writeBareRecord(socialLines()), {}).people).toEqual([]);
  });
});
