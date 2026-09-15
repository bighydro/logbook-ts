import { describe, expect, it } from "vitest";
import { contentHash, contentOf, hashLine, lineHash, sha256Hex, ZERO_HASH } from "../src/chain.js";
import type { Line } from "../src/types.js";

// Line 1 of conformance/sample-logbook (synthetic: nobody lives in it).
const line1: Line = {
  at: "2026-03-01T07:30:00Z",
  end: null,
  hash: "129e6cdc3c98f97eae42656b74fd86c1802f9a0db5ee97d44b94e9dd4719b78d",
  id: "00000000-0000-4000-8000-000000000001",
  kind: "location",
  payload: {
    accuracy_m: 12,
    alt_m: 120.0,
    lat: 59.911,
    lon: 10.75,
    schema: "location/v1",
    speed_mps: 0.0,
  },
  prev: ZERO_HASH,
  recorded_at: "2026-03-08T20:00:00Z",
  seq: 1,
  source: "sim-phone",
  tier: 1,
  tz: "Europe/Oslo",
};

describe("chain", () => {
  it("ZERO_HASH is sixty-four zeros", () => {
    expect(ZERO_HASH).toBe("0".repeat(64));
  });

  it("sha256Hex hashes the UTF-8 bytes of a string", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("ø")).toBe(sha256Hex(Buffer.from([0xc3, 0xb8]).toString("utf8")));
  });

  it("contentOf picks exactly the seven content fields (SPEC §3)", () => {
    expect(Object.keys(contentOf(line1)).sort()).toEqual(
      ["at", "end", "kind", "payload", "source", "tier", "tz"].sort(),
    );
  });

  it("contentOf treats a missing `end` as null", () => {
    const { end: _end, ...withoutEnd } = line1;
    expect(contentOf(withoutEnd as Line).end).toBeNull();
  });

  it("recomputes the first sample line's hash from prev|seq|sha256(content)|recorded_at", () => {
    const ch = contentHash(contentOf(line1));
    expect(lineHash(ZERO_HASH, 1, ch, "2026-03-08T20:00:00Z")).toBe(line1.hash);
    expect(hashLine(line1)).toBe(line1.hash);
  });

  it("changes when any hashed input changes", () => {
    expect(hashLine({ ...line1, seq: 2 })).not.toBe(line1.hash);
    expect(hashLine({ ...line1, recorded_at: "2026-03-08T20:00:01Z" })).not.toBe(line1.hash);
    expect(hashLine({ ...line1, payload: { ...line1.payload, alt_m: 121 } })).not.toBe(line1.hash);
    expect(hashLine({ ...line1, prev: "1".repeat(64) })).not.toBe(line1.hash);
  });

  it("does not change when id (outside the hash) or an unknown top-level field changes", () => {
    expect(hashLine({ ...line1, id: "00000000-0000-4000-8000-0000000000ff" })).toBe(line1.hash);
    expect(hashLine({ ...line1, extra: "ignored" } as Line)).toBe(line1.hash);
  });
});
