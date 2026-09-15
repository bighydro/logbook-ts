# For agents working in this repository

logbook-ts is an independent second implementation of the Logbook format, written from
`SPEC.md` of https://github.com/bighydro/logbook (tag v0.3.0) without reading the Python source.
Read that SPEC and `SPEC-QUESTIONS.md` first.

Hard rules — a change that needs to break one is wrong; stop and say so:
- Never write to the log except through `addNote` (a future `append`). Never UPDATE or DELETE a line, in code or by hand.
- Never add real personal data to the repository. Fixtures are synthetic; the sample person lives in Oslo and does not exist.
- Never add a runtime dependency. `dependencies` in `package.json` stays empty; JCS, hashing and UUIDs are hand-written on Node built-ins.
- Never add network calls to a default code path.
- Never change the envelope or the hash rule (SPEC §2–3) here; that happens in the spec repo with a version bump and a regenerated fixture. This repo follows.
- Do not read the Python implementation to resolve an ambiguity; write it in `SPEC-QUESTIONS.md` instead.
- Test first: write the failing test, run it, implement, run it, commit with `-s`. One issue per task, closed by the commit.
- Never commit to `main`; branch, push, open a PR. Never merge.

Conventions: `pnpm` for everything (`pnpm install`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm check` for all four).
Conventional commits (`feat:`, `fix:`, `spec:`, `docs:`, `ci:`). TypeScript strict, ESM only, biome for lint and format.
Plain English names inside the code: Logbook, Line, Meta, Note — no metaphors.

## Cross-platform (CI runs ubuntu, macos and windows × Node 20 and 22)

- Paths: never match, split or join them as strings; use `node:path` (`join`, `basename`). Windows returns backslashes.
- Encoding: every `readFileSync`/`writeFileSync`/`appendFileSync` passes `"utf-8"` explicitly. Never rely on a default.
- Line endings: `.jsonl` is `\n`-terminated; readers tolerate a trailing `\r`. `.gitattributes` forces LF on checkout.
- Console output: write strings through `process.stdout.write(text, "utf8")`; tests capture output through the `Io` object, never by spawning a shell.
- Open files: Windows refuses to delete or rename a file that any handle still holds. Use the synchronous whole-file calls (they close on return) and close every handle before an `unlink` or `rename`.
- Atomic replace: write a sibling temp file, then `renameSync` over the target. Never write into the target in place.
- Temp folders in tests: `mkdtempSync(join(tmpdir(), …))`, removed in `afterEach` with `rmSync(…, { recursive: true, force: true })`.
- Filesystems: macOS and Windows are case-insensitive by default. Never rely on case to tell files apart.
- Timezones: the `tz` written by `add` is the string in `logbook.json`; nothing here needs a zone database.
