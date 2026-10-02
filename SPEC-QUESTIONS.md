# Questions for SPEC.md, found while implementing logbook-ts from the spec alone

Written against `bighydro/logbook` tag v0.3.0 (SPEC.md format v0.2; ADRs 0002, 0006, 0007, 0014; `conformance/`),
then against main at b60ae11 and e8ba94a (2026-10-01; RFCs 0001–0024, `conformance/` at v0.5.0) for the sections on `show`,
at b3cd8c5 (2026-10-02, PR #138) for the answers to 24, 25, 27 and 40, at 996642f (2026-10-02) for `stats` and `sources`, and at 36a7d62 (2026-10-02) for the sections on `trips` and `rollup countries`.
The Python source was not read; an *Answered* paragraph quotes what the reference's commit message, changelog and tests say and what running it shows. Each entry says what is unclear, what this implementation does, and why.

1. **Head of an empty record.** §1 shows `logbook.json` with `seq` and `head` but never says what a record with no lines carries. This implementation expects `seq: 0` and `head` of sixty-four zeros (the same value §2 gives for the first line's `prev`), and `verify` reports `valid — 0 lines, head 000…0` for it. Suggest a sentence in §1 or §3.

2. **A line in the wrong month file.** §2 says lines live in `logbook/<YYYY>/<MM>.jsonl` with YYYY and MM taken from `at` in UTC, but §3's definition of *valid* lists only the chain conditions (seq, prev, hash, `logbook.json`). `verify` here does not fail a line that sits in a file other than its `at` month, because §3 does not say to; `add` always writes to the `at` month. Is misplacement an error, a warning, or nothing?

3. **`end` absent versus `end: null`.** §2 types `end` as "RFC3339 UTC or null", which reads as always present, and the sample always writes `"end": null`. If a writer omits the key, does `content` hash with `"end":null` or without an `end` member? These give different hashes. This implementation hashes an absent `end` as `null` (§2's type suggests the key is required) and always writes it. Suggest: "every content field MUST be present; `end` MUST be `null` when there is no duration".

4. **Timestamp precision and form.** "RFC3339 UTC" admits fractional seconds and the `+00:00` offset spelling. Since `at` and `recorded_at` enter the hash as strings, two writers that stamp the same instant differently produce different hashes, and readers cannot normalise without breaking hashes. The sample uses `YYYY-MM-DDTHH:MM:SSZ`; this implementation writes exactly that (seconds, `Z`) and accepts any string on read. Suggest pinning the form, or stating that the string is opaque to the chain.

5. **`seq` in the hash pre-image.** §3 concatenates `prev + "|" + seq + "|" + …`. The decimal rendering of `seq` (no leading zeros, no sign) is the only sensible reading and it reproduces the sample head, but it is not stated. One clause would remove the doubt.

6. **Case of hex digests.** `prev`, `hash` and the inner `sha256(content)` are "hex sha256". Lowercase is the only reading that reproduces the sample head, since the inner digest is concatenated into the outer pre-image as text. This implementation writes and requires lowercase. Suggest stating it.

7. **Validation beyond the chain.** §2 says `payload` MUST contain `schema`, `tier` is 1, 2 or 3, `seq` is an integer ≥ 1. §3's *valid* does not mention these. This implementation reports a missing `payload.schema`, a bad `tier`, a non-integer `seq` and non-hex `prev`/`hash` as errors from `verify` (they are MUSTs in §2), while still chaining the line so one fault yields one error. Should a conformant `verify` be stricter (validate `id` as a UUID, `at` as RFC 3339, `tz` as an IANA name) or looser (chain only)?

8. **Duplicate keys inside a line.** RFC 8785 inherits RFC 8259's "SHOULD be unique". If a `.jsonl` line carries the same key twice in `payload`, `JSON.parse` keeps the last one and the hash is computed over that; another parser might keep the first. Should `verify` reject duplicate keys?

9. **What `add` does when `logbook.json` is missing.** §1 defines the file; nothing defines how it comes to exist (`init` is not in the spec). `add` here refuses with an error. If the spec means `add` on an empty folder to create the record, it needs to say where `owner_id` and `timezone` come from.

10. **Encoding of the written line.** §2 says the line is JSON, UTF-8, newline-terminated; nothing says whether writers may escape non-ASCII (`ø`) or must write it raw, nor whether key order or spacing matters. Since the whole line is outside the hash, either is valid; this implementation writes each line as RFC 8785 canonical JSON (sorted keys, no spaces, raw UTF-8), which differs from the sample's `", "` spacing but verifies identically. Worth a sentence so diffs between implementations stay quiet.

11. **Ordering ties and `seq` gaps.** §3 says "every line's `seq` is the previous plus one". If two lines share a `seq`, the sort order between them is unspecified and so is which error to report. This implementation reports both the duplicate and the broken chain after it.

12. **Crash between the two writes of `add`.** `add` appends a line and then rewrites `logbook.json`. A crash in between leaves a record whose last line is fine but whose `logbook.json` is one behind, which §3 calls invalid. Does the spec want writers to append the line first (so the record is never missing data) or update the head first? This implementation appends first and rewrites `logbook.json` through a temp file and rename; the recovery (`logbook.json` catches up) is trivial but not specified.

13. **Conformance README item 3 versus SPEC §6.** `conformance/README.md` adds a third condition (editing any byte, or deleting any line, must fail) that SPEC §6 does not list. Both are tested here; suggest folding item 3 into §6.

14. **`lineage` for a record that has never been migrated.** §1 says `lineage` is present only after a migration. Does a writer that rewrites `logbook.json` (as `add` does) have to preserve every unknown top-level key? §2 says readers preserve unknown *line* fields; nothing says so for `logbook.json`. This implementation preserves everything it does not own.

## Found while implementing `show` (RFC 0003, RFC 0006, RFC 0008, RFC 0009)

15. **The label of an alias line that ends a walk.** RFC 0006 rule 6 says the line the walk stops on decides "its `entity` and `label`, or none when it has none", and the payload table lets `label` accompany `alias_of`. When the walk stops *on* an alias line (fourth hop, cycle) or at a ref with no line standing, is the alias line's own `label` a name for the ref, or does a ref name nothing until an entity line is reached? This implementation names nothing: an alias line "names no entity", and its label is treated as a hint written at resolution time, not a resolution. Suggest one sentence either way.

16. **Where a retraction line appears in a day listing.** RFC 0003 rule 3 says a retraction "is not an event of its own day: it appears where the line it hides was". `show` here therefore omits `retraction` lines from the day of their `at` and prints `[retracted: <reason>]` in place of the hidden line's summary. A reader who lists the day a retraction was written sees nothing of it, which is what the rule says but may surprise. Is that intended, or should the retraction also be listed (marked) on its own day?

17. **Which files hold a local day.** SPEC §2 makes placement "a writer's obligation, not a validity condition": a line may sit in a month file other than its `at` month and still verify. A reader that streams only the month files a day can touch (the UTC days around it, so three months at most at a boundary) misses such a line; a reader that scans every file for every day does not scale. `show` here reads the month files around the day and every file once for resolutions and retractions. Should the spec say that readers MAY rely on placement, so that a misplaced line is a writer's bug rather than a reader's?

18. **Sorting by `at` with mixed precision.** §2 permits fractional seconds. Sorting the strings puts `07:30:00.5Z` before `07:30:00Z` (`.` sorts before `Z`), so `show` sorts by the parsed instant and breaks ties by `seq`. A line whose `at` does not parse is not on any day and is skipped silently; `verify` is where it should be reported (see 7).

19. **Older payload shapes in the conformance sample.** `conformance/sample-logbook` predates RFC 0008 and RFC 0009: its `message` line has `chat: "Ines"` (a string, not `{id, type, name}`) and `direction: "in"` (not `from_me`), and its `event` lines have `attendees: ["ines@example.org"]` (strings, not `{ref, name, response}`). `show` here accepts both shapes, reading a string chat as its name and a string attendee as an `email` ref. Should the sample be regenerated to the RFC shapes, or the RFCs say what a reader does with a string?

20. **The end of a collapsed run of points.** The reference CLI collapses consecutive location points to `n points HH:MM–HH:MM`. This implementation ends the range at the last point's `end` when it has one (RFC 0001 says `end` is null, but the sample's second point carries one), otherwise at its `at`. Worth stating in the CLI's documentation so the two implementations print the same text.

21. **`show` on a `logbook/0.1` record.** §3.1 says an implementation MUST refuse to *verify or write* a 0.1 record. Reading does not touch a hash, so a 0.1 record could be shown as it is. This implementation refuses anyway, so that every command has the same answer to a record it does not carry. Should reading be allowed?

22. **The timezone database.** `show` needs one to turn `at` into a local clock time. This implementation uses the ICU that ships inside Node (`Intl.DateTimeFormat`), which is a built-in and not a dependency, and refuses a zone name ICU does not know. The spec says `tz` is "an IANA name" but names no edition; a zone renamed between editions (`Europe/Kiev` / `Europe/Kyiv`) will be known to some readers and not others.


## Found while matching `show` to the reference (openlogbook main at b60ae11, 2026-10-01; RFCs 0001–0023)

The reference was run, never read: a synthetic record carrying every profile (`tests/fixtures/profiles-sample`) and two probe records were shown with the reference's `logbook show`, and this implementation was written to print the same text. `tests/cross-impl.test.ts` keeps the two in step. What the output revealed:

23. **The `show` format is not specified anywhere.** SPEC §3.2 fixes the order of a day and what a reader does with retractions and runs, but not the text. The reference prints the day on a line of its own, then `  HH:MM  <kind padded to 10> <source padded to 14> <summary>`, a run of points as `HH:MM–HH:MM  location   src  n points`, a hidden line as `  HH:MM  retracted #<seq>: <reason>`, the day's `notes/<YYYY>/<day>.md` under `  — note —` two spaces in, and `<day>: nothing logged` for an empty day (even when a notes file exists). Only `at` is shown; a line's `end` never is, except as the end of a run. A third implementation can only learn this by running the reference; suggest a `docs/show.md` in the spec repo, or a §3.2 appendix, with the per-profile summaries below.

24. **The generic row is Python's `str()`.** A profile the reference has no renderer for — `photo/v1`, `health-sample/v1`, `transaction/v1`, `resolution/v1`, `commitment-close/v1`, and any unknown kind — prints `text`, else `title`, else every payload field but `schema` as `key=str(value)` in key order: a nested object as `{'kind': 'email', 'value': 'ola@example.org'}`, a boolean as `True`, null as `None`, a float as Python spells it (`1e-06`, `1e+21`). This implementation reproduces that (`src/pyrepr.ts`), but the spelling of a number depends on the stored text, which JSON parsers do not keep: the conformance sample's `"offset": 1e+20` and `"alt_m": 120.0` print as `1e+20` and `120.0` in Python and as `100000000000000000000` and `120` here. A canonical record (RFC 8785 text) never differs. Python's repr of a string is not portable either (`isprintable`, quote choice). Suggest either a renderer per profile — a health sample as `steps 250 (Watch7,1)`, a transaction as `-42.5 USD Harbour Cafe` — or a stated fallback that is language-neutral (compact JSON).

    *Answered (b3cd8c5, 2026-10-02).* The reference moved: the generic row spells a number as RFC 8785 writes it, by value and never by the text the writer stored (`100000000000000000000`, not `1e+20`; `0.000001`, not `1e-06`; `120`, not `120.0`), through the serialiser its chain already uses; a nested object, list, string, boolean and null keep Python's spelling (`{'epsilon': 0.000001, 'gain': 1e+21, 'offset': 100000000000000000000}`, `[True, None, "it's", -0.5]`). This implementation does the same, `src/pyrepr.ts` reusing `canonicalize` so the row and the hash can never disagree. Two differences remain. An integer from 1e21 is a Python int, printed in full (`12345678901234567890123`), and a double here (`1.2345678901234568e+22`), which JSON gave up the digits of on parse; no fixture carries one. And Python's repr of a string (`isprintable`, quote choice) is still the format of a nested value. Suggest the spec name the row's rule, since two implementations now share it.

25. **The end of a run of points.** SPEC §3.2 (clarified from question 20) says a run spans to the last point's `end` when that is not null, else to its `at`. The reference prints the last point's `at` regardless: on the conformance sample's 2026-03-01 it prints `08:30–09:05` where the second point carries `end` 08:40Z (09:40 in Oslo). This implementation follows the spec and prints `08:30–09:40`. The fixtures that both implementations are diffed on have no run that ends with a point carrying `end`, so the diff stays green; the spec or the reference should move.

    *Answered (b3cd8c5, 2026-10-02).* The reference moved to the spec: a run ends at the last point's `end` when it has one, else at its `at`; one point is still a row of its own and prints its `at`. Both implementations print `08:30–09:40` on the sample's 2026-03-01, which is now in `tests/fixtures/sample-logbook/expected-show/` and diffed by `tests/cross-impl.test.ts`.

26. **Order of a day.** SPEC §3.2 says a day is listed in the order of the instant `at` denotes, then by `seq`. The reference orders by the text of `at`: a line at `10:00:00.5Z` prints before one at `10:00:00Z`. This implementation orders by instant. The fixtures avoid fractional seconds for that reason.

27. **A reader MUST NOT fail on a payload it cannot interpret (SPEC §5), and the reference's `show` does.** It raises on the conformance sample's own days: 2026-03-01 (`attendees` as strings) and 2026-03-06 (`chat` as a string), the two shapes §3.2 and §6 name as older-than-the-profile; and on a `crossing/v1` line without `counts`. This implementation reads a string attendee as an email ref, a string chat as a direct chat's name, and a crossing without counts as `crossed to <destination>: 0 lines`. The conformance sample cannot be used for the cross-implementation diff until the reference reads it.

    *Answered in part (b3cd8c5, 2026-10-02).* The reference reads a string `chat` as a direct chat of that name, as this implementation does (`Ines: Landed? Dinner Sunday?`; with `--raw`, `: Landed? Dinner Sunday?`), and a `chat` of any other non-object shape as no chat; its tests print such a message as ` in : ?` (an empty sender, `in`, an empty chat), a shape no fixture here carries. String attendees already read. A `crossing/v1` line without `counts` is not mentioned by the change and stays open. Every day of the sample now prints in both implementations and is diffed (question 40).

28. **Folding calendar entries.** The reference folds `event/v1` lines that several sources carry into one row, and the rule moved on 2026-10-01: at b60ae11 it folded lines with one title (trimmed, case-folded, whitespace collapsed) or naming one flight, from different sources, starting within five minutes of the first, and printed the sources as `ics+ios-calendar`; at dae84b0 it folds on the exact start *and end* (both null counts as the same end), the title compared with case, accents and whitespace aside (`Zürich` and `Zurich` fold, `Tromsø` and `Tromso` do not, since `ø` is a letter and not an accent) or the same flight designator in the title, from two or more sources, and prints `×N sources`, N the distinct sources, in the source column; a source holding the entry twice folds into a group that another source is in, but two lines from one source alone are two rows; a retracted line is neither folded nor counted; the row carries the first line's time and summary (its attendees, not a member's). This implementation now does the same (`^[A-Z]{2}\s?\d{1,4}` for the designator, NFKD with combining marks dropped for the accents). RFC 0009 should state the fold, as RFC 0002 states the photo fold (which the reference does not apply in `show`: two `photo/v1` lines a second apart with one file name print as two rows).

29. **Who a message is from, when no resolution names the sender.** The reference prints, in a direct chat, the sender's `name`, else the chat's own name, else the ref's value; in a group, the name else the value; the owner's own message as `me → <chat>` in a direct chat and `me in <chat>` otherwise, including when the chat is missing (`me in : text`). A message without text prints `[<media_kind>]`, else `[media]`, and an empty `text` counts as none. None of this is in RFC 0008; it is reproduced here from observation.

30. **`me` in a mail row comes from `direction`, not from `owner_emails`.** A mail with `direction: "sent"` prints `me` whatever `from` says; one from an address in `owner_emails` with `direction: "received"` prints the address. Recipients are `to` then `cc` (never `bcc`), each by resolution, else the header's name, else the address; a recipient that is the owner is never `me`. With `--raw` the owner's own mail prints the address too, and the body follows the row four spaces in. RFC 0015 defines `direction`; the rendering should say which field decides.

31. **A transcript's `; N turns, M min` is read from `extra.turns` and `extra.duration_s`,** which no RFC defines (`extra` is "anything else the source reports"), and the line's own `end` is ignored: a transcript with `at` and `end` 35 minutes apart and no `extra` prints no length. Participants print by the resolution of their email, else their name, else the email; one with only a phone or a provider id is dropped. Suggest RFC 0004 name the fields a reader may count on.

32. **`voice-memo/v1`: "audio missing" means no `media`, "not stored" means a `media` without `path`.** A `media` whose `path` names a file the record does not hold prints nothing: the reference does not look at `attachments/`. The clock is `round(duration_s)` as `m:ss`, minutes not folded into hours (`62:06`), and a `duration_s` that is not a number is skipped.

33. **Rounding.** The reference rounds a voice memo's seconds and a transcript's minutes with Python's `round` (half to even: 0.5 → 0, 1.5 → 2, 2.5 → 2), and a call's minutes by truncation (159 s → `2 min`; below 60 s, `30 s`). This implementation does the same; a spec that names the format should name the rounding.

34. **Profiles without a renderer.** `health-sample/v1` (RFC 0014) and `transaction/v1` (RFC 0021) print the generic row of question 24 in the reference, so `show` of a day of health data is a wall of `device=Watch7,1, raw_id=…, type=steps, unit=count, value=250`. (A `keeper` profile, named by the request that produced this work, did not exist at b60ae11; RFC 0024 defined it the same day, see question 38.)

35. **Resolution lines on their own day.** The reference lists a `resolution/v1` line on the day of its `at` with the generic row (`entity={…}, label=Ola Nordmann, method=exact, ref={…}`). This implementation used to print `email ola@example.org → person Ola Nordmann`; it now prints the generic row to match. Whether a derived line (ADR 0013) belongs in a day listing at all is a question for §3.2.

36. **The zone a row is printed in.** The reference localises every row in the record's `timezone`, never in the line's own `tz`: a `flight/v1` line whose `tz` is the origin airport's (RFC 0013) prints at the record's clock. This implementation does the same, and so does the day assignment. SPEC §2 calls `tz` "the owner's timezone at `at`"; §3.2 could say which zone a reader lists a day in.

37. **The width of a kind and a source.** The reference pads `kind` to 10 and `source` to 14 columns and lets longer values (`commitment-close`, `whatsapp-contacts`, `ics+ios-calendar`) push the row; a run's `HH:MM–HH:MM` is not padded to the width of `HH:MM`. Columns therefore do not align on a day with a run or a long source. If the format is ever written down, this is the place to fix it.

## Found when the conformance sample grew to v0.5.0 (openlogbook main at e8ba94a, 2026-10-01; RFC 0024)

38. **The hero line and the keeper row are not written down.** RFC 0024 rule 4 says a reader of a day "lists the day's keeper lines standing, `memory` first, as the hero photos" and no more. Run on probe records, the reference prints, right under the day's heading, `  hero  <photo>, <photo> (art)`: the `memory` keepers in row order, then every other keeper with the suffix `(art)` whatever its `lane` says (`odd`, or no lane at all, is `(art)` there but `(odd)` and `(None)` in the row); a photo is its `file_name`, else its `asset_id`, else the photo line's id (Python truth: an empty string is nothing), else `?`, and a `photo` that is not an object is `?`; a retracted keeper is neither a hero nor a row; a keeper that another keeper `supersedes` is still both. The row is `hero photo (<lane>): <photo>`. This implementation prints the same. RFC 0024 should say what the line looks like, whether `(art)` is the label of every lane but `memory`, and whether `supersedes` hides the earlier keeper as it does a flight.

39. **A flight without a designator.** RFC 0013 now lets an `inferred` line carry neither `carrier` nor `number` ("print such a line as its route alone"). The reference prints `ZRH → IST, inferred`; one with a designator and a `to` that has no code prints `XY 1 ENGM →`, and the conformance sample's own line 11, whose `from` and `to` are strings (`"OSL"`, `"CPH"`, a shape before the RFC), prints `SIM SIM123  →` with two spaces and nothing after the arrow. This implementation prints the same; a string airport could reasonably be read as its code (SPEC §3.2 lets a reader choose), but then the two implementations would differ on the sample.

40. **The conformance sample cannot be diffed whole.** Of the eight days of `conformance/sample-logbook` at v0.5.0, the reference reads six as SPEC §3.2 says and this implementation prints them identically (`tests/fixtures/sample-logbook/expected-show/`, checked by `tests/cross-impl.test.ts`). 2026-03-01 differs twice over: the run of points ends at `09:05` there and at the last point's `end`, `09:40`, here (question 25), and the sleep line's `offset` is `1e+20` there and `100000000000000000000` here (question 24). 2026-03-06 raises there (question 27). Both are the spec's side of a known disagreement; a regenerated sample that ends the run on a point without `end`, stores `1e+20` as `100000000000000000000`, and shapes the chat as RFC 0008 does would let the whole sample be the cross-implementation fixture.

    *Answered (b3cd8c5, 2026-10-02).* The reference moved instead of the sample (questions 24, 25 and 27) and pinned 2026-03-01 and 2026-03-06 whole in its own tests; `expected.json` is unchanged. All eight days are now in `tests/fixtures/sample-logbook/expected-show/`, captured from the reference, checked by the unit tests and diffed against the reference by `tests/cross-impl.test.ts`; the sample is the cross-implementation fixture whole.

41. **A range, a profile filter and a JSON form are not specified.** SPEC §3.2 fixes the order of a day and what a reader does with retractions, runs and aliases; it says nothing about listing several days, choosing profiles, or a machine-readable form, and the reference `show` takes one day and `--raw` only (`logbook day --json` is a different reader, of stays and moves). `show` here takes `--since`/`--until` (a range of local days, inclusive; a missing bound is the record's first or last listed day; a day without a line is left out and an empty range says so), `--profile` (lines whose `payload.schema` is one of those given, a name without `/vN` meaning every version, applied before runs are collapsed and entries folded, while resolutions and retractions still come from the whole record), and `--json` (one object per day: `day`, `timezone`, `hero`, `rows`, `note`, each row the text column as `summary` with `time`, `until`, `kind`, `source`, `retraction` and the full `lines` behind it). Two readers that both offer these should agree on at least: whether a filtered day collapses runs across the lines filtered out (here it does, since §3.2 collapses a run "unbroken by any other row" and there is no other row); whether an empty day in a range is listed (here it is not); and what the JSON row carries (here, the lines themselves, so nothing of the record is lost in the reading). Worth a §3.2 sentence each, or a note that they are a reader's own.

## Found while implementing `day` (openlogbook main at 996642f, 2026-10-02; docs/day.md, README "Reading the day back")

`day` was written from SPEC §3.2, docs/day.md, the README's prose on `derive stays`, the with module and the
labels, and the RFCs, and then matched to the reference by running it: on its own demo record
(`logbook demo --days 30 --seed 7`, every day of June, text and JSON) and on a probe record built to
have a case of every rule (`tests/fixtures/day-sample`). Where the prose said one thing and the reference
did another, this implementation does what the reference does and says so here. What the output
revealed:

42. **The Day's text and JSON are not written down.** docs/day.md shows two days and names the JSON's
    keys; the rest is learned by running the reference: the header labels padded to thirteen columns
    (`night before`, `night after`, `country`, `all day`), a blank line, one row per stay, stop, move,
    gap, run aboard and flight as `  HH:MM–HH:MM  <kind padded to 6> <text>` (a run's rows four columns
    further in, without `aboard <id>`), the attachments under a row as `      <label padded to 12> <text>`
    in the order events, transcripts, notes, mail, calls, keepers, then `with`; `unplaced` one line per
    line placed nowhere, each with the label; `timeline      nothing logged` for a day with no row; the
    durations to the minute (`4 h 55 min`, `9 h`, `35 min`), the distances `446 m`, `9.0 km`, `36.7 km`,
    `1426 km`; a stay as `<where> · <duration>[ · aboard <id>][ · counts]`, a stop as
    `<where> · <duration> · nothing attached`, a move as `<distance> · <duration> · <mode or mode unknown>[ · OSL → ZRH][ · counts]`,
    a gap as `<duration> · no points · <distance>`, a run as `<asset name> (<kind>) · <duration>[ · counts]`,
    a flight as `<carrier> <number>  <from> → <to> · <evidence>`; a night as `<where> · home|away` or
    `in transit`; the country as `NO (place Home)`, `CH (nearest airport ZRH)`, with ` · from the longest stay`
    when the night is in transit, or `unknown`; the health line as `sleep 6.6 h · 8,115 steps · resting 53 bpm`
    or `no lines`; the sources as `<source> N lines, last HH:MM`, most lines first, then by name. A
    third implementation can only learn this by running the reference; docs/day.md could carry it.

43. **How stays are derived, in the detail the prose leaves out.** README and docs/day.md give the rules
    in words; the numbers that make two implementations agree are: a cluster is anchored at its first
    point, or at the centre of the named place whose radius holds that point (the nearest when several
    do), and takes every later point within the radius; a point outside begins an excursion, and the
    stay goes on when a point is back inside within `merge_gap_s` *of the last point inside* (not of the
    first point outside), the excursion's points being neither the stay's nor the move's; the stay ends
    at its last point inside. A cluster of one point is never a stay or a stop; one of two or more is a
    stay from `stay_min_s`, a stop from `stop_min_s`, and dissolves into the move below that. *Any*
    calendar entry inside a cluster promotes it, an all-day one too (a two-point, five-minute cluster on a
    day with an all-day entry is a stay, `promoted: true`); so do a transcript, a note, a call, a message
    and a photo. A stay whose next point comes after a silence of `merge_gap_s` and lies within
    `walk_max_kmh` for `merge_gap_s` of the anchor lasts until that point, which is the first interior
    point of the move, not the stay's. `points` of a stay counts the points inside; `lat`/`lon` is their
    mean, exactly summed (Python's `fmean`) and rounded to six places; the stay's id carries the start
    to the minute and the centroid to four places. A move's distance is the path from the stay's last
    point through the interior points to the next stay's first; its mode comes from that distance over
    its duration (`walk` to `walk_max_kmh`, `car` to `car_max_kmh`, `train` below `flight_min_kmh`,
    else `flight`), computed with no interior point too (a four-hour gap of 4.7 km is a `walk` in the
    JSON while the text says `gap`), and is `None` (`mode unknown`) below about a kilometre an hour
    — the demo's five-minute moves of 11 to 51 m have none, a five-minute move of 315 m walks; the
    threshold itself is a guess at 1 km/h, which the probe cannot pin down. A move whose two ends are
    within `airport_km` of two different airports is a `flight` with those airports. These are the
    reference's choices read off its output; `policy/stays.json` could document them.

44. **Aboard.** "When your position matches the asset's own track" is, as far as the output shows: of a
    segment's points (a stay's inside, a move's interior) that have a position of the asset within
    `aboard_window_s`, more than half lie within `radius_m` of the nearest one in time; a point with no
    asset position near it in time is not judged, so a boat reporting hourly at its berth still has the
    owner aboard, while a passage on which the owner's points fall between the boat's five-minute
    reports is a `car` move at 9 km/h. A move aboard a yacht is by `boat`. Since the reference's
    e5e08a3 (PR #159, 2026-10-02) a stay aboard is a container: the run of consecutive segments
    aboard one asset, folded over the whole window read, is one `aboard` row from the first's start to
    the last's end when a stay is among them (a move alone stays a move), whatever day its segments
    fall on — a run that began the day before is the same row on the next day, with the run's id,
    span, `points` and `lines`, and only the segments that touch the day inside it (`distance_m` is the
    inside moves' sum, so it reads `0` on a day the run only lies at anchor). Its `lat`/`lon` is the
    inner stay spent longest at over the whole run, and that coordinate is in the id the night names it
    by (`stay:owner:<run start>@<centre>`). docs/day.md also says boarding takes `aboard_min_s`
    (1200 s) of the asset's fixes within the radius, and that under way the asset's position is read
    between its two fixes around the owner's instant; no fixture separates that from the
    "more than half" rule above, which still matches every vendored day. Whether "more than half"
    is the reference's rule or "all" is not decidable from the demo (both fit); ADR 0018 could say.

45. **Labels.** An unnamed stay is its coordinates to four places; within 3.5 km of an airport of the
    table it is `OSL, Oslo` — the municipality column cut at its first parenthesis or comma
    (`Oslo (Gardermoen)`, `Sandefjord(Torp)`, `Birmingham, West Midlands`); else, when a named place
    lies within 5 km, `<coordinates> near <place>, x km` with the nearest such place and the distance
    to one decimal (since e5e08a3 the Day shares `trips`' label; before, the coordinates alone); else
    with the city of the nearest airport within 30 km in parentheses. The night's `where` is the
    place's name, else the home place its centre is within 400 m of, else `aboard <asset name>` when
    the stay is aboard, else that label; the night's `position` is the stay's `lat` and `lon`, and
    aboard an asset the inner stay that held the longest part of the night window (the anchorage,
    printed in the header as `aboard Solvind · 60.3000,5.2000 · away`), `null` in transit.
    The airports and zones tables are the reference's own (RFC 0013 rule 5), vendored into
    `src/tables.ts` by `scripts/make-tables.mjs`, since the nearest airport decides a label and a country.

46. **Country.** The night's stay's place carries a `country`, else the nearest airport within 300 km
    and the country its zone is filed under in zone.tab; when the night is in transit, the same from
    the stay with the longest part on the day, `from: "longest stay"`; with no stay at all every field
    is null and the text says `unknown`.

47. **A flight without a designator prints `None None`.** RFC 0013 lets an `inferred` leg carry no
    `carrier` and no `number`; the reference's row is `flight None None  BGO → ENGM · inferred`,
    Python's `None` for each. This implementation prints the same so the diff stays green; a route
    alone would read better. The JSON has `null`.

48. **Who was there.** An attendee of a timed entry held at the stay is confirmed by `calendar` when the
    entry's `location` names a place of `places.json` (case aside) within a kilometre of the stay, or
    when it has no location and overlaps the stay by more than an hour; a location that names no
    place confirms nobody, whatever the overlap, and coordinates on the entry are not read. An all-day
    entry proposes nobody — docs/day.md says its attendees are proposed at every stay, and the
    reference, on a one-day and on a week-long entry, proposes no one; this implementation follows the
    reference. A `transcript` participant counts by email, else phone, else `provider_id`; `Speaker A`,
    `me` and `Unknown` are nobody. A `note` confirms every person the record names who follows a `with`
    in the same sentence (`with Ola Nordmann and Anders Vik`), ordered as the note names them. A
    `photo`'s `people` are `provider_id` refs `<library>:<id>`, proposed. Someone the record resolves
    to no person is still listed, by the attendee's display name or the face's `<library>:<id>`, with
    `person: null`; an attendee with neither name nor resolution is dropped. The owner is never
    company: by `owner_id`, by every ref that resolves to the same entity as `owner_emails` or the
    emails and phones of `policy/owner.json`, and by the names there and the owner entity's label (a
    note's `with Kari` names nobody). Confidence is `calendar` 0.8, `transcript` 0.9, `note` 1.0,
    `photo` 0.5, the highest of a person's sources; people are listed by confidence, then as the
    evidence named them; sources, reasons and lines in the order calendar, transcript, note, photo.
    The text is `Name (calendar, photo), Other (note) · proposed Face (photo)`.

49. **What attaches where.** A line with a span attaches to every row it overlaps for longer than
    nothing (a lunch from 12:00 to 13:00 is on the stay that ends at 12:55 and on the move that starts
    then, not on the move that ended at 12:00); an instant attaches to the row that holds it, the ends
    included (a note written at the minute a stay ends is that stay's). Only the day's lines attach —
    an entry that runs over several days is on the day of its `at` — and a gap row holds nothing, so a
    line inside a silence is unplaced. A note another note `supersedes` is still attached beside the
    newer one; a retracted line is nowhere. An unplaced entry is `{kind, at, end, title, line}` (an
    event also `sources` and `lines`), its `title` the event's, the transcript's, the note's first line,
    the mail's subject or the call's counterparty *as written* (`+4790000002`, where the row would
    print the name). A note's text is its first line cut to 72 characters with an ellipsis. A call is
    `→ Ola Nordmann, 15 min` with the minutes truncated, `no answer` or `missed` when not answered,
    `45 s` under a minute. Mail is grouped by `thread`, `1 mail thread` in the counts and
    `Subject (2 messages)` under the row, the subject the thread's first message's.

50. **Health.** The night's sleep is the asleep stages (`asleep`, `core`, `deep`, `rem`) whose *end*
    falls on the day, per device the union of their spans (a stage written twice counts once), the
    longest device; steps are the larger device per quarter hour, summed; the resting rate and the HRV
    are the day's means, rounded half to even; a line another health line `supersedes` is out; the hours
    are rounded half to even on an exact tie (6.25 prints `6.2`). The text shows sleep, steps and
    resting only — `hrv` is in the JSON and not on the line. `health.lines` lists the night's stages,
    then the winning quarter hours, then the resting readings, then the HRV readings, each by `at`;
    `health` is `null` when no line contributed. RFC 0014 could say which day a night belongs to.

51. **Sources.** `sources` counts the lines standing on the day: a retracted line is not counted and
    the retraction line itself is not a source. `first` and `newest` are the lines' `at` as written.

52. **The window a Day reads.** The reference reads the day before and the day, to the end of the
    night after (`00:00` of the day before to `08:00` of the day after, by `policy/stays.json`'s
    `night`); a stay in progress at the window's start starts there, and its id carries that start, so
    the same stay has another id read from another day. This implementation reads the same window —
    one pass over every file for the resolutions, retractions and `supersedes` (as `show` does), then
    the month files the window can touch, keeping the lines inside it — so its memory is the window's
    lines, not the record's, and no index is built or read. SPEC §3.2 could name the window.

53. **Rounding and clocks.** A row's clock is the local time floored to the minute (`08:36` for
    08:36:40); its duration is the part on the day rounded to the minute; a run of a flight or an entry
    that ends the next day prints `14:00+1`. The `within_day` of a row that began the evening before
    starts at local midnight. Two implementations that both print to the minute can still differ at
    the half minute; the reference's rounding there is not visible in the fixtures (this
    implementation rounds half to even).

54. **A day of a `logbook/0.1` record.** As with `show` (question 21), `day` refuses it, so every
    command answers a record it does not carry the same way.
## Found while implementing `stats` and `sources` (openlogbook main at 996642f, 2026-10-02)

The reference was run, never read: `logbook stats` and `logbook sources --gaps` on the three fixtures, on probe records built for the purpose (sources with a silence of minutes, of hours, of a day that skips no local day, a line dated after today, lines in several local years, two retractions of one line and one of a line that does not exist, a digest referenced twice) and on the reference's own demo record (`logbook demo`), and this implementation was written to print the same text. `tests/cross-impl.test.ts` keeps them in step on the fixtures and the demo record.

55. **The `stats` screen is not written down.** The README says what it counts (kind, source, year, retractions, resolutions, attachments) and that it prints numbers, never content; the text is learned by running it: `<format>  head <hex>`, `<N> lines  first <at>  last <at>` (`0 lines` on an empty record, and then no table at all), then a table per kind (`  kind  lines   first       last`, each row `<kind> <lines> <first local day>  <last local day>   <n> source(s)`), per source and per local year with a bar of one `█` per percent of the busiest year (rounded half to even, so a year with a third of the busiest's lines has 33), kinds and sources by lines then by name, the name column as wide as the longest name and ten at least, the lines column as wide as the total with thousands separators and five at least; then `<n> retraction(s) hiding <m> line(s)`, `<n> resolution line(s) minting <m> entit(y|ies)`, `<n> attachment(s) referenced by <m> line(s), <p> present under attachments/`, and `took <s>s`. What is counted, as the runs showed: the lines a retraction hides are the distinct `supersedes` values, whether or not such a line exists (a retraction of a ghost still "hides" one); the entities are the distinct `entity.id` of every resolution line, retracted or not; an attachment is a distinct `sha256` under `payload.media`, `payload.extra.media` or `payload.content`, a line counts once however many it carries, a mail's `attachments` list and a crossing's `package_sha256` are not references, and present means a file named by the digest exists under `attachments/`. The format and head are those of `logbook.json`, not recomputed, and a `logbook/0.1` record is counted (this implementation refuses it, as every command here does; question 21). This implementation adds a table per tier and per local month, which the reference has not; the cross-implementation test removes them before the diff. Suggest the spec repo document the screen, so a third implementation need not probe for it; a lines-per-tier table would also show at a glance how much of a record is tier 3.

56. **The `sources --gaps` report is not written down either, and its footer names the index.** Learned by running: a table `  source  lines  last  longest silence  missing days`, each row the source (ten columns at least), the lines, the last line's local `YYYY-MM-DD HH:MM`, the silence as a duration padded to seven (`93d 13h`, `20h 0m`, `5m`: whole units, floored, the largest two) and either `since <local from>` while it runs or `<local from> → <local to>` between two lines, the count of missing days right-aligned to three places (a four-digit count pushes the row), then up to three runs (`2026-06-15`, `2026-07-01..2026-10-02`) and `+N run(s)`; under `--expect` the rows are the sources named, in that order, a flagged one marked `!` in the first column, one with no line as `<name>  0  -  no lines`; a footer of `<n> source(s) with lines` or `<f> of <n> expected source(s) flagged: a, b` or `<n> expected source(s), none flagged`, then `since each source's first line, today <day> (<zone>); counted through the index, every line` (or `since <day>, today …`); `no lines` for an empty record; exit 1 when a source is flagged, 2 on `--since` after today (`sources: --since <day> is after today (<today>)`), a malformed day (`sources: not a date (YYYY-MM-DD): '<text>'`) or `--since`, `--expect` or `--json` without `--gaps` (`sources: --since, --expect and --json go with --gaps`). The rules the runs showed: a line whose local day is after today is outside the range and not counted; today is a missing day only when the last line is 24 hours or more before now; a source is flagged when its longest silence is 86,400 seconds or more, whatever its missing days (a 25-hour silence that skips no local day flags; a 20-hour one does not); under `--since` the range starts at that day's local midnight, lines before it are not counted, and the silence from that midnight to the first line counts. The JSON (`since`, `today`, `timezone`, `expect`, `sources[]` with `lines`, `first`, `last`, `silence {from, to, seconds}`, `missing_days`, `flagged`, and `flagged[]`) is reproduced too. One phrase is not: this implementation has no index and its footer says `counted from the month files`; the cross-implementation test normalises that phrase. A reader that has to be told "the index" is a detail of the reference; suggest the report say `every line` and stop. The silence between two lines is measured on the lines ordered by `at`, which a month file is not (it is in chain order), so this implementation sorts each file's lines per source before measuring; a line placed in the wrong month file (question 2) would measure wrong in both.

57. **`sources` without `--gaps` lists adapters.** The reference prints every adapter its build carries (43 of them), `file`, `live` or `file+live`, and `enabled` or `disabled (<reason>)` from `policy/import.json`, then any disabled name no adapter carries. A second implementation that only reads has no adapters to list. This implementation prints the record's sources instead — one row per source with lines, its lines, its first and last line in the record's zone — and keeps the reference's `--since`, `--expect` and `--json` go with `--gaps` rule. Whether `policy/import.json` (which SPEC §1 does not name) is part of the format, and what a reader without adapters should say to `sources`, is a question for the spec.

## Found while implementing `trips` and `rollup countries` (openlogbook main at 36a7d62, 2026-10-02; README "Trips are derived, never written", ADR 0019, docs/rollups.md)

`trips` and `rollup countries` were written from ADR 0019, the README's paragraphs on trips, homes and
countries, docs/rollups.md and docs/day.md, and then matched to the reference by running it: on its demo
record (`logbook demo --days 30 --seed 7`, text and JSON, whole, by year and by range) and on a probe
record built to have a case of every rule (`tests/fixtures/trips-sample`, seventeen days over the turn of
2025–26). What the output revealed, none of it written down:

58. **What a trip is, exactly.** "A run of consecutive days whose overnight stay is outside every home
    region" leaves the nights in transit open. The reference counts a night with no stay in the night
    window as part of the run on either side of it: a trip may begin on the night the tracker slept
    through before the first night away, and end on one after the last; a run of such nights alone, with
    no night at a stay, is no trip. A trip's `until` is the day after its last night whether or not that
    day is in the window; its `in` flights are the first day's, its `out` flights the day after's, and
    `flights` are every flight line standing from the first day to the day after — only within the
    window, so a trip the window cuts has no `in` or no `out`. This implementation does the same.

59. **The nights, by asset.** `asset` is set when every night with a stay was aboard that one asset,
    the nights in transit not counting against it (`2 nights aboard Nordlys (1 in transit)`, with
    `asset: "nordlys"`); with a night at a stay ashore it is null and the text counts the nights per
    asset and in transit in parentheses (`4 nights (2 aboard Solvind, 1 in transit)`). A run of
    segments aboard one asset is one stay for the night (docs/day.md, *Aboard an asset*), so the
    `lines` of a trip whose nights are all in one run aboard name that run's first and last point once.

60. **The route.** The night places in order, a night in transit adding nothing; two consecutive
    nights fold into one element when their labels are equal (every night aboard one asset is `aboard
    <asset>`, however far the anchorages lie apart) or, for two unnamed stays, when their centres are
    within 200 m. The label is the named place; else `<code>, <city>` when the stay is within 3.5 km
    of the reference point of an airport with scheduled traffic (2 km of any other); else the
    coordinates to four places, with `near <place>, x km` (one decimal) for the nearest named place
    within 5 km, home places included, else with the city of the nearest large airport within 30 km in
    parentheses, else alone. docs/day.md says `day` labels an unnamed stay the same way; the `day` here
    still prints the coordinates alone in the `near` case, as the reference did when its fixtures were
    captured (question 64).

61. **The places of a trip.** The named places of the stays — not the stops — of every row that touches
    a day from the trip's first to the day after, places of kind `home` left out, in the order first
    stayed at. The day after counts: an office visited on the way home from the airport is a place of
    the trip. A named place inside a run aboard (the marina the run began at) is one.

62. **The people of a trip.** The confirmed company of the same rows, merged by person (the entity id,
    or the name when the record resolves none: an attendee with a display name and no resolution line
    is listed, with `id: null`), ordered by how many lines put them there, then by name, and cut at
    twelve — in the JSON too; the `lines` of a trip carry the listed people's lines only. A person named
    at a stay at home on the morning of departure, or at the office on the day of return, counts. The
    `confidence` is the highest of their evidence (`calendar` 0.8, `transcript` 0.9, `note` 1.0).

63. **Whose lines a confirmed person carries.** Unlike the Day, which reads a row's company from the
    day's own lines, the readers over a window merge a stay's evidence over the stay's whole span: a
    person confirmed by a note on the first evening and tagged in a photo on the second morning at the
    same stay carries both lines; a photo's own coordinates do not matter, only that it was taken during
    the stay. In a run aboard, though, what falls in an inner stay is that stay's and what falls in a
    passage is the run's, each merged apart: the note written under way on the first day confirms two
    people with that one line, and the faces tagged at the anchorages on the next two evenings propose
    them and add nothing. Learned from the demo record and the probe; this implementation does the same.
    Worth a paragraph in docs/rollups.md, since a third implementation would read the Day's rule and
    get the lines wrong.

64. **The window.** Clipped to the first and last local day of the owner's own location lines (an
    asset's do not count), whatever `--since`/`--until` ask beyond them; `--year` with a bound is
    refused (`give --year, or --since and --until, not both`, exit 2); a window with no days prints
    `no trips: the record has no days` with `{"window": null, "trips": []}`, and for the rollup
    `countries` / `nothing in the window` with `{"since": null, "until": null, "days": []}` and no
    `method`; a window with days and no trips prints `trips <since> – <until>: no trips`; a record
    without a place of kind `home` prints the warning after the window and carries it under `warning`.
    `window.days` lists every day of the window, with or without a line. This implementation reads
    the lines from the window's first midnight to the end of the night after its last day, and takes
    evidence from the window's days only.

65. **The countries rollup.** Per year of the window, each day counted once for the country of its
    overnight stay: the stay's place's own `country` when the stay is anchored at a named place that
    has one (`by.place`), else the zone of the nearest large airport within 300 km (`by.airport`);
    a night within 400 m of home but outside the home place's radius is a home night for `trips` and
    still an airport night here, since the stay lies in no place. Countries most days first, then by
    code; `in transit` always printed (`in transit 0`), `unknown` only when there is one; `1 day`
    singular. Under `--json` the `lines` of a country repeat a stay's first and last point for every
    night spent there, `in_transit.lines` is always empty, and `by` names only the methods that
    counted. A night aboard counts at the position of the inner stay that held the longest part of the
    night, by its place or its nearest airport.

66. **The thresholds behind the two readers that the prose gives in words.** The night window is
    `policy/stays.json`'s `night` (22:00–08:00); the night is the stay (a run aboard counted whole) with
    the longest part in it, the earliest when equal; home is a place of kind `home` holding the stay or
    within 400 m of its centre; the route folds at 200 m, the near-place label at 5 km, the city label
    at 30 km, the country airport at 300 km, the people list at twelve. The reference's new
    `aboard_min_s` (boarding takes twenty minutes) is not implemented here: a segment is aboard when
    more than half of its points lie within `radius_m` of the asset's position at their instants, read
    between the two fixes around each when they are at most twice `aboard_window_s` apart, else from
    the nearest fix within the window. The demo record and both probes agree under either rule.

