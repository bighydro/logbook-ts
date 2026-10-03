// Regenerates this fixture from the reference implementation's demo record:
//   LOGBOOK_REF=/path/to/clone/of/bighydro/logbook node tests/fixtures/demo-seed1/make.mjs
// `logbook demo --seed 1` is the record SPEC §6.1 compares two implementations on: thirty days from
// 2026-06-01 of a person in Oslo who does not exist, 12,772 lines, the same head on every machine.
// This fixture is that record whole — the month files, logbook.json, places.json, assets.json,
// policy/, notes/ and attachments/ — without index.sqlite, which is the reference's own derived
// store. Nothing in it is real. The expected-*/ folders beside it are the reference's output on
// it, captured by tests/fixtures/capture-expected-readers.mjs and never edited by hand.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ref = process.env.LOGBOOK_REF;
if (!ref) {
  process.stderr.write("usage: LOGBOOK_REF=<clone> node tests/fixtures/demo-seed1/make.mjs\n");
  process.exit(2);
}
export const SEED = 1;
const KEPT = ["logbook", "logbook.json", "places.json", "assets.json", "policy", "notes", "attachments"];

const root = dirname(fileURLToPath(import.meta.url));
const demo = mkdtempSync(join(tmpdir(), "logbook-ts-demo-"));
try {
  const made = spawnSync(
    "uv",
    ["run", "--project", ref, "logbook", "demo", "--seed", String(SEED), "--out", join(demo, "Logbook")],
    { cwd: ref, encoding: "utf-8", env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } },
  );
  if (made.status !== 0) throw new Error(`logbook demo failed:\n${made.stderr}`);
  for (const name of readdirSync(root)) {
    if (KEPT.includes(name)) rmSync(join(root, name), { recursive: true, force: true });
  }
  for (const name of KEPT) cpSync(join(demo, "Logbook", name), join(root, name), { recursive: true });
  process.stdout.write(`demo-seed1: ${made.stdout.trim().split("\n")[1]}\n`);
} finally {
  rmSync(demo, { recursive: true, force: true });
}
