/**
 * RFC 0037's three profiles (`entity/v1`, `entity-review/v1`, `status/v1`) and `status list`, ported
 * from the reference's `tests/test_entities.py` and the read-only half of `tests/test_entity_status.py`,
 * plus the checks that are this implementation's own. Every name, address and id is synthetic.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bindings,
  CLOSING,
  canonical,
  checkKind,
  DISPOSITIONS,
  EntityError,
  entityIdProblems,
  entityKey,
  entityLineProblems,
  entityProblems,
  entityReviewProblems,
  fold,
  KINDS,
  keyOf,
  kindOf,
  known,
  localDays,
  lookup,
  muted,
  NO_STATUS,
  OBSERVED_REFS,
  orgName,
  orgReasonProblems,
  pairKey,
  REF_KINDS,
  readEntitySettings,
  reasonNote,
  refKey,
  registeredDomain,
  registrationKey,
  registry,
  repoOrg,
  reviewHolds,
  reviews,
  reviewTier,
  STALE_DAYS,
  StatusError,
  stale,
  standing,
  statusDay,
  statuses,
  statusListing,
  statusListingJson,
  statusListingText,
  statusProblems,
  statusTier,
  tierProblems,
  titleKey,
  VALIDATORS,
  words,
} from "../src/entities.js";
import { LogbookError } from "../src/store.js";
import type { JsonValue, Line } from "../src/types.js";
import {
  ASSETS,
  dayStartRecord,
  entitiesRecord,
  FERRY_ID,
  HANNA_ID,
  HAVN_ID,
  IDEA_ID,
  KIOSK_ID,
  lineId,
  OLA_ID,
  portfolioRecord,
  statusNotesRecord,
  TZ,
  YARD_DOMAIN,
  YARD_ID,
} from "./entities-record.js";
import { cleanup, FIXTURES, tempDir, writeBareRecord, writeRecord } from "./helpers.js";

afterEach(cleanup);

type Fields = Record<string, JsonValue>;

const ORG_ID = "019cadd3-6bc0-7dcd-9133-000000000201";
const PERSON_ID = "019cadd3-6bc0-7dcd-9133-000000000121";
const MONEY_LINE = "019cadd3-6bc0-7dcd-9133-0000000001d1";

/** One example line as the reference's fixture holds it: the RFC's examples with the decisions applied. */
function example(name: string): Record<string, JsonValue> {
  return JSON.parse(readFileSync(join(FIXTURES, "entities", `${name}.json`), "utf-8")) as Record<
    string,
    JsonValue
  >;
}

const payloadOf = (name: string): Fields => example(name).payload as Fields;

/** The example lines as a record's lines: seq n, id …f00n, as the reference's `_lines` numbers them. */
function lines(...names: string[]): Line[] {
  return names.map(
    (name, i) =>
      ({
        ...example(name),
        seq: i + 1,
        id: `019cadd3-6bc0-7dcd-9133-00000000f${String(i + 1).padStart(3, "0")}`,
      }) as unknown as Line,
  );
}

/** A line built by hand, for the checks on whole lines. */
function line(
  seq: number,
  kind: string,
  tier: number,
  payload: Fields,
  at = "2026-10-01T10:00:00Z",
): Line {
  return {
    id: lineId(seq),
    seq,
    at,
    end: null,
    tz: TZ,
    source: "manual",
    kind,
    tier,
    payload,
    recorded_at: at,
    prev: "0".repeat(64),
    hash: "0".repeat(64),
  } as unknown as Line;
}

const without = (fields: Fields, key: string): Fields => {
  const { [key]: _dropped, ...rest } = fields;
  return rest;
};

/** The lines of every month file of `root`, in seq order. */
function recordLines(root: string): Line[] {
  const out: Line[] = [];
  for (const year of ["2023", "2026"]) {
    for (const month of ["01", "06", "08", "09", "10"]) {
      try {
        out.push(
          ...readFileSync(join(root, "logbook", year, `${month}.jsonl`), "utf-8")
            .split("\n")
            .filter(Boolean)
            .map((raw) => JSON.parse(raw) as Line),
        );
      } catch {
        // no such month
      }
    }
  }
  return out.sort((a, b) => a.seq - b.seq);
}

// -- the examples ----------------------------------------------------------------------------------------

describe("the example lines of RFC 0037 (tests/fixtures/entities, the reference's fixtures verbatim)", () => {
  for (const name of ["org", "idea", "passed", "exploring", "review-org", "review-place"]) {
    it(`${name} is valid, at its tier, with nothing to say against it`, () => {
      const found = example(name);
      const payload = found.payload as Fields;
      const schema = payload.schema as string;
      const validator = VALIDATORS[schema];
      expect(validator).toBeDefined();
      expect(validator?.(payload)).toEqual([]);
      const kind = (payload.entity as Fields).type as string;
      expect(tierProblems(schema, found.tier as number, {}, kind)).toEqual([]);
      expect(
        entityLineProblems({ ...found, id: lineId(1), seq: 1 } as unknown as Line, new Map()),
      ).toEqual([]);
    });
  }
});

// -- validation ------------------------------------------------------------------------------------------

describe("entity/v1 refuses what its table refuses, in the reference's words", () => {
  const good = payloadOf("org");
  const entityOf = (fields: Fields): Fields => ({
    ...good,
    entity: { ...(good.entity as Fields), ...fields },
  });

  it("takes the example, and refuses a v4 id, another registry, a blank label, a ref kind it does not know", () => {
    expect(entityProblems(good)).toEqual([]);
    expect(entityProblems(entityOf({ id: "1f2e3d4c-0000-4000-8000-000000000001" }))).toEqual([
      "entity.id of an org must be a UUIDv7 minted in this record, not '1f2e3d4c-0000-4000-8000-000000000001'",
    ]);
    expect(entityProblems(entityOf({ registry: "crm" }))).toEqual([
      "entity.registry must be 'logbook', not 'crm'",
    ]);
    expect(entityProblems({ ...good, label: " " })).toEqual([
      "label must be the name, a non-empty string",
    ]);
    expect(entityProblems({ ...good, refs: [{ kind: "url", value: "x" }] })).toEqual([
      `refs[0].kind 'url' is not one of ${REF_KINDS.join(", ")}`,
    ]);
  });

  it("a person's refs bind through resolution/v1 (decision 1); a place is its name; an asset its assets.json id", () => {
    const person = { ...good, entity: { type: "person", id: PERSON_ID, registry: "logbook" } };
    expect(entityProblems(person)).toEqual([
      "a person's refs bind through resolution/v1: refs must be empty",
    ]);
    expect(entityProblems({ ...person, refs: [] })).toEqual([]);
    expect(
      entityProblems({ ...good, entity: { type: "place", id: "Hytta", registry: "logbook" } }),
    ).toEqual([]);
    expect(
      entityProblems({ ...good, entity: { type: "place", id: " ", registry: "logbook" } }),
    ).toEqual(["entity.id of a place must be its name in places.json"]);
    expect(
      entityProblems({ ...good, entity: { type: "asset", id: "Solvind!", registry: "logbook" } }),
    ).toEqual(["entity.id of an asset must be its assets.json id, not 'Solvind!'"]);
    expect(
      entityProblems({ ...good, entity: { type: "asset", id: "solvind", registry: "logbook" } }),
    ).toEqual([]);
    expect(entityProblems({ ...good, logbook_head: "8f1c…" })).toEqual([
      "logbook_head must be the head the proposal was read against, 64 lowercase hex",
    ]);
  });

  it("names every other rule of the table, in the table's order", () => {
    expect(entityProblems({ ...good, schema: "entity/v2" })[0]).toBe(
      "schema is 'entity/v2', not 'entity/v1'",
    );
    expect(entityProblems(without(good, "schema"))[0]).toBe("schema is None, not 'entity/v1'");
    expect(entityProblems({ ...good, entity: "x" })).toEqual([
      "entity must be an object {type, id, registry}",
    ]);
    expect(entityProblems(entityOf({ type: "company" }))).toEqual([
      `entity.type 'company' is not one of ${KINDS.join(", ")}`,
    ]);
    expect(entityProblems({ ...good, entity: { id: ORG_ID } })).toEqual([
      `entity.type None is not one of ${KINDS.join(", ")}`,
    ]);
    expect(entityProblems({ ...good, entity: { type: "org" } })).toEqual([
      "entity.id must be a non-empty string",
      "entity.registry must be 'logbook', not None",
    ]);
    expect(entityProblems(entityOf({ id: "" }))[0]).toBe("entity.id must be a non-empty string");
    expect(entityProblems({ ...good, refs: "x" })).toEqual([
      "refs must be a list of {kind, value}",
    ]);
    expect(
      entityProblems({
        ...good,
        refs: [5, { kind: "domain" }, { value: "x" }, { kind: "domain", value: " " }],
      }),
    ).toEqual([
      "refs[0] must be an object {kind, value}",
      "refs[1].value must be a non-empty string",
      `refs[2].kind None is not one of ${REF_KINDS.join(", ")}`,
      "refs[3].value must be a non-empty string",
    ]);
    expect(entityProblems({ ...good, aliases: "x" })).toEqual([
      "aliases must be a list of strings",
    ]);
    expect(entityProblems({ ...good, aliases: ["a", ""] })).toEqual([
      "aliases must be a list of strings",
    ]);
    expect(entityProblems({ ...good, aliases: [] })).toEqual([]);
    expect(entityProblems({ ...good, keys: "x" })).toEqual([
      "keys must be an object of strings, the dedupe key of §8 per kind",
    ]);
    expect(entityProblems({ ...good, keys: { org: "" } })).toEqual([
      "keys must be an object of strings, the dedupe key of §8 per kind",
    ]);
    expect(entityProblems({ ...good, keys: {} })).toEqual([]);
    expect(entityProblems({ ...good, method: "" })).toEqual(["method must be a string, `owner`"]);
    expect(entityProblems({ ...good, evidence: [""] })).toEqual([
      "evidence must be a list of strings",
    ]);
    expect(entityProblems({ ...good, supersedes: 5 })).toEqual([
      "supersedes must be the id of the entity/v1 line this replaces",
    ]);
    expect(entityProblems({ ...good, extra: "x" })).toEqual(["extra must be an object"]);
    expect(entityProblems({ ...good, extra: null })).toEqual(["extra must be an object"]);
    expect(
      entityProblems({
        schema: "x",
        entity: { type: "org", id: "x", registry: "crm" },
        label: 5,
        refs: [1],
        aliases: 1,
        keys: 1,
        method: 1,
        evidence: 1,
        supersedes: 1,
        logbook_head: 1,
        extra: 1,
      }),
    ).toEqual([
      "schema is 'x', not 'entity/v1'",
      "entity.id of an org must be a UUIDv7 minted in this record, not 'x'",
      "entity.registry must be 'logbook', not 'crm'",
      "label must be the name, a non-empty string",
      "refs[0] must be an object {kind, value}",
      "aliases must be a list of strings",
      "keys must be an object of strings, the dedupe key of §8 per kind",
      "method must be a string, `owner`",
      "evidence must be a list of strings",
      "supersedes must be the id of the entity/v1 line this replaces",
      "logbook_head must be the head the proposal was read against, 64 lowercase hex",
      "extra must be an object",
    ]);
  });

  it("reads the id rule as Python does: a UUIDv7 needs the RFC 4122 variant, and `$` matches before one trailing newline", () => {
    expect(entityIdProblems("org", "019cadd3-6bc0-7dcd-9133-000000000201")).toEqual([]);
    expect(entityIdProblems("idea", "019cadd3-6bc0-7dcd-c133-000000000201")).toEqual([
      "entity.id of an idea must be a UUIDv7 minted in this record, not '019cadd3-6bc0-7dcd-c133-000000000201'",
    ]);
    expect(entityIdProblems("org", "019CADD3-6BC0-7DCD-9133-000000000201")).toEqual([
      "entity.id of an org must be a UUIDv7 minted in this record, not '019CADD3-6BC0-7DCD-9133-000000000201'",
    ]);
    expect(entityIdProblems("person", "x")).toEqual([
      "entity.id of a person must be the UUID its resolution minted, not 'x'",
    ]);
    expect(entityIdProblems("person", "019cadd3-6bc0-7dcd-9133-000000000121\n")).toEqual([]);
    expect(entityIdProblems("asset", "solvind\n")).toEqual([]);
    expect(entityIdProblems("asset", "-x")).toEqual([
      "entity.id of an asset must be its assets.json id, not '-x'",
    ]);
    expect(entityIdProblems("place", "x")).toEqual([]);
    expect(entityIdProblems("goal", "x")).toEqual([]);
    expect(entityIdProblems("org", 5)).toEqual(["entity.id must be a non-empty string"]);
    // The reference raises ValueError here (uuid.UUID refuses the newline its regex let through);
    // this implementation answers with the sentence the rule has.
    expect(entityIdProblems("org", "019cadd3-6bc0-7dcd-9133-000000000201\n")).toEqual([
      "entity.id of an org must be a UUIDv7 minted in this record, not '019cadd3-6bc0-7dcd-9133-000000000201\\n'",
    ]);
  });
});

describe("entity-review/v1 takes every kind, and a new entity by type alone", () => {
  const org = payloadOf("review-org");

  it("takes the org's no and the place's no, and refuses a same, a person by type alone, a ref kind it does not know", () => {
    expect(entityReviewProblems(org)).toEqual([]);
    expect(entityReviewProblems(payloadOf("review-place"))).toEqual([]);
    expect(entityReviewProblems({ ...org, verdict: "same" })).toEqual([
      "verdict must be 'different'; a same is a binding line, never this",
    ]);
    expect(entityReviewProblems({ ...org, entity: { type: "person" } })).toEqual([
      "a person's no names the canonical person: entity needs its id and registry",
    ]);
    expect(entityReviewProblems({ ...org, ref: { kind: "url", value: "x" } })).toEqual([
      `ref.kind 'url' is not one of ${OBSERVED_REFS.join(", ")}`,
    ]);
    expect(OBSERVED_REFS).toEqual([...REF_KINDS, "name", "centre", "subject", "speaker"]);
  });

  it("names every other rule of the table, in the table's order", () => {
    expect(entityReviewProblems({ ...org, schema: "x" })).toEqual([
      "schema is 'x', not 'entity-review/v1'",
    ]);
    expect(entityReviewProblems(without(org, "verdict"))).toEqual([
      "verdict must be 'different'; a same is a binding line, never this",
    ]);
    expect(entityReviewProblems(without(org, "ref"))).toEqual([
      "ref must be an object {kind, value}",
    ]);
    expect(entityReviewProblems({ ...org, ref: { kind: "name", value: "" } })).toEqual([
      "ref.value must be a non-empty string",
    ]);
    expect(entityReviewProblems({ ...org, refs: {} })).toEqual([
      "refs must be a list of {kind, value}",
    ]);
    expect(entityReviewProblems({ ...org, refs: [{ kind: "url", value: "x" }] })).toEqual([
      `refs[0].kind 'url' is not one of ${OBSERVED_REFS.join(", ")}`,
    ]);
    expect(entityReviewProblems({ ...org, observed: "x" })).toEqual([
      "observed must be a list of strings",
    ]);
    expect(entityReviewProblems(without(org, "entity"))).toEqual([
      "entity must be an object {type, id, registry}",
    ]);
    expect(entityReviewProblems({ ...org, entity: { type: "goal" } })).toEqual([
      `entity.type 'goal' is not one of ${KINDS.join(", ")}`,
    ]);
    expect(entityReviewProblems({ ...org, entity: { type: "org" } })).toEqual([]);
    expect(entityReviewProblems({ ...org, entity: { type: "org", id: "x" } })).toEqual([
      "entity.id of an org must be a UUIDv7 minted in this record, not 'x'",
      "entity.registry must be 'logbook', not None",
    ]);
    expect(entityReviewProblems({ ...org, label: "" })).toEqual([
      "label must be the entity's label, or the new name the proposal gave",
    ]);
    expect(entityReviewProblems({ ...org, method: 5 })).toEqual([
      "method must be a string, `owner`",
    ]);
    expect(entityReviewProblems({ ...org, evidence: 5 })).toEqual([
      "evidence must be a list of strings",
    ]);
    expect(entityReviewProblems({ ...org, logbook_head: "x" })).toEqual([
      "logbook_head must be the head the proposal was read against, 64 lowercase hex",
    ]);
    expect(entityReviewProblems({ ...org, raw_id: "" })).toEqual(["raw_id must be a string"]);
    expect(entityReviewProblems({ ...org, extra: [] })).toEqual(["extra must be an object"]);
  });
});

describe("status/v1 takes the four kinds and their dispositions, and no money", () => {
  const good = payloadOf("passed");
  const ids: Record<string, string> = {
    org: ORG_ID,
    idea: IDEA_ID,
    place: "Hytta",
    asset: "solvind",
  };

  it("takes every disposition of every kind, with the reason, and knows the dispositions by heart", () => {
    for (const [kind, dispositions] of Object.entries(DISPOSITIONS)) {
      for (const status of dispositions) {
        const payload = {
          schema: "status/v1",
          entity: { type: kind, id: ids[kind] as string, registry: "logbook" },
          label: "x",
          status,
          reason: "because",
          proposed_by: "owner",
        };
        expect(statusProblems(payload), `${kind} ${status}`).toEqual([]);
      }
    }
    expect(DISPOSITIONS.org).toEqual(["hold", "add", "sell", "let-go", "exited", "passed"]);
    expect(DISPOSITIONS.idea).toEqual(["spark", "exploring", "build", "built", "killed"]);
    expect(DISPOSITIONS.place).toEqual(["let-go"]);
    expect(DISPOSITIONS.asset).toEqual(["sold", "let-go"]);
    expect(Object.keys(DISPOSITIONS)).toEqual(["org", "idea", "place", "asset"]);
    expect(CLOSING).toEqual({ place: ["let-go"], asset: ["sold", "let-go"] });
    expect(NO_STATUS).toEqual({
      person: "a person has no status (RFC 0037): people are reviewed, never disposed of",
      goal: "a goal is reviewed by review/v1 (RFC 0036), not given a status",
    });
  });

  it("refuses a disposition of another kind, a passed without a reason, money, a person and a goal", () => {
    expect(statusProblems({ ...good, status: "sold" })).toEqual([
      "status 'sold' is not one of an org's: hold, add, sell, let-go, exited, passed",
    ]);
    expect(statusProblems(without(good, "reason"))).toEqual([
      "a status of passed must say why: reason",
    ]);
    expect(statusProblems({ ...good, amount: -2500 })).toEqual([
      "amount: no money on a status line (decision 10); the ledger holds it",
    ]);
    expect(
      statusProblems({ ...good, entity: { type: "person", id: PERSON_ID, registry: "logbook" } }),
    ).toEqual(["entity.type 'person' is not one of org, idea, place, asset"]);
    expect(
      statusProblems({ ...good, entity: { type: "goal", id: ORG_ID, registry: "logbook" } }),
    ).toEqual(["entity.type 'goal' is not one of org, idea, place, asset"]);
    expect(
      statusProblems({ ...good, entity: { type: "company", id: ORG_ID, registry: "logbook" } }),
    ).toEqual(["entity.type 'company' is not one of org, idea, place, asset"]);
  });

  it("names every other rule of the table, in the table's order", () => {
    expect(statusProblems({ ...good, schema: "x" })[0]).toBe("schema is 'x', not 'status/v1'");
    expect(statusProblems(without(good, "entity"))[0]).toBe(
      "entity must be an object {type, id, registry}",
    );
    expect(statusProblems(without(good, "status"))).toEqual([
      "status None is not one of an org's: hold, add, sell, let-go, exited, passed",
    ]);
    expect(statusProblems({ ...good, reason: " " })).toEqual([
      "reason must be the owner's words",
      "a status of passed must say why: reason",
    ]);
    expect(statusProblems({ ...good, reason: true })).toEqual([
      "reason must be the owner's words",
      "a status of passed must say why: reason",
    ]);
    expect(statusProblems({ ...good, label: "" })).toEqual([
      "label must be the entity's label at the time",
    ]);
    expect(statusProblems(without(good, "proposed_by"))).toEqual([
      "proposed_by must be one of dream, owner",
    ]);
    expect(statusProblems({ ...good, proposed_by: "me" })).toEqual([
      "proposed_by must be one of dream, owner",
    ]);
    expect(statusProblems({ ...good, proposal: "x" })).toEqual([
      "proposal must be an object {status, score?, because?}",
    ]);
    expect(statusProblems({ ...good, proposal: {} })).toEqual([
      "proposal must be an object {status, score?, because?}",
    ]);
    expect(statusProblems({ ...good, proposal: { status: "x" } })).toEqual([
      "proposal.status 'x' is not an org's disposition",
    ]);
    expect(statusProblems({ ...good, proposal: { status: "hold" } })).toEqual([]);
    expect(statusProblems({ ...good, since: "2026-1-1" })).toEqual([
      "since must be a local day, YYYY-MM-DD",
    ]);
    expect(statusProblems({ ...good, since: 5 })).toEqual([
      "since must be a local day, YYYY-MM-DD",
    ]);
    // Python's `\d` takes any Unicode digit and `$` matches before a trailing newline; the day is not checked.
    expect(statusProblems({ ...good, since: "2026-01-01\n" })).toEqual([]);
    expect(statusProblems({ ...good, since: "２０２６-01-01" })).toEqual([]);
    expect(statusProblems({ ...good, since: "2026-13-45" })).toEqual([]);
    expect(statusProblems({ ...good, evidence: "x" })).toEqual([
      "evidence must be a list of strings",
    ]);
    expect(statusProblems({ ...good, supersedes: "" })).toEqual([
      "supersedes must be the id of the status line this replaces",
    ]);
    expect(statusProblems({ ...good, logbook_head: 5 })).toEqual([
      "logbook_head must be the head the proposal was read against, 64 lowercase hex",
    ]);
    expect(statusProblems({ ...good, value: 1, price: 2, currency: "NOK", amount: 3 })).toEqual([
      "amount: no money on a status line (decision 10); the ledger holds it",
      "currency: no money on a status line (decision 10); the ledger holds it",
      "price: no money on a status line (decision 10); the ledger holds it",
      "value: no money on a status line (decision 10); the ledger holds it",
    ]);
    expect(VALIDATORS).toEqual({
      "entity/v1": entityProblems,
      "entity-review/v1": entityReviewProblems,
      "status/v1": statusProblems,
    });
  });
});

describe("the tier rules name the rule per kind; an org's status is tier three", () => {
  const money = { [MONEY_LINE]: 3 };

  it("an org's status is tier 3 and may cite the ledger; an idea's, a place's and an asset's are tier 2 and never do", () => {
    expect(statusTier("org")).toBe(3);
    expect(["idea", "place", "asset"].map(statusTier)).toEqual([2, 2, 2]);
    expect(tierProblems("status/v1", 3, money, "org")).toEqual([]);
    expect(tierProblems("status/v1", 2, {}, "org")).toEqual([
      "a status/v1 line about an org is tier 3, not 2: its dispositions describe a position in money",
    ]);
    for (const kind of ["idea", "place", "asset"]) {
      const an = "aeiou".includes(kind[0] as string) ? "an" : "a";
      expect(tierProblems("status/v1", 2, {}, kind), kind).toEqual([]);
      expect(tierProblems("status/v1", 3, {}, kind)).toEqual([
        `a status/v1 line about ${an} ${kind} is tier 2, not 3`,
      ]);
      const [cites, ...rest] = tierProblems("status/v1", 2, money, kind);
      expect(rest).toEqual([]);
      expect(cites?.startsWith(`a status/v1 line about ${an} ${kind} never cites`)).toBe(true);
      expect(cites).toContain(`${MONEY_LINE} is tier 3`);
    }
    expect(tierProblems("entity/v1", 2, money, "org")).toEqual([
      `an entity/v1 line of kind org never cites a tier-3 line (${MONEY_LINE} is tier 3): bind a merchant as a \`merchant\` ref, and the ledger is read at the page, within its ceiling`,
    ]);
    expect(tierProblems("entity/v1", 3, {}, "org")).toEqual([
      "an entity/v1 line of kind org is tier 2, not 3",
    ]);
    expect(tierProblems("entity-review/v1", 3, money, "org")).toEqual([]);
    expect(tierProblems("entity-review/v1", 2, money, "place")).toEqual([
      "an entity-review/v1 line citing this evidence is tier 3, not 2",
    ]);
  });

  it("an entity line never cites a tier-three line, whatever its kind; a no is never under 2", () => {
    const cited = { [MONEY_LINE]: 3, "019cadd3-6bc0-7dcd-9133-0000000001a1": 2 };
    const problems = tierProblems("entity/v1", 2, cited);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("tier-3");
    expect(problems[0]).toContain("merchant");
    expect(tierProblems("entity/v1", 3, {})).toEqual(["an entity/v1 line is tier 2, not 3"]);
    expect(tierProblems("status/v1", 2, {})).toEqual([]);
    expect(tierProblems("status/v1", 3, {})).toEqual([
      "a status/v1 line about an idea, a place or an asset is tier 2, not 3",
    ]);
    expect(tierProblems("status/v1", 2, money)).toEqual([
      `a status/v1 line about an idea, a place or an asset never cites a tier-3 line (${MONEY_LINE} is tier 3): no money on the line, and the ledger is read at the page, within its ceiling`,
    ]);
    expect(tierProblems("entity-review/v1", 3, money)).toEqual([]);
    expect(tierProblems("entity-review/v1", 2, money)).toEqual([
      "an entity-review/v1 line citing this evidence is tier 3, not 2",
    ]);
    expect(tierProblems("entity-review/v1", 1, { a: 1 })).toEqual([
      "an entity-review/v1 line citing this evidence is tier 2, not 1",
    ]);
    expect(reviewTier([1, 1])).toBe(2);
    expect(reviewTier([])).toBe(2);
    expect(reviewTier([3, 2])).toBe(3);
    expect(tierProblems("note/v1", 5, money)).toEqual([]);
    // Several tier-3 lines cited: the first by code point is named, as Python's sorted() picks it.
    expect(tierProblems("entity/v1", 2, { z: 3, b: 2, a: 3 })[0]).toContain("(a is tier 3)");
    // A status about a kind without a tier of its own is tier 2, and `an` goes by the first letter.
    expect(tierProblems("status/v1", 3, {}, "unicorn")).toEqual([
      "a status/v1 line about an unicorn is tier 2, not 3",
    ]);
  });

  it("a status reason is also a note only when the line is no higher than a note: never for an org", () => {
    expect(reasonNote("org")).toBe(false);
    expect(["idea", "place", "asset"].map(reasonNote)).toEqual([true, true, true]);
  });
});

// -- the keys --------------------------------------------------------------------------------------------

describe("one dedupe key per kind, strongest first (§9)", () => {
  const key = (kind: string, refs: Array<[string, string]>, id?: string, label?: string) =>
    keyOf(
      kind,
      refs.map(([k, value]) => ({ kind: k, value })),
      id,
      label,
    );

  it("as the reference's test has them", () => {
    expect(
      key("person", [
        ["phone", "+447700900123"],
        ["email", "Ola.Nordmann@Example.org"],
      ]),
    ).toBe("email:ola.nordmann@example.org");
    expect(key("person", [["name", "nordmann ola"]])).toBe("name:nordmann ola");
    expect(
      key("org", [
        ["group", "Nordmann Verft Board"],
        ["domain", "post.nordmann-verft.example"],
      ]),
    ).toBe("domain:nordmann-verft.example");
    expect(key("org", [["repo", "github.com/nordmann-verft/kiosk"]])).toBe(
      "repo-org:github.com/nordmann-verft",
    );
    expect(key("org", [["merchant", "  FJORDKIOSK  AS "]])).toBe("merchant:fjordkiosk as");
    expect(
      key("idea", [
        ["title", "The Fjord Kiosk"],
        ["page", "notion:1f2e"],
      ]),
    ).toBe("page:notion:1f2e");
    expect(key("idea", [["repo", "github.com/Nordmann-Verft/Kiosk"]])).toBe(
      "repo:github.com/nordmann-verft/kiosk",
    );
    expect(key("idea", [["title", "The Fjord Kiosk"]])).toBe("title:fjord kiosk");
    expect(key("place", [["place", "Hytta på Banken"]])).toBe("place:hytta på banken");
    expect(
      key("asset", [
        ["registration", "ZZ-ABC"],
        ["mmsi", "970123456"],
      ]),
    ).toBe("mmsi:970123456");
    expect(key("asset", [["registration", "ZZ-ABC"]])).toBe("registration:zzabc");
    expect(key("asset", [], "solvind")).toBe("subject:solvind");
  });

  it("the first ref of each kind counts, and nothing gives a key where nothing does", () => {
    expect(
      key("person", [
        ["email", "a@example.org"],
        ["email", "b@example.org"],
      ]),
    ).toBe("email:a@example.org");
    expect(key("person", [["phone", " +447700900123 "]])).toBe("phone:+447700900123");
    expect(key("person", [["handle", "x"]])).toBeUndefined();
    expect(key("org", [["domain", "localhost"]])).toBe("domain:localhost");
    expect(key("org", [["repo", "x"]])).toBeUndefined();
    expect(key("org", [["group", "Board"]])).toBe("group:board");
    expect(key("idea", [["repo", "/a//b/"]])).toBe("repo:a//b");
    expect(key("idea", [["repo", "a/b"]])).toBeUndefined();
    expect(key("idea", [["title", "the a"]])).toBeUndefined();
    expect(key("idea", [["title", "the"]], undefined, "The An")).toBeUndefined();
    expect(key("idea", [["repo", "a/b"]], undefined, "The Fjord Kiosk")).toBe("title:fjord kiosk");
    expect(key("place", [], "Hytta")).toBe("place:hytta");
    expect(key("place", [], "", " ")).toBe("place:");
    expect(key("place", [], "", "")).toBeUndefined();
    expect(key("asset", [["icao24", " ABC123 "]])).toBe("icao24:abc123");
    expect(key("asset", [["subject", "lerka"]], "solvind")).toBe("subject:lerka");
    expect(key("asset", [])).toBeUndefined();
    expect(key("goal", [["title", "x"]])).toBeUndefined();
  });

  it("the registered domain is the public suffix and one label", () => {
    expect(registeredDomain("post.nordmann-verft.example")).toBe("nordmann-verft.example");
    expect(registeredDomain("mail.fjordkiosk.co.uk")).toBe("fjordkiosk.co.uk");
    expect(registeredDomain("post.verft.example.org")).toBe("verft.example.org");
    expect(registeredDomain("example.org")).toBe("example.org");
    expect(registeredDomain("localhost")).toBeUndefined();
    expect(registeredDomain("a.b.club.example", ["club.example"])).toBe("b.club.example");
    expect(registeredDomain(" .Mail.Fjord.CO.UK. ")).toBe("fjord.co.uk");
    expect(registeredDomain("a..b")).toBe("a.b");
    expect(registeredDomain("x.y.z", [" .Y.Z "])).toBe("y.z");
    expect(registeredDomain("x.y.z", [".Y.Z."])).toBe("x.y.z");
    expect(registeredDomain("ß.de")).toBeUndefined();
    expect(registeredDomain("a_b.example")).toBeUndefined();
  });

  it("a repo's org is its host and first segment; a registration folds with hyphens and spaces out", () => {
    expect(repoOrg("github.com/nordmann-verft/kiosk")).toBe("github.com/nordmann-verft");
    expect(repoOrg(" /GitHub.com//Org/x ")).toBe("github.com/org");
    expect(repoOrg("a")).toBeUndefined();
    expect(registrationKey("ZZ-ABC")).toBe("zzabc");
    expect(registrationKey("zz abc")).toBe("zzabc");
    expect(registrationKey("zz abc\x1c-x")).toBe("zzabcx");
  });
});

describe("fold, words, orgName and titleKey, as Python folds, splits and sorts", () => {
  it("NFKC, case folded (not lower-cased), Python whitespace collapsed", () => {
    expect(fold("  Nordmann\tVerft  AS ")).toBe("nordmann verft as");
    expect(fold("Straße")).toBe("strasse");
    expect(fold("ſ ΣΟΦΟΣ")).toBe("s σοφοσ");
    expect(fold("ﬁne İstanbul")).toBe("fine i̇stanbul");
    expect(fold("a b\x1cc\x85d　e\x1ff\x1dg\x1eh")).toBe("a b c d e f g h");
    expect(fold("x﻿y")).toBe("x﻿y");
    // Python's full folding leaves `ǰ` as `j` and a combining caron, not recomposed.
    expect(fold("ǰ ᾈ ẞ ϐ ẛ և")).toBe("ǰ ἀι ss β ṡ եւ");
    expect(fold("Ǆ dž 一二三 ١٢٣ ½ ①")).toBe("dž dž 一二三 ١٢٣ 1⁄2 1");
  });

  it("words are Unicode letters, numbers and underscore, never a combining mark; articles out on request", () => {
    expect(words("ﬁne İstanbul")).toEqual(["fine", "i", "stanbul"]);
    expect(words("x﻿y")).toEqual(["x", "y"]);
    expect(words("ǰ ᾈ ẞ ϐ")).toEqual(["j", "ἀι", "ss", "β"]);
    expect(words("Ǆ dž 一二三 ١٢٣ ½ ①")).toEqual(["dž", "dž", "一二三", "١٢٣", "1", "2", "1"]);
    expect(words("The Fjord Kiosk, an A_B")).toEqual(["the", "fjord", "kiosk", "an", "a_b"]);
    expect(words("The Fjord Kiosk, an A_B", false)).toEqual(["fjord", "kiosk", "a_b"]);
  });

  it("sorts by code point, as Python sorts strings", () => {
    expect(titleKey("The Fjord Kiosk")).toBe("fjord kiosk");
    expect(titleKey("a an the")).toBe("");
    expect(titleKey("Ǆ dž 一二三 ١٢٣ ½ ①")).toBe("1 1 2 dž dž ١٢٣ 一二三");
    // U+FA0E is a letter above the surrogates, U+10000 one beyond the BMP: by code point the
    // first sorts before the second, which UTF-16 order would reverse.
    expect(titleKey("b x﨎 x\u{10000} Z")).toBe("b x﨎 x\u{10000} z");
    expect(orgName("Nordmann Verft AS")).toEqual(["nordmann", "verft"]);
    expect(orgName("The Verft Ltd Inc GmbH AB ASA as")).toEqual(["the", "verft"]);
    expect(orgName("")).toEqual([]);
  });
});

// -- the legacy readers --------------------------------------------------------------------------------

describe("a resolution of type company resolves as an org entity", () => {
  it("reads the frozen word as org, never as a kind; binds its ref; a later entity line adds to it", () => {
    const found = canonical(lines("company"));
    const org = found.get(pairKey("org", ORG_ID));
    expect(org?.label).toBe("Nordmann Verft AS");
    expect(org?.refs).toEqual([{ kind: "domain", value: "nordmann-verft.example" }]);
    expect(org && entityKey(org)).toBe("domain:nordmann-verft.example");
    expect(found.has(pairKey("company", ORG_ID))).toBe(false);
    expect([...bindings(lines("company")).entries()]).toEqual([
      [
        refKey({ kind: "domain", value: "nordmann-verft.example" }),
        { ref: { kind: "domain", value: "nordmann-verft.example" }, kind: "org", id: ORG_ID },
      ],
    ]);
    const both = canonical(lines("company", "org"));
    const yard = both.get(pairKey("org", ORG_ID));
    expect(yard?.lines.length).toBeGreaterThan(0);
    expect(yard?.refs).toContainEqual({ kind: "group", value: "nordmann verft board" });
    expect(lookup(both, "org", "Nordmann Verft").id).toBe(ORG_ID);
    expect(lookup(both, "org", "domain:nordmann-verft.example").id).toBe(ORG_ID);
    expect(() => lookup(both, "org", "Fjordkiosk")).toThrow(EntityError);
    expect(() => lookup(both, "org", "Fjordkiosk")).toThrow(/no org/);
    expect(() => lookup(both, "org", "Fjordkiosk")).toThrow(LogbookError);
  });

  it("kindOf reads a legacy company as org and nothing else as a kind", () => {
    expect(kindOf({ type: "company" })).toBe("org");
    expect(kindOf({ type: "person" })).toBe("person");
    expect(kindOf({ type: "goal" })).toBeUndefined();
    expect(kindOf({ type: 5 })).toBeUndefined();
    expect(kindOf("org")).toBeUndefined();
    expect(kindOf(null)).toBeUndefined();
  });
});

describe("a people-review line is read as an entity-review of type person", () => {
  it("reads RFC 0035's line as a person's no, and every other kind's beside it; a retracted one counts for nothing", () => {
    const [review] = reviews(lines("people-review"));
    expect([review?.kind, review?.entity, review?.label]).toEqual([
      "person",
      PERSON_ID,
      "Hanna Foss",
    ]);
    expect(review?.ref).toEqual({ kind: "email", value: "hanna.foss@example.org" });
    expect(
      review &&
        reviewHolds(review, [{ kind: "email", value: "hanna.foss@example.org" }], PERSON_ID),
    ).toBe(true);
    expect(
      review && reviewHolds(review, [{ kind: "email", value: "hanna.foss@example.org" }]),
    ).toBe(false);
    expect(
      review && reviewHolds(review, [{ kind: "phone", value: "+447700900199" }], PERSON_ID),
    ).toBe(false);
    const both = reviews(lines("people-review", "review-org", "review-place"));
    expect(both.map((r) => r.kind)).toEqual(["person", "org", "place"]);
    expect(both[2]?.entity).toBeNull();
    expect(both[2]?.label).toBe("Boathouse");
    const retraction = {
      id: "019cadd3-6bc0-7dcd-9133-00000000f002",
      seq: 2,
      at: "2026-10-11T08:00:00Z",
      end: null,
      tz: "Europe/Oslo",
      source: "manual",
      kind: "retraction",
      tier: 2,
      payload: { schema: "retraction/v1", supersedes: "019cadd3-6bc0-7dcd-9133-00000000f001" },
    } as unknown as Line;
    expect(reviews([...lines("people-review"), retraction])).toEqual([]);
  });
});

// -- the synthetic record --------------------------------------------------------------------------------

describe("the readers on the synthetic record (tests/entities-record.ts)", () => {
  const TODAY = "2026-10-15";

  it("standing: not retracted, not named by another standing line of the kind in supersedes", () => {
    const all = recordLines(entitiesRecord());
    expect(standing(all, "status").map((l) => l.seq)).toEqual([13, 14, 16, 18, 20, 22, 27]);
    expect(standing(all, "entity").map((l) => l.seq)).toEqual([4, 5, 6, 7, 8, 21, 26, 28]);
    expect(standing(all, "note").map((l) => l.seq)).toEqual([17, 19, 24]);
  });

  it("canonical: the standing entity lines and the resolution walk; the label is the first line's, a later line adds", () => {
    const found = canonical(recordLines(entitiesRecord()));
    expect([...found.keys()]).toEqual([
      pairKey("org", YARD_ID),
      pairKey("idea", IDEA_ID),
      pairKey("org", KIOSK_ID),
      pairKey("asset", "solvind"),
      pairKey("place", "Hytta"),
      pairKey("idea", FERRY_ID),
      pairKey("org", HAVN_ID),
      pairKey("person", OLA_ID),
    ]);
    const yard = found.get(pairKey("org", YARD_ID));
    expect(yard).toEqual({
      kind: "org",
      id: YARD_ID,
      label: "Nordmann Verft AS",
      aliases: ["Nordmann Verft", "NV"],
      refs: [
        { kind: "domain", value: YARD_DOMAIN },
        { kind: "group", value: "nordmann verft board" },
        { kind: "repo", value: "github.com/nordmann-verft" },
        { kind: "merchant", value: "nordmann verft as" },
      ],
      lines: [lineId(4), lineId(28), lineId(2)],
      registry: false,
      until: null,
    });
    expect(found.get(pairKey("person", OLA_ID))).toEqual({
      kind: "person",
      id: OLA_ID,
      label: "Ola Nordmann",
      aliases: [],
      refs: [{ kind: "email", value: "ola@nordmann-verft.example.org" }],
      lines: [lineId(3)],
      registry: false,
      until: null,
    });
    expect(
      bindings(recordLines(entitiesRecord())).get(refKey({ kind: "domain", value: YARD_DOMAIN })),
    ).toEqual({
      ref: { kind: "domain", value: YARD_DOMAIN },
      kind: "org",
      id: YARD_ID,
    });
  });

  it("registry and known: the places and assets as entities, with until as the file holds it, the lines folded in", () => {
    const root = entitiesRecord();
    const files = registry(root);
    expect([...files.keys()]).toEqual([
      pairKey("place", "Hytta"),
      pairKey("place", "Båtplassen"),
      pairKey("asset", "solvind"),
      pairKey("asset", "lerka"),
    ]);
    expect(files.get(pairKey("asset", "lerka"))).toEqual({
      kind: "asset",
      id: "lerka",
      label: "Lerka",
      aliases: [],
      refs: [{ kind: "registration", value: "ZZ-ABC" }],
      lines: [],
      registry: true,
      until: null,
    });
    expect(files.get(pairKey("place", "Hytta"))?.until).toBe("2026-10-02");
    const all = known(recordLines(root), root);
    expect(all.get(pairKey("asset", "solvind"))).toEqual({
      kind: "asset",
      id: "solvind",
      label: "Solvind",
      aliases: [],
      refs: [{ kind: "mmsi", value: "970000001" }],
      lines: [lineId(7)],
      registry: true,
      until: "2026-10-03",
    });
    expect(all.get(pairKey("place", "Hytta"))?.lines).toEqual([lineId(8)]);
    expect(all.size).toBe(10);
    expect(registry(tempDir()).size).toBe(0);
  });

  it("lookup: a ref, an id, a label or alias, an org's name without its legal form, a word of a label; the sentences", () => {
    const root = entitiesRecord();
    const all = known(recordLines(root), root);
    expect(lookup(all, "org", "verft").id).toBe(YARD_ID);
    expect(lookup(all, "org", "nv").id).toBe(YARD_ID);
    expect(lookup(all, "org", `domain:${YARD_DOMAIN}`).id).toBe(YARD_ID);
    expect(lookup(all, "org", "NORDMANN-VERFT.EXAMPLE.ORG").id).toBe(YARD_ID);
    expect(lookup(all, "org", YARD_ID).id).toBe(YARD_ID);
    expect(lookup(all, "org", "Nordmann Verft").id).toBe(YARD_ID);
    expect(lookup(all, "org", "fjordkiosk").id).toBe(KIOSK_ID);
    expect(lookup(all, "idea", "the").id).toBe(IDEA_ID);
    expect(lookup(all, "asset", "ZZ-ABC").id).toBe("lerka");
    expect(lookup(all, "place", "hytta").id).toBe("Hytta");
    expect(() => lookup(all, "org", "")).toThrow("name an org");
    expect(() => lookup(all, "org", "AS")).toThrow(
      `'AS' names 3 orgs: Nordmann Verft AS (${YARD_ID}), Fjordkiosk AS (${KIOSK_ID}), Havn Data AS (${HAVN_ID}); say which by id`,
    );
    expect(() => lookup(all, "org", "kiosk app")).toThrow(
      "no org is 'kiosk app' (the record's orgs: Nordmann Verft AS, Fjordkiosk AS, Havn Data AS)",
    );
    expect(() => lookup(all, "person", "x")).toThrow(
      "no person is 'x' (the record's persons: Ola Nordmann)",
    );
    expect(() => lookup(new Map(), "place", "x")).toThrow(
      "no place is 'x' (the record's places: none yet)",
    );
  });

  it("reviews: the org's no, the place's blank and RFC 0035's person, in chain order", () => {
    const found = reviews(recordLines(entitiesRecord()));
    expect(found.map((r) => [r.kind, r.entity, r.label, r.line])).toEqual([
      ["org", YARD_ID, "Nordmann Verft AS", lineId(9)],
      ["place", null, "Boathouse", lineId(10)],
      ["person", HANNA_ID, "Hanna Foss", lineId(11)],
    ]);
    expect(found[0]?.refs).toEqual([{ kind: "group", value: "nordmann verft sailing" }]);
    expect(found[0]?.at).toBe("2026-09-03T20:16:00Z");
  });

  it("statuses: the standing status lines per entity in chain order; a superseded or retracted one counts for nothing", () => {
    const found = statuses(recordLines(entitiesRecord()));
    const local = localDays(TZ);
    const yard = found.get(pairKey("org", YARD_ID)) ?? [];
    expect(
      yard.map((s) => [s.status, s.reason, s.proposed_by, s.proposal, s.since, s.line, s.seq]),
    ).toEqual([["hold", "orders through 2027", "dream", "let-go", null, lineId(13), 13]]);
    expect(yard.map((s) => statusDay(s, local))).toEqual(["2026-10-01"]);
    expect(yard[0]?.at).toBe("2026-10-01T10:00:00Z");
    expect(found.get(pairKey("org", KIOSK_ID))?.map((s) => statusDay(s, local))).toEqual([
      "2026-06-01",
    ]);
    expect(found.get(pairKey("idea", IDEA_ID))?.map((s) => s.status)).toEqual(["exploring"]);
    expect(found.get(pairKey("idea", FERRY_ID))?.map((s) => s.status)).toEqual(["spark"]);
    expect(found.get(pairKey("asset", "lerka"))?.map((s) => [s.proposed_by, s.label])).toEqual([
      [null, "Lerka"],
    ]);
    expect(found.has(pairKey("org", HAVN_ID))).toBe(false);
  });

  it("muted: the current status, with a reason, answering a proposal of the disposition with another, for mute_days from its day", () => {
    const found = statuses(recordLines(entitiesRecord()));
    const local = localDays(TZ);
    const yard = found.get(pairKey("org", YARD_ID)) ?? [];
    expect(muted(yard, "let-go", TODAY, local)?.line).toBe(lineId(13));
    expect(muted(yard, "let-go", TODAY, local, 400)?.line).toBe(lineId(13));
    expect(muted(yard, "exited", TODAY, local)).toBeUndefined();
    expect(muted(yard, "hold", TODAY, local)).toBeUndefined();
    expect(muted(yard, "let-go", "2026-09-30", local)).toBeUndefined();
    expect(muted(yard, "let-go", "2026-10-01", local)?.line).toBe(lineId(13));
    expect(muted(yard, "let-go", "2027-09-30", local)?.line).toBe(lineId(13));
    expect(muted(yard, "let-go", "2027-10-01", local)).toBeUndefined();
    expect(muted(yard, "let-go", "2027-11-04", local, 400)?.line).toBe(lineId(13));
    expect(muted(yard, "let-go", "2027-11-05", local, 400)).toBeUndefined();
    expect(muted([], "let-go", TODAY, local)).toBeUndefined();
    expect(
      muted(found.get(pairKey("org", KIOSK_ID)) ?? [], "passed", TODAY, local),
    ).toBeUndefined();
  });

  it("stale: a hold over three years, an exploring over two, or what the settings say; never otherwise", () => {
    const found = statuses(recordLines(entitiesRecord()));
    const local = localDays(TZ);
    const [current] = found.get(pairKey("org", YARD_ID)) as [never];
    const early = {
      kind: "org",
      entity: YARD_ID,
      label: "Nordmann Verft AS",
      status: "hold",
      reason: "early",
      proposed_by: "owner",
      proposal: null,
      since: null,
      at: "2023-01-02T22:59:00Z",
      line: lineId(12),
      seq: 12,
    };
    expect(stale(early, TODAY, local)).toBe(true);
    // 1095 days after 2023-01-02 (2024 is a leap year) is 2026-01-01: stale from the day after.
    expect(stale(early, "2026-01-01", local)).toBe(false);
    expect(stale(early, "2026-01-02", local)).toBe(true);
    expect(stale(current, TODAY, local)).toBe(false);
    const [spark] = found.get(pairKey("idea", FERRY_ID)) as [never];
    expect(stale(spark, TODAY, local)).toBe(false);
    expect(stale(spark, TODAY, local, { ...STALE_DAYS, spark: 10 })).toBe(true);
    expect(stale(spark, "2026-10-05", local, { spark: 10 })).toBe(false);
    expect(STALE_DAYS).toEqual({ hold: 1095, exploring: 730 });
  });

  it("the local day of a status is its since, else the line's day in the record's zone under day_start", () => {
    const local = localDays(TZ);
    expect(local("2026-10-02T22:30:00Z")).toBe("2026-10-03");
    expect(localDays(TZ, "06:00")("2026-10-02T01:30:00Z")).toBe("2026-10-01");
    expect(() => local("not a date")).toThrow(EntityError);
  });
});

// -- the settings ----------------------------------------------------------------------------------------

describe("policy/entities.json, read as the reference's read_settings reads it", () => {
  const withPolicy = (text: string): string => {
    const root = tempDir();
    mkdirSync(join(root, "policy"));
    writeFileSync(join(root, "policy", "entities.json"), text, "utf-8");
    return root;
  };
  const path = (root: string): string => join(root, "policy", "entities.json");

  it("is the defaults without the file; the file's lists extend them and its numbers replace them", () => {
    const defaults = readEntitySettings(tempDir());
    expect(defaults).toEqual({
      public_mail_providers: [
        "gmail.com",
        "outlook.com",
        "hotmail.com",
        "icloud.com",
        "me.com",
        "proton.me",
        "yahoo.com",
        "example.org",
      ],
      public_suffixes: [],
      code_hosts: ["github.com", "gitlab.com", "codeberg.org"],
      merchant_min_lines: 3,
      title_min_lines: 2,
      registration_min_flights: 3,
      mute_days: 365,
      stale_days: { hold: 1095, exploring: 730 },
    });
    const read = readEntitySettings(
      withPolicy(
        JSON.stringify({
          public_mail_providers: [" Example.NET ", "gmail.com"],
          public_suffixes: ["Club.Example"],
          code_hosts: ["git.example.org"],
          mute_days: 400,
          stale_days: { spark: 10, hold: 2000 },
          title_min_lines: 5,
        }),
      ),
    );
    expect(read.public_mail_providers).toEqual([...defaults.public_mail_providers, "example.net"]);
    expect(read.public_suffixes).toEqual(["club.example"]);
    expect(read.code_hosts).toEqual(["git.example.org"]);
    expect([read.mute_days, read.title_min_lines, read.merchant_min_lines]).toEqual([400, 5, 3]);
    expect(read.stale_days).toEqual({ hold: 2000, exploring: 730, spark: 10 });
    expect(readEntitySettings(entitiesRecord()).stale_days).toEqual({
      hold: 1095,
      exploring: 730,
      spark: 10,
    });
  });

  it("refuses a file that is not what it should be, naming the file and the key, in the reference's words", () => {
    let root = withPolicy("nope");
    expect(() => readEntitySettings(root)).toThrow(EntityError);
    expect(() => readEntitySettings(root)).toThrow(
      new RegExp(`^${path(root).replace(/[\\]/g, "\\\\")} is not JSON: `),
    );
    root = withPolicy("[]");
    expect(() => readEntitySettings(root)).toThrow(`${path(root)} must be an object`);
    for (const bad of [0, -1, true, "3", 1.5, null]) {
      root = withPolicy(JSON.stringify({ mute_days: bad }));
      expect(() => readEntitySettings(root), JSON.stringify(bad)).toThrow(
        `${path(root)}: mute_days must be a whole number from 1`,
      );
    }
    for (const bad of [[], { hold: true }, { hold: 0 }, { hold: "3" }, { hold: 1.5 }]) {
      root = withPolicy(JSON.stringify({ stale_days: bad }));
      expect(() => readEntitySettings(root), JSON.stringify(bad)).toThrow(
        `${path(root)}: stale_days must map a status to a whole number of days`,
      );
    }
    for (const key of ["code_hosts", "public_mail_providers", "public_suffixes"]) {
      for (const bad of ["x", [""], [" "], [5]]) {
        root = withPolicy(JSON.stringify({ [key]: bad }));
        expect(() => readEntitySettings(root), `${key} ${JSON.stringify(bad)}`).toThrow(
          `${path(root)}: ${key} must be a list of names`,
        );
      }
    }
    // stale_days is checked first, then code_hosts, then the rest in the Settings' order.
    root = withPolicy(JSON.stringify({ mute_days: 0, code_hosts: "x", stale_days: [] }));
    expect(() => readEntitySettings(root)).toThrow("stale_days must map");
    root = withPolicy(JSON.stringify({ mute_days: 0, code_hosts: "x" }));
    expect(() => readEntitySettings(root)).toThrow("code_hosts must be");
    root = withPolicy(
      JSON.stringify({ mute_days: 0, public_suffixes: "x", merchant_min_lines: 0 }),
    );
    expect(() => readEntitySettings(root)).toThrow("public_suffixes must be");
    root = withPolicy(JSON.stringify({ mute_days: 0, merchant_min_lines: 0 }));
    expect(() => readEntitySettings(root)).toThrow("merchant_min_lines must be");
  });
});

// -- the whole-line checks -------------------------------------------------------------------------------

describe("entityLineProblems: what the reference's writers check before appending, on a whole line", () => {
  it("the validator's problems, then the tier rules against the cited lines the record holds", () => {
    const all = recordLines(entitiesRecord());
    const tiers = new Map(all.map((l) => [l.id, l.tier as number]));
    for (const l of all) {
      if (["entity", "entity-review", "status"].includes(l.kind) && l.seq !== 27) {
        expect(entityLineProblems(l, tiers), String(l.seq)).toEqual([]);
      }
    }
    const lerka = all.find((l) => l.seq === 27) as Line;
    expect(entityLineProblems(lerka, tiers)).toEqual(["proposed_by must be one of dream, owner"]);
    const held = all.find((l) => l.seq === 13) as Line;
    expect(entityLineProblems({ ...held, tier: 2 }, tiers)).toEqual([
      "a status/v1 line about an org is tier 3, not 2: its dispositions describe a position in money",
    ]);
    expect(entityLineProblems({ ...held, tier: 2 }, new Map())).toEqual([
      "a status/v1 line about an org is tier 3, not 2: its dispositions describe a position in money",
    ]);
    const idea = all.find((l) => l.seq === 16) as Line;
    const citing = { ...idea, payload: { ...idea.payload, evidence: [lineId(1), "not-a-line"] } };
    expect(entityLineProblems(citing, tiers)).toEqual([
      `a status/v1 line about an idea never cites a tier-3 line (${lineId(1)} is tier 3): no money on the line, and the ledger is read at the page, within its ceiling`,
    ]);
    expect(entityLineProblems(citing, new Map())).toEqual([]);
    const review = all.find((l) => l.seq === 9) as Line;
    expect(
      entityLineProblems(
        { ...review, payload: { ...review.payload, evidence: [lineId(1)] } },
        tiers,
      ),
    ).toEqual(["an entity-review/v1 line citing this evidence is tier 3, not 2"]);
  });

  it("goes by the line's kind, so a wrong schema is named in the reference's words; a kind of another profile is this implementation's sentence", () => {
    const entity = line(1, "entity", 2, {
      schema: "status/v1",
      entity: { type: "org", id: YARD_ID, registry: "logbook" },
      label: "x",
    });
    expect(entityLineProblems(entity, new Map())).toEqual([
      "schema is 'status/v1', not 'entity/v1'",
    ]);
    const note = line(2, "note", 2, { schema: "note/v1", text: "x" });
    expect(entityLineProblems(note, new Map())).toEqual([
      "kind must be one of entity, entity-review, status, not 'note'",
    ]);
    const company = line(3, "status", 3, {
      schema: "status/v1",
      entity: { type: "company", id: YARD_ID, registry: "logbook" },
      status: "hold",
      proposed_by: "owner",
    });
    expect(entityLineProblems(company, new Map())).toEqual([
      "entity.type 'company' is not one of org, idea, place, asset",
    ]);
  });
});

describe("orgReasonProblems: an org's status reason is never a tier-2 note (RFC 0037 §8, §10.2, §10.5; this implementation's check)", () => {
  const orgStatus = (seq: number, fields: Fields = {}): Line =>
    line(seq, "status", 3, {
      schema: "status/v1",
      entity: { type: "org", id: YARD_ID, registry: "logbook" },
      status: "hold",
      reason: "orders",
      proposed_by: "owner",
      ...fields,
    });
  const statusNote = (seq: number, extra: Fields, tier = 2, labels: JsonValue = ["status"]): Line =>
    line(seq, "note", tier, { schema: "note/v1", text: "orders", labels, extra });

  it("has nothing against the synthetic record", () => {
    expect(orgReasonProblems(recordLines(entitiesRecord()))).toEqual([]);
  });

  it("names a status line about an org with a note, a status note about an org or answering an org's status, and a status note above tier 2", () => {
    const found = orgReasonProblems([
      orgStatus(1, { note: lineId(2) }),
      statusNote(2, {
        status: lineId(1),
        entity: { type: "org", id: YARD_ID, registry: "logbook" },
      }),
      statusNote(3, { status: lineId(1) }),
      statusNote(4, { entity: { type: "company", id: YARD_ID, registry: "logbook" } }),
      statusNote(5, { entity: { type: "idea", id: IDEA_ID, registry: "logbook" } }, 3),
      statusNote(6, { entity: { type: "idea", id: IDEA_ID, registry: "logbook" } }),
      statusNote(7, { entity: { type: "org", id: YARD_ID, registry: "logbook" } }, 2, ["other"]),
    ]);
    expect(found).toEqual([
      `${lineId(1)}: a status/v1 line about an org names a note; an org's reason stays on its tier-3 line and is never a note (RFC 0037 §10.5)`,
      `${lineId(2)}: a note/v1 line labelled status is about an org; an org's reason stays on its tier-3 line and is never a note (RFC 0037 §10.5)`,
      `${lineId(3)}: a note/v1 line labelled status answers an org's status line, ${lineId(1)}; an org's reason stays on its tier-3 line and is never a note (RFC 0037 §10.5)`,
      `${lineId(4)}: a note/v1 line labelled status is about an org; an org's reason stays on its tier-3 line and is never a note (RFC 0037 §10.5)`,
      `${lineId(5)}: a note/v1 line labelled status is tier 3; a note is tier 2 (RFC 0010), and no status writes one above it (RFC 0037 §10.5)`,
    ]);
  });

  it("reads standing lines only: a retracted status or note counts for nothing", () => {
    const retraction = (seq: number, target: string): Line =>
      line(seq, "retraction", 2, { schema: "retraction/v1", supersedes: target });
    expect(
      orgReasonProblems([
        orgStatus(1, { note: lineId(2) }),
        statusNote(2, {
          status: lineId(1),
          entity: { type: "org", id: YARD_ID, registry: "logbook" },
        }),
        retraction(3, lineId(1)),
        retraction(4, lineId(2)),
      ]),
    ).toEqual([]);
  });
});

// -- status list -----------------------------------------------------------------------------------------

describe("status list KIND: every canonical entity of the kind with its current status, as the reference prints it", () => {
  const TODAY = "2026-10-15";

  it("reads a line's day under day_start, whatever flag is on, as the reference's `status list` always does", () => {
    // A hold at 03:30 Oslo on 2026-10-02 with day_start 06:00: the reference says `hold since
    // 2026-10-01` (the independent review found this one reading it at midnight under rfc0037 alone).
    const root = dayStartRecord();
    for (const flags of ["", "rfc0037", "rfc0036,rfc0037"]) {
      process.env.LOGBOOK_TS_FLAGS = flags;
      try {
        const [row] = statusListing(root, "org", TODAY).rows;
        expect({ flags, since: row?.since }).toEqual({ flags, since: "2026-10-01" });
      } finally {
        delete process.env.LOGBOOK_TS_FLAGS;
      }
    }
  });

  it("refuses a kind that takes no status, in the reference's words", () => {
    expect(() => checkKind("person")).toThrow(StatusError);
    expect(() => checkKind("person")).toThrow(
      "a person has no status (RFC 0037): people are reviewed, never disposed of",
    );
    expect(() => checkKind("goal")).toThrow(
      "a goal is reviewed by review/v1 (RFC 0036), not given a status",
    );
    expect(() => checkKind("thing")).toThrow(
      "a status is for an org, idea, place, asset; not for 'thing'",
    );
    expect(() => checkKind("company")).toThrow(
      "a status is for an org, idea, place, asset; not for 'company'",
    );
    expect(() => checkKind("")).toThrow("a status is for an org, idea, place, asset; not for ''");
    for (const kind of ["org", "idea", "place", "asset"])
      expect(() => checkKind(kind)).not.toThrow();
    const root = entitiesRecord();
    expect(() => statusListing(root, "person", TODAY)).toThrow(StatusError);
    expect(() => statusListing(root, "person", TODAY)).toThrow(LogbookError);
  });

  it("prints the orgs: the most recent status first, then those with none; the reason under the row; the mute", () => {
    const listing = statusListing(entitiesRecord(), "org", TODAY);
    expect(listing.on).toBe(TODAY);
    expect(listing.rows.map((r) => r.entity.label)).toEqual([
      "Nordmann Verft AS",
      "Fjordkiosk AS",
      "Havn Data AS",
    ]);
    expect(statusListingText(listing)).toBe(
      [
        "status · 3 orgs · 2026-10-15",
        "  Nordmann Verft AS  hold since 2026-10-01 (dream proposed let-go) · not proposed: let-go to 2027-11-04",
        "                     reason: orders through 2027",
        "  Fjordkiosk AS      passed since 2026-06-01 (dream proposed passed)",
        "                     reason: good team, but a kiosk is a place and I do not want to own places",
        "  Havn Data AS       —",
        "",
      ].join("\n"),
    );
    expect(statusListingJson(listing)).toEqual({
      kind: "org",
      on: TODAY,
      entities: [
        {
          id: YARD_ID,
          label: "Nordmann Verft AS",
          key: `domain:${YARD_DOMAIN}`,
          status: "hold",
          since: "2026-10-01",
          reason: "orders through 2027",
          proposed_by: "dream",
          line: lineId(13),
          note: null,
          stale: false,
          muted: [{ status: "let-go", until: "2027-11-04" }],
          until: null,
          portfolio: null,
        },
        {
          id: KIOSK_ID,
          label: "Fjordkiosk AS",
          key: "domain:fjordkiosk.example.org",
          status: "passed",
          since: "2026-06-01",
          reason: "good team, but a kiosk is a place and I do not want to own places",
          proposed_by: "dream",
          line: lineId(14),
          note: null,
          stale: false,
          muted: [],
          until: null,
          portfolio: null,
        },
        {
          id: HAVN_ID,
          label: "Havn Data AS",
          key: "domain:havn-data.example.org",
          status: null,
          since: null,
          reason: null,
          proposed_by: null,
          line: null,
          note: null,
          stale: false,
          muted: [],
          until: null,
          portfolio: null,
        },
      ],
    });
  });

  it("prints the ideas: a retracted killing leaves the spark standing, and the settings' stale_days mark it", () => {
    const listing = statusListing(entitiesRecord(), "idea", TODAY);
    expect(statusListingText(listing)).toBe(
      [
        "status · 2 ideas · 2026-10-15",
        "  the fjord kiosk  exploring since 2026-10-02 (owner)",
        "                   reason: pricing page written",
        "  Fjord ferry app  spark since 2026-09-25 (owner) · stale",
        "",
      ].join("\n"),
    );
    const [kiosk, ferry] = statusListingJson(listing).entities;
    expect([kiosk?.status, kiosk?.since, kiosk?.stale, kiosk?.key]).toEqual([
      "exploring",
      "2026-10-02",
      false,
      "repo:git.example.org/nordmann-verft/kiosk",
    ]);
    expect([ferry?.status, ferry?.since, ferry?.stale, ferry?.line]).toEqual([
      "spark",
      "2026-09-25",
      true,
      lineId(22),
    ]);
  });

  it("prints the places and the assets: until is the standing line's day, never the file's; the width is in code points", () => {
    const root = entitiesRecord();
    expect(statusListingText(statusListing(root, "place", TODAY))).toBe(
      [
        "status · 2 places · 2026-10-15",
        "  Hytta       let-go since 2026-10-02 (owner) · until 2026-10-02",
        "              reason: sold the cabin",
        "  Båtplassen  —",
        "",
      ].join("\n"),
    );
    expect(statusListingText(statusListing(root, "asset", TODAY))).toBe(
      [
        "status · 2 assets · 2026-10-15",
        "  Lerka    let-go since 2026-10-05 (owner) · until 2026-10-05",
        "           reason: lease ended",
        "  Solvind  sold since 2026-10-03 (owner) · until 2026-10-03",
        "",
      ].join("\n"),
    );
    const places = statusListingJson(statusListing(root, "place", TODAY)).entities;
    expect(places.map((p) => [p.id, p.status, p.until, p.key])).toEqual([
      ["Hytta", "let-go", "2026-10-02", "place:hytta"],
      ["Båtplassen", null, null, "place:båtplassen"],
    ]);
  });

  it("says so when the kind has no entity yet, as the reference does, and counts one without an s", () => {
    const bare = writeBareRecord([]);
    expect(statusListingText(statusListing(bare, "org", TODAY))).toBe(
      "status · 0 orgs · 2026-10-15\nno org yet: `review org` names them\n",
    );
    expect(statusListingJson(statusListing(bare, "idea", TODAY))).toEqual({
      kind: "idea",
      on: TODAY,
      entities: [],
    });
    const one = writeBareRecord([]);
    writeFileSync(
      join(one, "places.json"),
      JSON.stringify({ Hytta: { lat: 59.9, lon: 10.75 } }),
      "utf-8",
    );
    expect(statusListingText(statusListing(one, "place", TODAY))).toBe(
      "status · 1 place · 2026-10-15\n  Hytta  —\n",
    );
  });

  // The reference's test_status_list_says_the_current_status_the_stale_and_the_muted, with a fixed today.
  it("says the current status, the stale and the muted", () => {
    const MUTED_TO = "2027-10-14"; // the 365th day, today counted
    const A_YEAR_ON = "2027-10-15";
    const yard = (fields: Fields): Line["payload"] =>
      ({
        schema: "status/v1",
        entity: { type: "org", id: YARD_ID, registry: "logbook" },
        label: "Nordmann Verft AS",
        ...fields,
      }) as unknown as Line["payload"];
    const company = {
      at: "2026-08-01T08:00:00Z",
      source: "manual",
      kind: "resolution",
      tier: 2 as const,
      payload: {
        schema: "resolution/v1",
        ref: { kind: "domain", value: YARD_DOMAIN },
        entity: { type: "company", id: YARD_ID, registry: "logbook" },
        label: "Nordmann Verft AS",
        method: "owner",
      },
    };
    const early = {
      at: "2023-01-02T22:59:00Z",
      source: "manual",
      kind: "status",
      tier: 3 as const,
      payload: yard({ status: "hold", reason: "early", proposed_by: "owner" }),
    };
    let root = writeRecord([company, early], TZ);
    let found = statusListing(root, "org", TODAY);
    expect(found.rows).toHaveLength(1);
    const [row] = found.rows;
    expect([row?.current?.status, row?.since, row?.stale]).toEqual(["hold", "2023-01-02", true]);
    let out = statusListingText(found);
    expect(out).toContain("hold since 2023-01-02 (owner)");
    expect(out).toContain("stale");
    expect(out).toContain("reason: early");
    // the dream proposed let-go; the owner held, and said why: let-go is muted for 365 days
    const held = {
      at: "2026-10-15T10:00:00Z",
      source: "manual",
      kind: "status",
      tier: 3 as const,
      payload: yard({
        status: "hold",
        reason: "orders through 2027",
        proposed_by: "dream",
        proposal: { status: "let-go", score: 30, because: ["no touch for 365 days"] },
        supersedes: lineId(2),
      }),
    };
    root = writeRecord([company, early, held], TZ);
    const rows = statusListingJson(statusListing(root, "org", TODAY)).entities;
    expect(rows[0]?.muted).toEqual([{ status: "let-go", until: MUTED_TO }]);
    expect(rows[0]?.stale).toBe(false);
    expect(rows[0]?.proposed_by).toBe("dream");
    const later = statusListingJson(statusListing(root, "org", A_YEAR_ON)).entities;
    expect(later[0]?.muted).toEqual([]);
    const history = statuses(recordLines(root)).get(pairKey("org", YARD_ID)) ?? [];
    const local = localDays(TZ);
    expect(muted(history, "let-go", MUTED_TO, local)).toBeDefined();
    expect(muted(history, "exited", TODAY, local)).toBeUndefined();
    found = statusListing(root, "org", TODAY);
    out = statusListingText(found);
    expect(out).toContain(
      "hold since 2026-10-15 (dream proposed let-go) · not proposed: let-go to 2027-10-14",
    );
    expect(statusListingJson(found).entities[0]?.status).toBe("hold");
  });

  // The reference's test_a_place_let_go_and_an_asset_sold_close_their_entries_with_until, read-only half.
  it("an asset sold is closed with until, the standing line's day; retracting the line reopens it, never the file's copy", () => {
    const sold = {
      at: "2026-10-15T10:00:00Z",
      source: "manual",
      kind: "status",
      tier: 2 as const,
      payload: {
        schema: "status/v1",
        entity: { type: "asset", id: "solvind", registry: "logbook" },
        label: "Solvind",
        status: "sold",
        proposed_by: "owner",
      },
    };
    const withRegistry = (drafts: Parameters<typeof writeRecord>[0]): string => {
      const root = writeRecord(drafts, TZ);
      writeFileSync(
        join(root, "assets.json"),
        JSON.stringify({
          assets: [
            { ...ASSETS.assets[0], until: TODAY },
            { ...ASSETS.assets[1], registration: "ZZABC" },
          ],
        }),
        "utf-8",
      );
      return root;
    };
    let listing = statusListingJson(statusListing(withRegistry([sold]), "asset", TODAY));
    expect(listing.entities.map((e) => [e.id, e.status, e.until])).toEqual([
      ["solvind", "sold", TODAY],
      ["lerka", null, null],
    ]);
    const retraction = {
      at: "2026-10-15T11:00:00Z",
      source: "manual",
      kind: "retraction",
      tier: 2 as const,
      payload: { schema: "retraction/v1", supersedes: lineId(1), reason: "not sold after all" },
    };
    listing = statusListingJson(statusListing(withRegistry([sold, retraction]), "asset", TODAY));
    expect(listing.entities[0]?.until).toBeNull();
    expect(listing.entities[0]?.status).toBeNull();
  });

  // The reference's test_a_retracted_status_counts_for_nothing_and_the_one_before_stands.
  it("a retracted status counts for nothing and the one before stands", () => {
    const [row] = statusListing(entitiesRecord(), "idea", TODAY).rows.filter(
      (r) => r.entity.id === FERRY_ID,
    );
    expect([row?.current?.status, row?.since]).toEqual(["spark", "2026-09-25"]);
  });

  it("today defaults to today in the record's zone, by the clock given", () => {
    const root = writeBareRecord([]);
    expect(statusListing(root, "org", undefined, new Date("2026-10-15T22:30:00Z")).on).toBe(
      "2026-10-16",
    );
    expect(statusListing(root, "org").on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("refuses a record it does not carry, and a settings file that is not one", () => {
    const root = entitiesRecord();
    const meta = JSON.parse(readFileSync(join(root, "logbook.json"), "utf-8")) as Record<
      string,
      unknown
    >;
    writeFileSync(
      join(root, "logbook.json"),
      JSON.stringify({ ...meta, format: "logbook/0.1" }),
      "utf-8",
    );
    expect(() => statusListing(root, "org", TODAY)).toThrow(/logbook\/0\.1/);
    writeFileSync(join(root, "logbook.json"), JSON.stringify(meta), "utf-8");
    writeFileSync(join(root, "policy", "entities.json"), "[]", "utf-8");
    expect(() => statusListing(root, "org", TODAY)).toThrow(
      `${join(root, "policy", "entities.json")} must be an object`,
    );
  });
});

describe("status list: an org's portfolio and the note that holds a reason (RFC 0037's amendment of 2026-10-15, §10.2, §10.5)", () => {
  // Every expected value is the reference's `status list` at b82a11c (0.7.0) on the same record.
  const TODAY = "2026-10-18";

  it("reads an org's portfolio from its latest status line that carries one as text, words collapsed; retracted lines count for nothing, an empty one clears it", () => {
    const listing = statusListing(portfolioRecord(), "org", TODAY);
    expect(statusListingText(listing)).toBe(
      [
        "status · 5 orgs · 2026-10-18",
        "  Fjordkiosk AS      hold since 2026-10-04 (owner) · portfolio Angel",
        "  Havn Data AS       hold since 2026-10-04 (owner)",
        "  Nordmann Verft AS  add since 2026-10-03 (owner) · portfolio Fund I",
        "  Kaia AS            hold since 2026-10-02 (owner) · portfolio Fund I · not proposed: let-go to 2027-10-01",
        "                     reason: orders",
        "  Gamle Verft AS     hold since 2020-10-02 (owner) · portfolio Fund II · stale",
        "                     reason: long",
        "",
      ].join("\n"),
    );
    expect(statusListingJson(listing).entities.map((e) => [e.label, e.portfolio, e.note])).toEqual([
      ["Fjordkiosk AS", "Angel", null],
      ["Havn Data AS", null, null],
      ["Nordmann Verft AS", "Fund I", null],
      ["Kaia AS", "Fund I", null],
      ["Gamle Verft AS", "Fund II", null],
    ]);
  });

  it("names the note that holds a status's reason: the latest one labelled status, not retracted", () => {
    const listing = statusListing(statusNotesRecord(), "idea", TODAY);
    expect(statusListingJson(listing).entities.map((e) => [e.label, e.note, e.portfolio])).toEqual([
      ["gamma boat", null, null],
      ["beta ferry", null, null],
      ["alpha kiosk", "00000000-0000-4000-8000-000000000006", null],
    ]);
  });

  it("refuses a portfolio on any status line but an org's, and one that is not text", () => {
    const base = { schema: "status/v1", proposed_by: "owner", reason: "x" };
    const only =
      "portfolio: only an org's status line carries one (RFC 0037 §10.2): which portfolio holds a company is a position in money, on the org's tier-3 line";
    const text = "portfolio must be the portfolio's name, free text, or empty to clear it";
    const org = { type: "org", id: "019cadd3-6bc0-7dcd-9133-000000000201", registry: "logbook" };
    expect(statusProblems({ ...base, entity: org, status: "hold", portfolio: "Fund I" })).toEqual(
      [],
    );
    expect(statusProblems({ ...base, entity: org, status: "hold", portfolio: "" })).toEqual([]);
    expect(statusProblems({ ...base, entity: org, status: "hold", portfolio: 5 })).toEqual([text]);
    expect(
      statusProblems({
        ...base,
        entity: { type: "asset", id: "solvind", registry: "logbook" },
        status: "sold",
        portfolio: 5,
      }),
    ).toEqual([text, only]);
    expect(
      statusProblems({
        ...base,
        entity: { type: "place", id: "Hytta", registry: "logbook" },
        status: "let-go",
        portfolio: "Fund I",
      }),
    ).toEqual([only]);
  });
});
