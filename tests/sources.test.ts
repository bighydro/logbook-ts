import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { gapsText, listSources, sourceGaps, sourcesText } from "../src/sources.js";
import { cleanup, type Draft, freshLogbook, SAMPLE, writeRecord } from "./helpers.js";

afterEach(cleanup);

/** The clock the reference ran at when its output below was captured (13:04 in Oslo). */
const NOW = new Date("2026-10-02T11:04:30Z");

function run(argv: string[], now = NOW): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const code = main(
    argv,
    {
      stdout: (s) => {
        out += s;
      },
      stderr: (s) => {
        err += s;
      },
    },
    { now },
  );
  return { code, out, err };
}

const note = (at: string, source: string): Draft => ({
  at,
  source,
  kind: "note",
  payload: { schema: "note/v1", text: "x" },
});
const H = 3_600_000;
const D = 24 * H;
const iso = (ms: number): string => `${new Date(ms).toISOString().slice(0, 19)}Z`;
const ago = (ms: number): string => iso(NOW.getTime() - ms);

// `logbook sources --gaps` of the reference on the conformance sample, 2026-10-02 13:05 Oslo; the
// footer's "counted through the index" is "counted from the month files" here (SPEC-QUESTIONS 43).
const SAMPLE_GAPS = `  source            lines  last              longest silence                  missing days
  manual                4  2026-03-07 22:30  208d 13h since 2026-03-07 22:30  212  2026-03-02, 2026-03-04, 2026-03-06, +1 run
  sim-calendar          3  2026-03-07 19:00  208d 17h since 2026-03-07 19:00  213  2026-03-02..2026-03-04, 2026-03-06, 2026-03-08..2026-10-02
  google-takeout        2  2026-03-08 10:00  208d 2h since 2026-03-08 10:00   208  2026-03-09..2026-10-02
  sim-bank              2  2026-03-08 12:00  208d 0h since 2026-03-08 12:00   213  2026-03-03..2026-03-07, 2026-03-09..2026-10-02
  sim-camera            2  2026-03-02 13:15  213d 22h since 2026-03-02 13:15  214  2026-03-03..2026-10-02
  sim-flights           2  2026-03-08 14:10  207d 21h since 2026-03-08 14:10  210  2026-03-06..2026-03-07, 2026-03-09..2026-10-02
  sim-phone             2  2026-03-01 09:05  215d 2h since 2026-03-01 09:05   215  2026-03-02..2026-10-02
  sim-watch             2  2026-03-03 18:00  212d 18h since 2026-03-03 18:00  214  2026-03-02, 2026-03-04..2026-10-02
  ais                   1  2026-03-08 07:00  208d 5h since 2026-03-08 07:00   208  2026-03-09..2026-10-02
  apple-books           1  2026-03-08 16:00  207d 20h since 2026-03-08 16:00  208  2026-03-09..2026-10-02
  apple-health          1  2026-03-08 07:30  208d 4h since 2026-03-08 07:30   208  2026-03-09..2026-10-02
  easypark              1  2026-03-08 11:30  208d 0h since 2026-03-08 11:30   208  2026-03-09..2026-10-02
  ios-calls             1  2026-03-08 08:05  208d 3h since 2026-03-08 08:05   208  2026-03-09..2026-10-02
  keeper-inference      1  2026-03-01 10:12  215d 1h since 2026-03-01 10:12   215  2026-03-02..2026-10-02
  logbook               1  2026-03-08 20:00  207d 16h since 2026-03-08 20:00  208  2026-03-09..2026-10-02
  mail                  1  2026-03-08 10:30  208d 1h since 2026-03-08 10:30   208  2026-03-09..2026-10-02
  safari                1  2026-03-08 09:00  208d 3h since 2026-03-08 09:00   208  2026-03-09..2026-10-02
  shazam                1  2026-03-08 11:00  208d 1h since 2026-03-08 11:00   208  2026-03-09..2026-10-02
  sim-messages          1  2026-03-06 20:30  209d 15h since 2026-03-06 20:30  210  2026-03-07..2026-10-02
  voice-memos           1  2026-03-08 17:00  207d 19h since 2026-03-08 17:00  208  2026-03-09..2026-10-02

20 sources with lines
since each source's first line, today 2026-10-02 (Europe/Oslo); counted from the month files, every line
`;

const SAMPLE_GAPS_SINCE = `  source          lines  last              longest silence                  missing days
  google-takeout      2  2026-03-08 10:00  208d 2h since 2026-03-08 10:00   211  2026-03-05..2026-03-07, 2026-03-09..2026-10-02
  manual              2  2026-03-07 22:30  208d 13h since 2026-03-07 22:30  210  2026-03-06, 2026-03-08..2026-10-02
  sim-calendar        2  2026-03-07 19:00  208d 17h since 2026-03-07 19:00  210  2026-03-06, 2026-03-08..2026-10-02
  sim-flights         2  2026-03-08 14:10  207d 21h since 2026-03-08 14:10  210  2026-03-06..2026-03-07, 2026-03-09..2026-10-02
  ais                 1  2026-03-08 07:00  208d 5h since 2026-03-08 07:00   211  2026-03-05..2026-03-07, 2026-03-09..2026-10-02
  apple-books         1  2026-03-08 16:00  207d 20h since 2026-03-08 16:00  211  2026-03-05..2026-03-07, 2026-03-09..2026-10-02
  apple-health        1  2026-03-08 07:30  208d 4h since 2026-03-08 07:30   211  2026-03-05..2026-03-07, 2026-03-09..2026-10-02
  easypark            1  2026-03-08 11:30  208d 0h since 2026-03-08 11:30   211  2026-03-05..2026-03-07, 2026-03-09..2026-10-02
  ios-calls           1  2026-03-08 08:05  208d 3h since 2026-03-08 08:05   211  2026-03-05..2026-03-07, 2026-03-09..2026-10-02
  logbook             1  2026-03-08 20:00  207d 16h since 2026-03-08 20:00  211  2026-03-05..2026-03-07, 2026-03-09..2026-10-02
  mail                1  2026-03-08 10:30  208d 1h since 2026-03-08 10:30   211  2026-03-05..2026-03-07, 2026-03-09..2026-10-02
  safari              1  2026-03-08 09:00  208d 3h since 2026-03-08 09:00   211  2026-03-05..2026-03-07, 2026-03-09..2026-10-02
  shazam              1  2026-03-08 11:00  208d 1h since 2026-03-08 11:00   211  2026-03-05..2026-03-07, 2026-03-09..2026-10-02
  sim-bank            1  2026-03-08 12:00  208d 0h since 2026-03-08 12:00   211  2026-03-05..2026-03-07, 2026-03-09..2026-10-02
  sim-messages        1  2026-03-06 20:30  209d 15h since 2026-03-06 20:30  211  2026-03-05, 2026-03-07..2026-10-02
  voice-memos         1  2026-03-08 17:00  207d 19h since 2026-03-08 17:00  211  2026-03-05..2026-03-07, 2026-03-09..2026-10-02

16 sources with lines
since 2026-03-05, today 2026-10-02 (Europe/Oslo); counted from the month files, every line
`;

describe("sources --gaps on the conformance sample, as the reference prints it", () => {
  it("prints one row per source with lines, the longest silence and the missing days in runs", () => {
    const report = sourceGaps(SAMPLE, { now: NOW });
    expect(gapsText(report)).toBe(SAMPLE_GAPS);
    expect(report.today).toBe("2026-10-02");
    expect(report.timezone).toBe("Europe/Oslo");
    expect(report.since).toBeNull();
    expect(report.expect).toBeNull();
    expect(report.flagged).toEqual([]);
    const manual = report.sources[0];
    expect(manual).toMatchObject({
      source: "manual",
      lines: 4,
      first: "2026-03-01T21:00:00Z",
      last: "2026-03-07T21:30:00Z",
      silence: { from: "2026-03-07T21:30:00Z", to: null },
      flagged: true,
    });
    expect(manual?.silence?.seconds).toBeCloseTo(
      (NOW.getTime() - Date.parse("2026-03-07T21:30:00Z")) / 1000,
      3,
    );
    expect(manual?.missing_days.slice(0, 4)).toEqual([
      "2026-03-02",
      "2026-03-04",
      "2026-03-06",
      "2026-03-08",
    ]);
    expect(manual?.missing_days).toHaveLength(212);
    expect(manual?.missing_days.at(-1)).toBe("2026-10-02");
  });

  it("--since starts every source's range there and keeps only the lines from then on", () => {
    const report = sourceGaps(SAMPLE, { now: NOW, since: "2026-03-05" });
    expect(gapsText(report)).toBe(SAMPLE_GAPS_SINCE);
    expect(report.since).toBe("2026-03-05");
    expect(report.sources.find((s) => s.source === "manual")?.first).toBe("2026-03-05T21:00:00Z");
  });
});

describe("sources --gaps on synthetic records", () => {
  it("formats a silence between two lines, under a day, under an hour, and the one still running", () => {
    const root = writeRecord([
      // steady: daily, except five days ago; last three hours ago → longest is the two-day hole
      ...[0, 1, 2, 3, 4, 6, 7, 8, 9].map((k) => note(ago(3 * H + k * D), "steady")),
      // gappy: a 25-hour silence that skips no local day
      note(ago(1 * H), "gappy"),
      note(ago(26 * H), "gappy"),
      note(ago(36 * H), "gappy"),
      // short: an hour between two lines, half an hour since the last
      note(ago(30 * 60_000), "short"),
      note(ago(90 * 60_000), "short"),
      // minutes: five minutes
      note(ago(60_000), "minutes"),
      note(ago(6 * 60_000), "minutes"),
      // yd: silent 27 hours, so today is already missing; yd2: silent 20 hours, so it is not yet
      note(ago(27 * H), "yd"),
      note(ago(20 * H), "yd2"),
      // future: a line after today is outside the range
      note(iso(NOW.getTime() + 2 * D), "future"),
      note(ago(2 * D), "future"),
    ]);
    const report = sourceGaps(root, { now: NOW });
    const by = Object.fromEntries(report.sources.map((s) => [s.source, s]));
    expect(by.steady).toMatchObject({
      lines: 9,
      silence: { from: ago(3 * H + 6 * D), to: ago(3 * H + 4 * D), seconds: 172800 },
      missing_days: ["2026-09-27"],
      flagged: true,
    });
    expect(by.gappy).toMatchObject({
      lines: 3,
      silence: { seconds: 90000 },
      missing_days: [],
      flagged: true,
    });
    expect(by.short).toMatchObject({
      silence: { seconds: 3600 },
      missing_days: [],
      flagged: false,
    });
    expect(by.yd).toMatchObject({ missing_days: ["2026-10-02"], flagged: true });
    expect(by.yd2).toMatchObject({ missing_days: [], flagged: false });
    expect(by.future).toMatchObject({
      lines: 1,
      last: ago(2 * D),
      missing_days: ["2026-10-01", "2026-10-02"],
      flagged: true,
    });
    expect(
      gapsText(report),
    ).toBe(`  source      lines  last              longest silence                              missing days
  steady          9  2026-10-02 10:04  2d 0h   2026-09-26 10:04 → 2026-09-28 10:04    1  2026-09-27
  gappy           3  2026-10-02 12:04  1d 1h   2026-10-01 11:04 → 2026-10-02 12:04    0
  minutes         2  2026-10-02 13:03  5m      2026-10-02 12:58 → 2026-10-02 13:03    0
  short           2  2026-10-02 12:34  1h 0m   2026-10-02 11:34 → 2026-10-02 12:34    0
  future          1  2026-09-30 13:04  2d 0h   since 2026-09-30 13:04                 2  2026-10-01..2026-10-02
  yd              1  2026-10-01 10:04  1d 3h   since 2026-10-01 10:04                 1  2026-10-02
  yd2             1  2026-10-01 17:04  20h 0m  since 2026-10-01 17:04                 0

7 sources with lines
since each source's first line, today 2026-10-02 (Europe/Oslo); counted from the month files, every line
`);
  });

  it("under --since the silence may run from the range's start to the first line, and lines before it do not count", () => {
    const root = writeRecord([
      note("2026-08-23T11:00:00Z", "closed"),
      note("2026-09-22T11:00:00Z", "closed"),
      note(ago(2 * H), "closed"),
      note(ago(2 * H + D), "closed"),
      note(ago(2 * H + 2 * D), "closed"),
    ]);
    const whole = sourceGaps(root, { now: NOW }).sources[0];
    expect(whole).toMatchObject({
      lines: 5,
      first: "2026-08-23T11:00:00Z",
      silence: { from: "2026-08-23T11:00:00Z", to: "2026-09-22T11:00:00Z", seconds: 2_592_000 },
    });
    expect(whole?.missing_days).toHaveLength(36);
    const since = sourceGaps(root, { now: NOW, since: "2026-09-01" });
    expect(since.sources[0]).toMatchObject({
      lines: 4,
      first: "2026-09-22T11:00:00Z",
      // midnight in Oslo on 1 September is 22:00Z the day before
      silence: { from: "2026-08-31T22:00:00Z", to: "2026-09-22T11:00:00Z", seconds: 1_861_200 },
    });
    expect(gapsText(since)).toContain(
      "\n  closed          4  2026-10-02 11:04  21d 13h 2026-09-01 00:00 → 2026-09-22 13:00   28  2026-09-01..2026-09-21, 2026-09-23..2026-09-29\n",
    );
    expect(gapsText(sourceGaps(root, { now: NOW, since: "2026-10-01" }))).toContain(
      "\n  closed          2  2026-10-02 11:04  1d 0h   2026-10-01 11:04 → 2026-10-02 11:04    0\n",
    );
  });

  it("folds more than three runs of missing days into `+N runs`", () => {
    const root = writeRecord([
      note("2026-09-01T10:00:00Z", "spotty"),
      note("2026-09-03T10:00:00Z", "spotty"),
      note("2026-09-05T10:00:00Z", "spotty"),
      note("2026-09-07T10:00:00Z", "spotty"),
      note("2026-09-09T10:00:00Z", "spotty"),
      note("2026-10-02T09:00:00Z", "spotty"),
    ]);
    const text = gapsText(sourceGaps(root, { now: NOW }));
    expect(text).toContain("  26  2026-09-02, 2026-09-04, 2026-09-06, +2 runs\n");
    const one = gapsText(
      sourceGaps(
        writeRecord([
          note("2026-09-01T10:00:00Z", "a"),
          note("2026-09-03T10:00:00Z", "a"),
          note("2026-09-05T10:00:00Z", "a"),
          note("2026-09-07T10:00:00Z", "a"),
          note("2026-10-02T09:00:00Z", "a"),
        ]),
        { now: NOW },
      ),
    );
    expect(one).toContain("  27  2026-09-02, 2026-09-04, 2026-09-06, +1 run\n");
  });

  it("--expect keeps the order given, marks a flagged or absent source with `!`, and says so", () => {
    const root = writeRecord([
      note(ago(60_000), "minutes"),
      note(ago(6 * 60_000), "minutes"),
      note("2025-05-01T10:00:00Z", "old"),
      note("2025-05-02T10:00:00Z", "old"),
    ]);
    const report = sourceGaps(root, { now: NOW, expect: ["minutes", "old", "nothing"] });
    expect(report.expect).toEqual(["minutes", "old", "nothing"]);
    expect(report.sources.map((s) => s.source)).toEqual(["minutes", "old", "nothing"]);
    expect(report.sources[2]).toEqual({
      source: "nothing",
      lines: 0,
      first: null,
      last: null,
      silence: null,
      missing_days: [],
      flagged: true,
    });
    expect(report.flagged).toEqual(["old", "nothing"]);
    expect(
      gapsText(report),
    ).toBe(`  source      lines  last              longest silence                              missing days
  minutes         2  2026-10-02 13:03  5m      2026-10-02 12:58 → 2026-10-02 13:03    0
! old             2  2025-05-02 12:00  518d 1h since 2025-05-02 12:00               518  2025-05-03..2026-10-02
! nothing         0  -                 no lines

2 of 3 expected sources flagged: old, nothing
since each source's first line, today 2026-10-02 (Europe/Oslo); counted from the month files, every line
`);
    expect(gapsText(sourceGaps(root, { now: NOW, expect: ["minutes"] }))).toContain(
      "\n1 expected source, none flagged\n",
    );
    expect(gapsText(sourceGaps(root, { now: NOW, expect: ["old"] }))).toContain(
      "\n1 of 1 expected source flagged: old\n",
    );
    expect(gapsText(sourceGaps(root, { now: NOW, expect: ["minutes", "minutes"] }))).toContain(
      "\n1 expected source, none flagged\n",
    );
  });

  it("pads the count of missing days to three places and lets a longer one push the row, as the reference does", () => {
    const root = writeRecord([note("2023-05-01T10:00:00Z", "old"), note(ago(60_000), "fresh")]);
    const text = gapsText(sourceGaps(root, { now: NOW }));
    expect(text).toContain(
      "\n  fresh           1  2026-10-02 13:03  1m      since 2026-10-02 13:03     0\n",
    );
    expect(text).toContain(
      "\n  old             1  2023-05-01 12:00  1250d 1h since 2023-05-01 12:00  1250  2023-05-02..2026-10-02\n",
    );
  });

  it("prints `no lines` for an empty record", () => {
    expect(gapsText(sourceGaps(freshLogbook(), { now: NOW }))).toBe(`no lines

0 sources with lines
since each source's first line, today 2026-10-02 (Europe/Oslo); counted from the month files, every line
`);
  });

  it("refuses a --since after today, a bad day, and a record that is not logbook/0.2", () => {
    expect(() => sourceGaps(SAMPLE, { now: NOW, since: "2027-01-01" })).toThrow(
      "--since 2027-01-01 is after today (2026-10-02)",
    );
    expect(() => sourceGaps(SAMPLE, { now: NOW, since: "2026-13-01" })).toThrow(
      "not a date (YYYY-MM-DD): '2026-13-01'",
    );
    expect(() => sourceGaps(freshLogbook("Europe/Oslo", "logbook/0.1"), { now: NOW })).toThrow(
      /logbook\/0\.1/,
    );
  });
});

describe("sources without --gaps lists the record's sources", () => {
  it("one row per source with lines: how many, first and last line in the record's zone", () => {
    const listed = listSources(SAMPLE);
    expect(listed.timezone).toBe("Europe/Oslo");
    expect(listed.sources[0]).toEqual({
      source: "manual",
      lines: 4,
      first: "2026-03-01T21:00:00Z",
      last: "2026-03-07T21:30:00Z",
    });
    expect(listed.sources).toHaveLength(20);
    const text = sourcesText(listed);
    expect(text.split("\n").slice(0, 3)).toEqual([
      "  source            lines  first             last",
      "  manual                4  2026-03-01 22:00  2026-03-07 22:30",
      "  sim-calendar          3  2026-03-01 10:00  2026-03-07 19:00",
    ]);
    expect(text).toMatch(/\n\n20 sources with lines\n$/);
    expect(sourcesText(listSources(freshLogbook()))).toBe("no lines\n\n0 sources with lines\n");
  });
});

describe("logbook-ts sources", () => {
  it("--gaps prints the report and exits 0; --since and --expect narrow it", () => {
    const { code, out, err } = run(["sources", SAMPLE, "--gaps"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toBe(SAMPLE_GAPS);
    expect(run(["sources", SAMPLE, "--gaps", "--since", "2026-03-05"]).out).toBe(SAMPLE_GAPS_SINCE);
    expect(run(["sources", SAMPLE, "--gaps", "--since=2026-03-05"]).out).toBe(SAMPLE_GAPS_SINCE);
    const expected = run([
      "sources",
      SAMPLE,
      "--gaps",
      "--expect",
      "manual",
      "nothing",
      "--since",
      "2026-03-05",
    ]);
    expect(expected.code).toBe(1);
    expect(expected.out).toContain("\n! nothing");
    expect(expected.out).toContain("\n2 of 2 expected sources flagged: manual, nothing\n");
    const fine = run(
      ["sources", SAMPLE, "--gaps", "--expect", "manual"],
      new Date("2026-03-08T00:00:00Z"),
    );
    expect(fine.code).toBe(1); // manual is silent for days within its own range
    expect(fine.out).toContain("\n! manual");
  });

  it("--gaps --json prints the report as one object", () => {
    const { code, out } = run([
      "sources",
      SAMPLE,
      "--gaps",
      "--json",
      "--expect",
      "manual,nothing",
    ]);
    expect(code).toBe(1);
    const parsed = JSON.parse(out) as {
      expect: string[];
      flagged: string[];
      sources: Array<{ source: string }>;
    };
    expect(parsed.expect).toEqual(["manual", "nothing"]);
    expect(parsed.flagged).toEqual(["manual", "nothing"]);
    expect(Object.keys(parsed)).toEqual([
      "since",
      "today",
      "timezone",
      "expect",
      "sources",
      "flagged",
    ]);
    expect(Object.keys(parsed.sources[0] as object)).toEqual([
      "source",
      "lines",
      "first",
      "last",
      "silence",
      "missing_days",
      "flagged",
    ]);
  });

  it("without --gaps lists the sources, and refuses --since, --expect and --json then", () => {
    const plain = run(["sources", SAMPLE]);
    expect(plain.code).toBe(0);
    expect(plain.out).toMatch(/^ {2}source {12}lines {2}first {13}last\n {2}manual {16}4 {2}/);
    for (const extra of [["--since", "2026-03-05"], ["--expect", "manual"], ["--json"]]) {
      const refused = run(["sources", SAMPLE, ...extra]);
      expect(refused.code).toBe(2);
      expect(refused.err).toBe("sources: --since, --expect and --json go with --gaps\n");
    }
  });

  it("exits 2 with the reference's messages on a bad or future --since, and on a flag it does not know", () => {
    const future = run(["sources", SAMPLE, "--gaps", "--since", "2027-01-01"]);
    expect(future.code).toBe(2);
    expect(future.err).toBe("sources: --since 2027-01-01 is after today (2026-10-02)\n");
    const bad = run(["sources", SAMPLE, "--gaps", "--since", "2026-13-01"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toBe("sources: not a date (YYYY-MM-DD): '2026-13-01'\n");
    expect(run(["sources", SAMPLE, "--gaps", "--since"]).code).toBe(2);
    expect(run(["sources", SAMPLE, "--gaps", "--expect"]).code).toBe(2);
    expect(run(["sources", SAMPLE, "--gaps", "--bogus"]).code).toBe(2);
    expect(run(["sources"]).code).toBe(2);
  });
});
