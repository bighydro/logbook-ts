"""Builds tests/fixtures/rfc0037-0038-sample with the reference implementation's own writers.

    uv run --project "$LOGBOOK_REF" python tests/fixtures/rfc0037-0038-sample/make.py "$LOGBOOK_REF" <out>

The record of RFC 0037 (entities) and RFC 0038 §2 (a transcript's voices), written by the reference
(bighydro/logbook, main at 7bcf728) and never by this implementation, so that both are read on lines
neither chose: its synthetic entities record (`tests/entities_record.py`: Ines Nordmann of Oslo, a
yard, a kiosk, her family, an idea, two craft), then

- `entity/v1` lines through `entity_review.write_entity` (which checks the profile and the tiers),
  for an org, an idea and its relabel, an asset, a place and a person;
- `entity-review/v1` lines checked by `entities.validate_entity_review` and appended at
  `entities.review_tier` of what they cite (one citing the tier-3 payments), a retracted one, and
  RFC 0035's `people-review/v1` line, read as one of type person;
- `status/v1` lines through `entity_status.write`, the reference's `logbook status`: an org's at
  tier 3 with its reason on the line and no note, an idea's, a place's and an asset's at tier 2 with
  the reason also a `note/v1` labelled `status`, a place let go and an asset sold closing their
  registry entries, a status retracted;
- transcripts with `speakers` and `diarization` (the reference's own reader test cases, and the
  edges of a label), one heard again that supersedes the first, one attached to a stay at home, a
  note a transcript supersedes, and one superseded from the next day.

The ids and `recorded_at` are minted by the reference's clock, so running this again writes another
record; the folder holds the one it wrote, as `demo-seed1` holds `logbook demo --seed 1`. Nothing in
it is real: example.org addresses, +44 7700 900xxx numbers, MMSI 970xxxxxx, ZZ- registrations,
airline XY."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REF, OUT = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(REF / "tests"))

import entities_record as er  # noqa: E402
from persona import HOME, dwell, utc  # noqa: E402

from logbook.contrib import entities, entity_review, entity_status  # noqa: E402
from logbook.core import places  # noqa: E402
from logbook.core.store import Logbook  # noqa: E402

TODAY = "2026-10-15"
TZ = er.TZ

lb = Logbook.init(OUT, TZ)
os.environ["LOGBOOK_HOME"] = str(lb.root)
lb.set_owner_emails([er.OWNER["email"]])
(lb.root / "assets.json").write_text(json.dumps(er.REGISTRY, indent=2) + "\n", encoding="utf-8")
(lb.root / "policy").mkdir(exist_ok=True)
(lb.root / "policy" / "entities.json").write_text(
    json.dumps({"code_hosts": [er.CODE_HOST]}) + "\n", encoding="utf-8"
)
places.add(lb.root, places.Place("Hytta", 59.9, 10.75, 120, "other", ("family",)))
places.add(lb.root, places.Place("Båtplassen", 59.91, 10.73, 80, "asset-berth"))
lb.append_many(er.drafts())


def by_kind(kind: str) -> list[dict]:
    return [line for line in Logbook(lb.root).lines() if line["kind"] == kind]


mails = by_kind("mail")
payments = by_kind("transaction")

# -- entity/v1 -------------------------------------------------------------------------------------------

IDEA = entity_review.uuid7()
KIOSK = entity_review.uuid7()
idea = entity_review.write_entity(
    lb,
    entities.entity_payload(
        "idea",
        IDEA,
        "the fjord kiosk",
        refs=[("title", "fjord kiosk"), ("repo", er.REPO), ("page", f"notion:{er.ROOT_PAGE}")],
        key=f"page:notion:{er.ROOT_PAGE}",
        extra={"pitch": "a kiosk on the ferry quay that sells what the ferry forgot"},
    ),
    at="2026-09-20T19:02:00Z",
)
entity_review.write_entity(
    lb,
    entities.entity_payload(
        "org",
        KIOSK,
        "Fjordkiosk AS",
        refs=[("domain", er.KIOSK_DOMAIN), ("merchant", "fjordkiosk as")],
        aliases=["Fjordkiosk"],
        key=f"domain:{er.KIOSK_DOMAIN}",
        evidence=[str(mails[3]["id"])],
    ),
    at="2026-09-21T18:00:00Z",
)
entity_review.write_entity(
    lb,
    entities.entity_payload("asset", "solvind", "Solvind", refs=[("mmsi", "970000001")], key="mmsi:970000001"),
    at="2026-09-22T08:00:00Z",
)
entity_review.write_entity(
    lb,
    entities.entity_payload("place", "Hytta", "Hytta", refs=[("place", "Hytta")], key="place:hytta"),
    at="2026-09-22T08:05:00Z",
)
entity_review.write_entity(
    lb, entities.entity_payload("person", er.OLA["id"], "Ola Nordmann"), at="2026-09-22T08:10:00Z"
)
entity_review.write_entity(
    lb,
    entities.entity_payload("idea", IDEA, "the ferry kiosk", supersedes=str(idea["id"])),
    at="2026-09-23T20:00:00Z",
)

# -- entity-review/v1 ------------------------------------------------------------------------------------


def no(at: str, payload: dict, cited: list[int]) -> dict:
    problems = entities.validate_entity_review(payload)
    assert not problems, problems
    return lb.append(
        at=at, source=entities.SOURCE, kind=entities.ENTITY_REVIEW, tier=entities.review_tier(cited), payload=payload
    )


no(
    "2026-09-24T19:00:00Z",
    entities.review_payload(
        "org",
        ("group", "nordmann verft"),
        refs=[("group", "nordmann verft")],
        observed=["Nordmann Verft"],
        entity_id=er.YARD["id"],
        label=er.YARD["label"],
        evidence=[str(mails[0]["id"])],
    ),
    [int(mails[0]["tier"])],
)
no(
    "2026-09-24T19:01:00Z",
    entities.review_payload(
        "org",
        ("merchant", "fjordkiosk as"),
        refs=[("merchant", "fjordkiosk as")],
        observed=["FJORDKIOSK AS"],
        entity_id=er.YARD["id"],
        label=er.YARD["label"],
        evidence=[str(p["id"]) for p in payments],
    ),
    [int(p["tier"]) for p in payments],
)
no(
    "2026-09-24T19:02:00Z",
    entities.review_payload("place", ("centre", "59.902100,10.741200"), label="Boathouse"),
    [],
)
no(
    "2026-09-24T19:03:00Z",
    entities.review_payload("org", ("domain", er.FAMILY_DOMAIN), label=er.FAMILY_DOMAIN),
    [],
)
withdrawn = no(
    "2026-09-24T19:04:00Z",
    entities.review_payload("asset", ("mmsi", er.HULL_MMSI), observed=["GAMLE SOLVIND"]),
    [],
)
lb.retract(int(withdrawn["seq"]), "asked again")
legacy = json.loads((REF / "tests" / "fixtures" / "entities" / "people-review.json").read_text(encoding="utf-8"))
lb.append(at="2026-09-24T19:05:00Z", source="manual", kind="people-review", tier=2, payload=legacy["payload"])

# -- status/v1 -------------------------------------------------------------------------------------------

entity_status.write(lb, "org", er.YARD["label"], "hold", "orders through 2027 at the yard", at="2026-10-01", today=TODAY)
entity_status.write(
    lb,
    "org",
    "Fjordkiosk",
    "passed",
    "good team, but a kiosk is a place and I do not want to own places",
    at="2026-10-02",
    today=TODAY,
    proposal={"status": "passed", "score": 40, "because": ["2 mails 2026-09-04 – 2026-09-06", "no status line"]},
    evidence=[str(p["id"]) for p in payments],
)
entity_status.write(lb, "idea", "kiosk", "exploring", "pricing page written; talk to the ferry company first", at="2026-10-02", today=TODAY)
killed = entity_status.write(lb, "idea", "kiosk", "killed", "a ferry kiosk exists already", at="2026-10-05", today=TODAY)
lb.retract(int(killed.status["seq"]), "not killed after all")
entity_status.write(lb, "place", "Båtplassen", "let-go", "gave the berth up", at="2026-10-03", today=TODAY)
entity_status.write(lb, "asset", "Solvind", "sold", at="2026-10-04", today=TODAY)
entity_status.write(lb, "asset", "Lerka", "let-go", "the lease ended", at="2026-10-04", today=TODAY)
entity_status.write(lb, "org", er.YARD["label"], "sell", at="2026-10-06", today=TODAY)

# -- transcript/v1 with speakers and diarization (RFC 0038 §2) -------------------------------------------

DAY = "2026-10-06"
CONTENT = {"sha256": "0b77" + "0" * 60, "path": f"attachments/0b77{'0' * 60}", "bytes": 5120, "media_type": "text/plain"}
CALL = [
    {"label": "mic", "seconds": 201.7, "turns": 38, "channel": "mic", "from_me": True},
    {"label": "system", "seconds": 188.3, "turns": 35, "channel": "system", "name": "Ola Nordmann"},
]
ROOM = [{"label": "S1", "seconds": 1862.4, "turns": 212}, {"label": "S2", "seconds": 41.5, "turns": 4}]


def transcript(day: str, clock: str, title: str, voices, raw_id: str, end: str | None = None, source: str = "transcription", **more) -> dict:
    payload = {"schema": "transcript/v1", "provider": "mlx-whisper", "raw_id": raw_id, "title": title, "participants": [], **more}
    if voices is not None:
        payload["speakers"] = voices
        payload["diarization"] = {"engine": "pyannote", "channels": 2 if voices is CALL else 1}
    return {"at": utc(day, clock), "end": None if end is None else utc(day, end), "tz": TZ, "source": source, "kind": "transcript", "tier": 2, "payload": payload}


lb.append_many(
    [
        *dwell(DAY, "18:00", "23:00", HOME, seed=3),
        {"at": "2026-10-01T08:00:00Z", "source": "manual", "kind": "resolution", "tier": 2,
         "payload": {"schema": "resolution/v1", "ref": {"kind": "email", "value": "ola@example.org"},
                     "entity": {"type": "person", "id": er.OLA["id"], "registry": "logbook"},
                     "label": "Ola Nordmann", "method": "owner"}},
        transcript(DAY, "09:15", "Samtale", CALL, "call", content=CONTENT),
        transcript(DAY, "10:00", "Rom", [
            {"label": "S1", "seconds": 0, "turns": 1}, {"label": "S2", "seconds": 59.5, "turns": 4},
            {"label": "S3", "seconds": 89.9, "turns": 4}, {"label": "S4", "seconds": 7230, "turns": 4},
            {"label": "Speaker 5", "turns": 2, "name": "Kari Nordmann"}, {"label": "mic.2", "turns": 1, "from_me": True, "name": "Ines"},
        ], "room"),
        transcript(DAY, "10:30", "Kanter", [
            {"label": "", "turns": 1}, {"label": "a#b", "turns": 1}, {"label": "x" * 65, "turns": 1},
            {"label": " S1 ", "turns": 1, "name": "  "}, {"label": "S2", "seconds": "12", "turns": 1, "from_me": 1},
            {"label": "S3", "seconds": -5, "turns": 1}, "junk", {"seconds": 4},
        ], "edges"),
        transcript(DAY, "11:00", "Bare tekst", "mic,system", "string-speakers"),
        transcript(DAY, "11:30", "Ingen stemmer", [], "empty-speakers"),
        transcript(DAY, "12:00", "Med folk", [{"label": "S1", "seconds": 12, "turns": 3}], "people",
                   participants=[{"name": "Ola Nordmann", "email": "ola@example.org"}], extra={"turns": 7, "duration_s": 125}),
        transcript(DAY, "12:30", "Kort", None, "short", extra={"turns": 0, "duration_s": 2}),
        transcript(DAY, "19:40", "Middag", None, "dinner", end="20:30", source="granola",
                   participants=[{"name": "Ola Nordmann", "email": "ola@example.org"}]),
        transcript(DAY, "21:00", "Idé", None, "idea"),
        {"at": utc(DAY, "21:30"), "source": "manual", "kind": "note", "tier": 2,
         "payload": {"schema": "note/v1", "text": "Dinner was long; Ola told the story of the engine."}},
    ]
)
dinner = next(line for line in by_kind("transcript") if line["payload"].get("raw_id") == "dinner")
note = next(line for line in by_kind("note") if line["payload"].get("text", "").startswith("Dinner was long"))
idee = next(line for line in by_kind("transcript") if line["payload"].get("raw_id") == "idea")
lb.append_many(
    [
        transcript(DAY, "19:40", "Middag", ROOM, "dinner#speakers@a9e2", end="20:30", source="granola",
                   participants=[{"name": "Ola Nordmann", "email": "ola@example.org"}], supersedes=str(dinner["id"])),
        transcript(DAY, "21:35", "Notatet hørt", [{"label": "mic", "seconds": 30, "turns": 2, "from_me": True}], "note-heard",
                   supersedes=str(note["id"])),
        transcript("2026-10-07", "08:00", "Idé, hørt igjen", [{"label": "S1", "seconds": 95, "turns": 9}], "idea#speakers@b1c3",
                   supersedes=str(idee["id"])),
    ]
)
heard_wrong = lb.append(**{k: v for k, v in transcript(DAY, "22:00", "Hørt feil", ROOM, "wrong").items() if k != "tz"})
lb.append(**{k: v for k, v in transcript(DAY, "22:05", "Hørt feil igjen", [{"label": "S1", "turns": 1}], "wrong#2",
                                          supersedes=str(heard_wrong["id"])).items() if k != "tz"})
last = by_kind("transcript")[-1]
lb.retract(int(last["seq"]), "heard wrong")

print(f"{lb.root}: {Logbook(lb.root).meta['seq']} lines, head {Logbook(lb.root).meta['head']}")
