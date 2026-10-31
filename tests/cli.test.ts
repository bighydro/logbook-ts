import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type MainOptions, main } from "../src/cli.js";
import { localOf } from "../src/clock.js";
import { statusListing, statusListingJson, statusListingText } from "../src/entities.js";
import { FLAGS_ENV } from "../src/flags.js";
import { verifyLogbook } from "../src/store.js";
import { entitiesRecord } from "./entities-record.js";
import {
  cleanup,
  copyFixture,
  copySample,
  cutInsideLastLine,
  EXPECTED,
  expectedDays,
  expectedDaysWindows,
  expectedWindows,
  FIXTURES,
  readLines,
  SAMPLE,
  writeLines,
} from "./helpers.js";

afterEach(cleanup);

function run(
  argv: string[],
  options: MainOptions = {},
): { code: number; out: string; err: string } {
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
    options,
  );
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

  it("verify on the seed-1 demo cut inside its last line: exit 1, the lines read and their head, one plain sentence naming the cut line", () => {
    // SPEC §3, truncation: the seq and head of the last whole line, never 0 and GENESIS; the
    // sentence is the reference's (`logbook verify`, #214), without the JSON decoder's position.
    const root = copyFixture("demo-seed1");
    const rel = join("logbook", "2026", "06.jsonl");
    const { row, head } = cutInsideLastLine(root, rel);
    const { code, out, err } = run(["verify", root]);
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toBe(
      `invalid — 1 error; 12771 lines read, head ${head}\n` +
        `  ${rel} line ${row}: the file ends inside this line (cut short)\n`,
    );
  });

  it("verify names the lines read and their head on every invalid record", () => {
    const root = copySample();
    const lines = readLines(root);
    writeLines(root, [...lines, lines[30] as string]);
    const { code, err } = run(["verify", root]);
    expect(code).toBe(1);
    expect(err.split("\n")[0]).toMatch(
      new RegExp(`^invalid — \\d+ errors; ${EXPECTED.seq + 1} lines read, head ${EXPECTED.head}$`),
    );
  });

  it("verifies a logbook/0.3 record and exits 0", () => {
    const root = copySample();
    const meta = JSON.parse(readLines(root, "logbook.json").join("")) as Record<string, unknown>;
    writeLines(root, [JSON.stringify({ ...meta, format: "logbook/0.3" })], "logbook.json");
    const { code, out, err } = run(["verify", root]);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out).toBe(`valid — ${EXPECTED.seq} lines, head ${EXPECTED.head}\n`);
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
    expect(out).toMatch(/^added seq 33 /);
    const result = verifyLogbook(root);
    expect(result.valid).toBe(true);
    expect(result.lines).toBe(33);
    expect(run(["verify", root]).out).toBe(`valid — 33 lines, head ${result.head}\n`);
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
    expect(readLines(root)).toHaveLength(32);
  });
});

describe("logbook-ts day", () => {
  const DAY_SAMPLE = join(FIXTURES, "day-sample");

  it("prints the day as the reference does, and the same Day as JSON", () => {
    for (const expected of expectedDays(DAY_SAMPLE)) {
      const text = run(["day", DAY_SAMPLE, expected.day]);
      expect(text.code).toBe(0);
      expect(text.err).toBe("");
      expect(text.out).toBe(expected.text);
      const json = run(["day", DAY_SAMPLE, expected.day, "--json"]);
      expect(json.code).toBe(0);
      expect(json.out.endsWith("\n")).toBe(true);
      expect(JSON.parse(json.out)).toEqual(expected.json);
    }
  });

  it("lays the JSON out as the reference does: two spaces, its keys in its order", () => {
    // The vendored files are the reference's bytes; without its `readiness` block (not read here,
    // SPEC-QUESTIONS 79) and spelled by JSON.stringify, which writes a whole float `30.0` as `30`
    // (SPEC-QUESTIONS 100), they are ours byte for byte.
    vi.stubEnv(FLAGS_ENV, "rfc0037,rfc0038");
    try {
      for (const name of ["day-sample", "demo-sample", "rfc0037-0038-sample"]) {
        for (const expected of expectedDays(join(FIXTURES, name))) {
          const json = run(["day", join(FIXTURES, name), expected.day, "--json"]);
          expect(json.out, expected.day).toBe(`${JSON.stringify(expected.json, null, 2)}\n`);
        }
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("takes the flags in either order", () => {
    expect(run(["day", DAY_SAMPLE, "--json", "2026-04-09"]).out).toBe(
      run(["day", DAY_SAMPLE, "2026-04-09", "--json"]).out,
    );
  });

  it("reads today, in the record's zone, when no day is given", () => {
    const { code, out } = run(["day", DAY_SAMPLE]);
    expect(code).toBe(0);
    const today = localOf(Date.now(), "Europe/Oslo").day;
    expect(out.startsWith(`${today}  `)).toBe(true);
    expect(out).toContain("  timeline      nothing logged\n");
  });

  it("prints usage and exits 2 on a day that is not one, an unknown flag, or no root", () => {
    for (const argv of [
      ["day"],
      ["day", DAY_SAMPLE, "2026-13-01"],
      ["day", DAY_SAMPLE, "--raw"],
      ["day", DAY_SAMPLE, "2026-04-06", "2026-04-07"],
    ]) {
      const { code, err } = run(argv);
      expect(code).toBe(2);
      expect(err).toMatch(/usage/i);
    }
  });

  it("refuses a record it does not carry, and never writes", () => {
    const root = copySample();
    const before = readLines(root);
    const meta = JSON.parse(readLines(root, "logbook.json").join("")) as Record<string, unknown>;
    writeLines(root, [JSON.stringify({ ...meta, format: "logbook/0.1" })], "logbook.json");
    const { code, err } = run(["day", root, "2026-03-02"]);
    expect(code).toBe(1);
    expect(err).toMatch(/logbook\/0\.1/);
    writeLines(root, [JSON.stringify(meta)], "logbook.json");
    expect(run(["day", root, "2026-03-02"]).code).toBe(0);
    expect(readLines(root)).toEqual(before);
  });
});

describe("logbook-ts trips and rollup countries", () => {
  const root = join(FIXTURES, "trips-sample");
  const expectedTrips = (name: string) =>
    expectedWindows(root, "trips").find((w) => w.name === name);
  const expectedCountries = (name: string) =>
    expectedWindows(root, "countries").find((w) => w.name === name);

  it("prints the trips as the reference does, and the same trips as JSON", () => {
    const text = run(["trips", root]);
    expect(text.code).toBe(0);
    expect(text.out).toBe(expectedTrips("all")?.text);
    const json = run(["trips", root, "--year", "2026", "--json"]);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out)).toEqual(expectedTrips("2026")?.json);
  });

  it("prints the countries rollup as the reference does, and the same rollup as JSON", () => {
    const text = run(["rollup", "countries", root, "--since=2025-12-31", "--until=2026-01-06"]);
    expect(text.code).toBe(0);
    expect(text.out).toBe(expectedCountries("2025-12-31..2026-01-06")?.text);
    const json = run(["rollup", "countries", root, "--json", "--year=2025"]);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out)).toEqual(expectedCountries("2025")?.json);
  });

  it("prints the nights rollup as the reference does, an asset by its registered name, and the same rollup as JSON", () => {
    const nights = (name: string) => expectedWindows(root, "nights").find((w) => w.name === name);
    const text = run(["rollup", "nights", root]);
    expect(text.code).toBe(0);
    expect(text.out).toBe(nights("all")?.text);
    expect(text.out).toContain("2 nights aboard Solvind");
    const json = run(["rollup", "nights", root, "--json", "--year=2026"]);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out)).toEqual(nights("2026")?.json);
  });

  it("says so when the window has no days, and exits 0", () => {
    expect(run(["trips", root, "--year", "2024"]).out).toBe("no trips: the record has no days\n");
    expect(run(["rollup", "countries", root, "--year", "2024"]).out).toBe(
      "countries\n  nothing in the window\n",
    );
  });

  it("prints usage and exits 2 on a year with a bound, a range that runs backwards, a rollup it does not know, or no root", () => {
    for (const argv of [
      ["trips", root, "--year", "2026", "--since", "2026-01-05"],
      ["trips", root, "--since", "2026-01-05", "--until", "2026-01-04"],
      ["trips", root, "--year", "26"],
      ["trips", root, "--raw"],
      ["trips"],
      ["rollup", "flights", root],
      ["rollup", "countries"],
    ]) {
      const { code, out, err } = run(argv);
      expect(code, argv.join(" ")).toBe(2);
      expect(out).toBe("");
      expect(err).toMatch(/^usage:/);
    }
  });

  it("refuses a record it does not carry, and never writes", () => {
    const copy = copySample();
    const meta = JSON.parse(readLines(copy, "logbook.json").join("")) as Record<string, unknown>;
    writeLines(copy, [JSON.stringify({ ...meta, format: "logbook/0.1" })], "logbook.json");
    const before = readLines(copy);
    for (const argv of [
      ["trips", copy],
      ["rollup", "countries", copy],
    ]) {
      const { code, err } = run(argv);
      expect(code).toBe(1);
      expect(err).toMatch(/logbook\/0\.1/);
    }
    expect(readLines(copy)).toEqual(before);
  });
});

describe("logbook-ts days", () => {
  const root = join(FIXTURES, "demo-seed1");
  const expected = (name: string) => expectedDaysWindows(root).find((w) => w.name === name);

  it("prints the days as the reference does, and the same days as JSON Lines", () => {
    const text = run(["days", root]);
    expect(text.code).toBe(0);
    expect(text.out).toBe(expected("all")?.text);
    const json = run(["days", root, "--from=2026-06-14", "--to", "2026-06-21", "--json"]);
    expect(json.code).toBe(0);
    expect(
      json.out
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    ).toEqual(expected("2026-06-14..2026-06-21")?.rows);
  });

  it("says so and exits 2 on a range that runs backwards, as the reference does", () => {
    const { code, out, err } = run(["days", root, "--from", "2026-06-12", "--to", "2026-06-10"]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toBe("days: range runs backwards: 2026-06-12 > 2026-06-10\n");
  });

  it("prints usage and exits 2 on a bound that is not a day, a flag it does not know, or no root", () => {
    for (const argv of [
      ["days", root, "--from", "2026-6-1"],
      ["days", root, "--to"],
      ["days", root, "--year", "2026"],
      ["days"],
    ]) {
      const { code, out, err } = run(argv);
      expect(code, argv.join(" ")).toBe(2);
      expect(out).toBe("");
      expect(err).toMatch(/^usage:/);
    }
  });
});

describe("logbook-ts people", () => {
  const root = join(FIXTURES, "demo-seed1");
  const expected = (name: string) => expectedWindows(root, "people").find((w) => w.name === name);

  it("prints the people as the reference does, and the same report as JSON", () => {
    const text = run(["people", root]);
    expect(text.code).toBe(0);
    expect(text.out).toBe(expected("all")?.text);
    const json = run(["people", root, "--year=2026", "--json"]);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out)).toEqual(expected("2026")?.json);
  });

  it("says so when the year has no days, and exits 0", () => {
    const { code, out } = run(["people", root, "--year", "2025"]);
    expect(code).toBe(0);
    expect(out).toBe("no people: the record has no days in 2025\n");
  });

  it("prints usage and exits 2 on a range, a bad year, a flag it does not know, or no root", () => {
    for (const argv of [
      ["people", root, "--since", "2026-06-01", "--until", "2026-06-30"],
      ["people", root, "--year", "26"],
      ["people", root, "--merge"],
      ["people"],
    ]) {
      const { code, out, err } = run(argv);
      expect(code, argv.join(" ")).toBe(2);
      expect(out).toBe("");
      expect(err).toMatch(/^usage:/);
    }
  });
});

describe("logbook-ts status list (RFC 0037, draft, behind the rfc0037 flag)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const NOW = new Date("2026-10-15T10:00:00Z");
  const TODAY = "2026-10-15";
  const at = (argv: string[]) => run(argv, { now: NOW });

  /** Every month file of the record, read whole, to check that nothing was written. */
  const monthFiles = (root: string): string[] => {
    const out: string[] = [];
    for (const year of readdirSync(join(root, "logbook")).sort()) {
      for (const month of readdirSync(join(root, "logbook", year)).sort()) {
        out.push(readFileSync(join(root, "logbook", year, month), "utf-8"));
      }
    }
    return out;
  };

  it("refuses with one sentence naming the flag when it is off, and exits 2", () => {
    vi.stubEnv(FLAGS_ENV, "");
    const root = entitiesRecord();
    for (const argv of [
      ["status", "list", root, "org"],
      ["status", "org", "Nordmann Verft", "hold"],
    ]) {
      const { code, out, err } = at(argv);
      expect(code, argv.join(" ")).toBe(2);
      expect(out).toBe("");
      expect(err).toBe(
        "status: status list reads RFC 0037 (draft), which is off until it is final; set LOGBOOK_TS_FLAGS=rfc0037 to turn it on\n",
      );
    }
    expect(at(["status"]).code).toBe(2);
    expect(at(["status"]).err).toMatch(/^usage:/);
  });

  it("prints the listing of each kind as the reference does, and the same as JSON, today by the clock given", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0037");
    const root = entitiesRecord();
    const before = monthFiles(root);
    for (const kind of ["org", "idea", "place", "asset"]) {
      const listing = statusListing(root, kind, TODAY);
      const text = at(["status", "list", root, kind]);
      expect({ kind, code: text.code, err: text.err }).toEqual({ kind, code: 0, err: "" });
      expect(text.out).toBe(statusListingText(listing));
      expect(text.out).toContain(`· ${TODAY}\n`);
      const json = at(["status", "list", root, "--json", kind]);
      expect(json.code).toBe(0);
      expect(json.out).toBe(`${JSON.stringify(statusListingJson(listing), null, 2)}\n`);
    }
    expect(at(["status", "list", root, "org"]).out).toContain(
      "  Nordmann Verft AS  hold since 2026-10-01 (dream proposed let-go) · not proposed: let-go to 2027-11-04\n",
    );
    expect(monthFiles(root)).toEqual(before);
  });

  it("refuses a kind that takes no status, and more than a kind, in the reference's words; exits 2", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0037");
    const root = entitiesRecord();
    for (const [argv, sentence] of [
      [
        ["status", "list", root, "person"],
        "a person has no status (RFC 0037): people are reviewed, never disposed of",
      ],
      [
        ["status", "list", root, "goal"],
        "a goal is reviewed by review/v1 (RFC 0036), not given a status",
      ],
      [
        ["status", "list", root, "thing"],
        "a status is for an org, idea, place, asset; not for 'thing'",
      ],
      [
        ["status", "list", root, "org", "--reason", "x"],
        "`status list KIND` takes a kind and nothing else",
      ],
      [["status", "list", root, "org", "idea"], "`status list KIND` takes a kind and nothing else"],
      [["status", "list", root], "`status list KIND` takes a kind and nothing else"],
      [["status", "list", root, "--json"], "`status list KIND` takes a kind and nothing else"],
      [
        ["status", "org", "Nordmann Verft", "hold"],
        "this implementation does not write status lines (the reference's `logbook status KIND ENTITY DISPOSITION` does); it reads them: `status list <root> KIND`",
      ],
      [
        ["status", root, "org", "Nordmann Verft", "hold"],
        "this implementation does not write status lines (the reference's `logbook status KIND ENTITY DISPOSITION` does); it reads them: `status list <root> KIND`",
      ],
    ] as const) {
      const { code, out, err } = at([...argv]);
      expect({ argv, code, out, err }).toEqual({
        argv,
        code: 2,
        out: "",
        err: `status: ${sentence}\n`,
      });
    }
    expect(at(["status", "list"]).err).toMatch(/^usage:/);
  });

  it("refuses a settings file that is not one, naming it, and a record it does not carry", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0037");
    const root = entitiesRecord();
    writeLines(root, ["[]"], join("policy", "entities.json"));
    const refused = at(["status", "list", root, "org"]);
    expect(refused.code).toBe(2);
    expect(refused.err).toBe(
      `status: ${join(root, "policy", "entities.json")} must be an object\n`,
    );
    const meta = JSON.parse(readLines(root, "logbook.json").join("")) as Record<string, unknown>;
    writeLines(root, [JSON.stringify({ ...meta, format: "logbook/0.1" })], "logbook.json");
    const { code, err } = at(["status", "list", root, "org"]);
    expect(code).toBe(1);
    expect(err).toMatch(/logbook\/0\.1/);
  });
});

describe("logbook-ts usage", () => {
  it("prints usage and exits 2 without a command, with an unknown command, or with missing args", () => {
    for (const argv of [
      [],
      ["frobnicate"],
      ["verify"],
      ["add"],
      ["add", SAMPLE],
      // A copy: were --no-wait ever read as the note, it would be appended to it, not to the fixture.
      ["add", copySample(), "--no-wait"],
      ["repair"],
      ["repair", "tail"],
      ["repair", "fork", SAMPLE],
      ["repair", "tail", SAMPLE, "--apply"],
      ["repair", "tail", SAMPLE, SAMPLE],
    ]) {
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
    expect(out).toMatch(/day/);
  });
});
