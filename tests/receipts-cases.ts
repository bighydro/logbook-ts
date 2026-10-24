/**
 * A payment and its mailed receipt, counted once (the reference's #406, docs/receipts.md *When the
 * ledger delivers it later*, docs/ledger.md *The Day*): a `transaction/v1` line of source `receipts`
 * (what `review receipts --accept` writes) and a payment source's line of the same payment are one
 * payment on the Day, the source's, the receipt named as its evidence. Synthetic records of a person
 * in Oslo who does not exist, one per case. `expected` is the reference's Day on each named day at its
 * main of a6ee131: the `spend` row of `logbook day` and the `spend` of `logbook day --json`, captured
 * by running it on the record, never edited by hand; tests/receipts.test.ts holds this implementation
 * to them and tests/cross-impl.test.ts holds both to the reference itself.
 */

import type { Draft } from "./helpers.js";

/** The mail a receipt was read from (`extra.from`), a line these records do not hold. */
export const MAIL = "00000000-0000-4000-8000-000000000999";

function tx(
  at: string,
  source: string,
  amount: number,
  merchant: string | undefined,
  more: Record<string, unknown> = {},
  currency = "CHF",
): Draft {
  return {
    at,
    source,
    kind: "transaction",
    tier: 3,
    payload: {
      schema: "transaction/v1",
      raw_id: `${source}:${at}:${amount}`,
      amount,
      currency,
      ...(merchant === undefined ? {} : { merchant }),
      provider: source,
      ...(source === "receipts" ? { extra: { from: MAIL, confidence: 0.9 } } : {}),
      ...more,
    },
  };
}
/** A receipt `review receipts --accept` wrote. */
const R = (at: string, amount: number, merchant?: string, more = {}, currency = "CHF") =>
  tx(at, "receipts", amount, merchant, more, currency);
/** The owner's retraction of the line of this seq (`writeBareRecord` numbers lines from 1). */
const retract = (seq: number, at: string): Draft => ({
  at,
  source: "manual",
  kind: "retraction",
  payload: {
    schema: "retraction/v1",
    supersedes: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    seq,
    reason: "test",
  },
});
/** The payment as a payment source delivered it. */
const G = (at: string, amount: number, merchant?: string, more = {}, currency = "CHF") =>
  tx(at, "google-takeout", amount, merchant, more, currency);

export interface ReceiptCase {
  name: string;
  lines: Draft[];
  /** Per day: the Day's `spend` row as text (empty when it prints none) and its JSON. */
  expected: Record<string, { text: string; json: unknown }>;
}

const T = "2026-09-03T";
export const RECEIPT_CASES: ReceiptCase[] = [
  {
    name: "the receipt and the payment on one day",
    lines: [R(`${T}08:00:00Z`, -12.9, "Fjordkaffe"), G(`${T}10:00:00Z`, -12.9, "Fjordkaffe")],
    expected: {
      "2026-09-03": {
        text: "spend         CHF -12.90 · 1 transaction · 1 with its receipt · Fjordkaffe",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -12.9, received: 0, net: -12.9 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000002"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000001",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000002",
            },
          ],
        },
      },
    },
  },
  {
    name: "the payment the day after the receipt",
    lines: [
      R(`${T}08:00:00Z`, -12.9, "Fjordkaffe"),
      G("2026-09-04T10:00:00Z", -12.9, "Fjordkaffe"),
    ],
    expected: {
      "2026-09-03": { text: "", json: null },
      "2026-09-04": {
        text: "spend         CHF -12.90 · 1 transaction · 1 with its receipt · Fjordkaffe",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -12.9, received: 0, net: -12.9 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000002"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000001",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000002",
            },
          ],
        },
      },
    },
  },
  {
    name: "the payment the day before the receipt",
    lines: [
      G("2026-09-02T10:00:00Z", -12.9, "Fjordkaffe"),
      R(`${T}08:00:00Z`, -12.9, "Fjordkaffe"),
    ],
    expected: {
      "2026-09-02": {
        text: "spend         CHF -12.90 · 1 transaction · 1 with its receipt · Fjordkaffe",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -12.9, received: 0, net: -12.9 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000001"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000002",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000001",
            },
          ],
        },
      },
      "2026-09-03": { text: "", json: null },
    },
  },
  {
    name: "three days apart: two payments",
    lines: [
      R(`${T}08:00:00Z`, -12.9, "Fjordkaffe"),
      G("2026-09-06T10:00:00Z", -12.9, "Fjordkaffe"),
    ],
    expected: {
      "2026-09-03": {
        text: "spend         CHF -12.90 · 1 transaction · Fjordkaffe",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -12.9, received: 0, net: -12.9 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000001"],
        },
      },
      "2026-09-06": {
        text: "spend         CHF -12.90 · 1 transaction · Fjordkaffe",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -12.9, received: 0, net: -12.9 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000002"],
        },
      },
    },
  },
  {
    name: "48 hours apart to the second, and one second more",
    lines: [
      R(`${T}08:00:00Z`, -12.9, "Fjordkaffe"),
      G("2026-09-05T08:00:00Z", -12.9, "Fjordkaffe"),
      R("2026-09-10T08:00:00Z", -7, "Kiosk"),
      G("2026-09-12T08:00:01Z", -7, "Kiosk"),
    ],
    expected: {
      "2026-09-05": {
        text: "spend         CHF -12.90 · 1 transaction · 1 with its receipt · Fjordkaffe",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -12.9, received: 0, net: -12.9 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000002"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000001",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000002",
            },
          ],
        },
      },
      "2026-09-12": {
        text: "spend         CHF -7.00 · 1 transaction · Kiosk",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -7, received: 0, net: -7 } },
          merchants: ["Kiosk"],
          lines: ["00000000-0000-4000-8000-000000000004"],
        },
      },
    },
  },
  {
    name: "merchants alike once case, spaces and punctuation are gone, either containing the other",
    lines: [
      R(`${T}08:00:00Z`, -12.9, "Fjord-Kiosk!"),
      G(`${T}10:00:00Z`, -12.9, "FJORDKIOSK AS"),
      R("2026-09-10T08:00:00Z", -5, "Kaffe & Co."),
      G("2026-09-10T09:00:00Z", -5, "kaffeco"),
      R("2026-09-12T08:00:00Z", -6, "Fjordkaffe Oslo AS"),
      G("2026-09-12T09:00:00Z", -6, "Fjordkaffe"),
      R("2026-09-14T08:00:00Z", -4, "fjord_kaffe"),
      G("2026-09-14T09:00:00Z", -4, "FjordKaffe"),
    ],
    expected: {
      "2026-09-03": {
        text: "spend         CHF -12.90 · 1 transaction · 1 with its receipt · FJORDKIOSK AS",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -12.9, received: 0, net: -12.9 } },
          merchants: ["FJORDKIOSK AS"],
          lines: ["00000000-0000-4000-8000-000000000002"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000001",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000002",
            },
          ],
        },
      },
      "2026-09-10": {
        text: "spend         CHF -5.00 · 1 transaction · 1 with its receipt · kaffeco",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -5, received: 0, net: -5 } },
          merchants: ["kaffeco"],
          lines: ["00000000-0000-4000-8000-000000000004"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000003",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000004",
            },
          ],
        },
      },
      "2026-09-12": {
        text: "spend         CHF -6.00 · 1 transaction · 1 with its receipt · Fjordkaffe",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -6, received: 0, net: -6 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000006"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000005",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000006",
            },
          ],
        },
      },
      "2026-09-14": {
        text: "spend         CHF -4.00 · 1 transaction · 1 with its receipt · FjordKaffe",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -4, received: 0, net: -4 } },
          merchants: ["FjordKaffe"],
          lines: ["00000000-0000-4000-8000-000000000008"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000007",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000008",
            },
          ],
        },
      },
    },
  },
  {
    name: "letters beyond ASCII: Ø kept, ß case-folded, an accent kept",
    lines: [
      R(`${T}08:00:00Z`, -12.9, "Øl-bar"),
      G(`${T}10:00:00Z`, -12.9, "ØLBAR AS"),
      R("2026-09-10T08:00:00Z", -5, "Straße Café"),
      G("2026-09-10T09:00:00Z", -5, "STRASSECAFÉ"),
      R("2026-09-12T08:00:00Z", -6, "Café"),
      G("2026-09-12T09:00:00Z", -6, "CAFE OSLO"),
    ],
    expected: {
      "2026-09-03": {
        text: "spend         CHF -12.90 · 1 transaction · 1 with its receipt · ØLBAR AS",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -12.9, received: 0, net: -12.9 } },
          merchants: ["ØLBAR AS"],
          lines: ["00000000-0000-4000-8000-000000000002"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000001",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000002",
            },
          ],
        },
      },
      "2026-09-10": {
        text: "spend         CHF -5.00 · 1 transaction · 1 with its receipt · STRASSECAFÉ",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -5, received: 0, net: -5 } },
          merchants: ["STRASSECAFÉ"],
          lines: ["00000000-0000-4000-8000-000000000004"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000003",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000004",
            },
          ],
        },
      },
      "2026-09-12": {
        text: "spend         CHF -12.00 · 2 transactions · Café, CAFE OSLO",
        json: {
          count: 2,
          deleted: 0,
          totals: { CHF: { spent: -12, received: 0, net: -12 } },
          merchants: ["Café", "CAFE OSLO"],
          lines: ["00000000-0000-4000-8000-000000000005", "00000000-0000-4000-8000-000000000006"],
        },
      },
    },
  },
  {
    name: "no pair: another merchant, amount, sign or currency, a merchant of punctuation only, none at all",
    lines: [
      R(`${T}01:00:00Z`, -12.9, "Fjordkiosk"),
      G(`${T}01:10:00Z`, -12.9, "Havnekafe"),
      R(`${T}02:00:00Z`, -3, "A"),
      G(`${T}02:10:00Z`, -3.01, "A"),
      R(`${T}03:00:00Z`, 4, "B"),
      G(`${T}03:10:00Z`, -4, "B"),
      R(`${T}04:00:00Z`, -5, "C", {}, "EUR"),
      G(`${T}04:10:00Z`, -5, "C"),
      R(`${T}05:00:00Z`, -6, "!!!"),
      G(`${T}05:10:00Z`, -6, "Fjordkaffe"),
      R(`${T}06:00:00Z`, -7, "D"),
      G(`${T}06:10:00Z`, -7),
    ],
    expected: {
      "2026-09-03": {
        text: "spend         CHF -62.81 · EUR -5.00 · 12 transactions · Fjordkiosk, Havnekafe, A, B +4",
        json: {
          count: 12,
          deleted: 0,
          totals: {
            CHF: { spent: -66.81, received: 4, net: -62.81 },
            EUR: { spent: -5, received: 0, net: -5 },
          },
          merchants: ["Fjordkiosk", "Havnekafe", "A", "B", "C", "!!!", "Fjordkaffe", "D"],
          lines: [
            "00000000-0000-4000-8000-000000000001",
            "00000000-0000-4000-8000-000000000002",
            "00000000-0000-4000-8000-000000000003",
            "00000000-0000-4000-8000-000000000004",
            "00000000-0000-4000-8000-000000000005",
            "00000000-0000-4000-8000-000000000006",
            "00000000-0000-4000-8000-000000000007",
            "00000000-0000-4000-8000-000000000008",
            "00000000-0000-4000-8000-000000000009",
            "00000000-0000-4000-8000-000000000010",
            "00000000-0000-4000-8000-000000000011",
            "00000000-0000-4000-8000-000000000012",
          ],
        },
      },
    },
  },
  {
    name: "amounts alike to the cent",
    lines: [
      R(`${T}08:00:00Z`, -12.904, "Fjordkaffe"),
      G(`${T}10:00:00Z`, -12.896, "Fjordkaffe"),
      R("2026-09-10T08:00:00Z", -1840, "Kiosk", {}, "NOK"),
      G("2026-09-10T09:00:00Z", -1840.0, "Kiosk", {}, "NOK"),
    ],
    expected: {
      "2026-09-03": {
        text: "spend         CHF -12.90 · 1 transaction · 1 with its receipt · Fjordkaffe",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -12.9, received: 0, net: -12.9 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000002"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000001",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000002",
            },
          ],
        },
      },
      "2026-09-10": {
        text: "spend         NOK -1,840.00 · 1 transaction · 1 with its receipt · Kiosk",
        json: {
          count: 1,
          deleted: 0,
          totals: { NOK: { spent: -1840, received: 0, net: -1840 } },
          merchants: ["Kiosk"],
          lines: ["00000000-0000-4000-8000-000000000004"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000003",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000004",
            },
          ],
        },
      },
    },
  },
  {
    name: "one source line holds one receipt, the nearest; a tie to the earlier",
    lines: [
      R(`${T}08:00:00Z`, -12.9, "Fjordkaffe"),
      R(`${T}11:00:00Z`, -12.9, "Fjordkaffe"),
      G(`${T}10:30:00Z`, -12.9, "Fjordkaffe"),
      R("2026-09-10T09:00:00Z", -5, "Kiosk"),
      R("2026-09-10T11:00:00Z", -5, "Kiosk"),
      G("2026-09-10T10:00:00Z", -5, "Kiosk"),
    ],
    expected: {
      "2026-09-03": {
        text: "spend         CHF -25.80 · 2 transactions · 1 with its receipt · Fjordkaffe",
        json: {
          count: 2,
          deleted: 0,
          totals: { CHF: { spent: -25.8, received: 0, net: -25.8 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000003"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000002",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000003",
            },
          ],
        },
      },
      "2026-09-10": {
        text: "spend         CHF -10.00 · 2 transactions · 1 with its receipt · Kiosk",
        json: {
          count: 2,
          deleted: 0,
          totals: { CHF: { spent: -10, received: 0, net: -10 } },
          merchants: ["Kiosk"],
          lines: ["00000000-0000-4000-8000-000000000005", "00000000-0000-4000-8000-000000000006"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000004",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000006",
            },
          ],
        },
      },
    },
  },
  {
    name: "two receipts, two payments: the nearest pair first, whatever the order of the lines",
    lines: [
      G(`${T}10:00:00Z`, -12.9, "Fjordkaffe"),
      G(`${T}09:05:00Z`, -12.9, "Fjordkaffe"),
      R(`${T}09:00:00Z`, -12.9, "Fjordkaffe"),
      R(`${T}11:30:00Z`, -12.9, "Fjordkaffe"),
      R("2026-09-10T09:00:00Z", -5, "Kiosk"),
      R("2026-09-10T11:30:00Z", -5, "Kiosk"),
      G("2026-09-10T10:00:00Z", -5, "Kiosk"),
      G("2026-09-10T09:05:00Z", -5, "Kiosk"),
    ],
    expected: {
      "2026-09-03": {
        text: "spend         CHF -25.80 · 2 transactions · 2 with their receipts · Fjordkaffe",
        json: {
          count: 2,
          deleted: 0,
          totals: { CHF: { spent: -25.8, received: 0, net: -25.8 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000004",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000001",
            },
            {
              line: "00000000-0000-4000-8000-000000000003",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000002",
            },
          ],
        },
      },
      "2026-09-10": {
        text: "spend         CHF -10.00 · 2 transactions · 2 with their receipts · Kiosk",
        json: {
          count: 2,
          deleted: 0,
          totals: { CHF: { spent: -10, received: 0, net: -10 } },
          merchants: ["Kiosk"],
          lines: ["00000000-0000-4000-8000-000000000007", "00000000-0000-4000-8000-000000000008"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000006",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000007",
            },
            {
              line: "00000000-0000-4000-8000-000000000005",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000008",
            },
          ],
        },
      },
    },
  },
  {
    name: "a receipt alone, and two receipts of one price, are payments",
    lines: [
      R(`${T}08:00:00Z`, -12.9, "Fjordkaffe"),
      R("2026-09-10T08:00:00Z", -5, "Kiosk"),
      R("2026-09-10T10:00:00Z", -5, "Kiosk"),
    ],
    expected: {
      "2026-09-03": {
        text: "spend         CHF -12.90 · 1 transaction · Fjordkaffe",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -12.9, received: 0, net: -12.9 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000001"],
        },
      },
      "2026-09-10": {
        text: "spend         CHF -10.00 · 2 transactions · Kiosk",
        json: {
          count: 2,
          deleted: 0,
          totals: { CHF: { spent: -10, received: 0, net: -10 } },
          merchants: ["Kiosk"],
          lines: ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"],
        },
      },
    },
  },
  {
    name: "a deleted line holds no receipt and is no receipt; the deleted count before the receipts",
    lines: [
      R(`${T}08:00:00Z`, -12.9, "Fjordkaffe"),
      G(`${T}10:00:00Z`, -12.9, "Fjordkaffe", { extra: { deleted: true } }),
      R("2026-09-10T08:00:00Z", -5, "Kiosk", { extra: { from: MAIL, deleted: true } }),
      G("2026-09-10T10:00:00Z", -5, "Kiosk"),
      R("2026-09-12T08:00:00Z", -6, "Bar"),
      G("2026-09-12T10:00:00Z", -6, "Bar"),
      G("2026-09-12T11:00:00Z", -3, "Kiosk", { extra: { deleted: true } }),
    ],
    expected: {
      "2026-09-03": {
        text: "spend         CHF -12.90 · 1 transaction · 1 deleted · Fjordkaffe",
        json: {
          count: 1,
          deleted: 1,
          totals: { CHF: { spent: -12.9, received: 0, net: -12.9 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
        },
      },
      "2026-09-10": {
        text: "spend         CHF -5.00 · 1 transaction · 1 deleted · Kiosk",
        json: {
          count: 1,
          deleted: 1,
          totals: { CHF: { spent: -5, received: 0, net: -5 } },
          merchants: ["Kiosk"],
          lines: ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004"],
        },
      },
      "2026-09-12": {
        text: "spend         CHF -6.00 · 1 transaction · 1 deleted · 1 with its receipt · Bar",
        json: {
          count: 1,
          deleted: 1,
          totals: { CHF: { spent: -6, received: 0, net: -6 } },
          merchants: ["Bar"],
          lines: ["00000000-0000-4000-8000-000000000006", "00000000-0000-4000-8000-000000000007"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000005",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000006",
            },
          ],
        },
      },
    },
  },
  {
    name: "a receipt is known by its source, not its provider; one with no mail names none",
    lines: [
      {
        ...G(`${T}08:00:00Z`, -12.9, "Fjordkaffe"),
        source: "manual-ledger",
        payload: {
          schema: "transaction/v1",
          raw_id: "p1",
          amount: -12.9,
          currency: "CHF",
          merchant: "Fjordkaffe",
          provider: "receipts",
        },
      },
      G(`${T}10:00:00Z`, -12.9, "Fjordkaffe"),
      {
        ...R("2026-09-10T08:00:00Z", -5, "Kiosk"),
        payload: {
          schema: "transaction/v1",
          raw_id: "p2",
          amount: -5,
          currency: "CHF",
          merchant: "Kiosk",
          provider: "other",
        },
      },
      G("2026-09-10T10:00:00Z", -5, "Kiosk"),
      R("2026-09-12T08:00:00Z", -6, "Bar", { extra: {} }),
      G("2026-09-12T10:00:00Z", -6, "Bar"),
    ],
    expected: {
      "2026-09-03": {
        text: "spend         CHF -25.80 · 2 transactions · Fjordkaffe",
        json: {
          count: 2,
          deleted: 0,
          totals: { CHF: { spent: -25.8, received: 0, net: -25.8 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
        },
      },
      "2026-09-10": {
        text: "spend         CHF -5.00 · 1 transaction · 1 with its receipt · Kiosk",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -5, received: 0, net: -5 } },
          merchants: ["Kiosk"],
          lines: ["00000000-0000-4000-8000-000000000004"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000003",
              mail: null,
              of: "00000000-0000-4000-8000-000000000004",
            },
          ],
        },
      },
      "2026-09-12": {
        text: "spend         CHF -6.00 · 1 transaction · 1 with its receipt · Bar",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -6, received: 0, net: -6 } },
          merchants: ["Bar"],
          lines: ["00000000-0000-4000-8000-000000000006"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000005",
              mail: null,
              of: "00000000-0000-4000-8000-000000000006",
            },
          ],
        },
      },
    },
  },
  {
    name: "a corrected payment pairs as it stands",
    lines: [
      R(`${T}08:00:00Z`, -12.9, "Fjordkaffe"),
      G(`${T}10:00:00Z`, -12.9, "Fjordkaffe"),
      G(`${T}10:05:00Z`, -12.5, "Fjordkaffe", {
        supersedes: "00000000-0000-4000-8000-000000000002",
      }),
      R("2026-09-10T08:00:00Z", -5, "Kiosk"),
      G("2026-09-10T10:00:00Z", -4, "Kiosk"),
      G("2026-09-10T10:05:00Z", -5, "Kiosk", {
        supersedes: "00000000-0000-4000-8000-000000000005",
      }),
    ],
    expected: {
      "2026-09-03": {
        text: "spend         CHF -25.40 · 2 transactions · Fjordkaffe",
        json: {
          count: 2,
          deleted: 0,
          totals: { CHF: { spent: -25.4, received: 0, net: -25.4 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000003"],
        },
      },
      "2026-09-10": {
        text: "spend         CHF -5.00 · 1 transaction · 1 with its receipt · Kiosk",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -5, received: 0, net: -5 } },
          merchants: ["Kiosk"],
          lines: ["00000000-0000-4000-8000-000000000006"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000004",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000006",
            },
          ],
        },
      },
    },
  },
  {
    name: "across three days: the payment holds the nearer receipt",
    lines: [
      R(`${T}08:00:00Z`, -12.9, "Fjordkaffe"),
      G("2026-09-04T20:00:00Z", -12.9, "Fjordkaffe"),
      R("2026-09-05T07:00:00Z", -12.9, "Fjordkaffe"),
    ],
    expected: {
      "2026-09-03": {
        text: "spend         CHF -12.90 · 1 transaction · Fjordkaffe",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -12.9, received: 0, net: -12.9 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000001"],
        },
      },
      "2026-09-04": {
        text: "spend         CHF -12.90 · 1 transaction · 1 with its receipt · Fjordkaffe",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -12.9, received: 0, net: -12.9 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000002"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000003",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000002",
            },
          ],
        },
      },
      "2026-09-05": { text: "", json: null },
    },
  },
  {
    name: "two pairs among other spending",
    lines: [
      R(`${T}08:00:00Z`, -12.9, "Fjordkaffe"),
      R(`${T}09:00:00Z`, -30, "Bar"),
      G(`${T}10:00:00Z`, -12.9, "Fjordkaffe"),
      G(`${T}11:00:00Z`, -5, "Other"),
      G(`${T}12:00:00Z`, -30, "BAR AS"),
      G(`${T}13:00:00Z`, 100, "Arbeidsgiver"),
    ],
    expected: {
      "2026-09-03": {
        text: "spend         CHF 52.10 · 4 transactions · 2 with their receipts · Fjordkaffe, Other, BAR AS, Arbeidsgiver",
        json: {
          count: 4,
          deleted: 0,
          totals: { CHF: { spent: -47.9, received: 100, net: 52.1 } },
          merchants: ["Fjordkaffe", "Other", "BAR AS", "Arbeidsgiver"],
          lines: [
            "00000000-0000-4000-8000-000000000003",
            "00000000-0000-4000-8000-000000000004",
            "00000000-0000-4000-8000-000000000005",
            "00000000-0000-4000-8000-000000000006",
          ],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000001",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000003",
            },
            {
              line: "00000000-0000-4000-8000-000000000002",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000005",
            },
          ],
        },
      },
    },
  },
  {
    name: "a Greek final sigma, and a dotless i",
    lines: [
      R(`${T}08:00:00Z`, -12.9, "ΜΑΡΚΟΣ-ΤΑΒΕΡΝΑ"),
      G(`${T}10:00:00Z`, -12.9, "ΜΑΡΚΟΣΤΑΒΕΡΝΑ"),
      R("2026-09-10T08:00:00Z", -5, "Kahvecı"),
      G("2026-09-10T09:00:00Z", -5, "KAHVECI"),
    ],
    expected: {
      "2026-09-03": {
        text: "spend         CHF -12.90 · 1 transaction · 1 with its receipt · ΜΑΡΚΟΣΤΑΒΕΡΝΑ",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -12.9, received: 0, net: -12.9 } },
          merchants: ["ΜΑΡΚΟΣΤΑΒΕΡΝΑ"],
          lines: ["00000000-0000-4000-8000-000000000002"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000001",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000002",
            },
          ],
        },
      },
      "2026-09-10": {
        text: "spend         CHF -10.00 · 2 transactions · Kahvecı, KAHVECI",
        json: {
          count: 2,
          deleted: 0,
          totals: { CHF: { spent: -10, received: 0, net: -10 } },
          merchants: ["Kahvecı", "KAHVECI"],
          lines: ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004"],
        },
      },
    },
  },
  {
    name: "a retracted payment holds nothing, and a retracted receipt is nothing",
    lines: [
      R(`${T}08:00:00Z`, -12.9, "Fjordkaffe"),
      G(`${T}10:00:00Z`, -12.9, "Fjordkaffe"),
      retract(2, `${T}12:00:00Z`),
      R("2026-09-10T08:00:00Z", -5, "Kiosk"),
      G("2026-09-10T10:00:00Z", -5, "Kiosk"),
      retract(4, "2026-09-10T12:00:00Z"),
    ],
    expected: {
      "2026-09-03": {
        text: "spend         CHF -12.90 · 1 transaction · Fjordkaffe",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -12.9, received: 0, net: -12.9 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000001"],
        },
      },
      "2026-09-10": {
        text: "spend         CHF -5.00 · 1 transaction · Kiosk",
        json: {
          count: 1,
          deleted: 0,
          totals: { CHF: { spent: -5, received: 0, net: -5 } },
          merchants: ["Kiosk"],
          lines: ["00000000-0000-4000-8000-000000000005"],
        },
      },
    },
  },
  {
    name: "two payments as near to one receipt, one before and one after",
    lines: [
      G(`${T}11:00:00Z`, -12.9, "Fjordkaffe"),
      G(`${T}09:00:00Z`, -12.9, "Fjordkaffe"),
      R(`${T}10:00:00Z`, -12.9, "Fjordkaffe"),
    ],
    expected: {
      "2026-09-03": {
        text: "spend         CHF -25.80 · 2 transactions · 1 with its receipt · Fjordkaffe",
        json: {
          count: 2,
          deleted: 0,
          totals: { CHF: { spent: -25.8, received: 0, net: -25.8 } },
          merchants: ["Fjordkaffe"],
          lines: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
          receipts: [
            {
              line: "00000000-0000-4000-8000-000000000003",
              mail: "00000000-0000-4000-8000-000000000999",
              of: "00000000-0000-4000-8000-000000000001",
            },
          ],
        },
      },
    },
  },
];
