import { afterEach, describe, expect, it, vi } from "vitest";
import { readDay } from "../src/day.js";
import { renderDay } from "../src/dayText.js";
import { FLAGS_ENV } from "../src/flags.js";
import { offsetText, sceneReviewProblems, sceneReviewRow } from "../src/sceneReviews.js";
import { showDay } from "../src/show.js";
import { standingStars, starLineProblems, starProblems, starRow } from "../src/stars.js";
import type { Line } from "../src/types.js";
import { cleanup, comparableDayText } from "./helpers.js";
import { DAY, lineId, MARKS_CASES, marksRecord } from "./marks-cases.js";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

/**
 * Stars, keepers and the owner's no on a scene, as the reference prints them at b82a11c (0.7.0):
 * every expected value is its output on the same record (tests/marks-cases.ts).
 */
describe("the owner's marks under the rfc0040 and rfc0041 flags, as the reference prints them", () => {
  for (const c of MARKS_CASES) {
    it(c.name, () => {
      vi.stubEnv(FLAGS_ENV, "rfc0040,rfc0041");
      const root = marksRecord(c);
      expect(showDay(root, { day: DAY }).text).toBe(c.expected.show);
      const day = readDay(root, { day: DAY });
      expect(renderDay(day)).toBe(comparableDayText(c.expected.day));
      expect(JSON.parse(JSON.stringify(day)).stars ?? null).toEqual(c.expected.stars);
    });
  }

  it("prints a star and a no as any kind it does not know with the flags off, and the Day marks nothing", () => {
    const c = MARKS_CASES[0];
    if (c === undefined) throw new Error("no case");
    const root = marksRecord(c);
    const text = showDay(root, { day: DAY }).text;
    expect(text).toContain("star       manual         kind=event, line=");
    expect(text).toContain("hero photo (memory): IMG_1003.HEIC · the table by the river");
    const day = readDay(root, { day: DAY });
    expect(renderDay(day)).toContain("      event        Middag, from 18:00 to 20:00\n");
    expect("stars" in day).toBe(false);
  });
});

const line = (fields: Partial<Line> & { payload: Line["payload"] }): Line =>
  ({
    id: lineId(9),
    seq: 9,
    at: "2026-10-03T16:00:00Z",
    end: null,
    tz: "Europe/Oslo",
    source: "manual",
    kind: "star",
    tier: 1,
    recorded_at: "2026-10-04T08:00:00Z",
    prev: "0".repeat(64),
    hash: "0".repeat(64),
    ...fields,
  }) as Line;

describe("star/v1 (RFC 0041): the table and the line rules", () => {
  const event = line({
    id: lineId(1),
    seq: 1,
    kind: "event",
    source: "sim-cal",
    payload: { schema: "event/v1", title: "Middag" },
  });
  const good = line({
    payload: { schema: "star/v1", line: lineId(1), kind: "event", note: "the table by the river" },
  });

  it("takes the RFC's example and refuses what its table refuses", () => {
    expect(starProblems(good)).toEqual([]);
    expect(starLineProblems(good, event)).toEqual([]);
    expect(
      starProblems(
        line({
          kind: "note",
          source: "dream",
          end: "2026-10-03T17:00:00Z",
          payload: { schema: "star/v2", line: "", kind: 5, note: "two\nlines", supersedes: 5 },
        }),
      ),
    ).toEqual([
      "kind must be star, not 'note'",
      "source must be manual: a star is the owner's act",
      "end must be null",
      "schema must be star/v1",
      "line must be the id of the starred line",
      "kind must be the starred line's kind",
      "note must be one line",
      "supersedes must be the id of the star this one replaces",
    ]);
    expect(
      starProblems(line({ payload: { schema: "star/v1", line: "x", kind: "note", note: 5 } })),
    ).toEqual(["note must be text"]);
  });

  it("holds a star to its line: the line's at, tier and kind, and never a mark, an unmarking or a draft", () => {
    expect(starLineProblems(good, undefined)).toEqual([
      "line names '00000000-0000-4000-8000-000000000001', which is no line of the record",
    ]);
    expect(
      starLineProblems(line({ ...good, at: "2026-10-03T17:00:00Z", tier: 2 }), {
        ...event,
        kind: "draft",
      }),
    ).toEqual([
      "a draft line is never starred (rule 5)",
      "at must be the starred line's at",
      "tier must be the starred line's tier",
      "kind must be 'draft', the line's kind",
    ]);
  });

  it("stands one star per line: the latest, a superseded one aside, never on a draft, a star or a retracted line", () => {
    const draft = line({ id: lineId(2), seq: 2, kind: "draft", payload: { schema: "draft/v1" } });
    const star = (seq: number, target: number, more: Record<string, unknown> = {}): Line =>
      line({
        id: lineId(seq),
        seq,
        payload: { schema: "star/v1", line: lineId(target), kind: "event", ...more } as never,
      });
    const lines = [
      event,
      draft,
      star(3, 1, { note: "first" }),
      star(4, 1, { note: "second", supersedes: lineId(3) }),
      star(5, 1, { note: "third", supersedes: lineId(4) }),
      star(6, 2),
      star(7, 3),
    ];
    // The third is retracted: the second stands again (#321).
    const stars = standingStars(lines, (id) => id === lineId(5));
    expect([...stars.values()]).toEqual([
      { line: lineId(1), star: lineId(4), kind: "event", note: "second" },
    ]);
    expect(standingStars(lines, (id) => id === lineId(1)).size).toBe(0);
  });

  it("prints a star's row with a `?` for what is not there", () => {
    expect(starRow(good.payload)).toBe("★ event 00000000… · the table by the river");
    expect(starRow({ schema: "star/v1", line: 5, kind: "note" })).toBe("★ note 5…");
    expect(starRow({ schema: "star/v1" })).toBe("★ ? ?…");
  });
});

describe("scene-review/v1 (RFC 0040 §5): the table, the schema and the row", () => {
  const VIDEO = "019cadd3-6bc0-7dcd-9133-0000000005a0";
  const good = line({
    kind: "scene-review",
    tier: 2,
    payload: {
      schema: "scene-review/v1",
      raw_id: `scene-review:${VIDEO}#t=130.00,170.00@a508e5d324d3`,
      ref: { kind: "scene", value: `${VIDEO}#t=130.00,170.00` },
      scene: { video: VIDEO, start_s: 130.0, end_s: 170.0 },
      verdict: "different",
      proposal: {
        place: { type: "place", id: "Hjem", registry: "logbook", label: "Hjem" },
        when: null,
        confidence: "medium",
      },
      draft: "019cadd3-6bc0-7dcd-9133-0000000005b4",
      method: "owner",
      evidence: ["019cadd3-6bc0-7dcd-9133-0000000005b4", VIDEO],
      logbook_head: "4d0f6a2e9b18c3757e0a1d2c6b5f8e9a7c3b2d1e0f9a8b7c6d5e4f3a2b1c0d9e",
    },
  });

  it("takes the RFC's example (§8) and refuses what §5 refuses", () => {
    expect(sceneReviewProblems(good)).toEqual([]);
    expect(
      sceneReviewProblems(
        line({
          kind: "entity-review",
          source: "dream",
          tier: 1,
          end: "2026-10-03T17:00:00Z",
          payload: {
            schema: "entity-review/v1",
            raw_id: 5,
            ref: { kind: "place", value: "Hjem" },
            scene: { video: VIDEO, start_s: -1, end_s: 2 },
            verdict: "same",
            proposal: "Hjem",
            draft: "",
            supersedes: 5,
            method: "model",
            evidence: "x",
            logbook_head: "ABC",
            extra: [],
          } as never,
        }),
      ),
    ).toEqual([
      "kind must be scene-review, not 'entity-review'",
      "source must be manual: a no is the owner's",
      "end must be null",
      "tier must be 2 or more: the highest of the lines it answers (§7)",
      "schema must be scene-review/v1",
      "raw_id must be text",
      "ref must be {kind: scene, value: <video line id>#t=<start>,<end>}",
      "scene must be {video, start_s, end_s}, the offsets seconds of 0 or more",
      "verdict must be different: a yes is an attribution",
      "proposal must be the draft's proposal, an object, or null",
      "draft must be the id of the scene's draft",
      "supersedes must be the id of the no this one replaces",
      "method must be owner",
      "evidence must be a list of line ids",
      "logbook_head must be a sha256, 64 hex digits",
      "extra must be an object",
    ]);
  });

  it("holds `scene` to the ref, and its end after its start", () => {
    const withScene = (scene: Record<string, unknown>): Line =>
      line({ ...good, payload: { ...good.payload, scene } as never });
    expect(sceneReviewProblems(withScene({ video: VIDEO, start_s: 130, end_s: 171 }))).toEqual([
      "scene must be the ref's: its video line and its offsets",
    ]);
    expect(sceneReviewProblems(withScene({ video: "x", start_s: 130, end_s: 170 }))).toEqual([
      "scene must be the ref's: its video line and its offsets",
    ]);
    expect(sceneReviewProblems(withScene({ video: VIDEO, start_s: 170, end_s: 130 }))).toEqual([
      "scene's end_s must be after its start_s",
      "scene must be the ref's: its video line and its offsets",
    ]);
    const nothing = line({ ...good, payload: { ...good.payload, proposal: null } as never });
    expect(sceneReviewProblems(nothing)).toEqual([]);
  });

  it("prints a scene's span as m:ss, h:mm:ss from an hour, whole seconds", () => {
    expect(offsetText(0)).toBe("0:00");
    expect(offsetText(130)).toBe("2:10");
    expect(offsetText(3599.99)).toBe("59:59");
    expect(offsetText(3600)).toBe("1:00:00");
    expect(offsetText(3725.5)).toBe("1:02:05");
    expect(sceneReviewRow(good.payload)).toBe("scene 2:10–2:50 ≠ Hjem");
  });
});
