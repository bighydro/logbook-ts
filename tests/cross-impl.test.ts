import { spawnSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { showDay } from "../src/show.js";
import { cleanup, expectedShows, FIXTURES, tempDir } from "./helpers.js";

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

/** `logbook show <day> [--raw]` of the reference on a disposable copy of the fixture (it writes an index). */
function referenceShow(copy: string, day: string, raw: boolean): string {
  const args = [
    "run",
    "--project",
    REF as string,
    "logbook",
    "show",
    day,
    ...(raw ? ["--raw"] : []),
  ];
  const result = spawnSync("uv", args, {
    cwd: REF,
    encoding: "utf-8",
    env: { ...process.env, LOGBOOK_HOME: copy, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`reference exited ${result.status}:\n${result.stderr}`);
  return result.stdout;
}

describe.skipIf(!ready)("the reference implementation and logbook-ts print the same day", () => {
  for (const name of ["show-sample", "profiles-sample"]) {
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
