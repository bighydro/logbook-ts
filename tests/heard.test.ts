import { afterEach, describe, expect, it, vi } from "vitest";
import { FLAGS_ENV } from "../src/flags.js";
import { HEARD_KIND, HEARD_SCHEMA, heardRow, isHeard } from "../src/heard.js";
import { showDay } from "../src/show.js";
import { HEARD, HEARD_ROWS, heardDay, heardLine, heardWith } from "./heard-cases.js";
import { cleanup, type Draft, writeRecord } from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

/** RFC 0046, `heard/v1` (draft): `show`'s row under the `rfc0046` flag, as the reference prints it at d053f78. */
describe("heard/v1 (RFC 0046, draft): the row show prints, as the reference prints it at d053f78 (run)", () => {
  it("names the kind and the schema", () => {
    expect([HEARD_KIND, HEARD_SCHEMA]).toEqual(["heard", "heard/v1"]);
    const line = { kind: "heard", payload: HEARD } as never;
    expect(isHeard(line)).toBe(true);
    expect(isHeard({ kind: "heard", payload: { ...HEARD, schema: "heard/v2" } } as never)).toBe(
      false,
    );
    expect(isHeard({ kind: "listen", payload: HEARD } as never)).toBe(false);
  });

  it("the work, who made it, where the text came from, its language and its length in words", () => {
    for (const [fields, row] of HEARD_ROWS) {
      expect({ fields, row: heardRow(heardWith(fields)) }).toEqual({ fields, row });
    }
  });
});

describe("show prints a heard/v1 line under the rfc0046 flag, and as before without it", () => {
  const listen: Draft = {
    at: "2026-06-13T06:40:00Z",
    end: "2026-06-13T07:20:00Z",
    source: "apple-podcasts",
    kind: "listen",
    payload: {
      schema: "listen/v1",
      raw_id: "ap:1",
      media: "episode",
      title: "Anchors that hold",
      show: "The Harbour Hour",
      service: "apple-podcasts",
      duration_s: 2400,
      played_s: 2400,
    },
  };
  const location: Draft = {
    at: "2026-06-13T05:30:00Z",
    source: "sim-phone",
    kind: "location",
    tier: 1,
    payload: { schema: "location/v1", lat: 59.911, lon: 10.75, accuracy_m: 12 },
  };
  const heard = heardLine;

  it("the row after the listen it belongs to; another schema of the kind is a kind it does not know", () => {
    const root = writeRecord([
      location,
      listen,
      heard(HEARD),
      heard({ ...HEARD, schema: "heard/v2" }),
    ]);
    vi.stubEnv(FLAGS_ENV, "rfc0046");
    const rows = showDay(root, { day: "2026-06-13" }).text.split("\n");
    expect(rows.slice(0, 4)).toEqual([
      "2026-06-13  unsigned",
      "  07:30  location   sim-phone      1 point",
      "  08:40  listen     apple-podcasts Anchors that hold",
      "  08:40  heard      heard          Anchors that hold — The Harbour Hour · feed · en · 700 words",
    ]);
    expect(rows[4]).not.toContain("700 words");
  });

  it("every payload of the cases, one row each, in the record's order", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0046");
    const rows = showDay(writeRecord(heardDay()), { day: "2026-06-13" }).text.split("\n");
    expect(rows.slice(3, 3 + HEARD_ROWS.length)).toEqual(
      HEARD_ROWS.map(([, row]) => `  08:40  heard      heard          ${row}`),
    );
  });

  it("without the flag the line reads as it did, the generic row", () => {
    const root = writeRecord([location, listen, heard(HEARD)]);
    const on = showDay(root, { day: "2026-06-13" }).text;
    expect(on).toContain("  08:40  heard      heard          Anchors that hold\n");
    expect(on).not.toContain("700 words");
  });
});
