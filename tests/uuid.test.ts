import { describe, expect, it } from "vitest";
import { uuidV7 } from "../src/uuid.js";

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidV7", () => {
  it("has version 7 and the RFC 9562 variant, in lowercase hex", () => {
    for (let i = 0; i < 50; i++) expect(uuidV7()).toMatch(V7);
  });

  it("encodes the millisecond timestamp in the first 48 bits", () => {
    const at = new Date("2026-03-08T20:00:00.123Z");
    const id = uuidV7(at);
    const ms = Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
    expect(ms).toBe(at.getTime());
  });

  it("is unique across many calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(uuidV7());
    expect(seen.size).toBe(1000);
  });

  it("sorts by time", () => {
    const a = uuidV7(new Date("2026-01-01T00:00:00Z"));
    const b = uuidV7(new Date("2026-01-01T00:00:01Z"));
    expect(a < b).toBe(true);
  });
});
