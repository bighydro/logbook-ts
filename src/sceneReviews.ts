/**
 * RFC 0040 §5, `scene-review/v1` (draft, 2026-10-14): the owner's statement that a scene of a video
 * file was not filmed where or when its draft proposed, or that there is nothing to name. Read behind
 * the `rfc0040` flag (`flags.ts`) as the reference's `show` prints it since its 0.7.0, matched by
 * running it, never by reading it.
 *
 * - `sceneReviewProblems` holds a line to §5's table, its JSON Schema and what the schema cannot
 *   say (`scene` equal to the ref's, `end_s` after `start_s`; the tier never under 2). The sentences
 *   are this implementation's: the reference's validator, if it has one, is not read here.
 * - `sceneReviewRow`: `show`'s row, `scene 2:10–2:50 ≠ Hjem` or `scene 0:40–1:30: nothing to name`.
 *
 * One standing no per scene (rule 3) is the kind's own superseding, marked in `show` as a goal's
 * and a chapter's are (`show.ts`). No reader of `entity-review/v1` reads this kind (rule 6), and no
 * other reader here does: `video/v1` and `attribution/v1` (§2, §4) are not read.
 */

import { pyRepr } from "./pyrepr.js";
import type { JsonValue, Line, Payload } from "./types.js";

export const SCENE_REVIEW_KIND = "scene-review";
export const SCENE_REVIEW_SCHEMA = "scene-review/v1";

/** A scene ref (§1): a video line's id, `#t=`, and the scene's offsets in seconds. */
export const SCENE_REF = /^[^#\s]+#t=(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/u;
const HEX64 = /^[0-9a-f]{64}$/;

type Obj = { [key: string]: JsonValue };
const obj = (v: JsonValue | undefined): Obj | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v : undefined;
const isNumber = (v: JsonValue | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Every way a line is not a `scene-review/v1` line by RFC 0040 §5, in words; empty when it is one. */
export function sceneReviewProblems(line: Line): string[] {
  const problems: string[] = [];
  const p: Payload = line.payload ?? { schema: "" };
  if (line.kind !== SCENE_REVIEW_KIND)
    problems.push(`kind must be scene-review, not ${pyRepr(line.kind)}`);
  if (line.source !== "manual") problems.push("source must be manual: a no is the owner's");
  if (line.end !== null) problems.push("end must be null");
  if (!(typeof line.tier === "number" && line.tier >= 2))
    problems.push("tier must be 2 or more: the highest of the lines it answers (§7)");
  if (p.schema !== SCENE_REVIEW_SCHEMA) problems.push(`schema must be ${SCENE_REVIEW_SCHEMA}`);
  if ("raw_id" in p && typeof p.raw_id !== "string") problems.push("raw_id must be text");
  const ref = obj(p.ref);
  const value = ref?.value;
  const offsets = typeof value === "string" ? SCENE_REF.exec(value) : null;
  if (ref === undefined || ref.kind !== "scene" || offsets === null)
    problems.push("ref must be {kind: scene, value: <video line id>#t=<start>,<end>}");
  if ("scene" in p) {
    const scene = obj(p.scene);
    const { video, start_s: start, end_s: end } = scene ?? {};
    if (
      scene === undefined ||
      typeof video !== "string" ||
      !isNumber(start) ||
      !isNumber(end) ||
      start < 0 ||
      end < 0
    ) {
      problems.push("scene must be {video, start_s, end_s}, the offsets seconds of 0 or more");
    } else {
      if (end <= start) problems.push("scene's end_s must be after its start_s");
      if (
        offsets !== null &&
        typeof value === "string" &&
        (value.slice(0, value.indexOf("#")) !== video ||
          Number(offsets[1]) !== start ||
          Number(offsets[2]) !== end)
      )
        problems.push("scene must be the ref's: its video line and its offsets");
    }
  }
  if (p.verdict !== "different")
    problems.push("verdict must be different: a yes is an attribution");
  if (!("proposal" in p) || !(p.proposal === null || obj(p.proposal) !== undefined))
    problems.push("proposal must be the draft's proposal, an object, or null");
  if (!(typeof p.draft === "string" && p.draft !== ""))
    problems.push("draft must be the id of the scene's draft");
  if ("supersedes" in p && typeof p.supersedes !== "string")
    problems.push("supersedes must be the id of the no this one replaces");
  if (p.method !== "owner") problems.push("method must be owner");
  if (
    "evidence" in p &&
    !(Array.isArray(p.evidence) && p.evidence.every((e) => typeof e === "string"))
  )
    problems.push("evidence must be a list of line ids");
  if ("logbook_head" in p && !(typeof p.logbook_head === "string" && HEX64.test(p.logbook_head)))
    problems.push("logbook_head must be a sha256, 64 hex digits");
  if ("extra" in p && obj(p.extra) === undefined) problems.push("extra must be an object");
  return problems;
}

/** Seconds as the reference prints a scene's offset: `m:ss`, `h:mm:ss` from an hour, whole seconds. */
export function offsetText(seconds: number): string {
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * `show`'s row of the owner's no on a scene, as the reference prints it: `scene`, the scene's span
 * when its `scene` gives two offsets, then ` ≠ ` and what the proposal named (the place's label, else
 * its id; the days, `from..to`, or the one day) or `: nothing to name` when it named nothing.
 */
export function sceneReviewRow(p: Payload): string {
  const scene = obj(p.scene);
  const start = scene?.start_s;
  const end = scene?.end_s;
  const span = isNumber(start) && isNumber(end) ? ` ${offsetText(start)}–${offsetText(end)}` : "";
  const proposal = obj(p.proposal);
  const named: string[] = [];
  const place = obj(proposal?.place);
  if (place !== undefined) {
    const label = place.label;
    const id = place.id;
    const name = typeof label === "string" && label !== "" ? label : id;
    if (typeof name === "string" && name !== "") named.push(name);
  }
  const when = obj(proposal?.when);
  if (when !== undefined && typeof when.from === "string" && typeof when.to === "string")
    named.push(when.from === when.to ? when.from : `${when.from}..${when.to}`);
  return named.length === 0
    ? `scene${span}: nothing to name`
    : `scene${span} ≠ ${named.join(", ")}`;
}
