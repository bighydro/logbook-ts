import { spawnSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDay } from "../src/day.js";
import { renderDay } from "../src/dayText.js";
import { showDay } from "../src/show.js";
import { cleanup, expectedDays, expectedShows, FIXTURES, tempDir } from "./helpers.js";

/**
 * The two implementations must print the same day. This test runs the reference implementation
 * (openlogbook, Python) on a copy of each fixture and diffs its `show` output against ours, and
 * against the expected-show files we vendor. It needs a clone of https://github.com/bighydro/logbook
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
