/**
 * A synthetic record for RFC 0037's readers, after the reference's `tests/entities_record.py`: Ines
 * Nordmann of Oslo, who does not exist, and what she decided about a yard, a kiosk, two ideas, a
 * cabin, a berth and two craft. Nothing in it is real: the addresses are `example.org`, the hull is
 * MMSI 970000001, the aircraft is registered ZZ-ABC.
 *
 * - **The yard**, Nordmann Verft AS: minted the old way, a `resolution/v1` of type `company` on its
 *   domain (the frozen word, read as an org), then an `entity/v1` line binding a group and a repo, and
 *   a second one adding a merchant and an alias. A `hold` of 2023 (stale), then a `hold` in answer to
 *   the dream's `let-go`, with a reason, citing a tier-3 transaction: `let-go` is muted.
 * - **The kiosk**, Fjordkiosk AS: `passed`, proposed by the dream, with `since`.
 * - **Havn Data AS**: an org with no status.
 * - **The fjord kiosk** (idea): `spark`, then `exploring` with a reason and its note.
 * - **Fjord ferry app** (idea): `spark`, then `killed` with a reason, the killing retracted.
 * - **Hytta** (place, in `places.json`, let go, closed with `until`) and **Båtplassen** (a berth, no status).
 * - **Solvind** (yacht, sold, closed with `until`) and **Lerka** (aircraft, let go by a line with no
 *   `proposed_by`, which the reference's writer never writes and its reader shows as the owner's).
 * - The owner's noes: an org's (a sailing group is not the yard), a place's (a blank), and a
 *   `people-review/v1` line of RFC 0035, read as a person's.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonValue } from "../src/types.js";
import { type Draft, readMetaFile, writeMeta, writeRecord } from "./helpers.js";

export const TZ = "Europe/Oslo";
export const YARD_ID = "019cadd3-6bc0-7dcd-9133-000000000201";
export const KIOSK_ID = "019cadd3-6bc0-7dcd-9133-000000000202";
export const HAVN_ID = "019cadd3-6bc0-7dcd-9133-000000000203";
export const IDEA_ID = "019cadd3-6bc0-7dcd-9133-000000000301";
export const FERRY_ID = "019cadd3-6bc0-7dcd-9133-000000000302";
export const OLA_ID = "019cadd3-6bc0-7dcd-9133-000000000111";
export const HANNA_ID = "019cadd3-6bc0-7dcd-9133-000000000121";
export const YARD_DOMAIN = "nordmann-verft.example.org";

/** The id `writeRecord` gives the line with this seq. */
export const lineId = (seq: number): string =>
  `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;

type Fields = Record<string, JsonValue>;

const ref = (type: string, id: string): Fields => ({ type, id, registry: "logbook" });

function entity(at: string, type: string, id: string, label: string, fields: Fields): Draft {
  return {
    at,
    source: "manual",
    kind: "entity",
    tier: 2,
    payload: { schema: "entity/v1", entity: ref(type, id), label, ...fields, method: "owner" },
  };
}

function status(at: string, type: string, id: string, label: string, fields: Fields): Draft {
  return {
    at,
    source: "manual",
    kind: "status",
    tier: type === "org" ? 3 : 2,
    payload: { schema: "status/v1", entity: ref(type, id), label, ...fields },
  };
}

/** The note the reference's writer appends beside an idea's, a place's or an asset's status with a reason. */
function statusNote(
  at: string,
  statusSeq: number,
  type: string,
  id: string,
  label: string,
  disposition: string,
  text: string,
): Draft {
  return {
    at,
    source: "manual",
    kind: "note",
    tier: 2,
    payload: {
      schema: "note/v1",
      text,
      labels: ["status"],
      extra: { status: lineId(statusSeq), entity: ref(type, id), label, disposition },
    },
  };
}

/** The drafts, in seq order (1-based). */
export function entityDrafts(): Draft[] {
  return [
    // 1: a tier-3 payment the yard's status may cite
    {
      at: "2026-09-07T17:00:00Z",
      source: "copilot",
      kind: "transaction",
      tier: 3,
      payload: {
        schema: "transaction/v1",
        raw_id: "copilot:7",
        amount: -45,
        currency: "NOK",
        merchant: "FJORDKIOSK AS",
        provider: "copilot",
      },
    },
    // 2: the yard minted the old way, the frozen word
    {
      at: "2026-08-01T08:00:00Z",
      source: "manual",
      kind: "resolution",
      tier: 2,
      payload: {
        schema: "resolution/v1",
        ref: { kind: "domain", value: YARD_DOMAIN },
        entity: ref("company", YARD_ID),
        label: "Nordmann Verft AS",
        method: "owner",
      },
    },
    // 3: Ola, a person
    {
      at: "2026-08-01T08:01:00Z",
      source: "manual",
      kind: "resolution",
      tier: 2,
      payload: {
        schema: "resolution/v1",
        ref: { kind: "email", value: "ola@nordmann-verft.example.org" },
        entity: ref("person", OLA_ID),
        label: "Ola Nordmann",
        method: "owner",
      },
    },
    // 4: the yard's entity line
    entity("2026-09-01T10:00:00Z", "org", YARD_ID, "Nordmann Verft AS", {
      aliases: ["Nordmann Verft"],
      refs: [
        { kind: "domain", value: YARD_DOMAIN },
        { kind: "group", value: "nordmann verft board" },
        { kind: "repo", value: "github.com/nordmann-verft" },
      ],
      keys: { org: `domain:${YARD_DOMAIN}` },
    }),
    // 5: the idea
    entity("2026-09-01T10:05:00Z", "idea", IDEA_ID, "the fjord kiosk", {
      refs: [
        { kind: "repo", value: "git.example.org/nordmann-verft/kiosk" },
        { kind: "title", value: "fjord kiosk" },
      ],
      keys: { idea: "repo:git.example.org/nordmann-verft/kiosk" },
      extra: { pitch: "a kiosk on the ferry quay that sells what the ferry forgot" },
    }),
    // 6: the kiosk
    entity("2026-09-01T10:10:00Z", "org", KIOSK_ID, "Fjordkiosk AS", {
      refs: [
        { kind: "domain", value: "fjordkiosk.example.org" },
        { kind: "merchant", value: "fjordkiosk as" },
      ],
      keys: { org: "domain:fjordkiosk.example.org" },
    }),
    // 7: the yacht, also in assets.json
    entity("2026-09-02T08:00:00Z", "asset", "solvind", "Solvind", {
      refs: [{ kind: "mmsi", value: "970000001" }],
      keys: { asset: "mmsi:970000001" },
    }),
    // 8: the cabin, also in places.json
    entity("2026-09-02T08:05:00Z", "place", "Hytta", "Hytta", {
      refs: [{ kind: "place", value: "Hytta" }],
      keys: { place: "place:hytta" },
    }),
    // 9: an org's no
    {
      at: "2026-09-03T20:16:00Z",
      source: "manual",
      kind: "entity-review",
      tier: 2,
      payload: {
        schema: "entity-review/v1",
        verdict: "different",
        ref: { kind: "group", value: "nordmann verft sailing" },
        refs: [{ kind: "group", value: "nordmann verft sailing" }],
        observed: ["Nordmann Verft sailing"],
        entity: ref("org", YARD_ID),
        label: "Nordmann Verft AS",
        method: "owner",
      },
    },
    // 10: a place's no, a blank with a name
    {
      at: "2026-09-03T20:18:00Z",
      source: "manual",
      kind: "entity-review",
      tier: 2,
      payload: {
        schema: "entity-review/v1",
        verdict: "different",
        ref: { kind: "centre", value: "59.902100,10.741200" },
        entity: { type: "place" },
        label: "Boathouse",
        method: "owner",
      },
    },
    // 11: RFC 0035's no, read as a person's forever
    {
      at: "2026-09-03T20:20:00Z",
      source: "manual",
      kind: "people-review",
      tier: 2,
      payload: {
        schema: "people-review/v1",
        verdict: "different",
        ref: { kind: "email", value: "hanna.foss@example.org" },
        refs: [{ kind: "email", value: "hanna.foss@example.org" }],
        observed: ["Hanna Foss"],
        entity: ref("person", HANNA_ID),
        label: "Hanna Foss",
        method: "owner",
      },
    },
    // 12: the yard held, long ago (`--at 2023-01-02`: the day's last minute, Oslo time)
    status("2023-01-02T22:59:00Z", "org", YARD_ID, "Nordmann Verft AS", {
      status: "hold",
      reason: "early",
      proposed_by: "owner",
    }),
    // 13: held again in answer to the dream's let-go, citing the ledger: let-go is muted
    status("2026-10-01T10:00:00Z", "org", YARD_ID, "Nordmann Verft AS", {
      status: "hold",
      reason: "orders through 2027",
      proposed_by: "dream",
      proposal: { status: "let-go", score: 30, because: ["no touch for 365 days"] },
      evidence: [lineId(1)],
      supersedes: lineId(12),
    }),
    // 14: the kiosk passed, since June
    status("2026-06-14T19:40:00Z", "org", KIOSK_ID, "Fjordkiosk AS", {
      status: "passed",
      reason: "good team, but a kiosk is a place and I do not want to own places",
      proposed_by: "dream",
      proposal: {
        status: "passed",
        score: 40,
        because: ["3 meetings and 9 mails 2026-03-30 – 2026-05-02", "no touch for 180 days"],
      },
      since: "2026-06-01",
    }),
    // 15, 16, 17: the idea sparked, then explored with a reason and its note
    status("2026-09-20T21:59:00Z", "idea", IDEA_ID, "the fjord kiosk", {
      status: "spark",
      proposed_by: "owner",
    }),
    status("2026-10-02T10:00:00Z", "idea", IDEA_ID, "the fjord kiosk", {
      status: "exploring",
      reason: "pricing page written",
      proposed_by: "owner",
      supersedes: lineId(15),
    }),
    statusNote(
      "2026-10-02T10:00:00Z",
      16,
      "idea",
      IDEA_ID,
      "the fjord kiosk",
      "exploring",
      "pricing page written",
    ),
    // 18, 19: the cabin let go, with its note
    status("2026-10-02T12:00:00Z", "place", "Hytta", "Hytta", {
      status: "let-go",
      reason: "sold the cabin",
      proposed_by: "owner",
    }),
    statusNote("2026-10-02T12:00:00Z", 18, "place", "Hytta", "Hytta", "let-go", "sold the cabin"),
    // 20: the yacht sold, no reason
    status("2026-10-03T08:00:00Z", "asset", "solvind", "Solvind", {
      status: "sold",
      proposed_by: "owner",
    }),
    // 21, 22, 23, 24, 25: a second idea, sparked, killed with a reason and its note, the killing retracted
    entity("2026-09-25T09:00:00Z", "idea", FERRY_ID, "Fjord ferry app", {
      refs: [{ kind: "title", value: "fjord ferry app" }],
      keys: { idea: "title:app ferry fjord" },
    }),
    status("2026-09-25T09:30:00Z", "idea", FERRY_ID, "Fjord ferry app", {
      status: "spark",
      proposed_by: "owner",
    }),
    status("2026-10-04T10:00:00Z", "idea", FERRY_ID, "Fjord ferry app", {
      status: "killed",
      reason: "a ferry app exists already",
      proposed_by: "owner",
      supersedes: lineId(22),
    }),
    statusNote(
      "2026-10-04T10:00:00Z",
      23,
      "idea",
      FERRY_ID,
      "Fjord ferry app",
      "killed",
      "a ferry app exists already",
    ),
    {
      at: "2026-10-04T11:00:00Z",
      source: "manual",
      kind: "retraction",
      tier: 2,
      payload: { schema: "retraction/v1", supersedes: lineId(23), reason: "not killed after all" },
    },
    // 26: an org with no status
    entity("2026-10-05T08:00:00Z", "org", HAVN_ID, "Havn Data AS", {
      refs: [{ kind: "domain", value: "havn-data.example.org" }],
      keys: { org: "domain:havn-data.example.org" },
    }),
    // 27: the aircraft let go by a line without proposed_by
    status("2026-10-05T09:00:00Z", "asset", "lerka", "Lerka", {
      status: "let-go",
      reason: "lease ended",
    }),
    // 28: a later line for the yard adds a ref and an alias; the label stays the first line's
    entity("2026-10-06T08:00:00Z", "org", YARD_ID, "Nordmann Verft", {
      aliases: ["NV"],
      refs: [{ kind: "merchant", value: "nordmann verft as" }],
    }),
  ];
}

export const PLACES = {
  Hytta: {
    lat: 59.9,
    lon: 10.75,
    radius_m: 120,
    kind: "other",
    tags: ["family"],
    until: "2026-10-02",
  },
  Båtplassen: { lat: 59.91, lon: 10.73, radius_m: 80, kind: "asset-berth", tags: [] },
};

export const ASSETS = {
  assets: [
    { id: "solvind", kind: "yacht", name: "Solvind", mmsi: "970000001", until: "2026-10-03" },
    { id: "lerka", kind: "aircraft", name: "Lerka", registration: "ZZ-ABC" },
  ],
};

export const ENTITY_POLICY = {
  code_hosts: ["git.example.org"],
  mute_days: 400,
  stale_days: { spark: 10 },
};

/** The record under a fresh temp folder, its registry files and its entities policy beside it. */
export function entitiesRecord(): string {
  const root = writeRecord(entityDrafts(), TZ);
  writeFileSync(join(root, "places.json"), `${JSON.stringify(PLACES, null, 2)}\n`, "utf-8");
  writeFileSync(join(root, "assets.json"), `${JSON.stringify(ASSETS, null, 2)}\n`, "utf-8");
  mkdirSync(join(root, "policy"), { recursive: true });
  writeFileSync(
    join(root, "policy", "entities.json"),
    `${JSON.stringify(ENTITY_POLICY)}\n`,
    "utf-8",
  );
  return root;
}

/**
 * A record whose day begins at 06:00 (RFC 0036 `day_start`): the yard's `hold` is written at 03:30
 * Oslo time on 2 October, which is still 1 October by the owner's clock.
 */
export function dayStartRecord(): string {
  const root = writeRecord(
    [
      entity("2026-09-01T10:00:00Z", "org", YARD_ID, "Nordmann Verft AS", {
        refs: [{ kind: "domain", value: YARD_DOMAIN }],
      }),
      status("2026-10-02T01:30:00Z", "org", YARD_ID, "Nordmann Verft AS", {
        status: "hold",
        proposed_by: "owner",
      }),
    ],
    TZ,
  );
  writeMeta(root, { ...readMetaFile(root), day_start: "06:00" });
  return root;
}
