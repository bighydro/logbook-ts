import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { hashLine, ZERO_HASH } from "../src/chain.js";
import {
  addNote,
  HeadMoved,
  LogbookError,
  RepairRefused,
  repairTail,
  repairTailText,
  rfc3339,
  TailAhead,
  takeWriterLock,
  verifyLogbook,
  WriterBusy,
  withWriterLock,
} from "../src/store.js";
import type { Line } from "../src/types.js";
import {
  cleanup,
  copyFixture,
  copySample,
  cutInsideLastLine,
  type Draft,
  DUPLICATE_KEYS,
  type DuplicateKey,
  EXPECTED,
  freshLogbook,
  readLines,
  readMetaFile,
  SAMPLE,
  SAMPLE_MONTH,
  tempDir,
  writeBareRecord,
  writeDuplicateKey,
  writeLines,
  writeMeta,
  writeRecord,
} from "./helpers.js";

afterEach(cleanup);

const RFC3339_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("verifyLogbook on the conformance sample (SPEC §6)", () => {
  it("reports valid with the expected seq and head", () => {
    const result = verifyLogbook(SAMPLE);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.lines).toBe(EXPECTED.seq);
    expect(result.head).toBe(EXPECTED.head);
  });

  it("fails when a byte inside a line's content is edited", () => {
    const root = copySample();
    const lines = readLines(root);
    lines[4] = (lines[4] as string).replace("Tromsø", "Tromsp");
    writeLines(root, lines);
    const result = verifyLogbook(root);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /seq 5/.test(e) && /hash/.test(e))).toBe(true);
  });

  it("fails when a line is deleted", () => {
    const root = copySample();
    const lines = readLines(root);
    lines.splice(7, 1);
    writeLines(root, lines);
    const result = verifyLogbook(root);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /seq/.test(e))).toBe(true);
  });

  it("fails when the last line is deleted, because logbook.json no longer matches", () => {
    const root = copySample();
    const lines = readLines(root);
    lines.pop();
    writeLines(root, lines);
    const result = verifyLogbook(root);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /logbook\.json/.test(e))).toBe(true);
  });

  it("fails when a prev link is broken even though every hash recomputes", () => {
    const root = copySample();
    const lines = readLines(root).map((l) => JSON.parse(l) as Line);
    const l = lines[2] as Line;
    l.prev = "1".repeat(64);
    l.hash = hashLine(l);
    writeLines(
      root,
      lines.map((x) => JSON.stringify(x)),
    );
    const result = verifyLogbook(root);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /seq 3/.test(e) && /prev/.test(e))).toBe(true);
  });
});

describe("verifyLogbook — format", () => {
  it("refuses logbook/0.1 (SPEC §3.1, ADR 0014)", () => {
    const root = copySample();
    writeMeta(root, { ...readMetaFile(root), format: "logbook/0.1" });
    const result = verifyLogbook(root);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/logbook\/0\.1/);
    expect(result.errors[0]).toMatch(/logbook\/0\.2/);
  });

  it("reads a logbook/0.3 record as it is: the chain rule is 0.2's (SPEC §3.1)", () => {
    const root = copySample();
    writeMeta(root, { ...readMetaFile(root), format: "logbook/0.3" });
    const result = verifyLogbook(root);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.lines).toBe(EXPECTED.seq);
    expect(result.head).toBe(EXPECTED.head);
  });

  it("verifies a sealed line of a logbook/0.3 record: payload_enc is outside the hash and preserved (SPEC §2)", () => {
    const root = copySample();
    const lines = readLines(root).map((x) => JSON.parse(x) as Line);
    const last = lines[lines.length - 1] as Line;
    const sealed: Line = {
      id: "00000000-0000-7000-8000-000000000032",
      seq: last.seq + 1,
      at: "2026-03-08T21:00:00Z",
      end: null,
      tz: "Europe/Oslo",
      source: "manual",
      kind: "note",
      tier: 2,
      payload: { schema: "sealed/v1", of: "note/v1", digest: "ab".repeat(32) },
      recorded_at: "2026-03-08T21:00:00Z",
      prev: last.hash,
      hash: "",
      payload_enc: "YWdlLWVuY3J5cHRpb24ub3JnL3YxCg==",
    };
    sealed.hash = hashLine(sealed);
    writeLines(
      root,
      [...lines, sealed].map((x) => JSON.stringify(x)),
    );
    writeMeta(root, {
      ...readMetaFile(root),
      format: "logbook/0.3",
      recipients: ["age1x5ut7lplvtgkzcnvtjux674z32mu5q72r6ffaxemxtg9g08p7g5qa8ytxl"],
      seq: sealed.seq,
      head: sealed.hash,
    });
    const result = verifyLogbook(root);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.lines).toBe(EXPECTED.seq + 1);
    expect(result.head).toBe(sealed.hash);
    // a tampered sealed payload still breaks the chain; a changed payload_enc does not (no key here)
    const tampered = { ...sealed, payload: { ...sealed.payload, digest: "cd".repeat(32) } };
    writeLines(
      root,
      [...lines, tampered].map((x) => JSON.stringify(x)),
    );
    expect(verifyLogbook(root).valid).toBe(false);
    const resealed = { ...sealed, payload_enc: "YWdlLWVuY3J5cHRpb24ub3JnL3YxCnh5eg==" };
    writeLines(
      root,
      [...lines, resealed].map((x) => JSON.stringify(x)),
    );
    expect(verifyLogbook(root).valid).toBe(true);
  });

  it("refuses an unknown format and a missing format", () => {
    const root = copySample();
    writeMeta(root, { ...readMetaFile(root), format: "logbook/9.9" });
    expect(verifyLogbook(root).valid).toBe(false);
    const { format: _f, ...noFormat } = readMetaFile(root);
    writeMeta(root, noFormat);
    expect(verifyLogbook(root).valid).toBe(false);
  });

  it("throws LogbookError when logbook.json is missing or unreadable", () => {
    const root = copySample();
    expect(() => verifyLogbook(join(root, "nope"))).toThrow(LogbookError);
    writeFileSync(join(root, "logbook.json"), "{not json", "utf-8");
    expect(() => verifyLogbook(root)).toThrow(LogbookError);
  });
});

describe("verifyLogbook — chain order across files", () => {
  it("orders by seq, not by file: a backfilled line in an older month still chains", () => {
    const root = freshLogbook();
    const first = addNote(root, "written in May", { now: new Date("2026-05-10T12:00:00Z") });
    const second = addNote(root, "about April, written later", {
      now: new Date("2026-04-01T09:00:00Z"),
    });
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(existsSync(join(root, "logbook", "2026", "05.jsonl"))).toBe(true);
    expect(existsSync(join(root, "logbook", "2026", "04.jsonl"))).toBe(true);
    const result = verifyLogbook(root);
    expect(result.errors).toEqual([]);
    expect(result.lines).toBe(2);
    expect(result.head).toBe(second.hash);
  });

  it("ignores files that are not logbook/<YYYY>/<MM>.jsonl", () => {
    const root = copySample();
    writeFileSync(join(root, "logbook", "2026", "notes.txt"), "not a month\n", "utf-8");
    writeFileSync(join(root, "logbook", "README.md"), "hello\n", "utf-8");
    mkdirSync(join(root, "logbook", "scratch"));
    writeFileSync(join(root, "logbook", "scratch", "01.jsonl"), "{}\n", "utf-8");
    expect(verifyLogbook(root).valid).toBe(true);
  });

  it("reports a duplicated seq and a gap", () => {
    const root = copySample();
    const lines = readLines(root);
    writeLines(root, [...lines, lines[30] as string]);
    expect(verifyLogbook(root).errors.some((e) => /seq 31/.test(e))).toBe(true);

    const gapped = readLines(root).slice(0, 31);
    const last = JSON.parse(gapped[30] as string) as Line;
    last.seq = 33;
    last.hash = hashLine(last);
    gapped[30] = JSON.stringify(last);
    writeLines(root, gapped);
    expect(verifyLogbook(root).errors.some((e) => /expected seq 31/.test(e))).toBe(true);
  });

  it("reports a malformed line with its file and line number", () => {
    const root = copySample();
    const lines = readLines(root);
    lines.splice(3, 0, "{oops");
    writeLines(root, lines);
    const result = verifyLogbook(root);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /03\.jsonl/.test(e) && /line 4/.test(e))).toBe(true);
  });

  it("tolerates a trailing carriage return, as a Windows checkout may add one", () => {
    const root = copySample();
    writeFileSync(join(root, SAMPLE_MONTH), `${readLines(root).join("\r\n")}\r\n`, "utf-8");
    expect(verifyLogbook(root).valid).toBe(true);
  });

  it("does not seq-check or hash-check an empty logbook, and reports 0 lines", () => {
    const root = freshLogbook();
    const result = verifyLogbook(root);
    expect(result.errors).toEqual([]);
    expect(result.lines).toBe(0);
    expect(result.head).toBe(ZERO_HASH);
  });

  it("checks logbook.json seq and head against the last line", () => {
    const root = copySample();
    writeMeta(root, { ...readMetaFile(root), seq: 30 });
    expect(verifyLogbook(root).errors.some((e) => /logbook\.json/.test(e) && /seq/.test(e))).toBe(
      true,
    );
    writeMeta(root, { ...readMetaFile(root), seq: 31, head: "a".repeat(64) });
    expect(verifyLogbook(root).errors.some((e) => /logbook\.json/.test(e) && /head/.test(e))).toBe(
      true,
    );
  });

  it("preserves unknown top-level fields: they neither break the chain nor the read", () => {
    const root = copySample();
    const lines = readLines(root).map((l) => JSON.parse(l) as Record<string, unknown>);
    (lines[0] as Record<string, unknown>).x_extension = { anything: true };
    writeLines(
      root,
      lines.map((x) => JSON.stringify(x)),
    );
    expect(verifyLogbook(root).valid).toBe(true);
  });

  it("reports a line whose payload has no schema", () => {
    const root = copySample();
    const lines = readLines(root).map((l) => JSON.parse(l) as Line);
    const l = lines[0] as Line;
    delete (l.payload as Record<string, unknown>).schema;
    l.hash = hashLine(l);
    // Re-chain everything after it so the only error is the missing schema.
    for (let i = 1; i < lines.length; i++) {
      const cur = lines[i] as Line;
      cur.prev = (lines[i - 1] as Line).hash;
      cur.hash = hashLine(cur);
    }
    writeLines(
      root,
      lines.map((x) => JSON.stringify(x)),
    );
    writeMeta(root, { ...readMetaFile(root), head: (lines[31] as Line).hash });
    const result = verifyLogbook(root);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/seq 1/);
    expect(result.errors[0]).toMatch(/schema/);
  });
});

describe("addNote", () => {
  it("appends one note/v1 line to a copy of the sample, which still verifies (SPEC §6)", () => {
    const root = copySample();
    const now = new Date("2026-03-09T08:15:30.500Z");
    const line = addNote(root, "Wrote a second implementation.", { now });

    expect(line).toMatchObject({
      seq: 33,
      at: "2026-03-09T08:15:30Z",
      end: null,
      tz: "Europe/Oslo",
      source: "manual",
      kind: "note",
      tier: 2,
      payload: { schema: "note/v1", text: "Wrote a second implementation." },
      recorded_at: "2026-03-09T08:15:30Z",
      prev: EXPECTED.head,
    });
    expect(line.id).toMatch(UUID_V7);
    expect(line.hash).toBe(hashLine(line));
    expect(Object.keys(line).sort()).toEqual([
      "at",
      "end",
      "hash",
      "id",
      "kind",
      "payload",
      "prev",
      "recorded_at",
      "seq",
      "source",
      "tier",
      "tz",
    ]);

    const result = verifyLogbook(root);
    expect(result.errors).toEqual([]);
    expect(result.lines).toBe(33);
    expect(result.head).toBe(line.hash);

    const meta = readMetaFile(root);
    expect(meta.seq).toBe(33);
    expect(meta.head).toBe(line.hash);
    expect(meta.timezone).toBe("Europe/Oslo");
    expect(meta.owner_id).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("writes the line into the month file of `at` (UTC) and terminates it with a newline", () => {
    const root = copySample();
    addNote(root, "still March", { now: new Date("2026-03-31T23:59:59Z") });
    addNote(root, "already April in UTC", { now: new Date("2026-03-31T23:00:00-02:00") });
    const march = readFileSync(join(root, "logbook", "2026", "03.jsonl"), "utf-8");
    const april = readFileSync(join(root, "logbook", "2026", "04.jsonl"), "utf-8");
    expect(march.split("\n").filter(Boolean)).toHaveLength(33);
    expect(march.endsWith("\n")).toBe(true);
    expect(march.includes("\r")).toBe(false);
    expect(april.split("\n").filter(Boolean)).toHaveLength(1);
    expect(april.endsWith("\n")).toBe(true);
    expect(JSON.parse(april).at).toBe("2026-04-01T01:00:00Z");
    expect(verifyLogbook(root).valid).toBe(true);
  });

  it("starts a fresh logbook at seq 1 with prev of sixty-four zeros and creates the folder", () => {
    const root = freshLogbook("Asia/Tokyo");
    const line = addNote(root, "first", { now: new Date("2026-09-15T10:00:00Z") });
    expect(line.seq).toBe(1);
    expect(line.prev).toBe(ZERO_HASH);
    expect(line.tz).toBe("Asia/Tokyo");
    expect(readdirSync(join(root, "logbook", "2026"))).toEqual(["09.jsonl"]);
    expect(verifyLogbook(root)).toMatchObject({ valid: true, lines: 1, head: line.hash });
  });

  it("uses the clock and a UUIDv7 by default", () => {
    const root = freshLogbook();
    const before = Date.now();
    const line = addNote(root, "now");
    expect(line.at).toMatch(RFC3339_SECONDS);
    expect(line.recorded_at).toMatch(RFC3339_SECONDS);
    expect(Math.abs(Date.parse(line.at) - before)).toBeLessThan(5000);
    expect(line.id).toMatch(UUID_V7);
  });

  it("keeps non-ASCII text as UTF-8 and lets JSON escaping handle newlines", () => {
    const root = freshLogbook();
    const text = "Tromsø 😀\nsecond line";
    const line = addNote(root, text);
    const raw = readFileSync(
      join(root, "logbook", line.at.slice(0, 4), `${line.at.slice(5, 7)}.jsonl`),
      "utf-8",
    );
    expect(raw.split("\n").filter(Boolean)).toHaveLength(1);
    expect((JSON.parse(raw) as Line).payload.text).toBe(text);
    expect(verifyLogbook(root).valid).toBe(true);
  });

  it("appends to a logbook/0.3 record that names no recipients, and keeps its format", () => {
    const root = copySample();
    writeMeta(root, { ...readMetaFile(root), format: "logbook/0.3", recipients: [] });
    const line = addNote(root, "plain, as a 0.2 record is");
    expect(line.seq).toBe(33);
    expect(readMetaFile(root)).toMatchObject({ format: "logbook/0.3", recipients: [], seq: 33 });
    expect(verifyLogbook(root).valid).toBe(true);
  });

  it("refuses a logbook/0.3 record that names recipients, since it cannot seal, and writes nothing", () => {
    const root = copySample();
    writeMeta(root, {
      ...readMetaFile(root),
      format: "logbook/0.3",
      recipients: ["age1x5ut7lplvtgkzcnvtjux674z32mu5q72r6ffaxemxtg9g08p7g5qa8ytxl", "age1…"],
    });
    expect(() => addNote(root, "no")).toThrow(/recipients/);
    expect(readLines(root)).toHaveLength(32);
    expect(readMetaFile(root).seq).toBe(32);
  });

  it("refuses a logbook/0.1 record and writes nothing", () => {
    const root = copySample();
    writeMeta(root, { ...readMetaFile(root), format: "logbook/0.1" });
    expect(() => addNote(root, "no")).toThrow(LogbookError);
    expect(readLines(root)).toHaveLength(32);
    expect(readMetaFile(root).seq).toBe(32);
  });

  it("refuses when logbook.json is missing and refuses empty text, and makes no folder for the lock", () => {
    const root = join(copySample(), "missing");
    expect(() => addNote(root, "no")).toThrow(LogbookError);
    expect(existsSync(root)).toBe(false);
    expect(() => addNote(copySample(), "")).toThrow(LogbookError);
    expect(() => addNote(copySample(), "   ")).toThrow(LogbookError);
  });

  it("replaces logbook.json atomically and leaves no temporary file behind", () => {
    const root = copySample();
    addNote(root, "tidy");
    const names = readdirSync(root);
    expect(names.filter((n) => n.startsWith("logbook.json"))).toEqual(["logbook.json"]);
    expect(readFileSync(join(root, "logbook.json"), "utf-8").endsWith("\n")).toBe(true);
  });

  it("refuses to append when the existing record does not verify", () => {
    const root = copySample();
    writeMeta(root, { ...readMetaFile(root), head: "b".repeat(64) });
    expect(() => addNote(root, "onto a broken head")).toThrow(LogbookError);
    expect(readLines(root)).toHaveLength(32);
  });
});

describe("verifyLogbook — a month file cut inside a line (SPEC §3, truncation; §6)", () => {
  const SEED1_MONTH = join("logbook", "2026", "06.jsonl");

  it("the seed-1 demo cut inside its last line: the 12,771 lines before it, their head, and the cut line named", () => {
    const root = copyFixture("demo-seed1");
    const { row, seq, head } = cutInsideLastLine(root, SEED1_MONTH);
    expect(seq).toBe(12771);
    const result = verifyLogbook(root);
    expect(result.errors).toEqual([
      `${SEED1_MONTH} line ${row}: the file ends inside this line (cut short)`,
    ]);
    expect(result.valid).toBe(false);
    expect(result.lines).toBe(12771);
    expect(result.head).toBe(head);
    expect(result.head).not.toBe(ZERO_HASH);
  });

  it("a last line whole but for its newline is a line, and the file cut there is valid", () => {
    const root = copySample();
    const file = join(root, SAMPLE_MONTH);
    writeFileSync(file, readFileSync(file, "utf-8").replace(/\n$/, ""), "utf-8");
    const result = verifyLogbook(root);
    expect(result.errors).toEqual([]);
    expect(result.lines).toBe(EXPECTED.seq);
    expect(result.head).toBe(EXPECTED.head);
  });

  it("a last row with no newline that is JSON but not an object is not cut short: it is said as what it is", () => {
    const root = copySample();
    const file = join(root, SAMPLE_MONTH);
    writeFileSync(file, `${readFileSync(file, "utf-8")}[1]`, "utf-8");
    const result = verifyLogbook(root);
    expect(result.lines).toBe(EXPECTED.seq);
    expect(result.head).toBe(EXPECTED.head);
    expect(result.errors).toEqual([`${SAMPLE_MONTH} line ${EXPECTED.seq + 1}: not a JSON object`]);
  });

  it("a file whose only line is cut: no whole line remains, so 0 and GENESIS", () => {
    const root = writeRecord([
      {
        at: "2026-04-01T10:00:00Z",
        source: "manual",
        kind: "note",
        payload: { schema: "note/v1", text: "one" },
      },
    ]);
    const rel = join("logbook", "2026", "04.jsonl");
    const { row, seq } = cutInsideLastLine(root, rel);
    expect([row, seq]).toEqual([1, 0]);
    const result = verifyLogbook(root);
    expect(result.errors).toEqual([`${rel} line 1: the file ends inside this line (cut short)`]);
    expect(result.lines).toBe(0);
    expect(result.head).toBe(ZERO_HASH);
  });

  it("cut inside any line of a record: seq and head are those of the whole lines before the cut, never 0 and GENESIS while the first line is whole", () => {
    // The reference's property (tests/properties/test_hash_chain.py, truncation inside a line) here:
    // one to three lines in one month, the file cut at any byte; the lines the cut leaves whole are a
    // chained prefix, so verify reports their count and the last one's hash, and names the cut line.
    // A cut at a row boundary leaves only logbook.json ahead (SPEC §3, write order); a cut right
    // before a newline leaves the line whole (§1.1: the chain covers lines, not bytes), and right
    // before the last one leaves the record whole and valid.
    const rel = join("logbook", "2026", "04.jsonl");
    const drafts = fc
      .array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 3 })
      .map((texts): Draft[] =>
        texts.map((text, i) => ({
          at: `2026-04-0${i + 1}T10:00:00Z`,
          source: "manual",
          kind: "note",
          payload: { schema: "note/v1", text },
        })),
      );
    fc.assert(
      fc.property(drafts, fc.nat(), (made, pick) => {
        const root = writeBareRecord(made);
        const file = join(root, rel);
        const bytes = readFileSync(file);
        const rows = bytes.toString("utf-8").slice(0, -1).split("\n");
        const hashes = rows.map((r) => String((JSON.parse(r) as Line).hash));
        const cut = pick % bytes.length;
        writeFileSync(file, bytes.subarray(0, cut));

        // The oracle: the rows whose text the cut left whole, and whether bytes follow them.
        let offset = 0;
        let whole = 0;
        for (const row of rows) {
          const length = Buffer.byteLength(row, "utf-8");
          if (offset + length > cut) break;
          whole += 1;
          offset += length + 1;
        }
        const torn = cut > offset;
        const complete = whole === rows.length; // every row whole: only the last newline is gone

        const result = verifyLogbook(root);
        expect(result.valid).toBe(complete);
        expect(result.lines).toBe(whole);
        expect(result.head).toBe(whole ? hashes[whole - 1] : ZERO_HASH);
        const ofFiles = result.errors.filter((e) => !e.startsWith("logbook.json"));
        expect(ofFiles).toEqual(
          torn ? [`${rel} line ${whole + 1}: the file ends inside this line (cut short)`] : [],
        );
        expect(result.errors.some((e) => e.startsWith("logbook.json"))).toBe(!complete);
        cleanup();
      }),
      {
        numRuns: 60,
        // Replayed on every run: one line of four spaces, cut 382 bytes into its 383 — right before
        // its newline, so the record is whole and valid (CI on Windows, seed -286592326, 2026-10-05).
        examples: [
          [
            [
              {
                at: "2026-04-01T10:00:00Z",
                source: "manual",
                kind: "note",
                payload: { schema: "note/v1", text: "    " },
              },
            ],
            1528781267,
          ],
        ],
      },
    );
  }, 60_000);

  it("a line that is not one, mid-file: named by file and line number, the file read no further, the lines before it and every other file's still counted", () => {
    // What the reference does (its tests/test_streaming.py): the seqs the file held after the bad
    // line are then missing from the chain, and said so. SPEC-QUESTIONS 81.
    const root = writeRecord([
      {
        at: "2026-04-01T10:00:00Z",
        source: "manual",
        kind: "note",
        payload: { schema: "note/v1", text: "one" },
      },
      {
        at: "2026-04-02T10:00:00Z",
        source: "manual",
        kind: "note",
        payload: { schema: "note/v1", text: "two" },
      },
      {
        at: "2026-04-03T10:00:00Z",
        source: "manual",
        kind: "note",
        payload: { schema: "note/v1", text: "three" },
      },
      {
        at: "2026-05-01T10:00:00Z",
        source: "manual",
        kind: "note",
        payload: { schema: "note/v1", text: "four" },
      },
    ]);
    const april = join("logbook", "2026", "04.jsonl");
    const rows = readLines(root, april);
    const third = JSON.parse(rows[2] as string) as Line;
    writeLines(root, [rows[0] as string, "{oops", rows[2] as string], april);
    const result = verifyLogbook(root);
    expect(result.lines).toBe(2); // seq 1 of April, seq 4 of May; seq 3 was after the cut
    expect(result.head).toBe(String(readMetaFile(root).head));
    expect(result.errors[0]?.startsWith(`${april} line 2: not JSON`)).toBe(true);
    expect(result.errors.some((e) => /seq 4 — expected seq 2/.test(e))).toBe(true);
    expect(result.errors.some((e) => /seq 3/.test(e))).toBe(false);
    expect(result.errors.some((e) => e.includes(`prev ${third.hash}`))).toBe(true); // seq 4's prev is unmet
  });
});

describe("verifyLogbook — a member name given twice in one object (SPEC §2)", () => {
  // SPEC §2: a line whose JSON text gives the same key twice in one object, at any depth, is invalid.
  // Each variant writes the line's own value last, so JSON.parse alone reads the line as it was and
  // its hash recomputes; only the duplicate is wrong, and verify must say so as the reference does.
  for (const variant of DUPLICATE_KEYS) {
    it(`${variant.name}: named by file and line, the decoded name quoted, the file read no further`, () => {
      const root = copySample();
      const row = writeDuplicateKey(root, variant);
      const kept = JSON.parse(row) as Line;
      expect(hashLine(kept)).toBe(kept.hash); // keep-the-last reads a line that verifies

      const result = verifyLogbook(root);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toBe(
        `${SAMPLE_MONTH} line ${variant.row}: duplicate key '${variant.key}'`,
      );
      const before = JSON.parse(readLines(root)[variant.row - 2] as string) as Line;
      expect([result.lines, result.head]).toEqual([variant.row - 1, before.hash]);
    });
  }

  it("addNote refuses such a record and writes nothing", () => {
    const root = copySample();
    writeDuplicateKey(root, DUPLICATE_KEYS[0] as DuplicateKey);
    expect(() => addNote(root, "onto a line with a key twice")).toThrow(/duplicate key 'kind'/);
    expect(readLines(root)).toHaveLength(32);
  });
});

/** The lock the reference and this implementation share: `state/writer.lock` in the record folder. */
const lockOf = (root: string): string => join(root, "state", "writer.lock");

/**
 * A lock file as the reference writes it, planted by hand; `mtimeMs`, when given, is set as its
 * modification time, the clock rule A judges an empty lock's age by.
 */
function plantLock(root: string, text: string, mtimeMs?: number): void {
  mkdirSync(join(root, "state"), { recursive: true });
  writeFileSync(lockOf(root), text, "utf-8");
  if (mtimeMs !== undefined) utimesSync(lockOf(root), mtimeMs / 1000, mtimeMs / 1000);
}

/** The pid of a process that has already exited: spawnSync reaps it before returning. */
function deadPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

/**
 * The pid of a process that lives `ms` longer, started detached by a child that exits at once, so
 * that it is not a child of this process: a synchronous wait here would never reap a child, and on
 * POSIX an unreaped child still answers `kill(pid, 0)`.
 */
function livingPid(ms: number): number {
  const script = `const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, ${ms})"], { detached: true, stdio: "ignore", windowsHide: true });
child.unref();
process.stdout.write(String(child.pid));`;
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf-8" });
  return Number(result.stdout);
}

/** What a writer says, and under `--no-wait` refuses with, while a lock names no holder and is not yet half a second old. */
const NO_HOLDER_YET =
  "another logbook command is taking the lock on this record (state/writer.lock names no holder yet; if none is running, remove it)";

describe("the writer lock (one writer at a time, as the reference's state/writer.lock)", () => {
  it("holds state/writer.lock while it runs — pid, command and since, as the reference writes them — and leaves nothing behind", () => {
    const root = copySample();
    const before = Date.now();
    const held = withWriterLock(root, () => readFileSync(lockOf(root), "utf-8"));
    const holder = JSON.parse(held) as { pid: number; command: string; since: string };
    expect(holder.pid).toBe(process.pid);
    expect(holder.command).toBe("logbook-ts add");
    expect(holder.since).toMatch(RFC3339_SECONDS);
    expect(Math.abs(Date.parse(holder.since) - before)).toBeLessThan(5000);
    expect(Object.keys(holder).sort()).toEqual(["command", "pid", "since"]);
    expect(existsSync(lockOf(root))).toBe(false);
    expect(existsSync(join(root, "state"))).toBe(false);

    addNote(root, "under the lock", { command: "logbook-ts add" });
    expect(existsSync(join(root, "state"))).toBe(false);
    expect(readdirSync(root).filter((n) => n.includes("lock"))).toEqual([]);
  });

  it("names the command the caller gives, and leaves what else lives in state/ alone", () => {
    const root = copySample();
    mkdirSync(join(root, "state"));
    writeFileSync(join(root, "state", "home.json"), "{}\n", "utf-8");
    const holder = withWriterLock(
      root,
      () => JSON.parse(readFileSync(lockOf(root), "utf-8")) as { command: string },
      { command: "sync immich" },
    );
    expect(holder.command).toBe("sync immich");
    expect(readdirSync(join(root, "state"))).toEqual(["home.json"]);
  });

  it("releases the lock when the function throws", () => {
    const root = copySample();
    expect(() =>
      withWriterLock(root, () => {
        throw new Error("halfway");
      }),
    ).toThrow("halfway");
    expect(existsSync(lockOf(root))).toBe(false);
    const release = takeWriterLock(root);
    expect(existsSync(lockOf(root))).toBe(true);
    release();
    expect(existsSync(lockOf(root))).toBe(false);
  });

  it("refuses at once with WriterBusy when told not to wait, naming the holder as the reference does, and writes nothing", () => {
    const root = copySample();
    const pid = livingPid(20_000);
    const planted = `{"pid": ${pid}, "command": "sync immich", "since": "2026-10-13T06:00:00Z"}`;
    plantLock(root, planted);
    const said: string[] = [];
    expect(() => addNote(root, "no", { wait: false, say: (l) => said.push(l) })).toThrow(
      WriterBusy,
    );
    expect(() => addNote(root, "no", { wait: false })).toThrow(
      "another logbook command is writing to this record (sync immich, since 2026-10-13T06:00:00Z)",
    );
    expect(said).toEqual([]);
    expect(readFileSync(lockOf(root), "utf-8")).toBe(planted); // the holder's lock is not touched
    expect(readLines(root)).toHaveLength(32);
    expect(readMetaFile(root).seq).toBe(32);
    rmSync(join(root, "state"), { recursive: true, force: true });
  });

  it("waits for a lock whose process is alive, saying so once, and goes on when that process is gone", () => {
    const root = copySample();
    const pid = livingPid(1500);
    expect(pid).toBeGreaterThan(0);
    plantLock(root, `{"pid": ${pid}, "command": "add", "since": "2026-10-13T06:00:00Z"}`);
    const said: string[] = [];
    const started = Date.now();
    const line = addNote(root, "after waiting", { say: (l) => said.push(l) });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
    expect(line.seq).toBe(33);
    expect(said).toEqual([
      "another logbook command is writing to this record (add, since 2026-10-13T06:00:00Z); waiting",
      `a stale lock from add (pid ${pid}, since 2026-10-13T06:00:00Z) whose process is gone; taking it over`,
    ]);
    expect(verifyLogbook(root)).toMatchObject({ valid: true, lines: 33 });
    expect(existsSync(lockOf(root))).toBe(false);
  }, 20_000);

  it("takes over a lock whose process is gone, with one line saying so, as the reference does", () => {
    const root = copySample();
    const pid = deadPid();
    plantLock(root, `{"pid": ${pid}, "command": "sync immich", "since": "2026-10-13T06:00:00Z"}`);
    const said: string[] = [];
    const line = addNote(root, "after a dead lock", { say: (l) => said.push(l) });
    expect(line.seq).toBe(33);
    expect(said).toEqual([
      `a stale lock from sync immich (pid ${pid}, since 2026-10-13T06:00:00Z) whose process is gone; taking it over`,
    ]);
    expect(existsSync(lockOf(root))).toBe(false);
    expect(verifyLogbook(root)).toMatchObject({ valid: true, lines: 33 });
  });

  it("reads a lock whose pid is not a number as one whose process is gone, as the reference does", () => {
    const root = copySample();
    plantLock(root, '{"pid": "x", "command": "add", "since": "2026-10-13T06:00:00Z"}');
    const said: string[] = [];
    addNote(root, "after a bad pid", { say: (l) => said.push(l) });
    expect(said).toEqual([
      "a stale lock from add (pid x, since 2026-10-13T06:00:00Z) whose process is gone; taking it over",
    ]);
    expect(existsSync(lockOf(root))).toBe(false);
  });

  it("names a holder as the reference prints it: `?` for a field that is missing, `None` for null, Python's str() for the rest; a pid that is not a positive whole number is gone", () => {
    const cases: Array<[string, string]> = [
      ["{}", "a stale lock from ? (pid None, since ?)"],
      ['{"pid": null}', "a stale lock from ? (pid None, since ?)"],
      ['{"pid": 1.5, "command": null, "since": 7}', "a stale lock from None (pid 1.5, since 7)"],
      ['{"pid": "123"}', "a stale lock from ? (pid 123, since ?)"],
      ['{"pid": 0}', "a stale lock from ? (pid 0, since ?)"],
      ['{"pid": -1}', "a stale lock from ? (pid -1, since ?)"],
      ['{"pid": 12345678901234567890}', "a stale lock from ? (pid 12345678901234567000, since ?)"],
      [
        '{"pid": [1], "command": ["a"], "since": {"x": 1}}',
        "a stale lock from ['a'] (pid [1], since {'x': 1})",
      ],
    ];
    for (const [bytes, said] of cases) {
      const root = copySample();
      plantLock(root, bytes);
      const notices: string[] = [];
      expect(addNote(root, "after an odd holder", { say: (l) => notices.push(l) }).seq).toBe(33);
      expect(notices).toEqual([`${said} whose process is gone; taking it over`]);
    }
  });

  it("a lock naming this process's own pid, dated before it started, is a leftover of an earlier process given the same pid: taken over, as the reference takes it", () => {
    const root = copySample();
    plantLock(root, `{"pid": ${process.pid}, "command": "add", "since": "2026-10-13T06:00:00Z"}`);
    const said: string[] = [];
    expect(addNote(root, "after my own pid", { say: (l) => said.push(l) }).seq).toBe(33);
    expect(said).toEqual([
      `a stale lock from add (pid ${process.pid}, since 2026-10-13T06:00:00Z) whose process is gone; taking it over`,
    ]);
  });

  it("a lock naming this process's own pid, dated since it started, may be another thread's: waited for, never taken over", () => {
    const root = copySample();
    const since = rfc3339(new Date());
    const planted = `{"pid": ${process.pid}, "command": "logbook-ts add", "since": "${since}"}`;
    plantLock(root, planted);
    expect(() => addNote(root, "not past a thread of mine", { wait: false })).toThrow(
      new WriterBusy(
        `another logbook command is writing to this record (logbook-ts add, since ${since})`,
      ),
    );
    expect(readFileSync(lockOf(root), "utf-8")).toBe(planted);
  });

  it("a writer that already holds the lock and asks for it again is refused, not left waiting on itself", () => {
    const root = copySample();
    expect(() => withWriterLock(root, () => withWriterLock(root, () => "inner"))).toThrow(
      LogbookError,
    );
    expect(existsSync(lockOf(root))).toBe(false);
    expect(addNote(root, "after the refusal").seq).toBe(33);
  });

  it("a lock that names no holder — empty, cut short, not JSON, not an object — made more than half a second ago is a leftover of a crash: read again for the reference's half second, then removed without a word and taken, under --no-wait too (rule A)", () => {
    for (const bytes of ["", '{"pid": 12', "garbage\n", "[1]", "  ", "null"]) {
      const root = copySample();
      plantLock(root, bytes, Date.now() - 10_000);
      const said: string[] = [];
      const started = Date.now();
      const line = addNote(root, "over a lock a crash left empty", {
        wait: false,
        say: (l) => said.push(l),
      });
      // The reference reads such a lock, sleeps half a second, reads it again, and removes it.
      expect(Date.now() - started).toBeGreaterThanOrEqual(450);
      expect(line.seq).toBe(33);
      expect(said).toEqual([]);
      expect(existsSync(join(root, "state"))).toBe(false);
      expect(verifyLogbook(root)).toMatchObject({ valid: true, lines: 33 });
    }
  });

  it("a lock that names no holder and is not yet half a second old by its mtime is someone taking it: never taken over; under --no-wait refused after half a second with the no-holder sentence, and left byte for byte (rule A)", () => {
    for (const bytes of ["", '{"pid": 12', "garbage\n", "[1]"]) {
      const root = copySample();
      // An mtime ahead of the clock: a lock just made, as far as its mtime says, for the whole test.
      plantLock(root, bytes, Date.now() + 60_000);
      const said: string[] = [];
      const started = Date.now();
      expect(() =>
        addNote(root, "not over a lock that may be being written", {
          wait: false,
          say: (l) => said.push(l),
        }),
      ).toThrow(new WriterBusy(NO_HOLDER_YET));
      expect(Date.now() - started).toBeGreaterThanOrEqual(450);
      expect(said).toEqual([]);
      expect(readFileSync(lockOf(root), "utf-8")).toBe(bytes);
      expect(readLines(root)).toHaveLength(32);
      expect(readdirSync(join(root, "state"))).toEqual(["writer.lock"]);
    }
  });

  it("a lock that names no holder is waited for, with one line saying so, until half a second after its mtime; then taken (rule A)", () => {
    const root = copySample();
    const made = Date.now() + 1200;
    plantLock(root, "", made);
    const said: string[] = [];
    const line = addNote(root, "once the empty lock is old enough", { say: (l) => said.push(l) });
    expect(Date.now()).toBeGreaterThanOrEqual(made + 500);
    expect(line.seq).toBe(33);
    expect(said).toEqual([`${NO_HOLDER_YET}; waiting`]);
    expect(existsSync(lockOf(root))).toBe(false);
  }, 20_000);

  it("clears a reclaim left by a writer that died taking over a stale lock", () => {
    const root = copySample();
    plantLock(root, `{"pid": ${deadPid()}, "command": "add", "since": "2026-10-13T06:00:00Z"}`);
    writeFileSync(join(root, "state", "writer.lock.reclaim"), String(deadPid()), "utf-8");
    expect(addNote(root, "after a dead reclaimer").seq).toBe(33);
    expect(existsSync(join(root, "state"))).toBe(false);
  });

  it("a reclaim that names no writer is held to the lock's rule: older than half a second it is a leftover, cleared, and the stale lock taken; younger, it is waited for, and under --no-wait refused (rule A)", () => {
    const stale = `{"pid": ${deadPid()}, "command": "add", "since": "2026-10-13T06:00:00Z"}`;
    const guard = (root: string): string => join(root, "state", "writer.lock.reclaim");

    const old = copySample();
    plantLock(old, stale);
    writeFileSync(guard(old), "", "utf-8");
    utimesSync(guard(old), (Date.now() - 10_000) / 1000, (Date.now() - 10_000) / 1000);
    expect(addNote(old, "past a reclaim a crash left empty", { wait: false }).seq).toBe(33);
    expect(existsSync(join(old, "state"))).toBe(false);

    const young = copySample();
    plantLock(young, stale);
    writeFileSync(guard(young), "", "utf-8");
    utimesSync(guard(young), (Date.now() + 60_000) / 1000, (Date.now() + 60_000) / 1000);
    expect(() => addNote(young, "not past a reclaim being made", { wait: false })).toThrow(
      new WriterBusy(
        "another logbook command is taking over a stale lock on this record (state/writer.lock.reclaim names no holder yet; if none is running, remove it)",
      ),
    );
    expect(readFileSync(lockOf(young), "utf-8")).toBe(stale);
    expect(readFileSync(guard(young), "utf-8")).toBe("");
    expect(readLines(young)).toHaveLength(32);
  });

  it("releases only its own lock: one another writer holds by then is left to it, as the reference leaves it", () => {
    const root = copySample();
    const release = takeWriterLock(root);
    const other = `{"pid": ${process.pid}, "command": "sync immich", "since": "2026-10-13T06:00:00Z"}`;
    writeFileSync(lockOf(root), other, "utf-8");
    release();
    expect(readFileSync(lockOf(root), "utf-8")).toBe(other);
  });

  it("takes the lock in one step: nothing but the lock is left in state/ while it is held", () => {
    const root = copySample();
    const inside = withWriterLock(root, () => readdirSync(join(root, "state")));
    expect(inside).toEqual(["writer.lock"]);
    expect(existsSync(join(root, "state"))).toBe(false);
  });

  it("HeadMoved is a LogbookError, as WriterBusy is, so a caller that catches one catches both; TailAhead is a HeadMoved, as the reference's is", () => {
    expect(new HeadMoved("x")).toBeInstanceOf(LogbookError);
    expect(new WriterBusy("x")).toBeInstanceOf(LogbookError);
    expect(new TailAhead("x")).toBeInstanceOf(HeadMoved);
    expect(new RepairRefused("x")).toBeInstanceOf(LogbookError);
    expect(new HeadMoved("x").name).toBe("HeadMoved");
    expect(new WriterBusy("x").name).toBe("WriterBusy");
    expect(new TailAhead("x").name).toBe("TailAhead");
    expect(new RepairRefused("x").name).toBe("RepairRefused");
  });
});

describe("the writer lock at its edges", () => {
  const reclaimOf = (root: string): string => join(root, "state", "writer.lock.reclaim");
  const stale = (): string =>
    `{"pid": ${deadPid()}, "command": "add", "since": "2026-10-13T06:00:00Z"}`;

  it("a reclaim file naming a living pid (a reclaimer stopped, or a crashed one's pid given to another process) is refused under --no-wait after half a second, not waited out in silence", () => {
    const root = copySample();
    plantLock(root, stale());
    writeFileSync(reclaimOf(root), String(livingPid(3000)), "utf-8");
    const started = Date.now();
    expect(() => addNote(root, "not under --no-wait", { wait: false })).toThrow(WriterBusy);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(readLines(root)).toHaveLength(32);
  }, 20_000);

  it("and waited for with one line saying so, as a lock's holder is, then the stale lock taken", () => {
    const root = copySample();
    plantLock(root, stale());
    const pid = livingPid(1500);
    writeFileSync(reclaimOf(root), String(pid), "utf-8");
    const said: string[] = [];
    expect(addNote(root, "after the reclaimer", { say: (l) => said.push(l) }).seq).toBe(33);
    expect(said[0]).toBe(
      `another logbook command is taking over a stale lock on this record (state/writer.lock.reclaim names pid ${pid}); waiting`,
    );
    expect(said[1]).toMatch(
      /^a stale lock from add \(pid \d+, since 2026-10-13T06:00:00Z\) whose process is gone; taking it over$/,
    );
  }, 20_000);

  it("`taking it over` is said once the lock is taken over, not when the take is then refused (a young, empty reclaim file under --no-wait)", () => {
    const root = copySample();
    plantLock(root, stale());
    writeFileSync(reclaimOf(root), "", "utf-8");
    utimesSync(reclaimOf(root), (Date.now() + 60_000) / 1000, (Date.now() + 60_000) / 1000);
    const said: string[] = [];
    expect(() =>
      addNote(root, "refused after all", { wait: false, say: (l) => said.push(l) }),
    ).toThrow(WriterBusy);
    expect(said).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "a second take in one thread through another spelling of the record (a symlink) is refused as a second take, not met as another writer's lock and waited on for ever",
    () => {
      const root = copySample();
      const link = join(tempDir(), "via-link");
      symlinkSync(root, link);
      expect(() =>
        withWriterLock(root, () => withWriterLock(link, () => 0, { wait: false })),
      ).toThrow(/holds the lock on this record already/);
      expect(existsSync(lockOf(root))).toBe(false);
    },
  );

  it("a folder by the lock's name is refused with a LogbookError naming the file, not a raw EISDIR", () => {
    const root = copySample();
    mkdirSync(lockOf(root), { recursive: true });
    expect(() => addNote(root, "over a folder")).toThrow(LogbookError);
    expect(readLines(root)).toHaveLength(32);
  });
});

describe("the files ahead of logbook.json (SPEC §3, write order): add refuses, repair tail brings it forward (decision B; the reference's #294)", () => {
  const THREE: Draft[] = ["one", "two", "three"].map((text, i) => ({
    at: `2026-04-0${i + 1}T10:00:00Z`,
    source: "manual",
    kind: "note",
    payload: { schema: "note/v1", text },
  }));
  const APRIL = join("logbook", "2026", "04.jsonl");
  const linesOf = (root: string, rel = APRIL): Line[] =>
    readLines(root, rel).map((row) => JSON.parse(row) as Line);
  const short = (hash: string): string => `${hash.slice(0, 12)}…`;
  /** logbook.json set back to the line at `seq` (GENESIS for 0), as a crash before its rename leaves it. */
  const setBack = (root: string, seq: number): void => {
    const head = seq === 0 ? ZERO_HASH : (linesOf(root)[seq - 1] as Line).hash;
    writeMeta(root, { ...readMetaFile(root), seq, head });
  };
  const metaText = (root: string): string => readFileSync(join(root, "logbook.json"), "utf-8");

  it("addNote refuses, in the reference's sentence naming repair tail, while the files end past logbook.json, and writes nothing (was: brought logbook.json forward itself)", () => {
    const root = writeRecord(THREE);
    setBack(root, 1);
    const [, , third] = linesOf(root) as [Line, Line, Line];
    const before = metaText(root);
    const said: string[] = [];
    let thrown: unknown;
    try {
      addNote(root, "four", { say: (l) => said.push(l) });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TailAhead);
    expect((thrown as Error).message).toBe(
      `the files are ahead of logbook.json: they end at seq 3 head ${short(third.hash)}, logbook.json says seq 1 head ${short((linesOf(root)[0] as Line).hash)} (a crash between a line and logbook.json, SPEC §3); nothing was written: run \`logbook-ts repair tail\``,
    );
    expect(said).toEqual([]);
    expect(readLines(root, APRIL)).toHaveLength(3);
    expect(metaText(root)).toBe(before);
    expect(existsSync(join(root, "state"))).toBe(false);
  });

  it("from seq 0 and GENESIS too", () => {
    const root = writeRecord(THREE.slice(0, 1));
    setBack(root, 0);
    expect(() => addNote(root, "two")).toThrow(
      /^the files are ahead of logbook\.json: they end at seq 1 head [0-9a-f]{12}…, logbook\.json says seq 0 head 000000000000… /,
    );
    expect(readLines(root, APRIL)).toHaveLength(1);
  });

  it("addNote refuses in the reference's other sentence when the files end at logbook.json's seq under another head", () => {
    const root = writeRecord(THREE);
    const head = (linesOf(root)[2] as Line).hash;
    writeMeta(root, { ...readMetaFile(root), head: "a".repeat(64) });
    expect(() => addNote(root, "no")).toThrow(
      new TailAhead(
        `the files do not end where logbook.json says: they end at seq 3 head ${short(head)}, logbook.json says seq 3 head aaaaaaaaaaaa…; nothing was written: run \`logbook-ts repair tail\``,
      ),
    );
    expect(readLines(root, APRIL)).toHaveLength(3);
  });

  it("addNote refuses a logbook.json behind the files at a head the chain never held in the same sentence as any lag; repair tail is what tells them apart", () => {
    const root = writeRecord(THREE);
    writeMeta(root, { ...readMetaFile(root), seq: 2, head: "a".repeat(64) });
    expect(() => addNote(root, "no")).toThrow(TailAhead);
    expect(readLines(root, APRIL)).toHaveLength(3);
    expect(readMetaFile(root)).toMatchObject({ seq: 2, head: "a".repeat(64) });
  });

  it("addNote refuses, as the reference's does, a lag whatever else is wrong with the tail in the lag's sentence, a month file cut inside its last line in verify's cut-short sentence, each naming repair tail; and logbook.json ahead of the files as a record that does not verify", () => {
    const ahead = writeRecord(THREE);
    writeMeta(ahead, { ...readMetaFile(ahead), seq: 5 });
    let thrown: unknown;
    try {
      addNote(ahead, "no");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).not.toBeInstanceOf(TailAhead);
    expect((thrown as Error).message).toMatch(
      /^refusing to append to a record that does not verify/,
    );
    expect(readLines(ahead, APRIL)).toHaveLength(3);

    const torn = writeRecord(THREE);
    cutInsideLastLine(torn, APRIL);
    expect(() => addNote(torn, "no")).toThrow(
      new TailAhead(
        `${APRIL} line 3: the file ends inside this line (cut short); nothing was written: run \`logbook-ts repair tail\``,
      ),
    );
    expect(readMetaFile(torn).seq).toBe(2);

    const wrong = writeRecord(THREE);
    const rows = readLines(wrong, APRIL);
    const third = JSON.parse(rows[2] as string) as Line;
    third.payload = { ...third.payload, text: "edited" };
    writeLines(wrong, [rows[0] as string, rows[1] as string, JSON.stringify(third)], APRIL);
    setBack(wrong, 2);
    const second = linesOf(wrong)[1] as Line;
    expect(() => addNote(wrong, "no")).toThrow(
      new TailAhead(
        `the files are ahead of logbook.json: they end at seq 3 head ${short(third.hash)}, logbook.json says seq 2 head ${short(second.hash)} (a crash between a line and logbook.json, SPEC §3); nothing was written: run \`logbook-ts repair tail\``,
      ),
    );
    expect(readMetaFile(wrong).seq).toBe(2);
    expect(readLines(wrong, APRIL)).toHaveLength(3);

    // A second line of one seq at the end: the files end at that seq, the last line's, not at a count.
    const forked = writeRecord(THREE);
    const again = readLines(forked, APRIL);
    writeLines(forked, [...again, again[2] as string], APRIL);
    setBack(forked, 2);
    expect(() => addNote(forked, "no")).toThrow(
      /^the files are ahead of logbook\.json: they end at seq 3 head /,
    );
  });

  it("repair tail --dry-run lists each line past the head by seq, file, row and hash, says what it would set, and writes nothing — as the reference prints it, without the index it keeps", () => {
    const root = writeRecord(THREE);
    setBack(root, 1);
    const lines = linesOf(root);
    const before = metaText(root);
    const report = repairTail(root, { dryRun: true });
    expect(report.written).toBe(false);
    expect(repairTailText(report)).toBe(
      [
        `logbook.json says seq=1 head=${short((lines[0] as Line).hash)}; the files hold 2 lines past it, each verified (envelope, seq, prev, hash):`,
        `  seq 2  ${APRIL} line 2  hash ${short((lines[1] as Line).hash)}`,
        `  seq 3  ${APRIL} line 3  hash ${short((lines[2] as Line).hash)}`,
        `would set logbook.json to seq=3 head=${short((lines[2] as Line).hash)}`,
        "nothing written — run without --dry-run to repair",
        "",
      ].join("\n"),
    );
    expect(metaText(root)).toBe(before);
    expect(existsSync(join(root, "state"))).toBe(false);
  });

  it("repair tail sets logbook.json to the last line's seq and head, keeping its other keys, verify is then valid, and addNote appends the next seq: never 1, 2, 2", () => {
    const root = writeRecord(THREE);
    setBack(root, 1);
    const meta = readMetaFile(root);
    const lines = linesOf(root);
    const report = repairTail(root);
    expect(report.written).toBe(true);
    const third = lines[2] as Line;
    expect(repairTailText(report).split("\n").slice(-3)).toEqual([
      `logbook.json: seq 3, head ${short(third.hash)}`,
      `valid — 3 lines, head ${third.hash}`,
      "",
    ]);
    expect(readMetaFile(root)).toEqual({ ...meta, seq: 3, head: third.hash });
    expect(verifyLogbook(root)).toMatchObject({ valid: true, lines: 3, head: third.hash });
    const line = addNote(root, "four", { now: new Date("2026-04-04T10:00:00Z") });
    expect(line).toMatchObject({ seq: 4, prev: third.hash });
    expect(verifyLogbook(root)).toMatchObject({ valid: true, lines: 4 });
  });

  it("a tail across two month files is listed and brought forward in seq order", () => {
    const drafts: Draft[] = [
      ...THREE,
      {
        at: "2026-05-01T10:00:00Z",
        source: "manual",
        kind: "note",
        payload: { schema: "note/v1", text: "may" },
      },
    ];
    const root = writeRecord(drafts);
    setBack(root, 2);
    const may = join("logbook", "2026", "05.jsonl");
    const report = repairTail(root, { dryRun: true });
    expect(report.shown.map((line) => line.where)).toEqual([`${APRIL} line 3`, `${may} line 1`]);
    expect(repairTail(root).written).toBe(true);
    expect(verifyLogbook(root)).toMatchObject({ valid: true, lines: 4 });
  });

  it("lists the first twenty lines past the head and counts the rest, as the reference does", () => {
    const root = writeRecord(
      Array.from({ length: 33 }, (_, i) => ({
        at: `2026-04-${String(Math.floor(i / 2) + 1).padStart(2, "0")}T${i % 2 ? 18 : 6}:00:00Z`,
        source: "manual",
        kind: "note",
        payload: { schema: "note/v1", text: `note ${i + 1}` },
      })),
    );
    setBack(root, 0);
    const report = repairTail(root, { dryRun: true });
    expect(report.count).toBe(33);
    expect(report.shown).toHaveLength(20);
    const text = repairTailText(report).split("\n");
    expect(text[0]).toBe(
      "logbook.json says seq=0 head=000000000000…; the files hold 33 lines past it, each verified (envelope, seq, prev, hash):",
    );
    expect(text[21]).toBe("  … and 13 more lines");
    setBack(root, 12);
    expect(repairTailText(repairTail(root, { dryRun: true })).split("\n")[21]).toBe(
      "  … and 1 more line",
    );
  });

  it("on a record that verifies, does nothing and says so", () => {
    const root = writeRecord(THREE);
    const before = metaText(root);
    const head = (linesOf(root)[2] as Line).hash;
    for (const dryRun of [true, false]) {
      const report = repairTail(root, { dryRun });
      expect(report.written).toBe(false);
      expect(repairTailText(report)).toBe(
        `nothing to repair: the files end where logbook.json says, seq=3 head=${short(head)}\n`,
      );
    }
    expect(metaText(root)).toBe(before);
  });

  /** repair tail's refusal on a record, and that it changed nothing. */
  function refusal(root: string): string {
    const before = metaText(root);
    const rows = readLines(root, APRIL);
    let thrown: unknown;
    try {
      repairTail(root);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RepairRefused);
    expect(metaText(root)).toBe(before);
    expect(readLines(root, APRIL)).toEqual(rows);
    expect(existsSync(join(root, "state"))).toBe(false);
    return (thrown as Error).message;
  }

  it("refuses, changing nothing, when the files end before logbook.json: no crash leaves that", () => {
    const root = writeRecord(THREE);
    const head = (linesOf(root)[2] as Line).hash;
    writeMeta(root, { ...readMetaFile(root), seq: 4 });
    expect(refusal(root)).toBe(
      `logbook.json says seq=4 head=${short(head)}, the files end at seq=3 head=${short(head)}: the files are behind logbook.json, which no crash leaves (SPEC §3); restore the month files from a backup; nothing was changed`,
    );
  });

  it("refuses, changing nothing, when the files end at logbook.json's seq under another head: not a lag", () => {
    const root = writeRecord(THREE);
    const head = (linesOf(root)[2] as Line).hash;
    writeMeta(root, { ...readMetaFile(root), head: "a".repeat(64) });
    expect(refusal(root)).toBe(
      `logbook.json says seq=3 head=aaaaaaaaaaaa…, the files end at seq=3 head=${short(head)}: no line is past the head and the head is not the files'; run \`logbook-ts verify\`; nothing was changed`,
    );
  });

  it("refuses, changing nothing, when logbook.json names a head the chain does not hold at its seq: the first line past it does not chain from it", () => {
    const root = writeRecord(THREE);
    const second = linesOf(root)[1] as Line;
    writeMeta(root, { ...readMetaFile(root), seq: 1, head: "b".repeat(64) });
    expect(refusal(root)).toBe(
      `${APRIL} line 2: seq 2 — prev ${second.prev} does not match previous hash ${"b".repeat(64)}; nothing was changed`,
    );
  });

  it("refuses, changing nothing, a tail torn inside its last line, naming the line as verify does", () => {
    const root = writeRecord(THREE);
    const first = (linesOf(root)[0] as Line).hash;
    cutInsideLastLine(root, APRIL);
    writeMeta(root, { ...readMetaFile(root), seq: 1, head: first });
    expect(refusal(root)).toBe(
      `${APRIL} line 3: the file ends inside this line (cut short); nothing was changed`,
    );
  });

  it("refuses, changing nothing, a line past the head whose hash does not recompute, or a second line of one seq: never adopted", () => {
    const wrong = writeRecord(THREE);
    const rows = readLines(wrong, APRIL);
    const third = JSON.parse(rows[2] as string) as Line;
    writeLines(
      wrong,
      [
        rows[0] as string,
        rows[1] as string,
        JSON.stringify({ ...third, payload: { ...third.payload, text: "edited" } }),
      ],
      APRIL,
    );
    setBack(wrong, 1);
    expect(refusal(wrong)).toMatch(
      new RegExp(
        `^${APRIL.replace(/\\/g, "\\\\")} line 3: seq 3 — hash ${third.hash} does not recompute \\(got [0-9a-f]{64}\\); nothing was changed$`,
      ),
    );

    const forked = writeRecord(THREE);
    const again = readLines(forked, APRIL);
    writeLines(forked, [...again, again[2] as string], APRIL);
    setBack(forked, 2);
    expect(refusal(forked)).toMatch(/line 4: seq 3 — expected seq 4; nothing was changed$/);
  });

  it("refuses, changing nothing, a record wrong before the head as well, where the reference would bring logbook.json forward and only then report it: the whole chain is verified first", () => {
    const root = writeRecord(THREE);
    const rows = readLines(root, APRIL);
    const first = JSON.parse(rows[0] as string) as Line;
    writeLines(
      root,
      [
        JSON.stringify({ ...first, recorded_at: "2026-10-01T12:00:01Z" }),
        rows[1] as string,
        rows[2] as string,
      ],
      APRIL,
    );
    setBack(root, 2);
    expect(refusal(root)).toMatch(
      /line 1: seq 1 — hash .* does not recompute .*; nothing was changed$/,
    );
  });

  it("holds the writer lock throughout, the dry run too: WriterBusy while a living writer holds it, the lock left to it", () => {
    const root = writeRecord(THREE);
    setBack(root, 1);
    const planted = `{"pid": ${livingPid(20_000)}, "command": "sync immich", "since": "2026-10-13T06:00:00Z"}`;
    plantLock(root, planted);
    for (const dryRun of [true, false]) {
      expect(() => repairTail(root, { dryRun, wait: false })).toThrow(
        new WriterBusy(
          "another logbook command is writing to this record (sync immich, since 2026-10-13T06:00:00Z)",
        ),
      );
    }
    expect(readFileSync(lockOf(root), "utf-8")).toBe(planted);
    expect(readMetaFile(root).seq).toBe(1);
    rmSync(join(root, "state"), { recursive: true, force: true });
  });
});
