/**
 * The signed day (RFC 0034, `signed-day/v1`): the owner's reading of a day's page, recorded as one
 * tier-1 line. Agents draft; the owner signs; only signed days cross. This implementation reads
 * signatures and says in `show` and `day` whether a day is signed; it writes none (nothing here
 * signs), so what is here is the profile's rules, the page digest, and the standing signature of a
 * day. The profile is new, not one of the nineteen RFC 0031 freezes: its schema may change while
 * RFC 0034 is a draft, and it becomes frozen only by RFC 0031's process (a reader, a fixture in both
 * implementations, a schema pass and one dated amendment to that RFC).
 *
 * The page digest is over hashes, not text: the page of a day is every line SPEC §3.2.1 lists on
 * it (every kind but `retraction` and `signed-day`, a retracted line included, in the day's order,
 * by instant then `seq`), and the digest is the SHA-256 of `canonical_json({"day", "tz", "lines":
 * [the hashes]})`, so any implementation recomputes it from the record alone and the owner's words
 * are never held to a wording.
 *
 * Amendment 1, dispositions: beside confirming a line, the owner may say what became of the
 * commitment on it. The payload's optional `dispositions` maps a confirmed line's id to one of four
 * words: `kept`, `missed`, `dropped` (let go on purpose) or `carried` (still open, taken to a later
 * day). An id not in `confirmed`, or a fifth word, is invalid (`signedDayProblems`), and a reader
 * keeps the valid entries and never fails on the rest (`dispositionsOf`). The field is optional, so a
 * signature without it is what it was and its hash does not move; the page digest does not change.
 * `day` prints a symbol next to each disposed line (`mark`) and `show` lists the counts on the
 * signature's row (`countsText`). Amendment 2 (an empty `confirmed`, the owner's clock) and amendment
 * 3 (signing through the MCP door) change what the reference's writer accepts, not the line: a
 * signature with `confirmed: []` is read as any signature is, and nothing here writes one.
 */

import { sha256Hex } from "./chain.js";
import { isDay, localIso, localOf } from "./clock.js";
import { canonicalize } from "./jcs.js";
import type { JsonValue, Line } from "./types.js";

export const SIGNED_DAY_KIND = "signed-day";
export const SIGNED_DAY_SCHEMA = "signed-day/v1";
/** The owner signed it: not a tool, not an adapter. */
const SIGNED_DAY_SOURCE = "manual";
/** The line names a day, ids, a digest and a count, never what a line said. */
const SIGNED_DAY_TIER = 1;
const HEX64 = /^[0-9a-f]{64}$/;
/** The four dispositions (amendment 1): what became of the commitment on a confirmed line. */
export const DISPOSITIONS = ["kept", "missed", "dropped", "carried"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];
/** A tick for kept, a cross for missed, a dash for dropped, an arrow for carried. */
const SYMBOLS: Record<Disposition, string> = {
  kept: "\u2713",
  missed: "\u2717",
  dropped: "\u2013",
  carried: "\u2192",
};
const DISPOSITION_WORDS = "kept, missed, dropped or carried";
const isDisposition = (v: unknown): v is Disposition =>
  typeof v === "string" && (DISPOSITIONS as readonly string[]).includes(v);
/** A value as Python's `repr` spells it in the reference's messages: a string quoted, the rest as is. */
const repr = (v: unknown): string =>
  typeof v === "string" ? `'${v}'` : v === null ? "None" : JSON.stringify(v);

/** The Day's `signed` block (RFC 0034 rule 6), and what `show --json` carries under `signed`. */
export interface SignedState {
  /** When the owner signed, as written. */
  at: string;
  /** The same on the record's clock, `YYYY-MM-DDTHH:MM:SS±HH:MM`. */
  at_local: string;
  /** The signature line's id and seq. */
  line: string;
  seq: number;
  /** How many lines the owner confirmed; null when `confirmed` is not a list. */
  confirmed: number | null;
  /** How many lines were on the page signed, as the line says; null when it does not. */
  lines: number | null;
  page_sha256: string | null;
  /** Whether the page today digests to `page_sha256`; null when the reader cannot see the whole page. */
  page_matches: boolean | null;
  note: string | null;
  supersedes: string | null;
  /** The dispositions the signature gives, line id → word, the valid entries only (amendment 1). */
  dispositions: Record<string, Disposition>;
}

type Fields = Record<string, JsonValue | undefined>;

const payloadOf = (line: Line): Fields =>
  line.payload !== null && typeof line.payload === "object" && !Array.isArray(line.payload)
    ? (line.payload as Fields)
    : {};

const isObject = (v: unknown): v is Fields =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Whether a line is a `signed-day/v1` line at all: the kind and the schema. The rest is `signedDayProblems`. */
export function isSignedDay(line: Line): boolean {
  return line.kind === SIGNED_DAY_KIND && payloadOf(line).schema === SIGNED_DAY_SCHEMA;
}

/** The instant of `at`, for the page's order; NaN when it does not parse. */
const instant = (line: Line): number => Date.parse(String(line.at));

/**
 * The page of `day` as `show` lists it (SPEC §3.2.1, RFC 0034): of `lines`, every line whose `at`
 * falls on the local day in `timezone` but the retractions (a mark on another line's day) and the
 * signatures (about the page, never on it), a retracted line included, by the instant of `at` then
 * `seq`. `lines` may be the whole record or only the day's lines already picked.
 */
export function pageOf(lines: Iterable<Line>, day: string, timezone: string): Line[] {
  const page: Line[] = [];
  for (const line of lines) {
    if (line.kind === "retraction" || line.kind === SIGNED_DAY_KIND) continue;
    if (typeof line.at !== "string") continue;
    const ms = Date.parse(line.at);
    if (Number.isNaN(ms) || localOf(ms, timezone).day !== day) continue;
    page.push(line);
  }
  return sortPage(page);
}

/** The page's order: by the instant of `at`, then `seq`. */
export function sortPage(page: Line[]): Line[] {
  return [...page].sort((a, b) => instant(a) - instant(b) || a.seq - b.seq);
}

/**
 * The digest of the page as shown (RFC 0034): the lowercase hex SHA-256 of the canonical JSON
 * (RFC 8785, as SPEC §3 uses it) of the day, the record's zone and the hashes of the page's lines
 * in the page's order.
 */
export function pageDigest(day: string, timezone: string, hashes: readonly string[]): string {
  return sha256Hex(canonicalize({ day, tz: timezone, lines: [...hashes] }));
}

/**
 * Why a line is not a `signed-day/v1` line as RFC 0034 defines one, one message per rule broken;
 * empty when it is one. `owner` is the record's `owner_id`: a signature by anyone else is not one.
 * With `page`, the lines of the day as shown, the confirmed ids must be on it and `page.lines` must
 * be its length. Nothing here reads the record: this is the profile's shape, checked where a reader
 * or a test holds a line.
 */
export function signedDayProblems(line: Line, owner: string | undefined, page?: Line[]): string[] {
  const problems: string[] = [];
  const p = payloadOf(line);
  if (line.kind !== SIGNED_DAY_KIND) problems.push(`kind must be ${SIGNED_DAY_KIND}`);
  if (line.tier !== SIGNED_DAY_TIER) problems.push(`tier must be ${SIGNED_DAY_TIER}`);
  if (line.source !== SIGNED_DAY_SOURCE) problems.push(`source must be ${SIGNED_DAY_SOURCE}`);
  if (line.end !== null && line.end !== undefined) problems.push("end must be null");
  if (p.schema !== SIGNED_DAY_SCHEMA) problems.push(`schema must be ${SIGNED_DAY_SCHEMA}`);
  if (typeof p.day !== "string" || !isDay(p.day)) {
    problems.push("day must be YYYY-MM-DD, a real calendar day");
  }
  if (typeof p.subject !== "string" || (owner !== undefined && p.subject !== owner)) {
    problems.push(
      `subject must be the record's owner${owner === undefined ? "" : ` (${owner})`}; a signature by anyone else is not one`,
    );
  }
  const confirmed = p.confirmed;
  if (!Array.isArray(confirmed) || confirmed.some((id) => typeof id !== "string")) {
    problems.push("confirmed must be an array of line ids");
  } else {
    const seen = new Set<string>();
    for (const id of confirmed as string[]) {
      if (seen.has(id)) problems.push(`confirmed names ${id} more than once`);
      seen.add(id);
    }
    if (page !== undefined) {
      const onPage = new Set(page.map((l) => l.id));
      for (const id of seen) {
        if (!onPage.has(id)) problems.push(`confirmed names a line not on the page: ${id}`);
      }
    }
  }
  const pageInfo = p.page;
  if (!isObject(pageInfo)) {
    problems.push("page must be an object { sha256, lines }");
  } else {
    if (typeof pageInfo.sha256 !== "string" || !HEX64.test(pageInfo.sha256)) {
      problems.push("page.sha256 must be 64 hex digits");
    }
    if (!Number.isInteger(pageInfo.lines) || (pageInfo.lines as number) < 0) {
      problems.push("page.lines must be an integer ≥ 0");
    } else {
      if (Array.isArray(confirmed) && (pageInfo.lines as number) < confirmed.length) {
        problems.push("page.lines is smaller than the number of lines confirmed");
      }
      if (page !== undefined && pageInfo.lines !== page.length) {
        problems.push(`page.lines is ${pageInfo.lines} but the page has ${page.length} lines`);
      }
    }
  }
  if (p.note !== undefined && (typeof p.note !== "string" || /[\r\n]/.test(p.note))) {
    problems.push("note must be one line of text");
  }
  if (p.supersedes !== undefined && typeof p.supersedes !== "string") {
    problems.push("supersedes must be a line id");
  }
  // Amendment 1: an object whose keys are ids in `confirmed` and whose values are one of the four
  // words; the messages are the reference's (`signing.validate`).
  if (p.dispositions !== undefined) {
    const found = p.dispositions;
    if (!isObject(found)) {
      problems.push(
        "dispositions must be an object mapping a confirmed line's id to its disposition",
      );
    } else {
      const ids = new Set(Array.isArray(confirmed) ? (confirmed as unknown[]) : []);
      for (const [id, value] of Object.entries(found)) {
        if (!ids.has(id)) problems.push(`dispositions names ${id}, which is not in confirmed`);
        if (!isDisposition(value)) {
          problems.push(
            `the disposition of ${id} is ${repr(value)}; a line is ${DISPOSITION_WORDS}`,
          );
        }
      }
    }
  }
  return problems;
}

/**
 * The dispositions a signature gives, id → word, the valid entries only: an id that is not in
 * `confirmed`, a word that is not one of the four, or a field that is not an object are left out and
 * never fail a reader (SPEC §5). Empty when the field is absent.
 */
export function dispositionsOf(p: Fields): Record<string, Disposition> {
  const found = p.dispositions;
  const confirmed = p.confirmed;
  const out: Record<string, Disposition> = {};
  if (!isObject(found) || !Array.isArray(confirmed)) return out;
  const ids = new Set(confirmed as unknown[]);
  for (const [id, value] of Object.entries(found)) {
    if (ids.has(id) && isDisposition(value)) out[id] = value;
  }
  return out;
}

/** `kept 2, missed 1`: how many lines got each word, in the four words' order; empty for none. */
export function countsText(dispositions: Record<string, string>): string {
  const values = Object.values(dispositions);
  return DISPOSITIONS.map((word) => [word, values.filter((v) => v === word).length] as const)
    .filter(([, n]) => n > 0)
    .map(([word, n]) => `${word} ${n}`)
    .join(", ");
}

/**
 * For a reader's row: the symbol of the disposition the first of `lineIds` has (a tick for kept, a
 * cross for missed, a dash for dropped, an arrow for carried), with a space after it, or nothing: a
 * row on an unsigned day, or a line given none, prints as it did.
 */
export function mark(
  dispositions: Record<string, string> | undefined | null,
  ...lineIds: Array<string | null | undefined>
): string {
  if (!dispositions) return "";
  for (const id of lineIds) {
    if (id !== null && id !== undefined && id in dispositions) {
      const word = dispositions[id];
      if (isDisposition(word)) return `${SYMBOLS[word]} `;
    }
  }
  return "";
}

/**
 * The standing signature per day (RFC 0034 rule 3): of the `signed-day/v1` lines, the latest by
 * `seq` naming the day whose subject is `owner` (any subject when `owner` is undefined) and whose id
 * `retracted` does not hold. A retracted later signature leaves the earlier standing; a day with
 * none is unsigned.
 */
export function standingSignatures(
  lines: Iterable<Line>,
  retracted: { has(id: string): boolean },
  owner: string | undefined,
): Map<string, Line> {
  const found = new Map<string, Line>();
  const sorted = [...lines].sort((a, b) => a.seq - b.seq);
  for (const line of sorted) {
    if (!isSignedDay(line)) continue;
    if (retracted.has(line.id)) continue;
    const p = payloadOf(line);
    if (owner !== undefined && p.subject !== owner) continue;
    if (typeof p.day === "string") found.set(p.day, line);
  }
  return found;
}

/**
 * The `signed` block of a day (RFC 0034 rule 6): null for an unsigned day; else when, which line,
 * how many lines were confirmed and on the page, the page digest, whether the page today still
 * digests to it (null when `page` is not the whole page: a gated reader), the note and what it
 * supersedes. `page` is the day's page as `pageOf` gives it; `day` is the day read, else the one the
 * line names.
 */
export function signedState(
  signature: Line | null | undefined,
  timezone: string,
  page: readonly Line[] | undefined,
  day?: string,
): SignedState | null {
  if (signature === null || signature === undefined) return null;
  const p = payloadOf(signature);
  const pageInfo = isObject(p.page) ? p.page : {};
  const digest = typeof pageInfo.sha256 === "string" ? pageInfo.sha256 : null;
  const at = String(signature.at);
  const ms = Date.parse(at);
  let matches: boolean | null = null;
  if (page !== undefined && digest !== null) {
    const named = day ?? (typeof p.day === "string" ? p.day : "");
    matches =
      pageDigest(
        named,
        timezone,
        page.map((l) => String(l.hash)),
      ) === digest;
  }
  return {
    at,
    at_local: Number.isNaN(ms) ? at : localIso(ms, timezone),
    line: String(signature.id),
    seq: signature.seq,
    confirmed: Array.isArray(p.confirmed) ? p.confirmed.length : null,
    lines: Number.isInteger(pageInfo.lines) ? (pageInfo.lines as number) : null,
    page_sha256: digest,
    page_matches: matches,
    note: typeof p.note === "string" ? p.note : null,
    supersedes: typeof p.supersedes === "string" ? p.supersedes : null,
    dispositions: dispositionsOf(p),
  };
}

/**
 * `unsigned`, or `signed 2026-03-02 09:00` (local, to the minute), with `, the page has changed
 * since` when the page no longer digests to what was signed: the header of `show` and `day`.
 */
export function signedStateText(state: SignedState | null): string {
  if (state === null) return "unsigned";
  const when = state.at_local.slice(0, 16).replace("T", " ");
  const text = `signed ${when}`;
  return state.page_matches === false ? `${text}, the page has changed since` : text;
}

/**
 * A signature's row in `show`: `signed 2026-03-01: 4 lines confirmed of 4 · kept 1, missed 1 ·
 * <note>`, the counts only when the signature gives dispositions.
 */
export function signedDayRow(p: Fields): string {
  const pageInfo = isObject(p.page) ? p.page : {};
  const n = Array.isArray(p.confirmed) ? p.confirmed.length : 0;
  const onPage = pageInfo.lines === undefined ? "?" : String(pageInfo.lines);
  let text = `signed ${String(p.day)}: ${n} line${n === 1 ? "" : "s"} confirmed of ${onPage}`;
  const counts = countsText(dispositionsOf(p));
  if (counts !== "") text = `${text} · ${counts}`;
  return typeof p.note === "string" && p.note !== "" ? `${text} · ${p.note}` : text;
}
