import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eachLine, monthFiles, parseLine } from "../src/lines.js";
import { cleanup, SAMPLE, tempDir } from "./helpers.js";

afterEach(cleanup);

describe("eachLine", () => {
  it("yields each non-empty row with its 1-based row number, tolerating \\r and blank rows", () => {
    const file = join(tempDir(), "a.jsonl");
    writeFileSync(file, '{"a":1}\r\n\n  \n{"b":2}\n{"c":3}', "utf-8");
    expect([...eachLine(file)]).toEqual([
      { raw: '{"a":1}', row: 1, newline: true },
      { raw: '{"b":2}', row: 4, newline: true },
      { raw: '{"c":3}', row: 5, newline: false },
    ]);
  });

  it("says whether a row ended with a newline: false only for the last row of a file cut inside it", () => {
    const file = join(tempDir(), "d.jsonl");
    writeFileSync(file, '{"a":1}\n{"b":2}\n', "utf-8");
    expect([...eachLine(file)].map((r) => r.newline)).toEqual([true, true]);
    writeFileSync(file, '{"a":1}\n{"b":2}\r', "utf-8");
    expect([...eachLine(file)].map((r) => r.newline)).toEqual([true, false]);
    writeFileSync(file, '{"a":1}\n{"b":', "utf-8");
    expect([...eachLine(file, 3)]).toEqual([
      { raw: '{"a":1}', row: 1, newline: true },
      { raw: '{"b":', row: 2, newline: false },
    ]);
    writeFileSync(file, '{"a":1}\n   ', "utf-8");
    expect([...eachLine(file)]).toEqual([{ raw: '{"a":1}', row: 1, newline: true }]);
  });

  it("streams in chunks without splitting a multi-byte character", () => {
    const file = join(tempDir(), "b.jsonl");
    const rows = Array.from({ length: 200 }, (_, i) => `{"i":${i},"t":"Tromsø – ✓ 😀"}`);
    writeFileSync(file, `${rows.join("\n")}\n`, "utf-8");
    const seen = [...eachLine(file, 7)].map((r) => r.raw);
    expect(seen).toEqual(rows);
  });

  it("yields nothing for an empty file", () => {
    const file = join(tempDir(), "c.jsonl");
    writeFileSync(file, "", "utf-8");
    expect([...eachLine(file)]).toEqual([]);
  });
});

describe("monthFiles", () => {
  it("lists logbook/<YYYY>/<MM>.jsonl in order and skips anything else", () => {
    const root = tempDir();
    for (const rel of [
      ["2026", "03.jsonl"],
      ["2025", "12.jsonl"],
      ["2026", "01.jsonl"],
      ["2026", "13.jsonl"],
      ["2026", "notes.txt"],
      ["misc", "01.jsonl"],
    ]) {
      mkdirSync(join(root, "logbook", rel[0] as string), { recursive: true });
      writeFileSync(join(root, "logbook", ...rel), "", "utf-8");
    }
    writeFileSync(join(root, "logbook", "2024"), "a file named like a year", "utf-8");
    expect(monthFiles(root).map((m) => `${m.year}-${m.month}`)).toEqual([
      "2025-12",
      "2026-01",
      "2026-03",
    ]);
    expect(monthFiles(root)[0]?.file).toBe(join(root, "logbook", "2025", "12.jsonl"));
  });

  it("returns an empty list when there is no logbook folder", () => {
    expect(monthFiles(join(tempDir(), "nowhere"))).toEqual([]);
  });

  it("finds the sample's single month", () => {
    expect(monthFiles(SAMPLE)).toHaveLength(1);
  });
});

describe("parseLine", () => {
  it("returns the object for a JSON object row", () => {
    expect(parseLine('{"seq":1}', "x line 1")).toEqual({ line: { seq: 1 } });
  });

  it("reports non-JSON and non-object rows with their location", () => {
    expect(parseLine("nope", "x line 1")).toEqual({
      error: expect.stringMatching(/^x line 1: not JSON/),
      reason: "not-json",
    });
    expect(parseLine("[1]", "x line 2")).toEqual({
      error: "x line 2: not a JSON object",
      reason: "not-object",
    });
    expect(parseLine("null", "x line 3")).toEqual({
      error: "x line 3: not a JSON object",
      reason: "not-object",
    });
  });
});
