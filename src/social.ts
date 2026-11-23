/**
 * `social/v1` (RFC 0048, draft, 2026-10-30): one act between the owner and an account on a social
 * network, as the network's own export recorded it; the reference's `instagram` adapter writes it
 * since its #440. Read behind the `rfc0048` flag (`flags.ts`) as the reference's `show` prints it at
 * its tag v1.2.0, matched by running it on payloads (tests/social-cases.ts), never by reading it.
 *
 * - `socialRow`: `show`'s row, `followed by @ola.example`, `commented on a post by @ola.example: Så fint!`.
 *
 * Nothing here validates a line. A handle is an account, never a person (RFC 0048 rule 5): the Day,
 * `days` and `people` read a social line as company of no one, as they read any kind they do not
 * know, and as the reference's do.
 */

import { pySplit, pyStrip } from "./entities.js";
import { pyStr } from "./pyrepr.js";
import { truthy } from "./render.js";
import type { Payload } from "./types.js";

export const SOCIAL_KIND = "social";
export const SOCIAL_SCHEMA = "social/v1";

/** Each action RFC 0048 names: its words before the account, and its words when there is none. */
const ACTIONS: Record<string, [string, string]> = {
  follow: ["followed", "followed"],
  followed_by: ["followed by", "followed"],
  close_friend: ["added to close friends:", "added to close friends"],
  block: ["blocked", "blocked"],
  restrict: ["restricted", "restricted"],
  follow_request_sent: ["asked to follow", "asked to follow"],
  follow_request_received: ["a follow request from", "a follow request from"],
  unfollow: ["unfollowed", "unfollowed"],
  like: ["liked a post by", "liked a post"],
  comment: ["commented on a post by", "commented on a post"],
  story_like: ["liked a story by", "liked a story"],
  search: ["searched for", "searched"],
};

/**
 * The account as the reference prints it: the counterpart's `value` when it is a string, Python's
 * whitespace off its ends, then `<network>:` off its start once when `network` is a non-empty string
 * (case counts; a counterpart of any `kind` reads alike); undefined when there is no such value.
 */
function handleOf(p: Payload): string | undefined {
  const c = p.counterpart;
  if (c === null || typeof c !== "object" || Array.isArray(c)) return undefined;
  if (typeof c.value !== "string") return undefined;
  let value = pyStrip(c.value);
  if (value === "") return undefined;
  const network = p.network;
  if (typeof network === "string" && network !== "" && value.startsWith(`${network}:`))
    value = value.slice(network.length + 1);
  return value;
}

/**
 * The row `show` prints for a `social/v1` line, as the reference prints it at 55c6fbd: the action's
 * words and `@<account>` (`followed by @ola.example`), the words alone when there is no account
 * (`followed`); an action RFC 0048 does not name is Python's `str()` of it, `an act` when it is not
 * truthy; then `: <text>` when `text` is a string with a word in it, its whitespace runs one space.
 */
export function socialRow(p: Payload): string {
  const handle = handleOf(p);
  const known = typeof p.action === "string" ? ACTIONS[p.action] : undefined;
  let row: string;
  if (known !== undefined && Object.hasOwn(ACTIONS, p.action as string))
    row = handle === undefined ? known[1] : `${known[0]} @${handle}`;
  else {
    const word = truthy(p.action) ? pyStr(p.action) : "an act";
    row = handle === undefined ? word : `${word} @${handle}`;
  }
  const words = typeof p.text === "string" ? pySplit(p.text).join(" ") : "";
  return words === "" ? row : `${row}: ${words}`;
}
