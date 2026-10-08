import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDay, type SegmentEntry, type TimelineEntry } from "../src/day.js";
import { durationText, renderDay } from "../src/dayText.js";
import { verifyLogbook } from "../src/store.js";
import {
  cleanup,
  copySample,
  expectedDays,
  FIXTURES,
  readLines,
  writeLines,
  writeRecord,
} from "./helpers.js";

afterEach(cleanup);

const DAY_SAMPLE = join(FIXTURES, "day-sample");
const DEMO_SAMPLE = join(FIXTURES, "demo-sample");

const isRow = (t: TimelineEntry): t is SegmentEntry => t.kind !== "flight";
const rows = (timeline: TimelineEntry[]): SegmentEntry[] => timeline.filter(isRow);

describe("the day fixtures", () => {
  it("are valid logbook/0.2 records", () => {
    expect(verifyLogbook(DAY_SAMPLE).errors).toEqual([]);
    expect(verifyLogbook(DEMO_SAMPLE).errors).toEqual([]);
  });
});

describe("a Day, as the reference's `logbook day` prints it", () => {
  // tests/fixtures/*/expected-day/ is the reference's own output on each fixture, captured by
  // tests/fixtures/capture-expected-day.mjs and never edited; tests/cross-impl.test.ts checks it stays so.
  for (const fixture of [DAY_SAMPLE, DEMO_SAMPLE]) {
    for (const expected of expectedDays(fixture)) {
      it(`prints ${expected.day} of ${fixture.split(/[\\/]/).pop()} as the reference does, as text and as JSON`, () => {
        const day = readDay(fixture, { day: expected.day });
        expect(renderDay(day)).toBe(expected.text);
        expect(JSON.parse(JSON.stringify(day))).toEqual(expected.json);
      });
    }
  }
});

describe("what the Day reads out of the record", () => {
  const monday = () => readDay(DAY_SAMPLE, { day: "2026-04-06" });

  it("never makes the owner their own company: by owner_emails, by the face the library tagged, by the name in policy/owner.json", () => {
    const day = monday();
    const names = JSON.stringify(rows(day.timeline).map((t) => t.with));
    expect(names).not.toContain("Kari");
    const office = rows(day.timeline).find((t) => t.kind === "stay" && t.place === "Office");
    expect(office?.with?.confirmed.map((p) => `${p.name}: ${p.sources.join("+")}`)).toEqual([
      "Ola Nordmann: calendar+transcript+note+photo",
      "Ines Holm: transcript",
      "Per: calendar",
    ]);
    expect(office?.with?.proposed.map((p) => [p.person, p.name])).toEqual([[null, "immich:f_99"]]);
  });

  it("leaves a retracted line out of everything: the rows, the health numbers, the sources", () => {
    const day = monday();
    const home = rows(day.timeline)
      .filter((t) => t.kind === "stay" && t.place === "Home")
      .at(-1);
    expect(home?.attached?.notes.map((n) => n.text)).toEqual([
      "Draft of the evening note.",
      "Final evening note with Ola Nordmann.",
    ]);
    expect(day.health?.steps).toBe(370);
    expect(day.sources.find((s) => s.source === "apple-health")?.lines).toBe(17);
    expect(day.sources.find((s) => s.source === "logbook")).toBeUndefined();
  });

  it("takes the night's sleep from the longest device's union of asleep stages, the steps from the larger device per quarter hour, and the corrected resting rate", () => {
    const health = monday().health;
    expect(health).toMatchObject({ sleep_h: 6.4, steps: 370, resting_hr: 57, hrv: 42 });
    expect(health?.lines).toHaveLength(11);
  });

  it("places what the tracker saw nothing of nowhere, and says so", () => {
    const day = monday();
    const gap = rows(day.timeline).find((t) => t.kind === "move" && t.gap);
    expect(gap?.attached?.events).toEqual([]);
    expect(day.unplaced.map((u) => `${u.kind} ${u.title}`)).toEqual([
      "note Walked along the river with Ines Holm.",
      "event Dentist",
      "call +4790000002",
      "mail Tromsø",
      "transcript River talk",
    ]);
    expect(renderDay(day)).toContain("  14:00–18:00  gap    4 h · no points · 4.7 km\n");
  });

  it("reads a night with no stay as in transit, the country from the day's longest stay, and a day with nothing as nothing logged", () => {
    const thursday = readDay(DAY_SAMPLE, { day: "2026-04-09" });
    expect(thursday.nights.after).toMatchObject({
      in_transit: true,
      where: null,
      stay: null,
      lines: [],
    });
    expect(thursday.country).toEqual({
      code: "NO",
      method: "airport",
      by: "BGO",
      from: "longest stay",
    });
    expect(thursday.health).toBeNull();
    const saturday = readDay(DAY_SAMPLE, { day: "2026-04-11" });
    expect(saturday.timeline).toEqual([]);
    expect(saturday.country).toEqual({ code: null, method: null, by: null, from: null });
    expect(renderDay(saturday)).toContain("  timeline      nothing logged\n");
  });

  it("nests a run aboard an asset and names the night aboard it", () => {
    const wednesday = readDay(DAY_SAMPLE, { day: "2026-04-08" });
    const run = rows(wednesday.timeline).find((t) => t.kind === "aboard");
    expect(run?.asset).toEqual({ id: "solvind", kind: "yacht", name: "Solvind" });
    expect(run?.inside?.map((s) => `${s.kind} ${s.where ?? s.mode}`)).toEqual([
      "stay Berth",
      "move boat",
      "stay BGO, Bergen",
    ]);
    expect(run?.id).toBe("aboard:solvind:20260408T0715Z");
    // The container's centre is the inner stay spent longest at: the anchorage, not the berth.
    expect([run?.lat, run?.lon]).toEqual([60.3, 5.2]);
    expect(wednesday.nights.after).toEqual({
      day: "2026-04-08",
      where: "aboard Solvind",
      home: false,
      aboard: "solvind",
      in_transit: false,
      stay: "stay:owner:20260408T0715Z@60.3000,5.2000",
      position: { lat: 60.3, lon: 5.2 },
      lines: ["00000000-0000-4000-8000-0000000004912", "00000000-0000-4000-8000-00000000041137"],
    });
    expect(renderDay(wednesday)).toContain(
      "  night after   aboard Solvind · 60.3000,5.2000 · away\n",
    );
    // The run that began the day before is still one container on the next day, whole: its id,
    // points, lines and centre are the run's, and only the rows that touch the day are inside it.
    const thursday = readDay(DAY_SAMPLE, { day: "2026-04-09" });
    const tail = rows(thursday.timeline).find((t) => t.kind === "aboard");
    expect(tail).toMatchObject({
      id: "aboard:solvind:20260408T0715Z",
      duration_s: 60300,
      within_day: { duration_s: 7200 },
      points: 202,
      distance_m: 0,
      lines: { first: "00000000-0000-4000-8000-0000000004912" },
    });
    expect(tail?.inside?.map((s) => s.id)).toEqual(["stay:owner:20260408T1100Z@60.3000,5.2000"]);
  });

  it("makes a single stay aboard an asset a container too, and a stay with no run aboard a plain stay", () => {
    const saturday = readDay(DEMO_SAMPLE, { day: "2026-06-13" });
    const run = rows(saturday.timeline).find((t) => t.kind === "aboard");
    expect(run?.asset).toEqual({ id: "nordlys", kind: "yacht", name: "Nordlys" });
    expect(run?.inside?.map((s) => `${s.kind} ${s.where}`)).toEqual(["stay Marina"]);
    expect(renderDay(saturday)).toContain(
      "  09:45–15:05  aboard Nordlys (yacht) · 5 h 20 min · 1 event, 2 messages, 1 photo\n      09:45–15:05  stay   Marina · 5 h 20 min\n",
    );
    expect(saturday.nights.after).toMatchObject({
      where: "Home",
      home: true,
      aboard: null,
      position: { lat: 59.91389, lon: 10.752201 },
    });
  });

  it("labels an unnamed stay by the nearest named place within 5 km, and a night by its position", () => {
    const monday = readDay(DAY_SAMPLE, { day: "2026-04-06" });
    expect(rows(monday.timeline).map((t) => t.where)).toContain(
      "59.9120,10.7560 near Home, 0.3 km",
    );
    expect(monday.nights.before.position).toEqual({ lat: 59.9139, lon: 10.7522 });
    const tuesday = readDay(DAY_SAMPLE, { day: "2026-04-07" });
    expect(tuesday.nights.after).toMatchObject({
      where: "60.3900,5.3200 near Berth, 0.8 km",
      position: { lat: 60.39, lon: 5.32 },
    });
    const thursday = readDay(DAY_SAMPLE, { day: "2026-04-09" });
    expect(thursday.nights.after.position).toBeNull();
  });

  it("shows the flight line standing, with the declared line its tracked one supersedes left out", () => {
    const tuesday = readDay(DAY_SAMPLE, { day: "2026-04-07" });
    expect(tuesday.flights.map((f) => [f.carrier, f.number, f.from, f.to, f.evidence])).toEqual([
      ["XY", "123", "OSL", "BGO", "tracked"],
      [null, null, "BGO", "ENGM", "inferred"],
    ]);
    const move = rows(tuesday.timeline).find((t) => t.kind === "move" && t.mode === "flight");
    expect(move?.flights).toEqual([tuesday.flights[0]?.id]);
  });

  it("refuses a day that is not one, and a record it does not carry", () => {
    expect(() => readDay(DAY_SAMPLE, { day: "2026-04-31" })).toThrow(/not a day/);
    const root = copySample();
    const meta = JSON.parse(readLines(root, "logbook.json").join("")) as Record<string, unknown>;
    writeLines(root, [JSON.stringify({ ...meta, format: "logbook/0.1" })], "logbook.json");
    expect(() => readDay(root, { day: "2026-03-02" })).toThrow(/logbook\/0\.1/);
  });

  it("reads the conformance sample, which has no places, assets or policy, without a word about them", () => {
    const day = readDay(copySample(), { day: "2026-03-01" });
    expect(day.nights.after.home).toBe(false);
    expect(renderDay(day)).toMatch(/^2026-03-01 {2}Sunday · signed 2026-03-08 20:30\n/);
  });
});

describe("spans and distances in words", () => {
  it("rounds to the minute and folds hours", () => {
    expect(durationText(300)).toBe("5 min");
    expect(durationText(975)).toBe("16 min");
    expect(durationText(225)).toBe("4 min");
    expect(durationText(17_700)).toBe("4 h 55 min");
    expect(durationText(32_400)).toBe("9 h");
    expect(durationText(31_000)).toBe("8 h 37 min");
    expect(durationText(86_400)).toBe("24 h");
  });
});

describe("the spend line, as the reference's `logbook day` prints it since its ledger (docs/ledger.md, *The Day*)", () => {
  const Z = "2026-04-06T";
  const tx = (
    at: string,
    amount: number,
    currency: string,
    merchant?: string,
    extra: Record<string, unknown> = {},
  ) => ({
    at,
    source: "copilot",
    kind: "transaction",
    tier: 3 as const,
    payload: {
      schema: "transaction/v1",
      raw_id: `${at}:${amount}`,
      account: "acct_1",
      amount,
      currency,
      date: "2026-04-06",
      ...(merchant === undefined ? {} : { merchant }),
      provider: "copilot",
      status: "posted",
      ...extra,
    },
  });
  const id = (seq: number) => `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  // In file order; the clock order of the first two differs from it.
  const record = () =>
    writeRecord([
      tx(`${Z}09:00:00Z`, -2, "NOK", "Second by clock, first in the file"),
      tx(`${Z}08:00:00Z`, -1, "NOK", "First by clock"),
      tx(`${Z}10:00:00Z`, -94.5, "CHF", "Gasthaus zur Brücke"),
      tx(`${Z}11:00:00Z`, 45000, "NOK", "Arbeidsgiver AS"),
      tx(`${Z}12:00:00Z`, -10, "NOK", "Deleted unique", { extra: { deleted: true } }),
      tx(`${Z}13:00:00Z`, -20, "NOK"),
      tx(`${Z}14:00:00Z`, -30, "NOK", "Old"),
      tx(`${Z}14:10:00Z`, -31, "NOK", "Older correction", { supersedes: id(7) }),
      tx(`${Z}14:20:00Z`, -32, "NOK", "Latest correction", { supersedes: id(8) }),
      tx(`${Z}15:00:00Z`, -50, "NOK", "Retracted shop"),
      {
        at: `${Z}15:30:00Z`,
        source: "manual",
        kind: "retraction",
        tier: 2 as const,
        payload: { schema: "retraction/v1", supersedes: id(10), reason: "wrong" },
      },
      // 00:30 on the 7th in Oslo, dated the 6th by the source: the day of `at` counts.
      tx(`${Z}22:30:00Z`, -77, "NOK", "Nattkiosk"),
    ]);

  it("sums the transaction lines standing on the day per currency, in file order, a deleted one listed but not counted, a superseded or retracted one out", () => {
    const day = readDay(record(), { day: "2026-04-06" });
    expect(day.spend).toEqual({
      count: 6,
      deleted: 1,
      totals: {
        CHF: { spent: -94.5, received: 0, net: -94.5 },
        NOK: { spent: -55, received: 45000, net: 44945 },
      },
      merchants: [
        "Second by clock, first in the file",
        "First by clock",
        "Gasthaus zur Brücke",
        "Arbeidsgiver AS",
        "Latest correction",
      ],
      lines: [1, 2, 3, 4, 5, 6, 9].map(id),
    });
    expect(renderDay(day)).toContain(
      "\n  health        no lines\n  spend         CHF -94.50 · NOK 44,945.00 · 6 transactions · 1 deleted · Second by clock, first in the file, First by clock, Gasthaus zur Brücke, Arbeidsgiver AS +1\n  sources       ",
    );
  });

  it("counts a transaction on the local day of its `at`, whatever `date` says, and prints `1 transaction`", () => {
    const day = readDay(record(), { day: "2026-04-07" });
    expect(day.spend).toEqual({
      count: 1,
      deleted: 0,
      totals: { NOK: { spent: -77, received: 0, net: -77 } },
      merchants: ["Nattkiosk"],
      lines: [id(12)],
    });
    expect(renderDay(day)).toContain("\n  spend         NOK -77.00 · 1 transaction · Nattkiosk\n");
  });

  it("is null, and no line, on a day without a transaction", () => {
    const day = readDay(record(), { day: "2026-04-08" });
    expect(day.spend).toBeNull();
    expect(renderDay(day)).not.toContain("spend");
    expect(readDay(DAY_SAMPLE, { day: "2026-04-06" }).spend).toBeNull();
  });
});
