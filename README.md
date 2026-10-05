# logbook-ts

**An independent second implementation of the [Logbook](https://github.com/bighydro/logbook) format, in TypeScript.**

The Logbook spec says it should be small enough to implement in an afternoon, and that two independent
implementations must agree before v1.0 is frozen. This is the second one. It was written from
[SPEC.md](https://github.com/bighydro/logbook/blob/v0.5.0/SPEC.md) alone: no Python was read, and every
place the spec left a choice is written down in [SPEC-QUESTIONS.md](./SPEC-QUESTIONS.md). Its `show`
and `day` print a day, and its `trips`, `rollup countries` and `rollup nights` sum a window up, exactly as
the reference implementation (openlogbook, main at 176e6a7, 2026-10-04) does, matched against the
reference's output on synthetic records, on the conformance sample and on its own demo record, never
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
#    night after   aboard Nordlys · 59.8500,10.6000 · away
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

SPEC §6, the conformance rule, and the readers.

| Command | Does |
|---|---|
| `logbook-ts verify <root>` | Reads every `logbook/<YYYY>/<MM>.jsonl`, orders the lines by `seq` (files partition by the month of `at`, not by chain order), checks that each `seq` is the previous plus one, each `prev` is the previous `hash`, each `hash` recomputes, and `logbook.json` names the last line. Prints `valid — N lines, head <hex>` and exits 0, or the errors on stderr and exits 1. Reads `logbook/0.2` and `logbook/0.3`, which hash by one rule (SPEC §3.1): a sealed line's `payload_enc` is outside the hash and is never opened here. Refuses `logbook/0.1`. |
| `logbook-ts add <root> "<text>"` | Appends one `note/v1` line: UUIDv7 id, `at` and `recorded_at` now in RFC 3339 UTC, `tz` from `logbook.json`, tier 2, source `manual`. Then replaces `logbook.json` atomically (temp file, rename). Refuses to append to a record that does not verify, and to a `logbook/0.3` record that names `recipients`, since it cannot seal. |
| `logbook-ts show <root> --day YYYY-MM-DD [--tz <zone>] [--raw] [--profile <schema>] [--json]` | Prints one local day of the record as the reference does: the day, its hero photos, then one row per line sorted by `at` — local time, kind, source and a one-line summary — then the day's notes file. Only reads. See below. |
| `logbook-ts show <root> [--since YYYY-MM-DD] [--until YYYY-MM-DD] …` | The same for every day of the range that has a line, oldest first, streamed; a missing bound is the record's first or last day. `--profile` keeps the lines of one payload schema; `--json` prints each day as one JSON object. |
| `logbook-ts day <root> [YYYY-MM-DD] [--json]` | The day read back whole, as the reference's `logbook day` prints it: the nights either side, the country, the timeline of stays, stops, moves, gaps, runs aboard an asset and flights, with what attached to each and who was there, what was placed nowhere, the health line, the sources. Today in the record's zone when no day is given. Only reads. See below. |
| `logbook-ts stats <root> [--json]` | One screen of what the record holds, as the reference prints it: format and head; lines, first and last `at`; lines per kind with first and last local day and distinct sources; per source; per local year as a bar; then, this implementation's, per tier and per local month; retractions and the lines they hide; resolution lines and the entities they mint; attachments referenced and present. Numbers, kinds, sources and dates, never what a line says. See below. |
| `logbook-ts sources <root>` | Every source with lines: how many, its first and last line in the record's zone. |
| `logbook-ts sources <root> --gaps [--since YYYY-MM-DD] [--expect <source>…] [--json]` | Where each source went quiet, as the reference prints it: per source with lines, its last line, the longest silence and the days with no line folded into runs, from its first line (or `--since`) to today. `--expect` lists only those sources, marks one silent a day or more, or with no line, with `!`, and exits 1. See below. |
| `logbook-ts trips <root> [--year YYYY \| --since YYYY-MM-DD --until YYYY-MM-DD] [--json]` | The trips of the window, as the reference's `logbook trips` prints them: every run of nights away from home or in transit, with its nights (aboard an asset when they were), its route, the flights in and out, the named places and who was there. The whole record when no window is given, clipped to the days the track covers. Only reads. See below. |
| `logbook-ts rollup countries <root> [--year YYYY \| --since YYYY-MM-DD --until YYYY-MM-DD] [--json]` | Days per country per year from the overnight stay, in transit and unknown apart, with the method. Only reads. See below. |
| `logbook-ts rollup nights <root> [--year YYYY \| --since YYYY-MM-DD --until YYYY-MM-DD] [--json]` | Per year: the nights at home, away and in transit, the nights aboard each asset, and the longest run of nights not at home. Only reads. See below. |
| `logbook-ts people <root> [--year YYYY] [--json]` | Everyone the record names, never the owner, as the reference's `logbook people` prints it: the channels they are heard on, the days and nights together, the last real contact, the places shared. The whole record, or one year. Only reads. See below. |
| `logbook-ts days <root> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json]` | A window of days one line each, as the reference's `logbook days` prints it: the night after and the country, the kilometres moved, the flights, the stays and what attached, the people confirmed present, the health line, and the usual sources silent that day. Both bounds default to the days the track covers. Only reads. See below. |

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
move **aboard** an asset of `assets.json` when the owner's positions match its track; a stay aboard is a
container: the run of consecutive segments aboard one asset, with a stay in it, is one row from the first's
start to the last's end, with the berth, the passage and the anchorage inside, and its centre is the
inner stay spent longest at (a move aboard with no stay either side stays a move).
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

## Trips, countries and nights

`trips` is the reader ADR 0019 and the README of the spec repo describe ("Trips are derived, never
written"), written from that prose, [docs/rollups.md](https://github.com/bighydro/logbook/blob/main/docs/rollups.md)
and docs/day.md, and matched to the reference by running it. A **trip** is a run of consecutive days whose
**night** — the stay with the longest part between 22:00 and 08:00 (`policy/stays.json`), a run aboard an
asset counted whole — is away from home, that is not in a place of kind `home` and not within 400 m of
one whatever that place's radius, or **in transit**, when no stay reaches the night at all; a night the
tracker slept through joins the trip on either side of it, and a run of such nights alone is no trip.
Without a place of kind `home` nothing is away, and the command says so. A trip's id is
`trip:<first day>:<last day>`, derived and reproducible, never a line's. Its **route** is the night places in
order, consecutive nights at one place (or within 200 m of each other) as one: the named place, `aboard
<asset>`, the airport's code and city when the stay is at one (`CPH, Copenhagen`), else the coordinates
`near <place>, x km` for the nearest named place within 5 km, else the coordinates with the city of the
nearest large airport within 30 km in parentheses, else the coordinates alone. Its **nights** say
`aboard <asset>` when every night with a stay was aboard one asset, else count the nights aboard each and in
transit. Its **places** are the named places stayed at, home aside and stops aside, from its first day to
the day after; its **people** are those confirmed present at those days' stays — by a timed calendar entry
held there, a transcript's participant, a note's `with <name>` — on any day the stay touches, at most
twelve, most evidence first and then by name; its **flights** are the `flight/v1` lines standing from its
first day to the day after, the first day's as `in`, the day after's as `out`. Under `--json` every trip
carries `nights`, `in_transit`, `asset`, `nights_aboard`, `route`, `places`, `people` (each with `id`,
`name`, `confidence` and `lines`), `flights_in`, `flights_out`, `flights`, and `lines`: the night stays'
first and last points, the flights, the people's evidence.

`rollup countries` counts the days of each year of the window by the country of the overnight stay: a
place's own `country` in `places.json` when the stay lies in one, else the country the nearest large
airport within 300 km is filed under in zone.tab, coarse near borders and far from airports, as the
method line says. Nights in transit and nights no airport is near are counted apart. Under `--json` each
country has its `days`, `dates`, `lines` and `by` (`place` or `airport`).

`rollup nights` counts the nights of each year of the window: **home** when the night's stay lies in a
place of kind `home` or within 400 m of one (docs/day.md's home-region rule, whatever that place's
radius), **in transit** when no stay reaches the night window, else **away**; the nights **aboard** each
asset, by id; and the **longest trip**, the longest run of consecutive nights not at home — nights in
transit counted in, so a run the tracker slept through is one, unlike for `trips` — clipped to the year,
the earlier of two as long, left out when every night was at home. Without a place of kind `home` every
night with a stay is away, and the rollup says so under the heading. Under `--json` each year carries
`home`, `away`, `in_transit`, `aboard`, `lines` (the first and last point of each night's stay, in day
order, a stay repeated for every night spent there) and `longest_trip` (`start`, `end`, `nights`, `lines`,
or `null`).

The **window** of the three is the whole record, `--year YYYY`, or `--since` and `--until` (not both),
clipped to the first and last local day with a location line — an asset's AIS fix counts, a note does not —
in the record's zone; a window with no days says so. All three read the window in one pass over the month files it can touch: a file's lines in the window are taken
in time order and fed to the stays engine, which derives segment by segment as the points arrive, so what is
held is one month's lines, the open stay, and the rows and evidence of the days still open — the memory
does not grow with the record (`tests/reading.test.ts` checks the high-water mark of an eight-month record
against a two-month one). Nothing is written.

The text and the JSON are diffed against the reference on `tests/fixtures/trips-sample` (seventeen days over
the turn of the year with a case of every rule: a trip across the year boundary with a flight in, in the
middle and out, two nights in one hotel as two stays and two more as one, a night at an airport hotel, a
calendar entry of thirteen guests, a confirmed person's photos and a face tagged the day after, a trip aboard a yacht with a night at each of two anchorages and a last
night at a flat 600 m from home, a night the tracker slept through, a night 300 m from home, two nights
at a camp no airport is near), on `tests/fixtures/nights-sample` (eleven days with the cases the nights
rollup adds: a year with every night at home, nights aboard two yachts, two runs away of three nights
each), on the two day fixtures, on the conformance sample (no home place, every night in transit), on
`tests/fixtures/demo-seed1` — the reference's own `logbook demo --seed 1 --out`, a month of a person
who does not exist, 12,772 lines, committed whole so the diff covers a record of the reference's own
making — and on the seed-7 demo record the test writes into a temp folder; `tests/fixtures/*/expected-trips/`,
`expected-countries/` and `expected-nights/` are the reference's output for the whole record, a year
and a range, captured by `tests/fixtures/capture-expected-trips.mjs` and never edited by hand. Every
choice the prose left open is in SPEC-QUESTIONS.md 58–69.

```bash
node dist/bin.js trips tests/fixtures/trips-sample                       # three trips, one across the year boundary
node dist/bin.js trips tests/fixtures/trips-sample --year 2026 --json | jq '.trips[].route'
node dist/bin.js rollup countries tests/fixtures/trips-sample            # DE and NO in 2025; NO, DK, in transit and unknown in 2026
node dist/bin.js rollup nights tests/fixtures/nights-sample              # a year at home; two yachts and a tie in the next
node dist/bin.js rollup nights tests/fixtures/demo-seed1 --json | jq '.years[0].longest_trip'
```

## A window of days

`days` reads a window back one line per day, composed from the Day of each as the reference's
`logbook days` prints it ([docs/day.md](https://github.com/bighydro/logbook/blob/main/docs/day.md), *A
window of days*; SPEC §3.2.7): the date and weekday; where the **night** after was spent — the named
place, `aboard <asset>`, the home place a night within 400 m of it lies by, or the coordinates with `near
<place>, x km` or the nearest large airport's city — with the country when the night is away, `in transit`
when no stay reaches the night, `no location` when the day has no location line at all; the **kilometres**
moved, every move that started on the day, the passages aboard an asset included; the **flights**
(`XY 561 OSL→ZRH`); the **stays** — a stay or a run aboard, never a stop — with how many lines attached
across the day's rows, or `nothing logged` on a day without a line; the people confirmed present
(`with 2`); the health line; and a **gap** marker naming every usual source with no line on the day, a
source being usual when it has a line on at least four in five of the window's days that have any line.
Under `--json` the output is JSON Lines, one object per day: `day`, `weekday`, `night` (`where`, `home`,
`aboard`, `in_transit`, `stay`, `located`), `country`, `moved_m`, `flights`, `stays` (`count`, `attached`,
`with_attachments`), `people` (`confirmed`, `names`), `health`, `sources` and `gaps`.

Both bounds default to the days the track covers — the first to the last local day with a location line,
whatever its subject, else the days with any line — and a bound given beyond them is taken as it is. The
window is read a calendar month at a time, each with the day before it, and the stays are derived over
that reading, as the reference does, so a run aboard that spans days is one row on each of them and
keeps its start, and a move that ends past a day is still that day's; a year is a dozen readings, never
one per day. Nothing is written.

The text and the JSON are diffed against the reference on every fixture that has `expected-days/` beside
it — the conformance sample, the whole demo record of seed 1 (`tests/fixtures/demo-seed1`, the record
SPEC §6.1 compares implementations on, vendored whole by `make.mjs`), the day and trips fixtures and the
show fixtures — captured by `tests/fixtures/capture-expected-readers.mjs` and never edited by hand. Every
choice the prose left open is in SPEC-QUESTIONS.md 70–73.

```bash
node dist/bin.js days tests/fixtures/demo-seed1                                   # the persona's June, one line a day
node dist/bin.js days tests/fixtures/demo-seed1 --from 2026-06-14 --to 2026-06-21 --json | jq -c '.night.where'
```

## People

`people` is everyone the record's resolution lines (RFC 0006) name as a person — never the owner: `owner_id`
and `owner_emails` of `logbook.json`, `policy/owner.json`, and every label those resolve to — and what the
record knows of each in the window, as the reference's `logbook people` prints it
([docs/people.md](https://github.com/bighydro/logbook/blob/main/docs/people.md)): one row per person,
most days together first, then the latest contact, then the name, under a head that names the window and
the **tier** of the report, the highest of any line it rests on. A row lists the **channels** with how
many lines — `messages` they sent, and the owner's in a direct chat with them (to the one person who wrote
in that chat, else the person the chat's id names, a WhatsApp JID being the phone number); `calls` they are
the counterparty of; `mail` from or to them by address; `calendar` entries they attend and did not decline,
timed or all-day; `transcripts` they took part in, by email, phone or provider id, else by a name the record
labels exactly one person by; `faces` the library tagged — then the **days together**, the confirmed set
of the with module only (a timed entry held at the stay, a transcript, a note's `with <name>`; a tagged
face and an all-day entry propose and count for nothing), the **nights** whose overnight stay they were
confirmed at on that day, the **last real contact** (the latest of a message either way, an answered call,
or a day together; a meeting first on its day; a mail is never one) and the **places** the days together
were, by days there: the named place, `aboard <asset>` by the asset's id, else the coordinates with `near
<place>, x km` or the nearest large airport's city. Under `--json` each person carries `id`, `name`,
`refs`, `tier`, `birthday`, `first_contact`, `last_contact`, `last_real_contact`, `channels` (each with
`lines`, `first`, `last`, `tier`, `last_line`), `days`, `nights`, `places` and `lines`, the shared days'
evidence. The window is the whole record — the first to the last local day with a line of any kind, so a
message before the tracker's first point is in — or `--year`, clipped to it; a year with no days says so.

The channels stream one file at a time; the days together come from the window reader `trips` and the
rollups use, which now keeps, per stay and per run aboard, the evidence it read the company from. Matched
by running the reference on every fixture: `expected-people/` beside each, the conformance sample and the
seed-1 demo record among them, is its output, captured by `capture-expected-readers.mjs` and never edited.
Every choice the prose left open is in SPEC-QUESTIONS.md 74–76.

```bash
node dist/bin.js people tests/fixtures/demo-seed1                 # twelve people who do not exist, Per Hansen first
node dist/bin.js people tests/fixtures/demo-seed1 --json | jq '.people[] | {name, days, nights}'
```

## As a library

```ts
import { addNote, buildResolver, canonicalize, hashLine, readDay, readDayRows, readPeople, readTrips, renderDay, renderDayRows, renderNights, renderPeople, renderTrips, rollupCountries, rollupNights, showDay, showDays, verifyLogbook } from "logbook-ts";
## What the record holds

`stats` and `sources --gaps` are the reference's two counting readers, printed here as it prints them:
matched by running the reference on the fixtures and on its own demo record (`logbook demo`, a month of
a person who does not exist, 12,772 lines), never by reading it, and kept matched by
`tests/cross-impl.test.ts`. Both read every month file once through a fixed buffer; what is held is
one counter per distinct kind, source, month, entity and digest (`stats`), or one file's timestamps per
source and the days each source has a line on (`sources`), never the lines, so memory does not grow
with the record. Nothing is written; no index is built.

```bash
node dist/bin.js stats tests/fixtures/sample-logbook
#  logbook/0.2  head 035a74e0027faa6872580c3c7b5f7a0efec92f15bb29cee400a6593814fd345c
#  31 lines  first 2026-03-01T07:30:00Z  last 2026-03-08T19:00:00Z
#
#    kind         lines   first       last
#    event            3   2026-03-01  2026-03-07   1 source
#    location         3   2026-03-01  2026-03-08   2 sources
#    …
#    source            lines
#    manual                4
#    …
#    year  lines
#    2026     31  ████████████████████████████████████████████████████████████████████████████████████████████████████
#
#    tier  lines
#    1        14
#    2        12
#    3         5
#
#    month    lines
#    2026-03     31  ████████████████████████████████████████████████████████████████████████████████████████████████████
#
#  0 retractions hiding 0 lines
#  0 resolution lines minting 0 entities
#  1 attachment referenced by 1 line, 0 present under attachments/
#
#  took 0.004s
```

Kinds and sources are listed by lines, then by name; a kind's `first` and `last` are local days in the
record's zone, as the years and months are; the bar is one character per percent of the busiest year
(or month). The tier and month tables are this implementation's (the reference counts kind, source and
year; SPEC-QUESTIONS 55); everything else, down to the column widths, is the reference's screen. The
lines a retraction hides are the distinct `supersedes` it names, whether or not such a line exists; the
entities are the distinct `entity.id` of every resolution line, retracted or not; an attachment is a
distinct `sha256` under `payload.media`, `payload.extra.media` or `payload.content` (SPEC §1.1; a mail's
`attachments` list is not one), present when `attachments/<sha256>` is a file. `--json` gives the same
numbers as one object, with `tiers` and `months` beside the reference's keys.

```bash
node dist/bin.js sources tests/fixtures/sample-logbook --gaps --since 2026-03-05 --expect manual,sim-phone
#    source      lines  last              longest silence                  missing days
#  ! manual          2  2026-03-07 22:30  208d 13h since 2026-03-07 22:30  210  2026-03-06, 2026-03-08..2026-10-02
#  ! sim-phone       0  -                 no lines
#
#  2 of 2 expected sources flagged: manual, sim-phone
#  since 2026-03-05, today 2026-10-02 (Europe/Oslo); counted from the month files, every line
```

Per source with lines in the range: the lines, the last line's local time, the longest silence
(`2d 0h`, `20h 0m`, `5m`: between two lines as `from → to`, from the range's start to the first line
under `--since`, or `since <last>` and still running) and the local days with no line, counted and
folded into runs, three at most, then `+N runs`. The range is each source's first line, or `--since`, to
today in the record's zone; a line dated after today is outside it, and today is a missing day only once
the source has been silent a full day. A source is flagged when its longest silence is a day or more,
or it has no line at all; `--expect` lists the sources named, in that order, marks the flagged with `!`
and exits 1 when any is. Every line counts, retracted or not. `--json` gives the report as data:
`since`, `today`, `timezone`, `expect`, one object per source (`lines`, `first`, `last`, `silence`
with `from`, `to` and `seconds`, `missing_days`, `flagged`) and `flagged`. The footer says where the
lines were counted: the reference's index, the month files here (SPEC-QUESTIONS 56). Without `--gaps`,
`sources` lists the record's sources with their lines and first and last line; the reference lists its
adapters there, which this implementation has none of (SPEC-QUESTIONS 57).

## As a library

```ts
import {
  addNote, buildResolver, canonicalize, collectStats, gapsText, hashLine, showDay, showDays, sourceGaps, statsText, verifyLogbook,
} from "logbook-ts";

const result = verifyLogbook("/path/to/root"); // { valid, lines, head, errors }
const line = addNote("/path/to/root", "a note"); // the Line that was written
const day = showDay("/path/to/root", { day: "2026-03-14", timezone: "Europe/Oslo" }); // { text, timezone, rows, detail }
for (const shown of showDays("/path/to/root", { since: "2026-03-01", profiles: ["note"] })) {
  shown.detail.rows; // what --json prints: [{ time, kind, source, summary, lines }, …], a day at a time
}
const today = readDay("/path/to/root", { day: "2026-06-15" }); // the Day, as `day --json` prints it
today.nights.after.where; // "aboard Nordlys"
renderDay(today); // the text `day` prints
const stats = collectStats("/path/to/root"); // what --json prints: { lines, kinds, sources, years, tiers, months, … }
const gaps = sourceGaps("/path/to/root", { since: "2026-09-01", expect: ["dawarich"] }); // { today, sources, flagged }
statsText(stats); gapsText(gaps); // the screens
const trips = readTrips("/path/to/root", { year: "2026" }); // { window, trips, warning? }, as `trips --json` prints it
trips.trips[0]?.route; // ["aboard Nordlys", "59.9193,10.7522 near Home, 0.6 km"]
rollupCountries("/path/to/root", {}).years[0]?.countries; // [{ country: "NO", days: 25, dates, lines, by }, …]
rollupNights("/path/to/root", { year: "2026" }).years[0]; // { year, home, away, in_transit, aboard, lines, longest_trip }
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

To diff `show`, `day`, `stats`, `sources --gaps`, `trips`, `rollup countries`, `rollup nights`, `days` and `people` against the reference
implementation, clone it and point the test at the clone; `uv run` installs the clone's own environment,
and the test writes the reference's demo record into a temp folder to read and count it with both:

```bash
git clone https://github.com/bighydro/logbook /tmp/logbook-ref
LOGBOOK_REF=/tmp/logbook-ref pnpm vitest run tests/cross-impl.test.ts
```

`tests/fixtures/capture-expected-show.mjs`, `capture-expected-day.mjs`, `capture-expected-trips.mjs` and
`capture-expected-readers.mjs` re-capture a fixture's expected output from the reference;
`tests/fixtures/demo-sample/make.mjs` rebuilds the demo excerpt from the reference's `logbook demo`;
`tests/fixtures/demo-seed1` is `logbook demo --seed 1 --out` as the reference wrote it, without its
`index.sqlite`, and its `make.mjs` rebuilds it; `scripts/make-tables.mjs` regenerates `src/tables.ts`
from its data tables. All take `LOGBOOK_REF`.

CI runs the suite on ubuntu, macOS and Windows with Node 20 and 22; a job clones the spec repo at its
tag and runs SPEC §6 against the fixture as published there; another checks that the vendored fixture
is still the one on the spec repo's main and that `verify` prints the head published there; and a
fourth runs the cross-implementation diff against the reference at main, on the fixtures, on the
conformance sample and on the reference's demo record, so a divergence in `trips`, `rollup countries` or
`rollup nights` fails the build.

Rules for anyone (or any agent) changing this repo are in [CLAUDE.md](./CLAUDE.md). Nothing in the
fixtures is real; the sample person lives in Oslo and does not exist.

## License

Apache-2.0. The spec itself is CC0.
