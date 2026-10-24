/**
 * The machine mark (the reference's docs/adapters/agents.md, *The machine mark*; its Beeper adapters
 * write it since #396): an agent's words are marked on the line, and no reader takes the agent for a
 * person. A synthetic record of Ines Nordmann's Saturday, 13 June 2026, in Oslo: a bot of hers
 * bridged by Beeper, one-on-one and in a group, a bot through Telegram's export, an assistant among a
 * call's participants, and the lines beside them that carry a mark that is not the literal one. The
 * owner's handles and the people are bound by resolution lines, so that a reader that did not pass the
 * agent over would name it. tests/machine.test.ts and tests/cross-impl.test.ts read it.
 */

import type { Draft } from "./helpers.js";

/** The id `writeRecord` gives the line of this seq. */
export const lineId = (seq: number): string =>
  `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;

export const DAY = "2026-06-13";
export const BOT = "@telegram_900000001:beeper.local";
const OLA = "4f8c85f9-0e6a-56f0-a9db-0d09bfdd3d02";
const KARI = "4f8c85f9-0e6a-56f0-a9db-0d09bfdd3d03";
const FYR = "4f8c85f9-0e6a-56f0-a9db-0d09bfdd3d01";
const ASSISTANT = "4f8c85f9-0e6a-56f0-a9db-0d09bfdd3d04";
const TELEGRAM_BOT = "4f8c85f9-0e6a-56f0-a9db-0d09bfdd3d05";

function resolution(kind: string, value: string, label: string, id: string): Draft {
  return {
    at: "2026-06-12T06:00:00Z",
    source: "manual",
    kind: "resolution",
    payload: {
      schema: "resolution/v1",
      entity: { id, registry: "logbook", type: "person" },
      label,
      method: "owner",
      ref: { kind, value },
    },
  };
}

const location = (at: string): Draft => ({
  at,
  source: "sim-phone",
  kind: "location",
  tier: 1,
  payload: { schema: "location/v1", lat: 59.911, lon: 10.75, accuracy_m: 12 },
});

const agent = { kind: "agent", ref: { kind: "handle", value: BOT }, name: "Fyr" };

function message(
  at: string,
  rawId: string,
  chat: { id: string; name: string; type: string },
  from: { kind: string; value: string; name: string } | "me",
  text: string,
  extra: Record<string, unknown>,
  source = "beeper-telegram",
): Draft {
  return {
    at,
    source,
    kind: "message",
    payload: {
      schema: "message/v1",
      raw_id: rawId,
      chat,
      from_me: from === "me",
      ...(from === "me" ? {} : { sender: from }),
      text,
      extra,
    },
  };
}

const fyr = { kind: "handle", value: BOT, name: "Fyr" };
const ola = { kind: "handle", value: "@telegram_12345:beeper.local", name: "Ola Nordmann" };
const kari = { kind: "handle", value: "@kari:beeper.local", name: "Kari Moe" };
const withFyr = { id: "!r1:beeper.local", name: "Fyr", type: "direct" };
const club = { id: "!g1:beeper.local", name: "Sailing club", type: "group" };
const withKari = { id: "!r2:beeper.local", name: "Kari Moe", type: "direct" };

/** The record, in seq order. */
export function machineRecord(): Draft[] {
  return [
    resolution("handle", BOT, "Fyr", FYR),
    resolution("handle", ola.value, "Ola Nordmann", OLA),
    resolution("handle", kari.value, "Kari Moe", KARI),
    resolution("email", "ola@example.org", "Ola Nordmann", OLA),
    resolution("email", "assistant@example.org", "Assistant", ASSISTANT),
    resolution("email", "kari@example.org", "Kari Moe", KARI),
    resolution("provider_id", "telegram:900000002", "Logbot", TELEGRAM_BOT),
    location("2026-06-13T05:30:00Z"),
    location("2026-06-13T20:30:00Z"),
    // A one-on-one chat with the bot: the owner's line and the bot's, both of the conversation.
    message("2026-06-13T09:00:00Z", "b1", withFyr, "me", "Remind me about the mooring on Friday", {
      counterpart: agent,
      sender_id: "@me:beeper.com",
    }),
    message("2026-06-13T09:01:00Z", "b2", withFyr, fyr, "I'll have it ready by Friday", {
      counterpart: agent,
      machine: true,
      sender_id: BOT,
    }),
    // A group the bot is in: its own lines marked, the people's as they are.
    message("2026-06-13T10:00:00Z", "b3", club, fyr, "Wind 12 knots", {
      machine: true,
      sender_id: BOT,
    }),
    message("2026-06-13T10:05:00Z", "b4", club, ola, "See you at the pontoon", {
      sender_id: ola.value,
    }),
    // Only the literal `true` marks anything, and only a counterpart of kind `agent`.
    message("2026-06-13T11:00:00Z", "b5", withKari, kari, "Lunch?", {
      machine: "true",
      counterpart: { kind: "person", ref: { kind: "handle", value: kari.value } },
    }),
    message("2026-06-13T11:05:00Z", "b6", club, ola, "Bring the fenders", { machine: 1 }),
    // A bot through Telegram's own export, the chat and the bot's line marked.
    message(
      "2026-06-13T12:00:00Z",
      "t1",
      { id: "telegram:900000002", name: "Logbot", type: "direct" },
      { kind: "provider_id", value: "telegram:900000002", name: "Logbot" },
      "Logged.",
      {
        counterpart: {
          kind: "agent",
          ref: { kind: "provider_id", value: "telegram:900000002" },
          username: "logbot",
        },
        machine: true,
      },
      "telegram",
    ),
    // A call with an assistant among its participants: Ola is company, the assistant never.
    {
      at: "2026-06-13T13:00:00Z",
      end: "2026-06-13T13:30:00Z",
      source: "granola",
      kind: "transcript",
      payload: {
        schema: "transcript/v1",
        raw_id: "t-1",
        provider: "granola",
        title: "Planning",
        participants: [
          { email: "ola@example.org", name: "Ola Nordmann" },
          { name: "assistant", machine: true, email: "assistant@example.org" },
        ],
      },
    },
    // A participant whose mark is not the literal `true` is a participant.
    {
      at: "2026-06-13T15:00:00Z",
      end: "2026-06-13T15:20:00Z",
      source: "granola",
      kind: "transcript",
      payload: {
        schema: "transcript/v1",
        raw_id: "t-2",
        provider: "granola",
        title: "Debrief",
        participants: [{ name: "Kari Moe", machine: "yes", email: "kari@example.org" }],
      },
    },
  ];
}

/** `logbook people` of the reference at d053f78 on the record (run; never edited by hand). */
export const EXPECTED_PEOPLE = [
  "2 people · 2026-06-12 – 2026-06-13 · tier 2",
  "  Kari Moe      messages 1 · transcripts 1 · 1 day · 1 night · last real contact 2026-06-13 (meeting) · 59.9110,10.7500",
  "  Ola Nordmann  messages 2 · transcripts 1 · 1 day · 1 night · last real contact 2026-06-13 (meeting) · 59.9110,10.7500",
  "",
].join("\n");

/** The company of the day's one stay in `logbook day 2026-06-13` of the reference at d053f78 (run). */
export const EXPECTED_WITH = "      with         Ola Nordmann (transcript), Kari Moe (transcript)";
