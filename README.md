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

# read a day, in the owner's timezone
node dist/bin.js show tests/fixtures/sample-logbook --day 2026-03-01
#  08:30        location  sim-phone     tier 1  2 points 08:30–09:40
#  10:00–11:00  event     sim-calendar  tier 1  Coffee with Ines (ines@example.org)
#  10:12        photo     sim-camera    tier 1  photo/v1
#  22:00        note      manual        tier 2  Ines is moving to Tromsø in May. Ask her about the northern lights trip.
#  23:30–07:45  sleep     sim-watch     tier 3  health-sample/v1
```

`pnpm link --global` (or `npm i -g .`) puts the same thing on your path as `logbook-ts`.

## What it does

SPEC §6, the conformance rule, and one reader.

| Command | Does |
|---|---|
| `logbook-ts verify <root>` | Reads every `logbook/<YYYY>/<MM>.jsonl`, orders the lines by `seq` (files partition by the month of `at`, not by chain order), checks that each `seq` is the previous plus one, each `prev` is the previous `hash`, each `hash` recomputes, and `logbook.json` names the last line. Prints `valid — N lines, head <hex>` and exits 0, or the errors on stderr and exits 1. Refuses any `format` other than `logbook/0.2`. |
| `logbook-ts add <root> "<text>"` | Appends one `note/v1` line: UUIDv7 id, `at` and `recorded_at` now in RFC 3339 UTC, `tz` from `logbook.json`, tier 2, source `manual`. Then replaces `logbook.json` atomically (temp file, rename). Refuses to append to a record that does not verify. |
| `logbook-ts show <root> --day YYYY-MM-DD [--tz <zone>] [--raw]` | Prints one local day of the record, sorted by `at`: local time, kind, source, tier and a one-line summary. Only reads. See below. |

The hash is SPEC §3 to the letter:

```
content = canonical_json({at, end, tz, source, kind, tier, payload})     # RFC 8785
hash    = sha256( prev + "|" + seq + "|" + sha256(content) + "|" + recorded_at )
```

`canonical_json` is a hand-written RFC 8785: keys sorted by UTF-16 code units, no whitespace, ECMAScript
number layout, NaN, Infinity and lone surrogates rejected. It is tested against the RFC's §3.2.3 example and
Appendix B vectors, and with property tests that any JSON value round-trips through it to identical bytes.

## Reading a day

`show` prints the lines whose `at` falls on the given calendar day in a timezone: `--tz` if given, else
the owner's `timezone` from `logbook.json`. The zone comes from Node's built-in ICU (`Intl`), not from a
dependency. A line with an `end` prints its span (`10:00–11:00`); a span that crosses midnight is still
listed on the day it starts.

The summary depends on the kind:

| Kind | Summary |
|---|---|
| `location` | `lat,lon`. A run of consecutive points collapses to `n points 08:12–09:40` (first `at` to the last point's `end`, or its `at`) unless `--raw`. |
| `message` | the chat, the sender in parentheses, then the text: `Sailing club (Ola Nordmann): Regatta moved to Sunday`. The owner's own messages say `(me)`; the sender is dropped when it is the chat's own name. |
| `event` | the title, then the attendees in parentheses. |
| `note` | the text. |
| `resolution` | the ref and what it says: `email ines@example.org → person Ines Holm`, or `handle 2360…@lid → alias of phone +4790000001`. |
| anything else | `text`, else `title`, else the payload `schema`. |

Summaries are cut to their first line and 80 characters. A line hidden by a `retraction/v1` line
(RFC 0003) stays in its place and prints `[retracted: <reason>]` instead of its summary; the retraction
itself is not listed on its own day.

People are named from the record's own `resolution/v1` lines (RFC 0006), never from a contact list:
for each ref (`{kind, value}`, such as a phone number or an email address) the last resolution line in
chain order that stands wins; a line retracted, or named in a later resolution's `supersedes`, does not
stand; an `alias_of` line is followed to its target ref, at most four hops, stopping on a cycle or at a
ref nothing resolves. When no resolution names a ref, the name the source itself attached
(`sender.name`, an attendee's `name`) is used, then, for a direct chat, the chat's name, then the raw
value. `--raw` prints every ref exactly as the source gave it and ignores those names.

`show` streams: every month file is read once through a fixed buffer for resolution and retraction lines,
and only the month files around the day are read for its lines. Nothing is loaded whole and nothing is
written; no index is built. `tests/fixtures/show-sample` is a synthetic record (the same imaginary
person in Oslo) with a run of points, an alias hop, a retracted resolution, a retracted note and a
line at 22:30 UTC that is the next day in Oslo; `make.mjs` beside it regenerates it.

```bash
node dist/bin.js show tests/fixtures/show-sample --day 2026-03-14
#  08:12        location  sim-phone     tier 1  3 points 08:12–09:40
#  10:00–11:00  event     sim-calendar  tier 1  Coffee with Ines (Ines Holm-Berg)
#  10:30        photo     sim-camera    tier 1  photo/v1
#  12:05        message   whatsapp      tier 2  Sailing club (Ola Nordmann): Regatta moved to Sunday
#  12:07        message   whatsapp      tier 2  Kari (Kari M): Hei, lunch?
#  12:09        message   whatsapp      tier 2  Kari (me): On my way
#  21:30        note      manual        tier 2  Regatta Sunday.
#  22:00        location  sim-phone     tier 1  59.911,10.75
#  22:30        note      manual        tier 2  [retracted: typo]
```

The sender of the 12:05 message is a WhatsApp linked-device id; an alias line pairs it with a phone
number, and a contacts import names that number. The 12:07 sender's resolution was retracted, so the
name WhatsApp itself showed is printed. `--raw` gives `(236000000000001@lid)` and `(+4790000002)`.

## As a library

```ts
import { addNote, buildResolver, canonicalize, hashLine, showDay, verifyLogbook } from "logbook-ts";

const result = verifyLogbook("/path/to/root"); // { valid, lines, head, errors }
const line = addNote("/path/to/root", "a note"); // the Line that was written
const day = showDay("/path/to/root", { day: "2026-03-14", timezone: "Europe/Oslo" }); // { text, timezone, rows }
buildResolver(lines).name({ kind: "email", value: "ines@example.org" }); // "Ines Holm-Berg" or undefined
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
