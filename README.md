# logbook-ts

**An independent second implementation of the [Logbook](https://github.com/bighydro/logbook) format, in TypeScript.**

The Logbook spec says it should be small enough to implement in an afternoon, and that two independent
implementations must agree before v1.0 is frozen. This is the second one. It was written from
[SPEC.md](https://github.com/bighydro/logbook/blob/v0.5.0/SPEC.md) alone: no Python was read, and every
place the spec left a choice is written down in [SPEC-QUESTIONS.md](./SPEC-QUESTIONS.md). Its `show`
and `day` print a day exactly as the reference implementation (openlogbook, main at 996642f, 2026-10-02)
does, matched against the reference's output on synthetic records and on its own demo record, never
its source, and checked by a cross-implementation test.

Zero runtime dependencies. RFC 8785 canonical JSON, SHA-256 chaining and UUIDv7 are implemented by hand on
Node's built-ins.

## Sixty seconds

```bash
git clone https://github.com/bighydro/logbook-ts && cd logbook-ts
pnpm install && pnpm build

# the conformance sample from the spec repo: one week of a fictional person in Oslo
node dist/bin.js verify tests/fixtures/sample-logbook
#  valid — 31 lines, head 035a74e0027faa6872580c3c7b5f7a0efec92f15bb29cee400a6593814fd345c

# append a note to a copy; the chain still verifies
cp -R tests/fixtures/sample-logbook /tmp/mine
node dist/bin.js add /tmp/mine "read the spec, wrote a second implementation"
node dist/bin.js verify /tmp/mine
#  valid — 32 lines, head <new hex>

# change one byte inside any line and it is no longer a logbook
sed -i.bak 's/"accuracy_m": 12/"accuracy_m": 13/' /tmp/mine/logbook/2026/03.jsonl
node dist/bin.js verify /tmp/mine
#  invalid — 1 error
#    logbook/2026/03.jsonl line 1: seq 1 — hash 129e6cdc… does not recompute (got cd36ca92…)

# the day read back whole: nights, country, stays and moves with what attached to each and who was there
node dist/bin.js day tests/fixtures/demo-sample 2026-06-15
#  2026-06-15  Monday
#    night before  Home · home
#    night after   aboard Nordlys · away
#    country       NO (nearest airport OSL)
#    all day       Nordlys: summer cruise
#
#    00:00–08:35  stay   Home · 8 h 35 min
#    08:35–08:45  move   1.4 km · 10 min · car
#    08:45–24:00  aboard Nordlys (yacht) · 15 h 15 min · 1 note, 1 call
#        08:45–10:05  stay   Marina · 1 h 20 min
#        10:05–13:00  move   9.7 km · 2 h 55 min · boat
#        13:00–24:00  stay   59.8500,10.6000 · 11 h
#        note         Cast off at ten with Ola Nordmann and Anders Vik. Light wind from the s…
#        call         → Ola Nordmann, 15 min
#        with         Ola Nordmann (note), Anders Vik (note)
#
#    health        sleep 6.2 h · 6,671 steps · resting 54 bpm
#    sources       dawarich 286 lines, last 23:55 · ais 161 lines, last 23:50 · apple-health 80 lines, last 22:07 · …

# every line of a day, as the sources wrote it, in the owner's timezone
node dist/bin.js show tests/fixtures/profiles-sample --day 2026-03-02
#  2026-03-02
#    06:10  flight     flighty        XY 561 OSL → ZRH, arrives 07:24, Airbus A320 LN-XYA, tracked, as pilot
#    06:12  flight     manual         superseded by #2
#    09:04  call       ios-calls      ← Ola Nordmann, 7 min, cellular
#    09:30  call       ios-calls      → Kari Moe, no answer, facetime-audio
#    10:00  transcript granola        Catch-up with Ines — Ines Holm, Ola Nordmann
#    11:15  mail       mail           ✉ Re: Mooring for the weekend — Ola Nordmann → Kari Nordmann (1 attachment)
#    21:14  voice-memo voice-memos    Idea for the talk (1:42)
#    22:14  highlight  apple-books    “They sailed west until the coast was a line and then was nothing.” — The Long Ships · the moment the book turns
#    …
```

`pnpm link --global` (or `npm i -g .`) puts the same thing on your path as `logbook-ts`.

## What it does

SPEC §6, the conformance rule, and two readers.

| Command | Does |
|---|---|
| `logbook-ts verify <root>` | Reads every `logbook/<YYYY>/<MM>.jsonl`, orders the lines by `seq` (files partition by the month of `at`, not by chain order), checks that each `seq` is the previous plus one, each `prev` is the previous `hash`, each `hash` recomputes, and `logbook.json` names the last line. Prints `valid — N lines, head <hex>` and exits 0, or the errors on stderr and exits 1. Refuses any `format` other than `logbook/0.2`. |
| `logbook-ts add <root> "<text>"` | Appends one `note/v1` line: UUIDv7 id, `at` and `recorded_at` now in RFC 3339 UTC, `tz` from `logbook.json`, tier 2, source `manual`. Then replaces `logbook.json` atomically (temp file, rename). Refuses to append to a record that does not verify. |
| `logbook-ts show <root> --day YYYY-MM-DD [--tz <zone>] [--raw] [--profile <schema>] [--json]` | Prints one local day of the record as the reference does: the day, its hero photos, then one row per line sorted by `at` — local time, kind, source and a one-line summary — then the day's notes file. Only reads. See below. |
| `logbook-ts show <root> [--since YYYY-MM-DD] [--until YYYY-MM-DD] …` | The same for every day of the range that has a line, oldest first, streamed; a missing bound is the record's first or last day. `--profile` keeps the lines of one payload schema; `--json` prints each day as one JSON object. |
| `logbook-ts day <root> [YYYY-MM-DD] [--json]` | The day read back whole, as the reference's `logbook day` prints it: the nights either side, the country, the timeline of stays, stops, moves, gaps, runs aboard an asset and flights, with what attached to each and who was there, what was placed nowhere, the health line, the sources. Today in the record's zone when no day is given. Only reads. See below. |

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
dependency. The output is, row for row, what `logbook show` of the reference implementation prints
on the same record: a heading with the day, then `  HH:MM  kind  source  summary` with the kind
padded to ten columns and the source to fourteen, then, when `notes/<YYYY>/<day>.md` exists,
`  — note —` and the file two spaces in. A day with no lines prints `<day>: nothing logged`. Rows
are ordered by the instant `at` denotes, then by `seq` (SPEC §3.2). A day with a `keeper/v1` line
standing (RFC 0024) has a `  hero  IMG_0001.jpg` line under its heading, the `memory` lane first and
every other lane as `(art)`, as the reference prints it.

The summary depends on the kind; names come from the record's own `resolution/v1` lines (below):

| Kind | Summary |
|---|---|
| `location` | `n points`, one row per run of consecutive points from one source and of one subject (RFC 0001), its time `08:12–09:40` when the run has more than one point; an asset's run is `solvind: 2 points`. |
| `message` | `Ola Nordmann: text` in a direct chat, `Ola Nordmann in Sailing club: text` in a group; the owner's own are `me → Kari: text` and `me in Sailing club: text`; a message without text is `[image]`, `[media]`. |
| `event` | `title · by organizer · with attendees`; two or more sources carrying one entry (the same start and end, and the same title — case, accents and whitespace aside — or the same flight in the title) print once, as `×2 sources`. |
| `note` | the first non-blank line, then `… (+N lines)`. |
| `flight` | `XY 561 OSL → ZRH, arrives 07:24, Airbus A320 LN-XYA, tracked, as pilot`; a line a later flight line supersedes is `superseded by #N`. |
| `call` | `← Ola Nordmann, 7 min, cellular`, `→ Kari Moe, no answer, facetime-audio`, `→ withheld, 30 s, whatsapp`. |
| `transcript` | `title — participants; 12 turns, 35 min`. |
| `mail` | `✉ subject — from → to, cc (n attachments)`; the owner's own mail is from `me`. |
| `voice-memo` | `title (m:ss)`, then `, not stored` when the record does not hold the audio or `, audio missing` when there is none. |
| `highlight` | `“quote” — title · note`; a bookmark is `bookmark — title @ location`. |
| `trip` | `from → to, mode, provider, 58.00 CHF, cancelled, 1 change, ticket`. |
| `crossing` | `crossed to hermes: 6 lines (tier 1: 2, tier 2: 4)`. |
| `task`, `browse`, `watch`, `listen`, `commitment` and any other kind | `text`, else `title` (a page's `url`), else every payload field but `schema` as `key=value`, spelled as Python's `str()` spells it, which is what the reference prints for `photo`, `health`, `transaction`, `resolution` and `commitment-close` lines. |

A line hidden by a `retraction/v1` line (RFC 0003) stays in its place as `  22:30  retracted #11: typo`;
the retraction itself is not listed on its own day.

People are named from the record's own `resolution/v1` lines (RFC 0006), never from a contact list:
for each ref (`{kind, value}`, such as a phone number or an email address) the last resolution line in
chain order that stands wins; a line retracted, or named in a later resolution's `supersedes`, does not
stand; an `alias_of` line is followed to its target ref, at most four hops, stopping on a cycle or at a
ref nothing resolves. When no resolution names a ref, the name the source itself attached
(`sender.name`, an attendee's `name`, a mail header's display name) is used, then, for a direct chat, the
chat's name, then the raw value. `--raw` prints every ref exactly as the source gave it, the whole
text of a note, and a mail's body under its row.

### A range, a profile, JSON

Neither SPEC §3.2 nor the reference has these; they are this implementation's, and written down in
SPEC-QUESTIONS.md (41).

- `--since YYYY-MM-DD` and `--until YYYY-MM-DD` list a range of local days, inclusive, oldest first,
  each day as `--day` prints it and a blank line between; a day with no line is left out, and an empty
  range prints `<since>–<until>: nothing logged`. A missing bound is the record's first or last listed
  day. `--day` cannot be combined with a bound.
- `--profile <schema>` keeps only the lines whose `payload.schema` is one of the schemas given
  (`note/v1`; `note` means every version; repeat the flag or separate with commas). It applies as lines
  are read, before runs of points are collapsed and calendar entries folded, so four points with nothing
  listed between them are one run; resolutions and retractions still come from the whole record.
- `--json` prints each day as one JSON object on one line: `day`, `timezone`, `hero` (`photo`, `lane`,
  `line`), `rows` and, when the day has a notes file, `note`. A row is `{time, until?, kind, source,
  summary, retraction?, lines}`: `summary` is the text column exactly (names resolved, or raw with
  `--raw`; `retracted #11: typo` for a hidden line, with the retraction line beside it), `until` the end
  of a run of points, `source` the column as printed (`×2 sources` for a folded entry), `lines` the full lines behind the row —
  one, the points of a run, the entries folded. An empty day under `--day` is `{"day": …, "hero": [],
  "rows": []}`; an empty range prints nothing.

```bash
node dist/bin.js show tests/fixtures/show-sample --since 2026-03-15 --profile resolution/v1
node dist/bin.js show tests/fixtures/sample-logbook --day 2026-03-08 --json | jq '.rows[] | [.time, .kind, .summary]'
```

`show` streams: every month file is read once through a fixed buffer for the resolution, retraction
and flight lines and the record's first and last day; then only the month files the day or range can
touch are read, in order, each line going to its local day, and a day is printed as soon as the last
file that can hold one of its lines has been read. What is held at any moment is the lines of the days
still open — at most a month's worth of the range — so memory does not grow with the record. Nothing
is loaded whole and nothing is written; no index is built.

Two synthetic records (the same imaginary person in Oslo) and the conformance sample are the fixtures: `tests/fixtures/show-sample`
has a run of points, an alias hop, a retracted resolution, a retracted note and a line at 22:30 UTC that
is the next day in Oslo; `tests/fixtures/profiles-sample` has one line of every profile the RFCs define
(flight, call, transcript, mail, voice-memo, highlight, task, browse, watch, listen, trip, transaction,
health-sample, location with a subject, event, photo, message, note, commitment, crossing, resolution)
in the RFC examples' shapes; `tests/fixtures/sample-logbook` is `conformance/sample-logbook` of the spec
repo at v0.5.0 (31 lines, one of every profile), vendored unchanged. `make.mjs` beside each synthetic
record regenerates it. Beside each, `expected-show/` holds what `logbook show` of the reference printed
for every day, with and without `--raw` (the conformance sample whole, all eight days, since the
reference at b3cd8c5 reads each as SPEC §3.2 says; SPEC-QUESTIONS 40); the unit tests check our output
against those files, and `tests/cross-impl.test.ts` checks both against the reference itself (see
Developing). `tests/fixtures/capture-expected-show.mjs` re-captures them from the reference; they are
never edited by hand.

```bash
node dist/bin.js show tests/fixtures/show-sample --day 2026-03-14
#  2026-03-14
#    08:12–09:40  location   sim-phone      3 points
#    10:00  event      sim-calendar   Coffee with Ines · with Ines Holm-Berg
#    10:30  photo      sim-camera     file=IMG_0101.jpg
#    12:05  message    whatsapp       Ola Nordmann in Sailing club: Regatta moved to Sunday
#    12:07  message    whatsapp       Kari M: Hei, lunch?
#    12:09  message    whatsapp       me → Kari: On my way
#    21:30  note       manual         Regatta Sunday. … (+1 line)
#    22:00  location   sim-phone      1 point
#    22:30  retracted #11: typo
```

The sender of the 12:05 message is a WhatsApp linked-device id; an alias line pairs it with a phone
number, and a contacts import names that number. The 12:07 sender's resolution was retracted, so the
name WhatsApp itself showed is printed. `--raw` gives `236000000000001@lid` and `+4790000002`.

Where the reference and SPEC §3.2 disagree, this implementation follows the spec and says so in
SPEC-QUESTIONS.md: a run of points ends at the last point's `end` when it has one, and a day is ordered
by instant, not by the text of `at`.

## The Day

`day` is the reader [docs/day.md](https://github.com/bighydro/logbook/blob/main/docs/day.md) of the spec repo
describes, written from that page, SPEC §3.2, the README's prose on `derive stays` and the RFCs, and
matched to the reference by running it (`tests/cross-impl.test.ts`), never by reading it. It derives the
owner's **stays** from the `location/v1` points by the documented rules — a span at one place of twenty
minutes or more, or of any length when something is attached inside it; a point outside the place's
radius (`places.json`, else 150 m) is an excursion the stay survives when the tracker is back inside
within ten minutes; a silence the tracker ends within a short walk of the place is time there; shorter
spans with nothing attached are **stops**; what lies between is a **move**, with its distance along the
points, a mode from the speed (walk, car, train, flight, boat aboard a yacht) or `flight` when it runs
between two airports, or a **gap** when no point fell in it for a silence or more — and marks a stay or
move **aboard** an asset of `assets.json` when the owner's positions match its track; two or more
consecutive segments aboard one asset are one row with the berth, the passage and the anchorage inside.
The thresholds are `policy/stays.json`'s, with the reference's defaults when the file is missing.

Then it reads the day: the **night** before and after (the longest stay between 22:00 and 08:00, `home`
when it lies in a place of kind `home` or within 400 m of one, `in transit` when there is none), the
**country** (a place's own, else the nearest large airport's zone, from the night or from the day's
longest stay), the day's all-day entries; the **timeline** of the rows that touch the day, clipped to it,
each with its **attachments** — events (one entry several calendars carry folded), transcripts, notes,
mail threads, calls and keepers named, messages and photos counted — and **who was there**: confirmed by a
timed calendar entry held at the stay, a transcript's participant the record resolves, a note that says
`with <name>`; proposed by a face the photo library tagged; never the owner (`owner_id` and `owner_emails`
in `logbook.json`, the resolution lines naming those, `policy/owner.json`). The **flights** are the
`flight/v1` lines standing. What fell inside no stay or move is **unplaced**. The **health** line is the
night's sleep (the union of the asleep stages per device, the longest device), the day's steps (the larger
device per quarter hour) and resting heart rate (the day's mean), corrections honoured. The **sources** are
every source with a line standing on the day, how many, and its newest. Airports and zones come from the
reference's own tables (OurAirports and zone.tab, public domain; `src/tables.ts`, generated by
`scripts/make-tables.mjs`), so both implementations name the same airport, city and country.

`--json` prints the Day as the reference does: one object with `day`, `weekday`, `tz`, `nights`, `country`,
`all_day`, `timeline` (every row with `within_day`, `attached`, `with` and the ids of its lines), `flights`,
`unplaced`, `health` and `sources`. The text and the JSON are diffed against the reference on
`tests/fixtures/day-sample` (six days with a case of every rule) and on three days of the reference's own
demo record (`logbook demo --days 30 --seed 7`, vendored as `tests/fixtures/demo-sample`, the lines the three
days read, chained again); `tests/fixtures/*/expected-day/` is the reference's output on each, captured by
`tests/fixtures/capture-expected-day.mjs` and never edited by hand. Every choice the prose left open,
and the two places the reference departs from docs/day.md (an all-day entry proposes nobody; a flight
without a designator prints `None None`), is in SPEC-QUESTIONS.md 42–54.

`day` reads the window the reference reads — the day before, the day, and the night after — in one pass over
every file for the judgements (as `show` does) and one over the month files the window can touch, keeping
the window's lines only; the memory is a few days of lines whatever the record's size. Nothing is written.

```bash
node dist/bin.js day tests/fixtures/day-sample 2026-04-06          # a stop, a gap, unplaced lines, two devices' health
node dist/bin.js day tests/fixtures/day-sample 2026-04-08 --json | jq '.timeline[] | select(.kind == "aboard") | .inside[].where'
```

## As a library

```ts
import { addNote, buildResolver, canonicalize, hashLine, readDay, renderDay, showDay, showDays, verifyLogbook } from "logbook-ts";

const result = verifyLogbook("/path/to/root"); // { valid, lines, head, errors }
const line = addNote("/path/to/root", "a note"); // the Line that was written
const day = showDay("/path/to/root", { day: "2026-03-14", timezone: "Europe/Oslo" }); // { text, timezone, rows, detail }
for (const shown of showDays("/path/to/root", { since: "2026-03-01", profiles: ["note"] })) {
  shown.detail.rows; // what --json prints: [{ time, kind, source, summary, lines }, …], a day at a time
}
const today = readDay("/path/to/root", { day: "2026-06-15" }); // the Day, as `day --json` prints it
today.nights.after.where; // "aboard Nordlys"
renderDay(today); // the text `day` prints
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

To diff `show` and `day` against the reference implementation, clone it and point the test at the clone;
`uv run` installs the clone's own environment (the `day` diff also builds the reference's demo record):

```bash
git clone https://github.com/bighydro/logbook /tmp/logbook-ref
LOGBOOK_REF=/tmp/logbook-ref pnpm vitest run tests/cross-impl.test.ts
```

`tests/fixtures/capture-expected-show.mjs` and `capture-expected-day.mjs` re-capture a fixture's expected
output from the reference; `tests/fixtures/demo-sample/make.mjs` rebuilds the demo excerpt from the
reference's `logbook demo`; `scripts/make-tables.mjs` regenerates `src/tables.ts` from its data tables.
All take `LOGBOOK_REF`.

CI runs the suite on ubuntu, macOS and Windows with Node 20 and 22; a job clones the spec repo at its
tag and runs SPEC §6 against the fixture as published there; another checks that the vendored fixture
is still the one on the spec repo's main and that `verify` prints the head published there; and a
fourth runs the cross-implementation diff against the reference at main.

Rules for anyone (or any agent) changing this repo are in [CLAUDE.md](./CLAUDE.md). Nothing in the
fixtures is real; the sample person lives in Oslo and does not exist.

## License

Apache-2.0. The spec itself is CC0.
