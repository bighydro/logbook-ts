/**
 * A transcript's voices (RFC 0038 §2, and RFC 0004's dated amendment of 2026-10-14): the optional
 * `speakers` and `diarization` of a `transcript/v1` line, read as the reference's `show` and Day
 * print them since bighydro/logbook 562a741 (#301). Matched by running the reference on probe lines,
 * never by reading it; behind the `rfc0038` flag in `show` and the Day (`flags.ts`).
 *
 * A reader is lenient: it reads the voices it can and passes the rest by, so a line written by a
 * later writer, or a broken one, never stops a reader. A voice is an object whose `label` is a
 * string of 1 to 64 characters with no `#` and no line break (RFC 0038 §2.4); anything else in the
 * list is skipped, and a line with no voice it can read reads as a line without `speakers`, exactly
 * as before. `show` shows a voice as the source gave it: `you` when the source says the channel is
 * the owner's own microphone (`from_me: true`), else as the name the source displayed, else as its
 * label.
 *
 * Who a voice is (RFC 0038 §3, RFC 0006's amendment of 2026-10-15), as the reference's Day and
 * `people` read it since 0.7.0, matched by running it: the standing `resolution/v1` line whose ref is
 * `{kind: "speaker", value: "<transcript line id>#<label>"}`, through RFC 0006's walk (`alias_of`
 * included), binds the voice to a person (`bindVoices`). Each voice is then the owner's (bound to the
 * owner, or `from_me` with no line), a person's, unnamed (`unnamed: true`), or not yet named (no
 * line). Only a standing transcript's voices are read: its callers pass no other.
 */

import { personName, type Resolver } from "./resolve.js";
import type { JsonValue, Line, Payload } from "./types.js";

/** One voice as the reader reads it. */
export interface Voice {
  label: string;
  /** How long the voice speaks; null when the line gives no number of seconds that is 0 or more. */
  seconds: number | null;
  /** A name the source displayed for the voice, never a resolution; null when none or blank. */
  name: string | null;
  /** `from_me: true`: the source says it is the owner's own microphone. */
  owner: boolean;
  /** The recording's channel the voice is on (`mic`, `system`), when the source says. */
  channel: string | null;
}

/** One voice as the reference's `day --json` gives it, under a transcript's `speakers`. */
export interface SpeakerJson {
  label: string;
  /** Who the voice is: the person a standing line binds it to, or the owner's id; null when unnamed or not yet named. */
  person: string | null;
  /** The person's label, or the name the source displayed for a voice not yet named; null for the owner's. */
  name: string | null;
  seconds: number | null;
  /** The binding line's `basis`; `channel` for the owner's voice by its channel; null when not yet named. */
  basis: string | null;
  /** The binding line's `consent`, `unknown` when absent or not one of the three; null when no line binds it. */
  consent: string | null;
  owner: boolean;
}

/** A voice as a reader of RFC 0038 §3 reads it: the source's voice and who it is. */
export interface BoundVoice extends Voice {
  /** `owner`, `person`, `unnamed` or `nobody` (not yet named). */
  who: "owner" | "person" | "unnamed" | "nobody";
  /** The person bound: the owner's id for the owner's voice; undefined when not yet named. */
  person: string | undefined;
  /** The person's label when the line names one. */
  personLabel: string | undefined;
  basis: string | null;
  consent: string | null;
  /** The binding line's `confidence`, a number from 0 to 1; undefined when asserted (absent). */
  confidence: number | undefined;
}

/** Who the owner is, as the readers know them: `owner_id` and the ids and names that are theirs. */
export interface Owner {
  id?: string | undefined;
  ids: ReadonlySet<string>;
  names: ReadonlySet<string>;
}

const CONSENT = new Set(["yes", "no", "unknown"]);

/**
 * The voices of a standing transcript, each with who it is: the standing line for its `speaker` ref
 * (RFC 0038 §3.3 rule 2) and the entity RFC 0006's walk reaches from it. A line naming the owner, or
 * a `from_me` voice with no line, is the owner's; a line marked `unnamed` names nobody by name; a
 * voice with no line, or one whose walk reaches no person, is not yet named.
 */
export function bindVoices(transcript: Line, resolver: Resolver, owner: Owner): BoundVoice[] {
  return voicesOf(transcript.payload ?? {}).map((voice) => {
    const ref = { kind: "speaker", value: `${transcript.id}#${voice.label}` };
    const line = resolver.lineFor(ref);
    const entity = line === undefined ? undefined : resolver.entity(ref);
    if (line === undefined || entity === undefined || entity.type !== "person") {
      return voice.owner
        ? {
            ...voice,
            who: "owner",
            person: owner.id,
            personLabel: undefined,
            basis: "channel",
            consent: null,
            confidence: undefined,
          }
        : {
            ...voice,
            who: "nobody",
            person: undefined,
            personLabel: undefined,
            basis: null,
            consent: null,
            confidence: undefined,
          };
    }
    const p = line.payload;
    const basis = typeof p.basis === "string" ? p.basis : null;
    const given = typeof p.consent === "string" && CONSENT.has(p.consent) ? p.consent : undefined;
    const confidence =
      typeof p.confidence === "number" && Number.isFinite(p.confidence) ? p.confidence : undefined;
    const isOwner =
      owner.ids.has(entity.id) ||
      (entity.label !== undefined && owner.names.has(entity.label.toLowerCase()));
    if (isOwner) {
      return {
        ...voice,
        who: "owner",
        person: entity.id,
        personLabel: undefined,
        basis,
        consent: given ?? null,
        confidence,
      };
    }
    // A voice said to be the same as an unnamed one (`alias_of`) is that unnamed person (RFC 0038
    // §3.2): unnamed when its own line or the one the walk ends on says so.
    const unnamed = p.unnamed === true || resolver.mintingLine(ref)?.payload.unnamed === true;
    return {
      ...voice,
      who: unnamed ? "unnamed" : "person",
      person: entity.id,
      // The person's name as `people` gives it, the first label given them, whichever ref gave it.
      personLabel: personName(resolver, entity.id) ?? entity.label,
      basis,
      consent: given ?? "unknown",
      confidence,
    };
  });
}

/** A bound voice as the reference's `day --json` gives it, under a transcript's `speakers`. */
export function boundSpeakerJson(v: BoundVoice): SpeakerJson {
  return {
    label: v.label,
    person: v.who === "unnamed" || v.who === "nobody" ? null : (v.person ?? null),
    name: v.who === "person" ? (v.personLabel ?? null) : v.who === "nobody" ? v.name : null,
    seconds: v.seconds,
    basis: v.basis,
    consent: v.consent,
    owner: v.who === "owner",
  };
}

/**
 * Who spoke most first, by the seconds each spoke, a voice with no length after them in the line's
 * order: the order the reference names voices in since its #394 (a6ee131 to ef4d72e, run), which
 * sets no length beside a name.
 */
function bySpeaking<T extends { seconds: number | null }>(voices: readonly T[]): T[] {
  return voices
    .map((v, i) => ({ v, i }))
    .sort(
      (a, b) =>
        (a.v.seconds === null ? 1 : 0) - (b.v.seconds === null ? 1 : 0) ||
        (b.v.seconds ?? 0) - (a.v.seconds ?? 0) ||
        a.i - b.i,
    )
    .map(({ v }) => v);
}

/**
 * ` · Kari Nordmann · you and 1 unnamed · recorded with consent: unknown`, after a transcript's row
 * of the Day, from its `speakers`, as the reference prints it since its #394: who spoke most first,
 * no length beside a name; the owner's voice is `you`, a person's their name (the label when the
 * person has none), an unnamed voice is counted, never named, the count joined to the last name,
 * and a voice not yet named is the name the source displayed or its label. The consent is said when
 * a voice that is not the owner's was bound with a consent other than `yes`: `no` when any says no.
 */
export function boundVoicesSuffix(speakers: readonly SpeakerJson[]): string {
  let unnamed = 0;
  const shown: string[] = [];
  const consents = new Set<string>();
  for (const s of bySpeaking(speakers)) {
    if (!s.owner && s.consent !== null) consents.add(s.consent);
    // An unnamed voice: a line binds it (so it has a consent, `unknown` at least) and names nobody.
    if (!s.owner && s.person === null && s.consent !== null) {
      unnamed += 1;
      continue;
    }
    shown.push(s.owner ? "you" : (s.name ?? s.label));
  }
  if (unnamed > 0) {
    if (shown.length > 0) shown.push(`${shown.pop()} and ${unnamed} unnamed`);
    else shown.push(`${unnamed} unnamed`);
  }
  const consent = consents.has("no") ? "no" : consents.has("unknown") ? "unknown" : undefined;
  if (consent !== undefined) shown.push(`recorded with consent: ${consent}`);
  return shown.map((t) => ` · ${t}`).join("");
}

/** A label as RFC 0038 §2.4 has it: 1 to 64 characters, no `#`, no line break. */
const LABEL = /^[^#\n]{1,64}$/u;

const isObject = (v: JsonValue | undefined): v is { [key: string]: JsonValue } =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Python's `str.strip()` emptiness: a name of only whitespace, as Python's `isspace` has it, is no name. */
const PY_SPACE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the separators Python counts as whitespace
  /[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/gu;
const blank = (s: string): boolean => s.replace(PY_SPACE, "") === "";

/** The voices of a transcript's payload that a reader can read, in the line's order. */
export function voicesOf(p: Payload): Voice[] {
  const speakers = p.speakers;
  if (!Array.isArray(speakers)) return [];
  const voices: Voice[] = [];
  for (const item of speakers) {
    if (!isObject(item)) continue;
    const label = item.label;
    if (typeof label !== "string" || !LABEL.test(label)) continue;
    const seconds = item.seconds;
    const name = item.name;
    voices.push({
      label,
      // A number too large for a double (JSON.parse's Infinity) is none: the reference raises.
      seconds:
        typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0 ? seconds : null,
      name: typeof name === "string" && !blank(name) ? name : null,
      owner: item.from_me === true,
      channel: typeof item.channel === "string" ? item.channel : null,
    });
  }
  return voices;
}

/**
 * A whole number of a length, as Python's `{:.0f}` prints it: rounded half to even, every digit
 * written out however large, and `-0` kept.
 */
export function wholeNumber(x: number): string {
  const r = Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x);
  if (Object.is(r, -0)) return "-0";
  // Past 2^53 a double's shortest spelling pads with zeros; Python prints its exact digits.
  return Number.isSafeInteger(r) ? String(r) : BigInt(r).toString();
}

/** A length as the reference spells it: a minute or more in minutes, else in seconds. */
export function lengthText(seconds: number): string {
  return seconds >= 60 ? `${wholeNumber(seconds / 60)} min` : `${wholeNumber(seconds)} s`;
}

/** How a voice is shown: `you`, the source's name, or the label; then its length when known. */
export function voiceText(voice: Pick<Voice, "label" | "seconds" | "name" | "owner">): string {
  const shown = voice.owner ? "you" : (voice.name ?? voice.label);
  return voice.seconds === null ? shown : `${shown} ${lengthText(voice.seconds)}`;
}

/**
 * ` · you · Ola Nordmann`, appended to a transcript's row; empty without voices. Who spoke most first
 * and no length beside a name, as the reference prints it since its #394.
 */
export function voicesSuffix(
  voices: ReadonlyArray<Pick<Voice, "label" | "seconds" | "name" | "owner">>,
): string {
  return bySpeaking(voices)
    .map((v) => ` · ${v.owner ? "you" : (v.name ?? v.label)}`)
    .join("");
}

/**
 * The voices as the source gave them, in `day --json`'s shape with nobody bound: what the Day gave
 * before RFC 0038 §3, and what it gives of a record whose lines bind no voice but for the owner's
 * (the Day itself now reads `bindVoices`). Undefined when the line has none a reader can read.
 */
export function speakersJson(p: Payload): SpeakerJson[] | undefined {
  const voices = voicesOf(p);
  if (voices.length === 0) return undefined;
  return voices.map((v) => ({
    label: v.label,
    person: null,
    name: v.name,
    seconds: v.seconds,
    basis: v.owner ? "channel" : null,
    consent: null,
    owner: v.owner,
  }));
}
