import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashLine, sha256Hex } from "../src/chain.js";
import { readDay } from "../src/day.js";
import { renderDay } from "../src/dayText.js";
import { showDay } from "../src/show.js";
import {
  countsText,
  DISPOSITIONS,
  dispositionsOf,
  mark,
  pageDigest,
  pageOf,
  SIGNED_DAY_KIND,
  SIGNED_DAY_SCHEMA,
  signedDayProblems,
  signedDayRow,
  signedState,
  signedStateText,
  standingSignatures,
} from "../src/signing.js";
import { verifyLogbook } from "../src/store.js";
import type { JsonValue, Line } from "../src/types.js";
import {
  cleanup,
  copySample,
  EXPECTED,
  EXPECTED_SEALED,
  FIXTURES,
  readLines,
  SAMPLE,
  SAMPLE_SEALED,
  writeLines,
  writeRecord,
} from "./helpers.js";

afterEach(cleanup);

const OWNER = "00000000-0000-4000-8000-000000000001";
const sampleLines = (root = SAMPLE): Line[] =>
  readLines(root).map((row) => JSON.parse(row) as Line);
const signature = (root = SAMPLE): Line => sampleLines(root)[31] as Line;

/** A synthetic `signed-day/v1` payload, shaped as RFC 0034 gives it; every field is overridable. */
const payload = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: SIGNED_DAY_SCHEMA,
  day: "2026-03-01",
  subject: OWNER,
  confirmed: ["00000000-0000-4000-8000-000000000001"],
  page: { sha256: "ab".repeat(32), lines: 1 },
  ...extra,
});

const line = (overrides: Partial<Line> = {}, extra: Record<string, unknown> = {}): Line => ({
  id: "00000000-0000-4000-8000-000000000099",
  seq: 99,
  at: "2026-03-08T19:30:00Z",
  end: null,
  tz: "Europe/Oslo",
  source: "manual",
  kind: SIGNED_DAY_KIND,
  tier: 1,
  payload: payload(extra) as Line["payload"],
  recorded_at: "2026-03-08T20:00:00Z",
  prev: "0".repeat(64),
  hash: "0".repeat(64),
  ...overrides,
});

describe("the conformance samples at RFC 0034 (32 lines)", () => {
  it("Level 1 verifies to the head in expected.json", () => {
    const result = verifyLogbook(SAMPLE);
    expect(result.errors).toEqual([]);
    expect(result.lines).toBe(32);
    expect(result.head).toBe("58bfa9e704e3388d44d74e63f1d84765d24df79e92fce3b522fbef53b765d3df");
    expect(EXPECTED).toEqual({ format: "logbook/0.2", seq: 32, head: result.head });
  });

  it("Level 2, the sealed sample, verifies keyless to the head in expected-sealed.json", () => {
    const result = verifyLogbook(SAMPLE_SEALED);
    expect(result.errors).toEqual([]);
    expect(result.lines).toBe(32);
    expect(result.head).toBe("0ab4c3e79bacc9a7c19d074094e81d1674fdf6967ceaf0d1711679e3c11481db");
    expect(EXPECTED_SEALED).toEqual({ format: "logbook/0.3", seq: 32, head: result.head });
  });

  it("the 32nd line of each is the signed-day/v1 line of the first day, a valid signature by the owner", () => {
    for (const root of [SAMPLE, SAMPLE_SEALED]) {
      const found = signature(root);
      expect(found.kind).toBe("signed-day");
      expect(found.tier).toBe(1);
      expect(found.source).toBe("manual");
      expect(found.payload.schema).toBe("signed-day/v1");
      expect(found.payload.day).toBe("2026-03-01");
      expect(signedDayProblems(found, OWNER)).toEqual([]);
    }
  });
});

describe("the page digest (RFC 0034 'The page as shown')", () => {
  it("is sha256(canonical_json({day, tz, lines: [the hashes]})) and reproduces the Level 1 line's byte for byte", () => {
    const lines = sampleLines();
    const page = pageOf(lines, "2026-03-01", "Europe/Oslo");
    expect(page.map((l) => l.id)).toEqual(signature().payload.confirmed);
    expect(page).toHaveLength(7);
    const digest = pageDigest(
      "2026-03-01",
      "Europe/Oslo",
      page.map((l) => l.hash),
    );
    expect(digest).toBe("8daf3f025fdbf8fb238085edfe9c635e7caccc27fd1c09eef3fc7363f9091767");
    expect(digest).toBe((signature().payload.page as { sha256: string }).sha256);
  });

  it("reproduces the sealed sample's digest too: a sealed line's hash is of its reference, so the digests differ", () => {
    const lines = sampleLines(SAMPLE_SEALED);
    const page = pageOf(lines, "2026-03-01", "Europe/Oslo");
    const digest = pageDigest(
      "2026-03-01",
      "Europe/Oslo",
      page.map((l) => l.hash),
    );
    expect(digest).toBe("5ff214bf6ca140f5038c65c4df8ab6312f8abd8d9f897887b1df504b9f3de5a3");
    expect(digest).toBe((signature(SAMPLE_SEALED).payload.page as { sha256: string }).sha256);
  });

  it("is over the line hashes in the day's order (instant, then seq), the day and the zone", () => {
    // An empty page digests too: the owner may sign that an empty day was empty.
    expect(pageDigest("2026-03-01", "Europe/Oslo", [])).toBe(
      sha256Hex('{"day":"2026-03-01","lines":[],"tz":"Europe/Oslo"}'),
    );
    const a = pageDigest("2026-03-01", "Europe/Oslo", ["a".repeat(64), "b".repeat(64)]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(pageDigest("2026-03-01", "Europe/Oslo", ["b".repeat(64), "a".repeat(64)])).not.toBe(a);
    expect(pageDigest("2026-03-02", "Europe/Oslo", ["a".repeat(64), "b".repeat(64)])).not.toBe(a);
    expect(pageDigest("2026-03-01", "UTC", ["a".repeat(64), "b".repeat(64)])).not.toBe(a);
  });

  it("leaves retractions and signatures off the page, keeps a retracted line on it, and orders by instant then seq", () => {
    const lines = sampleLines();
    const retraction = line(
      {
        id: "00000000-0000-4000-8000-000000000098",
        seq: 98,
        kind: "retraction",
        at: "2026-03-01T12:00:00Z",
      },
      { schema: "retraction/v1", seq: 2, reason: "test" },
    );
    const page = pageOf([signature(), retraction, ...lines], "2026-03-01", "Europe/Oslo");
    expect(page.every((l) => l.kind !== "retraction" && l.kind !== "signed-day")).toBe(true);
    expect(page.map((l) => l.seq)).toEqual([1, 2, 3, 4, 31, 5, 6]);
  });
});

describe("what makes a line a signature (RFC 0034 'The line' and 'Payload')", () => {
  it("accepts the RFC's example shape, with or without note and supersedes", () => {
    expect(signedDayProblems(line(), OWNER)).toEqual([]);
    expect(
      signedDayProblems(
        line({}, { note: "A quiet Sunday.", supersedes: "00000000-0000-4000-8000-000000000050" }),
        OWNER,
      ),
    ).toEqual([]);
    expect(signedDayProblems(line({}, { confirmed: [] }), OWNER)).toEqual([]);
  });

  it("names each rule broken: kind, tier, source, end, schema, day, subject, confirmed, page, note, supersedes", () => {
    const broken = (problems: string[], pattern: RegExp) =>
      expect(problems.join("\n")).toMatch(pattern);
    broken(signedDayProblems(line({ kind: "note" }), OWNER), /kind must be signed-day/);
    broken(signedDayProblems(line({ tier: 2 }), OWNER), /tier must be 1/);
    broken(signedDayProblems(line({ source: "agent" }), OWNER), /source must be manual/);
    broken(signedDayProblems(line({ end: "2026-03-08T20:00:00Z" }), OWNER), /end must be null/);
    broken(
      signedDayProblems(line({}, { schema: "signed-day/v2" }), OWNER),
      /schema must be signed-day\/v1/,
    );
    broken(signedDayProblems(line({}, { day: "2026-3-1" }), OWNER), /day must be YYYY-MM-DD/);
    broken(signedDayProblems(line({}, { day: "2026-02-30" }), OWNER), /day must be YYYY-MM-DD/);
    broken(
      signedDayProblems(line({}, { subject: "00000000-0000-4000-8000-000000000002" }), OWNER),
      /subject .* owner/,
    );
    broken(
      signedDayProblems(line({}, { confirmed: "x" }), OWNER),
      /confirmed must be an array of line ids/,
    );
    broken(
      signedDayProblems(line({}, { confirmed: [1] }), OWNER),
      /confirmed must be an array of line ids/,
    );
    broken(
      signedDayProblems(line({}, { page: { sha256: "xyz", lines: 1 } }), OWNER),
      /page\.sha256 must be 64 hex digits/,
    );
    broken(
      signedDayProblems(line({}, { page: { sha256: "ab".repeat(32), lines: -1 } }), OWNER),
      /page\.lines must be an integer/,
    );
    broken(
      signedDayProblems(line({}, { page: { sha256: "ab".repeat(32), lines: 0.5 } }), OWNER),
      /page\.lines must be an integer/,
    );
    broken(signedDayProblems(line({}, { page: null }), OWNER), /page must be an object/);
    broken(signedDayProblems(line({}, { note: "two\nlines" }), OWNER), /note must be one line/);
    broken(signedDayProblems(line({}, { note: 7 }), OWNER), /note must be one line/);
    broken(signedDayProblems(line({}, { supersedes: 7 }), OWNER), /supersedes must be a line id/);
    expect(signedDayProblems(line({}, { confirmed: ["a", "a"] }), OWNER).join("\n")).toMatch(
      /confirmed .* once/,
    );
    // Every rule at once: one problem per rule, none swallowed by another.
    const all = signedDayProblems(
      line(
        { kind: "x", tier: 3, source: "s", end: "e" },
        { schema: "y", day: 1, subject: 2, confirmed: 3, page: 4 },
      ),
      OWNER,
    );
    expect(all).toHaveLength(9);
  });

  it("confirms the page: a confirmed id must be on the page when the page is known, and the count must be the page's", () => {
    const lines = sampleLines();
    const page = pageOf(lines, "2026-03-01", "Europe/Oslo");
    expect(signedDayProblems(signature(), OWNER, page)).toEqual([]);
    const stranger = line(
      {},
      { ...signature().payload, confirmed: ["00000000-0000-4000-8000-000000000020"] },
    );
    expect(signedDayProblems(stranger, OWNER, page).join("\n")).toMatch(/not on the page/);
    const miscounted = line(
      {},
      { ...signature().payload, page: { sha256: "ab".repeat(32), lines: 6 } },
    );
    expect(signedDayProblems(miscounted, OWNER, page).join("\n")).toMatch(/page\.lines .* 7/);
  });
});

describe("the standing signature of a day (RFC 0034 rule 3)", () => {
  const sign = (
    seq: number,
    day: string,
    extra: Record<string, unknown> = {},
    overrides: Partial<Line> = {},
  ): Line =>
    line(
      {
        id: `00000000-0000-4000-8000-0000000000${String(seq).padStart(2, "0")}`,
        seq,
        ...overrides,
      },
      { day, ...extra },
    );

  it("is the latest signed-day/v1 line by seq naming the day, by the owner, not retracted", () => {
    const first = sign(40, "2026-03-01");
    const second = sign(41, "2026-03-01", { supersedes: first.id });
    const other = sign(42, "2026-03-02");
    const stranger = sign(43, "2026-03-02", { subject: "00000000-0000-4000-8000-000000000002" });
    const wrongSchema = sign(44, "2026-03-02", { schema: "signed-day/v2" });
    const standing = standingSignatures(
      [second, first, other, stranger, wrongSchema],
      new Set(),
      OWNER,
    );
    expect([...standing.keys()].sort()).toEqual(["2026-03-01", "2026-03-02"]);
    expect(standing.get("2026-03-01")?.seq).toBe(41);
    expect(standing.get("2026-03-02")?.seq).toBe(42);
  });

  it("a retracted later signature leaves the earlier standing; a day with none is unsigned", () => {
    const first = sign(40, "2026-03-01");
    const second = sign(41, "2026-03-01", { supersedes: first.id });
    const standing = standingSignatures([first, second], new Set([second.id]), OWNER);
    expect(standing.get("2026-03-01")?.seq).toBe(40);
    expect(standingSignatures([first, second], new Set([first.id, second.id]), OWNER).size).toBe(0);
    expect(signedStateText(null)).toBe("unsigned");
  });

  it("reads as `signed <local day and minute>`, with `, the page has changed since` when the page no longer digests to what was signed", () => {
    const lines = sampleLines();
    const page = pageOf(lines, "2026-03-01", "Europe/Oslo");
    const state = signedState(signature(), "Europe/Oslo", page, "2026-03-01");
    expect(state).toEqual({
      at: "2026-03-08T19:30:00Z",
      at_local: "2026-03-08T20:30:00+01:00",
      line: "00000000-0000-4000-8000-000000000032",
      seq: 32,
      confirmed: 7,
      lines: 7,
      page_sha256: "8daf3f025fdbf8fb238085edfe9c635e7caccc27fd1c09eef3fc7363f9091767",
      page_matches: true,
      note: "A quiet Sunday. Ines came for coffee.",
      supersedes: null,
      dispositions: {},
    });
    expect(signedStateText(state)).toBe("signed 2026-03-08 20:30");
    const grown = signedState(signature(), "Europe/Oslo", page.slice(1), "2026-03-01");
    expect(grown?.page_matches).toBe(false);
    expect(signedStateText(grown)).toBe("signed 2026-03-08 20:30, the page has changed since");
    // A gated reader that cannot see the whole page says nothing about it.
    expect(
      signedState(signature(), "Europe/Oslo", undefined, "2026-03-01")?.page_matches,
    ).toBeNull();
  });
});

describe("a re-sign (RFC 0034 amendment 4, 2026-10-18): the readers read what the standing signature confirmed, nothing merged", () => {
  // Amendment 4 is the writer's: a re-sign without --confirm writes the standing signature's
  // confirmations still on the page and not retracted, its dispositions and its note. A reader reads
  // the line it wrote, as it reads any signature: the standing one's confirmed set and nothing of the
  // one it supersedes (tests/cross-impl.test.ts has the reference write both).
  const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const sign = (seq: number, extra: Record<string, unknown>): Line =>
    line({ id: id(seq), seq }, { day: "2026-03-01", ...extra });

  it("reads the confirmations it kept, a line retracted since dropped, a disposition and the note kept", () => {
    const first = sign(40, {
      confirmed: [id(1), id(2), id(3)],
      page: { sha256: "ab".repeat(32), lines: 3 },
      dispositions: { [id(2)]: "kept" },
      note: "første",
    });
    // Line 1 retracted since, line 4 added since: kept are 2 and 3, line 4 stays unconfirmed.
    const again = sign(41, {
      confirmed: [id(2), id(3)],
      page: { sha256: "cd".repeat(32), lines: 3 },
      dispositions: { [id(2)]: "kept" },
      note: "første",
      supersedes: first.id,
    });
    const standing = standingSignatures([first, again], new Set([id(1)]), OWNER).get("2026-03-01");
    expect(standing?.seq).toBe(41);
    const state = signedState(standing, "Europe/Oslo", undefined, "2026-03-01");
    expect(state).toMatchObject({
      confirmed: 2,
      lines: 3,
      note: "første",
      supersedes: first.id,
      dispositions: { [id(2)]: "kept" },
    });
    expect(signedDayRow(again.payload)).toBe(
      "signed 2026-03-01: 2 lines confirmed of 3 · kept 1 · første",
    );
  });

  it("reads a re-sign that clears the note, and one that confirms the whole page, as written", () => {
    const first = sign(40, { confirmed: [id(1)], note: "første" });
    const cleared = sign(41, { confirmed: [id(1)], supersedes: first.id });
    const all = sign(42, {
      confirmed: [id(1), id(2), id(3)],
      page: { sha256: "ef".repeat(32), lines: 3 },
      supersedes: cleared.id,
    });
    const states = [cleared, all].map((s) =>
      signedState(
        standingSignatures([first, s], new Set(), OWNER).get("2026-03-01"),
        "Europe/Oslo",
        undefined,
        "2026-03-01",
      ),
    );
    expect(states.map((s) => [s?.confirmed, s?.note])).toEqual([
      [1, null],
      [3, null],
    ]);
  });
});

describe("show and day say whether the day is signed (RFC 0034 rule 6)", () => {
  it("show prints `signed <when>` on the sample's first day, `unsigned` on the others, and lists the signature on its own day", () => {
    const first = showDay(SAMPLE, { day: "2026-03-01" });
    expect(first.text.split("\n")[0]).toBe("2026-03-01  signed 2026-03-08 20:30");
    expect(first.detail.signed?.seq).toBe(32);
    const last = showDay(SAMPLE, { day: "2026-03-08" });
    expect(last.text.split("\n")[0]).toBe("2026-03-08  unsigned");
    expect(last.detail.signed).toBeNull();
    expect(last.text).toContain(
      "  20:30  signed-day manual         signed 2026-03-01: 7 lines confirmed of 7 · A quiet Sunday. Ines came for coffee.\n",
    );
    expect(showDay(SAMPLE, { day: "2026-03-09" }).text).toBe("2026-03-09: nothing logged\n");
  });

  it("show says the page has changed when a line is appended with an `at` on the signed day", () => {
    const root = copySample();
    const lines = readLines(root);
    const last = JSON.parse(lines[lines.length - 1] as string) as Line;
    const grown: Line = {
      ...line({
        id: "00000000-0000-4000-8000-000000000033",
        seq: 33,
        at: "2026-03-01T15:00:00Z",
        kind: "note",
        tier: 2,
        prev: last.hash,
      }),
      payload: { schema: "note/v1", text: "Added after the signature." },
    };
    grown.hash = hashLine(grown);
    writeLines(root, [...lines, JSON.stringify(grown)]);
    const shown = showDay(root, { day: "2026-03-01" });
    expect(shown.text.split("\n")[0]).toBe(
      "2026-03-01  signed 2026-03-08 20:30, the page has changed since",
    );
    expect(shown.detail.signed?.page_matches).toBe(false);
  });

  it("show keeps the whole page for the digest when --profile filters the rows", () => {
    const shown = showDay(SAMPLE, { day: "2026-03-01", profiles: ["note"] });
    expect(shown.text.split("\n")[0]).toBe("2026-03-01  signed 2026-03-08 20:30");
    expect(shown.rows).toBe(1);
  });

  it("day prints the state after the weekday and carries it under `signed`", () => {
    const first = readDay(SAMPLE, { day: "2026-03-01" });
    expect(renderDay(first).split("\n")[0]).toBe("2026-03-01  Sunday · signed 2026-03-08 20:30");
    expect(first.signed).toMatchObject({ seq: 32, confirmed: 7, lines: 7, page_matches: true });
    const last = readDay(SAMPLE, { day: "2026-03-08" });
    expect(renderDay(last).split("\n")[0]).toBe("2026-03-08  Sunday · unsigned");
    expect(last.signed).toBeNull();
  });

  it("ignores a signature whose subject is not the record's owner", () => {
    const root = writeRecord([
      {
        at: "2026-05-01T10:00:00Z",
        source: "manual",
        kind: "note",
        tier: 2,
        payload: { schema: "note/v1", text: "a day" },
      },
      {
        at: "2026-05-02T10:00:00Z",
        source: "manual",
        kind: "signed-day",
        tier: 1,
        // writeRecord's owner is …0002; this signature is somebody else's.
        payload: payload({
          day: "2026-05-01",
          subject: "00000000-0000-4000-8000-000000000003",
          confirmed: [],
        }),
      },
    ]);
    expect(showDay(root, { day: "2026-05-01" }).text.split("\n")[0]).toBe("2026-05-01  unsigned");
    expect(readDay(root, { day: "2026-05-01" }).signed).toBeNull();
  });
});

describe("the vendored sealed sample", () => {
  it("is conformance/sample-logbook-sealed of the spec repo, a logbook/0.3 record naming two recipients", () => {
    const meta = JSON.parse(
      readFileSync(join(FIXTURES, "sample-logbook-sealed", "logbook.json"), "utf-8"),
    ) as {
      format: string;
      recipients: string[];
    };
    expect(meta.format).toBe("logbook/0.3");
    expect(meta.recipients).toHaveLength(2);
  });
});

describe("dispositions (RFC 0034 amendment 1): what became of the commitment on a confirmed line", () => {
  const A = "00000000-0000-4000-8000-000000000001";
  const B = "00000000-0000-4000-8000-000000000002";
  const withDispositions = (
    confirmed: string[],
    dispositions: unknown,
    extra: Record<string, unknown> = {},
  ): Line =>
    line({}, { confirmed, page: { sha256: "ab".repeat(32), lines: 2 }, dispositions, ...extra });

  it("is optional, may be empty, and takes exactly four words on ids in `confirmed`", () => {
    expect(signedDayProblems(withDispositions([A], undefined), OWNER)).toEqual([]);
    expect(signedDayProblems(withDispositions([A], {}), OWNER)).toEqual([]);
    expect(
      signedDayProblems(withDispositions([A, B], { [A]: "kept", [B]: "carried" }), OWNER),
    ).toEqual([]);
    for (const word of DISPOSITIONS) {
      expect(signedDayProblems(withDispositions([A], { [A]: word }), OWNER)).toEqual([]);
    }
    expect(DISPOSITIONS).toEqual(["kept", "missed", "dropped", "carried"]);
  });

  it("names each rule broken as the reference does: a fifth word, an id not confirmed, not an object, not a string", () => {
    expect(signedDayProblems(withDispositions([A], { [A]: "done" }), OWNER)).toEqual([
      `the disposition of ${A} is 'done'; a line is kept, missed, dropped or carried`,
    ]);
    expect(signedDayProblems(withDispositions([A], { [B]: "kept" }), OWNER)).toEqual([
      `dispositions names ${B}, which is not in confirmed`,
    ]);
    expect(signedDayProblems(withDispositions([A], [A]), OWNER)).toEqual([
      "dispositions must be an object mapping a confirmed line's id to its disposition",
    ]);
    expect(signedDayProblems(withDispositions([A], { [A]: 1 }), OWNER)).toEqual([
      `the disposition of ${A} is 1; a line is kept, missed, dropped or carried`,
    ]);
    expect(
      signedDayProblems(withDispositions([A], { [A]: "done", [B]: "kept" }), OWNER),
    ).toHaveLength(2);
  });

  it("page.lines may not be smaller than the number of lines confirmed (the reference's rule)", () => {
    const fewer = line({}, { confirmed: [A, B], page: { sha256: "ab".repeat(32), lines: 1 } });
    expect(signedDayProblems(fewer, OWNER)).toEqual([
      "page.lines is smaller than the number of lines confirmed",
    ]);
  });

  it("dispositionsOf keeps the valid entries and never fails on the rest (SPEC §5)", () => {
    const payload = (extra: Record<string, unknown> = {}) =>
      line({}, extra).payload as Record<string, JsonValue>;
    expect(dispositionsOf(payload())).toEqual({});
    expect(dispositionsOf(payload({ dispositions: [A] }))).toEqual({});
    expect(dispositionsOf(payload({ confirmed: "x", dispositions: { [A]: "kept" } }))).toEqual({});
    expect(
      dispositionsOf(
        payload({
          confirmed: [A, B],
          dispositions: {
            [A]: "kept",
            [B]: "done",
            "00000000-0000-4000-8000-000000000003": "missed",
          },
        }),
      ),
    ).toEqual({ [A]: "kept" });
  });

  it("counts read `kept 2, missed 1` in the four words' order, nothing for none; the show row carries them before the note", () => {
    const payload = (extra: Record<string, unknown> = {}) =>
      line({}, extra).payload as Record<string, JsonValue>;
    expect(countsText({})).toBe("");
    expect(countsText({ a: "carried", b: "kept", c: "missed", d: "kept" })).toBe(
      "kept 2, missed 1, carried 1",
    );
    const p = payload({
      confirmed: [A, B],
      page: { sha256: "ab".repeat(32), lines: 2 },
      dispositions: { [A]: "kept", [B]: "missed" },
      note: "Sent the photos.",
    });
    expect(signedDayRow(p)).toBe(
      "signed 2026-03-01: 2 lines confirmed of 2 · kept 1, missed 1 · Sent the photos.",
    );
    expect(signedDayRow(payload())).toBe("signed 2026-03-01: 1 line confirmed of 1");
  });

  it("marks a row with the symbol of the first named line's disposition, and nothing otherwise", () => {
    const marks = { [A]: "kept", [B]: "missed" };
    expect(mark(marks, A)).toBe("✓ ");
    expect(mark(marks, B)).toBe("✗ ");
    expect(mark({ [A]: "dropped" }, A)).toBe("– ");
    expect(mark({ [A]: "carried" }, A)).toBe("→ ");
    expect(mark(marks, "x", B)).toBe("✗ ");
    expect(mark(marks, null, "x")).toBe("");
    expect(mark({}, A)).toBe("");
    expect(mark(undefined, A)).toBe("");
  });

  it("the Day carries the map under signed.dispositions and prints the symbol before each disposed line", () => {
    const note = "00000000-0000-4000-8000-000000000001";
    const event = "00000000-0000-4000-8000-000000000002";
    const root = writeRecord([
      {
        at: "2026-05-01T08:00:00Z",
        source: "manual",
        kind: "note",
        tier: 2,
        payload: { schema: "note/v1", text: "Send the mooring photos by Friday." },
      },
      {
        at: "2026-05-01T00:00:00Z",
        end: "2026-05-02T00:00:00Z",
        source: "sim-calendar",
        kind: "event",
        tier: 1,
        payload: { schema: "event/v1", title: "Boat week", all_day: true },
      },
      {
        at: "2026-05-01T18:00:00Z",
        source: "manual",
        kind: "signed-day",
        tier: 1,
        payload: payload({
          day: "2026-05-01",
          subject: "00000000-0000-4000-8000-000000000002",
          confirmed: [event, note],
          page: { sha256: "ab".repeat(32), lines: 2 },
          dispositions: { [note]: "kept", [event]: "carried" },
        }),
      },
    ]);
    const day = readDay(root, { day: "2026-05-01" });
    expect(day.signed?.dispositions).toEqual({ [note]: "kept", [event]: "carried" });
    const text = renderDay(day);
    expect(text).toContain("  all day       → Boat week\n");
    expect(text).toContain("  unplaced      10:00  note   ✓ Send the mooring photos by Friday.\n");
    // The show row of the signature lists the counts.
    expect(showDay(root, { day: "2026-05-01" }).text).toContain(
      "signed 2026-05-01: 2 lines confirmed of 2 · kept 1, carried 1\n",
    );
    // The sample's signature gives none: the map is empty, and the rows print as before.
    expect(readDay(SAMPLE, { day: "2026-03-01" }).signed?.dispositions).toEqual({});
  });
});
