import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import {
  cleanup,
  copySample,
  cutInsideLastLine,
  EXPECTED,
  readLines,
  writeLines,
} from "./helpers.js";

/**
 * The CLI as a writer: `add` under the record's writer lock (`--no-wait`, a stale lock taken over),
 * and `add` and `repair tail` on the files ahead of logbook.json (SPEC §3, write order; decision B).
 */

afterEach(cleanup);

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

describe("logbook-ts add under the writer lock", () => {
  /** A `state/writer.lock` as the reference writes it, planted by hand. */
  function plantLock(root: string, text: string): void {
    mkdirSync(join(root, "state"), { recursive: true });
    writeFileSync(join(root, "state", "writer.lock"), text, "utf-8");
  }

  it("with --no-wait, says who holds the writer lock as the reference does, exits 2 and writes nothing", () => {
    const root = copySample();
    // A living holder that is not this process: a detached child that outlives the test.
    const holder = spawnSync(
      process.execPath,
      [
        "-e",
        `const c = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { detached: true, stdio: "ignore", windowsHide: true }); c.unref(); process.stdout.write(String(c.pid));`,
      ],
      { encoding: "utf-8" },
    );
    plantLock(
      root,
      `{"pid": ${Number(holder.stdout)}, "command": "sync immich", "since": "2026-10-13T06:00:00Z"}`,
    );
    for (const argv of [
      ["add", root, "--no-wait", "held"],
      ["add", root, "held", "--no-wait"],
    ]) {
      const { code, out, err } = run(argv);
      expect(code).toBe(2);
      expect(out).toBe("");
      expect(err).toBe(
        "add: another logbook command is writing to this record (sync immich, since 2026-10-13T06:00:00Z); --no-wait, so not waiting\n",
      );
    }
    expect(readLines(root)).toHaveLength(32);
    rmSync(join(root, "state"), { recursive: true, force: true });
  });

  it("takes over a stale lock with one line on stderr, and appends", () => {
    const root = copySample();
    const pid = spawnSync(process.execPath, ["-e", ""]).pid;
    plantLock(root, `{"pid": ${pid}, "command": "add", "since": "2026-10-13T06:00:00Z"}`);
    const { code, out, err } = run(["add", root, "after a stale lock"]);
    expect(code).toBe(0);
    expect(err).toBe(
      `a stale lock from add (pid ${pid}, since 2026-10-13T06:00:00Z) whose process is gone; taking it over\n`,
    );
    expect(out).toMatch(/^added seq 33 /);
    expect(existsSync(join(root, "state"))).toBe(false);
  });
});

describe("logbook-ts add and repair tail on the files ahead of logbook.json (SPEC §3; decision B)", () => {
  const short = (hash: string): string => `${hash.slice(0, 12)}…`;
  const metaText = (root: string): string => readLines(root, "logbook.json").join("\n");

  /** The sample with one line added and logbook.json set back to the sample's head, as a crash leaves it. */
  function lagging(): { root: string; month: string; head: string } {
    const root = copySample();
    const { out } = run(["add", root, "made it to disk"]);
    const at = /at (\d{4})-(\d{2})-/.exec(out) as RegExpExecArray;
    const month = join("logbook", at[1] as string, `${at[2]}.jsonl`);
    const head = (JSON.parse(readLines(root, month).at(-1) as string) as { hash: string }).hash;
    const meta = JSON.parse(metaText(root)) as Record<string, unknown>;
    writeLines(
      root,
      [JSON.stringify({ ...meta, seq: 32, head: EXPECTED.head }, null, 2)],
      "logbook.json",
    );
    return { root, month, head };
  }

  it("add refuses with the reference's sentence naming repair tail on stderr, exits 2 and writes nothing (was: brought logbook.json forward with a line on stderr)", () => {
    const { root, month, head } = lagging();
    const before = metaText(root);
    const { code, out, err } = run(["add", root, "two"]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toBe(
      `add: the files are ahead of logbook.json: they end at seq 33 head ${short(head)}, logbook.json says seq 32 head ${short(EXPECTED.head)} (a crash between a line and logbook.json, SPEC §3); nothing was written: run \`logbook-ts repair tail\`\n`,
    );
    expect(readLines(root, month)).toHaveLength(1);
    expect(metaText(root)).toBe(before);
  });

  it("repair tail --dry-run prints the tail and what it would set, exits 0 and writes nothing; repair tail brings logbook.json forward and ends with verify's verdict; add then appends", () => {
    const { root, month, head } = lagging();
    const before = metaText(root);
    const header = `logbook.json says seq=32 head=${short(EXPECTED.head)}; the files hold 1 line past it, each verified (envelope, seq, prev, hash):\n  seq 33  ${month} line 1  hash ${short(head)}\n`;
    const dry = run(["repair", "tail", root, "--dry-run"]);
    expect(dry).toEqual({
      code: 0,
      out: `${header}would set logbook.json to seq=33 head=${short(head)}\nnothing written — run without --dry-run to repair\n`,
      err: "",
    });
    expect(metaText(root)).toBe(before);

    const done = run(["repair", "tail", root]);
    expect(done).toEqual({
      code: 0,
      out: `${header}logbook.json: seq 33, head ${short(head)}\nvalid — 33 lines, head ${head}\n`,
      err: "",
    });
    expect(run(["verify", root]).code).toBe(0);
    expect(run(["repair", "tail", root])).toEqual({
      code: 0,
      out: `nothing to repair: the files end where logbook.json says, seq=33 head=${short(head)}\n`,
      err: "",
    });
    expect(run(["add", root, "two"]).out).toMatch(/^added seq 34 /);
  });

  it("repair tail refuses with `repair tail: …; nothing was changed` and exit 2: the files behind logbook.json, the same seq under another head, a torn tail", () => {
    const behind = copySample();
    const meta = JSON.parse(metaText(behind)) as Record<string, unknown>;
    writeLines(behind, [JSON.stringify({ ...meta, seq: 33 })], "logbook.json");
    expect(run(["repair", "tail", behind])).toEqual({
      code: 2,
      out: "",
      err: `repair tail: logbook.json says seq=33 head=${short(EXPECTED.head)}, the files end at seq=32 head=${short(EXPECTED.head)}: the files are behind logbook.json, which no crash leaves (SPEC §3); restore the month files from a backup; nothing was changed\n`,
    });

    const other = copySample();
    writeLines(other, [JSON.stringify({ ...meta, head: "a".repeat(64) })], "logbook.json");
    const sameSeq = run(["repair", "tail", other]);
    expect(sameSeq.code).toBe(2);
    expect(sameSeq.err).toMatch(
      /^repair tail: .*no line is past the head and the head is not the files'; run `logbook-ts verify`; nothing was changed\n$/,
    );

    const { root, month } = lagging();
    cutInsideLastLine(root, month);
    writeLines(root, [JSON.stringify({ ...meta })], "logbook.json");
    expect(run(["repair", "tail", root])).toEqual({
      code: 2,
      out: "",
      err: `repair tail: ${month} line 1: the file ends inside this line (cut short); nothing was changed\n`,
    });
  });

  it("add on a lagging record whose tail does not verify refuses as the reference does, observed: one sentence on stderr naming repair tail, exit 2, nothing written — a month file cut inside its last line; a line past the head whose hash does not recompute", () => {
    // The reference (openlogbook 0.6.1, run on the same records): its `add` looks at the files' end
    // only, so a lag whose tail is wrong is refused in the lag's sentence, and a tail cut inside its
    // last line in verify's cut-short sentence; each one line, exit 2, nothing written.
    const torn = lagging();
    cutInsideLastLine(torn.root, torn.month);
    writeLines(
      torn.root,
      [
        JSON.stringify(
          { ...JSON.parse(metaText(torn.root)), seq: 32, head: EXPECTED.head },
          null,
          2,
        ),
      ],
      "logbook.json",
    );
    const before = metaText(torn.root);
    const ran = run(["add", torn.root, "two"]);
    expect(ran.out).toBe("");
    expect(ran.err).toBe(
      `add: ${torn.month} line 1: the file ends inside this line (cut short); nothing was written: run \`logbook-ts repair tail\`\n`,
    );
    expect(ran.code).toBe(2);
    expect(metaText(torn.root)).toBe(before);

    const wrong = lagging();
    const rows = readLines(wrong.root, wrong.month);
    const line = JSON.parse(rows[0] as string) as { hash: string; payload: { text: string } };
    writeLines(
      wrong.root,
      [JSON.stringify({ ...line, payload: { ...line.payload, text: "edited" } })],
      wrong.month,
    );
    const again = run(["add", wrong.root, "two"]);
    expect(again.out).toBe("");
    expect(again.err).toBe(
      `add: the files are ahead of logbook.json: they end at seq 33 head ${short(line.hash)}, logbook.json says seq 32 head ${short(EXPECTED.head)} (a crash between a line and logbook.json, SPEC §3); nothing was written: run \`logbook-ts repair tail\`\n`,
    );
    expect(again.code).toBe(2);
    expect(readLines(wrong.root, wrong.month)).toHaveLength(1);
  });

  it("repair tail under --no-wait while a living writer holds the lock: `repair: …; --no-wait, so not waiting`, exit 2, as the reference says it", () => {
    const { root } = lagging();
    const holder = spawnSync(
      process.execPath,
      [
        "-e",
        `const c = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { detached: true, stdio: "ignore", windowsHide: true }); c.unref(); process.stdout.write(String(c.pid));`,
      ],
      { encoding: "utf-8" },
    );
    mkdirSync(join(root, "state"), { recursive: true });
    writeFileSync(
      join(root, "state", "writer.lock"),
      `{"pid": ${Number(holder.stdout)}, "command": "sync immich", "since": "2026-10-13T06:00:00Z"}`,
      "utf-8",
    );
    for (const argv of [
      ["repair", "tail", root, "--no-wait"],
      ["repair", "tail", root, "--dry-run", "--no-wait"],
    ]) {
      expect(run(argv)).toEqual({
        code: 2,
        out: "",
        err: "repair: another logbook command is writing to this record (sync immich, since 2026-10-13T06:00:00Z); --no-wait, so not waiting\n",
      });
    }
    rmSync(join(root, "state"), { recursive: true, force: true });
  });
});
