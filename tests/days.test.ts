import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { kilometresText, readDayRows, renderDayRow, renderDayRows } from "../src/days.js";
import { LogbookError, verifyLogbook } from "../src/store.js";
import { cleanup, expectedDaysWindows, FIXTURES, writeRecord } from "./helpers.js";

afterEach(cleanup);

const FIXTURE_NAMES = [
  "sample-logbook",
  "demo-seed-1",
  "day-sample",
  "trips-sample",
  "demo-sample",
  "show-sample",
  "profiles-sample",
];

describe("the demo record of seed 1", () => {
  it("is a valid logbook/0.2 record of 12,772 lines, the one SPEC §6.1 compares implementations on", () => {
    const result = verifyLogbook(join(FIXTURES, "demo-seed-1"));
    expect(result.errors).toEqual([]);
    expect(result.lines).toBe(12772);
  });
});

describe("days, as the reference's `logbook days` prints them", () => {
  // tests/fixtures/*/expected-days/ is the reference's own output on each fixture, captured by
  // tests/fixtures/capture-expected-readers.mjs and never edited; tests/cross-impl.test.ts checks it stays so.
  for (const name of FIXTURE_NAMES) {
    const root = join(FIXTURES, name);
    for (const expected of expectedDaysWindows(root)) {
      it(`prints ${name} (${expected.name}) as the reference does, as text and as JSON Lines`, () => {
        const read = readDayRows(root, expected.options);
        expect(read.rows.map((row) => JSON.parse(JSON.stringify(row)))).toEqual(expected.rows);
        expect(renderDayRows(read)).toBe(expected.text);
      });
    }
  }
});

describe("what a row of days carries", () => {
  const demo = join(FIXTURES, "demo-seed-1");

  it("defaults the window to the days the track covers: any location line bounds it, a vessel's included", () => {
    const sample = readDayRows(join(FIXTURES, "sample-logbook"), {});
    // The sample's owner has points on 2026-03-01 only; a vessel's AIS line on 2026-03-08 closes the window.
    expect([sample.since, sample.until]).toEqual(["2026-03-01", "2026-03-08"]);
    expect(sample.rows.map((r) => r.day).length).toBe(8);
    const whole = readDayRows(demo, {});
    expect([whole.since, whole.until]).toEqual(["2026-06-01", "2026-06-30"]);
  });

  it("takes a bound given beyond the track as it is: days before the first line read `no location` and `nothing logged`", () => {
    const read = readDayRows(demo, { from: "2026-05-30", to: "2026-06-01" });
    expect(read.rows.map((r) => r.day)).toEqual(["2026-05-30", "2026-05-31", "2026-06-01"]);
    const first = read.rows[0];
    expect(first?.night).toMatchObject({ in_transit: true, located: false, where: null });
    expect(first?.sources).toEqual([]);
    expect(renderDayRow(first as NonNullable<typeof first>)).toBe(
      "2026-05-30  Sat  no location                      0.0 km  nothing logged\n",
    );
    // Over the whole month the tracker, the watch, the boat and the messages are usual; a day they
    // are silent names them, and a day beyond the record names them all.
    const whole = readDayRows(demo, { from: "2026-06-14", to: "2026-07-01" }).rows;
    expect(whole.find((r) => r.day === "2026-06-15")?.gaps).toEqual(["whatsapp"]);
    expect(whole.find((r) => r.day === "2026-07-01")?.gaps).toEqual([
      "ais",
      "apple-health",
      "dawarich",
      "safari",
      "whatsapp",
    ]);
  });

  it("refuses a range that runs backwards and a bound that is not a day", () => {
    expect(() => readDayRows(demo, { from: "2026-06-12", to: "2026-06-10" })).toThrow(LogbookError);
    expect(() => readDayRows(demo, { from: "2026-6-1" })).toThrow(LogbookError);
  });

  it("composes every number from the Day: the night after with the country, the moves started on the day, the flights, the stays, the people, the health line", () => {
    const rows = readDayRows(demo, { from: "2026-06-08", to: "2026-06-08" }).rows;
    const day = rows[0];
    expect(day?.night).toMatchObject({
      where: "47.3769,8.5417 (Zurich)",
      home: false,
      aboard: null,
      in_transit: false,
      located: true,
    });
    expect(day?.country).toBe("CH");
    expect(day?.flights).toEqual([
      expect.objectContaining({ carrier: "XY", number: "561", from: "OSL", to: "ZRH" }),
    ]);
    expect(day?.stays.count).toBe(4);
    expect(day?.moved_m).toBeGreaterThan(1_470_000);
    expect(renderDayRow(day as NonNullable<typeof day>)).toBe(
      "2026-06-08  Mon  47.3769,8.5417 (Zurich) CH     1,471 km  XY 561 OSL→ZRH · 4 stays (6 attached) · sleep 6.1 h · 7,839 steps · resting 57 bpm\n",
    );
  });

  it("derives the stays over a month at a time, so a run aboard that spans days is one row on each and keeps its start", () => {
    const week = readDayRows(demo, {}).rows.filter(
      (r) => r.day >= "2026-06-15" && r.day <= "2026-06-17",
    );
    expect(week.map((r) => r.night.stay)).toEqual([
      "stay:owner:20260615T0645Z@59.0500,10.0300",
      "stay:owner:20260615T0645Z@59.0500,10.0300",
      "stay:owner:20260615T0645Z@59.0500,10.0300",
    ]);
    expect(week.map((r) => r.night.where)).toEqual([
      "aboard Nordlys",
      "aboard Nordlys",
      "aboard Nordlys",
    ]);
  });

  it("marks a gap for every usual source silent on the day: usual is a line on four in five of the days that have any line", () => {
    const note = (at: string, source: string) => ({
      at,
      source,
      kind: "note",
      payload: { schema: "note/v1", text: "a line" },
    });
    // Five days with lines: `phone` speaks on four of them, `camera` on three; a sixth day is empty and does not count.
    const root = writeRecord([
      note("2026-04-01T10:00:00Z", "phone"),
      note("2026-04-01T11:00:00Z", "camera"),
      note("2026-04-02T10:00:00Z", "phone"),
      note("2026-04-02T11:00:00Z", "camera"),
      note("2026-04-03T10:00:00Z", "phone"),
      note("2026-04-04T11:00:00Z", "camera"),
      note("2026-04-05T10:00:00Z", "phone"),
    ]);
    const read = readDayRows(root, { from: "2026-04-01", to: "2026-04-06" });
    expect(read.rows.map((r) => r.gaps)).toEqual([[], [], [], ["phone"], [], ["phone"]]);
    expect(renderDayRow(read.rows[3] as NonNullable<(typeof read.rows)[3]>)).toBe(
      "2026-04-04  Sat  no location                      0.0 km  0 stays · gap phone\n",
    );
    expect(renderDayRow(read.rows[5] as NonNullable<(typeof read.rows)[5]>)).toBe(
      "2026-04-06  Mon  no location                      0.0 km  nothing logged · gap phone\n",
    );
  });

  it("spells the kilometres as the reference does: one decimal under 100 km, whole with a thousands separator above", () => {
    expect(kilometresText(0)).toBe("0.0 km");
    expect(kilometresText(1125)).toBe("1.1 km");
    expect(kilometresText(250)).toBe("0.2 km"); // half to even, as Python formats 0.25
    expect(kilometresText(118_950)).toBe("119 km");
    expect(kilometresText(1_471_400)).toBe("1,471 km");
  });
});
