import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { readDay } from "../src/day.js";
import { renderDay } from "../src/dayText.js";
import { showDay } from "../src/show.js";
import { gapsText, sourceGaps } from "../src/sources.js";
import { collectStats, statsText } from "../src/stats.js";
import { cleanup, expectedDays, expectedShows, FIXTURES, tempDir } from "./helpers.js";

/**
 * The two implementations must print the same day, and count the same record. This test runs the
 * reference implementation (openlogbook, Python) on a copy of each fixture and diffs its `show`
 * output against ours, and against the expected-show files we vendor; then its `stats` and
 * `sources --gaps` against ours, on the fixtures and on its own demo record. It needs a clone of https://github.com/bighydro/logbook
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
    filter: (src) => !src.includes("expected-"),
  });
  return copy;
}

describe.skipIf(!ready)("the reference implementation and logbook-ts print the same day", () => {
  // sample-logbook (the conformance sample) is diffed whole: since b3cd8c5 (2026-10-02) the reference
  // reads every one of its eight days as SPEC §3.2 says (SPEC-QUESTIONS 24, 25, 27 and 40).
  for (const name of ["show-sample", "profiles-sample", "sample-logbook"]) {
    const root = join(FIXTURES, name);
    for (const { day, raw, text } of expectedShows(root)) {
      it(`${name} ${day}${raw ? " --raw" : ""}`, () => {
        const copy = join(tempDir(), name);
        cpSync(root, copy, { recursive: true });
        const reference = referenceShow(copy, day, raw);
        const ours = showDay(root, { day, raw }).text;
        expect(ours, "logbook-ts disagrees with the reference").toBe(reference);
        expect(reference, "the reference moved; re-capture tests/fixtures/*/expected-show").toBe(
          text,
        );
      });
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
      for (const expected of expectedDays(join(FIXTURES, fixture))) {
        const text = reference(copy, ["day", expected.day]);
        const json = JSON.parse(reference(copy, ["day", expected.day, "--json"])) as unknown;
        expect(text).toBe(expected.text);
        expect(json).toEqual(expected.json);
        const ours = readDay(join(FIXTURES, fixture), { day: expected.day });
        expect(renderDay(ours)).toBe(text);
        expect(JSON.parse(JSON.stringify(ours))).toEqual(json);
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
      expect(renderDay(ours)).toBe(text);
      expect(JSON.parse(JSON.stringify(ours))).toEqual(json);
    }
  }, 120_000);
});

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
    it(`${name}: stats`, () => {
      const theirs = referenceRun(copy(), ["stats"]);
      expect(theirs.status).toBe(0);
      const ours = statsText(collectStats(root));
      expect(comparableStats(ours, true)).toBe(comparableStats(theirs.stdout, false));
    });
    it(`${name}: stats --json`, () => {
      const theirs = JSON.parse(referenceRun(copy(), ["stats", "--json"]).stdout) as Json;
      const ours = JSON.parse(JSON.stringify(collectStats(root))) as Json;
      for (const key of ["took_seconds", "tiers", "months"]) delete ours[key];
      delete theirs.took_seconds;
      expect(ours).toEqual(theirs);
    });
    for (const args of [[], ["--since", since]]) {
      it(`${name}: sources --gaps ${args.join(" ")}`.trimEnd(), () => {
        const theirs = referenceRun(copy(), ["sources", "--gaps", ...args]);
        expect(theirs.status).toBe(0);
        const options = args.length ? { since } : {};
        const ours = gapsText(sourceGaps(root, options));
        expect(ours).toBe(comparableGaps(theirs.stdout));
        const json = referenceRun(copy(), ["sources", "--gaps", "--json", ...args]);
        expect(comparableGapsJson(JSON.stringify(sourceGaps(root, options)))).toEqual(
          comparableGapsJson(json.stdout),
        );
      });
    }
    it(`${name}: sources --gaps --expect, a source silent for days and one with no line`, () => {
      const theirs = referenceRun(copy(), [
        "sources",
        "--gaps",
        "--since",
        since,
        "--expect",
        "manual",
        "nothing",
      ]);
      expect(theirs.status).toBe(1);
      const ours = sourceGaps(root, { since, expect: ["manual", "nothing"] });
      expect(gapsText(ours)).toBe(comparableGaps(theirs.stdout));
    });
  }
});
