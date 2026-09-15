import { createHash } from "node:crypto";
import { canonicalize } from "./jcs.js";
import type { Content, Line } from "./types.js";

/** `prev` of the first line (SPEC §2). */
export const ZERO_HASH = "0".repeat(64);

/** Lowercase hex SHA-256 of the UTF-8 encoding of `text`. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The hashed part of a line: exactly the seven content fields of SPEC §3. A missing `end` is null. */
export function contentOf(line: Line): Content {
  return {
    at: line.at,
    end: line.end ?? null,
    tz: line.tz,
    source: line.source,
    kind: line.kind,
    tier: line.tier,
    payload: line.payload,
  };
}

/** sha256(canonical_json(content)) */
export function contentHash(content: Content): string {
  return sha256Hex(canonicalize(content));
}

/** sha256( prev + "|" + seq + "|" + sha256(content) + "|" + recorded_at ) */
export function lineHash(
  prev: string,
  seq: number,
  contentHashHex: string,
  recordedAt: string,
): string {
  return sha256Hex(`${prev}|${seq}|${contentHashHex}|${recordedAt}`);
}

/** The hash a line should carry, recomputed from its own fields. */
export function hashLine(line: Line): string {
  return lineHash(line.prev, line.seq, contentHash(contentOf(line)), line.recorded_at);
}
