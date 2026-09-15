# logbook-ts

**An independent second implementation of the [Logbook](https://github.com/bighydro/logbook) format, in TypeScript.**

The Logbook spec says it should be small enough to implement in an afternoon, and that two independent
implementations must agree before v1.0 is frozen. This is the second one. It was written from
[SPEC.md](https://github.com/bighydro/logbook/blob/v0.3.0/SPEC.md) alone: no Python was read, and every
place the spec left a choice is written down in [SPEC-QUESTIONS.md](./SPEC-QUESTIONS.md).

Zero runtime dependencies. RFC 8785 canonical JSON, SHA-256 chaining and UUIDv7 are implemented by hand on
Node's built-ins.

## Sixty seconds

```bash
git clone https://github.com/bighydro/logbook-ts && cd logbook-ts
pnpm install && pnpm build

# the conformance sample from the spec repo: one week of a fictional person in Oslo
node dist/bin.js verify tests/fixtures/sample-logbook
#  valid — 16 lines, head 53d39fdad121ce8e448221bbdaa9c86396c16347d050bf630035d6f1d37088e6

# append a note to a copy; the chain still verifies
cp -R tests/fixtures/sample-logbook /tmp/mine
node dist/bin.js add /tmp/mine "read the spec, wrote a second implementation"
node dist/bin.js verify /tmp/mine
#  valid — 17 lines, head <new hex>

# change one byte inside any line and it is no longer a logbook
sed -i.bak 's/"accuracy_m": 12/"accuracy_m": 13/' /tmp/mine/logbook/2026/03.jsonl
node dist/bin.js verify /tmp/mine
#  invalid — 1 error
#    logbook/2026/03.jsonl line 1: seq 1 — hash 129e6cdc… does not recompute (got cd36ca92…)
```

`pnpm link --global` (or `npm i -g .`) puts the same thing on your path as `logbook-ts`.

## What it does

Exactly SPEC §6, the conformance rule, and nothing else yet.

| Command | Does |
|---|---|
| `logbook-ts verify <root>` | Reads every `logbook/<YYYY>/<MM>.jsonl`, orders the lines by `seq` (files partition by the month of `at`, not by chain order), checks that each `seq` is the previous plus one, each `prev` is the previous `hash`, each `hash` recomputes, and `logbook.json` names the last line. Prints `valid — N lines, head <hex>` and exits 0, or the errors on stderr and exits 1. Refuses any `format` other than `logbook/0.2`. |
| `logbook-ts add <root> "<text>"` | Appends one `note/v1` line: UUIDv7 id, `at` and `recorded_at` now in RFC 3339 UTC, `tz` from `logbook.json`, tier 2, source `manual`. Then replaces `logbook.json` atomically (temp file, rename). Refuses to append to a record that does not verify. |

The hash is SPEC §3 to the letter:

```
content = canonical_json({at, end, tz, source, kind, tier, payload})     # RFC 8785
hash    = sha256( prev + "|" + seq + "|" + sha256(content) + "|" + recorded_at )
```

`canonical_json` is a hand-written RFC 8785: keys sorted by UTF-16 code units, no whitespace, ECMAScript
number layout, NaN, Infinity and lone surrogates rejected. It is tested against the RFC's §3.2.3 example and
Appendix B vectors, and with property tests that any JSON value round-trips through it to identical bytes.

## As a library

```ts
import { addNote, canonicalize, hashLine, verifyLogbook } from "logbook-ts";

const result = verifyLogbook("/path/to/root"); // { valid, lines, head, errors }
const line = addNote("/path/to/root", "a note"); // the Line that was written
canonicalize({ b: 1, a: [1e21, 0.000001] }); // '{"a":[1e+21,0.000001],"b":1}'
```

## Developing

```bash
pnpm install
pnpm test          # vitest: unit, RFC vectors, property tests, conformance sample
pnpm lint          # biome
pnpm typecheck     # tsc --noEmit, strict
pnpm build         # tsup → dist/
pnpm check         # all four
pre-commit install # lint, format, gitleaks, no commits to main
```

CI runs the suite on ubuntu, macOS and Windows with Node 20 and 22, and a separate job clones the spec
repo at its tag and runs SPEC §6 against the fixture as published there.

Rules for anyone (or any agent) changing this repo are in [CLAUDE.md](./CLAUDE.md). Nothing in the
fixtures is real; the sample person lives in Oslo and does not exist.

## License

Apache-2.0. The spec itself is CC0.
