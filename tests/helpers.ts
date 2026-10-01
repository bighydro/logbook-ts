import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
export const SAMPLE = join(FIXTURES, "sample-logbook");
export const EXPECTED = JSON.parse(readFileSync(join(FIXTURES, "expected.json"), "utf-8")) as {
  format: string;
  seq: number;
  head: string;
};

const made: string[] = [];

/** A fresh temp folder, removed by `cleanup()`. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "logbook-ts-"));
  made.push(dir);
  return dir;
}

/** A writable copy of the conformance sample. */
export function copySample(): string {
  const dir = join(tempDir(), "sample");
  cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}

/** An empty logbook: logbook.json only, seq 0, head of sixty-four zeros. */
export function freshLogbook(timezone = "Europe/Oslo", format = "logbook/0.2"): string {
  const dir = join(tempDir(), "fresh");
  cpSync(SAMPLE, dir, { recursive: true, filter: (src) => !src.endsWith(".jsonl") });
  rmSync(join(dir, "logbook"), { recursive: true, force: true });
  writeMeta(dir, {
    format,
    owner_id: "00000000-0000-4000-8000-000000000002",
    created_at: "2026-01-01T00:00:00Z",
    timezone,
    seq: 0,
    head: "0".repeat(64),
  });
  return dir;
}

export function readMetaFile(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, "logbook.json"), "utf-8")) as Record<string, unknown>;
}

export function writeMeta(root: string, meta: Record<string, unknown>): void {
  writeFileSync(join(root, "logbook.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
}

export const SAMPLE_MONTH = join("logbook", "2026", "03.jsonl");

export function readLines(root: string, rel = SAMPLE_MONTH): string[] {
  return readFileSync(join(root, rel), "utf-8").split("\n").filter(Boolean);
}

export function writeLines(root: string, lines: string[], rel = SAMPLE_MONTH): void {
  writeFileSync(join(root, rel), `${lines.join("\n")}\n`, "utf-8");
}

export function cleanup(): void {
  while (made.length) {
    const dir = made.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** The `<day>.txt` and `<day>.raw.txt` files beside a fixture: `logbook show` of the reference on it. */
export function expectedShows(root: string): Array<{ day: string; raw: boolean; text: string }> {
  const dir = join(root, "expected-show");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".txt"))
    .sort()
    .map((name) => ({
      day: name.slice(0, 10),
      raw: name.endsWith(".raw.txt"),
      text: readFileSync(join(dir, name), "utf-8"),
    }));
}
