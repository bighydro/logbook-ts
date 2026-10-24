import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, posix } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { renderCountries, rollupCountries } from "../src/countries.js";
import { readDay } from "../src/day.js";
import { readDayStart } from "../src/dayStart.js";
import { readDayRows, renderDayRows } from "../src/days.js";
import { renderDay } from "../src/dayText.js";
import { draftRow, readDraft } from "../src/drafts.js";
import { FLAGS_ENV } from "../src/flags.js";
import { renderNights, rollupNights } from "../src/nights.js";
import { readPeople, renderPeople } from "../src/people.js";
import { readAssets } from "../src/settings.js";
import { showDay } from "../src/show.js";
import { gapsText, sourceGaps } from "../src/sources.js";
import { collectStats, statsText } from "../src/stats.js";
import { verifyLogbook } from "../src/store.js";
import { readTrips, renderTrips } from "../src/trips.js";
import { CROSS_IMPL_BUDGET_MS } from "./budgets.js";
import {
  cleanup,
  comparableDayJson,
  comparableDayText,
  cutInsideLastLine,
  DUPLICATE_KEYS,
  expectedDays,
  expectedDaysWindows,
  expectedShows,
  expectedWindows,
  FIXTURES,
  readMetaFile,
  SAMPLE_MONTH,
  tempDir,
  windowOptions,
  writeBareRecord,
  writeDuplicateKey,
  writeMeta,
  writeRecord,
} from "./helpers.js";
import { MARKS_CASES, DAY as MARKS_DAY, marksRecord } from "./marks-cases.js";
import { RECEIPT_CASES } from "./receipts-cases.js";
import { observed, SPEAKER_CASES, speakerRecord } from "./speakers-cases.js";
import { dayRows, FLIGHT_CASES, PEOPLE_CASES, TRANSCRIPT_CASES } from "./superseded-cases.js";
import { caseDay, WITH_CASES, withRecord } from "./with-cases.js";

/**
 * The two implementations must print the same day. This test runs the reference implementation
 * (openlogbook, Python) on a copy of each fixture and diffs its `show`, `day`, `stats`, `sources --gaps`,
 * `trips`, `rollup countries`, `rollup nights`, `days` and `people` output against ours, and against the
 * expected files we vendor. It needs a clone of https://github.com/bighydro/logbook
 * named by LOGBOOK_REF, with `uv` on the path (`uv run` installs the clone's own environment);
 * without LOGBOOK_REF it is skipped, so the default `pnpm test` never spawns anything.
 */
const REF = process.env.LOGBOOK_REF;
const ready = REF !== undefined && existsSync(join(REF, "pyproject.toml"));

afterEach(cleanup);

/** The reference CLI on a disposable copy of a record (it writes an index beside the record). */
function reference(copy: string, args: string[]): string {
  const result = spawnSync("uv", ["run", "--project", REF as string, "logbook", ...args], {
    cwd: REF,
    encoding: "utf-8",
    env: { ...process.env, LOGBOOK_HOME: copy, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`reference exited ${result.status}:\n${result.stderr}`);
  return result.stdout;
}

/** `logbook show <day> [--raw]` of the reference. */
const referenceShow = (copy: string, day: string, raw: boolean): string =>
  reference(copy, ["show", day, ...(raw ? ["--raw"] : [])]);

/** A disposable copy of a fixture, without the expected output beside it. */
function copyOf(fixture: string): string {
  const copy = join(tempDir(), fixture);
  cpSync(join(FIXTURES, fixture), copy, {
    recursive: true,
    filter: (src) => !basename(src).startsWith("expected-"),
  });
  return copy;
}

describe.skipIf(!ready)("the reference implementation and logbook-ts print the same day", () => {
  // sample-logbook (the conformance sample) is diffed whole: since b3cd8c5 (2026-10-02) the reference
  // reads every one of its eight days as SPEC §3.2 says (SPEC-QUESTIONS 24, 25, 27 and 40).
  for (const name of ["show-sample", "profiles-sample", "sample-logbook"]) {
    const root = join(FIXTURES, name);
    for (const { day, raw, text } of expectedShows(root)) {
      it(
        `${name} ${day}${raw ? " --raw" : ""}`,
        () => {
          const copy = join(tempDir(), name);
          cpSync(root, copy, { recursive: true });
          const reference = referenceShow(copy, day, raw);
          const ours = showDay(root, { day, raw }).text;
          expect(ours, "logbook-ts disagrees with the reference").toBe(reference);
          expect(reference, "the reference moved; re-capture tests/fixtures/*/expected-show").toBe(
            text,
          );
        },
        CROSS_IMPL_BUDGET_MS,
      );
    }
  }
});

describe.skipIf(ready)("the cross-implementation test", () => {
  it("is skipped: set LOGBOOK_REF to a clone of bighydro/logbook to run it", () => {
    expect(ready).toBe(false);
  });
});

describe.skipIf(!ready)("the reference implementation and logbook-ts read the same Day", () => {
  // day-sample has a case of every rule; demo-sample is three days of the reference's own demo record.
  for (const fixture of ["day-sample", "demo-sample"]) {
    it(`agrees on every day of ${fixture}, as text and as JSON, and the vendored files are that output`, () => {
      const copy = copyOf(fixture);
      // The reference's readiness block (RFC 0034) is not read here yet (SPEC-QUESTIONS 79): the
      // vendored files carry it, and the Day is compared without it.
      for (const expected of expectedDays(join(FIXTURES, fixture))) {
        const text = reference(copy, ["day", expected.day]);
        const json = JSON.parse(reference(copy, ["day", expected.day, "--json"])) as unknown;
        expect(text).toBe(expected.raw.text);
        expect(json).toEqual(expected.raw.json);
        const ours = readDay(join(FIXTURES, fixture), { day: expected.day });
        expect(renderDay(ours)).toBe(comparableDayText(text));
        expect(JSON.parse(JSON.stringify(ours))).toEqual(comparableDayJson(json));
      }
    }, 120_000);
  }

  it("agrees on three days of the demo record (`logbook demo --days 30 --seed 7`): a flight, a day at the berth, a day aboard", () => {
    const demo = join(tempDir(), "demo");
    reference(REF as string, ["demo", "--days", "30", "--seed", "7", "--out", demo]);
    for (const day of ["2026-06-08", "2026-06-13", "2026-06-15"]) {
      const text = reference(demo, ["day", day]);
      const json = JSON.parse(reference(demo, ["day", day, "--json"])) as unknown;
      const ours = readDay(demo, { day });
      expect(renderDay(ours)).toBe(comparableDayText(text));
      expect(JSON.parse(JSON.stringify(ours))).toEqual(comparableDayJson(json));
    }
  }, 120_000);
});

/**
 * The reference's `logbook verify` on a copy of a record, read as what SPEC §3 says a verifier
 * reports: the seq and head of the lines read, and each problem by file and line number. The
 * valid line is `valid — N lines, head <hex>`; the invalid one `INVALID — N problem(s); M lines
 * read, head <hex>:` with the problems indented under it (read from its output, never its source).
 */
function referenceVerify(copy: string): {
  status: number;
  lines: number;
  head: string;
  errors: string[];
} {
  const { status, stdout } = referenceRun(copy, ["verify"]);
  const [first = "", ...rest] = stdout.split("\n");
  const valid = /^valid — (\d+) lines, head ([0-9a-f]{64})$/.exec(first);
  if (valid) return { status, lines: Number(valid[1]), head: valid[2] as string, errors: [] };
  const invalid = /^INVALID — (\d+) problem\(s\); (\d+) lines read, head ([0-9a-f]{64}):$/.exec(
    first,
  );
  if (invalid === null) throw new Error(`not a verify line: ${JSON.stringify(stdout)}`);
  const errors = rest.filter((line) => line !== "").map((line) => line.replace(/^ {2}/, ""));
  if (errors.length !== Number(invalid[1])) throw new Error(`problems miscounted: ${stdout}`);
  return { status, lines: Number(invalid[2]), head: invalid[3] as string, errors };
}

describe.skipIf(!ready)(
  "the reference implementation and logbook-ts verify the same record",
  () => {
    // SPEC §6: cutting the sample's month file inside any line makes verify report invalid with the
    // seq and head of the last whole line (§3, truncation). The conformance sample and the seed-1 demo,
    // whole and then cut halfway into the last line of their last month file, with logbook.json as a
    // crash leaves it: the two must agree on the seq, the head and the sentence naming the cut line.
    // The reference names the file with `/`; ours names it as node:path joins it, so each is held to
    // the sentence built from the same parts, never one string against the other.
    const cutShort = (parts: readonly string[], row: number): { theirs: string; ours: string } => ({
      theirs: `${posix.join(...parts)} line ${row}: the file ends inside this line (cut short)`,
      ours: `${join(...parts)} line ${row}: the file ends inside this line (cut short)`,
    });
    for (const [fixture, parts] of [
      ["sample-logbook", ["logbook", "2026", "03.jsonl"]],
      ["demo-seed1", ["logbook", "2026", "06.jsonl"]],
    ] as const) {
      it(`${fixture}: whole, then cut inside its last line`, () => {
        const copy = copyOf(fixture);
        const whole = referenceVerify(copy);
        const ours = verifyLogbook(copy);
        expect(whole.status).toBe(0);
        expect([ours.lines, ours.head, ours.errors]).toEqual([whole.lines, whole.head, []]);

        const { row, seq, head } = cutInsideLastLine(copy, join(...parts));
        const torn = referenceVerify(copy);
        const tornOurs = verifyLogbook(copy);
        const sentence = cutShort(parts, row);
        expect(torn.status).toBe(1);
        expect([torn.lines, torn.head, torn.errors]).toEqual([seq, head, [sentence.theirs]]);
        expect(tornOurs.valid).toBe(false);
        expect([tornOurs.lines, tornOurs.head, tornOurs.errors]).toEqual([
          torn.lines,
          torn.head,
          [sentence.ours],
        ]);
      }, 120_000);
    }

    // SPEC §2: a line that gives a member name twice in one object, at any depth, is invalid. Each
    // variant writes the line's own value last, so only the duplicate is wrong; the two must agree on
    // the seq and head of the lines before it and on the sentence naming it. Each also says
    // logbook.json is ahead of those lines, in its own words (SPEC-QUESTIONS 81), so that is left out.
    for (const variant of DUPLICATE_KEYS) {
      it(`sample-logbook with ${variant.name} given twice in line ${variant.row}`, () => {
        const copy = copyOf("sample-logbook");
        writeDuplicateKey(copy, variant);
        const theirs = referenceVerify(copy);
        const ours = verifyLogbook(copy);
        const sentence = (file: string) =>
          `${file} line ${variant.row}: duplicate key '${variant.key}'`;
        expect(theirs.status).toBe(1);
        expect([theirs.lines, theirs.head, theirs.errors[0]]).toEqual([
          variant.row - 1,
          ours.head,
          sentence(posix.join("logbook", "2026", "03.jsonl")),
        ]);
        expect(ours.valid).toBe(false);
        expect([ours.lines, ours.errors[0]]).toEqual([theirs.lines, sentence(SAMPLE_MONTH)]);
      }, 120_000);
    }

    it(
      "sample-logbook cut inside its first line: no whole line remains, and both say 0 and GENESIS",
      () => {
        const copy = copyOf("sample-logbook");
        const parts = ["logbook", "2026", "03.jsonl"] as const;
        const file = join(copy, ...parts);
        const first = readFileSync(file, "utf-8").split("\n")[0] as string;
        writeFileSync(file, first.slice(0, Math.floor(first.length / 2)), "utf-8");
        const meta = JSON.parse(readFileSync(join(copy, "logbook.json"), "utf-8")) as Record<
          string,
          unknown
        >;
        writeFileSync(
          join(copy, "logbook.json"),
          JSON.stringify({ ...meta, seq: 0, head: "0".repeat(64) }),
          "utf-8",
        );
        const theirs = referenceVerify(copy);
        const ours = verifyLogbook(copy);
        const sentence = cutShort(parts, 1);
        expect(theirs.status).toBe(1);
        expect([theirs.lines, theirs.head, theirs.errors]).toEqual([
          0,
          "0".repeat(64),
          [sentence.theirs],
        ]);
        expect([ours.lines, ours.head, ours.errors]).toEqual([
          theirs.lines,
          theirs.head,
          [sentence.ours],
        ]);
      },
      CROSS_IMPL_BUDGET_MS,
    );
  },
);

/** `logbook <command…>` of the reference on a copy of a record, whatever its exit status; `LOGBOOK_HOME` names the copy. */
function referenceRun(copy: string, args: string[]): { status: number; stdout: string } {
  const result = spawnSync("uv", ["run", "--project", REF as string, "logbook", ...args], {
    cwd: REF,
    encoding: "utf-8",
    env: { ...process.env, LOGBOOK_HOME: copy, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, stdout: result.stdout };
}

/** The reference's `stats` screen without its `took` line; ours without that and the tier and month tables, which are ours alone. */
const comparableStats = (text: string, ours: boolean): string => {
  let out = text.replace(/^took \d+\.\d+s\n/m, "");
  if (ours) out = out.replace(/ {2}tier {2}.*?\n\n/s, "").replace(/ {2}month {4}.*?\n\n/s, "");
  return out;
};

/** The reference says "counted through the index"; we have no index and say where we counted. */
const comparableGaps = (text: string): string =>
  text.replace("counted through the index", "counted from the month files");

type Json = Record<string, unknown>;

/** What `run` gives, with the instants just before it started and just after it ended. */
function bracketed<T>(run: () => T): [T, Date, Date] {
  const before = new Date();
  const result = run();
  return [result, before, new Date()];
}

/** The gaps report with the running silences rounded to whole minutes, since the two clocks differ by the run. */
function comparableGapsJson(text: string): Json {
  const report = JSON.parse(text) as {
    sources: Array<{ silence: { to: string | null; seconds: number } | null }>;
  };
  for (const source of report.sources) {
    if (source.silence !== null && source.silence.to === null) {
      source.silence.seconds = Math.round(source.silence.seconds / 60);
    }
  }
  return report;
}

/**
 * The records both implementations count: the three fixtures, and the reference's own demo record
 * (`logbook demo`: a month of a person who does not exist, every profile, 12,772 lines), written
 * into a temp folder when the test runs.
 */
function records(): Array<{ name: string; root: string; since: string }> {
  const found = ["show-sample", "profiles-sample", "sample-logbook"].map((name) => ({
    name,
    root: join(FIXTURES, name),
    since: "2026-03-05",
  }));
  // Made once for every test here, so outside the per-test cleanup, and removed at the end.
  const folder = mkdtempSync(join(tmpdir(), "logbook-ts-demo-"));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const demo = join(folder, "Logbook");
  const made = referenceRun(demo, ["demo", "--out", demo]);
  if (made.status !== 0) throw new Error(`logbook demo exited ${made.status}`);
  found.push({ name: "demo record", root: demo, since: "2026-06-15" });
  return found;
}

describe.skipIf(!ready)("the reference implementation and logbook-ts count the same record", () => {
  // The running silences and `today` depend on the clock; the two runs are seconds apart, so the
  // text agrees unless an hour or a day turns between them, and the JSON compares whole minutes.
  for (const { name, root, since } of ready ? records() : []) {
    const copy = (): string => {
      const dir = join(tempDir(), "record");
      cpSync(root, dir, { recursive: true, filter: (src) => !src.includes("expected-show") });
      return dir;
    };
    it(
      `${name}: stats`,
      () => {
        const theirs = referenceRun(copy(), ["stats"]);
        expect(theirs.status).toBe(0);
        const ours = statsText(collectStats(root));
        expect(comparableStats(ours, true)).toBe(comparableStats(theirs.stdout, false));
      },
      CROSS_IMPL_BUDGET_MS,
    );
    it(
      `${name}: stats --json`,
      () => {
        const theirs = JSON.parse(referenceRun(copy(), ["stats", "--json"]).stdout) as Json;
        const ours = JSON.parse(JSON.stringify(collectStats(root))) as Json;
        for (const key of ["took_seconds", "tiers", "months"]) delete ours[key];
        delete theirs.took_seconds;
        expect(ours).toEqual(theirs);
      },
      CROSS_IMPL_BUDGET_MS,
    );
    for (const args of [[], ["--since", since]]) {
      it(
        `${name}: sources --gaps ${args.join(" ")}`.trimEnd(),
        () => {
          const options = args.length ? { since } : {};
          // A running silence is measured to the reference's own now, which is some instant while it
          // ran: its report must be ours at the instant before it started or at the one after it
          // ended (the run takes seconds, so one minute boundary at most lies between them).
          const [theirs, before, after] = bracketed(() =>
            referenceRun(copy(), ["sources", "--gaps", ...args]),
          );
          expect(theirs.status).toBe(0);
          const at = (now: Date) => gapsText(sourceGaps(root, { ...options, now }));
          expect([at(before), at(after)]).toContain(comparableGaps(theirs.stdout));
          const [json, from, to] = bracketed(() =>
            referenceRun(copy(), ["sources", "--gaps", "--json", ...args]),
          );
          const atJson = (now: Date) =>
            comparableGapsJson(JSON.stringify(sourceGaps(root, { ...options, now })));
          expect([atJson(from), atJson(to)]).toContainEqual(comparableGapsJson(json.stdout));
        },
        CROSS_IMPL_BUDGET_MS,
      );
    }
    it(
      `${name}: sources --gaps --expect, a source silent for days and one with no line`,
      () => {
        const [theirs, before, after] = bracketed(() =>
          referenceRun(copy(), [
            "sources",
            "--gaps",
            "--since",
            since,
            "--expect",
            "manual",
            "nothing",
          ]),
        );
        expect(theirs.status).toBe(1);
        const at = (now: Date) =>
          gapsText(sourceGaps(root, { since, expect: ["manual", "nothing"], now }));
        expect([at(before), at(after)]).toContain(comparableGaps(theirs.stdout));
      },
      CROSS_IMPL_BUDGET_MS,
    );
  }
});
/** The flags a window name stands for: `all`, `YYYY`, or `since..until`. */
function windowFlags(name: string): string[] {
  const options = windowOptions(name);
  if (options.year !== undefined) return ["--year", options.year];
  if (options.since !== undefined && options.until !== undefined)
    return ["--since", options.since, "--until", options.until];
  return [];
}

describe.skipIf(!ready)(
  "the reference implementation and logbook-ts derive the same trips, countries and nights",
  () => {
    // trips-sample and nights-sample have a case of every rule; day-sample and demo-sample are the day
    // fixtures, read over their days; sample-logbook is the conformance sample (no home place, every
    // night in transit); demo-seed1 is the reference's own `logbook demo --seed 1`, a month whole.
    for (const fixture of [
      "trips-sample",
      "nights-sample",
      "day-sample",
      "demo-sample",
      "sample-logbook",
      "demo-seed1",
    ]) {
      it(`agrees on every window of ${fixture}, as text and as JSON, and the vendored files are that output`, () => {
        const copy = copyOf(fixture);
        const root = join(FIXTURES, fixture);
        const assets = readAssets(root);
        for (const expected of expectedWindows(root, "trips")) {
          const flags = windowFlags(expected.name);
          const text = reference(copy, ["trips", ...flags]);
          const json = JSON.parse(reference(copy, ["trips", ...flags, "--json"])) as unknown;
          expect(text).toBe(expected.text);
          expect(json).toEqual(expected.json);
          const ours = readTrips(root, expected.options);
          expect(renderTrips(ours, assets)).toBe(text);
          expect(JSON.parse(JSON.stringify(ours))).toEqual(json);
        }
        for (const expected of expectedWindows(root, "countries")) {
          const flags = windowFlags(expected.name);
          const text = reference(copy, ["rollup", "countries", ...flags]);
          const json = JSON.parse(
            reference(copy, ["rollup", "countries", ...flags, "--json"]),
          ) as unknown;
          expect(text).toBe(expected.text);
          expect(json).toEqual(expected.json);
          const ours = rollupCountries(root, expected.options);
          expect(renderCountries(ours)).toBe(text);
          expect(JSON.parse(JSON.stringify(ours))).toEqual(json);
        }
        for (const expected of expectedWindows(root, "nights")) {
          const flags = windowFlags(expected.name);
          const text = reference(copy, ["rollup", "nights", ...flags]);
          const json = JSON.parse(
            reference(copy, ["rollup", "nights", ...flags, "--json"]),
          ) as unknown;
          expect(text).toBe(expected.text);
          expect(json).toEqual(expected.json);
          const ours = rollupNights(root, expected.options);
          expect(renderNights(ours)).toBe(text);
          expect(JSON.parse(JSON.stringify(ours))).toEqual(json);
        }
      }, 600_000);
    }

    it("agrees on the demo record (`logbook demo --days 30 --seed 7`): four trips, three countries, eighteen nights at home, as text and as JSON", () => {
      const demo = join(tempDir(), "demo");
      reference(REF as string, ["demo", "--days", "30", "--seed", "7", "--out", demo]);
      for (const flags of [
        [],
        ["--year", "2026"],
        ["--since", "2026-06-09", "--until", "2026-06-16"],
      ]) {
        const options = windowOptions(
          flags.length === 0
            ? "all"
            : flags.length === 2
              ? (flags[1] as string)
              : `${flags[1]}..${flags[3]}`,
        );
        const trips = readTrips(demo, options);
        expect(renderTrips(trips, readAssets(demo))).toBe(reference(demo, ["trips", ...flags]));
        expect(JSON.parse(JSON.stringify(trips))).toEqual(
          JSON.parse(reference(demo, ["trips", ...flags, "--json"])),
        );
        const countries = rollupCountries(demo, options);
        expect(renderCountries(countries)).toBe(reference(demo, ["rollup", "countries", ...flags]));
        expect(JSON.parse(JSON.stringify(countries))).toEqual(
          JSON.parse(reference(demo, ["rollup", "countries", ...flags, "--json"])),
        );
        const nights = rollupNights(demo, options);
        expect(renderNights(nights)).toBe(reference(demo, ["rollup", "nights", ...flags]));
        expect(JSON.parse(JSON.stringify(nights))).toEqual(
          JSON.parse(reference(demo, ["rollup", "nights", ...flags, "--json"])),
        );
      }
    }, 300_000);
  },
);

/** The fixtures that carry the reference's output for the readers added after `trips`: the conformance sample and the seed-1 demo among them. */
const READER_FIXTURES = [
  "sample-logbook",
  "demo-seed1",
  "day-sample",
  "trips-sample",
  "demo-sample",
  "show-sample",
  "profiles-sample",
];

describe.skipIf(!ready)(
  "the vendored demo record is the reference's `logbook demo --seed 1`",
  () => {
    it("has the same month files, head and settings as a fresh run of the reference", () => {
      const demo = join(tempDir(), "Logbook");
      reference(REF as string, ["demo", "--seed", "1", "--out", demo]);
      const vendored = join(FIXTURES, "demo-seed1");
      for (const rel of ["logbook.json", "places.json", "assets.json"]) {
        expect(readFileSync(join(demo, rel), "utf-8"), rel).toBe(
          readFileSync(join(vendored, rel), "utf-8"),
        );
      }
      for (const year of readdirSync(join(vendored, "logbook"))) {
        for (const month of readdirSync(join(vendored, "logbook", year))) {
          const rel = join("logbook", year, month);
          expect(readFileSync(join(demo, rel), "utf-8"), rel).toBe(
            readFileSync(join(vendored, rel), "utf-8"),
          );
        }
      }
    }, 120_000);
  },
);

describe.skipIf(!ready)("the reference implementation and logbook-ts read the same days", () => {
  for (const fixture of READER_FIXTURES) {
    it(`agrees on every window of ${fixture}, as text and as JSON Lines, and the vendored files are that output`, () => {
      const copy = copyOf(fixture);
      const root = join(FIXTURES, fixture);
      for (const expected of expectedDaysWindows(root)) {
        const flags =
          expected.options.from === undefined || expected.options.to === undefined
            ? []
            : ["--from", expected.options.from, "--to", expected.options.to];
        const text = reference(copy, ["days", ...flags]);
        const rows = reference(copy, ["days", ...flags, "--json"])
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line) as unknown);
        expect(text).toBe(expected.text);
        expect(rows).toEqual(expected.rows);
        const ours = readDayRows(root, expected.options);
        expect(renderDayRows(ours)).toBe(text);
        expect(ours.rows.map((row) => JSON.parse(JSON.stringify(row)))).toEqual(rows);
      }
    }, 300_000);
  }
});

describe.skipIf(!ready)("the reference implementation and logbook-ts know the same people", () => {
  for (const fixture of READER_FIXTURES) {
    it(`agrees on every window of ${fixture}, as text and as JSON, and the vendored files are that output`, () => {
      const copy = copyOf(fixture);
      const root = join(FIXTURES, fixture);
      for (const expected of expectedWindows(root, "people")) {
        const flags = windowFlags(expected.name);
        const text = reference(copy, ["people", ...flags]);
        const json = JSON.parse(reference(copy, ["people", ...flags, "--json"])) as unknown;
        expect(text).toBe(expected.text);
        expect(json).toEqual(expected.json);
        const ours = readPeople(root, expected.options);
        expect(renderPeople(ours, expected.options)).toBe(text);
        expect(JSON.parse(JSON.stringify(ours))).toEqual(json);
      }
    }, 300_000);
  }
});

/** `logbook <command…>` of the reference on a record, its exit status, stdout and stderr. */
function referenceAll(copy: string, args: string[]): { status: number; out: string; err: string } {
  const result = spawnSync("uv", ["run", "--project", REF as string, "logbook", ...args], {
    cwd: REF,
    encoding: "utf-8",
    env: { ...process.env, LOGBOOK_HOME: copy, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, out: result.stdout, err: result.stderr };
}

describe.skipIf(!ready)(
  "RFC 0036, under the rfc0036 flag: the reference and logbook-ts agree",
  () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    const fixture = join(FIXTURES, "rfc0036-sample");
    for (const { day, raw, text } of expectedShows(fixture)) {
      it(
        `show rfc0036-sample ${day}${raw ? " --raw" : ""}`,
        () => {
          vi.stubEnv(FLAGS_ENV, "rfc0036");
          const reference = referenceShow(copyOf("rfc0036-sample"), day, raw);
          expect(
            showDay(fixture, { day, raw }).text,
            "logbook-ts disagrees with the reference",
          ).toBe(reference);
          expect(reference, "the reference moved; re-capture rfc0036-sample/expected-show").toBe(
            text,
          );
        },
        CROSS_IMPL_BUDGET_MS,
      );
    }

    it("refuse a day_start that is not a clock in the same sentence, on every reader that groups by day", () => {
      // The reference prefixes its command (`show stats` says `show:`); the sentence after it is compared.
      const commands = [
        ["show", "2026-03-02"],
        ["day", "2026-03-02"],
        ["show", "days"],
        ["people"],
      ];
      for (const value of ["6am", "24:00", "6:00", 6, "06:00:00", "06:60", "", true, "00:00 "]) {
        const copy = copyOf("sample-logbook");
        writeMeta(copy, { ...readMetaFile(copy), day_start: value });
        let ours = "";
        try {
          readDayStart(readMetaFile(copy) as never);
        } catch (err) {
          ours = (err as Error).message;
        }
        for (const args of commands) {
          const { status, out, err } = referenceAll(copy, args);
          expect({ value, args, status, out }).toEqual({ value, args, status: 2, out: "" });
          // The last line: `uv` may say something of its own before it.
          const said = err.trimEnd().split("\n").at(-1) ?? "";
          expect(said.replace(/^[a-z]+: /, ""), `${JSON.stringify(value)}`).toBe(ours);
        }
      }
    }, 300_000);

    it("read a day's draft alike: the malformed list, each segment supported or not, and why, its part, the proposals and links, the evening, and the show row", () => {
      // The day's lines get the ids 00000000-0000-4000-8000-00000000000N, N their seq.
      const lineId = (n: number): string =>
        `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      const dayLines = [
        {
          at: "2026-06-13T07:30:00Z",
          source: "sim-phone",
          kind: "location",
          tier: 1 as const,
          payload: { schema: "location/v1", lat: 59.911, lon: 10.75, accuracy_m: 12 },
        },
        {
          at: "2026-06-13T14:10:00Z",
          source: "sim-camera",
          kind: "photo",
          tier: 1 as const,
          payload: { schema: "photo/v1", file: "IMG_0613.jpg" },
        },
        {
          at: "2026-06-13T16:00:00Z",
          source: "manual",
          kind: "note",
          tier: 2 as const,
          payload: { schema: "note/v1", text: "The engine sounded right." },
        },
      ];
      const good = [
        { text: "At home, then the boat.", evidence: [lineId(1)] },
        { text: "One photo from the pontoon.", evidence: [lineId(2)] },
        { text: "Ola came by.", unsupported: true },
      ];
      const event = {
        kind: "event",
        title: "At the boat",
        start: "2026-06-13T10:00:00Z",
        end: "2026-06-13T12:00:00Z",
        place: null,
        people: [],
        evidence: [lineId(1), lineId(2)],
      };
      // A kind no amendment names: since draft/v1 amendment 2 (2026-10-21) `link` is a known one.
      const goal = { kind: "goal", from: lineId(2), to: lineId(3) };
      const link = {
        kind: "link",
        entity: "019cadd3-6bc0-7dcd-9133-000000000401",
        text: "Crew list",
        evidence: [lineId(3)],
      };
      const five = [
        { text: "S1", evidence: [lineId(1)] },
        { text: "S2", evidence: [lineId(3)] },
        { text: "S3", evidence: [lineId(2)] },
        { text: "S4", evidence: [lineId(3)] },
        { text: "S5", unsupported: true },
      ];
      const variants: Array<Record<string, unknown>> = [
        {},
        { segments: [good[0], { text: "x", evidence: [lineId(2)], unsupported: true }] },
        { segments: [good[0], { text: "x" }, { text: "y", evidence: [] }] },
        { segments: [{ text: "x", unsupported: false }, good[2]] },
        {
          segments: [
            { text: "", evidence: [lineId(2)] },
            { text: 5, evidence: [lineId(2)] },
            "not a segment",
          ],
        },
        {
          segments: [
            { text: "x", evidence: [lineId(1), lineId(4)] },
            { text: "y", evidence: ["019cadd3-6bc0-7dcd-9133-0000000009ff"] },
          ],
        },
        { segments: [] },
        { segments: "text" },
        { read_head: undefined, read_count: "5", language: "english", supersedes: 5 },
        { read_head: "AB".repeat(32), read_count: -1, language: "en-GB", supersedes: "" },
        { read_count: true, language: "zh-Hant-TW", supersedes: null },
        // draft/v1, forward compatibility (2026-10-19): a kind the reader does not know is counted,
        // not malformed, and a known one keeps its number.
        { proposals: [goal] },
        { proposals: [event, goal] },
        { proposals: [goal, goal, event] },
        { proposals: [{ kind: "  " }, event] },
        { proposals: [{ ...event, title: "" }, event] },
        { proposals: [5, {}, event] },
        { proposals: null },
        // An event: `place` may be left out, an id any non-empty string, the instants compared to
        // the last digit; evidence off the day is shown unsupported.
        {
          proposals: [
            {
              kind: "event",
              title: "t",
              start: event.start,
              end: event.end,
              people: ["  "],
              evidence: [lineId(1)],
            },
          ],
        },
        {
          proposals: [
            { ...event, start: "2026-06-13T10:00:00.1234Z", end: "2026-06-13T10:00:00.1235Z" },
          ],
        },
        { proposals: [{ ...event, end: "2026-06-13T10:00:00Z" }] },
        { proposals: [{ ...event, people: [""] }] },
        { proposals: [{ ...event, evidence: [lineId(1), lineId(9)] }] },
        // draft/v1 amendment 2 (2026-10-21): links, numbered among all the proposals.
        { proposals: [link] },
        { proposals: [{ ...link, note: "from the note" }] },
        { proposals: [event, link, goal] },
        { proposals: [link, { ...link, text: "Two" }, event], supersedes: lineId(2) },
        { proposals: [{ ...link, entity: "crew", evidence: ["  ", lineId(3)] }] },
        { proposals: [{ ...link, evidence: [lineId(9)] }] },
        { proposals: [{ kind: "link", from: lineId(2), to: lineId(3) }, link] },
        { proposals: [{ ...link, text: "  " }] },
        { proposals: [{ ...link, note: null }] },
        { proposals: [{ ...link, evidence: [""] }] },
        { proposals: [{ ...event, kind: "Link" }] },
        // dream-day/4: each segment's part and an idea's entity, the evening, and what was dropped.
        {
          segments: five,
          extra: { parts: ["story", "decision", "photo", "lens:money", "ideas"] },
        },
        { segments: five, extra: { parts: ["day", "threads", "questions", "people", "promises"] } },
        { segments: five, extra: { parts: ["month", "lens:", "lens:a b", 5, "Story"] } },
        { segments: five, extra: { parts: ["story", "learned"] } },
        {
          segments: five,
          extra: {
            parts: ["ideas", "ideas", "story", "ideas", "ideas"],
            ideas: [
              { segment: 0, entity: "E0" },
              { segment: 1, entity: "E1" },
              { segment: 3, entity: "E3" },
              { segment: 4, entity: "first" },
              { segment: 4, entity: "E4" },
              { segment: 5, entity: 5 },
              { segment: "2", entity: "E2" },
            ],
          },
        },
        { extra: { evening: true, read_until: "2026-06-13T18:00:00Z" } },
        { extra: { evening: true, read_until: "2026-06-13T18:00:00+00:00" } },
        { extra: { evening: true } },
        { extra: { evening: false, read_until: "x" } },
        { extra: { read_until: "x" } },
        { extra: "x" },
        // What can be kept, numbered after every proposal (the reference at a6ee131).
        {
          segments: five,
          extra: { parts: ["learned", "decision", "story", "ideas", "photo"] },
          proposals: [event, link, goal],
        },
        {
          segments: [{ text: "held: a number beside a name", unsupported: true }, ...five.slice(1)],
          extra: { parts: ["learned", "day", "photo", "photo", "decision"] },
          proposals: [{ ...link, text: "" }],
        },
        {
          segments: five,
          extra: { parts: ["learned", "learned", "ideas", "decision", "photo"] },
          proposals: "x",
        },
        { extra: null },
        {
          extra: {
            marked: { "a number beside a person": 2 },
            dropped: [1],
            dropped_links: { a: "b" },
            dropped_segments: null,
          },
        },
      ];
      const readBoth = (variant: Record<string, unknown>) => {
        const payload: Record<string, unknown> = {
          schema: "draft/v1",
          unit: "day",
          subject: "2026-06-13",
          read_head: "bb97e90d3f946f6cc637e5e223b080ada65e2beb12b07293727e28d2a279b3d8",
          read_count: 3,
          language: "en",
          segments: good,
        };
        for (const [key, value] of Object.entries(variant)) {
          if (value === undefined) delete payload[key];
          else payload[key] = value;
        }
        const draft = {
          at: "2026-06-14T06:10:00Z",
          source: "model:qwen2.5-7b-instruct",
          kind: "draft",
          tier: 2 as const,
          payload,
        };
        const root = writeRecord([...dayLines, draft]);
        // The reference's Day shows a draft only while the `dream` entry of the crossing policy
        // allows its tier (its #273, docs/dream.md, *When the entry changes*); without the entry it
        // says `draft_withheld`. The entry here allows the draft's tier 2 and names no model.
        mkdirSync(join(root, "policy"), { recursive: true });
        writeFileSync(
          join(root, "policy", "crossing.json"),
          `${JSON.stringify({ dream: { max_tier: 2 } })}\n`,
          "utf-8",
        );
        const { status, out } = referenceAll(root, ["day", "2026-06-13", "--json"]);
        expect(status).toBe(0);
        const theirs = (
          JSON.parse(out) as {
            draft: {
              malformed: string[];
              segments: Array<Record<string, unknown>>;
              unsupported: number;
              proposals?: Array<Record<string, unknown>> | null;
              proposals_unknown: number;
              links: Array<Record<string, unknown>>;
              evening: boolean;
              read_until: string | null;
              marked: unknown;
              dropped: unknown;
              dropped_links: unknown;
              dropped_segments: unknown;
            };
          }
        ).draft;
        // The row `show` prints for the draft, on the day it was written.
        const shown = referenceAll(root, ["show", "2026-06-14"]);
        expect(shown.status).toBe(0);
        const theirRow = shown.out.split("\n").find((r) => r.includes("draft of "));
        const line = JSON.parse(
          readFileSync(join(root, "logbook", "2026", "06.jsonl"), "utf-8")
            .trim()
            .split("\n")[3] as string,
        );
        const ours = readDraft(line, new Set(dayLines.map((_, i) => lineId(i + 1))));
        expect({ variant, unknown: ours.proposals_unknown, shown: ours.proposals.length }).toEqual({
          variant,
          unknown: theirs.proposals_unknown,
          shown: theirs.proposals?.length ?? null,
        });
        expect({ variant, row: draftRow(line.payload) }).toEqual({
          variant,
          row: theirRow?.slice(theirRow.indexOf("draft of ")),
        });
        return { ours, theirs };
      };
      // What the reference's Day reads beside the line, which `readDraft` does not (SPEC-QUESTIONS 119).
      const beside = ["start_local", "end_local", "where", "confirmed", "kept"];
      // An event's people the Day names (`{id, name}`); the line gives their ids.
      const lineOnly = (shown: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(shown)
            .filter(([key]) => !beside.includes(key))
            .map(([key, value]) =>
              key === "people" && Array.isArray(value)
                ? [key, value.map((p: { id: unknown }) => p.id)]
                : [key, value],
            ),
        );
      for (const variant of variants) {
        const { ours, theirs } = readBoth(variant);
        expect({ variant, malformed: ours.malformed }).toEqual({
          variant,
          malformed: theirs.malformed,
        });
        expect(ours.unsupported).toBe(theirs.unsupported);
        expect({ variant, segments: ours.segments }).toEqual({
          variant,
          segments: theirs.segments.map(lineOnly),
        });
        expect({ variant, proposals: ours.proposals, links: ours.links }).toEqual({
          variant,
          proposals: (theirs.proposals ?? []).map(lineOnly),
          links: theirs.links.map(lineOnly),
        });
        const { evening, read_until, marked, dropped, dropped_links, dropped_segments } = ours;
        expect({
          variant,
          extra: { evening, read_until, marked, dropped, dropped_links, dropped_segments },
        }).toEqual({
          variant,
          extra: {
            evening: theirs.evening,
            read_until: theirs.read_until,
            marked: theirs.marked,
            dropped: theirs.dropped,
            dropped_links: theirs.dropped_links,
            dropped_segments: theirs.dropped_segments,
          },
        });
      }
      // A known kind of the wrong shape is still malformed in both, in the same words since the
      // reference's main at 6ee01c2 (SPEC-QUESTIONS 117, answered).
      for (const proposals of [
        [{ ...event, title: "" }, goal],
        [{ ...link, text: "" }, event],
      ]) {
        const { ours, theirs } = readBoth({ proposals });
        expect(ours.malformed).toEqual(theirs.malformed);
        expect(ours.malformed).toHaveLength(1);
      }
    }, 300_000);
  },
);

describe.skipIf(!ready)(
  "a payment and its receipt counted once (the reference's #406): the reference and logbook-ts agree",
  () => {
    for (const c of RECEIPT_CASES) {
      it(c.name, () => {
        const root = writeBareRecord(c.lines);
        for (const day of Object.keys(c.expected)) {
          const theirs = JSON.parse(reference(root, ["day", day, "--json"])) as { spend: unknown };
          const text = reference(root, ["day", day]);
          const ours = readDay(root, { day });
          expect({ day, spend: JSON.parse(JSON.stringify(ours.spend)) }).toEqual({
            day,
            spend: theirs.spend,
          });
          const row = (t: string) => t.split("\n").find((l) => l.startsWith("  spend ")) ?? "";
          expect({ day, row: row(renderDay(ours)) }).toEqual({
            day,
            row: row(comparableDayText(text)),
          });
          expect(
            { day, json: theirs.spend, text: row(text).trim() },
            "the reference moved; tests/receipts-cases.ts holds its output",
          ).toEqual({ day, ...(c.expected[day] as { json: unknown; text: string }) });
        }
      }, 120_000);
    }
  },
);

describe.skipIf(!ready)(
  "who a note says was there (SPEC §3.2.5 rule 3): the reference and logbook-ts agree",
  () => {
    it("every case of tests/with-cases.ts, a day each: the names of `days --json`, and the Day's with row", () => {
      const root = withRecord();
      const theirs = new Map<string, string[]>();
      for (const row of reference(root, ["days", "--json"]).trim().split("\n")) {
        const { day, people } = JSON.parse(row) as { day: string; people: { names: string[] } };
        theirs.set(day, people.names);
      }
      const ours = new Map(readDayRows(root, {}).rows.map((r) => [r.day, r.people.names]));
      for (const [i, c] of WITH_CASES.entries()) {
        const day = caseDay(i);
        expect({ text: c.text, names: ours.get(day) }).toEqual({
          text: c.text,
          names: theirs.get(day),
        });
        expect(
          { text: c.text, names: theirs.get(day) },
          "the reference moved; tests/with-cases.ts holds its output",
        ).toEqual({ text: c.text, names: c.expected });
      }
      // Five days read as text: the with row the Day prints from the note. (Not the whole Day: a
      // stay whose next point lies past the Day's window ends at 24:00 in the reference and at its last
      // point here, SPEC-QUESTIONS 123.)
      const withRows = (text: string): string[] =>
        text.split("\n").filter((row) => row.trimStart().startsWith("with "));
      for (const i of [0, 1, 20, 39, 53]) {
        const day = caseDay(i);
        expect({ day, rows: withRows(renderDay(readDay(root, { day }))) }).toEqual({
          day,
          rows: withRows(comparableDayText(reference(root, ["day", day]))),
        });
      }
    }, 300_000);
  },
);

describe.skipIf(!ready)(
  "RFC 0037 and RFC 0038 §2, under the rfc0037 and rfc0038 flags: the reference and logbook-ts agree",
  () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    // A record the reference wrote with its own writers (rfc0037-0038-sample/make.py): entity,
    // entity-review, people-review and status lines, the status notes, the registry entries closed,
    // and transcripts with voices, heard again and retracted. One copy serves every run of the
    // reference, which builds its index beside it once; it lives outside the folders each test
    // cleans up, and goes when the block ends.
    const fixture = join(FIXTURES, "rfc0037-0038-sample");
    let copy: string | undefined;
    const shared = (): string => {
      if (copy === undefined) {
        copy = join(mkdtempSync(join(tmpdir(), "logbook-ts-rfc0037-")), "rfc0037-0038-sample");
        cpSync(fixture, copy, {
          recursive: true,
          filter: (src) => !basename(src).startsWith("expected-"),
        });
      }
      return copy;
    };
    afterAll(() => {
      if (copy !== undefined) rmSync(join(copy, ".."), { recursive: true, force: true });
    });

    for (const { day, raw, text } of expectedShows(fixture)) {
      it(
        `show rfc0037-0038-sample ${day}${raw ? " --raw" : ""}`,
        () => {
          vi.stubEnv(FLAGS_ENV, "rfc0037,rfc0038");
          const reference = referenceShow(shared(), day, raw);
          expect(
            showDay(fixture, { day, raw }).text,
            "logbook-ts disagrees with the reference",
          ).toBe(reference);
          expect(
            reference,
            "the reference moved; re-capture rfc0037-0038-sample/expected-show",
          ).toBe(text);
        },
        CROSS_IMPL_BUDGET_MS,
      );
    }

    it("day, every day with a line, as text and as JSON, and the vendored files are that output", () => {
      vi.stubEnv(FLAGS_ENV, "rfc0037,rfc0038");
      for (const expected of expectedDays(fixture)) {
        const text = reference(shared(), ["day", expected.day]);
        const json = JSON.parse(reference(shared(), ["day", expected.day, "--json"])) as unknown;
        expect(text).toBe(expected.raw.text);
        expect(json).toEqual(expected.raw.json);
        const ours = readDay(fixture, { day: expected.day });
        expect(renderDay(ours), expected.day).toBe(comparableDayText(text));
        expect(JSON.parse(JSON.stringify(ours)), expected.day).toEqual(comparableDayJson(json));
      }
    }, 600_000);

    it("people and days, as text and as JSON, and the vendored files are that output", () => {
      vi.stubEnv(FLAGS_ENV, "rfc0037,rfc0038");
      for (const expected of expectedWindows(fixture, "people")) {
        const flags = windowFlags(expected.name);
        const text = reference(shared(), ["people", ...flags]);
        const json = JSON.parse(reference(shared(), ["people", ...flags, "--json"])) as unknown;
        expect(text).toBe(expected.text);
        expect(json).toEqual(expected.json);
        const ours = readPeople(fixture, expected.options);
        expect(renderPeople(ours, expected.options)).toBe(text);
        expect(JSON.parse(JSON.stringify(ours))).toEqual(json);
      }
      for (const expected of expectedDaysWindows(fixture)) {
        const text = reference(shared(), ["days"]);
        const rows = reference(shared(), ["days", "--json"])
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line) as unknown);
        expect(text).toBe(expected.text);
        expect(rows).toEqual(expected.rows);
        const ours = readDayRows(fixture, expected.options);
        expect(renderDayRows(ours)).toBe(text);
        expect(ours.rows.map((row) => JSON.parse(JSON.stringify(row)))).toEqual(rows);
      }
    }, 300_000);
  },
);

describe.skipIf(!ready)(
  "a line superseded twice (the reference's #321): the reference and logbook-ts agree",
  () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    // The six rows of the reference's table and the same rule for a flight, a person's name and a
    // person's transcripts: `show` and the Day of each record, and `people`, of both implementations.
    for (const c of [...TRANSCRIPT_CASES, ...FLIGHT_CASES]) {
      it(`show and day: ${c.name}`, () => {
        if (TRANSCRIPT_CASES.includes(c)) vi.stubEnv(FLAGS_ENV, "rfc0038");
        const root = writeRecord(c.lines);
        const theirs = reference(root, ["show", c.day]);
        expect(showDay(root, { day: c.day }).text).toBe(theirs);
        expect(theirs, "the reference moved; tests/superseded-cases.ts holds its output").toBe(
          c.show,
        );
        const day = reference(root, ["day", c.day]);
        expect(renderDay(readDay(root, { day: c.day }))).toBe(comparableDayText(day));
        expect(dayRows(day)).toEqual(c.rows);
      }, 60_000);
    }

    for (const c of PEOPLE_CASES) {
      it(`people: ${c.name}`, () => {
        const root = writeRecord(c.lines);
        const theirs = reference(root, ["people"]);
        expect(renderPeople(readPeople(root, {}), {})).toBe(theirs);
        expect(theirs, "the reference moved; tests/superseded-cases.ts holds its output").toBe(
          c.people,
        );
      }, 60_000);
    }
  },
);

describe.skipIf(!ready)(
  "who spoke (RFC 0038 §3), under the rfc0038 flag: the reference and logbook-ts agree",
  () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    // A transcript's voices bound to people by `speaker` refs: the Day, as text and as JSON, and
    // `people`, as text and as JSON, of both implementations on each record of tests/speakers-cases.ts.
    for (const c of SPEAKER_CASES) {
      it(c.name, () => {
        vi.stubEnv(FLAGS_ENV, "rfc0038");
        const root = speakerRecord(c);
        const text = reference(root, ["day", "2026-10-03"]);
        const json = JSON.parse(reference(root, ["day", "2026-10-03", "--json"])) as unknown;
        const ours = readDay(root, { day: "2026-10-03" });
        expect(renderDay(ours)).toBe(comparableDayText(text));
        expect(JSON.parse(JSON.stringify(ours))).toEqual(comparableDayJson(json));
        const people = reference(root, ["people"]);
        const peopleJson = JSON.parse(reference(root, ["people", "--json"])) as Record<
          string,
          unknown
        >;
        const report = readPeople(root, {});
        expect(renderPeople(report, {})).toBe(people);
        expect(JSON.parse(JSON.stringify(report))).toEqual(peopleJson);
        expect(
          observed(text, json, people, peopleJson),
          "the reference moved; tests/speakers-cases.ts holds its output",
        ).toEqual(c.expected);
      }, 120_000);
    }
  },
);

describe.skipIf(!ready)(
  "stars, keepers and the owner's no on a scene (RFC 0041, RFC 0024's amendment, RFC 0040 §5), under the rfc0040 and rfc0041 flags: the reference and logbook-ts agree",
  () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    // `show` and the Day of both implementations, as text and as JSON, on each record of
    // tests/marks-cases.ts, and the reference's output the same as the one held there.
    for (const c of MARKS_CASES) {
      it(c.name, () => {
        vi.stubEnv(FLAGS_ENV, "rfc0040,rfc0041");
        const root = marksRecord(c);
        const show = reference(root, ["show", MARKS_DAY]);
        expect(showDay(root, { day: MARKS_DAY }).text).toBe(show);
        const text = reference(root, ["day", MARKS_DAY]);
        const json = JSON.parse(reference(root, ["day", MARKS_DAY, "--json"])) as {
          stars?: unknown;
        };
        const ours = readDay(root, { day: MARKS_DAY });
        expect(renderDay(ours)).toBe(comparableDayText(text));
        expect(JSON.parse(JSON.stringify(ours))).toEqual(comparableDayJson(json));
        expect(
          { show, day: text, stars: json.stars ?? null },
          "the reference moved; tests/marks-cases.ts holds its output",
        ).toEqual(c.expected);
      }, 120_000);
    }
  },
);

describe.skipIf(!ready)(
  "a re-sign keeps the standing signature's confirmations (RFC 0034 amendment 4): the reference writes, both read alike",
  () => {
    // The reference signs a synthetic day, then signs it again four ways; after each, `show` of the
    // day and of the next (where a re-sign is written) and the Day's `signed` must be the same in
    // both implementations, and the confirmed set what amendment 4 says it is.
    it("keeps the confirmations, drops one retracted since, clears the note, takes the whole page", () => {
      const at = (h: number): string => `2026-10-03T${String(h).padStart(2, "0")}:00:00Z`;
      const root = writeBareRecord([
        {
          at: "2026-10-03T16:00:00Z",
          end: "2026-10-03T18:00:00Z",
          source: "sim-cal",
          kind: "event",
          tier: 1,
          payload: { schema: "event/v1", title: "Middag", raw_id: "middag" },
        },
        {
          at: at(16),
          source: "manual",
          kind: "note",
          payload: { schema: "note/v1", text: "god mat" },
        },
        {
          at: "2026-10-03T16:25:00Z",
          source: "phone",
          kind: "call",
          tier: 1,
          payload: {
            schema: "call/v1",
            counterparty: { kind: "phone", value: "+447700900123" },
            direction: "outgoing",
            duration_s: 60,
            answered: true,
            raw_id: "c1",
          },
        },
        {
          at: at(19),
          source: "manual",
          kind: "note",
          payload: { schema: "note/v1", text: "seint" },
        },
      ]);
      const agree = (): { confirmed: number; note: unknown; dispositions: unknown } => {
        const json = JSON.parse(reference(root, ["day", "2026-10-03", "--json"])) as {
          signed: { confirmed: number; note: unknown; dispositions: unknown };
        };
        expect(JSON.parse(JSON.stringify(readDay(root, { day: "2026-10-03" }).signed))).toEqual(
          json.signed,
        );
        for (const day of ["2026-10-03", "2026-10-04"])
          expect(showDay(root, { day }).text, day).toBe(reference(root, ["show", day]));
        return json.signed;
      };
      const sign = (...args: string[]): string =>
        reference(root, ["day", "sign", "2026-10-03", ...args]);

      sign("--confirm", "1,3", "--kept", "3", "--note", "første", "--at", "2026-10-03T20:00:00Z");
      expect(agree()).toMatchObject({ confirmed: 2, note: "første" });
      // Signed again without --confirm: the two kept, the disposition and the note with them.
      expect(sign("--at", "2026-10-04T08:00:00Z")).toContain(
        "keeps from the signature it supersedes (#5): 2 lines confirmed, kept 1, the note",
      );
      expect(agree()).toMatchObject({
        confirmed: 2,
        note: "første",
        dispositions: { "00000000-0000-4000-8000-000000000003": "kept" },
      });
      // A confirmed line retracted since is dropped, never refused; `--note ""` clears the note.
      reference(root, ["repair", "retract", "1", "feil"]);
      sign("--note", "", "--at", "2026-10-04T09:00:00Z");
      expect(agree()).toMatchObject({ confirmed: 1, note: null });
      // `--confirm all` is a fresh reading: the whole page not retracted.
      sign("--confirm", "all", "--at", "2026-10-04T10:00:00Z");
      expect(agree()).toMatchObject({ confirmed: 3 });
      expect(verifyLogbook(root).valid).toBe(true);
    }, 300_000);
  },
);
