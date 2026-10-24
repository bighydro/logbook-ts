import { afterEach, describe, expect, it, vi } from "vitest";
import { FLAGS_ENV } from "../src/flags.js";
import { heardRow } from "../src/heard.js";
import { showDay } from "../src/show.js";
import { HEARD_CASES, heardLines, heardPayload } from "./heard-cases.js";
import { cleanup, writeBareRecord } from "./helpers.js";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("heard/v1 (RFC 0046): show's row, as the reference prints it at a6ee131 (its #355, run)", () => {
  it("every case of tests/heard-cases.ts", () => {
    for (const [name, changes, expected] of HEARD_CASES) {
      expect({ name, row: heardRow(heardPayload(changes) as never) }).toEqual({
        name,
        row: expected,
      });
    }
  });

  it("show prints it under the rfc0046 flag, and as a kind it does not know without it", () => {
    const root = writeBareRecord(heardLines());
    vi.stubEnv(FLAGS_ENV, "rfc0046");
    const on = showDay(root, { day: "2026-10-03" }).text;
    expect(on).toContain(
      "  08:00  heard      heard          Episode 12: the east berth — Havnepodden · feed · nb · 7,012 words\n",
    );
    vi.stubEnv(FLAGS_ENV, "");
    const off = showDay(root, { day: "2026-10-03" }).text;
    expect(off).not.toContain("7,012 words");
  });
});
