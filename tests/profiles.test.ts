import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentHash, contentOf, hashLine } from "../src/chain.js";
import { canonicalize } from "../src/jcs.js";
import { showDay } from "../src/show.js";
import { verifyLogbook } from "../src/store.js";
import type { Line } from "../src/types.js";

/**
 * The per-profile conformance fixtures of the spec (SPEC §6.1, RFC 0031): under the reference's
 * `conformance/profiles/<profile>/`, one record of one line per frozen payload profile, with
 * `expected.json` (the line's canonical content form, its content hash, its hash, which is the
 * record's head, and its local day) and `show.txt`, what `show <day>` prints. This implementation
 * carries `verify` and `show`, so it passes those parts: the record verifies to the head, the line's
 * canonical form and hashes recompute, and `show` prints the row. The reader JSON beside them
 * (`day.json`, `days.json`) binds a reader of §6.1's table; `day` is compared on the records of
 * cross-impl.test.ts. Needs the clone of https://github.com/bighydro/logbook named by LOGBOOK_REF;
 * without it this file is skipped, like cross-impl.test.ts.
 */
const REF = process.env.LOGBOOK_REF;
const PROFILES = REF === undefined ? undefined : join(REF, "conformance", "profiles");
const ready = PROFILES !== undefined && existsSync(PROFILES);

interface Expected {
  profile: string;
  rfc: string;
  kind: string;
  day: string;
  seq: number;
  canonical: string;
  content_hash: string;
  hash: string;
  head: string;
}

function folders(): string[] {
  return ready ? readdirSync(PROFILES as string).sort() : [];
}

function theLine(record: string): Line {
  const [year] = readdirSync(join(record, "logbook")).sort();
  const [month] = readdirSync(join(record, "logbook", year ?? "")).sort();
  const text = readFileSync(join(record, "logbook", year ?? "", month ?? ""), "utf-8");
  const rows = text.split("\n").filter((row) => row.trim() !== "");
  expect(rows, "one line per fixture record").toHaveLength(1);
  return JSON.parse(rows[0] ?? "") as Line;
}

/**
 * Profiles whose `show` row this implementation does not print as the reference does yet
 * (SPEC-QUESTIONS 76). `it.fails` holds the difference: the case turns red the day it is fixed, so
 * the entry here is removed with the fix, never left behind.
 */
const SHOW_DIFFERS = new Set(["received/v1", "story/v1"]);

describe.skipIf(!ready)("the frozen payload profiles' fixtures (SPEC §6.1, RFC 0031)", () => {
  it("there are nineteen, one folder each", () => {
    expect(folders()).toHaveLength(19);
  });

  for (const name of folders()) {
    const folder = join(PROFILES as string, name);
    const expected = JSON.parse(readFileSync(join(folder, "expected.json"), "utf-8")) as Expected;
    const record = join(folder, "record");

    it(`${expected.profile}: the record verifies to its head`, () => {
      const result = verifyLogbook(record);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      expect(result.lines).toBe(expected.seq);
      expect(result.head).toBe(expected.head);
    });

    it(`${expected.profile}: the line's canonical form, content hash and hash recompute`, () => {
      const line = theLine(record);
      expect(line.kind).toBe(expected.kind);
      expect((line.payload as { schema?: string }).schema).toBe(expected.profile);
      const content = contentOf(line);
      expect(canonicalize(content)).toBe(expected.canonical);
      expect(contentHash(content)).toBe(expected.content_hash);
      expect(hashLine(line)).toBe(expected.hash);
      expect(line.hash).toBe(expected.hash);
    });

    const showCase = SHOW_DIFFERS.has(expected.profile) ? it.fails : it;
    showCase(`${expected.profile}: show prints the row`, () => {
      const text = readFileSync(join(folder, "show.txt"), "utf-8");
      expect(showDay(record, { day: expected.day }).text).toBe(text);
    });
  }
});
