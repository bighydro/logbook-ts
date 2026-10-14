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
 */

import { LogbookError } from "./store.js";

/** Every flag this implementation knows. */
export const FLAGS = ["rfc0036"] as const;
export type Flag = (typeof FLAGS)[number];
/** RFC 0036: goals, reviews, drafts and chapters; `day_start`; `signed_within_days`. */
export const RFC0036: Flag = "rfc0036";
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
