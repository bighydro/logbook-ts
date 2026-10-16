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
 * as before. Nothing binds a label to a person yet (RFC 0038 §3 is not built in the reference): a
 * voice is shown as `you` when the source says the channel is the owner's own microphone
 * (`from_me: true`), else as the name the source displayed, else as its label.
 */

import type { JsonValue, Payload } from "./types.js";

/** One voice as the reader reads it. */
export interface Voice {
  label: string;
  /** How long the voice speaks; null when the line gives no number of seconds that is 0 or more. */
  seconds: number | null;
  /** A name the source displayed for the voice, never a resolution; null when none or blank. */
  name: string | null;
  /** `from_me: true`: the source says it is the owner's own microphone. */
  owner: boolean;
}

/** One voice as the reference's `day --json` gives it, under a transcript's `speakers`. */
export interface SpeakerJson {
  label: string;
  /** Who the voice is: null until a resolution binds it (RFC 0038 §3, not built). */
  person: null;
  name: string | null;
  seconds: number | null;
  /** `channel` for the owner's voice, which the source's channel says is theirs; else null. */
  basis: "channel" | null;
  consent: null;
  owner: boolean;
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

/** ` · you 3 min · Ola Nordmann 3 min`, appended to a transcript's row; empty without voices. */
export function voicesSuffix(
  voices: ReadonlyArray<Pick<Voice, "label" | "seconds" | "name" | "owner">>,
): string {
  return voices.map((v) => ` · ${voiceText(v)}`).join("");
}

/** The voices as `day --json` gives them; undefined when the line has none a reader can read. */
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
