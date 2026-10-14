import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { eachLine, monthFiles, parseLine, RowReader } from "../src/lines.js";
import { pyRepr } from "../src/pyrepr.js";
import { cleanup, SAMPLE, tempDir } from "./helpers.js";

afterEach(cleanup);

describe("eachLine", () => {
  it("yields each non-empty row with its 1-based row number, tolerating \\r and blank rows", () => {
    const file = join(tempDir(), "a.jsonl");
    writeFileSync(file, '{"a":1}\r\n\n  \n{"b":2}\n{"c":3}', "utf-8");
    expect([...eachLine(file)]).toEqual([
      { raw: '{"a":1}', row: 1, newline: true, offset: 0 },
      { raw: '{"b":2}', row: 4, newline: true, offset: 13 },
      { raw: '{"c":3}', row: 5, newline: false, offset: 21 },
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
      { raw: '{"a":1}', row: 1, newline: true, offset: 0 },
      { raw: '{"b":', row: 2, newline: false, offset: 8 },
    ]);
    writeFileSync(file, '{"a":1}\n   ', "utf-8");
    expect([...eachLine(file)]).toEqual([{ raw: '{"a":1}', row: 1, newline: true, offset: 0 }]);
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

describe("RowReader", () => {
  it("gives each row's byte offset, counted in bytes, not characters", () => {
    const file = join(tempDir(), "e.jsonl");
    const rows = ['{"t":"Tromsø"}', '{"t":"😀"}', '{"t":"x"}'];
    writeFileSync(file, `${rows.join("\n")}\n`, "utf-8");
    const reader = new RowReader(file, 5);
    const offsets = [reader.next(), reader.next(), reader.next()].map((r) => r?.offset);
    expect(offsets).toEqual([0, 16, 29]);
    expect(reader.next()).toBeUndefined();
  });

  it("reads on from an offset it was sent to, behind or ahead, with the row number it is given", () => {
    const file = join(tempDir(), "f.jsonl");
    writeFileSync(file, '{"a":1}\n\n{"b":2}\n{"c":3}\n', "utf-8");
    const reader = new RowReader(file, 4);
    const all = [reader.next(), reader.next(), reader.next()];
    expect(all.map((r) => r?.offset)).toEqual([0, 9, 17]);
    reader.seek(9, 3);
    expect(reader.next()).toEqual({ raw: '{"b":2}', row: 3, newline: true, offset: 9 });
    reader.seek(0, 1);
    expect(reader.next()).toEqual({ raw: '{"a":1}', row: 1, newline: true, offset: 0 });
    reader.seek(17, 4);
    expect(reader.next()).toEqual({ raw: '{"c":3}', row: 4, newline: true, offset: 17 });
    expect(reader.next()).toBeUndefined();
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

describe("parseLine — a member name given twice in one object (SPEC §2)", () => {
  const twice = (raw: string, key: string) =>
    expect(parseLine(raw, "x line 7")).toEqual({
      error: `x line 7: duplicate key ${key}`,
      reason: "duplicate-key",
    });

  it("refuses the object at any depth, naming the decoded name as the reference quotes it", () => {
    twice('{"kind":"event","kind":"note"}', "'kind'");
    twice('{"payload":{"schema":"note/v1","text":"a","text":"b"}}', "'text'");
    twice('{"k\\u0069nd":"event","kind":"note"}', "'kind'");
    twice('{"kind":"event","k\\u0069nd":"note"}', "'kind'");
    twice('{"payload":{"attachments":[{"bytes":0,"bytes":41002}]}}', "'bytes'");
    twice('[{"a":1},{"a":1,"a":2}]', "'a'"); // found before the row is known not to be an object
    twice('{ "kind" : 1 ,\t"kind" : 2 }', "'kind'");
  });

  it("names what the reference names: the object that closes first, then its first name repeated", () => {
    // Run against the reference (`logbook verify`, a line of the sample so rewritten), never its source.
    twice('{"x":1,"x":{"b":1,"b":2}}', "'b'");
    twice('{"x":1,"x":2,"y":{"b":1,"b":2}}', "'b'");
    twice('{"p":1,"q":1,"q":2,"p":2}', "'q'");
    twice(`{"it's":1,"it's":2}`, `"it's"`);
    twice('{"Tromsø":1,"Troms\\u00f8":2}', "'Tromsø'");
    twice('{"a\\u0007":1,"a\\u0007":2}', "'a\\x07'");
    twice('{"😀":1,"\\ud83d\\ude00":2}', "'😀'");
  });

  it("takes a name repeated in sibling objects, in a list, or inside a string", () => {
    const raw =
      '{"m":{"k":1},"n":{"k":1},"l":[{"k":1},{"k":2}],"s":"\\"k\\":1,\\"k\\":2}","t":"\\\\","k":{}}';
    expect(parseLine(raw, "x line 1")).toEqual({ line: JSON.parse(raw) });
    expect(parseLine('{"kind":"note","Kind":"note","kind ":1}', "x line 2")).toEqual({
      line: { kind: "note", Kind: "note", "kind ": 1 },
    });
  });

  it("a row that is not JSON is said so, whatever names it repeats", () => {
    expect(parseLine('{"a":1,"a":2', "x line 1")).toMatchObject({ reason: "not-json" });
  });

  const keys = fc.string({ unit: "binary", maxLength: 6 });
  const objects = fc.dictionary(keys, fc.jsonValue({ maxDepth: 4 }), { maxKeys: 6 });

  it("takes any object JSON.stringify writes, as JSON.parse reads it", () => {
    fc.assert(
      fc.property(objects, (value) => {
        const raw = JSON.stringify(value);
        expect(parseLine(raw, "x line 1")).toEqual({ line: JSON.parse(raw) });
      }),
    );
  });

  it("refuses any such object with one of its names written again in front, naming it", () => {
    fc.assert(
      fc.property(objects, fc.nat(), fc.jsonValue({ maxDepth: 2 }), (value, pick, extra) => {
        const names = Object.keys(value);
        fc.pre(names.length > 0);
        const key = names[pick % names.length] as string;
        const raw = `{${JSON.stringify(key)}:${JSON.stringify(extra)},${JSON.stringify(value).slice(1)}`;
        expect(parseLine(raw, "x line 1")).toEqual({
          error: `x line 1: duplicate key ${pyRepr(key)}`,
          reason: "duplicate-key",
        });
      }),
    );
  });
});
