/**
 * Who a note says was there (SPEC §3.2.5 rule 3): `with <Name>`, the names capitalised and joined by
 * `and`, `og` or `&`, each matched as rule 2 matches a transcript's participant (the person whose label
 * it is, case aside, else the one whose label's first word is its first word). One synthetic record,
 * a day per case: Ines Nordmann at home in Oslo every evening from 16:00 to 22:40, one note at 18:00
 * in her words, and the people the record names, two of them called Kari and one Ines, as she is. `expected` is the names of
 * each day's `people` in the reference's `logbook days --json` at its main of 6ee01c2, captured by
 * running it on the record, never edited by hand; tests/with-notes.test.ts holds this implementation
 * to them and tests/cross-impl.test.ts holds both to the reference itself.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Draft, writeBareRecord } from "./helpers.js";
import { OWNER, PLACES } from "./speakers-cases.js";

/** The people the record names, by an email resolution each; the owner among them. */
const PEOPLE: Array<[string, string, string]> = [
  ["019cadd3-6bc0-7dcd-9133-000000000301", "ola@example.org", "Ola Nordmann"],
  ["019cadd3-6bc0-7dcd-9133-000000000302", "kari@example.org", "Kari Nordmann"],
  ["019cadd3-6bc0-7dcd-9133-000000000303", "kari.h@example.org", "Kari Hansen"],
  ["019cadd3-6bc0-7dcd-9133-000000000304", "per@example.org", "Per Hansen"],
  ["019cadd3-6bc0-7dcd-9133-000000000305", "oyvind@example.org", "Øyvind Hansen"],
  ["019cadd3-6bc0-7dcd-9133-000000000306", "ase@example.org", "Åse Berg"],
  ["019cadd3-6bc0-7dcd-9133-000000000307", "ines.b@example.org", "Ines Berg"],
  [OWNER, "ines.nordmann@example.org", "Ines Nordmann"],
];

export interface WithCase {
  /** The note's text. */
  text: string;
  /** The names of the day's `people` the reference gives (`days --json`), in its order. */
  expected: string[];
}

export const WITH_CASES: WithCase[] = [
  // The writers' own words: `logbook with`, and the notes of who was there (docs/who-was-there.md),
  // whose colon keeps them out of the company.
  { text: "with Ola Nordmann", expected: ["Ola Nordmann"] },
  { text: "not-with: Ola Nordmann, 2026-10-01 to 2026-10-05", expected: [] },
  { text: "lives-with: Ola Nordmann, from 2026-01-01", expected: [] },
  { text: "lives-in: Ola Nordmann, Bergen", expected: [] },
  { text: "with: Ola Nordmann", expected: [] },
  { text: "with:Ola Nordmann", expected: [] },
  // `with` in lower case, at the start of a word, then white space.
  { text: "With Ola Nordmann", expected: [] },
  { text: "WITH Ola", expected: [] },
  { text: "not-with Ola Nordmann", expected: ["Ola Nordmann"] },
  { text: "co-with Ola Nordmann", expected: ["Ola Nordmann"] },
  { text: "xwith Ola", expected: [] },
  { text: "_with Ola", expected: [] },
  { text: "2with Ola", expected: [] },
  { text: "éwith Ola", expected: [] },
  { text: "withOla Nordmann", expected: [] },
  { text: "with  Ola", expected: ["Ola Nordmann"] },
  { text: "with\tOla", expected: ["Ola Nordmann"] },
  { text: "with\nOla", expected: ["Ola Nordmann"] },
  { text: "Ola Nordmann came, with us", expected: [] },
  // The names: capitalised, joined by `and`, `og` or `&` between spaces, the first that is not one
  // ending the list.
  {
    text: "dinner with Kari Nordmann and Ola Nordmann",
    expected: ["Kari Nordmann", "Ola Nordmann"],
  },
  { text: "with Ola og Per", expected: ["Ola Nordmann", "Per Hansen"] },
  { text: "with Ola & Per", expected: ["Ola Nordmann", "Per Hansen"] },
  { text: "with Ola&Per", expected: ["Ola Nordmann"] },
  { text: "with Ola &Per", expected: ["Ola Nordmann"] },
  { text: "with Ola& Per", expected: ["Ola Nordmann"] },
  { text: "with Ola, Per", expected: ["Ola Nordmann"] },
  { text: "with Ola,Per", expected: ["Ola Nordmann"] },
  { text: "with Ola, and Per", expected: ["Ola Nordmann"] },
  { text: "with Ola And Per", expected: ["Ola Nordmann"] },
  { text: "with Ola Og Per", expected: ["Ola Nordmann"] },
  { text: "with Ola andPer", expected: ["Ola Nordmann"] },
  { text: "with Ola og og Per", expected: ["Ola Nordmann"] },
  { text: "with Ola and the Per", expected: ["Ola Nordmann"] },
  { text: "with Ola and ola and Per", expected: ["Ola Nordmann"] },
  { text: "with Ola  and  Per", expected: ["Ola Nordmann", "Per Hansen"] },
  { text: "with Ola\nand Per", expected: ["Ola Nordmann", "Per Hansen"] },
  { text: "with Ola\tand\tPer", expected: ["Ola Nordmann", "Per Hansen"] },
  { text: "with Ola and\nPer", expected: ["Ola Nordmann", "Per Hansen"] },
  { text: "with Ola and Per.", expected: ["Ola Nordmann", "Per Hansen"] },
  {
    text: "with Ola and Per and Øyvind & Åse og Kari Nordmann",
    expected: ["Ola Nordmann", "Per Hansen", "Øyvind Hansen", "Åse Berg", "Kari Nordmann"],
  },
  {
    text: "with Per Hansen og Øyvind og Åse",
    expected: ["Per Hansen", "Øyvind Hansen", "Åse Berg"],
  },
  { text: "with Ola and friends and Kari Nordmann", expected: ["Ola Nordmann"] },
  { text: "with friends, Ola Nordmann", expected: [] },
  { text: "with friends: Ola Nordmann", expected: [] },
  { text: "with, Ola Nordmann", expected: [] },
  { text: "out with - Ola Nordmann", expected: [] },
  { text: "with Ola at the cabin", expected: ["Ola Nordmann"] },
  { text: "with Ola (and Per)", expected: ["Ola Nordmann"] },
  { text: "with Kari Nordmann: Ola Nordmann came too", expected: ["Kari Nordmann"] },
  { text: "dinner with Per. Ola Nordmann later", expected: ["Per Hansen"] },
  { text: "with Per; Ola Nordmann later", expected: ["Per Hansen"] },
  { text: "with Ola. Later with Per.", expected: ["Ola Nordmann", "Per Hansen"] },
  { text: "Dinner with Ola; later with Per", expected: ["Ola Nordmann", "Per Hansen"] },
  // One name: its label, case aside, else the one label whose first word is its first word.
  { text: "with Ola Nordmann Today", expected: ["Ola Nordmann"] },
  { text: "with Ola Nordmann Kari Nordmann", expected: ["Ola Nordmann"] },
  { text: "with Ola Hansen", expected: ["Ola Nordmann"] },
  { text: "with Ola Nordmann's boat", expected: ["Ola Nordmann"] },
  { text: "with Per's boat", expected: [] },
  { text: "with Ola-Nordmann", expected: [] },
  { text: "with Ola.Per", expected: ["Ola Nordmann"] },
  { text: "with Ola and Per2", expected: ["Ola Nordmann"] },
  { text: "with O'Ola", expected: [] },
  { text: 'with "Ola"', expected: [] },
  { text: "with OLA", expected: ["Ola Nordmann"] },
  { text: "with ÅSE", expected: ["Åse Berg"] },
  { text: "with Øyvind", expected: ["Øyvind Hansen"] },
  { text: "with Nordmann", expected: [] },
  { text: "with ola nordmann", expected: [] },
  { text: "with Kari", expected: [] },
  { text: "with Kari and Per", expected: ["Per Hansen"] },
  { text: "with Kari Hansen", expected: ["Kari Hansen"] },
  { text: "with Dr Ola", expected: [] },
  { text: "with Mr. Ola", expected: [] },
  { text: "with US and Ola", expected: ["Ola Nordmann"] },
  { text: "with Ola and US and Per", expected: ["Ola Nordmann", "Per Hansen"] },
  // The owner is never their own company, and does not end the list.
  { text: "with Ines", expected: [] },
  { text: "with Ola and Ines and Per", expected: ["Ola Nordmann", "Per Hansen"] },
  { text: "with Ines Nordmann and Per", expected: ["Per Hansen"] },
  { text: "with Ines Berg", expected: ["Ines Berg"] },
  // A typographic apostrophe is not a name's: the name ends before it.
  { text: "with Per’s boat", expected: ["Per Hansen"] },
  { text: "with Ola Nordmann’s boat and Per", expected: ["Ola Nordmann"] },
];

/** The day of the case at this index: 1 October 2026 and on. */
export const caseDay = (i: number): string =>
  new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);

/** The record of every case, a day each, with `places.json` beside it. */
export function withRecord(): string {
  const lines: Draft[] = PEOPLE.map(([id, address, label]) => ({
    at: "2026-09-30T08:00:00Z",
    source: "manual",
    kind: "resolution",
    payload: {
      schema: "resolution/v1",
      ref: { kind: "email", value: address },
      entity: { type: "person", id, registry: "logbook" },
      label,
      method: "manual",
    },
  }));
  WITH_CASES.forEach((c, i) => {
    const day = caseDay(i);
    for (let h = 14; h <= 20; h++) {
      for (const m of [0, 20, 40]) {
        const at = `${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
        lines.push({
          at,
          source: "sim-phone",
          kind: "location",
          tier: 1,
          payload: { schema: "location/v1", lat: 59.9139, lon: 10.7522, accuracy_m: 10 },
        });
        if (h === 16 && m === 0) {
          lines.push({
            at: `${day}T16:00:30Z`,
            source: "manual",
            kind: "note",
            payload: { schema: "note/v1", text: c.text },
          });
        }
      }
    }
  });
  const root = writeBareRecord(lines);
  writeFileSync(join(root, "places.json"), `${JSON.stringify(PLACES)}\n`, "utf-8");
  return root;
}
