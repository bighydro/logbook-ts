import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { verifyLogbook } from "../src/store.js";
import { cleanup, copySample, EXPECTED, readLines, SAMPLE, writeLines } from "./helpers.js";

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

describe("logbook-ts verify", () => {
  it("prints `valid — N lines, head <hex>` and exits 0 on the sample", () => {
    const { code, out, err } = run(["verify", SAMPLE]);
    expect(code).toBe(0);
    expect(out).toBe(`valid — ${EXPECTED.seq} lines, head ${EXPECTED.head}\n`);
    expect(err).toBe("");
  });

  it("prints the errors and exits 1 on a tampered record", () => {
    const root = copySample();
    const lines = readLines(root);
    lines[0] = (lines[0] as string).replace('"accuracy_m": 12', '"accuracy_m": 13');
    writeLines(root, lines);
    const { code, out, err } = run(["verify", root]);
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toMatch(/^invalid/);
    expect(err).toMatch(/seq 1/);
  });

  it("refuses a record whose format is not logbook/0.2 and exits 1", () => {
    const root = copySample();
    const meta = JSON.parse(readLines(root, "logbook.json").join("")) as Record<string, unknown>;
    writeLines(root, [JSON.stringify({ ...meta, format: "logbook/0.1" })], "logbook.json");
    const { code, err } = run(["verify", root]);
    expect(code).toBe(1);
    expect(err).toMatch(/logbook\/0\.1/);
  });

  it("exits 1 with a message when the root is not a logbook", () => {
    const { code, err } = run(["verify", `${copySample()}-missing`]);
    expect(code).toBe(1);
    expect(err).toMatch(/logbook\.json/);
  });
});

describe("logbook-ts add", () => {
  it("appends a note and the record still verifies", () => {
    const root = copySample();
    const { code, out, err } = run(["add", root, "a note from the CLI"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toMatch(/^added seq 32 /);
    const result = verifyLogbook(root);
    expect(result.valid).toBe(true);
    expect(result.lines).toBe(32);
    expect(run(["verify", root]).out).toBe(`valid — 32 lines, head ${result.head}\n`);
  });

  it("joins extra words so the text need not be quoted", () => {
    const root = copySample();
    const { code, out } = run(["add", root, "two", "words"]);
    expect(code).toBe(0);
    const at = /at (\d{4})-(\d{2})-/.exec(out) as RegExpExecArray;
    const month = join("logbook", at[1] as string, `${at[2]}.jsonl`);
    const last = JSON.parse(readLines(root, month).at(-1) as string) as {
      payload: { text: string };
    };
    expect(last.payload.text).toBe("two words");
  });

  it("exits 1 and writes nothing when the record is refused", () => {
    const root = copySample();
    const meta = JSON.parse(readLines(root, "logbook.json").join("")) as Record<string, unknown>;
    writeLines(root, [JSON.stringify({ ...meta, format: "logbook/0.1" })], "logbook.json");
    const { code, err } = run(["add", root, "nope"]);
    expect(code).toBe(1);
    expect(err).toMatch(/logbook\/0\.1/);
    expect(readLines(root)).toHaveLength(31);
  });
});

describe("logbook-ts usage", () => {
  it("prints usage and exits 2 without a command, with an unknown command, or with missing args", () => {
    for (const argv of [[], ["frobnicate"], ["verify"], ["add"], ["add", SAMPLE]]) {
      const { code, err } = run(argv);
      expect(code).toBe(2);
      expect(err).toMatch(/usage/i);
    }
  });

  it("prints usage to stdout and exits 0 for --help", () => {
    const { code, out } = run(["--help"]);
    expect(code).toBe(0);
    expect(out).toMatch(/usage/i);
    expect(out).toMatch(/verify/);
    expect(out).toMatch(/add/);
  });
});
