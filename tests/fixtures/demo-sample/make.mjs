// Regenerates this fixture from the reference implementation's demo record:
//   LOGBOOK_REF=/path/to/clone/of/bighydro/logbook node tests/fixtures/demo-sample/make.mjs
// `logbook demo --days 30 --seed 7` writes a month of a person in Oslo who does not exist (12,766
// lines); this fixture is the part of it that `day` reads for 2026-06-13, 14 and 15 — the lines
// from the local midnight before the first day to the end of the night after the last, which the
// reader's window covers, plus every resolution and retraction line, which it takes from the whole
// record — chained again from the first line so the record verifies. The ids, instants, content
// and recorded_at of every line are the demo's; only seq, prev and hash are new. The settings the
// demo writes (places.json, assets.json, policy/) are copied as they are. The three days print
// exactly as they do on the whole demo, which tests/cross-impl.test.ts checks against the reference.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, hashLine } from "../../../dist/index.js";

const ref = process.env.LOGBOOK_REF;
if (!ref) {
  process.stderr.write("usage: LOGBOOK_REF=<clone> node tests/fixtures/demo-sample/make.mjs\n");
  process.exit(2);
}
export const DAYS = 30;
export const SEED = 7;
/** The window kept: 2026-06-12 00:00 Oslo to 2026-06-16 08:00 Oslo, in UTC. */
const SINCE = Date.parse("2026-06-11T22:00:00Z");
const UNTIL = Date.parse("2026-06-16T06:00:00Z");

const root = dirname(fileURLToPath(import.meta.url));
const demo = mkdtempSync(join(tmpdir(), "logbook-ts-demo-"));
try {
  const made = spawnSync(
    "uv",
    ["run", "--project", ref, "logbook", "demo", "--days", String(DAYS), "--seed", String(SEED), "--out", demo],
    { cwd: ref, encoding: "utf-8", env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } },
  );
  if (made.status !== 0) throw new Error(`logbook demo failed:\n${made.stderr}`);

  const kept = [];
  let total = 0;
  for (const file of ["2026/05.jsonl", "2026/06.jsonl"]) {
    for (const raw of readFileSync(join(demo, "logbook", file), "utf-8").split("\n")) {
      if (raw.trim() === "") continue;
      total += 1;
      const line = JSON.parse(raw);
      const ms = Date.parse(line.at);
      const judgement = line.kind === "resolution" || line.kind === "retraction";
      if (judgement || (ms >= SINCE && ms <= UNTIL)) kept.push(line);
    }
  }
  kept.sort((a, b) => a.seq - b.seq);

  let prev = "0".repeat(64);
  const out = [];
  kept.forEach((line, i) => {
    const full = { ...line, seq: i + 1, prev, hash: "" };
    full.hash = hashLine(full);
    prev = full.hash;
    out.push(canonicalize(full));
  });
  const byMonth = new Map();
  for (const text of out) {
    const month = JSON.parse(text).at.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), text]);
  }
  rmSync(join(root, "logbook"), { recursive: true, force: true });
  for (const [month, lines] of byMonth) {
    const dir = join(root, "logbook", month.slice(0, 4));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${month.slice(5, 7)}.jsonl`), `${lines.join("\n")}\n`, "utf-8");
  }
  const meta = JSON.parse(readFileSync(join(demo, "logbook.json"), "utf-8"));
  writeFileSync(
    join(root, "logbook.json"),
    `${JSON.stringify({ ...meta, seq: out.length, head: prev }, null, 2)}\n`,
    "utf-8",
  );
  for (const name of ["places.json", "assets.json"]) cpSync(join(demo, name), join(root, name));
  rmSync(join(root, "policy"), { recursive: true, force: true });
  cpSync(join(demo, "policy"), join(root, "policy"), { recursive: true });
  process.stdout.write(`demo-sample: ${out.length} of ${total} lines kept, head ${prev}\n`);
} finally {
  rmSync(demo, { recursive: true, force: true });
}
