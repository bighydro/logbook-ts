# Changelog

All notable changes to logbook-ts. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
the versions are this implementation's, and the spec it follows is named in each entry.

## Unreleased

### Added
- `show --since YYYY-MM-DD --until YYYY-MM-DD`: a range of local days, inclusive, oldest first, each day as `--day` prints it and a blank line between; a day without a line is left out, an empty range prints `<since>–<until>: nothing logged`, and a missing bound is the record's first or last listed day. The reader streams: one pass over every file for the judgements (resolutions, retractions, superseded flights) and the record's first and last day, then only the month files the range can touch, in order, a day printed as soon as the last file that can hold one of its lines has been read; what is held is the days still open, at most a month's worth, so memory does not grow with the record. `showRange` and `showDays` in the library.
- `show --profile <schema>` (repeatable, or comma-separated): only the lines whose `payload.schema` is one of the profiles given; `note` means every version of `note/vN`. Applied before runs of points are collapsed and calendar entries folded; resolutions and retractions still come from the whole record. `profiles` on `showDay`, `showDays` and `showRange`.
- `show --json`: each day as one JSON object on one line — `day`, `timezone`, `hero`, `rows`, `note` — every row with the text column as `summary` (names resolved, or raw with `--raw`), its local `time`, `until` for a run, `kind`, `source` (every source of a folded entry), `retraction` for a hidden line, and `lines`, the full lines behind the row. `detail` on every `showDay` and `showDays` result.
- `show` prints a day's hero photos — `  hero  IMG_0001.jpg` under the heading, the `memory` lane first and every other lane as `(art)` — and a `keeper/v1` line (RFC 0024) as `hero photo (<lane>): <photo>`, as the reference does (SPEC-QUESTIONS 38).
- The conformance sample is part of the cross-implementation diff: `tests/fixtures/sample-logbook/expected-show/` holds the reference's output for the six days it reads as SPEC §3.2 says (SPEC-QUESTIONS 40), checked by the unit tests and by `tests/cross-impl.test.ts`.

### Changed
- The vendored conformance sample is `conformance/sample-logbook` of bighydro/logbook at v0.5.0: 31 lines (the first sixteen unchanged, then one line of every profile added since v0.2), head `035a74e0…`. The conformance CI job clones the spec at v0.5.0 and expects that head.
- SPEC-QUESTIONS 38–41: the hero line and keeper row, a flight without a designator, the two days of the sample that cannot be diffed, and the range, profile and JSON flags, which neither the spec nor the reference defines.

## 0.1.0 — 2026-10-01

### Added
- `verify` and `add` for `logbook/0.2`, written from SPEC.md at v0.3.0 alone: RFC 8785 canonical JSON, SHA-256 chaining and UUIDv7 by hand on Node built-ins; SPEC §6 conformance on the 16-line sample.
- `show --day YYYY-MM-DD [--tz <zone>] [--raw]`: one local day as the reference prints it, every RFC profile summarised, names from the record's own `resolution/v1` lines, runs of points collapsed, calendar entries folded across sources, retractions marked in place; matched to the reference by running it on synthetic records (`tests/fixtures/show-sample`, `tests/fixtures/profiles-sample`), never by reading it, and kept matched by `tests/cross-impl.test.ts`.
- SPEC-QUESTIONS.md: every place the spec left a choice, 1–37.
