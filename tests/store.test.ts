import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashLine, ZERO_HASH } from "../src/chain.js";
import { addNote, LogbookError, verifyLogbook } from "../src/store.js";
import type { Line } from "../src/types.js";
import {
  cleanup,
  copySample,
  EXPECTED,
  freshLogbook,
  readLines,
  readMetaFile,
  SAMPLE,
  SAMPLE_MONTH,
  writeLines,
  writeMeta,
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
    writeLines(root, [...lines, lines[15] as string]);
    expect(verifyLogbook(root).errors.some((e) => /seq 16/.test(e))).toBe(true);

    const gapped = readLines(root).slice(0, 16);
    const last = JSON.parse(gapped[15] as string) as Line;
    last.seq = 18;
    last.hash = hashLine(last);
    gapped[15] = JSON.stringify(last);
    writeLines(root, gapped);
    expect(verifyLogbook(root).errors.some((e) => /expected seq 16/.test(e))).toBe(true);
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
    writeMeta(root, { ...readMetaFile(root), seq: 15 });
    expect(verifyLogbook(root).errors.some((e) => /logbook\.json/.test(e) && /seq/.test(e))).toBe(
      true,
    );
    writeMeta(root, { ...readMetaFile(root), seq: 16, head: "a".repeat(64) });
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
    writeMeta(root, { ...readMetaFile(root), head: (lines[15] as Line).hash });
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
      seq: 17,
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
    expect(result.lines).toBe(17);
    expect(result.head).toBe(line.hash);

    const meta = readMetaFile(root);
    expect(meta.seq).toBe(17);
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
    expect(march.split("\n").filter(Boolean)).toHaveLength(17);
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

  it("refuses a logbook/0.1 record and writes nothing", () => {
    const root = copySample();
    writeMeta(root, { ...readMetaFile(root), format: "logbook/0.1" });
    expect(() => addNote(root, "no")).toThrow(LogbookError);
    expect(readLines(root)).toHaveLength(16);
    expect(readMetaFile(root).seq).toBe(16);
  });

  it("refuses when logbook.json is missing and refuses empty text", () => {
    const root = join(copySample(), "missing");
    expect(() => addNote(root, "no")).toThrow(LogbookError);
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
    expect(readLines(root)).toHaveLength(16);
  });
});
