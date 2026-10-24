# Questions for SPEC.md, found while implementing logbook-ts from the spec alone

Written against `bighydro/logbook` tag v0.3.0 (SPEC.md format v0.2; ADRs 0002, 0006, 0007, 0014; `conformance/`),
then against main at b60ae11 and e8ba94a (2026-10-01; RFCs 0001–0024, `conformance/` at v0.5.0) for the sections on `show`,
at b3cd8c5 (2026-10-02, PR #138) for the answers to 24, 25, 27 and 40, at 996642f (2026-10-02) for `stats` and `sources`, at 36a7d62 (2026-10-02) for the sections on `trips` and `rollup countries`, at 3092b60 (2026-10-08, RFC 0034) for the signed day, at f6bb65b (2026-10-13, RFC 0036 and its amendment 1, PR 269, open) for goals, reviews, drafts, chapters, `day_start` and `signed_within_days`, and at 7bcf728 (2026-10-15; docs/commands.md, docs/recovery.md, its #294) for the writer lock and the repair of a tail, and at b82a11c (0.7.0, 2026-10-18; docs/SPEC-QUESTIONS.md, docs/rfcs/0034, rfcs/0006, 0024, 0030, 0037, 0038, 0040, 0041) for 108–116.
The Python source was not read; an *Answered* paragraph quotes what the reference's commit message, changelog and tests say and what running it shows. Each entry says what is unclear, what this implementation does, and why.

1. **Head of an empty record.** §1 shows `logbook.json` with `seq` and `head` but never says what a record with no lines carries. This implementation expects `seq: 0` and `head` of sixty-four zeros (the same value §2 gives for the first line's `prev`), and `verify` reports `valid — 0 lines, head 000…0` for it. Suggest a sentence in §1 or §3.

2. **A line in the wrong month file.** §2 says lines live in `logbook/<YYYY>/<MM>.jsonl` with YYYY and MM taken from `at` in UTC, but §3's definition of *valid* lists only the chain conditions (seq, prev, hash, `logbook.json`). `verify` here does not fail a line that sits in a file other than its `at` month, because §3 does not say to; `add` always writes to the `at` month. Is misplacement an error, a warning, or nothing?

3. **`end` absent versus `end: null`.** §2 types `end` as "RFC3339 UTC or null", which reads as always present, and the sample always writes `"end": null`. If a writer omits the key, does `content` hash with `"end":null` or without an `end` member? These give different hashes. This implementation hashes an absent `end` as `null` (§2's type suggests the key is required) and always writes it. Suggest: "every content field MUST be present; `end` MUST be `null` when there is no duration".

4. **Timestamp precision and form.** "RFC3339 UTC" admits fractional seconds and the `+00:00` offset spelling. Since `at` and `recorded_at` enter the hash as strings, two writers that stamp the same instant differently produce different hashes, and readers cannot normalise without breaking hashes. The sample uses `YYYY-MM-DDTHH:MM:SSZ`; this implementation writes exactly that (seconds, `Z`) and accepts any string on read. Suggest pinning the form, or stating that the string is opaque to the chain.

5. **`seq` in the hash pre-image.** §3 concatenates `prev + "|" + seq + "|" + …`. The decimal rendering of `seq` (no leading zeros, no sign) is the only sensible reading and it reproduces the sample head, but it is not stated. One clause would remove the doubt.

6. **Case of hex digests.** `prev`, `hash` and the inner `sha256(content)` are "hex sha256". Lowercase is the only reading that reproduces the sample head, since the inner digest is concatenated into the outer pre-image as text. This implementation writes and requires lowercase. Suggest stating it.

7. **Validation beyond the chain.** §2 says `payload` MUST contain `schema`, `tier` is 1, 2 or 3, `seq` is an integer ≥ 1. §3's *valid* does not mention these. This implementation reports a missing `payload.schema`, a bad `tier`, a non-integer `seq` and non-hex `prev`/`hash` as errors from `verify` (they are MUSTs in §2), while still chaining the line so one fault yields one error. Should a conformant `verify` be stricter (validate `id` as a UUID, `at` as RFC 3339, `tz` as an IANA name) or looser (chain only)?

8. **Duplicate keys inside a line.** RFC 8785 inherits RFC 8259's "SHOULD be unique". If a `.jsonl` line carries the same key twice in `payload`, `JSON.parse` keeps the last one and the hash is computed over that; another parser might keep the first. Should `verify` reject duplicate keys?

    *Answered (220ca98, 2026-09-18; the reference since 886ed85).* SPEC §2 now says it: "A line whose JSON text gives the same key twice in one object, at any depth, is invalid." Run on the conformance sample with a line so rewritten, the reference's `verify` names it `logbook/2026/03.jsonl line 5: duplicate key 'kind'` and reads the file no further. This implementation does the same. `JSON.parse` still reads the value; then one pass over the row judges each object as it closes, by its names decoded (`k\u0069nd` is `kind`, `\ud83d\ude00` is `😀`), so the name given is the one the reference gives, as running it shows: the innermost object to close first (`{"x":1,"x":{"b":1,"b":2}}` names `b`), then that object's first name repeated (`{"p":1,"q":1,"q":2,"p":2}` names `q`), quoted as Python's `repr` quotes it (`"it's"`, `'a\x07'`); a top-level array holding such an object is named for the duplicate, not as no object. One difference remains, on a row that is also not JSON. The reference's check runs as each object closes, so a row cut after a whole inner object that repeats a name (`{"x": {"a": 1, "a": 2}, "y": `) is named `duplicate key 'a'`; here the syntax is judged first and the row is `the file ends inside this line (cut short)` (`not JSON` mid-file). Both make the row no line and stop the file there; only the sentence differs, and no writer leaves such a row. Suggest the spec say which a verifier names when a row is both, or that either will do.

9. **What `add` does when `logbook.json` is missing.** §1 defines the file; nothing defines how it comes to exist (`init` is not in the spec). `add` here refuses with an error. If the spec means `add` on an empty folder to create the record, it needs to say where `owner_id` and `timezone` come from.

10. **Encoding of the written line.** §2 says the line is JSON, UTF-8, newline-terminated; nothing says whether writers may escape non-ASCII (`ø`) or must write it raw, nor whether key order or spacing matters. Since the whole line is outside the hash, either is valid; this implementation writes each line as RFC 8785 canonical JSON (sorted keys, no spaces, raw UTF-8), which differs from the sample's `", "` spacing but verifies identically. Worth a sentence so diffs between implementations stay quiet.

11. **Ordering ties and `seq` gaps.** §3 says "every line's `seq` is the previous plus one". If two lines share a `seq`, the sort order between them is unspecified and so is which error to report. This implementation reports both the duplicate and the broken chain after it.

12. **Crash between the two writes of `add`.** `add` appends a line and then rewrites `logbook.json`. A crash in between leaves a record whose last line is fine but whose `logbook.json` is one behind, which §3 calls invalid. Does the spec want writers to append the line first (so the record is never missing data) or update the head first? This implementation appends first and rewrites `logbook.json` through a temp file and rename; the recovery (`logbook.json` catches up) is trivial but not specified.

    *Answered (SPEC §3, "Write order").* The line first, "flushed and fsynced", then `logbook.json` "written to a temporary file and renamed into place", then any index; "a crash therefore leaves the files ahead of `logbook.json`, never behind", and "until `logbook.json` is brought forward, `verify` reports such a record invalid". This implementation now does exactly that, fsync included. Who brings `logbook.json` forward, and on what check, is still not written: here, as in the reference since its #294, every writer refuses and `repair tail` brings it forward after verifying the chain (92).

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

64. **The window.** Clipped to the first and last local day with a location line — an asset's AIS fix
    counts, as the conformance sample shows (its last day holds only the yacht's fix, and the window runs
    to it), a note does not; this entry first said an asset's did not, and a probe put that right on
    2026-10-03 — whatever `--since`/`--until` ask beyond them; `--year` with a bound is
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


## Found while implementing `rollup nights` (openlogbook main at 3e99943, 2026-10-04; docs/rollups.md "Countries, flights, nights", docs/day.md's home-region rule, ADR 0019)

`rollup nights` was written from the one sentence docs/rollups.md gives it and matched to the reference by
running it: on `tests/fixtures/nights-sample`, on the other fixtures, on the conformance sample, on
`logbook demo --seed 1` (committed as `tests/fixtures/demo-seed1`) and on probe records built for each
question below. None of this is written down:

67. **What the longest trip is.** ADR 0019 says the rollup's longest trip "derives from the same `trips`
    function, so they agree", and docs/rollups.md calls it "the longest run of nights not at home". The
    second is what the output shows, and the two differ: the longest trip counts a run made of nights in
    transit alone, which `trips` says is no trip (question 58) — the conformance sample, whose eight nights
    are all in transit, has no trips and a longest trip of eight nights with no lines; a record whose last
    day's tracker fell silent before the night has a longest trip of that one night when every other night
    was at home. A run is clipped to the calendar year, so a trip over New Year is two longest trips, one
    per year (`2025-12-30 – 2025-12-31 (2 nights)` and `2026-01-01 – 2026-01-04 (4 nights)` for one run
    of six), and a run the window cuts starts on the window's first day. Of two runs as long the earlier
    is named; a year whose every night is at home has no longest trip (`longest_trip: null`, nothing in
    the text). This implementation does the same, and `trips` and `rollup nights` therefore disagree on
    purpose about a run of nights in transit, as the reference's do.

68. **The counts, the text and the lines.** A night is home by `trips`' rule (a place of kind `home`
    holding the stay, or within 400 m of its centre, question 66), in transit when no stay reaches the
    night window, else away; without a place of kind `home` every night with a stay is away and the
    nights in transit still count apart, under the warning `(no place of kind home in places.json: every
    night counts as away)` printed on its own line between the heading and the years, carried as
    `warning` and left out of an empty window. The text is `  <year>  N home · N away · N in transit`,
    every one of the three printed, then `N night(s) aboard <asset id>` for each asset with a night,
    by id (not by name, not by nights: `1 night aboard alpha · 2 nights aboard zeta`), then `longest
    trip <start> – <end> (N night(s))`; an empty window is `nights` over `  nothing in the window` with
    `{"since": null, "until": null, "days": []}` and `years: []`. Under `--json` a year's `lines` are the
    first and last point of each night's stay (a run aboard counted as one stay) in day order, a stay
    repeated for every night spent there and nothing for a night in transit — not de-duplicated as a
    trip's `lines` are — and `longest_trip.lines` are those of its nights. `aboard` is keyed by asset id.

69. **Three things found beside it.** (a) `trips` orders the nights aboard several assets by asset id in
    the text and the JSON alike (`(1 aboard Alpha, 2 aboard Zeta)`, `{"alpha": 1, "zeta": 2}`), not by the
    order boarded; this implementation did the latter until 2026-10-03. (b) Since b2009f5 (`logbook
    trip`) every `trips` row ends with the trip's id; the JSON is unchanged. (c) Since 03a8c98 (`logbook
    ledger`) the Day carries `spend` — `null` with no `transaction/v1` line on the day, else `count`,
    `deleted`, `totals` per currency (`spent`, `received`, `net`), `merchants` and `lines` — and the text
    a `spend` line after `health`: the currencies by code with the net to two decimals and a thousands
    separator, `N transaction(s)`, `N deleted` when any, the first four merchants and `+N` for the rest.
    docs/ledger.md says a retracted line is out and a correction stands in its place, which holds; what
    it does not say is that a line the source marks deleted (`extra.deleted`) is listed under `lines`
    and counted under `deleted` but never under `count`, `totals` or `merchants`; that `status`
    (`pending`) does not matter; that the day is the local day of `at`, not the line's `date`, so a card
    swipe at 00:30 counts for the day it was made on, not the day the bank files it under; and that the
    lines, and so the merchants, come in file order (`seq`), not clock order. What `spend` is on a day
    whose only transaction lines are superseded by a correction dated another day is not known; this
    implementation prints `null`. (d) Since a4a9b0c (`sync weather`, RFC 0026, merged while this was
    being written) the Day carries `weather` and every trip carries `weather`: `null` without a
    `weather/v1` line, else the day's weather row or the trip's span summary (docs/day.md item 5,
    the changelog). No fixture here has a weather line — the demo record has none, since `sync
    weather` asks a third party — so only `null` is read and matched; a record with weather lines
    would print a `weather` row in the reference and none here, and that reader is left for its own
    task. (e) The same again a day later: since 1da4a09 (`add story`, RFC 0028, a draft) the Day
    carries `stories`, the `story/v1` lines about the day, and since b57436a (the shared trip, RFC
    0025) `received`, the pages the circle shared for it; both are empty lists on every fixture, the
    demo record included, and the text is unchanged without them. Only the empty list is read here.
    A reference that grows a field a day is the cost of matching its `--json` whole; the cross-impl
    job clones it at main and says so the day it happens. (f) Where the spec stands on (c)–(e),
    checked at 176e6a7 (2026-10-04): SPEC §3.2.7's output list names eleven keys of the Day (`day`,
    `weekday`, `tz`, `nights`, `country`, `all_day`, `timeline`, `flights`, `unplaced`, `health`,
    `sources`) and none of `spend`, `weather`, `stories` and `received`, which the reference's
    `day --json` carries and its docs/day.md documents. §6.1 compares `day --json` whole, and §7 says
    §3.2 "is the readings the reference ships, written down so that a second implementation can agree
    with them": the spec lags its reference, the reference does not break the spec, and this
    implementation follows the reference. §3.2.7 should list the four. The trip id at the end of a
    `trips` row is text, which §3.2 leaves to each reader (the JSON `id` is the contract); it is
    matched here because this repository diffs the text byte for byte.

## Found while implementing `days` (openlogbook main at 176e6a7, 2026-10-04; docs/day.md "A window of days", SPEC §3.2.7)

`days` was written from docs/day.md's fortnight and SPEC §3.2.7 and matched to the reference by running it on
every fixture and on `logbook demo --seed 1` (`tests/fixtures/demo-seed1`). None of this is written down:

70. **The `days` row is not written down.** docs/day.md shows a fortnight and names the parts; the
    columns are the output's: the date, two spaces, the weekday's first three letters, two spaces, the
    night padded to 28 columns, the kilometres right-aligned in 11, two spaces, then the rest joined by
    ` · `. The night is the Day's `nights.after.where`, with the Day's country code appended when the
    night is not at home and the code is known (`Cabin NO`, `aboard Nordlys NO`, `47.3769,8.5417
    (Zurich) CH`; the asset's name, not its id), `in transit` when no stay reaches the night, and `no
    location` when, besides, the day has no location line standing at all (any subject). The kilometres
    are `moved_m` as `0.0 km`, `1.1 km` to one decimal under 100 km and `1,471 km` whole above, half to
    even as Python formats them. The rest: the flights as `XY 561 OSL→ZRH`, joined by `, `, a missing
    designator left out and a missing airport `?` (`SIM SIM123 ?→?`); `3 stays (4 attached)` with the
    parenthesis only when something attached, or `nothing logged` in its place on a day with no line
    standing (a day with lines and no stay reads `0 stays`); `with 2`; the Day's health text; `gap
    whatsapp` with the usual sources missing sorted by name. Under `--json` the night carries `located`
    besides the five fields SPEC §3.2.7 names, `country` is the code alone, and `weekday` is the full
    name. Learned from the reference's output on every fixture and on the seed-1 demo record.

71. **`days` reads a month at a time, and its numbers are not always the single Day's.** docs/day.md
    says "every number is the Day's" and SPEC §3.2.7 that `days` "reads a range the same way, a chunk
    at a time"; its *Performance* paragraph says the chunk is a month with the day before it. The stays
    are derived over that whole reading, so two things differ from `day` run on the same date: a run
    aboard an asset that spans days keeps its start and its centre on every one of them (the night of
    2026-06-17 of the seed-1 demo is `stay:owner:20260615T0645Z@59.0500,10.0300` in `days` and
    `stay:owner:20260615T2200Z@59.0500,10.0300` in `day`, whose window opens the day before), and a
    move that ends past the day's window — the red-eye of day-sample's 2026-04-09, 311 km over thirty
    hours — is in the reading and counts for the day it started on, where `day` lists no such row.
    This implementation reads a calendar month at a time, each with the day before it and the night
    after its last day, derives the rows once per reading and composes each Day from them; the chunk
    boundary is the calendar month, which the reference's output does not show either way (every
    window probed begins on a month's first day or lies inside one).

72. **Which lines make a source usual, and which days count.** "At least four in five of the window's
    days that have any line (retractions aside)": this implementation counts a day as having lines when
    the Day's `sources` are not empty and a source's days from the same `sources`, that is lines
    standing, a retraction line never among them; whether a retracted line keeps its source present
    on a day is not decided by any fixture, and the reference reads the share from an index
    aggregate this implementation does not have. The threshold is integer arithmetic (`days × 5 ≥
    total × 4`), so 28 of 31 days is usual and 3 of 5 is not; a window of one or two days with lines
    makes every source on them usual. A window given beyond the record (`--from 2026-05-25` on the
    June demo) prints its empty days with every usual source as a gap, which the reference does too.

73. **The default window of `days` and a bound beyond it.** SPEC §3.2.7: "its range defaults to the
    days the owner's track covers, else to the days with any line"; the track is bounded by any
    location line (question 64). Unlike `trips` and `rollup`, a `--from` or `--to` outside the track is
    not clipped: the reference prints `no location … nothing logged` rows to the bound, and so does
    this implementation; one bound given leaves the other at the record's. A range that runs
    backwards is `days: range runs backwards: <from> > <to>`, exit 2, the reference's own message.

## Found while implementing `people` (openlogbook main at 176e6a7, 2026-10-04; docs/people.md, RFC 0006)

`people` was written from docs/people.md's two examples and matched to the reference by running it on every
fixture and on `logbook demo --seed 1` (`tests/fixtures/demo-seed1`). None of this is written down:

74. **The `people` report is not written down beyond docs/people.md's two examples.** The head is
    `<n> people · <since> – <until>` with ` · tier <t>` when there is one (`0 people · 2026-03-01 –
    2026-03-08` on the conformance sample, no tier; this implementation writes `people` for one as
    well, which no fixture shows); a year with no days is `no people: the record has no days in
    <year>`, with `{"window": null, "tier": null, "people": []}`. A row is two spaces, the name padded
    to the longest name, two spaces, then parts joined by ` · `: the channels as `<channel> <lines>`
    in the order messages, calls, mail, calendar, transcripts, faces — joined by ` · ` into one part
    even when empty, so a person with days together and no channel reads `Ola Nordmann   · 1 day · …`
    with a leading separator, as trips-sample shows — then `<n> day(s)` and `<n> night(s)` when more
    than none, `last real contact <day> (<via>)` when there is one, and the places joined by `, `.
    Under `--json`: `window` (`since`, `until`, no `days`), `tier`, `people`, each `id`, `name`,
    `refs`, `tier`, `birthday`, `first_contact`, `last_contact`, `last_real_contact` (`day`, `via`,
    `line`, or `null`), `channels` (present ones only, in the same order, each `lines`, `first`,
    `last`, `tier`, `last_line`), `days`, `nights`, `places` (`where`, `days`) and `lines`. The order
    is days together descending, then `last_contact` descending, then the name by code point.

75. **The channels, where the prose leaves a choice.** The name is the label of the first standing
    resolution line that mints the entity, as docs/people.md says (the Day takes the label of the
    ref's own line); `refs` are every standing ref whose walk reaches the entity, in `seq` order,
    which on the demo is email, phone, provider id. A channel's `last_line` is the line with the
    latest `at`, the higher `seq` on a tie; its `first` and `last` are local days. The owner's
    message in a direct chat goes to the one person who sent a message in that chat within the
    window, else to the person the chat's `id` resolves to (`<digits>@s.whatsapp.net` as the phone
    `+<digits>`, an address as an email, a `+` number as a phone); a chat given as a string names no
    one. A calendar entry counts once per person however many times it lists them, and not when
    another line names it under `supersedes` (any kind, which is the superseded set this
    implementation keeps) or the attendee's `response` or `status` is `declined`. A transcript
    participant with no ref the record resolves is matched by name: the whole label, case aside, when
    exactly one person has it, else the first word when exactly one person's label begins with it;
    `Speaker A`, `me`, `them` and `Unknown` are nobody. A real contact on one day is the meeting when
    there was one, else the later of the last message and the last answered call that day; the
    `line` of a meeting is the earliest confirming evidence line of the day (Marta Keller's is the
    midday transcript, not the evening dinner), of a message or call that line itself. The window of
    the whole record is the first to the last local day of a listed line (a retraction line is not
    one), which this implementation already keeps for `show`.

76. **A day together, a night and a place, read from the window reader.** The confirmed evidence of
    a stay is read per unit — a stay; in a run aboard each inner stay with what fell in it and the
    run with what fell in no inner stay — and dated by the evidence line's own local day; a person's
    `lines` are the confirming lines only, so Ola Nordmann's tagged face of day-sample's 2026-04-08,
    which the Day lists beside his note, is not among them. The night of a day is together when its
    row is one the person was confirmed at by evidence dated that day, whichever unit of the row
    held the evidence (Anders Vik, confirmed at the Marina inside the yacht's run, has the night at
    anchor). The place of a unit is its stay's named place; else `aboard <asset id>` when the stay is
    aboard or the unit is the run itself (the note at an unnamed anchorage inside Solvind's run reads
    `aboard solvind`, the one at the Marina inside Nordlys's reads `Marina`); else the coordinates
    with `near <place>, x km` or the nearest large airport's city — never the airport's own `CPH,
    Copenhagen`, which a trip's route gives the same stay (trips-sample's airport hotel is
    `55.6200,12.6500 (Copenhagen)` here). Places are ordered by days there, then by the label.

## Found while running the per-profile fixtures (openlogbook #223, RFC 0031, 2026-10-05)

77. **Two `show` rows differ from the reference's.** `conformance/profiles/<profile>/` holds one
    record per frozen profile with the row the reference prints (SPEC §6.1). `tests/profiles.test.ts`
    passes `verify`, the canonical form and both hashes for all nineteen, and `show` for seventeen;
    the two below are held by `it.fails` until fixed. (a) `received/v1` (RFC 0030): the reference
    prints `from Ola Nordmann: photo immich · asset_id=…, faces=1, …` (the sender, then the inner
    line's kind, source and payload); this implementation prints the payload as `extra={…},
    line={…}, raw_id=…`. RFC 0030 rule 1 gives the form: "`show` lists them on their day as
    `from <sender>: <kind> <source> · …`". (b) `story/v1` (RFC 0028): the reference prints
    `📖 refers to 1961 — told by Ola Nordmann to Kari Nordmann` (`refers_to.text`, the teller, the
    listener); this implementation prints the story's `text`. RFC 0028 does not give a `show` row
    yet; the reference's is the one above, and §3.2 leaves the text to each reader, so this is
    matched here only because this repository diffs `show` byte for byte. Both are this
    implementation's to fix from the RFCs' words; the fixtures are the reference's.

## Found while porting RFC 0034, the signed day (openlogbook main at 3092b60, 2026-10-08; docs/rfcs/0034-the-signed-day.md)

The port was asked to compute the page digest exactly as the reference does, so for this profile alone
the reference's `logbook/core/signing.py` was read, as the task said, beside the RFC; what it added to
the RFC's words is written here. The RFC's example is synthetic and the fixtures are the reference's.

78. **Where the profile's rules are checked.** RFC 0034 says what the line MUST be (kind, tier 1, source
    `manual`, `end` null, the payload's fields) and what a reader ignores (a subject that is not the
    owner). This implementation has no per-profile validator in `verify` — SPEC §6 verifies the chain,
    and the reference's `verify` on the 32-line sample reports only `valid` — so the rules live in
    `src/signing.ts` as `signedDayProblems`, one message per rule broken, and the readers follow the
    reference's looser reading of what a signature is: the kind and the schema, the subject as the
    owner, a string `day`, not retracted (rule 3). A line that fails `signedDayProblems` but passes that
    reading still stands as the reference's would; the function is for a writer, a test or a caller
    that wants the RFC's shape held, and the day the spec says `verify` checks profiles it moves there.
    RFC 0034 does not say what `confirmed` may name beyond "a subset of the page's lines"; with the page
    given, an id not on it and a count that is not the page's are reported, and an id named twice is.
79. **The Day's `readiness` block is not read here yet.** The same RFC adds `readiness` to the Day — per
    class of source (mail, message, meeting, location, photo, calendar), whether the day has lines of
    it, from which sources, and which usual sources (four in five of the logged days of the 28 ending on
    the day, `policy/import.json` not disabling them) have not delivered — and a `readiness` row to the
    text. It is the reference's own advice ("its window and share are the reader's own"), held to a
    second implementation only once the profile freezes. This port is the signed day; `readiness` is
    not implemented, the vendored `expected-day/` files carry it as the reference printed it, and
    `tests/day.test.ts` and `tests/cross-impl.test.ts` compare the Day without that key and that row
    (`comparableDayJson`, `comparableDayText` in tests/helpers.ts). A later change adds it and drops
    the two helpers.
80. **The zone of the page under `show --tz`.** The page digest is over the day and "the record's zone"
    (SPEC §3.2). `show` here takes `--tz` (SPEC-QUESTIONS 41, this implementation's flag), which moves
    the day's boundaries; the reference's `show` has no such flag. With `--tz` the page is the lines of
    the day shown in that zone, digested with that zone, so a signed day read in another zone reads as
    `the page has changed since` unless the same lines fall on it; without `--tz` (the default, the
    record's zone) the digest is the reference's. `day` always reads in the record's zone.

81. **A line that is not one, and the lines after it.** SPEC §3's *Truncation* paragraph (the reference's
    #214, ffd2f97, 2026-10-04) says bytes that are not a line make the record invalid, that a verifier
    MUST report *each* by file and line number, and that `seq` and `head` are "those of the lines it
    read". What it does not say is whether a file is read past a line that is not one. Run on a file
    whose fourth row is cut but newline-terminated, the reference reports that row, reads the file no
    further (`3 lines read`, the head of seq 3) and lets the chain name the seqs the file held after it
    as missing; `verify` on the conformance sample so cut prints `INVALID — 2 problem(s); 3 lines read,
    head 7a120eb9…`. This implementation does the same, so the two agree on `seq` and `head` for any
    cut, not only the torn write §6 names; before, it skipped the bad row and read on, and a file torn
    in its middle counted the lines after the tear. Two readings of "each" are open: every bad row in
    the file (read on), or each bad row found (stop at the first, since the rows after bytes that are
    not a line have no trustworthy row number). The reference takes the second; the spec should say
    so. Also found: the reference's `logbook verify` prints its INVALID line to stdout with the lines
    read and the head (`INVALID — N problem(s); M lines read, head <hex>:`); this implementation keeps
    its lowercase `invalid — N errors` on stderr and adds `; M lines read, head <hex>` to it. §3 fixes
    what is reported, not the text; the per-problem sentence for the cut line is matched byte for byte,
    and `tests/cross-impl.test.ts` holds the reference and this implementation to the same `seq`, `head`
    and sentences on the conformance sample and the seed-1 demo, whole and cut.

82. **The dispositions, read without the reference running.** RFC 0034 amendment 1 (2026-10-08) adds
    `dispositions` to `signed-day/v1` and says what a reader does with an entry it does not expect
    ("keeps the valid entries and never fails on the rest"), how `day` marks a disposed line (a tick,
    a cross, a dash, an arrow "on the row of the line") and how `show` counts them. The validation
    messages are not in the RFC; they are the reference's `signing.validate`, and this implementation
    reproduces them word for word (`tests/signing.test.ts`) so that a line one refuses the other
    refuses in the same sentence, the rule the catch-up of 2026-10-13 was held to. No conformance
    fixture carries a disposition (the RFC says so: the heads recorded before amendment 1 stand),
    and the reference's own environment could not be installed where this port was made (its
    `uv run` needs PyPI, which the work was not allowed to reach), so the text form of a disposed
    day — `  all day       → Boat week`, `  unplaced      10:00  note   ✓ Send the mooring photos by
    Friday.`, the symbol before the title on the event, transcript, note, mail (any of the thread's
    lines), call, keeper, flight and unplaced rows and nowhere else — is matched to the reference's
    `day.rows` and `_entry_rows` as read, not as run. The RFC should give one example row per kind,
    or a fixture under `conformance/` with a signature that disposes of a line, so a second
    implementation is held to output and not to source. The same reading found two rows this
    implementation printed differently and now prints as the reference does: several all-day
    entries are joined with `, `, and an all-day, event or unplaced row that several sources carry
    ends in ` · ×N sources`.
83. **The settings files are validated in the reference's words, and where Python is looser.** SPEC §1
    names `places.json`, `assets.json` and `policy/` and says nothing about what a reader does with a
    malformed one. The reference refuses the record naming the file (`stays.SettingsError`,
    `PlaceError`, `AssetError`, `policy.PolicyError`), and `day`, `days`, `trips`, the rollups and
    `people` stop there; this implementation read a malformed file as its defaults, so the two
    printed different days of the same record. It now refuses the same files with the same sentences
    (`tests/settings.test.ts`, `tests/policy.test.ts`). Three places Python's dynamic checks are
    looser than the spec's wording, not copied here on purpose: `max_tier: true` passes `in (1, 2, 3)`
    in Python (a bool is an int) and reads as tier 1, refused here; `float("59.9")` makes a string
    coordinate numeric, which is kept (a numeric string is accepted) but `float(True)` is not; and
    `date.fromisoformat` and `time.fromisoformat` accept more spellings than `YYYY-MM-DD` and `HH:MM`
    (`20261231`, `22`), refused here. The reference also writes the default `policy/owner.json`,
    `policy/import.json` and `policy/crossing.json` into the record the first time a reader needs
    one; a reader here writes nothing and reads the same default in memory. The spec should say
    that a reader MUST refuse a malformed settings file, and what a reader MAY write.
    *Moved 2026-10-21.* The default of `policy/crossing.json` is `{"mcp": {"max_tier": 1}}` and
    nothing else since the reference's #348 (d7f9884; ADR 0016's amendment of that day), learned
    from its changelog fragment, the ADR and docs/; `hermes` is an entry the owner writes. This
    implementation reads that default although `REFERENCE` still pins b82a11c, which writes
    `{"hermes": {"max_tier": 2}, "mcp": {"max_tier": 1}}`: no cross-implementation test reads a
    record without the file, and the catch-up that moves `REFERENCE` past #348 is its own PR.
84. **The policy's write keys, read by a reader that cannot use them.** ADR 0022 and RFC 0034 amendment
    3 (PR 252, `feat/mcp-write-tools`, not merged at 2026-10-13) put two keys on the `mcp` entry of
    `policy/crossing.json`: `write`, the tools the owner allows through the MCP door by name
    (`sign_day`, `note_day`), and `write_window_days`, how far back they may write (60). They are
    read and validated here as the reference's `policy.mcp_door` reads them, with its sentences, so
    that a policy file one implementation refuses the other refuses; nothing here serves MCP, signs
    or writes a note through a door, so `mcpDoor` is a library reader and a test, never a gate on
    anything. The keys are the reference's, documented in docs/mcp.md and ADR 0016's amendment and
    not in SPEC.md; a `note_day` line is a `note/v1` line with `source: mcp` and `labels: [kind]`
    (`note`, `proposal` or `reflection`), which every reader here reads as any note (RFC 0010 added
    `labels` on 2026-10-01). Whether the policy's keys belong in the spec's §1, or stay the
    reference's own, is for the spec to say; until then this implementation follows the reference.
85. **Order within a month file, and what `verify` holds.** SPEC §3 orders the lines by `seq` wherever
    a line was found and says file order is not chain order; it says nothing of the order *within* a
    file. A writer appends, so every month file it leaves is in `seq` order, and a verifier that relies
    on that can merge the files and hold one line per file instead of the record: the reference's
    `Logbook.lines()` does (its #28; docs/line-to-day.md, *Verify streams*), and so does this
    implementation now. A file out of order is still valid by §3, so both read such a record again
    sorted, keeping where each line lies rather than the line. Run on records built for it (a backfilled
    month, March lines in the January file, a file out of order, one `seq` given twice in one file and
    across two, a gap), the two agree on valid and on the head. Two differences the probes found, neither
    new: on a record whose lines are not a chained prefix the reference's `M lines read` is the last
    line's `seq` (6, for six lines with one of them given twice) and this implementation's the number of
    lines chained (7), where §3 asks for "the `seq` and `head` … of the lines it read" and only a chained
    prefix makes the two the same; and a line whose `seq` is a string (`"3"`) sends the reference's merge
    to its sorted read, which stops with a Python `TypeError` in place of a report, where this
    implementation reports `seq must be an integer ≥ 1` and passes the line by. Suggest §2 make `seq`
    order within a file a writer's obligation that a verifier MAY rely on, as placement is for readers,
    or say that it MUST NOT; and §3 say whether the `seq` reported is a count or the last line's `seq`.

## Found while porting RFC 0036, goals, reviews, drafts and chapters (openlogbook main at f6bb65b, 0.6.1, 2026-10-13; docs/rfcs/0036-goals-reviews-drafts-chapters.md, rfcs/0036-*.md, and amendment 1 as PR 269 proposes it)

The RFC was read, and the reference was run, never read: on the conformance sample with `day_start`
set to each value below, on synthetic records carrying the RFC's example lines, and on a draft of a day
varied field by field (`tests/cross-impl.test.ts` repeats those runs). Everything here is behind the
`rfc0036` flag, off by default; each entry says what this implementation does until the answer comes.

86. **`day_start`: who refuses, in which words, and from when.**
    a. RFC 0036 says a reader that does not implement it MUST refuse a record that sets `day_start`.
       Does that bind a conformant reader while RFC 0036 is a draft, or from the day it is Final? With
       the flag off this implementation reads such a record by the calendar day, as every reader before
       the RFC did; with it on, it refuses.
    b. Which commands group lines by day? The reference refuses `show <day>`, `day`, `show days`,
       `show trips`, `rollup`, `people`, `show stats`, `show keepers`, `digest`, `export --day` and
       `doctor sources --gaps`, and not `verify` or `doctor sources`. `stats` counts per local year
       and month rather than per day: is it meant to refuse? This implementation follows the list as
       run (`stats` refuses).
    c. The reference reads `"day_start": null` as absent (midnight). Should the RFC say so, beside
       "absent, it is 00:00"?
    d. The reference's sentence says the value "is not a clock", which is false for `"06:00"`. What
       does a reader that parses the value but does not implement the boundary say? docs/settings.md
       says such a reader "must refuse in the same way": the same exit status and the same naming of
       the key and the value, or the same sentence? This implementation says `logbook.json has
       day_start '06:00', and this implementation does not yet put a line on a day by it; a reader
       that groups lines by day refuses rather than guess (RFC 0036)`, exit 2, prefixed with the
       command as the reference prefixes its own.
    e. May an implementation apply the boundary in some readers (say `show` and `day`) and refuse in
       the rest, or must it adopt it in every reader at once, as the reference did? This one applies
       it in none yet and refuses in all of them.
    f. Is `<command>: <sentence>` with exit 2 part of what a second implementation must match, or only
       the sentence?

87. **`localDayOf` and the edges of the rule.** The rule compares the wall clock after localising, so
    `02:30` on the night the clocks go back is before `06:00` both times (both on the day before), and
    this implementation reads it so. Two edges the RFC does not settle: (a) is "today", for `/today` and
    for `signed_within_days`, the local day of now by the same rule (at 05:59 with `06:00`, still
    yesterday)? (b) A day's span is "from `day_start` on the date to `day_start` on the next": on the
    night the clocks go forward, a `day_start` the clock skips (`02:30` in Oslo on 2026-03-29) begins
    the day at the first instant whose clock reads at or after it (`03:00`). Is that the reading?

88. **`goal/v1`, `review/v1`, `chapter/v1`: the refusal sentences, and what a reader checks.** The
    reference has no check for any of the three yet: `show` prints a goal's text, a chapter's name and
    a review as `key=value`, and amendment 1's writers (`goal add`, `goal review`, `chapter open`,
    `chapter close`) are specified, not implemented. The sentences here are this implementation's
    (`tests/goals.test.ts`, `tests/chapters.test.ts`), and change to the reference's when it has some.
    a. What will the writers' refusals say, word for word? Will a reader check these profiles at all,
       or only the writers?
    b. The RFC's *What a Day page shows* has `show` print `goal  <text>  (year, from 2026-01-01)`,
       `review  let go · month · <goal text>` and `chapter  The Lofoten summer  2026-06-20 –
       2026-08-09`; the reference prints `<text>`, `goal=…, disposition=let go, period=month, note=…`
       and `The Lofoten summer`. Which is meant? This implementation prints what the reference prints.
    c. Is a `text` or a chapter `name` of blanks only "empty"? (Here: yes.) Is a goal's `until` before
       its `from`, or a chapter's `to` before its `from`, a malformed line, or only a writer's refusal?
       (Here: both.)
    d. The review key `(goal, period, at)`: is `at` compared as the instant (`2026-08-31T20:00:00Z` and
       `2026-08-31T22:00:00+02:00` one date) or as written, and `goal` as written or resolved to its
       chain? (Here: the instant, the id as written.)
    e. Rule 4 (an `at` not more than five minutes after the writer's clock, not before the goal's
       `from`): is it held against a line already in the record, by `recorded_at` and the record's
       zone, or only by a writer? (Here: `reviewRecordProblems` holds a line to it.)
    f. When the line that rewords a goal, or closes a chapter, is retracted, does the earlier line stand
       again? Rule 4 of `chapter/v1` speaks of "a retraction that reopened one", and RFC 0034 rule 3
       says so of a signature; the goal's rule 2 says "not named in a later goal's `supersedes`", which
       a retracted line still does. (Here: it stands again.)
    g. `chapter close` writes the same `name` and `from` as the open chapter it supersedes, which is the
       key of rule 1. Is a line that supersedes the line holding its key exempt from the dedupe? (Here:
       yes, and it holds the key from then on.)

89. **`draft/v1`: the reference's reader against the field table.** The reference's Day checks five
    fields as it reads a day's draft, and this implementation says the same in the same order:
    `read_head must be the record's head, 64 lowercase hex characters`, `read_count must be how many
    lines of the unit the model read`, `language must be a BCP 47 tag, en or nb`, `segments must be a
    non-empty list` or `segment N is malformed: a segment is {text, evidence} or {text, unsupported:
    true}, nothing else`, and `supersedes must be the id of the earlier draft`.
    a. It names the first malformed segment only, though each malformed segment is shown unsupported
       with the same reason. Should a reader name every one? (Here: the first, as the reference.)
    b. It does not check `unit`, `subject`, `source`, `end`, `window` or `read_policy`. Should a reader
       say a draft whose `source` is not `model:<name>`, or whose `subject` is not in its unit's form, is
       malformed? `draftProblems` here holds the whole field table, in its own sentences; `readDraft`'s
       `malformed` holds only the reference's five.
    c. "A BCP 47 tag": the reference accepts two or three letters, then subtags of two to eight
       (`en`, `EN`, `nb-NO`, `zh-Hant-TW`, `de-CH-1996`) and refuses `x-private`, `i-klingon`, `en-a`
       and `english`. Is that the subset the RFC means?
    d. `supersedes: ""` and `supersedes: null` are malformed to the Day, while `show`'s row treats them
       as absent (no ` · supersedes an earlier draft`). Which reading is meant?
    e. `show` exits with a Python `TypeError` on a draft whose `subject` is an array holding a
       non-string (`["a", 5]`); this implementation prints `a, 5`.
    f. A segment resting on a line not of the unit says `evidence names a line that is not on the day`.
       What does it say for the other units? (Here: `… not on the <unit>`, and for a person amendment 1's
       wording, `… not one of the person's lines in the window`.)
    g. A segment whose `text` is not a string is shown as Python's `str()` of it (`5`), and an empty one
       as `(no text)`. Should a reader show a malformed segment's text at all?
    h. The tier: every line a segment cites was read, so a draft's tier is never below the highest of
       them (`draftTierProblems`). Should a reader check that, and what does it do with a draft that
       fails it: hide it, as amendment 1 hides one above the ceiling, or mark it?
    i. A week's subject: is `2025-W53` (2025 has 52 ISO weeks) malformed? (Here: yes.) And a day's
       subject is "the local day": by `day_start`?
    j. Amendment 1: is a `window` on a draft of another unit malformed, or ignored as the reference
       ignores it? Is `read_policy.max_tier` 0 to 3 ("its ceiling as it counted then", 0 past `until`)
       or 1 to 3, since a writer refuses to read under an expired entry? (Here: malformed; 0 to 3.)

90. **`signed_within_days`: the window, the day a signature was written, and the words.** The reference
    documents the key (docs/signed-day.md, docs/line-to-day.md) but does not read it: at 0.6.1 neither
    `doctor` nor `export crossing` looks at it, and a value of `0`, `-1`, `"14"` or `true` is accepted
    silently. This implementation reads it under the flag and composes it as the RFC says
    (`dayGate`, `lineCrosses`).
    a. The window: the RFC says "from N days before today through today", N + 1 local days;
       docs/signed-day.md says "in the last fourteen days, today included", N. Which? (Here: the RFC's.)
    b. "Written on": the local day of the standing signature's `at`, the moment the owner signed, which
       RFC 0034 amendment 2 lets the owner set with `--at`, or of its `recorded_at`? (Here: `at`.)
    c. "Today" is the day of the export in the record's zone, while `until` is held against the
       machine's local date (the reference's `policy.today`). Should the two agree?
    d. What does a reader say of a value that is not a positive whole number? (Here: `<file>:
       'cloud-model' has a signed_within_days that is not a positive whole number of days; write it as
       14, or remove the key for no restriction (RFC 0036)`.) Is `null` absent?
    e. A signature whose `at` is after today (amendment 2 allows five minutes ahead), or one whose page
       no longer digests to what was signed (`page_matches` false): does it let the day cross? (Here:
       the first does not; the second is not looked at.)
    f. The header a held-back day crosses is "the day, and whether and when it was signed". Does a day
       held back by RFC 0034's default (unsigned, no `--unsigned`, no `signed_within_days`) cross its
       header too? (Here: `dayGate` says it may; the command decides.)

## Found while adding the writer lock and the repair of the tail (openlogbook main at 7bcf728, 0.6.1, 2026-10-15; docs/commands.md "One writer at a time", docs/recovery.md "The files ahead of logbook.json", its docs/SPEC-QUESTIONS.md 83, its #294)

The reference was run, never read: on copies of the conformance sample with locks planted by hand, under
`strace`, and with `logbook.json` set back by hand. Two probes of its `add` on malformed input (a pid too
large for a C long in the lock, a `seq` that is a string in `logbook.json`) stopped it with a Python
traceback; those inputs were not pursued and nothing here is drawn from the lines the tracebacks printed.

91. **The writer lock is not in the spec.** docs/commands.md says a command that appends holds
    `state/writer.lock` in the record folder for its whole run, that a second writer waits (`another
    logbook command is writing to this record (<command>, since <time>); waiting`) or with `--no-wait`
    refuses with exit 2, that a lock whose process is gone is taken over with one line saying so, that
    readers never take it, and that the guard behind the courtesy is a writer reading `logbook.json` again
    before every batch and writing nothing when the head has moved. SPEC.md says none of it, and a second
    implementation on the same folder has to honour the same file or the courtesy is one-sided.

    What running the reference shows. It writes `{"pid": 618, "command": "add", "since":
    "2026-10-13T13:25:40Z"}` (`"repair tail"` for that command) and removes `state/` when nothing else is
    in it. It makes the lock in two steps, `open("state/writer.lock", O_CREAT|O_EXCL)` and then the
    write, so for a moment the lock is there and names no holder. Finding a lock, it reads it, and every
    half second reads it again:
    - A JSON object names a holder, whatever is in it. A holder whose pid is a living process is waited
      for, however old its `since` (a lock dated 1999 still is: there is no age threshold), or refused
      under `--no-wait`. One whose pid is gone, is not a number (`"x"`, `"123"`, `1.5`, `[1]`, null,
      missing), is 0 or negative, or is the writer's own pid (a crashed writer's pid given again, as in a
      container; run as pid 1 in a pid namespace) is taken over: `a stale lock from add (pid 1, since …)
      whose process is gone; taking it over`. A field that is missing prints as `?`, JSON null as
      `None`, anything else as Python's `str()`: `{}` is `a stale lock from ? (pid None, since ?) …`,
      `{"pid": [1], "command": ["a"], "since": {"x": 1}}` is `a stale lock from ['a'] (pid [1], since
      {'x': 1}) …`. `true` is the int 1 to Python, so `{"pid": true}` is waited for while pid 1 lives.
    - A lock that names no holder (empty, cut short as `{"pid": 12`, not JSON, spaces, `null`, `[1]`) is
      read again after one sleep of half a second (`clock_nanosleep`, monotonic). If it names a holder by
      then, that holder is honoured as above; if it still names none, it is removed without a word and
      the writer takes the lock, under `--no-wait` too (exit 0, the line written). The half second runs
      from the writer's first read: the lock's mtime and inode are not looked at — an empty lock dated an
      hour back, one dated an hour ahead, one touched during the half second and one replaced by a new
      empty file during it are all removed after the same half second.

    This implementation writes and reads the same file (`command` is `logbook-ts add` or `logbook-ts
    repair tail`, so the reference's message names the other program) and prints the same sentences, and
    differs in three places:
    - It makes its own lock in one step: the holder written and fsynced to a temp file in `state/`, then
      hard-linked to `writer.lock`. `link`, like `O_EXCL`, fails when the name exists, so the two
      implementations still exclude each other, and no reader finds this one's lock empty; a rename would
      replace a lock that is there. Where the filesystem cannot link it falls back to the reference's two
      steps.
    - An empty lock (rule A; the owner's decision of 16 October, which replaces that of 15 October): the
      reference's rule alone. A lock that names no holder is a leftover of a crash once the same file —
      its bytes, inode, size and mtime, read on one handle — has named no holder on every read for half a
      second; it is removed then without a word and taken, under `--no-wait` too. Its mtime is never read
      as its age. The decision of 15 October had asked for both, the reference's half second and an mtime
      half a second past; it was dropped because an empty leftover dated ahead of the clock (another
      machine's clock, on a shared folder) then held every writer here until that clock was passed, while
      the reference took it at once, and an mtime says nothing a writer can trust about who made the file
      or when. What is left of the difference: a lock replaced or touched during the half second starts
      it over here, where the reference removes it all the same after its one sleep, since a file that
      changes is someone writing it. While the half second keeps starting over the writer says, once,
      `another logbook command is taking the lock on this record (state/writer.lock names no holder yet;
      if none is running, remove it); waiting`, and under `--no-wait` refuses with that sentence (exit 2).
      One mtime is still read, and not as the age of a lock that names no holder: a reclaim file (this
      implementation's own) naming this process's pid is another thread's when it is dated since this
      process started, and a leftover of an earlier process given the same pid when dated before. The
      reclaim file holds a pid and nothing else, no `since`, so its date is all there is to tell the two
      apart; one dated ahead by another machine's clock is waited for, with one line after half a
      second, by a process given that pid, and refused under `--no-wait`. The removal is a compare-and-remove under a second
      exclusive file (`state/writer.lock.reclaim`, this implementation's own, the same that guards the
      takeover of a dead holder's lock), the lock read again on one handle and its bytes, inode, size and
      mtime compared right before the unlink; `taking it over` is said once it is taken over. An empty
      reclaim file is held to the same half second; one naming a living pid (a reclaimer stopped, or a
      crashed one's pid given to another process) is waited for after half a second with `another
      logbook command is taking over a stale lock on this record (state/writer.lock.reclaim names pid
      N); waiting`, or refused under `--no-wait`. A reclaim file a crash leaves stays, and keeps
      `state/` from being removed, until a writer here clears it; the reference leaves it alone.
    - A lock naming this process's own pid is a leftover, as the reference reads it, only when its `since`
      is before this process started; one dated since then may be held by another thread of this process
      and is waited for. A `withWriterLock` inside another on the same record, in one thread, is refused
      (`LogbookError`) instead of waiting on itself.

    What is left open: a writer that makes its lock in two steps and is held between them for more than
    half a second loses it under rule A, in either implementation, as the reference's own rule has it.
    This implementation's two-step fallback notices (the file it wrote its holder into has no name any
    more: its links are down to none, or, once it is closed, the lock's name is another file, a file
    naming another holder, as when a freed inode number is given again, or none) and waits on the
    writer that took the lock; the reference's writer, run so, goes on beside the other, and only the
    head re-check stands between them. The name is read once the file is closed because Windows before
    libuv 1.49 (Node 20) keeps a removed file's name, delete-pending, with one link, while a handle
    holds it; there the writer that removed such a lock cannot read the lock again until the stalled
    writer closes it, and refuses, `cannot read the writer lock (EPERM …)`, after the five seconds
    Windows' refusals are retried, with nothing written. A two-step writer that writes its
    holder in the instant between another's last read and its unlink is caught here only when that
    unlink comes before its own check that its file still has the name; the reference's writer makes
    no such check.
    And a lock left by an earlier process given this pid, written in the second this process started,
    reads as another thread's (`since` has seconds only) and is waited for; the message says to remove
    it if no writer is running.

    Suggest a paragraph in SPEC §3 beside *Write order*:

    > **One writer at a time.** A writer holds `state/writer.lock` in the record folder for the whole of
    > an append: a JSON object with the holder's `pid`, `command` and `since` (RFC 3339 UTC). It creates
    > the file exclusively and SHOULD create it whole, its holder written to a temporary file and
    > hard-linked into place. A lock whose `pid` names a living process other than the reader is waited
    > for, or refused; one whose `pid` is not a positive integer or names no living process is taken over.
    > A lock that names no holder (empty, or not a JSON object) is a writer between its create and its
    > write: it MUST NOT be taken over until it has named no holder for 0.5 s (an implementation MAY
    > also require it unchanged over that time); after that it is a leftover of a crash and MAY be
    > removed and taken. Its modification time is not its age and MUST NOT keep a leftover from being
    > taken. A writer MUST read
    > `logbook.json` again under the lock before it writes and write nothing if the head has moved; the
    > lock is a courtesy, the re-read is what keeps the chain whole. Readers never take the lock.

92. **Who brings `logbook.json` forward after a crash, and on what check.** SPEC §3 says a crash leaves the
    files ahead of `logbook.json`, "any lines past its `seq` are a complete, chained tail", and that `verify`
    reports the record invalid "until `logbook.json` is brought forward" — by whom it does not say. The
    reference answered it in its #294 (975229d, 2026-10-14; docs/recovery.md, *The files ahead of
    logbook.json*; its docs/SPEC-QUESTIONS.md 83, which names this question and an earlier version of
    this implementation's answer): every writer refuses while the files end past `logbook.json`, and an
    explicit command brings it forward. This implementation now does the same (the owner's decision of 15
    October); it no longer brings `logbook.json` forward itself during `add`.

    Run on the sample with a line added and `logbook.json` set back one:
    - `add` exits 2 and writes nothing: `` add: the files are ahead of logbook.json: they end at seq 33 head
      d807cbcf26fc…, logbook.json says seq 32 head 58bfa9e704e3… (a crash between a line and logbook.json,
      SPEC §3); nothing was written: run `logbook repair tail` ``; with the files ending at the seq
      `logbook.json` names under another head, `` add: the files do not end where logbook.json says: they
      end at seq 32 head 58bfa9e704e3…, logbook.json says seq 32 head aaaaaaaaaaaa…; nothing was written:
      run `logbook repair tail` ``; with a month file cut inside its last line, `` add:
      logbook/2026/10.jsonl line 2: the file ends inside this line (cut short); nothing was written: run
      `logbook repair tail` ``. A lag whose tail is wrong (a hash, a `prev`, a second line of one seq)
      gets the first sentence: its `add` looks at where the files end and no further.
    - `repair tail --dry-run` exits 0 and writes nothing: `logbook.json says seq=32 head=58bfa9e704e3…; the
      files hold 1 line past it, each verified (envelope, seq, prev, hash):`, one row per line past the head
      (`  seq 33  logbook/2026/10.jsonl line 1  hash d807cbcf26fc…`, the first twenty, then `  … and 12 more
      lines`), `would set logbook.json to seq=33 head=d807cbcf26fc…, and build no index (…)` and `nothing
      written — run without --dry-run to repair`. `repair tail` prints the same rows, `logbook.json: seq 33,
      head d807cbcf26fc…; no index (…)` and the verdict of `verify`, exit 0. On a record that verifies, both
      say `nothing to repair: the files end where logbook.json says, seq=33 head=d807cbcf26fc…`, exit 0.
    - It refuses with exit 2 and `nothing was changed`: the files ending before `logbook.json` (`…: the
      files are behind logbook.json, which no crash leaves (SPEC §3); restore the month files from a backup;
      nothing was changed`), the files ending at its seq under another head (`` …: no line is past the head
      and the head is not the files'; run `logbook verify`; nothing was changed ``), and a line past the head
      that does not verify, named by its place in the chain (`repair tail: line 34: hash does not
      recompute; id …; nothing was changed`; `prev does not match previous hash`; `seq 33 expected 34`) or,
      for a file cut inside its last line, by file and row. The writer lock is held throughout, the dry run
      included: under `--no-wait`, `repair: another logbook command is writing to this record (…); --no-wait,
      so not waiting`, exit 2.
    - It checks only the lines past the head before it writes: with line 10 changed and a lag of one, the
      repair sets `logbook.json` forward and then prints `INVALID — 1 problem(s) after the repair; …` and
      exits 1.

    This implementation's `repair tail <root> [--dry-run] [--no-wait]` prints the same lines and exits
    with the same codes, and differs where it must or where it is safer:
    - It verifies the whole chain, streaming it as `verify` does (one line per month file held, the rows
      listed being the first twenty), before it writes anything, and refuses a record with any fault in
      the files, before the head or past it; the reference's line-10 case is refused here with `nothing
      was changed`. The owner's decision says "after verifying the chain", and a record that is wrong
      somewhere else is not the crash this command mends.
    - A line that does not verify is named as this implementation's `verify` names it (`repair tail:
      logbook/2026/10.jsonl line 2: seq 34 — hash … does not recompute (got …); nothing was changed`), as
      the reference names it as its own `verify` does; the two `verify`s word a line differently already.
      A first line past the head whose `prev` is not the head `logbook.json` names is said as `verify`
      would say it with that head as the previous hash.
    - It keeps no index, so the index clauses are left out (`would set logbook.json to seq=33
      head=d807cbcf26fc…`, `logbook.json: seq 33, head d807cbcf26fc…`).
    - Its sentences name its own program, `` run `logbook-ts repair tail` `` and `` run `logbook-ts verify` ``,
      as its lock names `logbook-ts add`.
    - It refuses a `logbook.json` whose `seq` is not a whole number from 0 or whose `head` is not 64 hex
      digits, which names no line to bring forward from, before it takes the lock, so a folder that is no
      record gets no `state/`; the reference, given a `seq` that is a string, says there is nothing to
      repair, and given a head of three digits, its same-seq refusal.
    - `add` refuses in the reference's one sentence and exit 2 (`TailAhead`, said as a moved head is,
      but not a `HeadMoved`, since reading the head again does not mend it) where the
      reference's `add` does — a month file cut inside its last line; the files ending, at their last
      line's `seq` and hash, past `logbook.json` or at its `seq` under another head — whatever else is
      wrong with the record. Anything else that does not verify is refused as before, every problem
      listed, exit 1, where the reference's `add`, looking no further, appends: to a record wrong in the
      middle, and to one whose files end *before* `logbook.json`, past the gap.

    Suggest SPEC §3's *Write order* end: "A writer MUST NOT append while the files end past `logbook.json`,
    or at its `seq` under another head; bringing `logbook.json` forward over a tail is a repair, made only
    after every line past the head verifies from it, and never by an append." — the fork it prevents is
    the one the reference's #294 found.

## Found while catching up with the reference at 7bcf728 and porting RFC 0038 §2 (openlogbook main at 7bcf728, 2026-10-15; docs/day.md, docs/goals.md, docs/speakers.md, rfcs/0038-speakers.md, rfcs/0004-transcript-v1.md's amendment of 2026-10-14)

The reference was run, never read, on probe records written with its own `Logbook.append` and its
persona helpers; every rule below is what it printed. Since this implementation last caught up
(2026-10-14, about dbc4b70) the reference also changed the Day (the Night line, #288; a draft shown only
under the crossing policy's `dream` entry, #273) and RFC 0036's rows in `show` (#275), and the
cross-implementation job failed on those until they were read here too.

93. **The Night line (docs/day.md since 0aeacdb).** What the reference does, which docs/day.md does not
    all say:
    a. The stages read are those that *start* from the day before (local midnight) to the day's end, so
       a night that goes on past midnight is a night of the day it began on as well, cut at the day's
       end: stages 22:00–23:30 on the 1st and 01:00–03:00 on the 2nd give the 1st `slept 22:00–23:30`
       and the 2nd `slept 22:00–03:00`. docs/day.md says a night "belongs to the day its last stage
       ends in … never split". Is the first reading meant? (Here: as the reference.)
    b. Of two nights or two devices equally long, the device first by name (code point, a device-less
       stage as the empty name) and then the earlier night is shown. Is that a rule or an accident?
    c. A stage with no `end` is an instant, one whose `end` is before its `at` is none; a stage ending at
       local midnight ends on the day that begins then.
    d. Minutes are rounded half to even, so 30 s is `< 1 min` and 90 s `2 min`; a night under half a
       minute is `< 1 min`, and so is a day's training of zero length.
    e. Training is shown only beside a night: a day with workouts and no night has no row, and its
       workouts are not counted under `health` either (`health no lines`).
    f. The health row no longer says the sleep, and a day whose health lines are only sleep, or only a
       heart rate variability, has no health row at all; `health no lines` is printed only when the
       JSON's `health` is null.
    g. `hrv` given in `s` is read as ms (×1000); any other unit, `ms`, `min`, `S` or none, as given.
       This implementation read every unit as given before; it was found by probing, not by a fixture.
    h. The JSON's `health` keeps the night's sleep by the older rule (the asleep stages that end on the
       day, per device, the longest), and on a tie its `lines` are the stages of the device whose first
       stage comes first in the record, by `seq`, while the Night line's tie goes to the device first by
       name (b). Two rules for one night: which is meant? (Here: each as the reference; this
       implementation took the device that fell asleep first until the independent review found it.)

94. **RFC 0036's rows in `show` (#275, docs/goals.md, *On the Day*); 88b answered.** The reference now
    prints the rows RFC 0036 described: a goal `<text>  (<horizon>, from <from>[, until <until>])`, a
    review `<disposition> · <period> · <the goal's current text>`, a chapter `<name>  <from> – <to>`,
    and the day's chapter in the heading. As run:
    a. A missing field reads `None` (`Goal two.  (None, from None)`); `until` and `to` are left out when
       falsy, and the chapter row loses the trailing space of an open chapter (`2027-03-01 –`).
    b. ` · superseded by #N` names the latest standing goal (chapter) that names it in `supersedes`; a
       retracted one replaces nothing, and a line of another kind never marks a goal.
    c. A review of a goal not in the record, or of a retracted one, prints `goal <id>`; the goal's
       current text follows the chain of standing rewordings to its end.
    d. The heading's clash names the other chapter (`· chapter Clash, clashes with Winter`). With three
       chapters on one day, are the others joined with `, `? (Here: yes; not seen.)
    e. The Day's own RFC 0036 parts (the chapter in its header, the `reviews` row, the `goals`,
       `chapters` and `reviews` keys, a draft's `proposals`, `draft_withheld`, `syntheses`) are not read
       here yet; no fixture of the Day has such a line.

95. **A transcript's voices (RFC 0038 §2, RFC 0004's amendment), as the reference reads them.** Behind the
    `rfc0038` flag here.
    a. Readers are lenient: a voice is an object whose `label` matches `^[^#\n]{1,64}$` (in code points:
       64 emoji are a label); `seconds` is any number of 0 or more (a boolean is none, though a boolean
       `extra.duration_s` is read as 1 or 0); a `name` of whitespace only is none, and a name is kept
       unstripped; only `from_me: true` is the owner. Two voices with one label are both shown. Is
       that the reader the RFC means, given that its schema forbids every one of those lines?
    b. `diarization` is MUST when `speakers` is present, but no reader checks it: a line without it
       shows its voices. Should a reader refuse to show voices without it? (Here: as the reference.)
    c. The reference has no validator for the two fields at run time; `schema/transcript-v1.schema.json`
       is checked by its tests only. So none is here, and nothing refuses a malformed voice.
    d. A line a transcript supersedes is `superseded by #N` in `show`, whatever its kind (a note heard
       as a recording is marked), but only when the transcript is not retracted, while a line a
       *retracted* flight supersedes is still marked (`superseded by #6` beside `retracted #6`). Is the
       difference meant?
    e. The Day leaves out only a transcript superseded by another transcript *of the same day*: a
       recording heard again the next day leaves the first listed on its own day, though `show` marks it.
       A superseded transcript's line still counts in the day's `sources`, and the transcripts left out
       are not evidence of who was there.
    f. `person` is always null and `basis` is `channel` only for the owner's voice: RFC 0038 §3's
       `speaker` resolution is not built. When it is, will a resolved voice's `name` be the person's?
    g. Numbers past a double: a `seconds` (or an `extra.duration_s`) written as a JSON integer too large
       for a float (`1` and 400 zeros) makes the reference's `show` and `day` raise `OverflowError`; here
       it is no length. Past 2^53 both print the double's exact digits (`153722867280912928 min`). A
       JSON integer past 2^53 in `extra.turns` is exact in Python and a double here, so its digits can
       differ (`…808 turns` there, `…000 turns` here). Should the profile bound these numbers?

96. **A line a flight supersedes is `superseded by #N` whatever its kind.** The reference marks a note or
    a transcript a flight line supersedes, at 7bcf728 and before RFC 0038 alike; this implementation
    marked only a flight. Fixed here, flag or not. Is a flight that supersedes a line of another kind
    meaningful at all, or should a reader refuse to let a flight replace a note?

97. **`people`, three things no fixture had shown (74 answered in part).** Found running the reference on
    `tests/fixtures/rfc0037-0038-sample`, the same before RFC 0038 (09e2967) and at 7bcf728; fixed here,
    flag or not:
    a. A transcript some line names in `supersedes` is not counted, even when that line is retracted
       (so a transcript "heard again" and then the second hearing retracted counts for nothing), and it
       is no evidence of a day together. The Day, before RFC 0038, listed both and took both as evidence
       of who was there. Should `people` and the Day agree, and should a retracted line's `supersedes`
       still hide what it names, against RFC 0003's "a retracted line counts for nothing"?
    b. One person is `1 person` (74 guessed `1 people`).
    c. The whole record's window ends on the last line of any kind, a retraction's own `at` included,
       so a record retracted from today reads to today. A retraction's `at` is when it was written; is
       it meant to stretch the window of a reader of people?

## Found while porting RFC 0037, entities (openlogbook main at 7bcf728, 2026-10-15; rfcs/0037-entities.md, docs/entities.md)

On the owner's instruction, the validators, tiers and readers of RFC 0037's three profiles and the
read-only half of `logbook status` were ported from the reference's `logbook/contrib/entities.py` and
`entity_status.py` and their tests, and the reference was run beside this one on every case
(`tests/cross-impl-entities.test.ts`). Where its code and the RFC's text differ, this implementation
follows the code, which is what a record written by the reference holds; each place is below. Everything
is behind the `rfc0037` flag where a command reads it (`status list`); the functions read a line
wherever a caller holds one.

98. **Where the reference's code and RFC 0037's text differ.**
    a. §10.2 makes `until` MUST on a status of a place or an asset and `note` MUST beside a reason
       (except an org's). The writer puts neither on the line: `until` is written into the registry
       entry of `places.json` or `assets.json` (the listing's `until` is the standing line's local day,
       never the file's), and the reason's note names the status line in its `extra.status`, written
       after it, instead of the status naming the note. `validate_status` checks neither field. Which is
       the profile?
    b. §8 holds an `entity/v1` line of a place or an asset at tier 1 (a place's at 2 when it cites a
       note), and a place's `entity-review/v1` no at 1; the code holds every `entity/v1` line at 2 and
       every no at 2 or more ("a no is a decision").
    c. §6.2's `entity-review/v1` has `type` and `name` fields, `entity` absent for a new entity, and a
       place's spot as a `point` ref; the code has the kind as `entity.type`, a new entity as
       `entity: {type}` alone, the offered name as `label`, and the spot as a `centre` ref
       (`OBSERVED_REFS` adds `name`, `centre`, `subject`).
    d. §3.2 says a ref of a kind the entity's type does not take makes the line invalid; the code takes
       any of its ref kinds for any type. §3.2 says `entity.type` is never `person`; the code takes a
       person with no refs (decision 1).
    e. §4.6 names `stale_after_days` and `personal_max_people`; the code reads `stale_days`,
       `merchant_min_lines`, `title_min_lines`, `registration_min_flights` and `mute_days`. §10.6's
       `stale_since` is not in the listing's JSON, and staleness counts the status line's day only, never
       a touch.
    f. §9's person key `name:<words sorted>` is the name folded as given.
    g. No reader, and not `verify`, checks the three profiles: only the writers do, before they append.
       Should a reader refuse, or mark, a line that does not pass? (Here: the functions say so to a
       caller; no command refuses a record for it.)

99. **What this implementation adds, and where the reference raises.**
    a. `orgReasonProblems` is this implementation's: §10.5 keeps an org's reason on its tier-3 line, and
       the reference's writer never writes a note for it, but nothing checks a record that has one. It
       names a `status/v1` line about an org that carries a `note`, a `note/v1` labelled `status` whose
       `extra.entity` is an org or whose `extra.status` names an org's status line, and a status note
       above tier 2. Should the reference say so too, and in which words?
    b. RFC 0006's walk as the reference's entity readers run it differs from `src/resolve.ts`'s in two
       places, so `entities.ts` carries its own: a `resolution`/`retraction` line counts whatever its
       schema, and a retracted line's `supersedes` leaves the line it names standing. Which is the
       rule for `show`'s names too?
    c. The reference raises where it has no sentence: an org's or an idea's id with a trailing newline
       (`ValueError` from `uuid.UUID`, after its pattern let the `\n` through), an `entity.type` or a
       `status` that is a list (`TypeError: unhashable`), `tier_problems` with an empty kind
       (`IndexError`), a `since` that is not a real day in `muted` and `stale`, an `aliases` that is a number
       (`TypeError` in its readers; here no alias is read). This implementation
       answers with the rule's sentence, or refuses naming the value (`'2026-13-45' is not a day,
       YYYY-MM-DD`). A JSON number written `2.0` is a float to Python and a whole number here, so a
       `policy/entities.json` number written so is refused there and read here.
    d. `status list` of a kind that takes no status, and `status` with anything but `list`, are
       refused: the first in the reference's words; the second, writing a status, in this
       implementation's (`this implementation does not write status lines …`), since it writes only
       notes.
    e. `status list` puts a status on its day under `day_start` (RFC 0036) whatever flag is on here,
       since the reference's listing always reads the key (a hold at 03:30 with `06:00` is `since` the
       day before), while every reader of RFC 0036 here refuses a `day_start` other than midnight under
       the `rfc0036` flag and ignores it without. Should a reader that is not RFC 0036's (an RFC 0037
       listing) read `day_start` before RFC 0036 is Final? (Here: as the reference.)

100. **`day --json`, byte for byte.** Laid out now as the reference's (two spaces, its keys in its order),
    the two `day --json` outputs on `tests/fixtures/rfc0037-0038-sample` differ only in (a) the
    `readiness` block, not read here (79), and (b) a number Python holds as a float and writes with
    `.0` (`"seconds": 30.0`, `"spent": -45.0`), which JSON.stringify writes `30`: the same number to
    every JSON reader, different bytes. Is the JSON's spelling of a whole float part of what a second
    implementation must match, or only its value? (Here: the value; the tests compare parsed JSON.)

101. **How far past the day the Day reads a stay.** Found by the checker, older than this branch, flag or
    not. A stay at one place whose next point is the next morning at the same place (points every 30
    minutes 18:00–23:00, then 09:00 the next day) is `18:00–24:00 · 6 h` in the reference, its `end`
    the next morning's point and 12 points; here `18:00–23:00 · 5 h`, 11 points, since the Day's
    window ends at the next day's night end (08:00). When a day's points end early (00:00–03:00, the
    next at 09:00 the next day at home) the reference prints `night after Home · home` and `00:00–24:00
    stay Home · 24 h`, this implementation `in transit` and `00:00–03:00 · 3 h`. docs/day.md says a
    silence the tracker ends within a short walk of the place is time there; it does not say how far
    past the day a reader looks for that end. What is the bound? (Not changed here: the window is
    the stays engine's, and every vendored Day agrees.)

102. **What a voice is (RFC 0038 §2), as reading the reference settled it.** The planner of PR #21 read the
    reference's `logbook/rows.py`, `logbook/day.py` and `logbook/core/speakers.py` (the third exception the
    README names, accepted by the owner on 2026-10-16); each point it settled is an entry here, 102–107,
    every one checked since by running the reference. A voice is an object in `speakers` whose `label`
    matches `^[^#\n]{1,64}$`, counted in code points (64 emoji are a label); anything else in the list — not
    an object, no label, a label of 65 code points, with a `#` or a line break — is passed by without a word,
    and a line none of whose voices is readable reads as a line without voices. Two voices with one label are
    both shown. The RFC's schema forbids every one of those lines; is a reader meant to show what it can, as
    the reference does, or to refuse the line? (95a asks the same of the fields.)

103. **Who a voice is.** `you` when, and only when, the voice's `from_me` is the JSON `true` (`1`, `"true"`
    and a missing `from_me` are not the owner); else its `name`, unless absent, not a string, or whitespace
    only, and kept as written, unstripped; else its `label`. RFC 0038 §2 names the fields, not which of them a
    reader prints. Should the spec say so, and say whether a resolved `speaker` (§3, not built here or, at
    7bcf728, there) comes before the `name`?

104. **How long a voice spoke, and a transcript's length.** A voice's `seconds` is any JSON number of 0 or more
    (a boolean is none, a negative is none); a transcript's `extra.duration_s` the same, except that a boolean
    is read as Python reads it, 1 or 0. Under a minute it prints as seconds (`2 s`), else as minutes
    (`3 min`), each rounded half to even as Python's `{:.0f}` rounds, every digit printed. Nothing in the
    spec or RFC 0038 says how a reader prints a length. Is this the rendering a second reader must match,
    or is it the reference's own? (95g asks about numbers past a double.)

105. **Where the voices go in `show` and the Day.** In `show`, after the transcript's title, its people and its
    length: `Samtale · you 3 min · Ola Nordmann 3 min`; the writer's `turns` are left out beside them. In the
    Day, the same after an attached or an unplaced transcript. Under `day --json`, `speakers` is a list of
    `{label, person, name, seconds, basis, consent, owner}`, present only on a transcript with a readable
    voice; `person` is always null and `basis` is `channel` only for the owner's voice (95f). Should
    docs/day.md and RFC 0038 fix the row and the keys, so a second reader is held to them by the spec and
    not by the reference's output?

106. **A recording heard again.** `show` marks every line a standing transcript names in `supersedes`
    `superseded by #N`, whatever that line's kind, and not when the transcript is retracted; the Day leaves out
    only a transcript another transcript *of the same day* supersedes, still counts its line among the day's
    sources, and does not take the transcripts it leaves out as evidence of who was there (95d, 95e). RFC 0004
    says a transcript may supersede a line; it does not say what a reader shows of the line superseded, in
    `show` or in the Day. Which is meant?

107. **No check of the voices at run time.** The reference holds `speakers` and `diarization` to
    `schema/transcript-v1.schema.json` in its tests only: nothing refuses a malformed voice when a line is
    read or written, and a line with `speakers` and no `diarization`, which the RFC makes a MUST, shows its
    voices (95b, 95c). This implementation does the same, and so refuses nothing either. Should a writer
    refuse such a line, and a reader say so?

## Found while catching up with the reference at 0.7.0 (openlogbook 0.7.0, tag v0.7.0 at b82a11c, 2026-10-18; its docs/SPEC-QUESTIONS.md, docs/rfcs/0034-the-signed-day.md amendment 4, rfcs/0006, 0024, 0030, 0037, 0038, 0040 and 0041)

Read from the format's documents at b82a11c only, and from running the reference at that commit and at
7bcf728 on synthetic records; no source was read.

108. **A line superseded twice, answered (the reference's #321).** The reference decided on 18 October 2026
    that a line is superseded while at least one line *of its kind* that is not retracted names it in
    `supersedes`; a retracted superseder supersedes nothing, and a superseder superseded in turn still
    supersedes. It proposes the sentence for SPEC §3.2. This implementation follows it wherever it asked the
    old question: `show`'s marks and `people`'s transcripts and calendar entries (`isSuperseded`, keyed by
    kind, so a note naming a transcript no longer hides it from `people`), a flight's mark (the last flight
    that names the line and is not retracted, any kind of line still marked, 96) and the Day's flights, and
    the resolver (a name whose correcting lines are all retracted stands again). This answers 97a, 98b, the
    retracted flight of 95d and the retracted transcript of 106. Held by nineteen cases, the six rows of the
    reference's table among them, against the reference (tests/superseded-cases.ts).

109. **The hero and a retracted keeper's `supersedes`.** RFC 0024's amendment of 2026-10-14 reads
    `supersedes` for keepers and takes the standing ones "as SPEC §3.2 defines *standing*". The reference's
    `show` leaves out of its `hero` line a keeper another keeper of the day names in `supersedes`, and does so
    when that keeper is retracted too, so a photo whose new note was unstarred has no hero at all; its Day
    lists every keeper, superseded or not, under the row. This follows both, against 108. Should a
    retracted keeper's `supersedes` count for nothing here as everywhere else, and should the Day list the
    standing keepers only?

110. **One flight per carrier, number and date in the Day.** The reference's Day lists one flight of the
    same carrier, number and date, the line latest by seq, whether or not one names another in
    `supersedes`, and keeps one of two flights whose times overlap; this implementation lists each flight
    that no standing flight supersedes. It was so at 7bcf728 too and RFC 0013 does not say it; it is not
    changed in this catch-up, and its case in tests/superseded-cases.ts gives the declared flight another
    number. Which flights does the Day list?

111. **`show` and the Day on a page that no longer digests.** On a record whose standing signature's
    `page.sha256` is not the page's, the reference's Day says `, the page has changed since` and its `show`
    does not; this implementation says it in both. It was so at 7bcf728 too, with or without stars on the
    page, and is not changed here; tests/marks-cases.ts signs over the page as it stands. Which reader is
    right?

112. **Who spoke (RFC 0038 §3), as running the reference shows it.** The owner's voice, `from_me` with no
    line or bound to the owner, is the owner's: `person` the record's `owner_id`, `name` null, `consent` the
    line's or null. A voice bound to a person gives its `basis` as the line has it and `consent` the line's or
    `unknown` (absent or not one of the three); a person without a label shows the voice's label in the Day
    and the person's id in `people`. An unnamed voice has `person` and `name` null and a basis; the Day
    counts it (`1 unnamed`) and never names it, `with` counts the unnamed people (distinct ids) and `people`
    says `and N unnamed`; a voice whose line is an `alias_of` one that is unnamed is unnamed too. The Day says `recorded with consent: no` when a voice that is not the owner's was
    bound with `no`, else `unknown` when one was bound without `yes`. A voice bound to a person is company at
    a stay ahead of the participants, confidence 1 when asserted and the line's for `text`, one evidence with
    a participant of the same person, never on the `system` channel; `people` counts the transcript for the
    person with `spoke_s`, the seconds summed, and its head says `N voices not yet named · review speakers`,
    `--json` carrying `unnamed` and `not_yet_named` when either is some. RFC 0038 §3.4 says most of this in
    prose; should docs/people.md and docs/day.md fix the keys and sentences?

113. **A status's note and an org's portfolio.** `status list --json` gives `note`, the latest `note/v1`
    labelled `status`, not retracted, whose `extra.status` is the current status line, and `portfolio`, an
    org's latest text `portfolio` on a status line not retracted, its words collapsed, empty clearing it,
    a value that is not text passed by. RFC 0037 §9 says the note is "named by its `note` field": the status
    line carries no such field in the reference's lines, the note names the status. Which way round is meant?

114. **`star/v1` and `scene-review/v1` sentences.** `starProblems`, `starLineProblems` and
    `sceneReviewProblems` are this implementation's, from the RFCs' tables and schemas; the reference's
    validators of the two profiles, if it has them, were not run, so no sentence was compared. `show`'s rows and the
    Day's ★ and `stars` are the reference's, compared on synthetic records: `stars` in the starred lines'
    `seq` order. A star on a retracted line stays in `show` and leaves the Day; a star on a line another
    line of its kind supersedes stays in both, though RFC 0041 rule 5 says a star names a line that is
    *standing*: should a reader drop it? A star with no `line` prints `★ ? ?…`.

115. **What `people` takes for an attendee.** The reference's `people` counts a calendar entry for an
    attendee given as `{name, ref: {kind: email, value}}`, the shape its demo writes, and not one given as a
    bare address or `{email, name}`, at 7bcf728 and at b82a11c alike; this implementation takes all three,
    as SPEC §3.2 reads an attendee for `show`. Not changed here. Which shapes does `people` read?

116. **`video/v1` and `attribution/v1` are not read here.** The reference's `show` prints its own rows for
    both (`Home 01 · 1 h 07 min · 3.2 GB`, `scene 0:40–1:30 → 1994-06-01..1994-08-31`) and marks a superseded
    attribution; this implementation prints them as kinds it does not know, so `show` differs on a record
    that holds them. RFC 0040 gives no row for `show`; they are left for a catch-up that ports the RFC.

## Found while following draft/v1's forward compatibility (openlogbook main at a86787c, 2026-10-21; rfcs/0036-draft-v1.md, its amendment of 2026-10-19, and changelog.d/draft-unknown-proposals.md)

Read from those two files only; no source was read and the reference was not run here (CI's
cross-implementation job runs it at a86787c).

117. **A draft's proposals, read.** `readDraft` had not read `proposals` (the amendment of 2026-10-13) at
    all; it now does, as the RFC's text says, and with the forward compatibility of 2026-10-19: an event
    proposal of the table's shape is shown, numbered by its place in the array from 1, the unknown ones
    counted in that place; a proposal whose `kind` is a non-empty string other than `event` is counted
    as `proposals_unknown` and nothing more; one that is not an object, names no `kind`, or is an event
    of another shape makes the line malformed. `draftProblems`, the writer's whole field table, refuses
    an unknown kind (rule 6, writers stay strict). Open:
    a. The sentences are this implementation's: `proposals must be a list`, `proposal N is malformed: an
       event proposal is {kind, title, start, end, place, people, evidence}, each of its type, start
       before end, nothing else`, `proposal N is malformed: a proposal is an object that names its kind`,
       and the writer's `proposal N is of a kind a writer may not write: kind must be one of event, not
       'link'`, the first of each only, as the segment rule names the first malformed segment. The
       cross-implementation test holds only that both readers call a malformed event malformed, and
       `proposals_unknown` and how many proposals are shown alike. What are the reference's words?
    b. The table says an event's `start` is on the day, its `place` a place of the unit's stays, its
       `people` canonical person ids, its `evidence` lines of the unit. A writer drops a proposal that is
       not; the RFC does not say what a reader does with one that a writer did not drop. This reader
       checks the shape only. Should it hold a proposal to the unit, and is one that fails malformed,
       or dropped as the writer would have?
    c. `kind` of only blanks (`"  "`) is a non-empty string, so it is counted as unknown, by rule 3's
       letter. Is it meant to be a proposal with no kind?
    d. An empty `proposals` list is not malformed here, to the reader nor to `draftProblems`, though the
       table says the key is absent when the model proposes nothing.
    f. An event's `start` before its `end` is compared to the millisecond, so two instants written apart
       in a finer fraction are taken as equal and the event as malformed.
    e. The changelog fragment and the RFC date the amendment 19 October 2026; it landed on the reference's
       main on 21 October (a86787c, its #342).

    *Answered (a), by running the reference at d053f78, 2026-10-24.* The reference's reader names a
    malformed proposal `proposal N is malformed: a proposal is {kind: event, title, start, end, place,
    people, evidence}: start before end, both UTC with a Z, people and evidence lists of ids, evidence
    not empty`, an event of the wrong shape and a proposal that is not an object or names no kind
    alike, and since draft/v1's amendment 2 a link of the wrong shape `proposal N is malformed: a link
    is {kind: link, entity, text, evidence, note?}: entity an entity id, text what it says, evidence a
    non-empty list of line ids, note a string when given`, the first malformed proposal only. `readDraft`
    now says the same, and the cross-implementation test holds the whole `malformed` list alike. The
    writer's sentence for a kind it does not know (`kind must be one of event, link, not 'merge'`) stays
    this implementation's: the reference's writers are its dream's, not run here.

118. **The route's text, learned from the reference's output at a86787c (fa41791, its #343).** Its changelog
    says an unnamed stay is `near <place>, x km` or the nearest airport's city, "the coordinates only
    where nothing names it or where two stays side by side would read the same", and the JSON keeps
    the label. The fixtures show only the first half; the second was run on seven synthetic records
    (a person in Oslo away around Zurich), and the reference compares each stay's short text with its
    neighbours' short texts, a named place's being its name: two or three alike in a row all keep
    their coordinates, one alike only with a named neighbour keeps them alone, two alike with
    another stop between them both drop them. `routeText` does the same from the JSON's labels.
    Should SPEC §3.2.6 say it, since the text is a reader's own?

## Found while catching up with the reference at its main of 24 Oct (openlogbook main at d053f78, 2026-10-24; rfcs/0036-draft-v1.md amendment 2, rfcs/0046-what-you-heard.md, docs/day.md, docs/dream.md, docs/heard.md, docs/adapters/agents.md, changelog.d/)

Read from those files and from the reference's output, run at d053f78 on synthetic records (a person
in Oslo who does not exist); no source was read. Each entry is a place where the documents and the
output disagree, or where neither says; nothing is decided here.

119. **`show` counts every proposal that is not a link as an event.** draft/v1's forward compatibility
    (rule 5) says a reader shows the proposals of the kinds it knows and counts the others as
    `proposals_unknown`, and the Day does: its draft row says `1 proposed event · 1 proposed link` for
    the proposals it shows. The row `show` prints for the same draft line counts the array as written:
    a proposal whose `kind` is `link` is a link whatever its shape, and every other one an event, a
    kind it does not know (`merge`), a malformed event, a proposal with no kind and one that is not an
    object among them (`[{kind: merge}]` prints `· 1 proposed event`). `draftRow` does the same, to
    agree. Is `show`'s count meant to be of the proposals a reader shows, or of the array?

120. **A link's fields, as the reader holds them.** Amendment 2 says `entity` is "a canonical entity id,
    an idea's or an org's, that the material named", `evidence` "the line ids it rests on, non-empty,
    each a line of the unit", and `note` "a non-empty string". The reader takes any `entity` with a word
    in it (`crew` is shown), keeps `entity` and `note` as written and shows `text` stripped
    (` t ` reads `t`), refuses a `note` of only whitespace and an evidence id that is the empty string
    but not one of only spaces, and shows a link whose evidence names a line not of the unit as
    unsupported (`evidence names a line that is not on the day`), not malformed, as it does an event
    and a segment. `readDraft` does the same. Should `entity` be held to an id's form, and is a link
    off its unit unsupported or malformed?

121. **`extra.read_until`'s form.** The amendment says "RFC 3339 UTC with a `Z`" and "absent on every
    other draft". The reader holds it to a pattern only: `2026-02-30T18:00:00Z` and
    `2026-06-13T25:61:60Z` pass, `2026-06-13T18:00:00.Z` and any offset, `+00:00` included, are refused;
    and on a draft that is not an evening's it checks nothing and still gives the value under
    `read_until` (`yesterday`). `readDraft` does the same. Should a reader check the calendar, and is a
    `read_until` without `extra.evening` malformed?

122. **A segment's keys beyond the shape rule.** RFC 0036's evidence rule, and draft/v1's segment rule,
    say "a segment is {text, evidence} or {text, unsupported: true}, nothing else", and the
    reference's sentence for a malformed segment says so. Since dream-day/4 the documents name a
    segment's `part` (docs/day.md, `segments` each with `text`, `evidence`, `supported`, `why` and
    `part`) and an `ideas` segment's `entity` (docs/dream.md). The reader calls neither key malformed
    (`{text, evidence, part: "learned"}` is supported), and gives `part: null` for a segment that
    carries one: where `part` is read from is not written. This implementation's reader, which checks
    `text`, `evidence` and `unsupported` only, agrees; it gives no `part`. Which keys may a segment
    carry, and where does a reader find its part?

