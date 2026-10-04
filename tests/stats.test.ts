import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { collectStats, statsText } from "../src/stats.js";
import {
  cleanup,
  copySample,
  type Draft,
  FIXTURES,
  freshLogbook,
  SAMPLE,
  writeRecord,
} from "./helpers.js";

afterEach(cleanup);

const SHOW = join(FIXTURES, "show-sample");
const PROFILES = join(FIXTURES, "profiles-sample");
const BAR = "█".repeat(100);

function run(argv: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const code = main(argv, {
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}

/** The text with its `took …s` line, which varies, replaced by `took`. */
const steady = (text: string): string => text.replace(/^took \d+\.\d{3}s$/m, "took");

// What `logbook stats` of the reference printed on the conformance sample on 2026-10-02 (the tier
// and month tables are this implementation's, SPEC-QUESTIONS 42; `took` varies).
const SAMPLE_STATS = `logbook/0.2  head 035a74e0027faa6872580c3c7b5f7a0efec92f15bb29cee400a6593814fd345c
31 lines  first 2026-03-01T07:30:00Z  last 2026-03-08T19:00:00Z

  kind         lines   first       last
  event            3   2026-03-01  2026-03-07   1 source
  location         3   2026-03-01  2026-03-08   2 sources
  note             3   2026-03-01  2026-03-07   1 source
  flight           2   2026-03-05  2026-03-08   1 source
  photo            2   2026-03-01  2026-03-02   1 source
  transaction      2   2026-03-02  2026-03-08   1 source
  browse           1   2026-03-08  2026-03-08   1 source
  call             1   2026-03-08  2026-03-08   1 source
  crossing         1   2026-03-08  2026-03-08   1 source
  decision         1   2026-03-05  2026-03-05   1 source
  health           1   2026-03-08  2026-03-08   1 source
  highlight        1   2026-03-08  2026-03-08   1 source
  keeper           1   2026-03-01  2026-03-01   1 source
  listen           1   2026-03-08  2026-03-08   1 source
  mail             1   2026-03-08  2026-03-08   1 source
  message          1   2026-03-06  2026-03-06   1 source
  sleep            1   2026-03-01  2026-03-01   1 source
  task             1   2026-03-08  2026-03-08   1 source
  trip             1   2026-03-08  2026-03-08   1 source
  voice-memo       1   2026-03-08  2026-03-08   1 source
  watch            1   2026-03-08  2026-03-08   1 source
  workout          1   2026-03-03  2026-03-03   1 source

  source            lines
  manual                4
  sim-calendar          3
  google-takeout        2
  sim-bank              2
  sim-camera            2
  sim-flights           2
  sim-phone             2
  sim-watch             2
  ais                   1
  apple-books           1
  apple-health          1
  easypark              1
  ios-calls             1
  keeper-inference      1
  logbook               1
  mail                  1
  safari                1
  shazam                1
  sim-messages          1
  voice-memos           1

  year  lines
  2026     31  ${BAR}

  tier  lines
  1        14
  2        12
  3         5

  month    lines
  2026-03     31  ${BAR}

0 retractions hiding 0 lines
0 resolution lines minting 0 entities
1 attachment referenced by 1 line, 0 present under attachments/

took
`;

describe("stats on the fixtures, as the reference prints it", () => {
  it("prints the conformance sample's screen", () => {
    const stats = collectStats(SAMPLE);
    expect(steady(statsText(stats))).toBe(SAMPLE_STATS);
    expect(stats.took_seconds).toBeGreaterThanOrEqual(0);
  });

  it("counts show-sample: two retractions, five resolution lines minting three entities, a second month", () => {
    const stats = collectStats(SHOW);
    expect(stats.lines).toBe(20);
    expect(stats.first).toBe("2026-03-14T07:12:00Z");
    expect(stats.last).toBe("2026-04-01T06:00:00Z");
    expect(stats.kinds.slice(0, 2)).toEqual([
      { kind: "location", lines: 5, first: "2026-03-14", last: "2026-04-01", sources: 1 },
      { kind: "resolution", lines: 5, first: "2026-03-15", last: "2026-03-16", sources: 3 },
    ]);
    expect(stats.retractions).toEqual({ lines: 2, hidden: 2 });
    expect(stats.resolutions).toEqual({ lines: 5, entities: 3 });
    expect(stats.attachments).toEqual({ referenced: 0, lines: 0, present: 0 });
    // the point at 2026-03-31T22:30Z is April in Oslo: months are local
    expect(stats.months).toEqual([
      { month: "2026-03", lines: 18 },
      { month: "2026-04", lines: 2 },
    ]);
    expect(stats.tiers).toEqual([
      { tier: "1", lines: 7 },
      { tier: "2", lines: 13 },
    ]);
    const text = statsText(stats);
    expect(text).toContain(
      "\n2 retractions hiding 2 lines\n5 resolution lines minting 3 entities\n",
    );
    expect(text).toContain("\n  source             lines\n  manual                 6\n");
    expect(text).toContain(
      `\n  month    lines\n  2026-03     18  ${BAR}\n  2026-04      2  ${"█".repeat(11)}\n`,
    );
  });

  it("counts profiles-sample's attachments by digest: two digests, five lines, one present", () => {
    const stats = collectStats(PROFILES);
    expect(stats.lines).toBe(77);
    expect(stats.attachments).toEqual({ referenced: 2, lines: 5, present: 1 });
    expect(stats.retractions).toEqual({ lines: 1, hidden: 1 });
    expect(stats.resolutions).toEqual({ lines: 4, entities: 3 });
    const text = statsText(stats);
    expect(text).toContain("\n1 retraction hiding 1 line\n4 resolution lines minting 3 entities\n");
    expect(text).toContain("2 attachments referenced by 5 lines, 1 present under attachments/\n");
    // the kind column widens to the longest kind, the lines column stays at five
    expect(text).toContain(
      "\n  kind              lines   first       last\n  event                 7   2026-03-04  2026-03-04   3 sources\n",
    );
    expect(text).toContain("\n  commitment-close      1   2026-03-04  2026-03-04   1 source\n");
  });
});

describe("stats on synthetic records", () => {
  const note = (at: string, source: string, tier: 1 | 2 | 3 = 2): Draft => ({
    at,
    source,
    kind: "note",
    tier,
    payload: { schema: "note/v1", text: "x" },
  });

  it("prints an empty record as the reference does: no tables, zero counts", () => {
    const root = freshLogbook();
    const stats = collectStats(root);
    expect(stats.first).toBeNull();
    expect(stats.last).toBeNull();
    expect(stats.kinds).toEqual([]);
    expect(steady(statsText(stats))).toBe(
      `logbook/0.2  head ${"0".repeat(64)}
0 lines

0 retractions hiding 0 lines
0 resolution lines minting 0 entities
0 attachments referenced by 0 lines, 0 present under attachments/

took
`,
    );
  });

  it("sorts kinds and sources by lines then name, years and months by date, and keeps the floors of the columns", () => {
    const root = writeRecord([
      note("2025-06-01T10:00:00Z", "mail"),
      note("2025-06-02T10:00:00Z", "ais"),
      note("2025-12-31T23:30:00Z", "ais"), // 2026-01-01 00:30 in Oslo
      note("2026-02-01T10:00:00Z", "ais", 1),
    ]);
    const stats = collectStats(root);
    expect(stats.sources).toEqual([
      { source: "ais", lines: 3 },
      { source: "mail", lines: 1 },
    ]);
    expect(stats.years).toEqual([
      { year: "2025", lines: 2 },
      { year: "2026", lines: 2 },
    ]);
    expect(stats.months).toEqual([
      { month: "2025-06", lines: 2 },
      { month: "2026-01", lines: 1 },
      { month: "2026-02", lines: 1 },
    ]);
    const text = statsText(stats);
    expect(text).toContain(
      "\n  kind        lines   first       last\n  note            4   2025-06-01  2026-02-01   2 sources\n",
    );
    expect(text).toContain("\n  source      lines\n  ais             3\n  mail            1\n");
    expect(text).toContain(`\n  year  lines\n  2025      2  ${BAR}\n  2026      2  ${BAR}\n`);
    expect(text).toContain(
      `\n  month    lines\n  2025-06      2  ${BAR}\n  2026-01      1  ${"█".repeat(50)}\n`,
    );
  });

  it("formats thousands with commas and widens the lines column to the total", () => {
    const drafts: Draft[] = [];
    for (let i = 0; i < 1200; i++) {
      const minute = String(i % 60).padStart(2, "0");
      const hour = String(Math.floor(i / 60) % 24).padStart(2, "0");
      drafts.push(
        note(
          `2026-05-${String(1 + Math.floor(i / 1440)).padStart(2, "0")}T${hour}:${minute}:00Z`,
          i % 7 ? "sim-phone" : "manual",
          1,
        ),
      );
    }
    const text = statsText(collectStats(writeRecord(drafts)));
    expect(text).toContain(
      "\n1,200 lines  first 2026-05-01T00:00:00Z  last 2026-05-01T19:59:00Z\n",
    );
    expect(text).toContain(
      "\n  kind        lines   first       last\n  note        1,200   2026-05-01  2026-05-01   2 sources\n",
    );
    expect(text).toContain("\n  source      lines\n  sim-phone   1,028\n  manual        172\n");
    expect(text).toContain(`\n  year  lines\n  2026  1,200  ${BAR}\n`);
  });

  it("counts hidden lines and entities once each, and digests under media, extra.media and content", () => {
    const sha = "a".repeat(64);
    const other = "b".repeat(64);
    const ref = (digest: string, path = true) => ({
      sha256: digest,
      bytes: 3,
      media_type: "text/plain",
      ...(path ? { path: `attachments/${digest}` } : {}),
    });
    const entity = (n: number) => ({
      type: "person",
      id: `019c0000-0000-7000-8000-00000000000${n}`,
      registry: "logbook",
    });
    const root = writeRecord([
      {
        at: "2026-03-01T10:00:00Z",
        source: "voice-memos",
        kind: "voice-memo",
        payload: { schema: "voice-memo/v1", media: ref(sha) },
      },
      {
        at: "2026-03-01T11:00:00Z",
        source: "granola",
        kind: "transcript",
        payload: { schema: "transcript/v1", content: ref(sha, false) },
      },
      {
        at: "2026-03-01T12:00:00Z",
        source: "whatsapp",
        kind: "message",
        payload: { schema: "message/v1", extra: { media: ref(other) } },
      },
      {
        at: "2026-03-01T13:00:00Z",
        source: "mail",
        kind: "mail",
        payload: { schema: "mail/v1", attachments: [ref("c".repeat(64))] },
      },
      {
        at: "2026-03-02T10:00:00Z",
        source: "ios-contacts",
        kind: "resolution",
        payload: {
          schema: "resolution/v1",
          ref: { kind: "email", value: "a@example.org" },
          entity: entity(1),
        },
      },
      {
        at: "2026-03-02T10:00:01Z",
        source: "ios-contacts",
        kind: "resolution",
        payload: {
          schema: "resolution/v1",
          ref: { kind: "phone", value: "+4790000009" },
          entity: entity(1),
        },
      },
      {
        at: "2026-03-02T10:00:02Z",
        source: "whatsapp-contacts",
        kind: "resolution",
        payload: {
          schema: "resolution/v1",
          ref: { kind: "handle", value: "h@lid" },
          alias_of: { kind: "phone", value: "+4790000009" },
        },
      },
      {
        at: "2026-03-03T10:00:00Z",
        source: "manual",
        kind: "retraction",
        payload: {
          schema: "retraction/v1",
          supersedes: "00000000-0000-4000-8000-000000000001",
          reason: "dup",
        },
      },
      {
        at: "2026-03-03T10:00:01Z",
        source: "manual",
        kind: "retraction",
        payload: {
          schema: "retraction/v1",
          supersedes: "00000000-0000-4000-8000-000000000001",
          reason: "dup",
        },
      },
      {
        at: "2026-03-03T10:00:02Z",
        source: "manual",
        kind: "retraction",
        payload: {
          schema: "retraction/v1",
          supersedes: "00000000-0000-4000-8000-00000000ffff",
          reason: "ghost",
        },
      },
    ]);
    const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(join(root, "attachments"), { recursive: true });
    writeFileSync(join(root, "attachments", sha), "abc", "utf-8");
    const stats = collectStats(root);
    // a mail's `attachments` list is not a media reference; the ghost retraction still hides a line
    expect(stats.attachments).toEqual({ referenced: 2, lines: 3, present: 1 });
    expect(stats.retractions).toEqual({ lines: 3, hidden: 2 });
    expect(stats.resolutions).toEqual({ lines: 3, entities: 1 });
    expect(statsText(stats)).toContain(
      "\n3 retractions hiding 2 lines\n3 resolution lines minting 1 entity\n2 attachments referenced by 3 lines, 1 present under attachments/\n",
    );
  });

  it("refuses a record that is not logbook/0.2", () => {
    const root = freshLogbook("Europe/Oslo", "logbook/0.1");
    expect(() => collectStats(root)).toThrow(/logbook\/0\.1/);
  });

  it("reads a logbook/0.3 record, which hashes by the same rule, and prints its format (SPEC §3.1)", () => {
    const root = freshLogbook("Europe/Oslo", "logbook/0.3");
    expect(statsText(collectStats(root))).toMatch(/^logbook\/0\.3 {2}head 0{64}\n/);
  });
});

describe("logbook-ts stats", () => {
  it("prints the screen and exits 0", () => {
    const { code, out, err } = run(["stats", SAMPLE]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(steady(out)).toBe(SAMPLE_STATS);
  });

  it("--json prints the same numbers as one object, with the reference's keys and ours", () => {
    const { code, out } = run(["stats", SAMPLE, "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      "format",
      "head",
      "lines",
      "first",
      "last",
      "kinds",
      "sources",
      "years",
      "tiers",
      "months",
      "retractions",
      "resolutions",
      "attachments",
      "took_seconds",
    ]);
    expect(parsed.lines).toBe(31);
    expect(parsed.attachments).toEqual({ referenced: 1, lines: 1, present: 0 });
    expect(out.endsWith("}\n")).toBe(true);
  });

  it("exits 2 on a flag it does not know and 1 on a record it cannot read", () => {
    expect(run(["stats", SAMPLE, "--health"]).code).toBe(2);
    expect(run(["stats"]).code).toBe(2);
    const missing = run(["stats", `${copySample()}-missing`]);
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/logbook\.json/);
  });
});
