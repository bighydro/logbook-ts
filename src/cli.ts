import { addNote, LogbookError, verifyLogbook } from "./store.js";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const USAGE = `usage:
  logbook-ts verify <root>            check the chain; print "valid — N lines, head <hex>"
  logbook-ts add <root> "<text>"      append one note (note/v1, tier 2, source manual)

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

function usage(io: Io): number {
  io.stderr(USAGE);
  return 2;
}
