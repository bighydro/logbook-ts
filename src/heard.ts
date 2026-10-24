/**
 * RFC 0046, `heard/v1` (draft, 2026-10-21; the reference's #355): the words of a podcast episode or a
 * video the owner played, one line beside the `listen/v1` or `watch/v1` line it belongs to (`of`), the
 * text itself in the attachment store by digest and never in the line. Read behind the `rfc0046` flag
 * (`flags.ts`) as the reference's `show` prints it at d053f78, matched by running it, never by reading
 * it: `Anchors that hold — The Harbour Hour · feed · en · 700 words`.
 *
 * Nothing here fetches, reads or writes a text (`sync heard`, `show heard` and `search` are the
 * reference's), and no reader but `show` reads the line: the Day and the counts see it as any line.
 */

import { pyStr } from "./pyrepr.js";
import type { JsonValue, Line, Payload } from "./types.js";

export const HEARD_KIND = "heard";
export const HEARD_SCHEMA = "heard/v1";

/** Whether a line is a `heard/v1` line: the kind and the schema. */
export const isHeard = (line: Line): boolean =>
  line.kind === HEARD_KIND && line.payload?.schema === HEARD_SCHEMA;

/** Python's truth of a JSON value, for the `or` the reference's row falls back with. */
const truthy = (v: JsonValue | undefined): boolean =>
  v !== undefined &&
  v !== null &&
  v !== false &&
  v !== 0 &&
  v !== "" &&
  !(Array.isArray(v) && v.length === 0) &&
  !(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

/** `words` as the row counts it: a whole number of 0 or more, else 0; a whole float counts as its integer. */
function wordsOf(v: JsonValue | undefined): bigint {
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) return 0n;
  return BigInt(v);
}

/**
 * The row `show` prints for a `heard/v1` line: the title (empty when there is none or it is false,
 * 0 or empty), ` — <by>` when
 * `by` is a text, then the text source (`?` when none), the language (`und` when none) and the length
 * in words, the thousands grouped, as the reference prints it at d053f78 (run).
 */
export function heardRow(p: Payload): string {
  const title = truthy(p.title) ? pyStr(p.title as JsonValue) : "";
  const by = typeof p.by === "string" && p.by !== "" ? ` — ${p.by}` : "";
  const source = truthy(p.text_source) ? pyStr(p.text_source) : "?";
  const language = truthy(p.language) ? pyStr(p.language) : "und";
  const words = wordsOf(p.words);
  const count = `${words.toLocaleString("en-US")} word${words === 1n ? "" : "s"}`;
  return `${title}${by} · ${source} · ${language} · ${count}`;
}
