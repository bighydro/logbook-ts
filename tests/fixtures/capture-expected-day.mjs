// Re-captures a fixture's expected-day files from the reference implementation:
//   LOGBOOK_REF=/path/to/clone/of/bighydro/logbook node tests/fixtures/capture-expected-day.mjs day-sample [day ...]
// Without days, the days already in expected-day/ are captured again. For each day, `logbook day <day>`
// of the reference goes to expected-day/<day>.txt and `logbook day <day> --json` to <day>.json, run
// on a disposable copy of the fixture (the reference writes index.sqlite beside the record). Never
// edit the files by hand.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ref = process.env.LOGBOOK_REF;
const [fixture, ...given] = process.argv.slice(2);
if (!ref || !fixture) {
  process.stderr.write("usage: LOGBOOK_REF=<clone> node capture-expected-day.mjs <fixture> [day ...]\n");
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), fixture);
const out = join(root, "expected-day");
mkdirSync(out, { recursive: true });
const days = given.length
  ? given
  : [...new Set(readdirSync(out).filter((f) => /\.(txt|json)$/.test(f)).map((f) => f.slice(0, 10)))];
const copy = mkdtempSync(join(tmpdir(), "logbook-ts-capture-"));
try {
  cpSync(root, copy, { recursive: true, filter: (src) => !src.includes("expected-") });
  for (const day of days) {
    for (const json of [false, true]) {
      const args = ["run", "--project", ref, "logbook", "day", day, ...(json ? ["--json"] : [])];
      const result = spawnSync("uv", args, {
        cwd: ref,
        encoding: "utf-8",
        env: { ...process.env, LOGBOOK_HOME: copy, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      });
      if (result.status !== 0) throw new Error(`reference failed on ${day}${json ? " --json" : ""}:\n${result.stderr}`);
      const file = join(out, `${day}.${json ? "json" : "txt"}`);
      writeFileSync(file, result.stdout, "utf-8");
      process.stdout.write(`${file}\n`);
    }
  }
} finally {
  rmSync(copy, { recursive: true, force: true });
}
