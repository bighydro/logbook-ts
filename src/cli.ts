import { isDay, type ShowRangeOptions, showDay, showRange } from "./show.js";
import { addNote, LogbookError, verifyLogbook } from "./store.js";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const USAGE = `usage:
  logbook-ts verify <root>            check the chain; print "valid — N lines, head <hex>"
  logbook-ts add <root> "<text>"      append one note (note/v1, tier 2, source manual)
  logbook-ts show <root> --day YYYY-MM-DD [--tz <zone>] [--raw] [--profile <schema>]
                                      print the day as the reference does: local time, kind, source,
                                      summary, then the day's notes file (--tz defaults to
                                      logbook.json; --raw prints refs as given and bodies whole;
                                      --profile keeps lines of that payload schema only, "note/v1"
                                      or "note" for any version, repeatable or comma-separated)
  logbook-ts show <root> [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--tz <zone>] [--raw] [--profile <schema>]
                                      the same for every day of the range that has a line, oldest
                                      first, streamed; a missing bound is the record's first or
                                      last day

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
        const { day, ...range } = flags;
        if (day !== undefined) {
          io.stdout(showDay(root, { day, ...range }).text);
          return 0;
        }
        const shown = showRange(root, range);
        let count = 0;
        for (const result of shown.days) {
          io.stdout(count === 0 ? result.text : `\n${result.text}`);
          count += 1;
        }
        if (count === 0) {
          const span = [shown.since, shown.until].filter((d) => d !== undefined);
          io.stdout(`${span.length ? `${[...new Set(span)].join("–")}: ` : ""}nothing logged\n`);
        }
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

type ShowFlags = ShowRangeOptions & { day?: string };

/**
 * `--day D`, `--since D`, `--until D`, `--tz Z`, `--profile P[,P…]` (each also as `--flag=value`,
 * `--profile` repeatable) and `--raw`; undefined on anything else, a bad day, an empty profile, a
 * range that runs backwards, or `--day` with a bound.
 */
function parseShowFlags(args: string[]): ShowFlags | undefined {
  const days: Record<"--day" | "--since" | "--until", string | undefined> = {
    "--day": undefined,
    "--since": undefined,
    "--until": undefined,
  };
  let timezone: string | undefined;
  let raw = false;
  const profiles: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const take = (): string | undefined => (eq === -1 ? args[++i] : arg.slice(eq + 1));
    switch (name) {
      case "--day":
      case "--since":
      case "--until": {
        const value = take();
        if (value === undefined || !isDay(value)) return undefined;
        days[name] = value;
        break;
      }
      case "--tz":
        timezone = take();
        break;
      case "--profile": {
        const given = take();
        if (given === undefined) return undefined;
        for (const profile of given.split(",")) {
          if (profile === "") return undefined;
          profiles.push(profile);
        }
        break;
      }
      case "--raw":
        if (eq !== -1) return undefined;
        raw = true;
        break;
      default:
        return undefined;
    }
  }
  const { "--day": day, "--since": since, "--until": until } = days;
  if (timezone === "") return undefined;
  if (day !== undefined && (since !== undefined || until !== undefined)) return undefined;
  if (day === undefined && since === undefined && until === undefined) return undefined;
  if (since !== undefined && until !== undefined && since > until) return undefined;
  const flags: ShowFlags = { raw };
  if (profiles.length) flags.profiles = profiles;
  if (day !== undefined) flags.day = day;
  if (since !== undefined) flags.since = since;
  if (until !== undefined) flags.until = until;
  if (timezone !== undefined) flags.timezone = timezone;
  return flags;
}

function usage(io: Io): number {
  io.stderr(USAGE);
  return 2;
}
