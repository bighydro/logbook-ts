import { afterEach, describe, expect, it } from "vitest";
import { noteText, readDay } from "../src/day.js";
import { pyRstrip, pyStrip } from "../src/entities.js";
import { showDay } from "../src/show.js";
import { cleanup, writeRecord } from "./helpers.js";
import { DAY, NOTE_TEXTS, notesRecord } from "./note-text-cases.js";

afterEach(cleanup);

describe("a note's text, as the reference prints it at d053f78 (run)", () => {
  it("show: Python's str() of the text, its end stripped, its first line not blank, the lines after counted", () => {
    const rows = showDay(writeRecord(notesRecord()), { day: DAY }).text.split("\n");
    expect(rows.slice(2, 2 + NOTE_TEXTS.length).map((row) => row.slice(35))).toEqual(
      NOTE_TEXTS.map(([, show]) => show),
    );
  });

  it("the Day: Python's str() of the text, stripped, its first line, (empty) for nothing, cut to 72", () => {
    const day = readDay(writeRecord(notesRecord()), { day: DAY });
    const stay = day.timeline[0] as { attached: { notes: Array<{ text: string }> } };
    expect(stay.attached.notes.map((n) => n.text)).toEqual(NOTE_TEXTS.map(([, , text]) => text));
  });
});

describe("Python's strip, in a scan: a long run of spaces costs its length, not its square", () => {
  it("a note of 200,000 spaces between two words reads in well under a second", () => {
    const text = `a${" ".repeat(200_000)}b ${" ".repeat(200_000)}`;
    const started = performance.now();
    expect(pyStrip(text)).toBe(`a${" ".repeat(200_000)}b`);
    expect(pyRstrip(text)).toBe(`a${" ".repeat(200_000)}b`);
    expect(noteText(text)).toBe(`a${" ".repeat(70)}…`);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("strips Python's whitespace and no other: \\x1c–\\x1f and \\x85 go, a BOM stays", () => {
    expect(pyStrip("\x1c\x1f\x85 a 　")).toBe("a");
    expect(pyStrip("﻿a﻿")).toBe("﻿a﻿");
    expect(pyRstrip(" a \x1f")).toBe(" a");
  });
});
