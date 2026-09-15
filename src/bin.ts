#!/usr/bin/env node
import { main } from "./cli.js";

process.exitCode = main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text, "utf8"),
  stderr: (text) => process.stderr.write(text, "utf8"),
});
