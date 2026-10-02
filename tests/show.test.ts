import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { showDay, showDays } from "../src/show.js";
import { addNote, verifyLogbook } from "../src/store.js";
import {
  cleanup,
  copySample,
  expectedShows,
  FIXTURES,
  freshLogbook,
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
    expect(verifyLogbook(PROFILES).lines).toBe(77);
  });
});

describe("a day's hero line, as the reference prints it (RFC 0024 rule 4)", () => {
  // Learned by running the reference on a probe record: memory keepers first, then every other
  // lane as `(art)`; the photo's file_name, else its asset_id, else the photo line's id, else `?`;
  // a retracted keeper is neither a hero nor a row.
  const keeper = (at: string, seq: number, payload: Record<string, unknown>) =>
    JSON.stringify({
      id: `00000000-0000-4000-8000-0000000009${String(seq).padStart(2, "0")}`,
      seq,
      at,
      end: null,
      tz: "Europe/Oslo",
      source: "manual",
      kind: "keeper",
      tier: 1,
      payload: { schema: "keeper/v1", raw_id: String(seq), at, source: "manual", ...payload },
      recorded_at: at,
      prev: "0".repeat(64),
      hash: "0".repeat(64),
    });

  it("lists the day's keepers, memory first, and names each photo as the reference does", () => {
    const root = copySample();
    writeLines(root, [
      ...readLines(root),
      keeper("2026-03-20T08:00:00Z", 40, {
        lane: "art",
        photo: { line: "L1", asset_id: "A1", file_name: "A.jpg" },
      }),
      keeper("2026-03-20T09:00:00Z", 41, {
        lane: "memory",
        photo: { line: "L2", asset_id: "ASSET-2", library: "immich" },
      }),
      keeper("2026-03-20T10:00:00Z", 42, { lane: "memory" }),
      keeper("2026-03-20T11:00:00Z", 43, {
        lane: "odd",
        photo: { line: "L4", asset_id: "", file_name: "" },
      }),
      keeper("2026-03-20T12:00:00Z", 44, { photo: { file_name: 42 } }),
      keeper("2026-03-20T13:00:00Z", 45, { lane: "memory", photo: "not an object" }),
      keeper("2026-03-20T14:00:00Z", 46, { lane: "memory", photo: { file_name: "gone.jpg" } }),
      JSON.stringify({
        id: "00000000-0000-4000-8000-000000000947",
        seq: 47,
        at: "2026-03-21T00:00:00Z",
        end: null,
        tz: "Europe/Oslo",
        source: "manual",
        kind: "retraction",
        tier: 2,
        payload: {
          schema: "retraction/v1",
          supersedes: "00000000-0000-4000-8000-000000000946",
          seq: 46,
          reason: "no",
        },
        recorded_at: "2026-03-21T00:00:00Z",
        prev: "0".repeat(64),
        hash: "0".repeat(64),
      }),
    ]);
    expect(run(["show", root, "--day", "2026-03-20"]).out).toBe(
      [
        "2026-03-20",
        "  hero  ASSET-2, ?, ?, A.jpg (art), L4 (art), 42 (art)",
        "  09:00  keeper     manual         hero photo (art): A.jpg",
        "  10:00  keeper     manual         hero photo (memory): ASSET-2",
        "  11:00  keeper     manual         hero photo (memory): ?",
        "  12:00  keeper     manual         hero photo (odd): L4",
        "  13:00  keeper     manual         hero photo (None): 42",
        "  14:00  keeper     manual         hero photo (memory): ?",
        "  15:00  retracted #46: no",
        "",
      ].join("\n"),
    );
  });
});

describe("logbook-ts show prints a day exactly as the reference implementation does", () => {
  // The expected files were written by `logbook show` of openlogbook (b3cd8c5, 2026-10-02) on a
  // copy of each fixture; tests/cross-impl.test.ts re-checks them against the reference itself.
  for (const [name, root] of [
    ["show-sample", SHOW],
    ["profiles-sample", PROFILES],
    ["sample-logbook", SAMPLE],
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
        "  hero  IMG_0001.jpg",
        // SPEC §3.2: the run ends at the last point's `end`; the reference does the same since b3cd8c5 (SPEC-QUESTIONS 25).
        "  08:30–09:40  location   sim-phone      2 points",
        "  10:00  event      sim-calendar   Coffee with Ines · with ines@example.org",
        "  10:12  photo      sim-camera     camera=SimPhone 3, file=IMG_0001.jpg, lat=59.913, lon=10.742",
        "  10:12  keeper     keeper-inference hero photo (memory): IMG_0001.jpg",
        "  22:00  note       manual         Ines is moving to Tromsø in May. Ask her about the northern lights trip.",
        // The sample stores `1e+20` and `1e-06` as text; both implementations print the value as RFC 8785 spells it (SPEC-QUESTIONS 24).
        "  23:30  sleep      sim-watch      calibration={'epsilon': 0.000001, 'gain': 1e+21, 'offset': 100000000000000000000}, hours=8.25, metric=sleep",
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
      detail: { day: "2026-03-20", timezone: "Europe/Oslo", hero: [], rows: [] },
    });
  });
});

describe("logbook-ts show --since/--until lists a range of local days", () => {
  const expected = (day: string) =>
    expectedShows(SHOW).find((e) => e.day === day && !e.raw)?.text as string;

  it("prints each day with lines as --day would, in order, a blank line between, and skips empty days", () => {
    const { code, out, err } = run([
      "show",
      SHOW,
      "--since",
      "2026-03-15",
      "--until",
      "2026-04-01",
    ]);
    expect(err).toBe("");
    expect(code).toBe(0);
    // 2026-03-17 to 2026-03-31 have nothing in Oslo and are not listed.
    expect(out).toBe(
      [expected("2026-03-15"), expected("2026-03-16"), expected("2026-04-01")].join("\n"),
    );
  });

  it("assembles a day from two month files when it straddles the UTC month boundary", () => {
    const { out } = run(["show", SHOW, "--since=2026-03-31", "--until=2026-04-01", "--tz=UTC"]);
    expect(out).toBe(
      [
        "2026-03-31",
        "  22:30  location   sim-phone      1 point",
        "",
        "2026-04-01",
        "  06:00  note       manual         April",
        "",
      ].join("\n"),
    );
  });

  it("runs to the record's last day without --until, and from its first without --since", () => {
    expect(run(["show", SHOW, "--since", "2026-03-16"]).out).toBe(
      [expected("2026-03-16"), expected("2026-04-01")].join("\n"),
    );
    expect(run(["show", SHOW, "--until", "2026-03-14"]).out).toBe(expected("2026-03-14"));
  });

  it("says so when the whole range is empty", () => {
    expect(run(["show", SHOW, "--since", "2026-03-17", "--until", "2026-03-20"]).out).toBe(
      "2026-03-17–2026-03-20: nothing logged\n",
    );
    expect(run(["show", SHOW, "--since", "2027-01-01"]).out).toBe(
      "2027-01-01–2026-04-01: nothing logged\n",
    );
  });

  it("takes --raw as --day does", () => {
    const raw = expectedShows(SHOW).find((e) => e.day === "2026-03-14" && e.raw)?.text as string;
    expect(run(["show", SHOW, "--since", "2026-03-14", "--until", "2026-03-14", "--raw"]).out).toBe(
      raw,
    );
  });

  it("exits 2 with usage on a range that runs backwards, a malformed bound, or --day with a bound", () => {
    for (const argv of [
      ["show", SHOW, "--since", "2026-03-15", "--until", "2026-03-14"],
      ["show", SHOW, "--since", "2026-3-15"],
      ["show", SHOW, "--until", "2026-02-30"],
      ["show", SHOW, "--day", "2026-03-14", "--since", "2026-03-14"],
      ["show", SHOW, "--day", "2026-03-14", "--until", "2026-03-14"],
      ["show", SHOW, "--since"],
    ]) {
      const { code, out, err } = run(argv);
      expect(code, argv.join(" ")).toBe(2);
      expect(out).toBe("");
      expect(err).toMatch(/usage/i);
    }
  });
});

describe("showDays", () => {
  it("yields one result per day with lines, in order, each with its text and row count", () => {
    const days = [...showDays(SHOW, { since: "2026-03-14", until: "2026-04-01" })];
    expect(days.map((d) => d.day)).toEqual([
      "2026-03-14",
      "2026-03-15",
      "2026-03-16",
      "2026-04-01",
    ]);
    expect(days.map((d) => d.rows)).toEqual([9, 4, 1, 2]);
    expect(days[3]?.text).toBe(showDay(SHOW, { day: "2026-04-01" }).text);
    expect(days[0]?.timezone).toBe("Europe/Oslo");
    expect([...showDays(SHOW, { since: "2026-03-20", until: "2026-03-20" })]).toEqual([]);
  });
});

describe("showDays streams", () => {
  it("produces a day as soon as every month file that can hold it is read, before later files are opened", () => {
    const root = freshLogbook("UTC");
    addNote(root, "January", { now: new Date("2026-01-10T12:00:00Z") });
    addNote(root, "March", { now: new Date("2026-03-10T12:00:00Z") });
    const days = showDays(root, {});
    expect(days.next().value?.text).toBe(
      "2026-01-10\n  12:00  note       manual         January\n",
    );
    // January was produced before March's file was read: a line added to it now is still listed.
    const march = join("logbook", "2026", "03.jsonl");
    const [line] = readLines(root, march) as [string];
    const late = {
      ...(JSON.parse(line) as Record<string, unknown>),
      id: "late",
      seq: 3,
      payload: { schema: "note/v1", text: "late" },
    };
    writeLines(root, [line, JSON.stringify(late)], march);
    expect(days.next().value?.text).toBe(
      "2026-03-10\n  12:00  note       manual         March\n  12:00  note       manual         late\n",
    );
    expect(days.next().done).toBe(true);
  });
});

describe("logbook-ts show --profile keeps only the lines of the given payload schemas", () => {
  it("filters a day to one schema, before runs are collapsed and entries folded", () => {
    expect(run(["show", SHOW, "--day", "2026-03-14", "--profile", "message/v1"]).out).toBe(
      [
        "2026-03-14",
        "  12:05  message    whatsapp       Ola Nordmann in Sailing club: Regatta moved to Sunday",
        "  12:07  message    whatsapp       Kari M: Hei, lunch?",
        "  12:09  message    whatsapp       me → Kari: On my way",
        "",
      ].join("\n"),
    );
  });

  it("takes a profile without its version as every version of it, and a retracted line still shows its mark", () => {
    expect(run(["show", SHOW, "--day", "2026-03-14", "--profile", "note"]).out).toBe(
      [
        "2026-03-14",
        "  21:30  note       manual         Regatta Sunday. … (+1 line)",
        "  22:30  retracted #11: typo",
        "",
      ].join("\n"),
    );
  });

  it("takes several profiles, repeated or comma-separated", () => {
    const expected = [
      "2026-03-14",
      "  08:12–09:40  location   sim-phone      3 points",
      "  21:30  note       manual         Regatta Sunday. … (+1 line)",
      "  22:00  location   sim-phone      1 point",
      "  22:30  retracted #11: typo",
      "",
    ].join("\n");
    expect(
      run(["show", SHOW, "--day", "2026-03-14", "--profile", "location/v1", "--profile", "note/v1"])
        .out,
    ).toBe(expected);
    expect(run(["show", SHOW, "--day", "2026-03-14", "--profile=location/v1,note/v1"]).out).toBe(
      expected,
    );
  });

  it("applies to a range, and a day with no matching line is left out", () => {
    // With the other rows filtered away the four points are one unbroken run (SPEC §3.2).
    expect(run(["show", SHOW, "--since", "2026-03-14", "--profile", "location/v1"]).out).toBe(
      [
        "2026-03-14",
        "  08:12–22:00  location   sim-phone      4 points",
        "",
        "2026-04-01",
        "  00:30  location   sim-phone      1 point",
        "",
      ].join("\n"),
    );
  });

  it("reports nothing logged when no line of the day or range matches", () => {
    expect(run(["show", SHOW, "--day", "2026-03-14", "--profile", "mail/v1"]).out).toBe(
      "2026-03-14: nothing logged\n",
    );
    expect(run(["show", SHOW, "--since", "2026-03-15", "--profile", "mail/v1"]).out).toBe(
      "2026-03-15–2026-04-01: nothing logged\n",
    );
  });

  it("filters the hero line with the rows: only keepers that pass are heroes", () => {
    expect(run(["show", SAMPLE, "--day", "2026-03-01", "--profile", "keeper/v1"]).out).toBe(
      [
        "2026-03-01",
        "  hero  IMG_0001.jpg",
        "  10:12  keeper     keeper-inference hero photo (memory): IMG_0001.jpg",
        "",
      ].join("\n"),
    );
    expect(run(["show", SAMPLE, "--day", "2026-03-01", "--profile", "photo/v1"]).out).toBe(
      [
        "2026-03-01",
        "  10:12  photo      sim-camera     camera=SimPhone 3, file=IMG_0001.jpg, lat=59.913, lon=10.742",
        "",
      ].join("\n"),
    );
  });

  it("exits 2 with usage when --profile has no value", () => {
    for (const argv of [
      ["show", SHOW, "--day", "2026-03-14", "--profile"],
      ["show", SHOW, "--day", "2026-03-14", "--profile="],
      ["show", SHOW, "--day", "2026-03-14", "--profile", "note/v1,"],
    ]) {
      const { code, err } = run(argv);
      expect(code, argv.join(" ")).toBe(2);
      expect(err).toMatch(/usage/i);
    }
  });

  it("is the `profiles` option of showDay and showDays", () => {
    expect(showDay(SHOW, { day: "2026-03-14", profiles: ["note"] }).rows).toBe(2);
    expect([...showDays(SHOW, { profiles: ["resolution/v1"] })].map((d) => d.day)).toEqual([
      "2026-03-15",
      "2026-03-16",
    ]);
  });
});

describe("logbook-ts show --json prints each day as one JSON object", () => {
  type Row = {
    time: string;
    until?: string;
    kind: string;
    source: string;
    summary: string;
    retraction?: { seq: number };
    lines: Array<{ seq: number; id: string }>;
  };
  type Day = {
    day: string;
    timezone: string;
    hero: Array<{ photo: string; lane: string; line: string }>;
    rows: Row[];
    note?: string;
  };
  const parse = (out: string): Day[] =>
    out
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Day);

  it("carries the rows in the order printed, each with its summary and the lines behind it", () => {
    const { code, out, err } = run(["show", SHOW, "--day", "2026-03-14", "--json"]);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out.endsWith("\n")).toBe(true);
    const days = parse(out);
    expect(days).toHaveLength(1);
    const day = days[0] as Day;
    expect(day.day).toBe("2026-03-14");
    expect(day.timezone).toBe("Europe/Oslo");
    expect(day.hero).toEqual([]);
    expect(day.note).toBeUndefined();
    expect(day.rows).toHaveLength(9);
    const run_ = day.rows[0] as Row;
    expect(run_).toMatchObject({
      time: "08:12",
      until: "09:40",
      kind: "location",
      source: "sim-phone",
      summary: "3 points",
    });
    expect(run_.lines.map((l) => l.seq)).toEqual([1, 2, 3]);
    expect(run_.lines[0]).toMatchObject({
      kind: "location",
      payload: { schema: "location/v1", lat: 59.911 },
    });
    const message = day.rows[3] as Row;
    expect(message).toMatchObject({
      time: "12:05",
      kind: "message",
      source: "whatsapp",
      summary: "Ola Nordmann in Sailing club: Regatta moved to Sunday",
    });
    expect(message.until).toBeUndefined();
    expect(message.lines.map((l) => l.seq)).toEqual([6]);
    const hidden = day.rows[8] as Row;
    expect(hidden).toMatchObject({
      time: "22:30",
      kind: "note",
      source: "manual",
      summary: "retracted #11: typo",
    });
    expect(hidden.retraction?.seq).toBe(19);
    expect(hidden.lines.map((l) => l.seq)).toEqual([11]);
    // The text output is the same rows, one per line, under the heading.
    const text = run(["show", SHOW, "--day", "2026-03-14"]).out.split("\n").filter(Boolean);
    expect(text).toHaveLength(1 + day.rows.length);
    for (const [i, row] of day.rows.entries()) {
      const time = row.until === undefined ? row.time : `${row.time}–${row.until}`;
      expect(text[i + 1]).toContain(`  ${time}  `);
      expect(text[i + 1]?.endsWith(row.summary)).toBe(true);
    }
  });

  it("carries the hero photos and the day's notes file", () => {
    const [first] = parse(run(["show", SAMPLE, "--day", "2026-03-01", "--json"]).out) as [Day];
    expect(first.hero).toEqual([
      { photo: "IMG_0001.jpg", lane: "memory", line: "00000000-0000-4000-8000-000000000031" },
    ]);
    const [seventh] = parse(run(["show", SAMPLE, "--day", "2026-03-07", "--json"]).out) as [Day];
    expect(seventh.note).toBe("A good week. The decision is made; now live it.\n");
    expect(seventh.rows.map((r) => r.kind)).toEqual(["event", "note"]);
  });

  it("gives a folded calendar entry every line behind it", () => {
    const [day] = parse(run(["show", PROFILES, "--day", "2026-03-04", "--json"]).out) as [Day];
    const folded = day.rows.find((r) => r.source.startsWith("×")) as Row;
    expect(folded.source).toBe("×2 sources");
    expect(folded.lines.map((l) => l.seq)).toEqual([52, 53]);
    expect(folded.summary).toBe(
      "Boat survey — Tromsø marina · by Ola Nordmann · with Ola Nordmann, Ines Holm",
    );
  });

  it("prints one object per day of a range, nothing for an empty range, and an empty day for --day", () => {
    const days = parse(
      run(["show", SHOW, "--since", "2026-03-15", "--until", "2026-04-01", "--json"]).out,
    );
    expect(days.map((d) => d.day)).toEqual(["2026-03-15", "2026-03-16", "2026-04-01"]);
    expect(
      run(["show", SHOW, "--since", "2026-03-17", "--until", "2026-03-20", "--json"]).out,
    ).toBe("");
    expect(run(["show", SHOW, "--day", "2026-03-20", "--json"]).out).toBe(
      '{"day":"2026-03-20","timezone":"Europe/Oslo","hero":[],"rows":[]}\n',
    );
  });

  it("summarises raw with --raw and filters with --profile like the text does", () => {
    const [raw] = parse(run(["show", SHOW, "--day", "2026-03-14", "--json", "--raw"]).out) as [Day];
    expect(raw.rows[3]?.summary).toBe(
      "236000000000001@lid in Sailing club: Regatta moved to Sunday",
    );
    const [notes] = parse(
      run(["show", SHOW, "--day", "2026-03-14", "--json", "--profile", "note"]).out,
    ) as [Day];
    expect(notes.rows.map((r) => r.summary)).toEqual([
      "Regatta Sunday. … (+1 line)",
      "retracted #11: typo",
    ]);
  });

  it("exits 2 with usage when --json is given a value", () => {
    const { code, err } = run(["show", SHOW, "--day", "2026-03-14", "--json=yes"]);
    expect(code).toBe(2);
    expect(err).toMatch(/usage/i);
  });

  it("is the `detail` of a showDay result and of every day showDays yields", () => {
    const result = showDay(SHOW, { day: "2026-04-01" });
    expect(result.detail.rows.map((r) => r.summary)).toEqual(["1 point", "April"]);
    expect(result.detail.rows[0]?.lines[0]?.at).toBe("2026-03-31T22:30:00Z");
    expect([...showDays(SHOW, { since: "2026-03-16" })].map((d) => d.detail.day)).toEqual([
      "2026-03-16",
      "2026-04-01",
    ]);
  });
});

describe("folding one calendar entry that several sources carry, as the reference does", () => {
  // Learned by running the reference on probe records (SPEC-QUESTIONS 28): the same start and end,
  // one title (case, accents and whitespace aside) or one flight in the title, two or more sources.
  let seq = 40;
  beforeEach(() => {
    seq = 40;
  });
  const event = (
    at: string,
    end: string | null,
    source: string,
    title: string | undefined,
    extra: Record<string, unknown> = {},
  ) =>
    JSON.stringify({
      id: `00000000-0000-4000-8000-0000000009${String(++seq).padStart(2, "0")}`,
      seq,
      at,
      end,
      tz: "Europe/Oslo",
      source,
      kind: "event",
      tier: 1,
      payload: {
        schema: "event/v1",
        raw_id: String(seq),
        ...(title === undefined ? {} : { title }),
        ...extra,
      },
      recorded_at: at,
      prev: "0".repeat(64),
      hash: "0".repeat(64),
    });
  const pair = (
    day: string,
    a: string | undefined,
    b: string | undefined,
    endB = `2026-03-${day}T09:00:00Z`,
  ) => [
    event(`2026-03-${day}T08:00:00Z`, `2026-03-${day}T09:00:00Z`, "ios-calendar", a),
    event(`2026-03-${day}T08:00:00Z`, endB, "ics", b),
  ];
  const rows = (root: string, day: string) =>
    run(["show", root, "--day", `2026-03-${day}`])
      .out.split("\n")
      .slice(1, -1);

  it("folds on case, accents and whitespace, an empty title, a flight in the title, and both ends null", () => {
    const root = copySample();
    writeLines(root, [
      ...readLines(root),
      ...pair("20", "Boat survey", "boat  SURVEY "),
      ...pair("21", "Zürich trip", "Zurich trip"),
      ...pair("22", "", undefined),
      ...pair("23", "Flight to Zürich (LX 561)", "Flug LX561 nach Zürich"),
      event("2026-03-24T08:00:00Z", null, "ios-calendar", "Dentist"),
      event("2026-03-24T08:00:00Z", null, "ics", "Dentist"),
    ]);
    expect(rows(root, "20")).toEqual(["  09:00  event      ×2 sources     Boat survey"]);
    expect(rows(root, "21")).toEqual(["  09:00  event      ×2 sources     Zürich trip"]);
    expect(rows(root, "22")).toEqual(["  09:00  event      ×2 sources     "]);
    expect(rows(root, "23")).toEqual([
      "  09:00  event      ×2 sources     Flight to Zürich (LX 561)",
    ]);
    expect(rows(root, "24")).toEqual(["  09:00  event      ×2 sources     Dentist"]);
  });

  it("does not fold on a different end, a letter that is not an accent, one source twice, or a retracted line", () => {
    const root = copySample();
    writeLines(root, [
      ...readLines(root),
      ...pair("20", "Lunch", "Lunch", "2026-03-20T09:30:00Z"),
      ...pair("21", "Tromsø marina", "Tromso marina"),
      event("2026-03-22T08:00:00Z", "2026-03-22T09:00:00Z", "ics", "Twice"),
      event("2026-03-22T08:00:00Z", "2026-03-22T09:00:00Z", "ics", "Twice"),
      ...pair("23", "Gone", "Gone"),
      JSON.stringify({
        id: "00000000-0000-4000-8000-000000000999",
        seq: 99,
        at: "2026-03-25T00:00:00Z",
        end: null,
        tz: "Europe/Oslo",
        source: "manual",
        kind: "retraction",
        tier: 2,
        payload: {
          schema: "retraction/v1",
          supersedes: "00000000-0000-4000-8000-000000000948",
          seq: 48,
          reason: "dup",
        },
        recorded_at: "2026-03-25T00:00:00Z",
        prev: "0".repeat(64),
        hash: "0".repeat(64),
      }),
    ]);
    expect(rows(root, "20")).toEqual([
      "  09:00  event      ios-calendar   Lunch",
      "  09:00  event      ics            Lunch",
    ]);
    expect(rows(root, "21")).toEqual([
      "  09:00  event      ios-calendar   Tromsø marina",
      "  09:00  event      ics            Tromso marina",
    ]);
    expect(rows(root, "22")).toEqual([
      "  09:00  event      ics            Twice",
      "  09:00  event      ics            Twice",
    ]);
    expect(rows(root, "23")).toEqual([
      "  09:00  event      ios-calendar   Gone",
      "  09:00  retracted #48: dup",
    ]);
  });

  it("counts distinct sources, folds a repeated source in, and prints the first line's summary", () => {
    const root = copySample();
    const at = "2026-03-20T08:00:00Z";
    const end = "2026-03-20T09:00:00Z";
    writeLines(root, [
      ...readLines(root),
      event(at, end, "ics", "Coffee"),
      event(at, end, "ios-calendar", "Coffee", {
        attendees: [{ ref: { kind: "email", value: "b@example.org" }, name: "B" }],
      }),
      event(at, end, "gcal", "coffee"),
      event(at, end, "ics", "Coffee"),
    ]);
    expect(rows(root, "20")).toEqual(["  09:00  event      ×3 sources     Coffee"]);
    const [day] = run(["show", root, "--day", "2026-03-20", "--json"]).out.split("\n");
    const parsed = JSON.parse(day as string) as {
      rows: Array<{ source: string; lines: Array<{ source: string }> }>;
    };
    expect(parsed.rows[0]?.lines.map((l) => l.source)).toEqual([
      "ics",
      "ios-calendar",
      "gcal",
      "ics",
    ]);
  });
});
