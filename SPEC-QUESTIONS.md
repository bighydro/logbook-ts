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
