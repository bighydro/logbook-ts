/**
 * `social/v1` (RFC 0048, draft, 2026-10-30): one act between the owner and an account on a social
 * network. `show` prints its row in words since the reference's #440 (`followed by @ola.example`).
 * `SOCIAL_CASES` are payloads of the RFC's example line with fields changed, and `expected` is the row
 * the reference's `show` prints for each at its tag v1.2.0 (55c6fbd), captured by running it on a
 * record of them (each line at its own minute of 16 May 2026, Oslo), never edited by hand. The
 * accounts are made up; nothing in it is real.
 */

import type { Draft } from "./helpers.js";

export const DAY = "2026-05-16";

const handle = (value: unknown) => ({ kind: "handle", value });
const OLA = handle("instagram:ola.example");

/** The RFC's example payload (rfcs/0048-social-v1.md, *Example*), less what each case sets. */
const BASE: Record<string, unknown> = {
  schema: "social/v1",
  raw_id: "followed_by:1778025600:99b384026587ee43",
  network: "instagram",
  extra: { list: "followers" },
};

/** A case: its name, the payload's fields (undefined removes one) and the row the reference prints. */
export const SOCIAL_CASES: Array<[string, Record<string, unknown>, string]> = [
  ["follow", { action: "follow", counterpart: OLA }, "followed @ola.example"],
  ["followed_by", { action: "followed_by", counterpart: OLA }, "followed by @ola.example"],
  [
    "close_friend",
    { action: "close_friend", counterpart: OLA },
    "added to close friends: @ola.example",
  ],
  ["block", { action: "block", counterpart: OLA }, "blocked @ola.example"],
  ["restrict", { action: "restrict", counterpart: OLA }, "restricted @ola.example"],
  [
    "follow_request_sent",
    { action: "follow_request_sent", counterpart: OLA },
    "asked to follow @ola.example",
  ],
  [
    "follow_request_received",
    { action: "follow_request_received", counterpart: OLA },
    "a follow request from @ola.example",
  ],
  ["unfollow", { action: "unfollow", counterpart: OLA }, "unfollowed @ola.example"],
  ["like", { action: "like", counterpart: OLA }, "liked a post by @ola.example"],
  ["comment", { action: "comment", counterpart: OLA }, "commented on a post by @ola.example"],
  ["story_like", { action: "story_like", counterpart: OLA }, "liked a story by @ola.example"],
  ["search", { action: "search", counterpart: OLA }, "searched for @ola.example"],
  ["follow alone", { action: "follow" }, "followed"],
  ["followed_by alone", { action: "followed_by" }, "followed"],
  ["close_friend alone", { action: "close_friend" }, "added to close friends"],
  ["block alone", { action: "block" }, "blocked"],
  ["restrict alone", { action: "restrict" }, "restricted"],
  ["follow_request_sent alone", { action: "follow_request_sent" }, "asked to follow"],
  ["follow_request_received alone", { action: "follow_request_received" }, "a follow request from"],
  ["unfollow alone", { action: "unfollow" }, "unfollowed"],
  ["like alone", { action: "like" }, "liked a post"],
  ["comment alone", { action: "comment" }, "commented on a post"],
  ["story_like alone", { action: "story_like" }, "liked a story"],
  ["search alone", { action: "search" }, "searched"],
  [
    "comment text",
    { action: "comment", counterpart: OLA, text: "Så fint! 😍" },
    "commented on a post by @ola.example: Så fint! 😍",
  ],
  [
    "text on a like",
    { action: "like", counterpart: OLA, text: "text on a like" },
    "liked a post by @ola.example: text on a like",
  ],
  [
    "text whitespace",
    { action: "comment", counterpart: OLA, text: "a  b\t c d e" },
    "commented on a post by @ola.example: a b c d e",
  ],
  [
    "text two lines",
    { action: "comment", counterpart: OLA, text: "line one\nline two" },
    "commented on a post by @ola.example: line one line two",
  ],
  [
    "text padded",
    { action: "comment", counterpart: OLA, text: "  padded  " },
    "commented on a post by @ola.example: padded",
  ],
  [
    "text long",
    { action: "comment", counterpart: OLA, text: "x".repeat(150) },
    `commented on a post by @ola.example: ${"x".repeat(150)}`,
  ],
  [
    "text empty",
    { action: "comment", counterpart: OLA, text: "" },
    "commented on a post by @ola.example",
  ],
  [
    "text blank",
    { action: "comment", counterpart: OLA, text: "   " },
    "commented on a post by @ola.example",
  ],
  [
    "text number",
    { action: "comment", counterpart: OLA, text: 42 },
    "commented on a post by @ola.example",
  ],
  [
    "text list",
    { action: "comment", counterpart: OLA, text: ["a"] },
    "commented on a post by @ola.example",
  ],
  ["text, no one", { action: "comment", text: "no one" }, "commented on a post: no one"],
  ["action unknown", { action: "poke", counterpart: OLA }, "poke @ola.example"],
  ["action unknown alone", { action: "poke" }, "poke"],
  ["action absent", { counterpart: OLA }, "an act @ola.example"],
  ["action absent, text", { counterpart: OLA, text: "hi" }, "an act @ola.example: hi"],
  ["action empty", { action: "", counterpart: OLA }, "an act @ola.example"],
  ["action null", { action: null, counterpart: OLA }, "an act @ola.example"],
  ["action true", { action: true, counterpart: OLA }, "True @ola.example"],
  ["action number", { action: 7, counterpart: OLA }, "7 @ola.example"],
  ["action float", { action: 1.5, counterpart: OLA }, "1.5 @ola.example"],
  ["action upper", { action: "FOLLOW", counterpart: OLA }, "FOLLOW @ola.example"],
  ["action padded", { action: "  follow  ", counterpart: OLA }, "  follow   @ola.example"],
  ["url alone", { action: "follow", url: "https://www.instagram.com/x" }, "followed"],
  [
    "kind email",
    { action: "follow", counterpart: { kind: "email", value: "ola@example.org" } },
    "followed @ola@example.org",
  ],
  [
    "kind absent",
    { action: "follow", counterpart: { value: "instagram:ola.example" } },
    "followed @ola.example",
  ],
  ["no prefix", { action: "follow", counterpart: handle("ola.example") }, "followed @ola.example"],
  [
    "other network",
    { action: "follow", network: "mastodon", counterpart: handle("mastodon:ola@example.social") },
    "followed @ola@example.social",
  ],
  [
    "another network's prefix",
    { action: "follow", counterpart: handle("tiktok:ola.example") },
    "followed @tiktok:ola.example",
  ],
  [
    "handle case",
    { action: "follow", counterpart: handle("instagram:Ola.Example") },
    "followed @Ola.Example",
  ],
  [
    "prefix case",
    { action: "follow", counterpart: handle("Instagram:ola.example") },
    "followed @Instagram:ola.example",
  ],
  [
    "network case",
    { action: "follow", counterpart: OLA, network: "Instagram" },
    "followed @instagram:ola.example",
  ],
  [
    "network empty",
    { action: "follow", counterpart: OLA, network: "" },
    "followed @instagram:ola.example",
  ],
  [
    "network number",
    { action: "follow", counterpart: OLA, network: 3 },
    "followed @instagram:ola.example",
  ],
  [
    "prefix twice",
    { action: "follow", counterpart: handle("instagram:instagram:ola.example") },
    "followed @instagram:ola.example",
  ],
  [
    "handle padded",
    { action: "follow", counterpart: handle("  instagram:ola.example  ") },
    "followed @ola.example",
  ],
  ["prefix alone", { action: "follow", counterpart: handle("instagram:") }, "followed @"],
  ["handle empty", { action: "follow", counterpart: handle("") }, "followed"],
  ["handle number", { action: "follow", counterpart: handle(5) }, "followed"],
  ["counterpart a string", { action: "follow", counterpart: "instagram:ola.example" }, "followed"],
];

/** The case's payload. */
export function socialPayload(changes: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = { ...BASE };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete p[key];
    else p[key] = value;
  }
  return p;
}

const minute = (i: number): string =>
  `${DAY}T${String(6 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`;

/**
 * One line per case, a minute apart from 06:00Z, in the cases' order; then, beside them, a social
 * payload under another kind (`show` prints the kind's own row) and another schema under kind
 * `social` (printed as a kind it does not know), and a person the handle of the first case is
 * resolved to, whom no reader counts the acts for (RFC 0048 rule 5).
 */
export function socialLines(): Draft[] {
  const lines: Draft[] = SOCIAL_CASES.map(([, changes], i) => ({
    at: minute(i),
    source: "instagram",
    kind: "social",
    payload: socialPayload(changes),
  }));
  const at = SOCIAL_CASES.length;
  lines.push(
    {
      at: minute(at),
      source: "instagram",
      kind: "note",
      payload: socialPayload({ action: "follow", counterpart: OLA }),
    },
    {
      at: minute(at + 1),
      source: "instagram",
      kind: "social",
      payload: socialPayload({ schema: "social/v2", action: "follow", counterpart: OLA }),
    },
    {
      at: minute(at + 2),
      source: "manual",
      kind: "resolution",
      payload: {
        schema: "resolution/v1",
        ref: OLA,
        entity: { type: "person", id: "00000000-0000-4000-8000-000000000077", registry: "logbook" },
        label: "Ola Nordmann",
        method: "manual",
      },
    },
  );
  return lines;
}
