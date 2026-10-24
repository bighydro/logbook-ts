/**
 * `heard/v1` (RFC 0046, *What you heard*, draft, 2026-10-21): the words of a podcast episode or a
 * video the owner played, one line beside the listen or watch it belongs to, the text itself in the
 * attachment store. Read behind the `rfc0046` flag (`flags.ts`) as the reference's `show` prints it
 * since its #355, matched by running it on payloads (tests/heard-cases.ts), never by reading it.
 *
 * - `heardRow`: `show`'s row, `Episode 12: the east berth — Havnepodden · feed · nb · 7,012 words`.
 *
 * Nothing here validates a line or reads its text; the Day reads a heard line as any other line.
 */

import { pyStr } from "./pyrepr.js";
import type { JsonValue, Payload } from "./types.js";

export const HEARD_KIND = "heard";
export const HEARD_SCHEMA = "heard/v1";

/** Python's truth of a JSON value: false for null, false, 0, an empty string, list or object. */
const truthy = (v: JsonValue | undefined): boolean =>
  v !== undefined &&
  v !== null &&
  v !== false &&
  v !== 0 &&
  v !== "" &&
  !(Array.isArray(v) && v.length === 0) &&
  !(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

/**
 * The row `show` prints for a `heard/v1` line, as the reference prints it at its main of a6ee131: the
 * title (Python's `str()` of it, empty when it is not truthy), ` — <by>` when `by` is a non-empty
 * string, then the text's source (else `?`), its language (else `und`) and its words, a whole number
 * of 0 or more (a whole float counts), else 0, the thousands grouped, `1 word` alone singular.
 */
export function heardRow(p: Payload): string {
  const title = truthy(p.title) ? pyStr(p.title) : "";
  const by = typeof p.by === "string" && p.by !== "" ? ` — ${p.by}` : "";
  const source = truthy(p.text_source) ? pyStr(p.text_source) : "?";
  const language = truthy(p.language) ? pyStr(p.language) : "und";
  const w = p.words;
  // `-0` is JSON's 0 to the reference (Python reads it as the integer 0).
  const words = typeof w === "number" && Number.isInteger(w) && w > 0 ? w : 0;
  return `${title}${by} · ${source} · ${language} · ${words.toLocaleString("en-US")} word${words === 1 ? "" : "s"}`;
}
