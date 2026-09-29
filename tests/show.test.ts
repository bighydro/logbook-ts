import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { showDay } from "../src/show.js";
import { verifyLogbook } from "../src/store.js";
import { cleanup, copySample, FIXTURES, readLines, SAMPLE, writeLines } from "./helpers.js";

afterEach(cleanup);

const SHOW = join(FIXTURES, "show-sample");

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

describe("the show fixture", () => {
  it("is a valid logbook/0.2 record", () => {
    const result = verifyLogbook(SHOW);
    expect(result.errors).toEqual([]);
    expect(result.lines).toBe(20);
  });
});

describe("logbook-ts show", () => {
  it("prints a day of the show fixture: local Oslo time, collapsed points, resolved names, a retracted line", () => {
    const { code, out, err } = run(["show", SHOW, "--day", "2026-03-14"]);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out).toBe(
      [
        "08:12        location  sim-phone     tier 1  3 points 08:12–09:40",
        "10:00–11:00  event     sim-calendar  tier 1  Coffee with Ines (Ines Holm-Berg)",
        "10:30        photo     sim-camera    tier 1  photo/v1",
        "12:05        message   whatsapp      tier 2  Sailing club (Ola Nordmann): Regatta moved to Sunday",
        "12:07        message   whatsapp      tier 2  Kari (Kari M): Hei, lunch?",
        "12:09        message   whatsapp      tier 2  Kari (me): On my way",
        "21:30        note      manual        tier 2  Regatta Sunday.",
        "22:00        location  sim-phone     tier 1  59.911,10.75",
        "22:30        note      manual        tier 2  [retracted: typo]",
        "",
      ].join("\n"),
    );
  });

  it("--raw keeps every point and prints refs as the source gave them", () => {
    const { code, out } = run(["show", SHOW, "--day", "2026-03-14", "--raw"]);
    expect(code).toBe(0);
    expect(out).toBe(
      [
        "08:12        location  sim-phone     tier 1  59.911,10.75",
        "08:40        location  sim-phone     tier 1  59.912,10.748",
        "09:40        location  sim-phone     tier 1  59.913,10.742",
        "10:00–11:00  event     sim-calendar  tier 1  Coffee with Ines (ines@example.org)",
        "10:30        photo     sim-camera    tier 1  photo/v1",
        "12:05        message   whatsapp      tier 2  Sailing club (236000000000001@lid): Regatta moved to Sunday",
        "12:07        message   whatsapp      tier 2  Kari (+4790000002): Hei, lunch?",
        "12:09        message   whatsapp      tier 2  Kari (me): On my way",
        "21:30        note      manual        tier 2  Regatta Sunday.",
        "22:00        location  sim-phone     tier 1  59.911,10.75",
        "22:30        note      manual        tier 2  [retracted: typo]",
        "",
      ].join("\n"),
    );
  });

  it("prints resolution lines as ref → entity or alias, hides the retracted one, and omits retractions", () => {
    const { code, out } = run(["show", SHOW, "--day", "2026-03-15"]);
    expect(code).toBe(0);
    expect(out).toBe(
      [
        "10:00  resolution  ios-contacts       tier 2  email ines@example.org → person Ines Holm",
        "10:00  resolution  ios-contacts       tier 2  phone +4790000001 → person Ola Nordmann",
        "10:00  resolution  whatsapp-contacts  tier 2  handle 236000000000001@lid → alias of phone +4790000001",
        "10:00  resolution  ios-contacts       tier 2  [retracted: wrong contact]",
        "",
      ].join("\n"),
    );
  });

  it("takes the local day from --tz, or from logbook.json by default, across a month-file boundary", () => {
    expect(run(["show", SHOW, "--day", "2026-04-01"]).out).toBe(
      [
        "00:30  location  sim-phone  tier 1  59.95,10.6",
        "08:00  note      manual     tier 2  April",
        "",
      ].join("\n"),
    );
    expect(run(["show", SHOW, "--day", "2026-03-31", "--tz", "UTC"]).out).toBe(
      "22:30  location  sim-phone  tier 1  59.95,10.6\n",
    );
    expect(run(["show", SHOW, "--tz=UTC", "--day=2026-04-01"]).out).toBe(
      "06:00  note  manual  tier 2  April\n",
    );
  });

  it("says so when a day has no lines", () => {
    const { code, out, err } = run(["show", SHOW, "--day", "2026-03-20"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toBe("no lines on 2026-03-20 in Europe/Oslo\n");
  });

  it("reads the conformance sample: a chat given as a string, attendees given as strings, other kinds by schema", () => {
    const { code, out } = run(["show", SAMPLE, "--day", "2026-03-01"]);
    expect(code).toBe(0);
    expect(out).toBe(
      [
        "08:30        location  sim-phone     tier 1  2 points 08:30–09:40",
        "10:00–11:00  event     sim-calendar  tier 1  Coffee with Ines (ines@example.org)",
        "10:12        photo     sim-camera    tier 1  photo/v1",
        "22:00        note      manual        tier 2  Ines is moving to Tromsø in May. Ask her about the northern lights trip.",
        "23:30–07:45  sleep     sim-watch     tier 3  health-sample/v1",
        "",
      ].join("\n"),
    );
    expect(run(["show", SAMPLE, "--day", "2026-03-06"]).out).toBe(
      "20:30  message  sim-messages  tier 2  Ines: Landed? Dinner Sunday?\n",
    );
  });

  it("truncates a long summary to one line of at most 80 characters", () => {
    const root = copySample();
    const lines = readLines(root);
    const long = JSON.parse(lines[4] as string) as { payload: { text: string } };
    long.payload.text = `${"x".repeat(100)}\nsecond line`;
    lines[4] = JSON.stringify(long);
    writeLines(root, lines);
    const { out } = run(["show", root, "--day", "2026-03-01"]);
    expect(out).toContain(`tier 2  ${"x".repeat(79)}…\n`);
    expect(out).not.toContain("second line");
  });

  it("exits 2 with usage when --day is missing or malformed, or a flag is unknown", () => {
    for (const argv of [
      ["show", SHOW],
      ["show", SHOW, "--day"],
      ["show", SHOW, "--day", "14/03/2026"],
      ["show", SHOW, "--day", "2026-02-30"],
      ["show", SHOW, "--day", "2026-03-14", "--verbose"],
      ["show", SHOW, "--day", "2026-03-14", "extra"],
      ["show"],
    ]) {
      const { code, out, err } = run(argv);
      expect(code, argv.join(" ")).toBe(2);
      expect(out).toBe("");
      expect(err).toMatch(/usage/i);
    }
  });

  it("exits 1 on an unknown timezone, a missing record or a refused format", () => {
    const tz = run(["show", SHOW, "--day", "2026-03-14", "--tz", "Mars/Olympus"]);
    expect(tz.code).toBe(1);
    expect(tz.err).toMatch(/Mars\/Olympus/);
    expect(run(["show", `${SHOW}-missing`, "--day", "2026-03-14"]).code).toBe(1);
    const root = copySample();
    const meta = JSON.parse(readLines(root, "logbook.json").join("")) as Record<string, unknown>;
    writeLines(root, [JSON.stringify({ ...meta, format: "logbook/0.1" })], "logbook.json");
    const refused = run(["show", root, "--day", "2026-03-01"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/logbook\/0\.1/);
  });

  it("lists show in --help", () => {
    expect(run(["--help"]).out).toMatch(/show <root> --day/);
  });
});

describe("showDay", () => {
  it("returns the text and the timezone it used", () => {
    const result = showDay(SHOW, { day: "2026-04-01" });
    expect(result.timezone).toBe("Europe/Oslo");
    expect(result.text.split("\n")).toHaveLength(3);
    expect(showDay(SHOW, { day: "2026-04-01", timezone: "UTC" }).text).toBe(
      "06:00  note  manual  tier 2  April\n",
    );
  });
});
