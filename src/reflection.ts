/**
 * The Day's reflection (the reference's docs/day.md, *reflection*; its `day reflect` since 0.7.0, and
 * a note labelled `reflection` through its MCP door): the owner's own words closing the day, one
 * `note/v1` line on it labelled `reflection`. The Day shows the latest in a section of its own, below
 * the header and above the timeline, and `day --json` carries it under `reflection`, a key present
 * only on a day that has one. Matched by running the reference at d053f78, never by reading it:
 *
 * - a reflection is a `note/v1` line of kind `note` whose `labels` is a list holding `reflection`, as
 *   written (`Reflection` is not), on the day by its `at`, not retracted;
 * - the latest by `at`, a tie going to the later `seq`; a reflection another names in `supersedes`
 *   still counts, by its time (SPEC-QUESTIONS 123);
 * - its text as written, a value that is not a string as Python prints it, none as empty; the
 *   section wraps it as Python's `textwrap` does with words kept whole, at 76 columns after an indent
 *   of 16 (`wrapText`).
 */

import { localIso } from "./clock.js";
import { pyStrip } from "./entities.js";
import { pyStr } from "./pyrepr.js";
import { splitLines, truthy } from "./render.js";
import type { JsonValue, Line } from "./types.js";

export const REFLECTION_LABEL = "reflection";

/** The reflection as `day --json` gives it. */
export interface DayReflection {
  line: string;
  seq: number;
  at: string;
  at_local: string;
  source: string;
  text: string;
}

/** Whether a line is a reflection: a `note/v1` note labelled `reflection`. */
export function isReflection(line: Line): boolean {
  const p = line.payload;
  return (
    line.kind === "note" &&
    p?.schema === "note/v1" &&
    Array.isArray(p.labels) &&
    p.labels.includes(REFLECTION_LABEL)
  );
}

/**
 * The day's reflection among its standing lines (each with its instant), or undefined when it has
 * none: the latest by `at`, then by `seq`.
 */
export function latestReflection(
  lines: ReadonlyArray<{ line: Line; ms: number }>,
  timezone: string,
): DayReflection | undefined {
  let best: { line: Line; ms: number } | undefined;
  for (const e of lines) {
    if (!isReflection(e.line)) continue;
    if (best === undefined || e.ms > best.ms || (e.ms === best.ms && e.line.seq > best.line.seq)) {
      best = e;
    }
  }
  if (best === undefined) return undefined;
  const text = best.line.payload?.text;
  return {
    line: String(best.line.id),
    seq: best.line.seq,
    at: String(best.line.at),
    at_local: localIso(best.ms, timezone),
    source: String(best.line.source),
    text: truthy(text) ? pyStr(text as JsonValue) : "",
  };
}

/** Python's `str.expandtabs()`: each tab to the next column that is a multiple of eight. */
function expandTabs(text: string): string {
  let out = "";
  let column = 0;
  for (const ch of text) {
    if (ch === "\t") {
      const pad = 8 - (column % 8);
      out += " ".repeat(pad);
      column += pad;
    } else {
      out += ch;
      column += 1;
    }
  }
  return out;
}

const width = (s: string): number => [...s].length;

/**
 * One paragraph wrapped as Python's `textwrap.wrap(text, width)` with `break_long_words=False` and
 * `break_on_hyphens=False`: tabs expanded, every ASCII space character a space, cut at spaces only;
 * a word longer than the line on a line of its own; the spaces at the start of a line after the
 * first, and at the end of every line, dropped; nothing for a paragraph of only spaces.
 */
function wrapParagraph(paragraph: string, columns: number): string[] {
  const text = expandTabs(paragraph).replace(/[\t\n\v\f\r]/g, " ");
  const chunks = text.split(/( +)/).filter((c) => c !== "");
  chunks.reverse();
  const lines: string[] = [];
  while (chunks.length > 0) {
    const current: string[] = [];
    let length = 0;
    if (lines.length > 0 && pyStrip(chunks[chunks.length - 1] as string) === "") chunks.pop();
    while (chunks.length > 0) {
      const next = width(chunks[chunks.length - 1] as string);
      if (length + next > columns) break;
      current.push(chunks.pop() as string);
      length += next;
    }
    if (chunks.length > 0 && current.length === 0) current.push(chunks.pop() as string);
    if (current.length > 0 && pyStrip(current[current.length - 1] as string) === "") {
      current.pop();
    }
    if (current.length > 0) lines.push(current.join(""));
  }
  return lines;
}

/** The text as the Day's section prints it: each of Python's lines wrapped at `columns`, an empty one as one empty row. */
export function wrapText(text: string, columns = 76): string[] {
  return splitLines(text).flatMap((paragraph) => {
    const wrapped = wrapParagraph(paragraph, columns);
    return wrapped.length === 0 ? [""] : wrapped;
  });
}
