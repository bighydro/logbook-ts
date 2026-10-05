// Re-captures a fixture's expected output for one of the readers added after `trips` from the reference:
//   LOGBOOK_REF=/path/to/clone/of/bighydro/logbook node tests/fixtures/capture-expected-readers.mjs <fixture> <reader> [window ...]
// <reader> is `days`, `nights`, `countries` or `people`. A window is `all` (no flags), a year `YYYY`
// (`--year`; not for `days`), or `YYYY-MM-DD..YYYY-MM-DD` (`--since` and `--until`; `--from` and `--to`
// for `days`; not for `people`). Without windows, the windows already in expected-<reader>/ are captured
// again. For each, the reader's text goes to expected-<reader>/<window>.txt and its `--json` to
// <window>.json (<window>.jsonl for `days`, which prints JSON Lines), run on a disposable copy of the
// fixture (the reference writes index.sqlite beside the record). Never edit the files by hand.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ref = process.env.LOGBOOK_REF;
const [fixture, reader, ...given] = process.argv.slice(2);
const COMMANDS = { days: ["days"], nights: ["rollup", "nights"], countries: ["rollup", "countries"], people: ["people"] };
if (!ref || !fixture || !COMMANDS[reader]) {
  process.stderr.write("usage: LOGBOOK_REF=<clone> node capture-expected-readers.mjs <fixture> days|nights|countries|people [all|YYYY|since..until ...]\n");
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), fixture);
const dir = join(root, `expected-${reader}`);
mkdirSync(dir, { recursive: true });
const windows = given.length
  ? given
  : [...new Set(readdirSync(dir).filter((f) => /\.(txt|json|jsonl)$/.test(f)).map((f) => f.replace(/\.(txt|json|jsonl)$/, "")))];
/** The flags a window name stands for, for this reader. */
export function windowFlags(name, reader) {
  if (name === "all") return [];
  if (/^\d{4}$/.test(name) && reader !== "days") return ["--year", name];
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(name);
  if (!m || reader === "people") throw new Error(`not a window of ${reader}: ${name}`);
  return reader === "days" ? ["--from", m[1], "--to", m[2]] : ["--since", m[1], "--until", m[2]];
}
const copy = mkdtempSync(join(tmpdir(), "logbook-ts-capture-"));
try {
  cpSync(root, copy, { recursive: true, filter: (src) => !src.includes("expected-") });
  for (const name of windows) {
    for (const json of [false, true]) {
      const args = ["run", "--project", ref, "logbook", ...COMMANDS[reader], ...windowFlags(name, reader), ...(json ? ["--json"] : [])];
      const result = spawnSync("uv", args, {
        cwd: ref,
        encoding: "utf-8",
        env: { ...process.env, LOGBOOK_HOME: copy, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      });
      if (result.status !== 0) throw new Error(`reference failed on ${reader} ${name}${json ? " --json" : ""}:\n${result.stderr}`);
      const file = join(dir, `${name}.${json ? (reader === "days" ? "jsonl" : "json") : "txt"}`);
      writeFileSync(file, result.stdout, "utf-8");
      process.stdout.write(`${file}\n`);
    }
  }
} finally {
  rmSync(copy, { recursive: true, force: true });
}
