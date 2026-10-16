import { afterEach, describe, expect, it } from "vitest";
import { localToMs, utcIso } from "../src/clock.js";
import { readDay } from "../src/day.js";
import { renderDay } from "../src/dayText.js";
import { cleanup, type Draft, writeRecord } from "./helpers.js";

afterEach(cleanup);

/**
 * The Night line of the Day (docs/day.md of the reference since 0aeacdb, #288): when the owner slept,
 * derived from the `health-sample/v1` sleep stages and workouts. Every expected value below is what
 * the reference (main at 7bcf728) printed, as text and under `--json`, for the same lines, run on a
 * record of its own; the cross-implementation job holds the vendored days to it too. The person is
 * synthetic; Oslo's clock is two hours ahead of UTC on every day here.
 */

const TZ = "Europe/Oslo";
const at = (day: string, clock: string): string => utcIso(localToMs(day, clock, TZ));

let n = 0;
function stage(
  day: string,
  from: string,
  to: string | null,
  options: { stage?: unknown; device?: string | null; toDay?: string; end?: string } = {},
): Draft {
  n += 1;
  const payload: Record<string, unknown> = {
    schema: "health-sample/v1",
    type: "sleep",
    stage: "stage" in options ? options.stage : "core",
    unit: "s",
    value: 0,
    raw_id: `s${n}`,
  };
  const device = "device" in options ? options.device : "Watch";
  if (device !== null) payload.device = device;
  const end = options.end ?? (to === null ? null : at(options.toDay ?? day, to));
  return { at: at(day, from), end, source: "apple-health", kind: "health", tier: 1, payload };
}

function workout(day: string, from: string, to: string, end?: string): Draft {
  n += 1;
  return {
    at: at(day, from),
    end: end ?? at(day, to),
    source: "apple-health",
    kind: "health",
    tier: 1,
    payload: {
      schema: "health-sample/v1",
      type: "workout",
      unit: "s",
      value: 0,
      raw_id: `w${n}`,
      device: "Watch",
    },
  };
}

function sample(day: string, clock: string, type: string, value: number, unit: string): Draft {
  n += 1;
  return {
    at: at(day, clock),
    end: null,
    source: "apple-health",
    kind: "health",
    tier: 1,
    payload: { schema: "health-sample/v1", type, unit, value, raw_id: `v${n}`, device: "Watch" },
  };
}

/** The Night row and the health row of a day, as text. */
function rowsOf(root: string, day: string): string[] {
  return renderDay(readDay(root, { day }))
    .split("\n")
    .filter((row) => row.startsWith("  night  ") || row.startsWith("  health"));
}

const nightOf = (root: string, day: string) =>
  (JSON.parse(JSON.stringify(readDay(root, { day }))) as { night?: unknown }).night;

const id = (seq: number): string => `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;

describe("the Night line, as the reference reads it", () => {
  it("is one device's asleep stages with no gap over two hours, on the day the last one ends", () => {
    const root = writeRecord([
      stage("2026-06-01", "23:10", "23:59"),
      stage("2026-06-01", "23:59", "02:00", { stage: "deep", toDay: "2026-06-02" }),
      stage("2026-06-02", "02:00", "02:10", { stage: "awake" }),
      stage("2026-06-02", "02:10", "06:40", { stage: "rem" }),
      stage("2026-06-01", "23:00", "07:00", { stage: "in_bed", toDay: "2026-06-02" }),
    ]);
    expect(rowsOf(root, "2026-06-01")).toEqual([]);
    expect(nightOf(root, "2026-06-01")).toBeUndefined();
    expect(rowsOf(root, "2026-06-02")).toEqual(["  night         slept 23:10–06:40 · 7 h 20 min"]);
    expect(nightOf(root, "2026-06-02")).toEqual({
      start: "2026-06-01T21:10:00Z",
      end: "2026-06-02T04:40:00Z",
      start_local: "2026-06-01T23:10:00+02:00",
      end_local: "2026-06-02T06:40:00+02:00",
      asleep_s: 26400,
      device: "Watch",
      lines: [id(1), id(2), id(4)],
      training: null,
    });
  });

  it("splits at a gap over two hours, joins at two, and takes the longest night of the day", () => {
    const root = writeRecord([
      stage("2026-06-03", "00:00", "01:00"),
      stage("2026-06-03", "03:30", "07:00"),
      stage("2026-06-04", "00:00", "01:00"),
      stage("2026-06-04", "03:00", "07:00"),
      stage("2026-06-05", "00:00", "06:00"),
      stage("2026-06-05", "14:00", "14:30"),
    ]);
    expect(rowsOf(root, "2026-06-03")).toEqual(["  night         slept 03:30–07:00 · 3 h 30 min"]);
    expect(rowsOf(root, "2026-06-04")).toEqual(["  night         slept 00:00–07:00 · 5 h"]);
    expect(rowsOf(root, "2026-06-05")).toEqual(["  night         slept 00:00–06:00 · 6 h"]);
  });

  it("takes the longer of two devices, never their sum; a tie goes to the device first by name", () => {
    const root = writeRecord([
      stage("2026-06-06", "00:00", "06:00", { device: "Watch" }),
      stage("2026-06-05", "23:00", "07:00", { device: "Phone", toDay: "2026-06-06" }),
      stage("2026-08-01", "00:00", "06:00", { device: "Alpha" }),
      stage("2026-08-01", "01:00", "07:00", { device: "Beta" }),
      stage("2026-08-02", "00:00", "06:00", { device: "Beta" }),
      stage("2026-08-02", "01:00", "07:00", { device: "Alpha" }),
      stage("2026-08-03", "00:00", "06:00", { device: null }),
      stage("2026-08-03", "01:00", "07:00", { device: "A" }),
      stage("2026-08-04", "13:00", "15:00"),
      stage("2026-08-04", "03:00", "05:00"),
      stage("2026-08-05", "00:00", "06:00", { device: "b" }),
      stage("2026-08-05", "01:00", "07:00", { device: "A" }),
    ]);
    const device = (day: string) => (nightOf(root, day) as { device: unknown }).device;
    expect(rowsOf(root, "2026-06-06")).toEqual(["  night         slept 23:00–07:00 · 8 h"]);
    expect(device("2026-06-06")).toBe("Phone");
    expect([device("2026-08-01"), device("2026-08-02")]).toEqual(["Alpha", "Alpha"]);
    expect(device("2026-08-03")).toBeNull();
    expect(rowsOf(root, "2026-08-04")).toEqual(["  night         slept 03:00–05:00 · 2 h"]);
    expect(device("2026-08-05")).toBe("A");
  });

  it("counts the minutes asleep half to even, and says `< 1 min` for none", () => {
    const root = writeRecord([
      stage("2026-06-07", "00:00", null, { end: "2026-06-07T04:25:30Z" }),
      stage("2026-07-01", "00:00", null, { end: "2026-07-01T04:24:30Z" }),
      stage("2026-06-08", "05:00", "05:45"),
      stage("2026-06-09", "05:00", "06:00"),
      stage("2026-08-09", "00:00", null, { end: "2026-08-08T22:00:29Z" }),
      stage("2026-08-10", "00:00", null, { end: "2026-08-09T22:00:30Z" }),
      stage("2026-08-11", "00:00", null, { end: "2026-08-10T22:00:31Z" }),
    ]);
    expect(rowsOf(root, "2026-06-07")).toEqual(["  night         slept 00:00–06:25 · 6 h 26 min"]);
    expect((nightOf(root, "2026-06-07") as { end_local: string }).end_local).toBe(
      "2026-06-07T06:25:30+02:00",
    );
    expect(rowsOf(root, "2026-07-01")).toEqual(["  night         slept 00:00–06:24 · 6 h 24 min"]);
    expect(rowsOf(root, "2026-06-08")).toEqual(["  night         slept 05:00–05:45 · 45 min"]);
    expect(rowsOf(root, "2026-06-09")).toEqual(["  night         slept 05:00–06:00 · 1 h"]);
    expect(rowsOf(root, "2026-08-09")).toEqual(["  night         slept 00:00–00:00 · < 1 min"]);
    expect(rowsOf(root, "2026-08-10")).toEqual(["  night         slept 00:00–00:00 · < 1 min"]);
    expect(rowsOf(root, "2026-08-11")).toEqual(["  night         slept 00:00–00:00 · 1 min"]);
  });

  it("reads the asleep stages only, a stage with no end as an instant, never one that ends before it starts", () => {
    const stages = ["light", "unspecified", "asleep_core", "in_bed", "awake", "asleep", "deep"];
    const root = writeRecord([
      ...stages.map((name, i) =>
        stage("2026-07-05", `0${i}:00`, `0${i}:30`, { stage: name, device: `D${i}` }),
      ),
      stage("2026-07-07", "01:00", null, { device: "X" }),
      stage("2026-07-07", "03:00", "02:00", { device: "Y" }),
      stage("2026-07-08", "01:00", "06:00", { stage: null, device: "Z" }),
    ]);
    expect((nightOf(root, "2026-07-05") as { device: string }).device).toBe("D5");
    expect(rowsOf(root, "2026-07-07")).toEqual(["  night         slept 01:00–01:00 · < 1 min"]);
    expect(nightOf(root, "2026-07-07")).toMatchObject({ asleep_s: 0, device: "X" });
    expect(nightOf(root, "2026-07-08")).toBeUndefined();
  });

  it("puts a night that ends at midnight on the day that begins then", () => {
    const root = writeRecord([stage("2026-07-05", "22:00", "00:00", { toDay: "2026-07-06" })]);
    expect(nightOf(root, "2026-07-05")).toBeUndefined();
    expect(rowsOf(root, "2026-07-06")).toEqual(["  night         slept 22:00–00:00 · 2 h"]);
  });

  it("reads the stages that start from the day before to the day's end, and no further", () => {
    const root = writeRecord([
      stage("2026-09-01", "22:00", "23:30"),
      stage("2026-09-02", "01:00", "03:00"),
      stage("2026-09-10", "22:00", "23:00"),
      stage("2026-09-10", "23:30", "00:30", { toDay: "2026-09-11" }),
      stage("2026-09-12", "23:50", "01:00", { toDay: "2026-09-13" }),
      stage("2026-09-13", "02:00", "01:00", { toDay: "2026-09-14" }),
    ]);
    // The day's own stages say it slept 22:00–23:30, though the next day's continue the night.
    expect(rowsOf(root, "2026-09-01")).toEqual(["  night         slept 22:00–23:30 · 1 h 30 min"]);
    expect(rowsOf(root, "2026-09-02")).toEqual(["  night         slept 22:00–03:00 · 3 h 30 min"]);
    expect(nightOf(root, "2026-09-10")).toBeUndefined();
    expect(rowsOf(root, "2026-09-11")).toEqual(["  night         slept 22:00–00:30 · 2 h"]);
    expect(rowsOf(root, "2026-09-14")).toEqual(["  night         slept 02:00–01:00 · 23 h"]);
  });

  it("adds the day's training: the union of the workouts that start on it", () => {
    const root = writeRecord([
      stage("2026-06-11", "00:00", "06:00"),
      workout("2026-06-11", "08:00", "09:00"),
      workout("2026-06-11", "08:30", "09:15"),
      workout("2026-06-10", "22:00", "22:30"),
      workout("2026-06-11", "18:00", "18:00"),
      workout("2026-06-10", "08:00", "09:00"),
      stage("2026-06-16", "00:00", "06:00"),
      workout("2026-06-16", "08:00", "", "2026-06-16T06:55:30Z"),
      stage("2026-07-01", "00:00", "06:00"),
      workout("2026-07-01", "08:00", "", "2026-07-01T06:54:30Z"),
      stage("2026-08-07", "00:00", "06:00"),
      workout("2026-08-07", "09:00", "09:00"),
    ]);
    expect(rowsOf(root, "2026-06-11")).toEqual([
      "  night         slept 00:00–06:00 · 6 h · training 1 h 15 min",
    ]);
    expect((nightOf(root, "2026-06-11") as { training: unknown }).training).toEqual({
      minutes: 75,
      lines: [id(2), id(3), id(5)],
    });
    // Training without a night is not shown: the row is the night's.
    expect(rowsOf(root, "2026-06-10")).toEqual(["  health        no lines"]);
    expect(rowsOf(root, "2026-06-16")).toEqual([
      "  night         slept 00:00–06:00 · 6 h · training 56 min",
    ]);
    expect(rowsOf(root, "2026-07-01")).toEqual([
      "  night         slept 00:00–06:00 · 6 h · training 54 min",
    ]);
    expect(rowsOf(root, "2026-08-07")).toEqual([
      "  night         slept 00:00–06:00 · 6 h · training < 1 min",
    ]);
  });

  it("honours a correction that supersedes a stage or a workout, and a retraction", () => {
    const first = stage("2026-07-09", "00:00", "06:00");
    const workoutLine = workout("2026-07-09", "08:00", "09:00");
    const drafts: Draft[] = [
      first,
      { ...stage("2026-07-09", "00:00", "04:00") },
      workoutLine,
      workout("2026-07-09", "10:00", "10:20"),
      stage("2026-07-09", "13:00", "20:00"),
    ];
    (drafts[1] as Draft).payload.supersedes = id(1);
    (drafts[3] as Draft).payload.supersedes = id(3);
    drafts.push({
      at: at("2026-07-09", "21:00"),
      source: "manual",
      kind: "retraction",
      payload: { schema: "retraction/v1", supersedes: id(5), seq: 5, reason: "not sleep" },
    });
    const root = writeRecord(drafts);
    expect(rowsOf(root, "2026-07-09")).toEqual([
      "  night         slept 00:00–04:00 · 4 h · training 20 min",
    ]);
  });
});

describe("the health row beside the Night line", () => {
  it("says the sleep once, on the Night line: no row for sleep alone, nor for a heart rate variability", () => {
    const root = writeRecord([
      stage("2026-09-07", "00:00", "06:00"),
      sample("2026-09-08", "06:00", "hrv", 40, "s"),
      sample("2026-09-09", "08:00", "steps", 100, "count"),
    ]);
    expect(rowsOf(root, "2026-09-07")).toEqual(["  night         slept 00:00–06:00 · 6 h"]);
    expect(rowsOf(root, "2026-09-08")).toEqual([]);
    expect(rowsOf(root, "2026-09-09")).toEqual(["  health        100 steps"]);
    expect(readDay(root, { day: "2026-09-07" }).health?.sleep_h).toBe(6);
  });

  it("reads a heart rate variability given in seconds as milliseconds, as the reference does", () => {
    const root = writeRecord([
      sample("2026-09-07", "06:00", "hrv", 42, "ms"),
      sample("2026-09-07", "07:00", "hrv", 0.05, "s"),
      sample("2026-09-16", "06:00", "hrv", 42, ""),
      sample("2026-09-16", "07:00", "hrv", 0.05, "min"),
    ]);
    expect(readDay(root, { day: "2026-09-07" }).health?.hrv).toBe(46);
    expect(readDay(root, { day: "2026-09-16" }).health?.hrv).toBe(21);
  });
});

describe("the night's sleep under `health`, two devices equally long", () => {
  // Run on the reference (main at 7bcf728): on a tie, `health.lines` holds the stages of the device
  // whose first stage comes first in the record (by seq), not the one that fell asleep first; found by
  // the independent review. `sleep_h` is the same either way.
  const sleep = (device: string, from: string, to: string): Draft => ({
    ...stage("2026-07-04", "00:00", null, { device, end: to }),
    at: from,
  });
  it("takes the device written first", () => {
    const bandFirst = sleep("Band", "2026-07-03T21:00:00Z", "2026-07-04T01:00:00Z");
    const watch = sleep("Watch", "2026-07-03T22:00:00Z", "2026-07-04T02:00:00Z");
    const watchA = sleep("Watch", "2026-07-03T23:00:00Z", "2026-07-04T01:00:00Z");
    const watchB = sleep("Watch", "2026-07-04T01:00:00Z", "2026-07-04T03:00:00Z");
    const lines = (drafts: Draft[]) => {
      const health = readDay(writeRecord(drafts), { day: "2026-07-04" }).health;
      return { sleep: health?.sleep_h, lines: health?.lines };
    };
    expect(lines([bandFirst, watch])).toEqual({ sleep: 4, lines: [id(1)] });
    expect(lines([watch, bandFirst])).toEqual({ sleep: 4, lines: [id(1)] });
    expect(lines([watchA, bandFirst, watchB])).toEqual({ sleep: 4, lines: [id(1), id(3)] });
    expect(lines([bandFirst, watchA, watchB])).toEqual({ sleep: 4, lines: [id(1)] });
  });
});
