/**
 * The draft features this implementation carries behind a name, off until their RFC is Final. An RFC
 * becomes final only once two implementations agree on it (RFC 0031's process), so a draft is read
 * here to be compared with the reference, never by default: every behaviour a flag gates is the
 * behaviour of a reader or of the CLI, and with the flag off they read the record as they did before.
 *
 * `LOGBOOK_TS_FLAGS` names the flags that are on, separated by commas or spaces:
 *
 *     LOGBOOK_TS_FLAGS=rfc0036 logbook-ts show <root> --day 2026-06-14
 *
 * `rfc0036` (RFC 0036, draft, 2026-10-13, and its amendment 1, open): the `draft/v1` and `chapter/v1`
 * rows of `show`; `day_start` in `logbook.json`, refused by every reader that groups lines by day
 * when it is not a clock or not midnight (`dayStart.ts`); `signed_within_days` on an entry of
 * `policy/crossing.json`, read and checked (`policy.ts`). The profile functions of `goals.ts`,
 * `drafts.ts` and `chapters.ts` read and check a line wherever a caller holds one, as `signing.ts`
 * does for RFC 0034; their names and shapes may change while the RFC is a draft.
 *
 * `rfc0037` (RFC 0037, *Entities*, draft, 2026-10-13, decided 2026-10-14): `status list KIND`, every
 * canonical org, idea, place or asset with its current `status/v1` line, as the reference's
 * `logbook status list` prints it, and `policy/entities.json` read and checked for it. The profile
 * functions of `entities.ts` (`entity/v1`, `entity-review/v1`, `status/v1`: their validation, their
 * tiers, the standing lines) read a line wherever a caller holds one, flag or not; `show` and the Day
 * print these lines as they print any other, as the reference does, so nothing else changes.
 *
 * `rfc0038` (RFC 0038 §2, *Speakers*, draft, and RFC 0004's dated amendment of 2026-10-14): a
 * transcript's voices (`speakers`, `diarization`) where `show` and the Day print a transcript, and a
 * transcript another transcript `supersedes` (a recording heard again) marked in `show` and left out
 * of the Day, as the reference prints them. A transcript without the fields reads as before either way.
 * Since the reference's 0.7.0, RFC 0038 §3 too: a voice bound to a person by a `speaker` ref, in the
 * Day, its company and `people`.
 *
 * `rfc0040` (RFC 0040, *Videos*, draft, 2026-10-14): `show`'s row of a `scene-review/v1` line, the
 * owner's no on a scene (`scene 2:10–2:50 ≠ Hjem`), and ` superseded by #N` on a no a later no
 * replaces, as the reference prints them. `video/v1` and `attribution/v1` are not read here: `show`
 * prints them as any kind it does not know.
 *
 * `rfc0041` (RFC 0041, `star/v1`, draft, 2026-10-14): `show`'s row of a star (`★ event 019cadd3… ·
 * <note>`), the Day's ★ on each starred line it lists and its `stars` under `--json`, as the
 * reference prints them.
 *
 * `rfc0046` (RFC 0046, *What you heard*, `heard/v1`, draft, 2026-10-21): `show`'s row of the words of
 * an episode or a video the owner played (`Anchors that hold — The Harbour Hour · feed · en · 700
 * words`), as the reference prints it. Nothing else reads the line here.
 */

import { LogbookError } from "./store.js";

/** Every flag this implementation knows. */
export const FLAGS = ["rfc0036", "rfc0037", "rfc0038", "rfc0040", "rfc0041", "rfc0046"] as const;
export type Flag = (typeof FLAGS)[number];
/** RFC 0036: goals, reviews, drafts and chapters; `day_start`; `signed_within_days`. */
export const RFC0036: Flag = "rfc0036";
/** RFC 0037: entities; `status list`. */
export const RFC0037: Flag = "rfc0037";
/** RFC 0038 §2: a transcript's voices in `show` and the Day; a transcript heard again. */
export const RFC0038: Flag = "rfc0038";
/** RFC 0040: the owner's no on a scene, `scene-review/v1`, in `show`. */
export const RFC0040: Flag = "rfc0040";
/** RFC 0041: stars, `star/v1`, in `show` and the Day. */
export const RFC0041: Flag = "rfc0041";
/** RFC 0046: what the owner heard, `heard/v1`, in `show`. */
export const RFC0046: Flag = "rfc0046";
/** The environment variable that turns flags on. */
export const FLAGS_ENV = "LOGBOOK_TS_FLAGS";

/** `LOGBOOK_TS_FLAGS` names a flag this implementation does not know. */
export class FlagError extends LogbookError {
  override readonly name = "FlagError";
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The flags `LOGBOOK_TS_FLAGS` turns on; none when it is unset or empty. A name this implementation
 * does not know is refused, so a typo is never read as a flag left off.
 */
export function flagsOn(env: Env = process.env): Set<Flag> {
  const on = new Set<Flag>();
  for (const name of (env[FLAGS_ENV] ?? "").split(/[\s,]+/)) {
    if (name === "") continue;
    if (!(FLAGS as readonly string[]).includes(name)) {
      throw new FlagError(
        `${FLAGS_ENV} names ${name}, which is not a flag of this implementation; the flags are ${FLAGS.join(", ")}`,
      );
    }
    on.add(name as Flag);
  }
  return on;
}

/** Whether `flag` is on: named by `LOGBOOK_TS_FLAGS` in `env`, the process's environment by default. */
export const isOn = (flag: Flag, env: Env = process.env): boolean => flagsOn(env).has(flag);
