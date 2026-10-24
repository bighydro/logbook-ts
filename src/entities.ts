/**
 * The entities of RFC 0037 (draft, 2026-10-13, decided 2026-10-14), a person, an org, an idea, an asset,
 * a place, as the record holds them: three payload profiles, the readers that fold them, and the owner's
 * settings for them. A port of the reference's `logbook/contrib/entities.py` and of the read-only half
 * of its `entity_status.py` (bighydro/logbook main, 7bcf728), read and ported by the owner's instruction,
 * so that on the same input the two give the same answer and the same sentences in the same order.
 *
 * **`entity/v1`** is the canonical thing: `{type, id, registry}`, a label, and the refs the line binds
 * to it. A person binds through `resolution/v1` (RFC 0006, frozen) and never here; an org, an idea, an
 * asset and a place bind through `entity/v1` only. A `resolution/v1` line of type `company`, the frozen
 * word, is read as an org and never rewritten (`LEGACY`). The line is tier 2 and never cites a tier-3
 * line.
 *
 * **`entity-review/v1`** is every no the owner says at review, for every kind; a `people-review/v1`
 * line (RFC 0035) is read as one of type person, forever. Its tier is the highest of its evidence and
 * never under 2.
 *
 * **`status/v1`** is what the owner decided about an org, an idea, a place or an asset: one of the
 * kind's dispositions, no money on the line, at the kind's tier (`statusTier`, RFC 0037 §8): 3 for an
 * org, 2 for the rest. The current status is the last line standing. A status that closes a registry
 * entry closes it with `until`, the line's local day.
 *
 * **Readers' rules** (`policy/entities.json`): a status with a reason that answers a proposal of
 * another disposition mutes that disposition for `mute_days` (`muted`); a `hold` older than three years
 * and an `exploring` older than two are stale (`stale`). Neither is ever a line.
 *
 * Nothing here writes: `status list KIND` (`statusListing`) reads; the writers (`logbook status`,
 * `review KIND`) are the reference's. The Python details the port reproduces on purpose: `repr()`
 * through `pyrepr.ts`; `str.strip()`/`str.split()` whitespace (`\x1c`–`\x1f`, `\x85`, NBSP and the
 * rest); `casefold()` (ß → ss), not `toLowerCase()`; `\w` as letters, numbers and underscore, never a
 * combining mark; `\d` as any decimal digit; `$` matching before one trailing newline; strings sorted
 * by code point; a UUID's version read only under the RFC 4122 variant. Where the reference raises
 * instead of answering (a trailing newline after an org's id, an unhashable `entity.type`), this
 * implementation answers with the sentence the rule has. The RFC 0037 flag gates the CLI alone, and
 * `status list` reads `day_start` (RFC 0036) as the reference does, whichever flag is on.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addDays, daysBetween, isDay } from "./clock.js";
import { DEFAULT_DAY_START, localDayOf, localToday, readDayStart } from "./dayStart.js";
import { type Fields, fieldsOf, isObject } from "./lineRules.js";
import { eachLine, monthFiles, parseLine } from "./lines.js";
import { pyRepr, pyStr } from "./pyrepr.js";
import { asRef, type Ref } from "./resolve.js";
import { readAssets, readPlaces } from "./settings.js";
import { formatRefusal, LogbookError, readMeta } from "./store.js";
import type { JsonValue, Line } from "./types.js";

// -- the words of the profiles -----------------------------------------------------------------------------

/** The lines' `kind`. */
export const ENTITY = "entity";
export const ENTITY_REVIEW = "entity-review";
export const STATUS = "status";
export const ENTITY_SCHEMA = "entity/v1";
export const ENTITY_REVIEW_SCHEMA = "entity-review/v1";
export const STATUS_SCHEMA = "status/v1";
/** RFC 0035's no: read forever as an `entity-review/v1` of type person. */
export const PEOPLE_REVIEW = "people-review";
export const PEOPLE_REVIEW_SCHEMA = "people-review/v1";
export const RESOLUTION = "resolution";
export const RETRACTION = "retraction";
export const NOTE_SCHEMA = "note/v1";
/** The label of the note the reference's writer puts beside an idea's, a place's or an asset's reason. */
export const NOTE_LABEL = "status";
export const SOURCE = "manual";
export const REGISTRY = "logbook";
export const METHOD = "owner";
/** `entity/v1` of every kind, and `status/v1` of an idea, a place or an asset (decisions 8 and 10). */
export const TIER = 2;
/** A tier-3 line: what an `entity/v1` line never cites. */
export const MONEY_TIER = 3;
export const PERSON = "person";
export const ORG = "org";
export const IDEA = "idea";
export const ASSET = "asset";
export const PLACE = "place";
/** A `status/v1` line's tier by kind, `TIER` for the rest (RFC 0037 §8). */
export const STATUS_TIERS: Readonly<Record<string, number>> = { [ORG]: MONEY_TIER };
export const KINDS = [PERSON, ORG, IDEA, ASSET, PLACE] as const;
/** `resolution/v1`'s frozen word for an org (decision 12). */
export const LEGACY: Readonly<Record<string, string>> = { company: ORG };
export const RESOLUTION_REFS = [
  "email",
  "phone",
  "handle",
  "provider_id",
  "device_id",
  "domain",
  "line",
] as const;
export const ADDED_REFS = [
  "repo",
  "page",
  "title",
  "group",
  "merchant",
  "mmsi",
  "icao24",
  "registration",
  "place",
] as const;
export const REF_KINDS: readonly string[] = [...RESOLUTION_REFS, ...ADDED_REFS];
/**
 * An observed thing's strongest identifier (an `entity-review/v1` `ref`) may also be a person's folded
 * `name` (RFC 0035), a spot's `centre` (`lat,lon`), an asset's `subject` id, or a voice, a `speaker`
 * (`<transcript line id>#<label>`; RFC 0038 §12, the reference since 0.7.0).
 */
export const OBSERVED_REFS: readonly string[] = [
  ...REF_KINDS,
  "name",
  "centre",
  "subject",
  "speaker",
];
export const DIFFERENT = "different";
/** The dispositions of each kind that takes a status, in the reference's order. */
export const DISPOSITIONS: Readonly<Record<string, readonly string[]>> = {
  [ORG]: ["hold", "add", "sell", "let-go", "exited", "passed"],
  [IDEA]: ["spark", "exploring", "build", "built", "killed"],
  [PLACE]: ["let-go"],
  [ASSET]: ["sold", "let-go"],
};
/** The kinds that take a status, in `DISPOSITIONS`' order. */
export const STATUS_KINDS: readonly string[] = Object.keys(DISPOSITIONS);
export const REASON_REQUIRED: ReadonlySet<string> = new Set(["passed", "let-go", "killed"]);
/** The dispositions that close a registry entry with `until`. */
export const CLOSING: Readonly<Record<string, readonly string[]>> = {
  [PLACE]: ["let-go"],
  [ASSET]: ["sold", "let-go"],
};
export const PROPOSED_BY = ["dream", "owner"] as const;
export const NO_STATUS: Readonly<Record<string, string>> = {
  [PERSON]: "a person has no status (RFC 0037): people are reviewed, never disposed of",
  goal: "a goal is reviewed by review/v1 (RFC 0036), not given a status",
};
export const ARTICLES: ReadonlySet<string> = new Set(["the", "a", "an"]);
/** Set aside when org names are compared. */
export const LEGAL_FORMS: ReadonlySet<string> = new Set(["as", "asa", "ltd", "inc", "gmbh", "ab"]);

/** `policy/entities.json`, the record's entity settings. */
export const POLICY_FILE: readonly string[] = ["policy", "entities.json"];
/** RFC 0037 §4.6's default; the file extends it. `example.org` is a family's provider in the synthetic record. */
export const PUBLIC_MAIL_PROVIDERS: readonly string[] = [
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "yahoo.com",
  "example.org",
];
export const CODE_HOSTS: readonly string[] = ["github.com", "gitlab.com", "codeberg.org"];
/**
 * The suffixes under which one label more is one party: two-label public suffixes, and the names RFC
 * 2606 reserves for documentation, whose every subdomain stands for a party of its own.
 */
export const PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.jp",
  "com.br",
  "co.za",
  "co.in",
  "com.mx",
  "com.sg",
  "example.org",
  "example.com",
  "example.net",
]);
export const MUTE_DAYS = 365;
export const STALE_DAYS: Readonly<Record<string, number>> = { hold: 3 * 365, exploring: 2 * 365 };
/** The identifiers an `assets.json` entry carries, which its entity binds as refs. */
const ASSET_IDENTIFIERS = ["mmsi", "icao24", "registration"] as const;
/** What a listing prints for an entity with no status. */
export const NONE = "—";

/** A line, an entity or a setting the record refuses; the message says why, nothing is written. */
export class EntityError extends LogbookError {
  override readonly name = "EntityError";
}

/** A status the record refuses; the message says why and nothing is written. */
export class StatusError extends LogbookError {
  override readonly name = "StatusError";
}

// -- Python's text -----------------------------------------------------------------------------------------

/** The characters Python's `str.isspace()` takes: `str.strip()` and `str.split()` cut on them. */
const PY_SPACE =
  "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_SPACES = new RegExp(`[${PY_SPACE}]+`, "g");

const PY_SPACE_OR_HYPHEN = new RegExp(`[${PY_SPACE}-]+`, "g");

/** Whether one UTF-16 code unit is Python whitespace (every one of them is in the BMP). */
const PY_SPACE_ONE = new RegExp(`^[${PY_SPACE}]$`);
const isPySpace = (unit: string): boolean => PY_SPACE_ONE.test(unit);

/** Where the text ends once Python's whitespace is off its end: a scan, linear in the run's length. */
function endOf(text: string): number {
  let end = text.length;
  while (end > 0 && isPySpace(text.charAt(end - 1))) end -= 1;
  return end;
}

/** Python's `str.strip()`: its whitespace off both ends, which is not `trim()`'s (`\x1c`–`\x1f`, `\x85`; never a BOM). */
export function pyStrip(text: string): string {
  const end = endOf(text);
  let start = 0;
  while (start < end && isPySpace(text.charAt(start))) start += 1;
  return text.slice(start, end);
}

/** Python's `str.rstrip()`: its whitespace off the end. */
export const pyRstrip = (text: string): string => text.slice(0, endOf(text));

/** Python's `str.split()`: the runs of its whitespace cut out, nothing empty kept. */
export const pySplit = (text: string): string[] => text.split(PY_SPACES).filter((w) => w !== "");

/** `.strip(chars)` with one character: that character off both ends, any number of times. */
const stripChar = (text: string, ch: string): string => {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === ch) start += 1;
  while (end > start && text[end - 1] === ch) end -= 1;
  return text.slice(start, end);
};

/**
 * Where Python's full case folding (CaseFolding.txt, statuses C and F) differs from a lower-casing:
 * the code point after `toLowerCase()` and what `casefold()` makes of it. The ligatures NFKC already
 * takes apart are kept for a caller that folds without it.
 */
const FOLD_TABLE: Array<[number, number[]]> = [
  [0x00df, [0x73, 0x73]],
  [0x0149, [0x02bc, 0x6e]],
  [0x017f, [0x73]],
  [0x01f0, [0x6a, 0x030c]],
  [0x0345, [0x03b9]],
  [0x0390, [0x03b9, 0x0308, 0x0301]],
  [0x03b0, [0x03c5, 0x0308, 0x0301]],
  [0x03c2, [0x03c3]],
  [0x03d0, [0x03b2]],
  [0x03d1, [0x03b8]],
  [0x03d5, [0x03c6]],
  [0x03d6, [0x03c0]],
  [0x03f0, [0x03ba]],
  [0x03f1, [0x03c1]],
  [0x03f5, [0x03b5]],
  [0x0587, [0x0565, 0x0582]],
  [0x1c80, [0x0432]],
  [0x1c81, [0x0434]],
  [0x1c82, [0x043e]],
  [0x1c83, [0x0441]],
  [0x1c84, [0x0442]],
  [0x1c85, [0x0442]],
  [0x1c86, [0x044a]],
  [0x1c87, [0x0463]],
  [0x1c88, [0xa64b]],
  [0x1e96, [0x68, 0x0331]],
  [0x1e97, [0x74, 0x0308]],
  [0x1e98, [0x77, 0x030a]],
  [0x1e99, [0x79, 0x030a]],
  [0x1e9a, [0x61, 0x02be]],
  [0x1e9b, [0x1e61]],
  [0x1f50, [0x03c5, 0x0313]],
  [0x1f52, [0x03c5, 0x0313, 0x0300]],
  [0x1f54, [0x03c5, 0x0313, 0x0301]],
  [0x1f56, [0x03c5, 0x0313, 0x0342]],
  [0x1fb2, [0x1f70, 0x03b9]],
  [0x1fb3, [0x03b1, 0x03b9]],
  [0x1fb4, [0x03ac, 0x03b9]],
  [0x1fb6, [0x03b1, 0x0342]],
  [0x1fb7, [0x03b1, 0x0342, 0x03b9]],
  [0x1fbe, [0x03b9]],
  [0x1fc2, [0x1f74, 0x03b9]],
  [0x1fc3, [0x03b7, 0x03b9]],
  [0x1fc4, [0x03ae, 0x03b9]],
  [0x1fc6, [0x03b7, 0x0342]],
  [0x1fc7, [0x03b7, 0x0342, 0x03b9]],
  [0x1fd2, [0x03b9, 0x0308, 0x0300]],
  [0x1fd3, [0x03b9, 0x0308, 0x0301]],
  [0x1fd6, [0x03b9, 0x0342]],
  [0x1fd7, [0x03b9, 0x0308, 0x0342]],
  [0x1fe2, [0x03c5, 0x0308, 0x0300]],
  [0x1fe3, [0x03c5, 0x0308, 0x0301]],
  [0x1fe4, [0x03c1, 0x0313]],
  [0x1fe6, [0x03c5, 0x0342]],
  [0x1fe7, [0x03c5, 0x0308, 0x0342]],
  [0x1ff2, [0x1f7c, 0x03b9]],
  [0x1ff3, [0x03c9, 0x03b9]],
  [0x1ff4, [0x03ce, 0x03b9]],
  [0x1ff6, [0x03c9, 0x0342]],
  [0x1ff7, [0x03c9, 0x0342, 0x03b9]],
  [0xfb00, [0x66, 0x66]],
  [0xfb01, [0x66, 0x69]],
  [0xfb02, [0x66, 0x6c]],
  [0xfb03, [0x66, 0x66, 0x69]],
  [0xfb04, [0x66, 0x66, 0x6c]],
  [0xfb05, [0x73, 0x74]],
  [0xfb06, [0x73, 0x74]],
  [0xfb13, [0x0574, 0x0576]],
  [0xfb14, [0x0574, 0x0565]],
  [0xfb15, [0x0574, 0x056b]],
  [0xfb16, [0x057e, 0x0576]],
  [0xfb17, [0x0574, 0x056d]],
];
// The Greek letters with a subscript iota fold to the letter and an iota (three blocks of eight).
for (const [from, to] of [
  [0x1f80, 0x1f00],
  [0x1f90, 0x1f20],
  [0x1fa0, 0x1f60],
]) {
  for (let i = 0; i < 8; i++) FOLD_TABLE.push([(from as number) + i, [(to as number) + i, 0x03b9]]);
}
// Cherokee folds to its upper case: the small letters are the newer ones.
for (let i = 0; i < 6; i++) FOLD_TABLE.push([0x13f8 + i, [0x13f0 + i]]);
for (let i = 0; i < 80; i++) FOLD_TABLE.push([0xab70 + i, [0x13a0 + i]]);
const FOLDS = new Map(
  FOLD_TABLE.map(([from, to]) => [String.fromCodePoint(from), String.fromCodePoint(...to)]),
);

/** Python's `str.casefold()`: a lower-casing, then the full foldings a lower-casing does not do (ß → ss). */
export function casefold(text: string): string {
  let out = "";
  for (const ch of text.toLowerCase()) out += FOLDS.get(ch) ?? ch;
  return out;
}

/** Python's `\w+` on a `str`: letters, numbers and underscore; a combining mark ends a word. */
const WORD = /[\p{L}\p{N}_]+/gu;

/** Python's order on strings: by code point, which is not UTF-16 order above the BMP. */
export function compareCodePoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0) as number;
    const cy = y.value.codePointAt(0) as number;
    if (cx !== cy) return cx - cy;
  }
}

/** The length Python's `len()` gives: code points. */
const codePoints = (text: string): number => [...text].length;

// -- words -------------------------------------------------------------------------------------------------

/** NFKC, case folded, whitespace collapsed: how a key, a name or a group is compared (§8). */
export const fold = (text: string): string => pySplit(casefold(text.normalize("NFKC"))).join(" ");

/** The folded words of `text`, punctuation aside; with `articles` false, `the`, `a`, `an` out. */
export function words(text: string, articles = true): string[] {
  const found = fold(text).match(WORD) ?? [];
  return articles ? found : found.filter((w) => !ARTICLES.has(w));
}

/** An org's name for comparing: its folded words sorted, the legal forms out (`Nordmann Verft AS` is `Nordmann Verft`). */
export const orgName = (text: string): string[] =>
  words(text)
    .filter((w) => !LEGAL_FORMS.has(w))
    .sort(compareCodePoints);

/** A title's words folded and sorted, the articles out: `The Fjord Kiosk` → `fjord kiosk`. */
export const titleKey = (text: string): string =>
  words(text, false).sort(compareCodePoints).join(" ");

const LABEL = /^[a-z0-9-]+$/;

/**
 * The public suffix plus one label, lower-cased: `nordmann-verft.example` from `post.nordmann-verft.example`,
 * `fjord.co.uk` from `mail.fjord.co.uk`, `verft.example.org` from `post.verft.example.org`; undefined for a
 * bare suffix or nothing domain-shaped. Read from the two-label suffixes this module carries and `extra`
 * (the settings'), never from the network.
 */
export function registeredDomain(host: string, extra: Iterable<string> = []): string | undefined {
  const labels = stripChar(pyStrip(host), ".")
    .toLowerCase()
    .split(".")
    .filter((part) => part !== "");
  if (labels.length < 2 || !labels.every((part) => LABEL.test(part))) return undefined;
  const suffixes = new Set([
    ...PUBLIC_SUFFIXES,
    ...[...extra].map((s) => stripChar(s, ".").toLowerCase()),
  ]);
  if (suffixes.has(labels.slice(-2).join("."))) {
    return labels.length >= 3 ? labels.slice(-3).join(".") : labels.slice(-2).join(".");
  }
  return labels.slice(-2).join(".");
}

/** `github.com/nordmann-verft` from `github.com/nordmann-verft/kiosk`: host and first segment. */
export function repoOrg(value: string): string | undefined {
  const parts = stripChar(pyStrip(value), "/")
    .toLowerCase()
    .split("/")
    .filter((p) => p !== "");
  return parts.length >= 2 ? parts.slice(0, 2).join("/") : undefined;
}

/** A registration folded, the hyphens and spaces out: `ZZ-ABC` and `zz abc` are `zzabc`. */
export const registrationKey = (value: string): string =>
  fold(value).replace(PY_SPACE_OR_HYPHEN, "");

// -- the profiles: validation ----------------------------------------------------------------------------

/** Python's `re.match` with `$`: the pattern, then the end of the text or one newline before it. */
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n?$/;
const HEX64 = /^[0-9a-f]{64}\n?$/;
/** Python's `\d` on a `str`: any decimal digit, not only ASCII's. */
const DAY = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}\n?$/u;
/** The reference's `assets.ID_PATTERN`. */
const ASSET_ID = /^[a-z0-9][a-z0-9-]*\n?$/;

/** Python's `uuid.UUID(text).version`: the version digit, read only under the RFC 4122 variant; else undefined. */
function uuidVersion(text: string): number | undefined {
  return "89ab".includes(text[19] as string) ? Number.parseInt(text[14] as string, 16) : undefined;
}

const isText = (v: unknown): v is string => typeof v === "string" && v !== "";
const has = (payload: Fields, key: string): boolean => Object.hasOwn(payload, key);

function refProblems(
  value: JsonValue | undefined,
  fieldName: string,
  kinds: readonly string[],
): string[] {
  if (!isObject(value)) return [`${fieldName} must be an object {kind, value}`];
  const { kind, value: text } = value;
  const problems: string[] = [];
  if (!(typeof kind === "string" && kinds.includes(kind))) {
    problems.push(`${fieldName}.kind ${pyRepr(kind)} is not one of ${kinds.join(", ")}`);
  }
  if (!(typeof text === "string" && pyStrip(text) !== "")) {
    problems.push(`${fieldName}.value must be a non-empty string`);
  }
  return problems;
}

function strings(payload: Fields, key: string): string[] {
  const value = payload[key];
  if (has(payload, key) && (!Array.isArray(value) || !value.every(isText))) {
    return [`${key} must be a list of strings`];
  }
  return [];
}

function maybeString(payload: Fields, key: string, what: string): string[] {
  return has(payload, key) && !isText(payload[key]) ? [`${key} must be ${what}`] : [];
}

function head(payload: Fields): string[] {
  const value = payload.logbook_head;
  if (has(payload, "logbook_head") && !(typeof value === "string" && HEX64.test(value))) {
    return ["logbook_head must be the head the proposal was read against, 64 lowercase hex"];
  }
  return [];
}

/**
 * The id rule of `entity/v1` (§3.2): a UUIDv7 minted in this record for an org or an idea, the UUID a
 * resolution minted for a person, the name `places.json` spells for a place, the id `assets.json` holds
 * for an asset.
 */
export function entityIdProblems(
  kind: JsonValue | undefined,
  entityId: JsonValue | undefined,
): string[] {
  if (!isText(entityId)) return ["entity.id must be a non-empty string"];
  if (kind === ORG || kind === IDEA) {
    // A newline the regex lets through is no UUID to `uuid.UUID`, where the reference raises.
    if (!UUID_TEXT.test(entityId) || entityId.endsWith("\n") || uuidVersion(entityId) !== 7) {
      return [
        `entity.id of an ${kind} must be a UUIDv7 minted in this record, not ${pyRepr(entityId)}`,
      ];
    }
  } else if (kind === PERSON) {
    if (!UUID_TEXT.test(entityId)) {
      return [
        `entity.id of a person must be the UUID its resolution minted, not ${pyRepr(entityId)}`,
      ];
    }
  } else if (kind === ASSET && !ASSET_ID.test(entityId)) {
    return [`entity.id of an asset must be its assets.json id, not ${pyRepr(entityId)}`];
  } else if (kind === PLACE && pyStrip(entityId) === "") {
    return ["entity.id of a place must be its name in places.json"];
  }
  return [];
}

function entityObjectProblems(
  value: JsonValue | undefined,
  kinds: readonly string[],
  needId = true,
): string[] {
  if (!isObject(value)) return ["entity must be an object {type, id, registry}"];
  const kind = value.type;
  if (!(typeof kind === "string" && kinds.includes(kind))) {
    return [`entity.type ${pyRepr(kind)} is not one of ${kinds.join(", ")}`];
  }
  const keys = Object.keys(value);
  if (!needId && keys.length === 1 && keys[0] === "type") return [];
  const problems = entityIdProblems(kind, value.id);
  if (value.registry !== REGISTRY) {
    problems.push(`entity.registry must be ${pyRepr(REGISTRY)}, not ${pyRepr(value.registry)}`);
  }
  return problems;
}

/**
 * Every way `payload` is not an `entity/v1` (RFC 0037 §3.2, decision 1), in words; empty when it is
 * one. A writer refuses a payload with any problem; a reader keeps reading.
 */
export function entityProblems(payload: Fields): string[] {
  const problems: string[] = [];
  if (payload.schema !== ENTITY_SCHEMA) {
    problems.push(`schema is ${pyRepr(payload.schema)}, not ${pyRepr(ENTITY_SCHEMA)}`);
  }
  problems.push(...entityObjectProblems(payload.entity, KINDS));
  const label = payload.label;
  if (!(typeof label === "string" && pyStrip(label) !== "")) {
    problems.push("label must be the name, a non-empty string");
  }
  const refs = payload.refs;
  if (has(payload, "refs")) {
    if (!Array.isArray(refs)) problems.push("refs must be a list of {kind, value}");
    else {
      for (const [n, ref] of refs.entries())
        problems.push(...refProblems(ref, `refs[${n}]`, REF_KINDS));
      const entity = payload.entity;
      if (refs.length > 0 && isObject(entity) && entity.type === PERSON) {
        problems.push("a person's refs bind through resolution/v1: refs must be empty");
      }
    }
  }
  problems.push(...strings(payload, "aliases"));
  const keys = payload.keys;
  if (has(payload, "keys") && (!isObject(keys) || !Object.values(keys).every(isText))) {
    problems.push("keys must be an object of strings, the dedupe key of §8 per kind");
  }
  problems.push(...maybeString(payload, "method", "a string, `owner`"));
  problems.push(...strings(payload, "evidence"));
  problems.push(
    ...maybeString(payload, "supersedes", "the id of the entity/v1 line this replaces"),
  );
  problems.push(...head(payload));
  if (has(payload, "extra") && !isObject(payload.extra)) problems.push("extra must be an object");
  return problems;
}

/**
 * Every way `payload` is not an `entity-review/v1` (RFC 0035's shape for every kind; decisions 2 and
 * 3), in words; empty when it is one.
 */
export function entityReviewProblems(payload: Fields): string[] {
  const problems: string[] = [];
  if (payload.schema !== ENTITY_REVIEW_SCHEMA) {
    problems.push(`schema is ${pyRepr(payload.schema)}, not ${pyRepr(ENTITY_REVIEW_SCHEMA)}`);
  }
  if (payload.verdict !== DIFFERENT) {
    problems.push(`verdict must be ${pyRepr(DIFFERENT)}; a same is a binding line, never this`);
  }
  problems.push(...refProblems(payload.ref, "ref", OBSERVED_REFS));
  const refs = payload.refs;
  if (has(payload, "refs")) {
    if (!Array.isArray(refs)) problems.push("refs must be a list of {kind, value}");
    else {
      for (const [n, ref] of refs.entries()) {
        problems.push(...refProblems(ref, `refs[${n}]`, OBSERVED_REFS));
      }
    }
  }
  problems.push(...strings(payload, "observed"));
  problems.push(...entityObjectProblems(payload.entity, KINDS, false));
  const entity = payload.entity;
  if (isObject(entity)) {
    const keys = Object.keys(entity);
    if (keys.length === 1 && keys[0] === "type" && entity.type === PERSON) {
      problems.push("a person's no names the canonical person: entity needs its id and registry");
    }
  }
  problems.push(
    ...maybeString(payload, "label", "the entity's label, or the new name the proposal gave"),
  );
  problems.push(...maybeString(payload, "method", "a string, `owner`"));
  problems.push(...strings(payload, "evidence"));
  problems.push(...head(payload));
  problems.push(...maybeString(payload, "raw_id", "a string"));
  if (has(payload, "extra") && !isObject(payload.extra)) problems.push("extra must be an object");
  return problems;
}

/** Whether `kind` is a kind with dispositions: Python's `kind in DISPOSITIONS`, false for anything unhashable. */
const takesStatus = (kind: JsonValue | undefined): kind is string =>
  typeof kind === "string" && Object.hasOwn(DISPOSITIONS, kind);

/**
 * Every way `payload` is not a `status/v1` (RFC 0037 §9.2; decisions 5, 10 and 11), in words; empty
 * when it is one.
 */
export function statusProblems(payload: Fields): string[] {
  const problems: string[] = [];
  if (payload.schema !== STATUS_SCHEMA) {
    problems.push(`schema is ${pyRepr(payload.schema)}, not ${pyRepr(STATUS_SCHEMA)}`);
  }
  problems.push(...entityObjectProblems(payload.entity, STATUS_KINDS));
  const entity = payload.entity;
  const kind = isObject(entity) ? entity.type : undefined;
  const dispositions = takesStatus(kind) ? (DISPOSITIONS[kind] as readonly string[]) : undefined;
  const status = payload.status;
  if (
    dispositions !== undefined &&
    !(typeof status === "string" && dispositions.includes(status))
  ) {
    problems.push(
      `status ${pyRepr(status)} is not one of an ${kind}'s: ${dispositions.join(", ")}`,
    );
  }
  const reason = payload.reason;
  const said = typeof reason === "string" && pyStrip(reason) !== "";
  if (has(payload, "reason") && !said) problems.push("reason must be the owner's words");
  if (typeof status === "string" && REASON_REQUIRED.has(status) && !said) {
    problems.push(`a status of ${status} must say why: reason`);
  }
  problems.push(...maybeString(payload, "label", "the entity's label at the time"));
  const by = payload.proposed_by;
  if (!(typeof by === "string" && (PROPOSED_BY as readonly string[]).includes(by))) {
    problems.push(`proposed_by must be one of ${PROPOSED_BY.join(", ")}`);
  }
  const proposal = payload.proposal;
  if (has(payload, "proposal")) {
    if (!isObject(proposal) || typeof proposal.status !== "string") {
      problems.push("proposal must be an object {status, score?, because?}");
    } else if (dispositions !== undefined && !dispositions.includes(proposal.status)) {
      problems.push(`proposal.status ${pyRepr(proposal.status)} is not an ${kind}'s disposition`);
    }
  }
  const since = payload.since;
  if (has(payload, "since") && !(typeof since === "string" && DAY.test(since))) {
    problems.push("since must be a local day, YYYY-MM-DD");
  }
  problems.push(...strings(payload, "evidence"));
  problems.push(...maybeString(payload, "supersedes", "the id of the status line this replaces"));
  problems.push(...head(payload));
  for (const money of ["amount", "currency", "price", "value"]) {
    if (has(payload, money)) {
      problems.push(`${money}: no money on a status line (decision 10); the ledger holds it`);
    }
  }
  // An org's portfolio (RFC 0037's amendment of 2026-10-15, §10.2): free text, empty to clear it.
  if (has(payload, "portfolio")) {
    if (typeof payload.portfolio !== "string") {
      problems.push("portfolio must be the portfolio's name, free text, or empty to clear it");
    }
    if (kind !== "org") {
      problems.push(
        "portfolio: only an org's status line carries one (RFC 0037 §10.2): which portfolio holds a company is a position in money, on the org's tier-3 line",
      );
    }
  }
  return problems;
}

/** The validator of each schema. */
export const VALIDATORS: Readonly<Record<string, (payload: Fields) => string[]>> = {
  [ENTITY_SCHEMA]: entityProblems,
  [ENTITY_REVIEW_SCHEMA]: entityReviewProblems,
  [STATUS_SCHEMA]: statusProblems,
};

/**
 * A `status/v1` line's tier for an entity of `kind` (RFC 0037 §8, the owner's decision of 13 October
 * 2026): 3 for an org, whose `hold`, `add`, `sell` and `exited` describe a position in money and whose
 * `passed` and `let-go` would otherwise give that away by contrast; 2 for an idea, a place or an asset.
 */
export const statusTier = (kind: string): number => STATUS_TIERS[kind] ?? TIER;

/** An entity-review/v1 line's tier: the highest of its evidence, never under 2 (a decision). */
export const reviewTier = (cited: Iterable<number>): number => Math.max(TIER, ...cited);

/** `a` or `an` by the first letter, as the reference's `_a` and `_an` pick it. */
const article = (word: string): string => `${"aeiou".includes(word[0] ?? "") ? "an" : "a"} ${word}`;

/**
 * The tier rules (decisions 8 and 10; RFC 0037 §8) against the tiers of the lines a payload cites
 * (`cited`: line id → tier, the ones the record holds), each problem naming the rule for the kind: an
 * `entity/v1` line is tier 2 for every kind and never cites a tier-3 line; a `status/v1` line is its
 * kind's tier (3 about an org, which may cite tier-3 evidence; 2 about an idea, a place or an asset,
 * which never cites a tier-3 line); an `entity-review/v1` is the highest tier of its evidence and at
 * least 2, so 3 when it cites a transaction/v1 line.
 */
export function tierProblems(
  schema: string,
  tier: number,
  cited: Readonly<Record<string, number>>,
  kind?: string,
): string[] {
  const money = Object.entries(cited)
    .filter(([, t]) => t >= MONEY_TIER)
    .map(([id]) => id)
    .sort(compareCodePoints);
  if (schema === ENTITY_SCHEMA) {
    const about = kind === undefined ? "" : ` of kind ${kind}`;
    const problems =
      tier === TIER ? [] : [`${article(schema)} line${about} is tier ${TIER}, not ${tier}`];
    if (money.length > 0) {
      problems.push(
        `${article(schema)} line${about} never cites a tier-3 line (${money[0]} is tier 3): bind a merchant as a \`merchant\` ref, and the ledger is read at the page, within its ceiling`,
      );
    }
    return problems;
  }
  if (schema === STATUS_SCHEMA) {
    const wanted = kind === undefined ? TIER : statusTier(kind);
    const about =
      kind === undefined ? "about an idea, a place or an asset" : `about ${article(kind)}`;
    const why = kind === ORG ? ": its dispositions describe a position in money" : "";
    const problems =
      tier === wanted
        ? []
        : [`${article(schema)} line ${about} is tier ${wanted}, not ${tier}${why}`];
    if (money.length > 0 && wanted < MONEY_TIER) {
      problems.push(
        `${article(schema)} line ${about} never cites a tier-3 line (${money[0]} is tier 3): no money on the line, and the ledger is read at the page, within its ceiling`,
      );
    }
    return problems;
  }
  if (schema === ENTITY_REVIEW_SCHEMA) {
    const wanted = reviewTier(Object.values(cited));
    return tier === wanted
      ? []
      : [`an ${schema} line citing this evidence is tier ${wanted}, not ${tier}`];
  }
  return [];
}

/**
 * Whether a status reason about an entity of `kind` is also written as a `note/v1` by the reference's
 * writer: only when the status line's tier is no higher than a note's, which RFC 0010 fixes at 2, so
 * the note shows nothing the line keeps higher. An org's status is tier 3, so its reason stays on the line.
 */
export const reasonNote = (kind: string): boolean => statusTier(kind) <= TIER;

const SCHEMA_OF_KIND: Readonly<Record<string, string>> = {
  [ENTITY]: ENTITY_SCHEMA,
  [ENTITY_REVIEW]: ENTITY_REVIEW_SCHEMA,
  [STATUS]: STATUS_SCHEMA,
};

/**
 * What the reference's writers check before appending a line of one of the three profiles, in its
 * words: the validator of the line's kind on the payload, then the tier rules against the tiers of the
 * lines its `evidence` names that `tiersById` knows, the kind read through `kindOf`. A line of another
 * kind gets one sentence of this implementation's.
 */
export function entityLineProblems(line: Line, tiersById: ReadonlyMap<string, number>): string[] {
  const schema = SCHEMA_OF_KIND[line.kind];
  if (schema === undefined) {
    return [
      `kind must be one of ${Object.keys(SCHEMA_OF_KIND).join(", ")}, not ${pyRepr(line.kind)}`,
    ];
  }
  const payload = fieldsOf(line);
  const validator = VALIDATORS[schema] as (payload: Fields) => string[];
  const cited: Record<string, number> = {};
  const evidence = payload.evidence;
  if (Array.isArray(evidence)) {
    for (const id of evidence) {
      const tier = typeof id === "string" ? tiersById.get(id) : undefined;
      if (tier !== undefined) cited[id as string] = tier;
    }
  }
  return [...validator(payload), ...tierProblems(schema, line.tier, cited, kindOf(payload.entity))];
}

const RULE = "an org's reason stays on its tier-3 line and is never a note (RFC 0037 §10.5)";

/**
 * This implementation's own check, which the reference enforces only in its writer
 * (`entity_status.write`, `reason_note`) and RFC 0037 §8, §10.2 and §10.5 state: an org's status
 * reason stays on its tier-3 `status/v1` line and is never a tier-2 `note/v1`. Among the standing lines,
 * one sentence each, in `seq` order, for a `status/v1` line about an org that carries a `note` field;
 * for a `note/v1` line labelled `status` whose `extra.entity` names an org, or whose `extra.status`
 * names the id of an org's `status/v1` line; and for a `note/v1` line labelled `status` above tier 2.
 */
export function orgReasonProblems(lines: Iterable<Line>): string[] {
  const all = [...lines];
  const orgStatusIds = new Set(
    all
      .filter(
        (l) =>
          l.kind === STATUS &&
          fieldsOf(l).schema === STATUS_SCHEMA &&
          kindOf(fieldsOf(l).entity) === ORG,
      )
      .map((l) => l.id),
  );
  const found: Array<[number, string]> = [];
  for (const l of standing(all, STATUS)) {
    const p = fieldsOf(l);
    if (p.schema !== STATUS_SCHEMA || kindOf(p.entity) !== ORG || !has(p, "note")) continue;
    found.push([l.seq, `${l.id}: a status/v1 line about an org names a note; ${RULE}`]);
  }
  for (const l of standing(all, "note")) {
    const p = fieldsOf(l);
    const labels = p.labels;
    if (p.schema !== NOTE_SCHEMA || !Array.isArray(labels) || !labels.includes(NOTE_LABEL))
      continue;
    const extra = isObject(p.extra) ? p.extra : {};
    if (kindOf(extra.entity) === ORG) {
      found.push([l.seq, `${l.id}: a note/v1 line labelled status is about an org; ${RULE}`]);
    } else if (typeof extra.status === "string" && orgStatusIds.has(extra.status)) {
      found.push([
        l.seq,
        `${l.id}: a note/v1 line labelled status answers an org's status line, ${extra.status}; ${RULE}`,
      ]);
    }
    if (typeof l.tier === "number" && l.tier > TIER) {
      found.push([
        l.seq,
        `${l.id}: a note/v1 line labelled status is tier ${l.tier}; a note is tier 2 (RFC 0010), and no status writes one above it (RFC 0037 §10.5)`,
      ]);
    }
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, sentence]) => sentence);
}

// -- the dedupe keys (§8) --------------------------------------------------------------------------------

/**
 * The one dedupe key of an entity of `kind` from the refs it carries, strongest first (§8): a person's
 * `email:`, `phone:`, `name:`; an org's `domain:`, `repo-org:`, `group:`, `merchant:`; an idea's `page:`,
 * `repo:`, `title:`; a place's `place:` (its name); an asset's `mmsi:`, `icao24:`, `registration:`,
 * `subject:` (its id). Undefined when nothing gives one.
 */
export function keyOf(
  kind: string,
  refs: Iterable<Ref>,
  entityId?: string,
  label?: string,
): string | undefined {
  const found = new Map<string, string>(); // the first ref of each kind, as written
  for (const ref of refs) if (!found.has(ref.kind)) found.set(ref.kind, ref.value);
  if (kind === PERSON) {
    for (const name of ["email", "phone", "name"]) {
      const value = found.get(name);
      if (value !== undefined) return `${name}:${name === "phone" ? pyStrip(value) : fold(value)}`;
    }
    return undefined;
  }
  if (kind === ORG) {
    const domain = found.get("domain");
    if (domain !== undefined) return `domain:${registeredDomain(domain) || fold(domain)}`;
    const repo = found.get("repo");
    const org = repo === undefined ? undefined : repoOrg(repo);
    if (org !== undefined) return `repo-org:${org}`;
    for (const name of ["group", "merchant"]) {
      const value = found.get(name);
      if (value !== undefined) return `${name}:${fold(value)}`;
    }
    return undefined;
  }
  if (kind === IDEA) {
    const page = found.get("page");
    if (page !== undefined) return `page:${pyStrip(page)}`;
    const repo = found.get("repo");
    if (repo !== undefined) {
      const stripped = stripChar(repo, "/");
      if (stripped.split("/").length - 1 >= 2) return `repo:${stripped.toLowerCase()}`;
    }
    const title = found.get("title");
    const titled = title === undefined ? "" : titleKey(title);
    if (titled !== "") return `title:${titled}`;
    const labelled = label ? titleKey(label) : "";
    if (labelled !== "") return `title:${labelled}`;
    return undefined;
  }
  if (kind === PLACE) {
    const place = found.get("place") || entityId || label;
    return place ? `place:${fold(place)}` : undefined;
  }
  if (kind === ASSET) {
    const mmsi = found.get("mmsi");
    if (mmsi !== undefined) return `mmsi:${pyStrip(mmsi)}`;
    const icao24 = found.get("icao24");
    if (icao24 !== undefined) return `icao24:${pyStrip(icao24).toLowerCase()}`;
    const registration = found.get("registration");
    if (registration !== undefined) return `registration:${registrationKey(registration)}`;
    const subject = found.get("subject") || entityId;
    return subject ? `subject:${subject}` : undefined;
  }
  return undefined;
}

// -- the canonical entities ------------------------------------------------------------------------------

/**
 * One canonical entity: what the standing lines (and, for a place or an asset, its registry entry) say
 * it is. `lines` are the ids of the lines that name it, oldest first; `until` is the registry entry's
 * as the file holds it, null otherwise.
 */
export interface Entity {
  kind: string;
  id: string;
  label: string;
  aliases: string[];
  refs: Ref[];
  lines: string[];
  registry: boolean;
  until: string | null;
}

/** An entity as the reference's `--json` carries it: its fields and its dedupe key. */
export interface EntityJson {
  kind: string;
  id: string;
  label: string;
  aliases: string[];
  refs: Ref[];
  key: string | null;
  lines: string[];
  registry: boolean;
  until: string | null;
}

/** The dedupe key of an entity, from its refs, its id and its label. */
export const entityKey = (entity: Entity): string | undefined =>
  keyOf(entity.kind, entity.refs, entity.id, entity.label);

export function entityJson(entity: Entity): EntityJson {
  return {
    kind: entity.kind,
    id: entity.id,
    label: entity.label,
    aliases: [...entity.aliases],
    refs: entity.refs.map((r) => ({ kind: r.kind, value: r.value })),
    key: entityKey(entity) ?? null,
    lines: [...entity.lines],
    registry: entity.registry,
    until: entity.until,
  };
}

/** The key of an entity in the maps here: its kind and its id, as the reference's `(kind, id)` tuple. */
export const pairKey = (kind: string, id: string): string => `${kind}\u0000${id}`;

/** The key of a ref in the maps here: its kind and its value. */
export const refKey = (ref: Ref): string => `${ref.kind}\u0000${ref.value}`;

const newEntity = (kind: string, id: string, label: string): Entity => ({
  kind,
  id,
  label,
  aliases: [],
  refs: [],
  lines: [],
  registry: false,
  until: null,
});

const hasRef = (refs: readonly Ref[], ref: Ref): boolean =>
  refs.some((r) => r.kind === ref.kind && r.value === ref.value);

/** The kind an `entity` object names: its `type`, a legacy `company` read as `org`. */
export function kindOf(entity: JsonValue | undefined): string | undefined {
  if (!isObject(entity)) return undefined;
  const type = entity.type;
  if (typeof type !== "string") return undefined;
  const kind = LEGACY[type] ?? type;
  return (KINDS as readonly string[]).includes(kind) ? kind : undefined;
}

const bySeq = (a: Line, b: Line): number => a.seq - b.seq;

/** The ids the retraction lines name (RFC 0003), whatever their schema; a retracted retraction still hides. */
function retractedIds(lines: Iterable<Line>): Set<string> {
  const found = new Set<string>();
  for (const line of lines) {
    if (line.kind !== RETRACTION) continue;
    const target = fieldsOf(line).supersedes;
    if (typeof target === "string") found.add(target);
  }
  return found;
}

/**
 * The lines of `kind` standing, in chain order: not retracted, and not named by another standing line
 * of the kind in `supersedes` (a retracted line's `supersedes` counts for nothing, so the one it
 * replaced stands again).
 */
export function standing(lines: Iterable<Line>, kind: string): Line[] {
  const ordered = [...lines].sort(bySeq);
  const retracted = retractedIds(ordered);
  const live = ordered.filter((line) => line.kind === kind && !retracted.has(line.id));
  const replaced = new Set<string>();
  for (const line of live) {
    const named = fieldsOf(line).supersedes;
    if (isText(named)) replaced.add(named);
  }
  return live.filter((line) => !replaced.has(line.id));
}

/** The refs an entity line binds: the `{kind, value}` objects of its `refs` with both strings. */
function refsOf(value: JsonValue | undefined): Ref[] {
  const found: Ref[] = [];
  if (!Array.isArray(value)) return found;
  for (const item of value) {
    const ref = asRef(item);
    if (ref !== undefined) found.push(ref);
  }
  return found;
}

/** What a resolution line's walk reaches for a ref: the entity's type and id, and the line's label. */
interface Identity {
  type: string | undefined;
  entity: string | undefined;
  label: string | undefined;
}

/**
 * RFC 0006's walk over the record's `resolution/v1` lines, as the reference's readers run it: the
 * standing line of each ref (last wins; a line of any schema counts; not retracted, and not named in
 * the `supersedes` of a resolution line that is not retracted itself), and the identity each ref
 * reaches through `alias_of`, at most four hops, nothing on a cycle. This is not `resolve.ts`'s
 * resolver, which keys on the `…/v1` schemas; since the reference's #321 both let a retracted
 * superseder supersede nothing.
 */
function resolutionWalk(lines: readonly Line[]): {
  standing: Map<string, { ref: Ref; line: Line }>;
  identities: Map<string, { ref: Ref; who: Identity }>;
} {
  const retracted = retractedIds(lines);
  const resolutions = lines.filter((line) => line.kind === RESOLUTION).sort(bySeq);
  const superseded = new Set<string>();
  for (const line of resolutions) {
    if (retracted.has(line.id)) continue;
    const named = fieldsOf(line).supersedes;
    if (typeof named === "string") superseded.add(named);
  }
  const last = new Map<string, { ref: Ref; line: Line }>();
  for (const line of resolutions) {
    if (retracted.has(line.id) || superseded.has(line.id)) continue;
    const ref = asRef(fieldsOf(line).ref);
    if (ref !== undefined) last.set(refKey(ref), { ref, line });
  }
  const walk = (ref: Ref): Identity => {
    const none: Identity = { type: undefined, entity: undefined, label: undefined };
    const visited = new Set<string>();
    let current = ref;
    for (let hop = 0; hop <= 4; hop++) {
      const key = refKey(current);
      if (visited.has(key)) return none;
      visited.add(key);
      const found = last.get(key);
      if (found === undefined) return none;
      const payload = fieldsOf(found.line);
      const alias = asRef(payload.alias_of);
      if (alias !== undefined) {
        current = alias;
        continue;
      }
      const entity = isObject(payload.entity) ? payload.entity : {};
      return {
        type: typeof entity.type === "string" ? entity.type : undefined,
        entity: isText(entity.id) ? entity.id : undefined,
        label: typeof payload.label === "string" ? payload.label : undefined,
      };
    }
    return none;
  };
  const identities = new Map<string, { ref: Ref; who: Identity }>();
  for (const [key, { ref }] of last) identities.set(key, { ref, who: walk(ref) });
  return { standing: last, identities };
}

/** The strings of an `aliases` value as Python iterates it: a list's items, a string's characters, an object's keys. */
function aliasesOf(value: JsonValue | undefined): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") return [...value];
  if (isObject(value)) return Object.keys(value);
  return [];
}

/**
 * (kind, id) → Entity for every entity the record's lines name: the standing `entity/v1` lines, and
 * the `resolution/v1` lines through RFC 0006's lookup, a `company` read as an org. The label is the
 * first standing line's; a later line adds refs and aliases, never removes one. `lines` are the
 * entity, resolution and retraction lines, in any order.
 */
export function canonical(lines: Iterable<Line>): Map<string, Entity> {
  const all = [...lines];
  const found = new Map<string, Entity>();
  for (const line of standing(all, ENTITY)) {
    const payload = fieldsOf(line);
    if (payload.schema !== ENTITY_SCHEMA) continue;
    const kind = kindOf(payload.entity);
    const entityId = isObject(payload.entity) ? payload.entity.id : undefined;
    const label = payload.label;
    if (kind === undefined || !isText(entityId) || typeof label !== "string") continue;
    const key = pairKey(kind, entityId);
    let entity = found.get(key);
    if (entity === undefined) {
      entity = newEntity(kind, entityId, label);
      found.set(key, entity);
    }
    entity.lines.push(line.id);
    for (const alias of aliasesOf(payload.aliases)) {
      if (!entity.aliases.includes(alias)) entity.aliases.push(alias);
    }
    if (kind === PERSON) continue; // a person's refs bind through resolution/v1 alone (decision 1)
    for (const ref of refsOf(payload.refs)) if (!hasRef(entity.refs, ref)) entity.refs.push(ref);
  }
  const judged = all.filter((line) => line.kind === RETRACTION || line.kind === RESOLUTION);
  const { standing: last, identities } = resolutionWalk(judged);
  for (const [key, { ref, who }] of identities) {
    const kind = LEGACY[who.type ?? ""] ?? who.type ?? "";
    if (who.entity === undefined || (kind !== PERSON && kind !== ORG)) continue;
    const pair = pairKey(kind, who.entity);
    let entity = found.get(pair);
    if (entity === undefined) {
      entity = newEntity(kind, who.entity, who.label || who.entity);
      found.set(pair, entity);
    }
    if (!hasRef(entity.refs, ref)) entity.refs.push(ref);
    const lineId = (last.get(key) as { line: Line }).line.id;
    if (!entity.lines.includes(lineId)) entity.lines.push(lineId);
  }
  return found;
}

/** What a ref resolves to: the entity of `kind` with this `id`. */
export interface Binding {
  ref: Ref;
  kind: string;
  id: string;
}

/**
 * Ref → (kind, id), one lookup over two profiles (§3.4 rule 2), by `refKey`: the entity named by the
 * last standing line that binds the ref, an `entity/v1` line by its `refs` or a `resolution/v1` line
 * by RFC 0006's walk (a `company` read as an org).
 */
export function bindings(lines: Iterable<Line>): Map<string, Binding> {
  const all = [...lines];
  const found = new Map<string, { seq: number; binding: Binding }>();
  for (const line of standing(all, ENTITY)) {
    const payload = fieldsOf(line);
    const kind = kindOf(payload.entity);
    const entityId = isObject(payload.entity) ? payload.entity.id : undefined;
    if (kind === undefined || kind === PERSON || typeof entityId !== "string") continue;
    for (const ref of refsOf(payload.refs)) {
      found.set(refKey(ref), { seq: line.seq, binding: { ref, kind, id: entityId } });
    }
  }
  const judged = all.filter((line) => line.kind === RETRACTION || line.kind === RESOLUTION);
  const { standing: last, identities } = resolutionWalk(judged);
  for (const [key, { ref, who }] of identities) {
    const kind = LEGACY[who.type ?? ""] ?? who.type ?? "";
    if (who.entity === undefined || !(KINDS as readonly string[]).includes(kind)) continue;
    const seq = (last.get(key) as { line: Line }).line.seq;
    const held = found.get(key);
    if (held === undefined || held.seq < seq) {
      found.set(key, { seq, binding: { ref, kind, id: who.entity } });
    }
  }
  return new Map([...found].map(([key, { binding }]) => [key, binding]));
}

/** The file parsed; undefined when there is none; one that is not JSON is refused naming it. */
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
    throw new EntityError(`${path} is not JSON: ${(err as Error).message}`);
  }
}

/**
 * The places and assets the registry files name, as entities: a place under its name, an asset under
 * its id with its identifiers as refs; `until` as each entry holds it. A file that is not a registry is
 * refused as `settings.ts` refuses it.
 */
export function registry(root: string): Map<string, Entity> {
  const found = new Map<string, Entity>();
  const document = readJsonFile(join(root, "places.json")) ?? {};
  for (const place of readPlaces(root)) {
    const entry =
      isObject(document) && Object.hasOwn(document, place.name) ? document[place.name] : undefined;
    const until = isObject(entry) && typeof entry.until === "string" ? entry.until : null;
    found.set(pairKey(PLACE, place.name), {
      ...newEntity(PLACE, place.name, place.name),
      refs: [{ kind: "place", value: place.name }],
      registry: true,
      until,
    });
  }
  const raw = readJsonFile(join(root, "assets.json")) ?? {};
  const entries = isObject(raw) ? raw.assets : undefined;
  const untils = new Map<string, string>();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (isObject(entry) && typeof entry.id === "string" && typeof entry.until === "string") {
      untils.set(entry.id, entry.until);
    }
  }
  for (const asset of readAssets(root)) {
    const refs: Ref[] = [];
    for (const name of ASSET_IDENTIFIERS) {
      const value = asset[name];
      if (value !== undefined) refs.push({ kind: name, value: String(value) });
    }
    found.set(pairKey(ASSET, asset.id), {
      ...newEntity(ASSET, asset.id, asset.name),
      refs,
      registry: true,
      until: untils.get(asset.id) ?? null,
    });
  }
  return found;
}

/**
 * Every canonical entity: the lines' (`canonical`), with the registry's places and assets folded in
 * (an `entity/v1` line for one adds its refs to the entry's).
 */
export function known(lines: Iterable<Line>, root: string): Map<string, Entity> {
  const found = registry(root);
  for (const [key, entity] of canonical(lines)) {
    const entry = found.get(key);
    if (entry === undefined) {
      found.set(key, entity);
      continue;
    }
    for (const id of entity.lines) if (!entry.lines.includes(id)) entry.lines.push(id);
    for (const ref of entity.refs) if (!hasRef(entry.refs, ref)) entry.refs.push(ref);
    for (const alias of entity.aliases)
      if (!entry.aliases.includes(alias)) entry.aliases.push(alias);
  }
  return found;
}

/** The entities in the order Python sorts `(kind, id)` keys: by kind, then id, by code point. */
export const sortedEntities = (found: ReadonlyMap<string, Entity>): Entity[] =>
  [...found.values()].sort(
    (a, b) => compareCodePoints(a.kind, b.kind) || compareCodePoints(a.id, b.id),
  );

const sameWords = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((w, i) => w === b[i]);

/**
 * The one entity of `kind` that `text` names, tried in order (§6): a ref (`kind:value`, or a value one of
 * its refs carries), an id, a label or an alias (case aside), for an org the same with the legal forms
 * aside, a word of a label. `EntityError` naming the candidates when none or several.
 */
export function lookup(found: ReadonlyMap<string, Entity>, kind: string, text: string): Entity {
  const pool = sortedEntities(found).filter((e) => e.kind === kind);
  const wanted = pyStrip(text);
  if (wanted === "") throw new EntityError(`name an ${kind}`);
  const colon = wanted.indexOf(":");
  const kindValue =
    colon === -1 ? undefined : { kind: wanted.slice(0, colon), value: wanted.slice(colon + 1) };
  const folded = fold(wanted);
  const tries: Array<(e: Entity) => boolean> = [
    (e) => kindValue !== undefined && hasRef(e.refs, kindValue),
    (e) => e.refs.some((r) => fold(r.value) === folded),
    (e) => e.id === wanted,
    (e) => fold(e.label) === folded || e.aliases.some((a) => fold(a) === folded),
    (e) =>
      kind === ORG &&
      orgName(wanted).length > 0 &&
      [e.label, ...e.aliases].some((n) => sameWords(orgName(n), orgName(wanted))),
    (e) => {
      const given = words(wanted);
      return given.length === 1 && words(e.label).includes(given[0] as string);
    },
  ];
  for (const test of tries) {
    const hits = pool.filter(test);
    if (hits.length === 1) return hits[0] as Entity;
    if (hits.length > 1) {
      const names = hits
        .slice(0, 5)
        .map((e) => `${e.label} (${e.id})`)
        .join(", ");
      throw new EntityError(
        `${pyRepr(wanted)} names ${hits.length} ${kind}s: ${names}; say which by id`,
      );
    }
  }
  const have =
    pool
      .slice(0, 8)
      .map((e) => e.label)
      .join(", ") || "none yet";
  throw new EntityError(`no ${kind} is ${pyRepr(wanted)} (the record's ${kind}s: ${have})`);
}

// -- the owner's noes ------------------------------------------------------------------------------------

/**
 * One standing no: the observed thing (`ref`, and the identifiers it was seen as) is not the entity
 * `entity` of `kind`, or, with `entity` null, not the new one named `label`, or (no label either) not
 * anything yet.
 */
export interface Review {
  kind: string;
  ref: Ref;
  refs: Ref[];
  entity: string | null;
  label: string | null;
  line: string;
  at: string;
}

/** Whether this no covers an observed thing seen as `identifiers`, against `entity`. */
export function reviewHolds(
  review: Review,
  identifiers: Iterable<Ref>,
  entity: string | null = null,
): boolean {
  const seen = [...identifiers];
  return (
    review.entity === entity &&
    (hasRef(seen, review.ref) || review.refs.some((r) => hasRef(seen, r)))
  );
}

/**
 * The standing noes of the record, in chain order: every `entity-review/v1` line with verdict
 * `different`, and every `people-review/v1` line (RFC 0035), read as one of type person. `lines` are
 * the review lines and the retractions, in any order.
 */
export function reviews(lines: Iterable<Line>): Review[] {
  const ordered = [...lines].sort(bySeq);
  const retracted = retractedIds(ordered);
  const found: Review[] = [];
  for (const line of ordered) {
    if (line.kind === RETRACTION || retracted.has(line.id)) continue;
    const payload = fieldsOf(line);
    const schema = payload.schema;
    if (
      (schema !== ENTITY_REVIEW_SCHEMA && schema !== PEOPLE_REVIEW_SCHEMA) ||
      payload.verdict !== DIFFERENT
    ) {
      continue;
    }
    const entity = payload.entity;
    const kind = schema === PEOPLE_REVIEW_SCHEMA ? PERSON : kindOf(entity);
    const ref = asRef(payload.ref);
    if (kind === undefined || ref === undefined) continue;
    const entityId = isObject(entity) ? entity.id : undefined;
    if (kind === PERSON && !isText(entityId)) continue;
    const label = payload.label;
    found.push({
      kind,
      ref,
      refs: refsOf(payload.refs),
      entity: isText(entityId) ? entityId : null,
      label: isText(label) ? label : null,
      line: line.id,
      at: pyStr(line.at ?? null),
    });
  }
  return found;
}

// -- statuses ----------------------------------------------------------------------------------------------

/** One standing `status/v1` line, read. */
export interface Status {
  kind: string;
  entity: string;
  label: string | null;
  status: string;
  reason: string | null;
  proposed_by: string | null;
  /** The disposition the dream proposed, when the line answers one. */
  proposal: string | null;
  since: string | null;
  at: string;
  line: string;
  seq: number;
}

/** The local day of an instant, `YYYY-MM-DD`, as the record's clock has it. */
export type LocalDay = (at: string) => string;

/** The local day the status took effect: `since`, else the line's day under `local`. */
export const statusDay = (status: Status, local: LocalDay): string =>
  status.since !== null ? status.since : local(status.at);

export function statusJson(status: Status, local: LocalDay): Record<string, JsonValue> {
  return {
    status: status.status,
    since: statusDay(status, local),
    reason: status.reason,
    proposed_by: status.proposed_by,
    proposal: status.proposal,
    label: status.label,
    line: status.line,
  };
}

const text = (value: JsonValue | undefined): string | null => (isText(value) ? value : null);

/**
 * (kind, id) → the standing status lines of each entity, in chain order; the last is its current
 * status. `lines` are the status lines and the retractions, in any order.
 */
export function statuses(lines: Iterable<Line>): Map<string, Status[]> {
  const found = new Map<string, Status[]>();
  for (const line of standing(lines, STATUS)) {
    const payload = fieldsOf(line);
    if (payload.schema !== STATUS_SCHEMA) continue;
    const kind = kindOf(payload.entity);
    const entityId = isObject(payload.entity) ? payload.entity.id : undefined;
    const status = payload.status;
    if (!takesStatus(kind) || typeof entityId !== "string") continue;
    if (!(typeof status === "string" && (DISPOSITIONS[kind] as readonly string[]).includes(status)))
      continue;
    const proposal = payload.proposal;
    const proposed = isObject(proposal) ? proposal.status : undefined;
    const key = pairKey(kind, entityId);
    const history = found.get(key) ?? [];
    history.push({
      kind,
      entity: entityId,
      label: text(payload.label),
      status,
      reason: text(payload.reason),
      proposed_by: text(payload.proposed_by),
      proposal: typeof proposed === "string" ? proposed : null,
      since: text(payload.since),
      at: pyStr(line.at ?? null),
      line: line.id,
      seq: line.seq,
    });
    found.set(key, history);
  }
  return found;
}

/**
 * Each org's portfolio (RFC 0037's amendment of 2026-10-15, §10.2), by entity id: the `portfolio` of
 * its latest status line in chain order that carries the field as text, its words collapsed. A
 * retracted line counts for nothing, so the one before decides again; a line a later status
 * supersedes still counts, since a status without the field leaves the portfolio as it stood; an
 * empty field clears it. Read for an org only.
 */
export function portfolios(lines: Iterable<Line>): Map<string, string | null> {
  const all = [...lines];
  const retracted = retractedIds(all);
  const last = new Map<string, { seq: number; portfolio: string | null }>();
  for (const line of all) {
    if (line.kind !== STATUS || retracted.has(line.id)) continue;
    const payload = fieldsOf(line);
    if (payload.schema !== STATUS_SCHEMA || kindOf(payload.entity) !== "org") continue;
    const id = isObject(payload.entity) ? payload.entity.id : undefined;
    const portfolio = payload.portfolio;
    if (typeof id !== "string" || typeof portfolio !== "string") continue;
    const before = last.get(id);
    if (before !== undefined && before.seq > line.seq) continue;
    const words = pySplit(portfolio).join(" ");
    last.set(id, { seq: line.seq, portfolio: words === "" ? null : words });
  }
  return new Map([...last].map(([id, { portfolio }]) => [id, portfolio]));
}

/**
 * The note that holds each status line's reason (§10.5), by the status line's id: the latest
 * `note/v1` line labelled `status`, not retracted, whose `extra.status` names it, as the reference's
 * `status list` gives it since 0.7.0.
 */
export function statusNotes(lines: Iterable<Line>): Map<string, string> {
  const all = [...lines];
  const retracted = retractedIds(all);
  const found = new Map<string, { seq: number; id: string }>();
  for (const line of all) {
    if (line.kind !== "note" || retracted.has(line.id)) continue;
    const payload = fieldsOf(line);
    const labels = payload.labels;
    const extra = payload.extra;
    if (payload.schema !== "note/v1" || !Array.isArray(labels) || !labels.includes("status"))
      continue;
    const status = isObject(extra) ? extra.status : undefined;
    if (typeof status !== "string") continue;
    const before = found.get(status);
    if (before === undefined || before.seq < line.seq)
      found.set(status, { seq: line.seq, id: line.id });
  }
  return new Map([...found].map(([status, { id }]) => [status, id]));
}

/** A day the readers' rules count from: refused, naming it, when it is not one (the reference raises). */
function dayOf(day: string): string {
  if (!isDay(day)) throw new EntityError(`${pyRepr(day)} is not a day, YYYY-MM-DD`);
  return day;
}

/**
 * The line that mutes the dream's proposals of `disposition` for this entity on `on`, or undefined
 * (decision 6, a reader's rule): the current status, when it has a reason and answers a proposal of
 * `disposition` with another status, within `days` of its day. There is no "never" line.
 */
export function muted(
  history: readonly Status[],
  disposition: string,
  on: string,
  local: LocalDay,
  days: number = MUTE_DAYS,
): Status | undefined {
  const current = history[history.length - 1];
  if (current === undefined) return undefined;
  if (
    current.reason === null ||
    current.proposal !== disposition ||
    current.status === disposition
  ) {
    return undefined;
  }
  const start = dayOf(statusDay(current, local));
  const today = dayOf(on);
  return start <= today && today < addDays(start, days) ? current : undefined;
}

/**
 * Whether the current status has aged past the reader's limit for it (decision 9: a `hold` over three
 * years, an `exploring` over two, `policy/entities.json` `stale_days`).
 */
export function stale(
  current: Status,
  on: string,
  local: LocalDay,
  limits: Readonly<Record<string, number>> = STALE_DAYS,
): boolean {
  const limit = Object.hasOwn(limits, current.status) ? limits[current.status] : undefined;
  return limit !== undefined && daysBetween(dayOf(statusDay(current, local)), dayOf(on)) > limit;
}

/** The local day of a line's `at` in `timezone` under `dayStart`; an `at` that is not an instant is refused. */
export function localDays(timezone: string, dayStart: string = DEFAULT_DAY_START): LocalDay {
  return (at) => {
    const ms = Date.parse(at);
    if (Number.isNaN(ms)) throw new EntityError(`${pyRepr(at)} is not an instant, RFC 3339`);
    return localDayOf(ms, timezone, dayStart);
  };
}

// -- settings (§4.6) --------------------------------------------------------------------------------------

/** `policy/entities.json` read over the defaults. */
export interface EntitySettings {
  public_mail_providers: string[];
  public_suffixes: string[];
  code_hosts: string[];
  merchant_min_lines: number;
  title_min_lines: number;
  registration_min_flights: number;
  mute_days: number;
  stale_days: Record<string, number>;
}

/** The whole number Python's `isinstance(v, int) and not isinstance(v, bool)` takes (a JSON `2.0` is one here, a float there). */
const isWhole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/**
 * `policy/entities.json`, read each run and never a line: its provider list and suffixes extend the
 * defaults, its numbers replace them. An absent file is the defaults; `EntityError` naming the file
 * and the key when a value is not what it should be, in the reference's words.
 */
export function readEntitySettings(root: string): EntitySettings {
  const path = join(root, ...POLICY_FILE);
  const data = readJsonFile(path) ?? {};
  if (!isObject(data)) throw new EntityError(`${path} must be an object`);
  const names = (key: string): string[] => {
    const value = has(data, key) ? data[key] : [];
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && pyStrip(v) !== "")) {
      throw new EntityError(`${path}: ${key} must be a list of names`);
    }
    return (value as string[]).map((v) => pyStrip(v).toLowerCase());
  };
  const number = (key: string, fallback: number): number => {
    const value = has(data, key) ? data[key] : fallback;
    if (!isWhole(value) || value < 1)
      throw new EntityError(`${path}: ${key} must be a whole number from 1`);
    return value;
  };
  const staleDays = has(data, "stale_days") ? data.stale_days : STALE_DAYS;
  if (!isObject(staleDays) || !Object.values(staleDays).every((v) => isWhole(v) && v >= 1)) {
    throw new EntityError(`${path}: stale_days must map a status to a whole number of days`);
  }
  const hosts = has(data, "code_hosts") ? names("code_hosts") : [...CODE_HOSTS];
  return {
    public_mail_providers: [
      ...new Set([...PUBLIC_MAIL_PROVIDERS, ...names("public_mail_providers")]),
    ],
    public_suffixes: [...new Set(names("public_suffixes"))],
    code_hosts: hosts,
    merchant_min_lines: number("merchant_min_lines", 3),
    title_min_lines: number("title_min_lines", 2),
    registration_min_flights: number("registration_min_flights", 3),
    mute_days: number("mute_days", MUTE_DAYS),
    stale_days: { ...STALE_DAYS, ...(staleDays as Record<string, number>) },
  };
}

// -- the list (entity_status.py, read-only) --------------------------------------------------------------

/** Refuse a kind that takes no status: a person, a goal, anything not org, idea, place, asset. */
export function checkKind(kind: string): void {
  if (Object.hasOwn(NO_STATUS, kind)) throw new StatusError(NO_STATUS[kind] as string);
  if (!Object.hasOwn(DISPOSITIONS, kind)) {
    throw new StatusError(`a status is for an ${STATUS_KINDS.join(", ")}; not for ${pyRepr(kind)}`);
  }
}

/** One row of `status list`: an entity, its current status, and the readers' rules over it. */
export interface StatusRow {
  entity: Entity;
  current: Status | null;
  since: string | null;
  stale: boolean;
  /** Each disposition the dream may not propose, with the last day it is muted. */
  muted: Array<[string, string]>;
  /** The day the registry entry is closed with: the standing line's, never the file's. */
  until: string | null;
  /** An org's portfolio (§10.2), null when none stands or for any other kind. */
  portfolio: string | null;
  /** The note that holds the current status's reason (`statusNotes`), null when none. */
  note: string | null;
}

export interface StatusListing {
  kind: string;
  rows: StatusRow[];
  /** The day the listing is read on. */
  on: string;
}

/** A row as `--json` prints it. */
export interface StatusRowJson {
  id: string;
  label: string;
  key: string | null;
  status: string | null;
  since: string | null;
  reason: string | null;
  proposed_by: string | null;
  line: string | null;
  note: string | null;
  stale: boolean;
  muted: Array<{ status: string; until: string }>;
  until: string | null;
  portfolio: string | null;
}

export interface StatusListingJson {
  kind: string;
  on: string;
  entities: StatusRowJson[];
}

/**
 * The lines of the record whose `kind` is one of `kinds` and that `keep` keeps, in file order; a row
 * that is not a line is skipped.
 */
function readLinesOfKinds(
  root: string,
  kinds: ReadonlySet<string>,
  keep: (line: Line) => boolean = () => true,
): Line[] {
  const found: Line[] = [];
  for (const month of monthFiles(root)) {
    for (const { raw, row } of eachLine(month.file)) {
      const parsed = parseLine(raw, `${month.rel} line ${row}`);
      if ("error" in parsed) continue;
      if (kinds.has(parsed.line.kind) && keep(parsed.line)) found.push(parsed.line);
    }
  }
  return found;
}

/** A `note/v1` line labelled `status`, the only notes `status list` reads (`statusNotes`). */
const isStatusNote = (line: Line): boolean => {
  const labels = fieldsOf(line).labels;
  return Array.isArray(labels) && labels.includes("status");
};

/**
 * Every canonical entity of `kind` with its current status and the readers' rules over it, the most
 * recent status first, then those with none by label, as the reference's `logbook status list KIND`
 * reads it. `today` is the day the listing is read on, `YYYY-MM-DD`; by default today in the record's
 * zone by `now`'s clock. A line's local day is its day in the record's `timezone` under `day_start`
 * (RFC 0036), read as the reference reads it whatever flag is on. Writes nothing.
 */
export function statusListing(
  root: string,
  kind: string,
  today?: string,
  now: Date = new Date(),
): StatusListing {
  checkKind(kind);
  const meta = readMeta(root);
  const refusal = formatRefusal(meta);
  if (refusal) throw new LogbookError(refusal);
  const timezone =
    typeof meta.timezone === "string" && meta.timezone !== "" ? meta.timezone : "UTC";
  // The reference's `status list` always reads `day_start` (RFC 0036): a listing puts a status on the
  // local day it took effect by it, whichever draft flags are on here; a value that is not a clock is
  // refused in its words.
  const dayStart = readDayStart(meta);
  const settings = readEntitySettings(root);
  const on = dayOf(today ?? localToday(now, timezone, dayStart));
  const local = localDays(timezone, dayStart);
  const lines = readLinesOfKinds(
    root,
    new Set([ENTITY, RESOLUTION, RETRACTION, STATUS, "note"]),
    (line) => line.kind !== "note" || isStatusNote(line),
  );
  const found = known(lines, root);
  const histories = statuses(lines);
  const portfolioOf = kind === "org" ? portfolios(lines) : new Map<string, string | null>();
  const notes = statusNotes(lines);
  const rows: StatusRow[] = [];
  for (const entity of sortedEntities(found)) {
    if (entity.kind !== kind) continue;
    const history = histories.get(pairKey(kind, entity.id)) ?? [];
    const current = history[history.length - 1] ?? null;
    const held: Array<[string, string]> = [];
    for (const disposition of DISPOSITIONS[kind] as readonly string[]) {
      const hold = muted(history, disposition, on, local, settings.mute_days);
      if (hold !== undefined)
        held.push([disposition, addDays(statusDay(hold, local), settings.mute_days - 1)]);
    }
    const closing = current !== null && (CLOSING[kind] ?? []).includes(current.status);
    rows.push({
      entity,
      current,
      since: current === null ? null : statusDay(current, local),
      stale: current !== null && stale(current, on, local, settings.stale_days),
      muted: held,
      until: current !== null && closing ? statusDay(current, local) : null, // the line's, never the file's
      portfolio: portfolioOf.get(entity.id) ?? null,
      note: current === null ? null : (notes.get(current.line) ?? null),
    });
  }
  rows.sort((a, b) => {
    const none = Number(a.current === null) - Number(b.current === null);
    if (none !== 0) return none;
    const later = compareCodePoints(b.since ?? "", a.since ?? "");
    if (later !== 0) return later;
    return compareCodePoints(casefold(a.entity.label), casefold(b.entity.label));
  });
  return { kind, rows, on };
}

export function statusRowJson(row: StatusRow): StatusRowJson {
  return {
    id: row.entity.id,
    label: row.entity.label,
    key: entityKey(row.entity) ?? null,
    status: row.current === null ? null : row.current.status,
    since: row.since,
    reason: row.current === null ? null : row.current.reason,
    proposed_by: row.current === null ? null : row.current.proposed_by,
    line: row.current === null ? null : row.current.line,
    note: row.note,
    stale: row.stale,
    muted: row.muted.map(([status, until]) => ({ status, until })),
    until: row.until,
    portfolio: row.portfolio,
  };
}

/** The listing as `status list KIND --json` prints it. */
export const statusListingJson = (listing: StatusListing): StatusListingJson => ({
  kind: listing.kind,
  on: listing.on,
  entities: listing.rows.map(statusRowJson),
});

/** `label` padded with spaces to `width` code points, as Python's `f"{label:<{width}}"` does. */
const padded = (label: string, width: number): string =>
  label + " ".repeat(Math.max(0, width - codePoints(label)));

/** The listing as `status list KIND` prints it: the header, a row per entity, the reason under its row. */
export function statusListingText(listing: StatusListing): string {
  const { kind, rows, on } = listing;
  const out = [`status · ${rows.length} ${kind}${rows.length === 1 ? "" : "s"} · ${on}`];
  if (rows.length === 0) {
    out.push(`no ${kind} yet: \`review ${kind}\` names them`);
    return `${out.join("\n")}\n`;
  }
  const width = Math.max(...rows.map((r) => codePoints(r.entity.label)));
  for (const row of rows) {
    const label = padded(row.entity.label, width);
    if (row.current === null) {
      out.push(`  ${label}  ${NONE}`);
      continue;
    }
    let who = row.current.proposed_by ?? "owner";
    if (row.current.proposal !== null && who === "dream")
      who = `dream proposed ${row.current.proposal}`;
    const parts = [`${row.current.status} since ${row.since} (${who})`];
    if (row.portfolio !== null) parts.push(`portfolio ${row.portfolio}`);
    if (row.until !== null) parts.push(`until ${row.until}`);
    if (row.stale) parts.push("stale");
    if (row.muted.length > 0) {
      parts.push(`not proposed: ${row.muted.map(([s, d]) => `${s} to ${d}`).join(", ")}`);
    }
    out.push(`  ${label}  ${parts.join(" · ")}`);
    if (row.current.reason) out.push(`  ${padded("", width)}  reason: ${row.current.reason}`);
  }
  return `${out.join("\n")}\n`;
}
