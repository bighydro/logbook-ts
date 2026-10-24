import { afterEach, describe, expect, it } from "vitest";
import { readDay } from "../src/day.js";
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
