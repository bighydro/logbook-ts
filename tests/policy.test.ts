import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Ceiling,
  ceiling,
  ceilings,
  crossingEntry,
  DEFAULT_CROSSING_POLICY,
  mcpCeiling,
  mcpDoor,
  PolicyError,
  readCrossingPolicy,
  readDisabledSources,
  recipientOf,
  siteCeiling,
  vaultCeiling,
  WRITE_TOOLS,
  WRITE_WINDOW_DAYS,
} from "../src/policy.js";
import { LogbookError } from "../src/store.js";
import { cleanup, tempDir } from "./helpers.js";

afterEach(cleanup);

/** A record folder holding only the policy file given, as the reference's `policy` module reads it. */
function withPolicy(text: string | undefined, file = "crossing.json"): string {
  const root = tempDir();
  if (text !== undefined) {
    mkdirSync(join(root, "policy"), { recursive: true });
    writeFileSync(join(root, "policy", file), text, "utf-8");
  }
  return root;
}

const policy = (data: unknown): string => withPolicy(JSON.stringify(data));
const file = (root: string, name = "crossing.json"): string => join(root, "policy", name);
const TODAY = "2026-10-13";

describe("policy/crossing.json (ADR 0016, ADR 0022): the ceiling per destination", () => {
  it("reads the default when the file does not exist: mcp at 1 and no one else (the reference's #348)", () => {
    const root = withPolicy(undefined);
    expect(readCrossingPolicy(root)).toEqual(DEFAULT_CROSSING_POLICY);
    expect(DEFAULT_CROSSING_POLICY).toEqual({ mcp: { max_tier: 1 } });
    expect(DEFAULT_CROSSING_POLICY).not.toHaveProperty("hermes");
    expect(readCrossingPolicy(root)).not.toHaveProperty("hermes");
    expect(ceilings(root, TODAY).map((c) => c.destination)).toEqual(["mcp"]);
    expect(mcpCeiling(root, TODAY)).toBe(1);
    // A crossing to a destination the record does not name is refused in one sentence naming the
    // entry to add; `hermes` is one the owner writes, like every other.
    const refusal = `${file(root)} names no destination 'hermes' with a max_tier of 1, 2 or 3; add {"hermes": {"max_tier": 1}} to it to allow a crossing`;
    expect(() => ceiling(root, "hermes", TODAY)).toThrow(PolicyError);
    expect(() => ceiling(root, "hermes", TODAY)).toThrow(refusal);
    expect(() => crossingEntry(root, "hermes", TODAY)).toThrow(refusal);
  });

  it("refuses a file that is not JSON or not an object, naming the file", () => {
    const broken = withPolicy("{not json");
    expect(() => readCrossingPolicy(broken)).toThrow(PolicyError);
    expect(() => readCrossingPolicy(broken)).toThrow(`${file(broken)} is not JSON: `);
    const list = withPolicy("[]");
    expect(() => readCrossingPolicy(list)).toThrow(
      `${file(list)} must map destination to {"max_tier": N}`,
    );
    expect(new PolicyError("x")).toBeInstanceOf(LogbookError);
  });

  it("ceilings: every destination in file order, held against today; an entry not of the shape is refused", () => {
    const root = policy({
      hermes: { max_tier: 2 },
      cloud: { max_tier: 2, until: "2026-12-31" },
      old: { max_tier: 3, until: "2026-10-12" },
    });
    const found = ceilings(root, TODAY);
    expect(found.map((c) => c.destination)).toEqual(["hermes", "cloud", "old"]);
    expect(found[1]).toMatchObject({
      written: 2,
      until: "2026-12-31",
      expired: false,
      max_tier: 2,
    });
    expect(found[2]).toMatchObject({ written: 3, until: "2026-10-12", expired: true, max_tier: 0 });
    expect(found[0]).toMatchObject({ until: null, expired: false, write: [], window_days: 60 });
    // A file that names `hermes` keeps it: the default is only for a record without the file.
    expect(found[0]).toMatchObject({ destination: "hermes", written: 2, max_tier: 2 });
    expect(ceiling(root, "hermes", TODAY)).toBe(2);
    // Through its last day it holds; from the next it counts as max_tier 0.
    expect(ceiling(root, "old", "2026-10-12")).toBe(3);
    expect(ceiling(root, "old", "2026-10-13")).toBe(0);
    for (const bad of [{ x: 4 }, { x: { max_tier: 4 } }, { x: { max_tier: "1" } }, { x: null }]) {
      const broken = policy({ hermes: { max_tier: 2 }, ...bad });
      expect(() => ceilings(broken, TODAY)).toThrow(
        `${file(broken)}: 'x' must be {"max_tier": 1, 2 or 3}, with an optional "until" date`,
      );
    }
    const badUntil = policy({ x: { max_tier: 1, until: "soon" } });
    expect(() => ceilings(badUntil, TODAY)).toThrow(
      `${file(badUntil)}: 'x' has an until that is not a date; write it as YYYY-MM-DD, the last day the entry holds`,
    );
  });

  it("ceiling: a destination the file does not name is refused naming the file and what to add", () => {
    const root = policy({ hermes: { max_tier: 2 } });
    expect(() => ceiling(root, "ola", TODAY)).toThrow(
      `${file(root)} names no destination 'ola' with a max_tier of 1, 2 or 3; add {"ola": {"max_tier": 1}} to it to allow a crossing`,
    );
    expect(() => ceiling(policy({ ola: { max_tier: 0 } }), "ola", TODAY)).toThrow(PolicyError);
  });

  it("recipient: the destination's age recipient, or null; anything but an age1… string is refused", () => {
    const root = policy({
      ola: {
        max_tier: 2,
        recipient: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
      },
      kari: { max_tier: 1 },
    });
    expect(recipientOf(root, "ola")).toMatch(/^age1/);
    expect(recipientOf(root, "kari")).toBeNull();
    expect(recipientOf(root, "nobody")).toBeNull();
    const broken = policy({ ola: { max_tier: 2, recipient: "ssh-ed25519 AAAA" } });
    expect(() => recipientOf(broken, "ola")).toThrow(
      `${file(broken)}: 'ola' has a recipient that is not an age1… string`,
    );
  });

  it("mcp, vault and site default to tier 1 when unnamed; named without a tier of 1, 2 or 3 they are refused, never defaulted", () => {
    const root = policy({ hermes: { max_tier: 2 } });
    expect(mcpCeiling(root, TODAY)).toBe(1);
    expect(vaultCeiling(root, TODAY)).toBe(1);
    expect(siteCeiling(root, TODAY)).toBe(1);
    const raised = policy({ mcp: { max_tier: 2 }, vault: { max_tier: 2 }, site: { max_tier: 3 } });
    expect(mcpCeiling(raised, TODAY)).toBe(2);
    expect(vaultCeiling(raised, TODAY)).toBe(2);
    expect(siteCeiling(raised, TODAY)).toBe(3);
    const broken = policy({ mcp: { max_tier: 9 } });
    expect(() => mcpCeiling(broken, TODAY)).toThrow(
      `${file(broken)} names 'mcp' without a max_tier of 1, 2 or 3; make it {"max_tier": 1}`,
    );
    expect(mcpCeiling(policy({ mcp: { max_tier: 2, until: "2026-01-01" } }), TODAY)).toBe(0);
  });
});

describe("the mcp entry's write tools (ADR 0022, RFC 0034 amendment 3): `write` and `write_window_days`", () => {
  it("names the two tools and the default window", () => {
    expect(WRITE_TOOLS).toEqual(["sign_day", "note_day"]);
    expect(WRITE_WINDOW_DAYS).toBe(60);
  });

  it("the door is null without an mcp entry; with one, the tools it names (deduplicated, in order) and its window", () => {
    expect(mcpDoor(policy({ hermes: { max_tier: 2 } }), TODAY)).toBeNull();
    const none = mcpDoor(policy({ mcp: { max_tier: 1 } }), TODAY) as Ceiling;
    expect(none.write).toEqual([]);
    expect(none.writes).toEqual([]);
    expect(none.window_days).toBe(60);
    const door = mcpDoor(
      policy({
        mcp: { max_tier: 1, write: ["note_day", "sign_day", "note_day"], write_window_days: 7 },
      }),
      TODAY,
    ) as Ceiling;
    expect(door.write).toEqual(["note_day", "sign_day"]);
    expect(door.writes).toEqual(["note_day", "sign_day"]);
    expect(door.window_days).toBe(7);
    expect(door.max_tier).toBe(1);
    // A window of zero days is today only, and allowed.
    expect(
      (mcpDoor(policy({ mcp: { max_tier: 1, write_window_days: 0 } }), TODAY) as Ceiling)
        .window_days,
    ).toBe(0);
  });

  it("an expired entry allows no write tool, whatever it names; the file still says what it wrote", () => {
    const door = mcpDoor(
      policy({ mcp: { max_tier: 2, write: ["sign_day"], until: "2026-10-12" } }),
      TODAY,
    ) as Ceiling;
    expect(door.expired).toBe(true);
    expect(door.until).toBe("2026-10-12");
    expect(door.write).toEqual(["sign_day"]);
    expect(door.writes).toEqual([]);
    expect(door.max_tier).toBe(0);
  });

  it("refuses a write that is not a list of the two tools, and a window that is not a whole number of days, naming the file", () => {
    for (const write of ["sign_day", ["sign_day", "add_note"], [1], {}]) {
      const broken = policy({ mcp: { max_tier: 1, write } });
      expect(() => mcpDoor(broken, TODAY)).toThrow(
        `${file(broken)}: 'mcp' has a write that is not a list of write tools; the tools it may name are sign_day, note_day`,
      );
      // ceilings reads every entry's keys the same way.
      expect(() => ceilings(broken, TODAY)).toThrow(PolicyError);
    }
    for (const window of [-1, 1.5, "60", true, null]) {
      const broken = policy({ mcp: { max_tier: 1, write_window_days: window } });
      expect(() => mcpDoor(broken, TODAY)).toThrow(
        `${file(broken)}: 'mcp' has a write_window_days that is not a whole number of days`,
      );
    }
    const unnamedTier = policy({ mcp: { write: ["sign_day"] } });
    expect(() => mcpDoor(unnamedTier, TODAY)).toThrow(
      `${file(unnamedTier)} names 'mcp' without a max_tier of 1, 2 or 3; make it {"max_tier": 1}`,
    );
    // The keys are the mcp entry's; another destination carrying them is read the same way.
    expect(
      ceilings(policy({ hermes: { max_tier: 2, write: ["sign_day"] } }), TODAY)[0]?.writes,
    ).toEqual(["sign_day"]);
  });
});

describe("policy/import.json: the sources the owner switched off", () => {
  it("reads the default when the file is missing, and the file's entries as {source: reason}", () => {
    const root = withPolicy(undefined);
    expect(readDisabledSources(root)).toEqual({
      "google-takeout-access-log": "every sign-in to every Google service; opt in",
      "google-takeout-activity": "every search and app opened; opt in",
    });
    const own = withPolicy(
      JSON.stringify({ disabled: [{ source: "ais", reason: "the boat is ashore" }] }),
      "import.json",
    );
    expect(readDisabledSources(own)).toEqual({ ais: "the boat is ashore" });
    expect(
      readDisabledSources(withPolicy(JSON.stringify({ disabled: [] }), "import.json")),
    ).toEqual({});
  });

  it("refuses a file that is not the documented shape, naming it", () => {
    const shape = (root: string) =>
      `${file(root, "import.json")} must be {"disabled": [{"source": "<adapter>", "reason": "<why>"}, ...]}`;
    for (const bad of [
      "[]",
      '{"disabled": {}}',
      '{"disabled": ["ais"]}',
      '{"disabled": [{"source": "ais"}]}',
      '{"disabled": [{"source": 1, "reason": "x"}]}',
    ]) {
      const broken = withPolicy(bad, "import.json");
      expect(() => readDisabledSources(broken)).toThrow(shape(broken));
    }
    const notJson = withPolicy("{", "import.json");
    expect(() => readDisabledSources(notJson)).toThrow(
      `${file(notJson, "import.json")} is not JSON: `,
    );
  });
});
