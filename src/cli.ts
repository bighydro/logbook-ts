import { isDay, type ShowOptions, showDay } from "./show.js";
import { addNote, LogbookError, verifyLogbook } from "./store.js";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const USAGE = `usage:
  logbook-ts verify <root>            check the chain; print "valid — N lines, head <hex>"
  logbook-ts add <root> "<text>"      append one note (note/v1, tier 2, source manual)
  logbook-ts show <root> --day YYYY-MM-DD [--tz <zone>] [--raw]
                                      print the day's lines: local time, kind, source, tier, summary
                                      (--tz defaults to logbook.json; --raw keeps every point and ref)

<root> is the folder that holds logbook.json and logbook/<YYYY>/<MM>.jsonl.
`;

/** Run the CLI without touching process globals. Returns the exit code. */
export function main(argv: string[], io: Io): number {
  const [command, root, ...rest] = argv;
  if (command === "--help" || command === "-h" || command === "help") {
    io.stdout(USAGE);
    return 0;
  }
  try {
    switch (command) {
      case "verify": {
        if (root === undefined || rest.length) return usage(io);
        const result = verifyLogbook(root);
        if (result.valid) {
          io.stdout(`valid — ${result.lines} lines, head ${result.head}\n`);
          return 0;
        }
        io.stderr(
          `invalid — ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}\n`,
        );
        for (const error of result.errors) io.stderr(`  ${error}\n`);
        return 1;
      }
      case "add": {
        if (root === undefined || rest.length === 0) return usage(io);
        const line = addNote(root, rest.join(" "));
        io.stdout(`added seq ${line.seq} ${line.id} at ${line.at}, head ${line.hash}\n`);
        return 0;
      }
      case "show": {
        if (root === undefined) return usage(io);
        const flags = parseShowFlags(rest);
        if (flags === undefined) return usage(io);
        const result = showDay(root, flags);
        io.stdout(result.text);
        return 0;
      }
      default:
        return usage(io);
    }
  } catch (err) {
    if (err instanceof LogbookError) {
      io.stderr(`error: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

/** `--day D`, `--day=D`, `--tz Z`, `--tz=Z`, `--raw`; undefined on anything else or a bad day. */
function parseShowFlags(args: string[]): ShowOptions | undefined {
  let day: string | undefined;
  let timezone: string | undefined;
  let raw = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const take = (): string | undefined => (eq === -1 ? args[++i] : arg.slice(eq + 1));
    switch (name) {
      case "--day":
        day = take();
        break;
      case "--tz":
        timezone = take();
        break;
      case "--raw":
        if (eq !== -1) return undefined;
        raw = true;
        break;
      default:
        return undefined;
    }
  }
  if (day === undefined || !isDay(day) || timezone === "") return undefined;
  return timezone === undefined ? { day, raw } : { day, timezone, raw };
}

function usage(io: Io): number {
  io.stderr(USAGE);
  return 2;
}
