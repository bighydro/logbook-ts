import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { showDay } from "../src/show.js";
import { verifyLogbook } from "../src/store.js";
import {
  cleanup,
  copySample,
  expectedShows,
  FIXTURES,
  readLines,
  SAMPLE,
  writeLines,
} from "./helpers.js";

afterEach(cleanup);

const SHOW = join(FIXTURES, "show-sample");
const PROFILES = join(FIXTURES, "profiles-sample");

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

describe("the show fixtures", () => {
  it("are valid logbook/0.2 records", () => {
    expect(verifyLogbook(SHOW).errors).toEqual([]);
    expect(verifyLogbook(SHOW).lines).toBe(20);
    expect(verifyLogbook(PROFILES).errors).toEqual([]);
    expect(verifyLogbook(PROFILES).lines).toBe(76);
  });
});

describe("logbook-ts show prints a day exactly as the reference implementation does", () => {
  // The expected files were written by `logbook show` of openlogbook (b60ae11, 2026-10-01) on a
  // copy of each fixture; tests/cross-impl.test.ts re-checks them against the reference itself.
  for (const [name, root] of [
    ["show-sample", SHOW],
    ["profiles-sample", PROFILES],
  ] as const) {
    for (const { day, raw, text } of expectedShows(root)) {
      it(`${name} ${day}${raw ? " --raw" : ""}`, () => {
        const argv = ["show", root, "--day", day, ...(raw ? ["--raw"] : [])];
        const { code, out, err } = run(argv);
        expect(err).toBe("");
        expect(code).toBe(0);
        expect(out).toBe(text);
      });
    }
  }
});

describe("logbook-ts show, beyond the reference", () => {
  it("takes the local day from --tz, or from logbook.json by default, across a month-file boundary", () => {
    expect(run(["show", SHOW, "--day", "2026-03-31", "--tz", "UTC"]).out).toBe(
      "2026-03-31\n  22:30  location   sim-phone      1 point\n",
    );
    expect(run(["show", SHOW, "--tz=UTC", "--day=2026-04-01"]).out).toBe(
      "2026-04-01\n  06:00  note       manual         April\n",
    );
  });

  it("reads the conformance sample, whose chat and attendees are strings (SPEC §3.2), without failing", () => {
    const { code, out } = run(["show", SAMPLE, "--day", "2026-03-01"]);
    expect(code).toBe(0);
    expect(out).toBe(
      [
        "2026-03-01",
        "  08:30–09:40  location   sim-phone      2 points",
        "  10:00  event      sim-calendar   Coffee with Ines · with ines@example.org",
        "  10:12  photo      sim-camera     camera=SimPhone 3, file=IMG_0001.jpg, lat=59.913, lon=10.742",
        "  22:00  note       manual         Ines is moving to Tromsø in May. Ask her about the northern lights trip.",
        // The sample stores `1e+20` and `120.0` as text; Python keeps that spelling, JSON.parse cannot (SPEC-QUESTIONS 24).
        "  23:30  sleep      sim-watch      calibration={'epsilon': 1e-06, 'gain': 1e+21, 'offset': 100000000000000000000}, hours=8.25, metric=sleep",
        "",
      ].join("\n"),
    );
    expect(run(["show", SAMPLE, "--day", "2026-03-06"]).out).toBe(
      "2026-03-06\n  20:30  message    sim-messages   Ines: Landed? Dinner Sunday?\n",
    );
    expect(run(["show", SAMPLE, "--day", "2026-03-07"]).out).toBe(
      [
        "2026-03-07",
        "  19:00  event      sim-calendar   Dinner with Ines",
        "  22:30  note       manual         Told her about Copenhagen. She laughed and said she'd visit by boat.",
        "  — note —",
        "  A good week. The decision is made; now live it.",
        "",
      ].join("\n"),
    );
  });

  it("orders a day by the instant `at` denotes, then by seq, whatever the precision (SPEC §3.2)", () => {
    const root = copySample();
    const lines = readLines(root);
    const i = lines.findIndex((l) => l.includes('"at": "2026-03-01T21:00:00Z"'));
    const note = JSON.parse(lines[i] as string) as { at: string; payload: { text: string } };
    // A second note half a second later sorts after it as an instant, before it as a string.
    writeLines(root, [
      ...lines.slice(0, i + 1),
      JSON.stringify({
        ...note,
        id: "00000000-0000-4000-8000-00000000ffff",
        at: "2026-03-01T21:00:00.5Z",
        payload: { schema: "note/v1", text: "later" },
      }),
      ...lines.slice(i + 1),
    ]);
    const { out } = run(["show", root, "--day", "2026-03-01"]);
    const rows = out.split("\n").filter((r) => r.includes("note"));
    expect(rows[0]).toContain("Ines is moving");
    expect(rows[1]).toContain("later");
  });

  it("does not fail on a crossing line without counts, or a line whose payload is not an object", () => {
    const root = copySample();
    const lines = readLines(root);
    const note = JSON.parse(lines[4] as string) as Record<string, unknown>;
    writeLines(root, [
      ...lines,
      JSON.stringify({
        ...note,
        id: "00000000-0000-4000-8000-00000000fff1",
        at: "2026-03-01T22:01:00Z",
        kind: "crossing",
        payload: { schema: "crossing/v1", destination: "z" },
      }),
      JSON.stringify({
        ...note,
        id: "00000000-0000-4000-8000-00000000fff2",
        at: "2026-03-01T22:02:00Z",
        kind: "odd",
        payload: "not an object",
      }),
    ]);
    const { code, out } = run(["show", root, "--day", "2026-03-01"]);
    expect(code).toBe(0);
    expect(out).toContain("  23:01  crossing   manual         crossed to z: 0 lines\n");
    expect(out).toContain("  23:02  odd        manual         \n");
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
  it("returns the text, the timezone it used and the number of rows", () => {
    const result = showDay(SHOW, { day: "2026-04-01" });
    expect(result.timezone).toBe("Europe/Oslo");
    expect(result.rows).toBe(2);
    expect(result.text.split("\n")).toHaveLength(4);
    expect(showDay(SHOW, { day: "2026-04-01", timezone: "UTC" }).text).toBe(
      "2026-04-01\n  06:00  note       manual         April\n",
    );
    expect(showDay(SHOW, { day: "2026-03-20" })).toEqual({
      text: "2026-03-20: nothing logged\n",
      timezone: "Europe/Oslo",
      rows: 0,
    });
  });
});
