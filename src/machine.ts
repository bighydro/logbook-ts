/**
 * The machine mark (the reference's docs/adapters/agents.md, *The machine mark*): an agent's words in
 * the record, marked in the slots the two frozen profiles leave for a source's own fields, so that no
 * reader takes the agent for a person. The reference's Telegram and Claude adapters write it, and since
 * its #396 its Beeper adapters for the senders `policy/agents.json` names; the readers read the mark on
 * the line, never that file.
 *
 * - `message/v1`, `extra.machine: true`: the agent wrote this line.
 * - `message/v1`, `extra.counterpart: {kind: "agent", …}`: the line belongs to a conversation with an
 *   agent, whoever wrote it, the owner's lines in it too.
 * - `transcript/v1`, a participant `{…, machine: true}`: that participant is an agent.
 *
 * Only the literal `true`, and only a counterpart of kind `agent`, marks anything; a line without the
 * mark reads as it always did. `people` counts no marked message for anyone and no marked participant,
 * and the Day's company never names a marked participant, as the reference reads them at d053f78 (run).
 */

import type { JsonValue, Payload } from "./types.js";

const isObject = (v: JsonValue | undefined): v is { [key: string]: JsonValue } =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Whether a message is machine text: an agent wrote it, or it is of a conversation with an agent. */
export function isMachineLine(p: Payload): boolean {
  const extra = p.extra;
  if (!isObject(extra)) return false;
  if (extra.machine === true) return true;
  const counterpart = extra.counterpart;
  return isObject(counterpart) && counterpart.kind === "agent";
}

/** Whether a transcript's participant is an agent. */
export const isMachineParticipant = (participant: { [key: string]: JsonValue }): boolean =>
  participant.machine === true;
