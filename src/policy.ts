/**
 * The record's policies: settings the owner keeps in `<root>/policy/`, never constants in the code,
 * read here as the reference's `policy` module reads them (openlogbook 0.6.1, and the `write` keys of
 * its PR 252). Nothing here writes: the reference writes a default file where none exists, this
 * implementation reads the same default in memory and leaves the folder as it found it.
 *
 * `crossing.json` (ADR 0016) maps a destination to the highest tier that may cross to it. An entry may
 * carry an `until` day (ADR 0022: a ceiling lent for a while, `{"max_tier": 2, "until": "2026-12-31"}`);
 * it holds through that day and from the next counts as `max_tier` 0, so nothing crosses until the
 * owner writes a new date or removes the line. The `mcp` entry may also name the write tools the owner
 * lets through the door by name (ADR 0022, RFC 0034 amendment 3), `"write": ["sign_day", "note_day"]`,
 * and how far back they may write, `"write_window_days": 60`; none is allowed by default, and none once
 * the entry has expired. A `recipient` (RFC 0029 §7) is the age recipient a crossing package to the
 * destination is resealed to.
 *
 * `import.json` lists the sources the owner has switched off: `{"disabled": [{"source", "reason"}]}`.
 * The reference's readers consult it for the Day's `readiness` block (not read here yet,
 * SPEC-QUESTIONS 79); the file is read and checked the same way so a malformed one is refused alike.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDay } from "./clock.js";
import { LogbookError } from "./store.js";
import type { JsonValue } from "./types.js";

/** The policy file refuses the request, or is not a policy; the message names the file. */
export class PolicyError extends LogbookError {
  override readonly name = "PolicyError";
}

export const DEFAULT_DESTINATION = "hermes";
/** `logbook mcp`: an agent on this machine, reading through the ceiling. */
export const MCP_DESTINATION = "mcp";
export const MCP_DEFAULT_TIER = 1;
/** `logbook export vault`: a folder of Markdown on the owner's own disk. */
export const VAULT_DESTINATION = "vault";
export const VAULT_DEFAULT_TIER = 1;
/** `logbook export site`: a folder of static HTML the owner may publish anywhere. */
export const SITE_DESTINATION = "site";
export const SITE_DEFAULT_TIER = 1;
export const TIERS = [1, 2, 3] as const;
/** The last day an entry holds, `YYYY-MM-DD`; absent: for good. */
export const UNTIL = "until";
/** What an entry past its `until` day counts as: nothing crosses. */
export const EXPIRED_TIER = 0;
/** The write tools an entry lets through the door by name (ADR 0022); absent: none. */
export const WRITE = "write";
/** The tools `write` may name: the day's signature and its note. */
export const WRITE_TOOLS = ["sign_day", "note_day"] as const;
export type WriteTool = (typeof WRITE_TOOLS)[number];
/** How many days before today a write tool may still write to. */
export const WINDOW = "write_window_days";
/** The window when the entry does not set one. */
export const WRITE_WINDOW_DAYS = 60;

type Obj = { [key: string]: JsonValue };

/** The policy as the reference writes it where none exists: hermes at 2, mcp at 1. */
export const DEFAULT_CROSSING_POLICY: Readonly<Obj> = Object.freeze({
  [DEFAULT_DESTINATION]: { max_tier: 2 },
  [MCP_DESTINATION]: { max_tier: MCP_DEFAULT_TIER },
});

/** Switched off until the owner says otherwise: the two Takeout products few owners want unasked. */
export const DEFAULT_IMPORT_POLICY: Readonly<Obj> = Object.freeze({
  disabled: [
    {
      source: "google-takeout-access-log",
      reason: "every sign-in to every Google service; opt in",
    },
    { source: "google-takeout-activity", reason: "every search and app opened; opt in" },
  ],
});

/**
 * One entry of the policy as it counts on a day: `max_tier` is 0 when the entry has expired,
 * `written` what the file says either way; `write` the tools the file names, expired or not, and
 * `writes` those allowed on the day, none once the entry has expired.
 */
export interface Ceiling {
  destination: string;
  written: number;
  until: string | null;
  expired: boolean;
  write: WriteTool[];
  window_days: number;
  max_tier: number;
  writes: WriteTool[];
}

export const policyPath = (root: string): string => join(root, "policy", "crossing.json");
export const importPath = (root: string): string => join(root, "policy", "import.json");

/** Python's `repr` of a destination name, as the reference's messages quote it. */
const quoted = (name: string): string =>
  name.includes("'") && !name.includes('"') ? `"${name}"` : `'${name.replace(/'/g, "\\'")}'`;

const isObject = (value: unknown): value is Obj =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function readJsonFile(path: string): JsonValue | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch (err) {
    throw new PolicyError(`${path} is not JSON: ${(err as Error).message}`);
  }
}

/** The policy as written, or the default when the file does not exist yet. */
export function readCrossingPolicy(root: string): Obj {
  const path = policyPath(root);
  const data = readJsonFile(path);
  if (data === undefined) return copy(DEFAULT_CROSSING_POLICY) as Obj;
  if (!isObject(data)) throw new PolicyError(`${path} must map destination to {"max_tier": N}`);
  return data;
}

/** The calendar day an `until` date is held against: the machine's local date, as the owner who wrote the date meant it. */
export function today(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const hasTier = (entry: unknown): entry is Obj =>
  isObject(entry) && (TIERS as readonly number[]).includes(entry.max_tier as number);

function untilOf(path: string, destination: string, entry: Obj): string | null {
  const found = entry[UNTIL];
  if (found === undefined || found === null) return null;
  if (typeof found !== "string" || !isDay(found)) {
    throw new PolicyError(
      `${path}: ${quoted(destination)} has an until that is not a date; write it as YYYY-MM-DD, the last day the entry holds`,
    );
  }
  return found;
}

function writeOf(path: string, destination: string, entry: Obj): WriteTool[] {
  const found = WRITE in entry ? entry[WRITE] : [];
  if (
    !Array.isArray(found) ||
    !found.every(
      (name) => typeof name === "string" && (WRITE_TOOLS as readonly string[]).includes(name),
    )
  ) {
    throw new PolicyError(
      `${path}: ${quoted(destination)} has a write that is not a list of write tools; the tools it may name are ${WRITE_TOOLS.join(", ")}`,
    );
  }
  return [...new Set(found as WriteTool[])];
}

function windowOf(path: string, destination: string, entry: Obj): number {
  const found = WINDOW in entry ? entry[WINDOW] : WRITE_WINDOW_DAYS;
  if (typeof found !== "number" || !Number.isInteger(found) || found < 0) {
    throw new PolicyError(
      `${path}: ${quoted(destination)} has a ${WINDOW} that is not a whole number of days`,
    );
  }
  return found;
}

/** `entry` as a Ceiling held against the day `on`; the shape is the caller's to have checked. */
function entryOf(path: string, destination: string, entry: Obj, on: string): Ceiling {
  const until = untilOf(path, destination, entry);
  const expired = until !== null && on > until;
  const write = writeOf(path, destination, entry);
  return {
    destination,
    written: entry.max_tier as number,
    until,
    expired,
    write,
    window_days: windowOf(path, destination, entry),
    max_tier: expired ? EXPIRED_TIER : (entry.max_tier as number),
    writes: expired ? [] : write,
  };
}

/**
 * Every destination the policy names, in the file's order, each held against `on` (today by
 * default): what the file says, its `until` day and whether it has expired. An entry that is not the
 * documented shape is refused naming the file, as `ceiling` would refuse it.
 */
export function ceilings(root: string, on = today()): Ceiling[] {
  const path = policyPath(root);
  const out: Ceiling[] = [];
  for (const [destination, entry] of Object.entries(readCrossingPolicy(root))) {
    if (!hasTier(entry)) {
      throw new PolicyError(
        `${path}: ${quoted(destination)} must be {"max_tier": 1, 2 or 3}, with an optional "until" date`,
      );
    }
    out.push(entryOf(path, destination, entry, on));
  }
  return out;
}

/**
 * The highest tier the policy lets cross to `destination`; a destination the file does not name is
 * refused, naming the file, so a crossing never goes to an unnamed reader. An entry past its `until`
 * day is 0: nothing crosses (ADR 0022).
 */
export function ceiling(root: string, destination: string, on = today()): number {
  const path = policyPath(root);
  const entry = readCrossingPolicy(root)[destination];
  if (!hasTier(entry)) {
    throw new PolicyError(
      `${path} names no destination ${quoted(destination)} with a max_tier of 1, 2 or 3; add {"${destination}": {"max_tier": 1}} to it to allow a crossing`,
    );
  }
  return entryOf(path, destination, entry, on).max_tier;
}

/**
 * The `until` day of `destination`'s entry when that day has passed, else null: for a refusal that
 * says why the ceiling is 0. A destination the file does not name is null too.
 */
export function expiredOn(root: string, destination: string, on = today()): string | null {
  const entry = readCrossingPolicy(root)[destination];
  if (!hasTier(entry)) return null;
  const found = entryOf(policyPath(root), destination, entry, on);
  return found.expired ? found.until : null;
}

/**
 * The age recipient the policy names for `destination` (RFC 0029 §7), or null: a crossing package to
 * it is then shipped opened, and only when the owner types `--open`.
 */
export function recipientOf(root: string, destination: string): string | null {
  const entry = readCrossingPolicy(root)[destination];
  const found = isObject(entry) ? entry.recipient : undefined;
  if (found === undefined || found === null) return null;
  if (typeof found !== "string" || !found.startsWith("age1")) {
    throw new PolicyError(
      `${policyPath(root)}: ${quoted(destination)} has a recipient that is not an age1… string`,
    );
  }
  return found;
}

function ceilingOrDefault(root: string, destination: string, fallback: number, on: string): number {
  const path = policyPath(root);
  const entry = readCrossingPolicy(root)[destination];
  if (entry === undefined || entry === null) return fallback;
  if (!hasTier(entry)) {
    throw new PolicyError(
      `${path} names ${quoted(destination)} without a max_tier of 1, 2 or 3; make it {"max_tier": ${fallback}}`,
    );
  }
  return entryOf(path, destination, entry, on).max_tier;
}

/**
 * The highest tier `logbook mcp` may hand to its client: the `mcp` entry of the policy, or tier 1
 * when the file does not name it. An entry that is there but not a tier of 1, 2 or 3 is refused
 * naming the file, never read as a default.
 */
export const mcpCeiling = (root: string, on = today()): number =>
  ceilingOrDefault(root, MCP_DESTINATION, MCP_DEFAULT_TIER, on);

/** The highest tier `logbook export vault` may render: the `vault` entry, or tier 1 when unnamed. */
export const vaultCeiling = (root: string, on = today()): number =>
  ceilingOrDefault(root, VAULT_DESTINATION, VAULT_DEFAULT_TIER, on);

/** The highest tier `logbook export site` may render: the `site` entry, or tier 1 when unnamed. */
export const siteCeiling = (root: string, on = today()): number =>
  ceilingOrDefault(root, SITE_DESTINATION, SITE_DEFAULT_TIER, on);

/**
 * The `mcp` entry as it counts on `on` (today by default), for the write tools (ADR 0022): which it
 * allows by name (`writes`) and how far back (`window_days`); null when the file does not name `mcp`,
 * which allows no write tool. An entry that is not the documented shape is refused naming the file.
 */
export function mcpDoor(root: string, on = today()): Ceiling | null {
  const path = policyPath(root);
  const entry = readCrossingPolicy(root)[MCP_DESTINATION];
  if (entry === undefined || entry === null) return null;
  if (!hasTier(entry)) {
    throw new PolicyError(
      `${path} names ${quoted(MCP_DESTINATION)} without a max_tier of 1, 2 or 3; make it {"max_tier": 1}`,
    );
  }
  return entryOf(path, MCP_DESTINATION, entry, on);
}

/**
 * The disabled sources of `policy/import.json` as `{source: reason}`, as the file spells them; a
 * record without the file reads as the default. A file that is not the documented shape is refused
 * naming it.
 */
export function readDisabledSources(root: string): Record<string, string> {
  const path = importPath(root);
  const shape = `${path} must be {"disabled": [{"source": "<adapter>", "reason": "<why>"}, ...]}`;
  const data = readJsonFile(path) ?? copy(DEFAULT_IMPORT_POLICY);
  if (!isObject(data) || !Array.isArray(data.disabled)) throw new PolicyError(shape);
  const out: Record<string, string> = {};
  for (const entry of data.disabled) {
    if (!isObject(entry) || typeof entry.source !== "string" || typeof entry.reason !== "string") {
      throw new PolicyError(shape);
    }
    out[entry.source] = entry.reason;
  }
  return out;
}
