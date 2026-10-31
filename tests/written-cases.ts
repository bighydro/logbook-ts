/**
 * A record for the lines the reference's own writers add since its main of 22 October: `review
 * receipts --accept` (a tier-3 `transaction/v1`, source `receipts`, `extra.from` the mail) and
 * `--reject` (a tier-3 `receipt-review/v1` labelled `not-a-payment`; its #406's road, RFC 0043 §12),
 * `add gift` given and received (a `note/v1` labelled `gift`, `extra.recipient` or `extra.giver`; its
 * #353) and `export --day` (a `crossing/v1` to the destination `folder`; its #429). The lines here
 * are a Friday in Oslo the reference then writes on: three people named at tiers 1, 2 and 3, each
 * at a meeting and in a mail, and two receipt mails. Nothing in it is real. tests/cross-impl.test.ts
 * has the reference write, then holds both implementations' readers alike on the record.
 */

import type { Draft } from "./helpers.js";

export const DAY = "2026-03-20";

const person = (letter: string, label: string, tier: 1 | 2 | 3): Draft => ({
  at: "2026-03-20T07:00:00Z",
  source: "manual",
  kind: "resolution",
  tier,
  payload: {
    schema: "resolution/v1",
    ref: { kind: "email", value: `${letter}@example.org` },
    entity: {
      type: "person",
      id: `00000000-0000-4000-8000-0000000000${letter}1`,
      registry: "logbook",
    },
    label,
    method: "manual",
  },
});

const receipt = (at: string, raw: string, from: string, subject: string): Draft => ({
  at,
  source: "mail",
  kind: "mail",
  tier: 2,
  payload: {
    schema: "mail/v1",
    raw_id: raw,
    thread: raw,
    direction: "received",
    from: { email: from },
    subject,
    size: 100,
  },
});

/** The record, in seq order: the phone at home all day, the people, their meetings and mail, two receipts. */
export function writtenRecord(): Draft[] {
  const lines: Draft[] = [];
  for (let m = 8 * 60; m < 20 * 60; m += 20) {
    const at = `2026-03-20T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00Z`;
    lines.push({
      at,
      source: "sim-phone",
      kind: "location",
      tier: 1,
      payload: { schema: "location/v1", lat: 59.9139, lon: 10.7522, accuracy_m: 10 },
    });
  }
  lines.push(
    person("a", "Ola Nordmann", 1),
    person("b", "Kari Nordmann", 2),
    person("c", "Per Nordmann", 3),
  );
  ["a", "b", "c"].forEach((letter, i) => {
    lines.push({
      at: `2026-03-20T1${i}:00:00Z`,
      end: `2026-03-20T1${i}:30:00Z`,
      source: "sim-cal",
      kind: "event",
      tier: 1,
      payload: {
        schema: "event/v1",
        raw_id: letter,
        title: `Meet ${letter}`,
        attendees: [{ ref: { kind: "email", value: `${letter}@example.org` } }],
      },
    });
    lines.push({
      at: `2026-03-20T1${i}:05:00Z`,
      source: "mail",
      kind: "mail",
      tier: 2,
      payload: {
        schema: "mail/v1",
        raw_id: `m${letter}`,
        thread: `t${letter}`,
        direction: "received",
        from: { email: `${letter}@example.org` },
        subject: "Hei",
        size: 100,
      },
    });
  });
  lines.push(
    receipt(
      "2026-03-20T15:00:00Z",
      "r1",
      "orders@chartroom.example.org",
      "Your order receipt: NOK 1 840",
    ),
    receipt(
      "2026-03-20T15:10:00Z",
      "r2",
      "no-reply@sailshop.example.org",
      "Receipt for your order, total EUR 12.90",
    ),
  );
  return lines;
}
