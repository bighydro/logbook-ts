import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FLAGS_ENV } from "../src/flags.js";
import {
  type Ceiling,
  ceilings,
  crossingEntry,
  dayGate,
  lineCrosses,
  PolicyError,
  SIGNED_WITHIN,
  signedOn,
} from "../src/policy.js";
import { cleanup, tempDir } from "./helpers.js";
import { line } from "./rfc0036-examples.js";

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

const policy = (data: unknown): string => {
  const root = tempDir();
  mkdirSync(join(root, "policy"), { recursive: true });
  writeFileSync(join(root, "policy", "crossing.json"), JSON.stringify(data), "utf-8");
  return root;
};
const on = (): void => {
  vi.stubEnv(FLAGS_ENV, "rfc0036");
};

/** RFC 0036's example policy. */
const EXAMPLE = {
  hermes: { max_tier: 2 },
  mcp: { max_tier: 1, write: ["sign_day", "note_day"], write_window_days: 60 },
  "cloud-model": { max_tier: 2, until: "2026-12-31", signed_within_days: 14 },
};
const TODAY = "2026-10-13";

describe("signed_within_days on a policy entry (RFC 0036): read", () => {
  it("is the key the RFC names", () => {
    expect(SIGNED_WITHIN).toBe("signed_within_days");
  });

  it("is not read with the flag off: the entry is what it was, and a bad value is not looked at", () => {
    vi.stubEnv(FLAGS_ENV, "");
    const entry = crossingEntry(policy(EXAMPLE), "cloud-model", TODAY);
    expect(entry).not.toHaveProperty(SIGNED_WITHIN);
    expect(() =>
      ceilings(policy({ x: { max_tier: 1, signed_within_days: "14" } }), TODAY),
    ).not.toThrow();
  });

  it("is read under the flag: N days, and absent (or null) where the entry does not set it", () => {
    on();
    const root = policy(EXAMPLE);
    const entry = crossingEntry(root, "cloud-model", TODAY);
    expect(entry).toMatchObject({
      max_tier: 2,
      until: "2026-12-31",
      expired: false,
      signed_within_days: 14,
    });
    expect(crossingEntry(root, "hermes", TODAY)).not.toHaveProperty(SIGNED_WITHIN);
    expect(
      crossingEntry(policy({ x: { max_tier: 1, signed_within_days: null } }), "x", TODAY),
    ).not.toHaveProperty(SIGNED_WITHIN);
    expect(ceilings(root, TODAY).map((c) => c.signed_within_days)).toEqual([
      undefined,
      undefined,
      14,
    ]);
  });

  it("refuses a value that is not a positive whole number of days, naming the file and the entry", () => {
    on();
    for (const value of [0, -1, 1.5, "14", true, [14], {}]) {
      const root = policy({ "cloud-model": { max_tier: 2, signed_within_days: value } });
      const run = (): unknown => crossingEntry(root, "cloud-model", TODAY);
      expect(run).toThrow(PolicyError);
      expect(run).toThrow(
        `${join(root, "policy", "crossing.json")}: 'cloud-model' has a signed_within_days that is not a positive whole number of days; write it as 14, or remove the key for no restriction (RFC 0036)`,
      );
    }
  });

  it("refuses a destination the file does not name, as the ceiling does", () => {
    on();
    expect(() => crossingEntry(policy(EXAMPLE), "elsewhere", TODAY)).toThrow(PolicyError);
  });
});

describe("how signed_within_days composes with max_tier and until (RFC 0036): three gates, all of them", () => {
  const entry = (data: Record<string, unknown>, today = TODAY): Ceiling => {
    on();
    return crossingEntry(policy({ x: data }), "x", today);
  };
  const fresh = entry({ max_tier: 2, until: "2026-12-31", signed_within_days: 14 });

  it("a day signed today, or N days ago, crosses; one signed N + 1 days ago does not, nor an unsigned one", () => {
    const at = (day: string | null) =>
      dayGate(fresh, { signedOn: day, today: TODAY, signedOnly: true });
    expect(at("2026-10-13")).toEqual({ header: true, lines: true, held: null });
    expect(at("2026-09-29")).toEqual({ header: true, lines: true, held: null });
    expect(at("2026-09-28")).toEqual({ header: true, lines: false, held: "signed_within_days" });
    expect(at(null)).toEqual({ header: true, lines: false, held: "signed_within_days" });
    // A signature dated after today is not one of the days from N before today through today.
    expect(at("2026-10-14")).toEqual({ header: true, lines: false, held: "signed_within_days" });
  });

  it("--unsigned lifts RFC 0034's default, never the entry's rule", () => {
    const unsigned = (day: string | null) =>
      dayGate(fresh, { signedOn: day, today: TODAY, signedOnly: false });
    expect(unsigned(null)).toEqual({ header: true, lines: false, held: "signed_within_days" });
    expect(unsigned("2026-09-28")).toEqual({
      header: true,
      lines: false,
      held: "signed_within_days",
    });
    expect(unsigned("2026-10-01")).toEqual({ header: true, lines: true, held: null });
  });

  it("absent, there is no restriction: RFC 0034's default, signed days, or every day under --unsigned", () => {
    const plain = entry({ max_tier: 2 });
    expect(dayGate(plain, { signedOn: "2025-01-01", today: TODAY, signedOnly: true })).toEqual({
      header: true,
      lines: true,
      held: null,
    });
    expect(dayGate(plain, { signedOn: null, today: TODAY, signedOnly: true })).toEqual({
      header: true,
      lines: false,
      held: "unsigned",
    });
    expect(dayGate(plain, { signedOn: null, today: TODAY, signedOnly: false })).toEqual({
      header: true,
      lines: true,
      held: null,
    });
  });

  it("past until the entry counts as max_tier 0 and nothing crosses, the header included", () => {
    const expired = entry({ max_tier: 2, until: "2026-10-12", signed_within_days: 14 });
    expect(expired.max_tier).toBe(0);
    const gate = dayGate(expired, { signedOn: TODAY, today: TODAY, signedOnly: false });
    expect(gate).toEqual({ header: false, lines: false, held: "until" });
    expect(lineCrosses(expired, gate, 1)).toBe(false);
  });

  it("max_tier is on the line: the day's signature never lets a line above it cross", () => {
    const gate = dayGate(fresh, { signedOn: TODAY, today: TODAY, signedOnly: true });
    expect([1, 2, 3].map((tier) => lineCrosses(fresh, gate, tier))).toEqual([true, true, false]);
    const held = dayGate(fresh, { signedOn: null, today: TODAY, signedOnly: true });
    expect([1, 2, 3].map((tier) => lineCrosses(fresh, held, tier))).toEqual([false, false, false]);
  });

  it("re-signing a day refreshes it: the standing signature's day is the one that counts", () => {
    const old = line({
      id: "s1",
      at: "2026-08-01T19:00:00Z",
      source: "manual",
      kind: "signed-day",
      tier: 1,
      payload: { schema: "signed-day/v1", day: "2026-07-31" },
    });
    const again = line({ ...old, id: "s2", at: "2026-10-12T21:30:00Z", seq: 999 });
    expect(signedOn(old, "Europe/Oslo")).toBe("2026-08-01");
    // 21:30 UTC is 23:30 in Oslo, the 12th; with 06:00 as the day's start, still the 12th.
    expect(signedOn(again, "Europe/Oslo")).toBe("2026-10-12");
    expect(signedOn(again, "Europe/Oslo", "06:00")).toBe("2026-10-12");
    expect(signedOn(null, "Europe/Oslo")).toBeNull();
    const gate = (s: typeof old) =>
      dayGate(fresh, { signedOn: signedOn(s, "Europe/Oslo"), today: TODAY, signedOnly: true })
        .lines;
    expect([gate(old), gate(again)]).toEqual([false, true]);
  });
});
