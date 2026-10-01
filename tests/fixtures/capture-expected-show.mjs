// Re-captures a fixture's expected-show files from the reference implementation:
//   LOGBOOK_REF=/path/to/clone/of/bighydro/logbook node tests/fixtures/capture-expected-show.mjs show-sample [day ...]
// Without days, the days already in expected-show/ are captured again. The reference runs on a
// disposable copy of the fixture (it writes index.sqlite beside the record). Never edit the files by hand.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ref = process.env.LOGBOOK_REF;
const [fixture, ...given] = process.argv.slice(2);
if (!ref || !fixture) {
  process.stderr.write("usage: LOGBOOK_REF=<clone> node capture-expected-show.mjs <fixture> [day ...]\n");
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), fixture);
const out = join(root, "expected-show");
mkdirSync(out, { recursive: true });
const days = given.length
  ? given
  : [...new Set(readdirSync(out).filter((f) => f.endsWith(".txt")).map((f) => f.slice(0, 10)))];
const copy = mkdtempSync(join(tmpdir(), "logbook-ts-capture-"));
try {
  cpSync(root, copy, { recursive: true, filter: (src) => !src.includes("expected-show") });
  for (const day of days) {
    for (const raw of [false, true]) {
      const args = ["run", "--project", ref, "logbook", "show", day, ...(raw ? ["--raw"] : [])];
      const result = spawnSync("uv", args, {
        cwd: ref,
        encoding: "utf-8",
        env: { ...process.env, LOGBOOK_HOME: copy, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      });
      if (result.status !== 0) throw new Error(`reference failed on ${day}${raw ? " --raw" : ""}:\n${result.stderr}`);
      const file = join(out, `${day}${raw ? ".raw" : ""}.txt`);
      writeFileSync(file, result.stdout, "utf-8");
      process.stdout.write(`${file}\n`);
    }
  }
} finally {
  rmSync(copy, { recursive: true, force: true });
}
