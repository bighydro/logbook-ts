/** The format this implementation carries and writes (SPEC §3.1, ADR 0014). */
export const FORMAT = "logbook/0.2";

/**
 * The format that hashes by the same rule and adds sealed lines (SPEC §3.1, RFC 0029). A record of
 * it is read and verified as it is, `payload_enc` preserved as an unknown field and never opened;
 * one that names recipients is never written to, since nothing here can seal.
 */
export const SEALED_FORMAT = "logbook/0.3";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A payload: whatever the source said, always with a `schema` (SPEC §2). */
export interface Payload {
  schema: string;
  [key: string]: JsonValue;
}

/** One line of the record — the envelope of SPEC §2. Unknown top-level fields are preserved. */
export interface Line {
  id: string;
  seq: number;
  at: string;
  end: string | null;
  tz: string;
  source: string;
  kind: string;
  tier: 1 | 2 | 3;
  payload: Payload;
  recorded_at: string;
  prev: string;
  hash: string;
  [extra: string]: JsonValue;
}

/** The seven fields that are hashed (SPEC §3). */
export interface Content {
  at: string;
  end: string | null;
  tz: string;
  source: string;
  kind: string;
  tier: number;
  payload: Payload;
}

/** `logbook.json` (SPEC §1). Unknown fields are preserved on rewrite. */
export interface Meta {
  format: string;
  owner_id: string;
  created_at: string;
  timezone: string;
  seq: number;
  head: string;
  lineage?: Array<{ from_format: string; from_head: string; migrated_at: string }>;
  /** The age recipients tiers 2–3 are sealed to; present, with two at least, in a record that seals (SPEC §1). */
  recipients?: string[];
  [extra: string]: JsonValue | undefined;
}

export interface VerifyResult {
  valid: boolean;
  /** Number of lines in the chain. */
  lines: number;
  /** Hash of the last line, or sixty-four zeros for an empty record. */
  head: string;
  errors: string[];
}
