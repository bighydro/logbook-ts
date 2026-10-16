import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkKind,
  fold,
  keyOf,
  kindOf,
  orgName,
  registeredDomain,
  registrationKey,
  repoOrg,
  reviewTier,
  statusListing,
  statusListingJson,
  statusListingText,
  statusTier,
  tierProblems,
  titleKey,
  VALIDATORS,
  words,
} from "../src/entities.js";
import { FLAGS_ENV } from "../src/flags.js";
import type { JsonValue } from "../src/types.js";
import { dayStartRecord, entitiesRecord } from "./entities-record.js";
import { cleanup, FIXTURES, readMetaFile, writeMeta } from "./helpers.js";

/**
 * RFC 0037 (draft), under the rfc0037 flag: the two implementations must validate a payload with the
 * same sentences in the same order, and list the statuses of a kind the same. This test runs the
 * reference's validators once, in one Python process reading JSON on stdin, on every payload variant
 * below, and its `logbook status list KIND [--json]` on a synthetic record, and diffs ours against
 * them. It needs LOGBOOK_REF, a clone of https://github.com/bighydro/logbook, with `uv` on the path;
 * without it the test is skipped, so the default `pnpm test` never spawns anything.
 */
const REF = process.env.LOGBOOK_REF;
const ready = REF !== undefined && existsSync(join(REF, "pyproject.toml"));

afterEach(cleanup);
afterEach(() => {
  vi.unstubAllEnvs();
});

type Fields = Record<string, JsonValue>;
type Outcome = { ok: unknown } | { error: string };

const example = (name: string): Fields =>
  (JSON.parse(readFileSync(join(FIXTURES, "entities", `${name}.json`), "utf-8")) as Fields)
    .payload as Fields;

const ORG_ID = "019cadd3-6bc0-7dcd-9133-000000000201";
const IDEA_ID = "019cadd3-6bc0-7dcd-9133-000000000301";
const PERSON_ID = "019cadd3-6bc0-7dcd-9133-000000000121";
const MONEY = "019cadd3-6bc0-7dcd-9133-0000000001d1";

/** `{"a": 1}` on top of a payload; a value of undefined removes the key. */
function edit(base: Fields, fields: Record<string, JsonValue | undefined>): Fields {
  const out: Fields = { ...base };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  return out;
}

function variants(): Array<{ name: string; schema: string; payload: Fields }> {
  const org = example("org");
  const review = example("review-org");
  const passed = example("passed");
  const entity = (fields: Record<string, JsonValue | undefined>): Fields =>
    edit(org, { entity: edit(org.entity as Fields, fields) });
  const found: Array<[string, Fields]> = [
    ["entity: the example", org],
    ["entity: another schema", edit(org, { schema: "entity/v2" })],
    ["entity: no schema", edit(org, { schema: undefined })],
    ["entity: entity not an object", edit(org, { entity: "x" })],
    ["entity: type company", entity({ type: "company" })],
    ["entity: no type", edit(org, { entity: { id: ORG_ID } })],
    ["entity: no id", entity({ id: undefined })],
    ["entity: id empty", entity({ id: "" })],
    ["entity: a v4 id", entity({ id: "1f2e3d4c-0000-4000-8000-000000000001" })],
    [
      "entity: a v7 id with another variant",
      entity({ id: "019cadd3-6bc0-7dcd-c133-000000000201" }),
    ],
    ["entity: an uppercase id", entity({ id: "019CADD3-6BC0-7DCD-9133-000000000201" })],
    ["entity: an org id with a trailing newline", entity({ id: `${ORG_ID}\n` })],
    ["entity: an idea with id x", entity({ type: "idea", id: "x" })],
    [
      "entity: a person with id x",
      edit(org, { entity: { type: "person", id: "x", registry: "logbook" } }),
    ],
    [
      "entity: a person with no refs",
      edit(org, { entity: { type: "person", id: PERSON_ID, registry: "logbook" }, refs: [] }),
    ],
    [
      "entity: a person with refs",
      edit(org, { entity: { type: "person", id: PERSON_ID, registry: "logbook" } }),
    ],
    [
      "entity: a person with a newline after its id",
      edit(org, {
        entity: { type: "person", id: `${PERSON_ID}\n`, registry: "logbook" },
        refs: [],
      }),
    ],
    ["entity: an asset with a bad id", entity({ type: "asset", id: "Solvind!" })],
    ["entity: an asset id with a trailing newline", entity({ type: "asset", id: "solvind\n" })],
    ["entity: an asset id starting with a hyphen", entity({ type: "asset", id: "-x" })],
    ["entity: a place with a blank id", entity({ type: "place", id: " " })],
    ["entity: a place", entity({ type: "place", id: "Hytta" })],
    ["entity: registry crm", entity({ registry: "crm" })],
    ["entity: no registry", entity({ registry: undefined })],
    ["entity: no label", edit(org, { label: undefined })],
    ["entity: a blank label", edit(org, { label: " " })],
    ["entity: a label that is a number", edit(org, { label: 5 })],
    ["entity: a label that is true", edit(org, { label: true })],
    ["entity: refs not a list", edit(org, { refs: "x" })],
    ["entity: refs true", edit(org, { refs: true })],
    [
      "entity: refs of every wrong shape",
      edit(org, {
        refs: [
          5,
          { kind: "domain" },
          { value: "x" },
          { kind: "domain", value: " " },
          { kind: ["a"], value: "x" },
          { kind: "mmsi", value: 5 },
        ],
      }),
    ],
    ["entity: a ref kind of another profile", edit(org, { refs: [{ kind: "url", value: "x" }] })],
    ["entity: aliases a string", edit(org, { aliases: "x" })],
    ["entity: aliases with an empty one", edit(org, { aliases: ["a", ""] })],
    ["entity: aliases with a number", edit(org, { aliases: ["a", 5] })],
    ["entity: aliases empty", edit(org, { aliases: [] })],
    ["entity: keys a string", edit(org, { keys: "x" })],
    ["entity: keys with an empty value", edit(org, { keys: { org: "" } })],
    ["entity: keys with a true value", edit(org, { keys: { org: true } })],
    ["entity: keys empty", edit(org, { keys: {} })],
    ["entity: method empty", edit(org, { method: "" })],
    ["entity: method a number", edit(org, { method: 5 })],
    ["entity: evidence a string", edit(org, { evidence: "x" })],
    ["entity: evidence with an empty id", edit(org, { evidence: [""] })],
    ["entity: supersedes empty", edit(org, { supersedes: "" })],
    ["entity: supersedes a number", edit(org, { supersedes: 5 })],
    ["entity: logbook_head elided", edit(org, { logbook_head: "8f1c…" })],
    [
      "entity: logbook_head uppercase",
      edit(org, {
        logbook_head: "8F1C000000000000000000000000000000000000000000000000000000000000",
      }),
    ],
    [
      "entity: logbook_head with a trailing newline",
      edit(org, {
        logbook_head: "8f1c000000000000000000000000000000000000000000000000000000000000\n",
      }),
    ],
    ["entity: logbook_head a number", edit(org, { logbook_head: 5 })],
    ["entity: extra a string", edit(org, { extra: "x" })],
    ["entity: extra a list", edit(org, { extra: [] })],
    ["entity: extra null", edit(org, { extra: null })],
    ["entity: extra true", edit(org, { extra: true })],
    [
      "entity: everything wrong at once",
      {
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
      },
    ],
    ["review: the org's no", review],
    ["review: the place's no", example("review-place")],
    ["review: another schema", edit(review, { schema: "x" })],
    ["review: verdict same", edit(review, { verdict: "same" })],
    ["review: no verdict", edit(review, { verdict: undefined })],
    ["review: no ref", edit(review, { ref: undefined })],
    ["review: ref kind url", edit(review, { ref: { kind: "url", value: "x" } })],
    ["review: ref kind name", edit(review, { ref: { kind: "name", value: "ola nordmann" } })],
    ["review: ref kind subject", edit(review, { ref: { kind: "subject", value: "solvind" } })],
    ["review: ref value empty", edit(review, { ref: { kind: "name", value: "" } })],
    ["review: refs not a list", edit(review, { refs: {} })],
    ["review: refs kind url", edit(review, { refs: [{ kind: "url", value: "x" }] })],
    ["review: observed a string", edit(review, { observed: "x" })],
    ["review: observed with an empty name", edit(review, { observed: [""] })],
    ["review: no entity", edit(review, { entity: undefined })],
    ["review: a person by type alone", edit(review, { entity: { type: "person" } })],
    ["review: an org by type alone", edit(review, { entity: { type: "org" } })],
    ["review: a goal", edit(review, { entity: { type: "goal" } })],
    [
      "review: an org with a bad id and no registry",
      edit(review, { entity: { type: "org", id: "x" } }),
    ],
    [
      "review: a place with its name and no registry",
      edit(review, { entity: { type: "place", id: "Hytta" } }),
    ],
    ["review: label empty", edit(review, { label: "" })],
    ["review: label a number", edit(review, { label: 5 })],
    ["review: method empty", edit(review, { method: "" })],
    ["review: evidence a string", edit(review, { evidence: "x" })],
    ["review: logbook_head bad", edit(review, { logbook_head: "x" })],
    ["review: raw_id a number", edit(review, { raw_id: 5 })],
    ["review: raw_id empty", edit(review, { raw_id: "" })],
    ["review: extra a string", edit(review, { extra: "x" })],
    ["status: the passed example", passed],
    ["status: the exploring example", example("exploring")],
    ["status: another schema", edit(passed, { schema: "x" })],
    ["status: no entity", edit(passed, { entity: undefined })],
    [
      "status: a person",
      edit(passed, { entity: { type: "person", id: PERSON_ID, registry: "logbook" } }),
    ],
    ["status: a goal", edit(passed, { entity: { type: "goal", id: ORG_ID, registry: "logbook" } })],
    [
      "status: a company",
      edit(passed, { entity: { type: "company", id: ORG_ID, registry: "logbook" } }),
    ],
    [
      "status: a type that is a list",
      edit(passed, { entity: { type: ["org"], id: ORG_ID, registry: "logbook" } }),
    ],
    [
      "status: an org with a v4 id",
      edit(passed, {
        entity: { type: "org", id: "1f2e3d4c-0000-4000-8000-000000000001", registry: "logbook" },
      }),
    ],
    [
      "status: an idea with id x",
      edit(passed, { entity: { type: "idea", id: "x", registry: "logbook" }, status: "spark" }),
    ],
    [
      "status: a place let go",
      edit(passed, {
        entity: { type: "place", id: "Hytta", registry: "logbook" },
        status: "let-go",
        reason: "x",
        proposal: undefined,
      }),
    ],
    [
      "status: an asset sold",
      edit(passed, {
        entity: { type: "asset", id: "solvind", registry: "logbook" },
        status: "sold",
        proposal: undefined,
      }),
    ],
    [
      "status: an asset exited",
      edit(passed, {
        entity: { type: "asset", id: "solvind", registry: "logbook" },
        status: "exited",
        proposal: undefined,
      }),
    ],
    [
      "status: an idea held",
      edit(passed, {
        entity: { type: "idea", id: IDEA_ID, registry: "logbook" },
        status: "hold",
        proposal: undefined,
      }),
    ],
    [
      "status: a place sold",
      edit(passed, {
        entity: { type: "place", id: "Hytta", registry: "logbook" },
        status: "sold",
        proposal: undefined,
      }),
    ],
    ["status: an org sold", edit(passed, { status: "sold" })],
    ["status: no status", edit(passed, { status: undefined })],
    ["status: a status that is a list", edit(passed, { status: ["hold"] })],
    ["status: reason empty", edit(passed, { reason: "" })],
    ["status: reason a number", edit(passed, { reason: 5 })],
    ["status: reason true", edit(passed, { reason: true })],
    ["status: passed without a reason", edit(passed, { reason: undefined })],
    [
      "status: an org let go without a reason",
      edit(passed, { status: "let-go", reason: undefined, proposal: undefined }),
    ],
    [
      "status: an idea killed with a blank reason",
      edit(passed, {
        entity: { type: "idea", id: IDEA_ID, registry: "logbook" },
        status: "killed",
        reason: " ",
        proposal: undefined,
      }),
    ],
    ["status: label empty", edit(passed, { label: "" })],
    ["status: no proposed_by", edit(passed, { proposed_by: undefined })],
    ["status: proposed_by me", edit(passed, { proposed_by: "me" })],
    ["status: proposed_by a list", edit(passed, { proposed_by: ["owner"] })],
    ["status: proposal a string", edit(passed, { proposal: "x" })],
    ["status: proposal empty", edit(passed, { proposal: {} })],
    ["status: proposal.status a number", edit(passed, { proposal: { status: 5 } })],
    ["status: proposal.status unknown", edit(passed, { proposal: { status: "x" } })],
    [
      "status: proposal.status of another kind",
      edit(passed, {
        entity: { type: "idea", id: IDEA_ID, registry: "logbook" },
        status: "spark",
        proposal: { status: "sold" },
      }),
    ],
    ["status: proposal.status hold", edit(passed, { proposal: { status: "hold" } })],
    ["status: since not a day", edit(passed, { since: "2026-1-1" })],
    ["status: since a number", edit(passed, { since: 5 })],
    ["status: since with a trailing newline", edit(passed, { since: "2026-01-01\n" })],
    ["status: since in fullwidth digits", edit(passed, { since: "２０２６-01-01" })],
    ["status: since not a real day", edit(passed, { since: "2026-13-45" })],
    ["status: evidence a string", edit(passed, { evidence: "x" })],
    ["status: supersedes empty", edit(passed, { supersedes: "" })],
    ["status: logbook_head a number", edit(passed, { logbook_head: 5 })],
    ["status: amount", edit(passed, { amount: -2500 })],
    ["status: every money key", edit(passed, { value: 1, price: 2, currency: "NOK", amount: 3 })],
    [
      "status: everything wrong at once",
      {
        schema: "x",
        entity: { type: "org", id: "x", registry: "crm" },
        status: "sold",
        reason: 5,
        label: 5,
        proposed_by: 5,
        proposal: 5,
        since: 5,
        evidence: 5,
        supersedes: 5,
        logbook_head: 5,
        amount: 5,
      },
    ],
  ];
  return found.map(([name, payload]) => ({
    name,
    schema: name.startsWith("entity")
      ? "entity/v1"
      : name.startsWith("review")
        ? "entity-review/v1"
        : "status/v1",
    payload,
  }));
}

function tierVariants(): Array<{
  name: string;
  schema: string;
  tier: number;
  cited: Record<string, number>;
  kind?: string;
}> {
  const money = { [MONEY]: 3 };
  const mixed = { [MONEY]: 3, "019cadd3-6bc0-7dcd-9133-0000000001a1": 2 };
  const found: Array<[string, string, number, Record<string, number>, string?]> = [
    ["entity at 2", "entity/v1", 2, {}],
    ["entity at 3", "entity/v1", 3, {}],
    ["entity at 1 of kind place", "entity/v1", 1, {}, "place"],
    ["entity at 2.5", "entity/v1", 2.5, {}],
    ["entity citing money", "entity/v1", 2, money],
    ["entity of kind org citing money", "entity/v1", 2, mixed, "org"],
    ["entity at 3 of kind org citing money", "entity/v1", 3, money, "org"],
    [
      "entity citing several, the first by code point named",
      "entity/v1",
      2,
      { z: 3, b: 2, a: 3, Z: 3 },
    ],
    ["status of an org at 3", "status/v1", 3, {}, "org"],
    ["status of an org at 2", "status/v1", 2, {}, "org"],
    ["status of an org at 3 citing money", "status/v1", 3, money, "org"],
    ["status of an org at 2 citing money", "status/v1", 2, money, "org"],
    ["status of an idea at 2", "status/v1", 2, {}, "idea"],
    ["status of an idea at 3", "status/v1", 3, {}, "idea"],
    ["status of an idea at 2 citing money", "status/v1", 2, money, "idea"],
    ["status of an asset at 3 citing money", "status/v1", 3, money, "asset"],
    ["status of a place at 2", "status/v1", 2, {}, "place"],
    ["status of a place at 1", "status/v1", 1, {}, "place"],
    ["status at 2 of no kind", "status/v1", 2, {}],
    ["status at 3 of no kind", "status/v1", 3, {}],
    ["status at 2 of no kind citing money", "status/v1", 2, money],
    ["status of a person at 2", "status/v1", 2, {}, "person"],
    ["status of a unicorn at 3", "status/v1", 3, {}, "unicorn"],
    ["review at 2", "entity-review/v1", 2, {}],
    ["review at 3", "entity-review/v1", 3, {}],
    ["review at 3 citing money", "entity-review/v1", 3, money, "org"],
    ["review at 2 citing money", "entity-review/v1", 2, money, "place"],
    ["review at 2 citing tier 1", "entity-review/v1", 2, { a: 1, b: 1 }],
    ["review at 1 citing tier 1", "entity-review/v1", 1, { a: 1 }],
    ["another schema", "note/v1", 5, money],
  ];
  return found.map(([name, schema, tier, cited, kind]) =>
    kind === undefined ? { name, schema, tier, cited } : { name, schema, tier, cited, kind },
  );
}

/**
 * Every code point whose full case folding is not its lower-casing, and the upper-case forms that
 * lower-case to one, each a word: the Greek with iota subscript, Cherokee, the Cyrillic variants,
 * the Latin and Armenian ligatures, the signs, the Georgian capitals.
 */
const FOLDING_SAMPLE = [
  [0x1f80, 0x1fff],
  [0x13a0, 0x13fd],
  [0xab70, 0xabbf],
  [0x1c80, 0x1c88],
  [0x1c90, 0x1cbf],
  [0x03d0, 0x03f5],
  [0x1e96, 0x1e9e],
  [0xfb00, 0xfb17],
  [0x00b5, 0x00b5],
  [0x00df, 0x00df],
  [0x0130, 0x0130],
  [0x0149, 0x0149],
  [0x017f, 0x017f],
  [0x01f0, 0x01f0],
  [0x0345, 0x0345],
  [0x0390, 0x0390],
  [0x03b0, 0x03b0],
  [0x0587, 0x0587],
  [0x2126, 0x212b],
]
  .flatMap(([from, to]) => {
    const out: string[] = [];
    for (let code = from as number; code <= (to as number); code++)
      out.push(String.fromCodePoint(code));
    return out;
  })
  .join(" ");

/** `fn(...args)` of the reference's words module, and ours, by name. */
function wordVariants(): Array<{ fn: string; args: JsonValue[] }> {
  const key = (
    kind: string,
    refs: Array<[string, string]>,
    ...rest: JsonValue[]
  ): { fn: string; args: JsonValue[] } => ({ fn: "key_of", args: [kind, refs, ...rest] });
  return [
    { fn: "fold", args: ["  Nordmann\tVerft  AS "] },
    { fn: "fold", args: ["Straße"] },
    { fn: "fold", args: ["ſ ΣΟΦΟΣ"] },
    { fn: "fold", args: ["ﬁne İstanbul"] },
    { fn: "fold", args: ["a b\x1cc\x85d　e\x1ff\x1dg\x1eh i j k l"] },
    { fn: "fold", args: ["x﻿y"] },
    { fn: "fold", args: ["ǰ ᾈ ẞ ϐ ẛ և ﬃ ՙ ᾼ ῼ ΐ ΰ ᾶ"] },
    { fn: "fold", args: ["Ǆ dž 一二三 ١٢٣ ½ ① K Å ﬁ"] },
    { fn: "fold", args: ["ᏸ ꭰ ᲀ ϴ ϰ ϱ ϵ ι ῾"] },
    { fn: "fold", args: [FOLDING_SAMPLE] },
    { fn: "words", args: [FOLDING_SAMPLE] },
    { fn: "words", args: ["ﬁne İstanbul"] },
    { fn: "words", args: ["x﻿y"] },
    { fn: "words", args: ["ǰ ᾈ ẞ ϐ"] },
    { fn: "words", args: ["Ǆ dž 一二三 ١٢٣ ½ ①"] },
    { fn: "words", args: ["The Fjord Kiosk, an A_B"] },
    { fn: "words", args: ["The Fjord Kiosk, an A_B", false] },
    { fn: "words", args: ["é ́x a‍b"] },
    { fn: "title_key", args: ["The Fjord Kiosk"] },
    { fn: "title_key", args: ["a an the"] },
    { fn: "title_key", args: ["Ǆ dž 一二三 ١٢٣ ½ ①"] },
    { fn: "title_key", args: ["b x﨎 x\u{10000} Z"] },
    { fn: "org_name", args: ["x\u{10000} x﨎 x퟿"] },
    { fn: "org_name", args: ["Nordmann Verft AS"] },
    { fn: "org_name", args: ["The Verft Ltd Inc GmbH AB ASA as"] },
    { fn: "org_name", args: [""] },
    { fn: "org_name", args: ["ß ss ßa"] },
    { fn: "registered_domain", args: ["post.nordmann-verft.example"] },
    { fn: "registered_domain", args: ["mail.fjordkiosk.co.uk"] },
    { fn: "registered_domain", args: ["post.verft.example.org"] },
    { fn: "registered_domain", args: ["example.org"] },
    { fn: "registered_domain", args: ["localhost"] },
    { fn: "registered_domain", args: ["a.b.club.example", ["club.example"]] },
    { fn: "registered_domain", args: [" .Mail.Fjord.CO.UK. "] },
    { fn: "registered_domain", args: ["a..b"] },
    { fn: "registered_domain", args: ["x.y.z", [" .Y.Z "]] },
    { fn: "registered_domain", args: ["x.y.z", [".Y.Z."]] },
    { fn: "registered_domain", args: ["ß.de"] },
    { fn: "registered_domain", args: ["a_b.example"] },
    { fn: "registered_domain", args: ["İ.example"] },
    key("person", [
      ["phone", "+447700900123"],
      ["email", "Ola.Nordmann@Example.org"],
    ]),
    key("person", [["name", "nordmann ola"]]),
    key("person", [["phone", " +447700900123 "]]),
    key("person", [["handle", "x"]]),
    key("org", [
      ["group", "Nordmann Verft Board"],
      ["domain", "post.nordmann-verft.example"],
    ]),
    key("org", [["repo", "github.com/nordmann-verft/kiosk"]]),
    key("org", [["merchant", "  FJORDKIOSK  AS "]]),
    key("org", [["domain", "localhost"]]),
    key("org", [["repo", "x"]]),
    key("idea", [
      ["title", "The Fjord Kiosk"],
      ["page", "notion:1f2e"],
    ]),
    key("idea", [["repo", "github.com/Nordmann-Verft/Kiosk"]]),
    key("idea", [["title", "The Fjord Kiosk"]]),
    key("idea", [["repo", "/a//b/"]]),
    key("idea", [["repo", "a/b"]]),
    key("idea", [["title", "the a"]]),
    key("idea", [["title", "the"]], null, "The An"),
    key("idea", [["repo", "a/b"]], null, "The Fjord Kiosk"),
    key("place", [["place", "Hytta på Banken"]]),
    key("place", [], "Hytta"),
    key("place", [], "", " "),
    key("place", [], "", ""),
    key("asset", [
      ["registration", "ZZ-ABC"],
      ["mmsi", "970123456"],
    ]),
    key("asset", [["registration", "ZZ-ABC"]]),
    key("asset", [], "solvind"),
    key("asset", [["icao24", " ABC123 "]]),
    key("asset", [["subject", "lerka"]], "solvind"),
    key("asset", []),
    key("goal", [["title", "x"]]),
    { fn: "repo_org", args: [" /GitHub.com//Org/x "] },
    { fn: "repo_org", args: ["a"] },
    { fn: "registration_key", args: ["ZZ-ABC"] },
    { fn: "registration_key", args: ["zz abc\x1c-x"] },
    { fn: "kind_of", args: [{ type: "company" }] },
    { fn: "kind_of", args: [{ type: "goal" }] },
    { fn: "kind_of", args: [{ type: 5 }] },
    { fn: "kind_of", args: ["org"] },
    { fn: "kind_of", args: [null] },
    { fn: "status_tier", args: ["org"] },
    { fn: "status_tier", args: ["idea"] },
    { fn: "status_tier", args: ["goal"] },
    { fn: "review_tier", args: [[1, 1]] },
    { fn: "review_tier", args: [[3, 2]] },
    { fn: "review_tier", args: [[]] },
    { fn: "check_kind", args: ["person"] },
    { fn: "check_kind", args: ["goal"] },
    { fn: "check_kind", args: ["thing"] },
    { fn: "check_kind", args: ["company"] },
    { fn: "check_kind", args: [""] },
    { fn: "check_kind", args: ["org"] },
  ];
}

const OURS: Record<string, (...args: JsonValue[]) => unknown> = {
  fold: (t) => fold(t as string),
  words: (t, articles) => words(t as string, articles === undefined ? true : (articles as boolean)),
  title_key: (t) => titleKey(t as string),
  org_name: (t) => orgName(t as string),
  registered_domain: (h, extra) =>
    registeredDomain(h as string, (extra as string[] | undefined) ?? []) ?? null,
  key_of: (kind, refs, id, label) =>
    keyOf(
      kind as string,
      (refs as Array<[string, string]>).map(([k, value]) => ({ kind: k, value })),
      (id as string | null | undefined) ?? undefined,
      (label as string | null | undefined) ?? undefined,
    ) ?? null,
  repo_org: (v) => repoOrg(v as string) ?? null,
  registration_key: (v) => registrationKey(v as string),
  kind_of: (e) => kindOf(e) ?? null,
  status_tier: (k) => statusTier(k as string),
  review_tier: (c) => reviewTier(c as number[]),
  check_kind: (k) => {
    checkKind(k as string);
    return null;
  },
};

function ours(fn: () => unknown): Outcome {
  try {
    return { ok: fn() };
  } catch (err) {
    return { error: `${(err as Error).name}: ${(err as Error).message}` };
  }
}

/**
 * Where the reference raises instead of answering: a Python exception its validators do not catch.
 * This implementation answers with the sentence the rule has, or with nothing against the input.
 */
const REFERENCE_RAISES: Record<string, { theirs: string; ours: Outcome }> = {
  "entity: an org id with a trailing newline": {
    theirs: "ValueError: badly formed hexadecimal UUID string",
    ours: {
      ok: [`entity.id of an org must be a UUIDv7 minted in this record, not '${ORG_ID}\\n'`],
    },
  },
  "status: a type that is a list": {
    theirs: "TypeError: unhashable type: 'list'",
    ours: { ok: ["entity.type ['org'] is not one of org, idea, place, asset"] },
  },
  "status: a status that is a list": {
    theirs: "TypeError: unhashable type: 'list'",
    ours: {
      ok: ["status ['hold'] is not one of an org's: hold, add, sell, let-go, exited, passed"],
    },
  },
};

const HARNESS = `
import json, sys
from logbook.contrib import entities, entity_status
data = json.load(sys.stdin)
def run(fn, *args):
    try:
        return {"ok": fn(*args)}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}
WORDS = {
    "fold": entities.fold,
    "words": entities.words,
    "title_key": entities.title_key,
    "org_name": lambda t: list(entities.org_name(t)),
    "registered_domain": entities.registered_domain,
    "key_of": lambda kind, refs, *rest: entities.key_of(kind, [tuple(r) for r in refs], *rest),
    "repo_org": entities.repo_org,
    "registration_key": entities.registration_key,
    "kind_of": entities.kind_of,
    "status_tier": entities.status_tier,
    "review_tier": entities.review_tier,
    "check_kind": entity_status.check_kind,
}
out = {
    "validate": [run(entities.VALIDATORS[v["schema"]], v["payload"]) for v in data["validate"]],
    "tiers": [run(entities.tier_problems, t["schema"], t["tier"], t["cited"], t.get("kind")) for t in data["tiers"]],
    "words": [run(WORDS[w["fn"]], *w["args"]) for w in data["words"]],
}
json.dump(out, sys.stdout, ensure_ascii=False)
`;

/** The reference's validators, the tier rules and the words module on every variant, in one process. */
function referenceAnswers(input: unknown): {
  validate: Outcome[];
  tiers: Outcome[];
  words: Outcome[];
} {
  const result = spawnSync(
    "uv",
    ["run", "--project", REF as string, "python", "-I", "-c", HARNESS],
    {
      cwd: REF,
      encoding: "utf-8",
      input: JSON.stringify(input),
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`reference exited ${result.status}:\n${result.stderr}`);
  return JSON.parse(result.stdout) as { validate: Outcome[]; tiers: Outcome[]; words: Outcome[] };
}

/** `logbook <command…>` of the reference on a record, its exit status, stdout and stderr. */
function referenceRun(root: string, args: string[]): { status: number; out: string; err: string } {
  const result = spawnSync("uv", ["run", "--project", REF as string, "logbook", ...args], {
    cwd: REF,
    encoding: "utf-8",
    env: { ...process.env, LOGBOOK_HOME: root, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, out: result.stdout, err: result.stderr };
}

describe.skipIf(ready)("the cross-implementation test of RFC 0037", () => {
  it("is skipped: set LOGBOOK_REF to a clone of bighydro/logbook to run it", () => {
    expect(ready).toBe(false);
  });
});

describe.skipIf(!ready)(
  "RFC 0037: the reference and logbook-ts validate a payload with the same sentences",
  () => {
    const payloads = variants();
    const tiers = tierVariants();
    const wordsList = wordVariants();
    const theirs = ready
      ? referenceAnswers({ validate: payloads, tiers, words: wordsList })
      : undefined;

    it("on at least sixty payload variants: every refusal path of every validator", () => {
      expect(payloads.length).toBeGreaterThanOrEqual(60);
      expect(theirs?.validate).toHaveLength(payloads.length);
      for (const [i, variant] of payloads.entries()) {
        const theirAnswer = theirs?.validate[i] as Outcome;
        const ourAnswer = ours(() => VALIDATORS[variant.schema]?.(variant.payload));
        const raises = REFERENCE_RAISES[variant.name];
        if (raises !== undefined) {
          expect({ name: variant.name, theirs: theirAnswer }).toEqual({
            name: variant.name,
            theirs: { error: raises.theirs },
          });
          expect({ name: variant.name, ours: ourAnswer }).toEqual({
            name: variant.name,
            ours: raises.ours,
          });
          continue;
        }
        expect({ name: variant.name, problems: ourAnswer }).toEqual({
          name: variant.name,
          problems: theirAnswer,
        });
      }
    }, 120_000);

    it("on every tier sentence", () => {
      for (const [i, variant] of tiers.entries()) {
        const ourAnswer = ours(() =>
          tierProblems(variant.schema, variant.tier, variant.cited, variant.kind),
        );
        expect({ name: variant.name, problems: ourAnswer }).toEqual({
          name: variant.name,
          problems: theirs?.tiers[i],
        });
      }
    });

    it("on the words: fold, words, the keys, the registered domain, kind_of, check_kind, with Python's folding, splitting and sorting", () => {
      for (const [i, variant] of wordsList.entries()) {
        const ourAnswer = ours(() => OURS[variant.fn]?.(...variant.args));
        expect({ variant, answer: ourAnswer }).toEqual({ variant, answer: theirs?.words[i] });
      }
    });
  },
);

describe.skipIf(!ready)(
  "RFC 0037, under the rfc0037 flag: the reference and logbook-ts list the same statuses",
  () => {
    it("agrees on `status list KIND` and its --json for every kind, on the synthetic record", () => {
      vi.stubEnv(FLAGS_ENV, "rfc0037");
      const root = entitiesRecord();
      for (const kind of ["org", "idea", "place", "asset"]) {
        const text = referenceRun(root, ["status", "list", kind]);
        expect({ kind, status: text.status }, text.err).toEqual({ kind, status: 0 });
        const listing = statusListing(root, kind);
        expect(statusListingText(listing), kind).toBe(text.out);
        const json = referenceRun(root, ["status", "list", kind, "--json"]);
        expect(json.status).toBe(0);
        expect(JSON.parse(json.out), kind).toEqual(
          JSON.parse(JSON.stringify(statusListingJson(listing))),
        );
        expect(
          `${JSON.stringify(statusListingJson(listing), null, 2)}\n`,
          `${kind} --json, byte for byte`,
        ).toBe(json.out);
      }
    }, 300_000);

    it("refuses a kind that takes no status in the same sentence", () => {
      vi.stubEnv(FLAGS_ENV, "rfc0037");
      const root = entitiesRecord();
      for (const kind of ["person", "goal", "thing", "company", "Org"]) {
        const theirs = referenceRun(root, ["status", "list", kind]);
        expect(theirs.status).toBe(2);
        const said = theirs.err.trimEnd().split("\n").at(-1) ?? "";
        const mine = ours(() => statusListing(root, kind));
        expect({ kind, said }).toEqual({
          kind,
          said: `status: ${"error" in mine ? mine.error.replace(/^StatusError: /, "") : ""}`,
        });
      }
    }, 120_000);

    it("reads a line's day under day_start (RFC 0036) alike, with rfc0037 alone or both flags on", () => {
      const root = dayStartRecord();
      const theirs = referenceRun(root, ["status", "list", "org"]);
      expect(theirs.status).toBe(0);
      expect(theirs.out).toContain("hold since 2026-10-01");
      const json = referenceRun(root, ["status", "list", "org", "--json"]);
      for (const flags of ["rfc0037", "rfc0036,rfc0037"]) {
        vi.stubEnv(FLAGS_ENV, flags);
        expect(statusListingText(statusListing(root, "org")), flags).toBe(theirs.out);
        expect(JSON.parse(json.out), flags).toEqual(
          JSON.parse(JSON.stringify(statusListingJson(statusListing(root, "org")))),
        );
      }
    }, 120_000);

    it("refuses a day_start that is not a clock in the same sentence", () => {
      vi.stubEnv(FLAGS_ENV, "rfc0037");
      const root = dayStartRecord();
      writeMeta(root, { ...readMetaFile(root), day_start: "6am" });
      const theirs = referenceRun(root, ["status", "list", "org"]);
      expect(theirs.status).toBe(2);
      const said = theirs.err.trimEnd().split("\n").at(-1) ?? "";
      const mine = ours(() => statusListing(root, "org"));
      expect("error" in mine ? `status: ${mine.error.replace(/^DayStartError: /, "")}` : mine).toBe(
        said,
      );
    }, 120_000);
  },
);

describe.skipIf(!ready)(
  "RFC 0037 on the record the reference wrote with its own writers (rfc0037-0038-sample)",
  () => {
    const root = join(FIXTURES, "rfc0037-0038-sample");
    /** Every line of the record, parsed, in file order. */
    const lines = (): Array<
      Record<string, JsonValue> & { id: string; kind: string; tier: number }
    > =>
      ["08", "09", "10"].flatMap((month) =>
        readFileSync(join(root, "logbook", "2026", `${month}.jsonl`), "utf-8")
          .split("\n")
          .filter((row) => row !== "")
          .map((row) => JSON.parse(row)),
      );

    it("validates every entity, entity-review and status line, and its tiers, as the reference does", () => {
      const all = lines();
      const tiers = new Map(all.map((l) => [l.id, l.tier]));
      const ofSchema = all.filter((l) => {
        const schema = (l.payload as Fields).schema;
        return typeof schema === "string" && schema in VALIDATORS;
      });
      expect(ofSchema.map((l) => l.kind).sort()).toEqual([
        ...Array(6).fill("entity"),
        ...Array(5).fill("entity-review"),
        ...Array(8).fill("status"),
      ]);
      const input = ofSchema.map((l) => {
        const payload = l.payload as Fields;
        const cited: Record<string, number> = {};
        for (const id of (payload.evidence as string[] | undefined) ?? []) {
          const tier = tiers.get(id);
          if (tier !== undefined) cited[id] = tier;
        }
        return {
          schema: payload.schema as string,
          payload,
          tier: l.tier,
          cited,
          kind: kindOf(payload.entity),
        };
      });
      const theirs = referenceAnswers({
        validate: input.map(({ schema, payload }) => ({ schema, payload })),
        tiers: input.map(({ schema, tier, cited, kind }) => ({
          schema,
          tier,
          cited,
          kind: kind ?? null,
        })),
        words: [],
      });
      for (const [i, v] of input.entries()) {
        const id = ofSchema[i]?.id;
        expect({ id, problems: ours(() => VALIDATORS[v.schema]?.(v.payload)) }).toEqual({
          id,
          problems: theirs.validate[i],
        });
        expect({ id, tiers: ours(() => tierProblems(v.schema, v.tier, v.cited, v.kind)) }).toEqual({
          id,
          tiers: theirs.tiers[i],
        });
      }
      // The reference's writers wrote every one of them, so none has a problem, in either.
      expect(theirs.validate.every((a) => "ok" in a && (a.ok as unknown[]).length === 0)).toBe(
        true,
      );
      expect(theirs.tiers.every((a) => "ok" in a && (a.ok as unknown[]).length === 0)).toBe(true);
    }, 120_000);

    it("lists the statuses of every kind alike, as text and as JSON, and refuses a person alike", () => {
      vi.stubEnv(FLAGS_ENV, "rfc0037");
      for (const kind of ["org", "idea", "place", "asset"]) {
        const text = referenceRun(root, ["status", "list", kind]);
        expect({ kind, status: text.status }, text.err).toEqual({ kind, status: 0 });
        const listing = statusListing(root, kind);
        expect(statusListingText(listing), kind).toBe(text.out);
        const json = referenceRun(root, ["status", "list", kind, "--json"]);
        expect(`${JSON.stringify(statusListingJson(listing), null, 2)}\n`, kind).toBe(json.out);
      }
      const person = referenceRun(root, ["status", "list", "person"]);
      expect(person.status).toBe(2);
      expect(person.err.trimEnd().split("\n").at(-1)).toBe(
        "status: a person has no status (RFC 0037): people are reviewed, never disposed of",
      );
    }, 300_000);
  },
);
