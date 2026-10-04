// Re-captures a fixture's expected-trips, expected-countries and expected-nights files from the reference implementation:
//   LOGBOOK_REF=/path/to/clone/of/bighydro/logbook node tests/fixtures/capture-expected-trips.mjs <fixture> [window ...]
// A window is `all` (the whole record), a year `YYYY` (`--year`), or `YYYY-MM-DD..YYYY-MM-DD` (`--since`
// and `--until`). Without windows, the windows already in expected-trips/ are captured again. For each,
// `logbook trips` of the reference goes to expected-trips/<window>.txt and `--json` to <window>.json,
// `logbook rollup countries` to expected-countries/ and `logbook rollup nights` to expected-nights/ the
// same way, run on a disposable copy of the fixture (the reference writes index.sqlite beside the
// record). Never edit the files by hand.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ref = process.env.LOGBOOK_REF;
const [fixture, ...given] = process.argv.slice(2);
if (!ref || !fixture) {
  process.stderr.write("usage: LOGBOOK_REF=<clone> node capture-expected-trips.mjs <fixture> [all|YYYY|since..until ...]\n");
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), fixture);
const trips = join(root, "expected-trips");
const countries = join(root, "expected-countries");
const nights = join(root, "expected-nights");
mkdirSync(trips, { recursive: true });
mkdirSync(countries, { recursive: true });
mkdirSync(nights, { recursive: true });
const windows = given.length
  ? given
  : [...new Set(readdirSync(trips).filter((f) => /\.(txt|json)$/.test(f)).map((f) => f.replace(/\.(txt|json)$/, "")))];
/** The flags a window name stands for. */
export function windowFlags(name) {
  if (name === "all") return [];
  if (/^\d{4}$/.test(name)) return ["--year", name];
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(name);
  if (!m) throw new Error(`not a window: ${name}`);
  return ["--since", m[1], "--until", m[2]];
}
const copy = mkdtempSync(join(tmpdir(), "logbook-ts-capture-"));
try {
  cpSync(root, copy, { recursive: true, filter: (src) => !src.includes("expected-") });
  for (const name of windows) {
    for (const [dir, command] of [[trips, ["trips"]], [countries, ["rollup", "countries"]], [nights, ["rollup", "nights"]]]) {
      for (const json of [false, true]) {
        const args = ["run", "--project", ref, "logbook", ...command, ...windowFlags(name), ...(json ? ["--json"] : [])];
        const result = spawnSync("uv", args, {
          cwd: ref,
          encoding: "utf-8",
          env: { ...process.env, LOGBOOK_HOME: copy, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
        });
        if (result.status !== 0) throw new Error(`reference failed on ${command.join(" ")} ${name}${json ? " --json" : ""}:\n${result.stderr}`);
        const file = join(dir, `${name}.${json ? "json" : "txt"}`);
        writeFileSync(file, result.stdout, "utf-8");
        process.stdout.write(`${file}\n`);
      }
    }
  }
} finally {
  rmSync(copy, { recursive: true, force: true });
}
