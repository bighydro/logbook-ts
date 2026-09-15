import { randomBytes } from "node:crypto";

/**
 * UUIDv7 (RFC 9562 §5.7): 48-bit Unix milliseconds, 4-bit version, 12 random bits,
 * 2-bit variant, 62 random bits. Lowercase hex, hyphenated.
 */
export function uuidV7(now: Date = new Date()): string {
  const bytes = randomBytes(16);
  const ms = BigInt(now.getTime());
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
