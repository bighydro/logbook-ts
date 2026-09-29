# Questions for SPEC.md, found while implementing logbook-ts from the spec alone

Written against `bighydro/logbook` tag v0.3.0 (SPEC.md format v0.2; ADRs 0002, 0006, 0007, 0014; `conformance/`).
The Python source was not read. Each entry says what is unclear, what this implementation does, and why.

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

