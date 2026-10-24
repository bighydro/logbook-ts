# logbook-ts

**An independent second implementation of the [Logbook](https://github.com/bighydro/logbook) format, in TypeScript.**

The Logbook spec says it should be small enough to implement in an afternoon, and that two independent
implementations must agree before v1.0 is frozen. This is the second one. It was written from
[SPEC.md](https://github.com/bighydro/logbook/blob/v0.5.0/SPEC.md) alone: no Python was read, and every
place the spec left a choice is written down in [SPEC-QUESTIONS.md](./SPEC-QUESTIONS.md). Its `show`
and `day` print a day, and its `trips`, `rollup countries` and `rollup nights` sum a window up, exactly as
the reference implementation (its main at a86787c, 2026-10-21, the commit [`REFERENCE`](./REFERENCE) pins: openlogbook 0.7.0 and nine commits past it, among them draft/v1's forward compatibility and the route text of `trips`) does, matched against the
reference's output on synthetic records, on the conformance sample and on its own demo record, never
its source, and checked by a cross-implementation test. Three exceptions, each made or accepted on the owner's
instruction: for the catch-up of 2026-10-13, the validation sentences of the settings and policy files
and of `signed-day/v1`'s dispositions were matched to the reference's source (openlogbook 0.6.1, and PR
252); for that of 2026-10-15, the validators, tiers and readers of RFC 0037's three profiles and the
read-only half of `logbook status` were ported from the reference's `logbook/contrib/entities.py` and
`entity_status.py` and their tests, so a line one implementation refuses the other refuses in the same
words; and for the same catch-up, the planner of PR #21 read the reference's `logbook/rows.py` (the rows
`show` prints), `logbook/day.py` (the Day) and `logbook/core/speakers.py` (a transcript's voices), for the
transcript's voices of RFC 0038 §2 in `show` and the Day, because the brief that session gave its planner
allowed it to grep the reference's reader source for transcripts; the rule of this repository did not, and the
owner accepted it afterwards (2026-10-16) rather than have the part redone blind. Everything
taken from that reading was checked by running the reference, every expected value in `tests/speakers.test.ts`
is the reference's output, and each point the reading settled is written down for the spec to answer
(SPEC-QUESTIONS 102–107). Nothing else of the reference's source has been read. The [Parity](#parity) table
says what each covers.

Zero runtime dependencies. RFC 8785 canonical JSON, SHA-256 chaining and UUIDv7 are implemented by hand on
Node's built-ins.

## Sixty seconds

```bash
git clone https://github.com/bighydro/logbook-ts && cd logbook-ts
pnpm install && pnpm build

# the conformance sample from the spec repo: one week of a fictional person in Oslo
node dist/bin.js verify tests/fixtures/sample-logbook
#  valid — 32 lines, head 58bfa9e704e3388d44d74e63f1d84765d24df79e92fce3b522fbef53b765d3df

# append a note to a copy; the chain still verifies
cp -R tests/fixtures/sample-logbook /tmp/mine
node dist/bin.js add /tmp/mine "read the spec, wrote a second implementation"
node dist/bin.js verify /tmp/mine
#  valid — 32 lines, head <new hex>

# change one byte inside any line and it is no longer a logbook
sed -i.bak 's/"accuracy_m": 12/"accuracy_m": 13/' /tmp/mine/logbook/2026/03.jsonl
node dist/bin.js verify /tmp/mine
#  invalid — 1 error; 32 lines read, head <new hex>
#    logbook/2026/03.jsonl line 1: seq 1 — hash 129e6cdc… does not recompute (got cd36ca92…)

# a crash can cut a month file inside the line being written: the lines before the cut still verify,
# and the owner learns which prefix of the chain is intact (SPEC §3, truncation)
cp -R tests/fixtures/sample-logbook /tmp/torn
head -c -200 /tmp/torn/logbook/2026/03.jsonl > /tmp/torn/cut && mv /tmp/torn/cut /tmp/torn/logbook/2026/03.jsonl
node dist/bin.js verify /tmp/torn
#  invalid — 3 errors; 30 lines read, head f50a9f8dd3ef872371396ab9326aa7488ee60b3ccf5afa788ac6927d82e6a890
#    logbook/2026/03.jsonl line 31: the file ends inside this line (cut short)
#    logbook.json: seq 31 does not match the last line (30)
#    logbook.json: head 035a74e0… does not match the last line (f50a9f8d…)

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
| `logbook-ts verify <root>` | Reads every `logbook/<YYYY>/<MM>.jsonl`, orders the lines by `seq` (files partition by the month of `at`, not by chain order), checks that each `seq` is the previous plus one, each `prev` is the previous `hash`, each `hash` recomputes, and `logbook.json` names the last line. Prints `valid — N lines, head <hex>` and exits 0, or `invalid — N errors; M lines read, head <hex>` and the errors on stderr and exits 1: the seq and head of the lines read, so a record whose month file a crash cut inside a line (SPEC §3, truncation) reports the last whole line and its hash, never 0 and GENESIS while the first line is whole, and names the cut line `<file> line N: the file ends inside this line (cut short)`. A line that is not one is reported by file and line number and its file is read no further; a last line whole but for its newline is a line. A line whose JSON text gives a member name twice in one object, at any depth, is not one (SPEC §2), however the name is spelled: `<file> line N: duplicate key 'kind'`, as the reference names it. Reads `logbook/0.2` and `logbook/0.3`, which hash by one rule (SPEC §3.1): a sealed line's `payload_enc` is outside the hash and is never opened here. Refuses `logbook/0.1`. The month files are merged in `seq` order as the reference merges them, one line held from each and no file left open between reads, so memory is one line per month file whatever the length of the record, and so is `add`'s, which verifies first; a month file out of `seq` order, which SPEC §3 allows, is read again sorted, keeping only where each line lies. |
| `logbook-ts add <root> "<text>" [--no-wait]` | Appends one `note/v1` line: UUIDv7 id, `at` and `recorded_at` now in RFC 3339 UTC, `tz` from `logbook.json`, tier 2, source `manual`. One writer at a time, as the reference: the whole run holds `state/writer.lock` in the record folder (the holder's `pid`, `command` and `since`, the file the reference's writers hold and honour, written to a temp file and hard-linked into place so that it never exists empty); a second writer prints `another logbook command is writing to this record (<command>, since <time>); waiting` and waits, or with `--no-wait` refuses and exits 2; a lock whose process is gone is taken over with one line saying so. A lock that names no holder (the reference creates the file and then writes it) is a writer between the two while it changes, and is waited for; once the same file has named no holder for half a second it is a leftover of a crash and is removed without a word, whatever its mtime (rule A, the reference's rule; SPEC-QUESTIONS 91). The write order of SPEC §3: the line is appended and fsynced to its month file, then `logbook.json` is written to a temp file, fsynced and renamed into place; `logbook.json` is read again right before the write and the append refused (exit 2, nothing written) when the head moved under the lock. While the files end past `logbook.json` (a crash between the two writes), or a month file ends inside a line, it refuses with the reference's one sentence, exit 2, writing nothing: run `repair tail`. Refuses to append to a record that does not verify otherwise, and to a `logbook/0.3` record that names `recipients`, since it cannot seal. |
| `logbook-ts repair tail <root> [--dry-run] [--no-wait]` | The files end past `logbook.json` after a crash between a line and it (SPEC §3, write order): verifies the whole chain, then sets `logbook.json` to the last line's `seq` and head, under the writer lock, and prints the lines past the head, what it set and `verify`'s verdict, as the reference's `logbook repair tail` prints them; `--dry-run` lists and writes nothing. A record that is not that crash — a fault in the files, the files ending before `logbook.json` or at its `seq` under another head — is refused, `repair tail: …; nothing was changed`, exit 2. No month file is touched. |
| `logbook-ts show <root> --day YYYY-MM-DD [--tz <zone>] [--raw] [--profile <schema>] [--json]` | Prints one local day of the record as the reference does: the day, its hero photos, then one row per line sorted by `at` — local time, kind, source and a one-line summary — then the day's notes file. Only reads. See below. |
| `logbook-ts show <root> [--since YYYY-MM-DD] [--until YYYY-MM-DD] …` | The same for every day of the range that has a line, oldest first, streamed; a missing bound is the record's first or last day. `--profile` keeps the lines of one payload schema; `--json` prints each day as one JSON object. |
| `logbook-ts day <root> [YYYY-MM-DD] [--json]` | The day read back whole, as the reference's `logbook day` prints it: the nights either side, the country, the timeline of stays, stops, moves, gaps, runs aboard an asset and flights, with what attached to each and who was there, what was placed nowhere, the health line, the sources. Today in the record's zone when no day is given. Only reads. See below. |
| `logbook-ts stats <root> [--json]` | One screen of what the record holds, as the reference prints it: format and head; lines, first and last `at`; lines per kind with first and last local day and distinct sources; per source; per local year as a bar; then, this implementation's, per tier and per local month; retractions and the lines they hide; resolution lines and the entities they mint; attachments referenced and present. Numbers, kinds, sources and dates, never what a line says. See below. |
| `logbook-ts sources <root>` | Every source with lines: how many, its first and last line in the record's zone. |
| `logbook-ts sources <root> --gaps [--since YYYY-MM-DD] [--expect <source>…] [--json]` | Where each source went quiet, as the reference prints it: per source with lines, its last line, the longest silence and the days with no line folded into runs, from its first line (or `--since`) to today. `--expect` lists only those sources, marks one silent a day or more, or with no line, with `!`, and exits 1. See below. |
| `logbook-ts trips <root> [--year YYYY \| --since YYYY-MM-DD --until YYYY-MM-DD] [--json]` | The trips of the window, as the reference's `logbook trips` prints them: every run of nights away from home or in transit, with its nights (aboard an asset when they were), its route, the flights in and out, the named places and who was there. The whole record when no window is given, clipped to the days the track covers. Only reads. See below. |
| `logbook-ts rollup countries <root> [--year YYYY \| --since YYYY-MM-DD --until YYYY-MM-DD] [--json]` | Days per country per year from the overnight stay, in transit and unknown apart, with the method. Only reads. See below. |
| `logbook-ts rollup nights <root> [--year YYYY \| --since YYYY-MM-DD --until YYYY-MM-DD] [--json]` | Per year: the nights at home, away and in transit, the nights aboard each asset, and the longest run of nights not at home. Only reads. See below. |
| `logbook-ts status list <root> <kind> [--json]` | Under `LOGBOOK_TS_FLAGS=rfc0037`: every canonical org, idea, place or asset with its current `status/v1` line, as the reference's `logbook status list` prints it: the day it took effect, who proposed it and the reason, `until` for a place let go or an asset sold, `stale`, and the dispositions the dream may not propose yet. A person or a goal is refused in the reference's words. Only reads. See *Draft RFCs behind a flag*. |
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

## Parity

What this implementation reads, verifies and writes, profile by profile, against the reference it
matches: **openlogbook 0.7.0** (bighydro/logbook, tag v0.7.0 at b82a11c, 2026-10-18) as its main stands on
**24 October 2026** (a6ee131, pinned since that day; the catch-up of 21 October pinned a86787c), its RFC 0034
signed-day amendments 1–4, the draft RFCs 0036–0038, 0040, 0041 and 0046 and the Day as they stand there. The
settings and policy files' sentences were matched to openlogbook 0.6.1 and its PR 252 (2026-10-13) and
are not compared again by the cross-implementation tests. *Read* means
the readers (`show`, `day`, `days`, `trips`, the rollups, `people`, `stats`) take the line or the file
as the reference does; *verify* means the chain (SPEC §3, every profile hashes alike) and, where the
reference validates a shape, the same validation in the same words; *write* means a command here
appends it. The nineteen frozen profiles (RFC 0031) are held to the reference's per-profile fixtures
by `tests/profiles.test.ts`; the envelope and the hash rule are SPEC §2–3 and never move here.

### Coverage at the main of 24 October

What changed in the format's documents and the reference's readers between a86787c and a6ee131 (53
commits; the reference's output was read at d053f78, eight commits before), and what this
implementation does with each, in the words of the table below. Every claim is
held by the case files `tests/heard-cases.ts`, `machine-cases.ts`, `reflection-cases.ts`,
`note-text-cases.ts`, `october-cases.ts`, the last case of `speakers-cases.ts`, `tests/drafts.test.ts`,
and their tests in `tests/cross-impl.test.ts`, run against the reference at the commit `REFERENCE` names.

| Document or change at a6ee131 | Here | What |
|---|---|---|
| rfcs/0036-draft-v1.md, amendment 2 (2026-10-21): the `link` proposal, `extra.evening` (#358) | implemented | `readDraft`: `links` (numbered among all the proposals, `supported` and `why`), `evening`, `read_until`, and the malformed sentences in the reference's words; `show`'s row counts the proposals (SPEC-QUESTIONS 117a, 119–122) |
| rfcs/0036-draft-v1.md, amendment 2: what is kept (`kept`, `keep`, `since you signed`); dream-day/4's parts, lenses, `closing`, `marked`, `dropped` | not implemented | the Day's draft block, which is not shown here (below) |
| rfcs/0036-draft-v1.md, the month and the chapter (their writers) | not applicable | the reference's dream writes them; `readDraft` reads a draft of any unit |
| rfcs/0046-what-you-heard.md (draft, new): `heard/v1` (#355) | implemented, under `rfc0046` | `show`'s row; `sync heard`, `show heard`, `search` and a crossing entry's `heard` are not ported |
| docs/adapters/agents.md, your bots through Beeper (#396): the machine mark | implemented | `people` and the Day's company pass an agent over (`extra.machine`, `extra.counterpart` of kind `agent`, a participant's `machine`); the mark predates #396 and was not read here before. `policy/agents.json` is the writer's |
| docs/signed-day.md, keep and sign (#374): the notes labelled `task`, `learned`, `idea`, `decision`, `word`, `intention` | verified only | read and kept as every label; the readers agree on such lines (`tests/october-cases.ts`) |
| docs/signed-day.md: a signature never confirms the dream's draft (#374) | verified only | the writer's; the readers read the signature the reference writes alike, and `signedDayProblems` takes it |
| docs/day.md, the reflection (the reference's since 0.7.0) | implemented | the Day's `reflection` section and key, the latest note labelled `reflection` (SPEC-QUESTIONS 123); held by no fixture before |
| rfcs/0015-mail-v1.md, amendment 2026-10-20: `extra.gmail_category`, `extra.list` (#341) | verified only | the readers agree on such a line |
| rfcs/0038-speakers.md §3, a voice named as `people` names the person; #364, a voice's name keeps its tier | implemented: the name; not implemented: the tier | the name, by the first label given the person (`personName`); no reading below a tier (a site, a vault, a bundle, a gated Day) is made here |
| logbook.json's `demo` (#338) and `phone` (#345); policy/owner.json's `handles` | read and kept | every key a reader does not own is kept; `tests/fixtures/demo-seed1` is the demo as it writes it now |
| docs/adr/0016-tier-crossing-policy.md, amendment 2026-10-21: a new record names no one (#348) | implemented | in the catch-up of 21 October, ahead of `REFERENCE` then |
| #385, a reader never rebuilds the index under a writer | not applicable | nothing here reads or writes an index |
| docs/attachments.md, a transcript's file from the export, `doctor --attachments` (#397); `import pickup` (#398) | not applicable | writers and `doctor`; nothing here imports |
| #361 (the timeline page, place classes), #403 (close the week), #402 (the Notion export), #406 (a payment and its receipt once), #400 and #408 (the watchdog's tests) | not applicable | the Library, the reference's writers and exports; the readers compared here agree at a6ee131 |
| rfcs/0005 (the refs a crossing resolves), 0042 (Hold), 0043 (the Day page), 0044 (local days, draft), 0045 (people's mail), 0047 (the Library's doors); docs/adr/0025 | not implemented | crossings, the Library, Hold and local days are not ported |

### Coverage at v0.7.0

What changed in the format's documents between 7bcf728 and v0.7.0, and what this implementation does
with each: **implemented** (read, and validated where the profile is, held to the reference by tests),
**verified only** (nothing here needs to change; tests hold that the readers already agree), or **not
implemented**. Every claim is held by `tests/superseded.test.ts`, `tests/speakers-bound.test.ts`,
`tests/marks.test.ts`, `tests/entities.test.ts`, `tests/signing.test.ts` and their cases in
`tests/cross-impl.test.ts` and `tests/cross-impl-entities.test.ts`, run against the reference at the commit `REFERENCE` names.

| Document at v0.7.0 | Here | What |
|---|---|---|
| docs/SPEC-QUESTIONS.md, a line superseded twice (the reference's #321) | implemented | a line is superseded while a line of its kind that is not retracted names it; a superseder superseded in turn still supersedes. `show`'s marks, the Day, `people` (transcripts and events, by kind), a flight's mark and the Day's flights, and the resolver's names (SPEC-QUESTIONS 108). One exception follows the reference against the rule: the hero photo (SPEC-QUESTIONS 109) |
| docs/rfcs/0034-the-signed-day.md, amendment 4 (a re-sign keeps the confirmations) | verified only | the writer's; nothing here signs. The readers read the standing signature's own confirmed set, and a re-sign the reference writes is read alike (`tests/cross-impl.test.ts`) |
| rfcs/0006-resolution-v1.md, amendment 2026-10-15 (the `speaker` ref; `basis`, `consent`, `unnamed`, `spans`) | implemented, read | under `rfc0038`: a voice bound to a person (`bindVoices`), its `basis`, `consent` and `unnamed`; `spans` is not read (no reader here reads a transcript's words). No validator of the four fields, as for every frozen profile here |
| schema/resolution-v1-speaker.schema.json (new) | not implemented | no JSON Schema is run here |
| rfcs/0024-keeper-v1.md, amendment 2026-10-14 (`note`; `supersedes` read) | implemented | `show` prints the keeper's note; a superseded keeper is no hero. The Day lists every keeper as the reference's does |
| rfcs/0030-trip-bundle-v1.md, amendment 2026-10-14 (the stars a bundle carries) | not implemented | no bundle is exported or imported here; `received/v1` reads as `[]` |
| rfcs/0037-entities.md, amendments 2026-10-15 (`portfolio`) and 2026-10-16 (a database row is its own root; `idea_rows`) | implemented: `portfolio`; not implemented: `idea_rows` | `statusProblems` refuses a portfolio that is not text and one on any kind but an org's, in the reference's words; `status list` reads an org's portfolio and the note that holds a reason. The idea proposals of §4.3 and their `idea_rows` setting are the reference's dream's, not ported; the setting is passed by |
| rfcs/0038-speakers.md (the diarizer's own extra; open question 13 answered) | not applicable | packaging and an install sentence only. RFC 0038 §3, unchanged in the text but read by the reference since 0.7.0, is implemented (the row of `0006` above, the Day's company, `people`) |
| rfcs/0039-anchor.md (draft, new) | not implemented | `anchor/v1` lines verify as any line and `show` prints them as a kind it does not know |
| rfcs/0040-videos.md (new): `scene-review/v1` | implemented | under `rfc0040`: `sceneReviewProblems` (§5's table and schema, this implementation's sentences), `show`'s row and its `superseded by #N` |
| rfcs/0040-videos.md: `video/v1`, `attribution/v1`, the scene draft | not implemented | verified as any line; `show` prints `video` and `attribution` lines as kinds it does not know, where the reference prints rows of its own |
| rfcs/0041-star-v1.md (draft, new) | implemented | under `rfc0041`: `starProblems`, `starLineProblems`, the standing star of a line, `show`'s row, the Day's ★ and its `stars` |
| rfcs/0042-hold.md (draft, new) | not implemented | proposals no code writes, in the reference either |
| rfcs/README.md | not applicable | the index |

| Profile | Read | Verify | Write | Notes |
|---|---|---|---|---|
| the envelope (SPEC §2–3), `logbook/0.2` and `logbook/0.3` | yes | chain, seq, prev, hash, head; a torn file; a sealed line kept closed | `note/v1` only | Level 1 and keyless Level 2 of SPEC §6 on the 32-line samples |
| `location/v1` (0001) | yes | chain | — | a `subject` is an asset's run |
| `photo/v1` (0002) | yes | chain | — | |
| `retraction/v1` (0003) | yes | chain | — | hides what it names in every reader; a retracted line supersedes nothing (#321, SPEC-QUESTIONS 108) |
| `transcript/v1` (0004, amended 2026-10-14: `speakers`, `diarization`, RFC 0038 §2) | yes; the voices under the `rfc0038` flag: `show` names them as the source gave them (`Samtale · you 3 min · Ola Nordmann 3 min`), the Day as RFC 0038 §3 binds them (`Middag · Kari Nordmann 10 min · you 30 s · 1 unnamed · recorded with consent: unknown`, `speakers` under `day --json` with `person`, `basis` and `consent`), a line a standing transcript supersedes is `superseded by #N` in `show`, and the Day leaves out a transcript another of the same day supersedes; a transcript without the fields reads as before, flag on or off | chain | — | `src/speakers.ts`; the reference has no validator for the two fields (its JSON Schema is checked by its tests only), so none is here (SPEC-QUESTIONS 95); a participant with `machine: true` is an agent, never company and never in `people` |
| `resolution/v1` (0006, amended 2026-10-15: the `speaker` ref) | yes; a `speaker` ref under the `rfc0038` flag: the voice it binds in the Day, its company at a stay and `people` (`spoke_s`, `N voices not yet named · review speakers`, `and N unnamed`) | chain | — | names, aliases, the owner; a retracted resolution supersedes nothing (#321); `spans` is not read |
| `message/v1` (0008) | yes | chain | — | the machine mark: a line with `extra.machine: true` or an `extra.counterpart` of kind `agent` is no one's in `people` (docs/adapters/agents.md) |
| `event/v1` (0009) | yes | chain | — | folded across sources, `all_day` |
| `note/v1` (0010) | yes | chain | `add` writes `{schema, text}` as `logbook add` does | `labels` (RFC 0010, 2026-10-01; what PR 252's `note_day` writes as `[kind]`), `title`, `folder`, `supersedes` are read and preserved; the Day shows the latest note labelled `reflection` in a section of its own, as the reference does; no reader prints another label, keep-and-sign's (`task`, `learned`, `idea`, `decision`, `word`, `intention`) among them, in either |
| `crossing/v1` (0011) | yes | chain | — | `policy.signed_only` read as a field like any other |
| `call/v1` (0012) | yes | chain | — | |
| `flight/v1` (0013) | yes | chain | — | a tracked line supersedes a declared one, and a retracted one nothing (#321); the reference's Day keeps one flight per carrier, number and date, which this does not yet (SPEC-QUESTIONS 110) |
| `health-sample/v1` (0014) | yes | chain | — | |
| `mail/v1` (0015, amended 2026-10-20: `extra.gmail_category`, `extra.list`) | yes | chain | — | the two keys are read as any `extra` |
| `task/v1` (0016) | yes | chain | — | |
| `browse/v1`, `watch/v1`, `listen/v1` (0017–0019) | yes | chain | — | the generic row |
| `trip/v1` (0020) | yes | chain | — | |
| `transaction/v1` (0021) | yes | chain | — | the Day's `spend` |
| `highlight/v1` (0022), `voice-memo/v1` (0023) | yes | chain | — | |
| `keeper/v1` (0024, amended 2026-10-14: `note`, `supersedes` read) | yes | chain | — | the hero line; `show` prints the note after the photo, and a keeper another keeper names in `supersedes` is no hero (SPEC-QUESTIONS 109) |
| `weather/v1` (0026) | `null` only | chain | — | SPEC-QUESTIONS 69d |
| `story/v1` (0028), `received/v1` (0030) | `[]` only | chain | — | SPEC-QUESTIONS 69e, 77 |
| `signed-day/v1` (0034, amendments 1–4) | yes: the standing signature, `signed` in `show` and `day`, `dispositions` kept and marked | chain, and `signedDayProblems` in the reference's words: the payload's shape, `confirmed` once each, `page.lines` not below the confirmed count, `dispositions` an object of confirmed ids to one of four words | — | nothing here signs; amendments 2, 3 and 4 are the writer's (`--confirm none`, `--at`, the MCP door; a re-sign keeping the standing signature's confirmations, `--confirm all`) and leave the line as it is; a re-sign the reference writes is read alike |
| `goal/v1`, `review/v1` (0036) | draft (RFC 0036): `standingGoals`, `standingGoal`, `standingReviews` (a review counts for the goals that reword the one it names), `openGoals`; under the flag `show` prints a goal as `<text>  (year, from 2026-01-01)` and a review as `let go · month · <the goal's current text>` as the reference does since its #275, ` · superseded by #N` on a goal a later goal rewords; with the flag off, the text and the `key=value` row as before | draft (RFC 0036): `goalProblems`, `reviewProblems` (the field tables; tier 2 and `source` `manual`, MUST), `reviewRecordProblems` (the goal is a goal line not retracted, `at` not before its `from` nor five minutes after `recorded_at`), `reviewKey` `(goal, period, at)`; a goal has no key. The reference checks neither profile yet, so the sentences are this implementation's (SPEC-QUESTIONS 88) | — | the Day's `reviews` row is not read yet; the writers (`goal add`, `goal review`, amendment 1) are the reference's |
| `draft/v1` (0036, and amendment 1's `person`, `window`, `read_policy` as PR 269 proposes them, the event proposals of 2026-10-13, their forward compatibility of 2026-10-19, and amendment 2 of 2026-10-21's `link` and `extra.evening`) | draft (RFC 0036): `readDraft`, a draft as the reference's Day reads it (each segment supported or not and why, `malformed`; the event and link proposals of their shape, numbered by their place, each supported or not, and `proposals_unknown`, the count of a kind it does not know, which never makes the line malformed; `evening` and `read_until`), `standingDrafts`; `show`'s row (`draft of day 2026-06-13 · 5 lines read at bb97e90d · 4 segments, 1 unsupported · 1 proposed event · 1 proposed link`) under the flag | draft (RFC 0036): `draftProblems`, the fields the reference's reader checks in its words (`read_head`, `read_count`, `language`, `segments` with the segment rule, `supersedes`, `proposals`, `extra`'s `evening` and `read_until`), and `unit`, `subject`, `source` `model:<name>`, `window`, `read_policy` (and, as a writer, a kind outside `event` and `link`) in this implementation's (SPEC-QUESTIONS 89, 117, 119–122); `draftTierProblems`, never below a line it cites; `draftKey` | — | the Day's draft block (the keep numbers, `kept`, lenses, `since you signed`) is not shown yet; nothing here writes a draft |
| `chapter/v1` (0036) | draft (RFC 0036): `standingChapters`, `chapterOf` (the standing chapter open on a day, and the clash of rule 4); `show`'s row, `<name>  <from> – <to>`, and the day's chapter in its heading (`unsigned · chapter Ashore, fixing things`, `, clashes with …`), under the flag | draft (RFC 0036): `chapterProblems`, `chapterKey` `(name, from)` (a closing line that supersedes the open one is not a duplicate), `chapterClashes`; sentences this implementation's | — | the Day's header does not name the chapter yet, nor its `chapter`, `reviews`, `goals` and `chapters` keys (SPEC-QUESTIONS 94) |
| `entity/v1` (0037) | draft (RFC 0037): `standing`, `canonical` (every entity the lines name; a `resolution/v1` of type `company` read as an org, by RFC 0006's walk as the reference runs it), `bindings`, `registry` and `known` (the entries of `places.json` and `assets.json`, `until` as each holds it), `lookup`, the dedupe keys (`keyOf`, `registeredDomain`); `show` prints the line as the reference does, the generic `key=value` row, flag or not, and the Day counts it among the sources only, as the reference does | draft (RFC 0037), in the reference's words, ported from its source on the owner's instruction: `entityProblems`, and `tierProblems` (tier 2 for every kind, never citing a tier-3 line); `entityLineProblems` holds a whole line to what the reference's writers check | — | the reference's code differs from the RFC's text in places (SPEC-QUESTIONS 98); nothing here writes an entity |
| `entity-review/v1` (0037), and `people-review/v1` (0035), read as one of type person | draft (RFC 0037): `reviews`, the standing noes, `reviewHolds`; `show`'s generic row | draft (RFC 0037): `entityReviewProblems`, a `speaker` ref among the observed kinds (RFC 0038 §12); its tier the highest it cites, never under 2 (`reviewTier`) | — | `review KIND` is the reference's |
| `status/v1` (0037) | draft (RFC 0037): `statuses` (the last standing line is the current status), `muted`, `stale`, `policy/entities.json` (`readEntitySettings`); `status list <root> <kind> [--json]` under the `rfc0037` flag, as the reference prints it, an org's `portfolio` (§10.2, amended 2026-10-15) and the `note` that holds a reason with it; `show`'s generic row | draft (RFC 0037): `statusProblems` (the kind's dispositions, a reason where one MUST be given, no money on the line, `proposed_by`, `proposal`, `since`, a `portfolio` text and on an org's line only); the tier rules, an org's status tier 3 and every other kind's tier 2, never citing a tier-3 line; and, this implementation's own sentences, `orgReasonProblems`: an org's reason stays on its tier-3 line and is never a tier-2 `note/v1` (RFC 0037 §10.5), and no status note is above tier 2 | — | the writer, `logbook status` (and the registry entry it closes with `until`), is the reference's; `status <kind> <entity> <disposition>` is refused here |
| `star/v1` (0041) | draft (RFC 0041), under the `rfc0041` flag: `standingStars`, one star per line; `show`'s row, `★ event 019cadd3… · <note>`; the Day's ★ after a disposition on every row it lists, and `stars` under `day --json` | draft (RFC 0041): `starProblems`, `starLineProblems` (`at`, `tier` and `kind` the starred line's; never on a star, a keeper, a retraction or a draft); sentences this implementation's | — | `logbook star` and `unstar` are the reference's |
| `scene-review/v1` (0040 §5) | draft (RFC 0040), under the `rfc0040` flag: `show`'s row, `scene 2:10–2:50 ≠ Hjem` or `…: nothing to name`, and `superseded by #N` on a no a later standing no replaces | draft (RFC 0040): `sceneReviewProblems`, §5's table and schema, `scene` the ref's and `end_s` after `start_s`, the tier never under 2; sentences this implementation's | — | `review video` is the reference's |
| `video/v1`, `attribution/v1` (0040 §2, §4) | the generic row | chain | — | not implemented; the reference prints rows of its own |
| `heard/v1` (0046, draft) | draft (RFC 0046), under the `rfc0046` flag: `show`'s row, `Anchors that hold — The Harbour Hour · feed · en · 700 words`; the Day reads the line as any line | chain | — | nothing here fetches, reads or writes a text; `show heard` and `search` are the reference's |
| `anchor/v1`, `anchor-export/v1` (0039, draft); the profiles of 0042 (draft) | the generic row | chain | — | not implemented; nothing writes 0042's |

| Settings and policy file | Read | Validated as the reference validates it | Written |
|---|---|---|---|
| `logbook.json` | yes | format, and the fields a reader needs | `add` rewrites `seq` and `head` atomically |
| `logbook.json`, `day_start` (RFC 0036) | draft (RFC 0036), under the flag: `readDayStart`, `localDayOf`; midnight, written, absent or null, groups as before | yes: a value that is not a clock `HH:MM` is refused by every reader that groups by day in the reference's words; a clock other than midnight is refused too, since no reader here puts a line on a day by it yet | — |
| `policy/stays.json` | yes, `aboard_min_s` included | yes (`SettingsError`) | — |
| `places.json` | yes, the settings' `radius_m` as the default reach | yes | — |
| `assets.json` | yes, `mmsi`, `icao24`, `registration` included | yes | — |
| `policy/owner.json` | yes | yes | — (the reference writes the empty file; this reads it as empty) |
| `policy/crossing.json` | yes: `max_tier`, `until`, `recipient`; the `mcp` entry's `write` and `write_window_days` (`mcpDoor`) | yes (`PolicyError`) | — (the reference writes the default; this reads it in memory, `{mcp: {max_tier: 1}}` as the reference's #348 has it, ahead of `REFERENCE`: SPEC-QUESTIONS 83) |
| `policy/crossing.json`, `signed_within_days` (RFC 0036) | draft (RFC 0036), under the flag: `crossingEntry`, and its composition with `max_tier` and `until`, `dayGate` and `lineCrosses` | yes, a positive whole number of days, in this implementation's words: the reference documents the key and does not read it yet (SPEC-QUESTIONS 90) | — |
| `policy/import.json` | yes (`readDisabledSources`) | yes | — (as above); the Day's `readiness` that consumes it is not read yet, SPEC-QUESTIONS 79 |
| `policy/circle.json` | — | — | — (`receive` is not ported) |

## Draft RFCs behind a flag

An RFC is final only once two implementations agree on it, so a draft is read here to be held to the
reference, never by default. `LOGBOOK_TS_FLAGS` names the flags that are on, separated by commas or
spaces; a name this implementation does not know is refused by every command that reads the flags, so
a typo never reads as a flag left off.
With no flag on, every reader and the CLI behave as they did before the draft.

```bash
LOGBOOK_TS_FLAGS=rfc0036 node dist/bin.js show tests/fixtures/rfc0036-sample --day 2026-06-14
#  2026-06-14  unsigned
#    08:10  draft      model:qwen2.5-7b-instruct draft of day 2026-06-13 · 5 lines read at bb97e90d · 4 segments, 1 unsupported
```

**`rfc0036`** (RFC 0036, *Goals, reviews, drafts and chapters; the day's boundary; the freshness of a
signature*, draft of 2026-10-13, with its amendment 1, PR 269, open, as proposed). Off until the RFC is
Final. With it on:

- every reader that groups lines by day (`show`, `day`, `days`, `trips`, the rollups, `people`, `stats`,
  `sources --gaps`) reads `day_start` from `logbook.json` first. A value that is not a clock `HH:MM` from
  `00:00` to `23:59` is refused as the reference refuses it, `show: logbook.json has day_start '6am',
  which is not a clock from 00:00 to 23:59 written HH:MM; a reader that groups lines by day refuses
  rather than guess (RFC 0036): write it as "06:00", or remove the key for midnight`, exit 2. A clock
  other than midnight is refused too (`… does not yet put a line on a day by it …`): no reader here
  moves a line to the day before yet, and the RFC forbids grouping as if the key were absent. `verify`,
  `add` and the list of sources never group by day and never look;
- `show` prints a `draft/v1`, a `goal/v1`, a `review/v1` and a `chapter/v1` line as the reference does
  (`draft of day 2026-06-13 · 5 lines read at bb97e90d · 4 segments, 1 unsupported`; `Sail to Lofoten …
  (year, from 2026-01-01, until 2026-12-31)`; `let go · month · Sail to Lofoten …`; `Ashore, fixing
  things  2026-08-10 – 2026-11-29`), a goal or a chapter a later line of its kind replaces with
  ` · superseded by #N`, and names the day's chapter in its heading (`2026-08-31  unsigned · chapter
  Ashore, fixing things`);
- `signed_within_days` on an entry of `policy/crossing.json` is read and checked, so a bad value is
  refused naming the file and the entry.

The profiles' functions (`goalProblems`, `reviewProblems`, `draftProblems`, `readDraft`,
`chapterProblems`, the standing lines, the dedupe keys, `dayGate`) read a line wherever a caller holds
one, flag or not, as `signedDayProblems` does for RFC 0034; their names and shapes may change while the
RFC is a draft. `tests/rfc0036-examples.ts` holds the RFC's example lines; `tests/fixtures/rfc0036-sample`
is a record of them with the reference's `show` output beside it, and `tests/cross-impl.test.ts` holds
the two implementations to the same rows, the same `day_start` sentences and the same reading of a
day's draft, malformed ones included. What the reference does not decide yet is in SPEC-QUESTIONS 86–90.

**`rfc0037`** (RFC 0037, *Entities: orgs, ideas, places and assets reviewed like people*, draft of
2026-10-13, its questions decided 2026-10-14; the reference's #291). Off until the RFC is Final. With it
on, `status list <root> <kind> [--json]` lists every canonical entity of the kind with its current
status as the reference does (`  Fjordkiosk AS      passed since 2026-10-02 (dream proposed passed)`,
then `reason: …` under it), reading `policy/entities.json` for `mute_days` and `stale_days`, and a line's
day under `day_start` (RFC 0036) as the reference's listing always reads it, whether `rfc0036` is on or not
(a value that is not a clock is refused in its words). Nothing else changes: the reference's `show` prints the
three profiles' lines as the generic `key=value` row and its Day counts them among the day's sources
and nothing more, and so do these. The
profiles' functions (`src/entities.ts`) read a line wherever a caller holds one, flag or not: the
validators and the tier rules give the reference's sentences, ported from its source on the owner's
instruction, and `tests/cross-impl-entities.test.ts` holds the two to the same answers on 128 payload
variants, 30 tier variants, 89 word variants, `status list` on synthetic records, and every line of
`tests/fixtures/rfc0037-0038-sample`, which the reference's own writers wrote: an org's status at tier 3
with its reason on the line and no note, an idea's, a place's and an asset's at tier 2 with the reason
also a note labelled `status`. Where the reference's code and the RFC's text differ, this follows the
code and says so (SPEC-QUESTIONS 98–99).

**`rfc0038`** (RFC 0038, *Speakers*, draft, §2 as the reference builds it since 562a741, #301, and RFC
0004's dated amendment of 2026-10-14). Off until the RFC is Final. With it on:

- `show` and the Day name a transcript's voices, its optional `speakers` and `diarization`, as the
  reference prints them: `Samtale · you 3 min · Ola Nordmann 3 min` after the title, the people and the
  length, the writer's turns left out beside them; the same after a transcript attached to a row of the
  Day or unplaced, and under `day --json` a `speakers` list, `{label, person, name, seconds, basis,
  consent, owner}` each, only on a transcript with voices. A voice is `you` when the source says it is
  the owner's microphone (`from_me: true`), else the name the source displayed, else its label. A voice the reader cannot read
  (a label that is not 1 to 64 characters without `#` or a line break, an entry that is not an object)
  is passed by; a line with none it can read reads as a line without `speakers`;
- a recording heard again (RFC 0038 §2.8): a line a standing transcript supersedes is `superseded by
  #N` in `show`, whatever its kind, and the Day leaves out a transcript another transcript of the same
  day supersedes, its line still counted among the day's sources;
- who spoke (RFC 0038 §3, read by the reference since 0.7.0): a voice is bound by the standing
  `resolution/v1` line of its `speaker` ref, `<transcript line id>#<label>`, through RFC 0006's walk.
  The Day names it (`Middag · Kari Nordmann 10 min · you 30 s · 1 unnamed · recorded with consent:
  unknown`; `person`, `basis` and `consent` under `speakers`; the owner's own voice is the owner's
  `owner_id`), counts a voice bound to a person as company at a stay ahead of the participants (never
  the far end of a call; `with  … · 2 unnamed`), and `people` counts the transcript for that person
  with `spoke_s` and says `N voices not yet named · review speakers` and `and N unnamed` in its head.

A transcript without the two fields reads exactly as before, flag on or off: every vendored `show` and
`day` fixture prints byte for byte as captured with the flag on (`tests/speakers.test.ts`).
`tests/fixtures/rfc0037-0038-sample` is a record the reference wrote with its own writers, its `show`
and `day` output beside it on every day, and `tests/cross-impl.test.ts` holds both implementations to it.

**`rfc0040`** (RFC 0040, *Videos*, draft of 2026-10-14). Off until the RFC is Final. With it on, `show`
prints the owner's no on a scene, `scene-review/v1`, as the reference does: `scene 2:10–2:50 ≠ Hjem`
(the offsets `m:ss`, `h:mm:ss` from an hour; what the proposal named, the place's label or the days),
`scene 0:40–1:30: nothing to name`, and `superseded by #N` on a no a later no of the scene replaces.
`sceneReviewProblems` holds a line to §5, flag or not. `video/v1` and `attribution/v1` are not read.

**`rfc0041`** (RFC 0041, `star/v1`, draft of 2026-10-14). Off until the RFC is Final. With it on, `show`
prints a star as the reference does (`★ event 019cadd3… · the table by the river`), and the Day marks
each line it lists that has a standing star with ★, after its disposition (`event        ✓ ★ Middag
18:00–20:00`), and gives the day's standing stars under `stars` in `--json`, `{line, star, kind, note}`
each, only on a day that has one. A photo's star is its keeper (RFC 0024), read flag or not.
`tests/marks-cases.ts` holds the records and the reference's output; `tests/cross-impl.test.ts` both.

**`rfc0046`** (RFC 0046, *What you heard*, `heard/v1`, draft of 2026-10-21; the reference's #355). Off until
the RFC is Final. With it on, `show` prints the words of an episode or a video the owner played as the
reference does: `Anchors that hold — The Harbour Hour · feed · en · 700 words`, the title, ` — ` and who made
it when `by` is a text, the text source or `?`, the language or `und`, and the words, a whole number or 0,
the thousands grouped. Another schema of the kind is the generic row. `tests/heard-cases.ts` holds 36
payloads and the reference's row for each; `tests/cross-impl.test.ts` both.

## Reading a day

`show` prints the lines whose `at` falls on the given calendar day in a timezone: `--tz` if given, else
the owner's `timezone` from `logbook.json`. The zone comes from Node's built-in ICU (`Intl`), not from a
dependency. The output is, row for row, what `logbook show` of the reference implementation prints
on the same record: a heading with the day and whether the owner signed it (`2026-03-01  signed 2026-03-08 20:30`
or `2026-03-01  unsigned`; see *The signed day* below), then `  HH:MM  kind  source  summary` with the kind
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
| `flight` | `XY 561 OSL → ZRH, arrives 07:24, Airbus A320 LN-XYA, tracked, as pilot`; a line a later flight line supersedes, whatever its kind, is `superseded by #N`. |
| `call` | `← Ola Nordmann, 7 min, cellular`, `→ Kari Moe, no answer, facetime-audio`, `→ withheld, 30 s, whatsapp`. |
| `transcript` | `title — participants; 12 turns, 35 min` (`transcript` for no title; the Day says `a recording`), a length under a minute in seconds (`2 s`), half to even; under the `rfc0038` flag its voices after it (`Samtale · you 3 min · Ola Nordmann 3 min`, the turns left out beside them), and a line a standing transcript supersedes is `superseded by #N`. |
| `mail` | `✉ subject — from → to, cc (n attachments)`; the owner's own mail is from `me`. |
| `voice-memo` | `title (m:ss)`, then `, not stored` when the record does not hold the audio or `, audio missing` when there is none. |
| `highlight` | `“quote” — title · note`; a bookmark is `bookmark — title @ location`. |
| `trip` | `from → to, mode, provider, 58.00 CHF, cancelled, 1 change, ticket`. |
| `crossing` | `crossed to hermes: 6 lines (tier 1: 2, tier 2: 4)`. |
| `signed-day` | `signed 2026-03-01: 7 lines confirmed of 7 · kept 2, missed 1 · A quiet Sunday.`, listed on the day the owner signed, not the day signed; the counts only when the signature gives dispositions (RFC 0034 amendment 1). |
| `task`, `browse`, `watch`, `listen`, `commitment` and any other kind | `text`, else `title` (a page's `url`), else every payload field but `schema` as `key=value`, spelled as Python's `str()` spells it, which is what the reference prints for `photo`, `health`, `transaction`, `resolution` and `commitment-close` lines. |

A line hidden by a `retraction/v1` line (RFC 0003) stays in its place as `  22:30  retracted #11: typo`;
the retraction itself is not listed on its own day.

### The signed day

`signed-day/v1` (RFC 0034, *The signed day*) is the line the owner appends when they have read a day's page
and confirm it as the day's facts: tier 1, source `manual`, with the local day signed, the owner as `subject`,
the ids of the lines `confirmed`, the digest of the `page` as shown and how many lines were on it, an
optional one-line `note`, and `supersedes` when it replaces an earlier signature of the same day. The page
is every line of the local day but the retractions and the signatures, a retracted line included, by
instant then `seq`; its digest is `sha256(canonical_json({"day", "tz", "lines": [the lines' hashes]}))`,
so any implementation recomputes it from the record alone and the 32nd line of the conformance sample
reproduces byte for byte (`tests/signing.test.ts`). The **standing signature** of a day is the latest
`signed-day` line by `seq` naming it whose subject is the owner and that is not retracted; `show` and
`day` print `signed <local day and minute>` in the day's header, with `, the page has changed since` when
the page no longer digests to what was signed (a line appended with an `at` on that day), else `unsigned`.
`day --json` carries the same under `signed`. Nothing here signs: the reference's `logbook day sign` is the
one producer, and no agent can sign (RFC 0034 rule 1). `signedDayProblems` in the library says why a line
is not a signature; this implementation has no profile validator in `verify`, so the profile's rules live
in `src/signing.ts` with its readers.

`signed-day/v1` is **new, not frozen**: it is not one of the nineteen profiles RFC 0031 freezes, its schema
may change while RFC 0034 is a draft, and it becomes frozen only by RFC 0031's process (a reader, a fixture
in both implementations under `conformance/profiles/signed-day/`, a schema pass and one dated amendment
to that RFC). This implementation follows the fixture when it lands.

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
repo at 3092b60 (32 lines, one of every profile, the first day signed on the last evening, RFC 0034), vendored
unchanged, and `tests/fixtures/sample-logbook-sealed` its Level 2 twin (the same week, tiers 2–3 sealed to
two recipients; `verify` reads it keyless to the head in `expected-sealed.json`, and cannot open it, having
nothing to decrypt with). `make.mjs` beside each synthetic
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
`flight/v1` lines standing. What fell inside no stay or move is **unplaced**. Under the night before, the
**Night line**, as the reference reads it since its #288: `night  slept 23:10–06:40 · 7 h 20 min ·
training 45 min`, the asleep stages (`asleep`, `core`, `deep`, `rem`) that start from the day before to
the day's end, per device chained while no gap is over two hours, each chain a night of the day its last
stage ends on; the longest asleep, a tie to the device first by name; minutes half to even, `< 1 min` for
none; the training, the union of the day's workouts, only beside a night; `night` under `--json`, a key
only on a day a night ends on. The **health** line is the day's steps (the larger device per quarter
hour) and resting heart rate (the day's mean), corrections honoured, and no row when the day has
neither; its JSON keeps the night's sleep (`sleep_h`, the union of the asleep stages ending on the day
per device, the longest device) and the heart rate variability, in ms. The **sources** are
every source with a line standing on the day, how many, and its newest. The header says after the weekday
whether the owner **signed** the day (`2026-03-01  Sunday · signed 2026-03-08 20:30`, else `· unsigned`;
RFC 0034, *The signed day* above). Below the header, the day's **reflection**, when it has one: the latest
`note/v1` line labelled `reflection` (the reference's `day reflect`), its `HH:MM · source` and its words
wrapped at 76 columns as Python's `textwrap` wraps them, words kept whole; `reflection` under `--json`
(`line`, `seq`, `at`, `at_local`, `source`, `text`), a key only on a day that has one. An agent among a
call's participants (`machine: true`) is never company. Airports and zones come from the
reference's own tables (OurAirports and zone.tab, public domain; `src/tables.ts`, generated by
`scripts/make-tables.mjs`), so both implementations name the same airport, city and country.

`--json` prints the Day as the reference does, laid out as it lays it out (two spaces, its keys in its order):
one object with `day`, `weekday`, `tz`, `nights`, `country`,
`all_day`, `timeline` (every row with `within_day`, `attached`, `with` and the ids of its lines), `flights`,
`unplaced`, `health`, `sources` and `signed` (null, or the signature: `at`, `at_local`, `line`, `seq`,
`confirmed`, `lines`, `page_sha256`, `page_matches`, `note`, `supersedes`), and `reflection` on a day with
one. The reference's `readiness`
block (RFC 0034: per class of source, whether the day's lines are in) is not read here yet, and the
comparison leaves it out (SPEC-QUESTIONS 79). The text and the JSON are diffed against the reference on
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
nearest large airport within 30 km in parentheses, else the coordinates alone; that is the label the JSON
gives, and the text drops an unnamed stay's coordinates (`near <place>, x km`, `Zurich`) except where nothing
names it or where a neighbour on the route would read the same (SPEC-QUESTIONS 118). Its **nights** say
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
choice the prose left open is in SPEC-QUESTIONS.md 58–69, and the route's text in 118.

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
labels exactly one person by; `faces` the library tagged; never an agent's line, nor one of a conversation
with an agent, nor a participant that is one (the machine mark, docs/adapters/agents.md) — then the **days together**, the confirmed set
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
#  logbook/0.2  head 58bfa9e704e3388d44d74e63f1d84765d24df79e92fce3b522fbef53b765d3df
#  32 lines  first 2026-03-01T07:30:00Z  last 2026-03-08T19:30:00Z
#
#    kind         lines   first       last
#    event            3   2026-03-01  2026-03-07   1 source
#    location         3   2026-03-01  2026-03-08   2 sources
#    …
#    source            lines
#    manual                5
#    …
#    year  lines
#    2026     32  ████████████████████████████████████████████████████████████████████████████████████████████████████
#
#    tier  lines
#    1        15
#    2        12
#    3         5
#
#    month    lines
#    2026-03     32  ████████████████████████████████████████████████████████████████████████████████████████████████████
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
const line = addNote("/path/to/root", "a note"); // the Line that was written, under state/writer.lock
// { wait: false } refuses with WriterBusy while another writer holds the lock; { say } takes the notices;
// TailAhead while the files end past logbook.json, and then repairTail("/path/to/root") brings it forward
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
ceilings("/path/to/root"); // policy/crossing.json: [{ destination, max_tier, until, expired, write, window_days, writes }, …]
mcpDoor("/path/to/root")?.writes; // the write tools the mcp entry allows today, e.g. ["sign_day", "note_day"]
signedDayProblems(line, meta.owner_id); // [] for a signed-day/v1 line as RFC 0034 and its amendments shape it
const held = { peakHeld: 0 };
verifyLogbook("/path/to/root", held); // held.peakHeld: lines held at once, one per month file at most; held.unsorted when one was out of order
// RFC 0036, draft: the profiles, and the policy key under LOGBOOK_TS_FLAGS=rfc0036
draftProblems(line); // ["segment 2 is malformed: a segment is {text, evidence} or {text, unsupported: true}, nothing else"]
readDraft(line, new Set(dayLineIds)).segments; // [{ text, evidence, supported, why }, …]
openGoals(lines, reviews, retracted, "2026-10-13"); // the standing goals no review has closed
chapterOf(lines, retracted, "2026-07-04").chapter; // { name: "The Lofoten summer", line, from, to }
dayGate(crossingEntry(root, "cloud-model"), { signedOn, today, signedOnly: true }); // { header, lines, held }
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
git init /tmp/logbook-ref
git -C /tmp/logbook-ref fetch --depth 1 https://github.com/bighydro/logbook "$(cat REFERENCE)"
git -C /tmp/logbook-ref checkout -q FETCH_HEAD
LOGBOOK_REF=/tmp/logbook-ref pnpm vitest run tests/cross-impl.test.ts
```

The reference is pinned: [`REFERENCE`](./REFERENCE) holds the one commit of bighydro/logbook that this
implementation agrees with, and CI's cross-implementation job fetches exactly that commit, not the
reference's moving main, so a PR is red only for what it changes. A catch-up PR, one that follows the
reference forward, moves `REFERENCE` to the new commit and re-captures the expected files with the
capture scripts below, never by hand. `.github/workflows/drift.yml` runs the same cross-implementation
tests against the reference's main, daily and by hand, never on a PR or a push: its run shows how far
main has moved past `REFERENCE`, and what the next catch-up has to do.

`tests/cross-impl-writer.test.ts` holds the writer to the reference the same way: the lock's sentences, an
empty lock a crash left, the refusal of an append past `logbook.json` and `repair tail`, on copies of one
record (`LOGBOOK_REF=/tmp/logbook-ref pnpm vitest run tests/cross-impl-writer.test.ts`).

`tests/writer-lock.test.ts` drives real processes on one record: it bundles `src/` once with tsup into a
temp folder and spawns `node` on it, each child injecting its fault (a held append, a pause after the record
is read, a lock taken in the reference's two steps and stopped or killed between them, a stop before a
reclaim, Windows' refusal of a file another process holds open, a crash at the rename of `logbook.json`)
by patching `node:fs` before the bundle loads, so the lock, the wait, `--no-wait`, rule A, the write order,
the refusal after a crash and `repair tail` are checked from outside the library. A child stops at a gate,
a file it waits for in a folder the test owns, and goes on when the test makes it; where rule A's half
second is the subject the empty lock is touched by the test every 50 ms (a lock still being made) or left as it is (a leftover): no test waits a fixed
time, so the steps come in the same order on a slow runner as on a fast one.

`tests/fixtures/capture-expected-show.mjs`, `capture-expected-day.mjs`, `capture-expected-trips.mjs` and
`capture-expected-readers.mjs` re-capture a fixture's expected output from the reference;
`tests/fixtures/demo-sample/make.mjs` rebuilds the demo excerpt from the reference's `logbook demo`;
`tests/fixtures/demo-seed1` is `logbook demo --seed 1 --out` as the reference wrote it, without its
`index.sqlite`, and its `make.mjs` rebuilds it; `scripts/make-tables.mjs` regenerates `src/tables.ts`
from its data tables. All take `LOGBOOK_REF`.

`tests/verify-memory.test.ts` is the memory control: it bundles `src/` with tsup into a temp folder, writes
25,000 synthetic notes of about 2 KiB there (some 57 MiB), and has a `node` child of its own verify the record
and append to it with V8's old space capped at half the record's size, then prints what the child measured.

CI runs the suite on ubuntu, macOS and Windows with Node 20 and 22; a job clones the spec repo at its
tag and runs SPEC §6 against the fixture as published there; another checks that the vendored fixture
is still the one on the spec repo's main and that `verify` prints the head published there; and a
fourth runs the cross-implementation diff against the reference at the commit `REFERENCE` names, on the fixtures, on the
conformance sample and on the reference's demo record, so a divergence in `trips`, `rollup countries` or
`rollup nights` fails the build.

Rules for anyone (or any agent) changing this repo are in [CLAUDE.md](./CLAUDE.md). Nothing in the
fixtures is real; the sample person lives in Oslo and does not exist.

## License

Apache-2.0. The spec itself is CC0.
