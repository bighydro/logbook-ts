import { canonicalize } from "./jcs.js";
import type { JsonValue } from "./types.js";

/**
 * A JSON value as the reference implementation's generic `key=value` row spells it: a string as
 * itself, a number as RFC 8785 lays it out, anything else as Python's `repr()`. The reference prints
 * a payload it has no renderer for this way, so a second implementation that wants to print the same
 * row has to spell values the same.
 */
export function pyStr(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : pyRepr(value);
}

/**
 * Python's `repr()` of a JSON value, except that a number, nested or not, is spelled as RFC 8785 does:
 * the reference prints numbers by value through its chain serialiser (b3cd8c5), never by the text the
 * writer stored, so `1e-06` in the file prints as `0.000001` and `120.0` as `120` in both implementations.
 */
export function pyRepr(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return pyNumber(value);
  if (typeof value === "string") return pyString(value);
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  return `{${Object.entries(value)
    .map(([k, v]) => `${pyString(k)}: ${pyRepr(v)}`)
    .join(", ")}}`;
}

/**
 * The RFC 8785 §3.2.2.3 layout, which is ECMAScript's own: shortest round-trip digits, plain form for
 * 1e-7 < |n| < 1e21, a signed one-digit-or-more exponent outside (`1e-7`, `1e+21`), negative zero as `0`.
 * Python's `repr` differs below 1e-4 and from 1e16 (`1e-06`, `1e+16`) and on an integral float (`120.0`);
 * the chain's serialiser is reused so the row and the hash can never disagree on a number's spelling.
 * A number in a JSON value is finite (JSON has no NaN or Infinity), so `canonicalize` cannot throw here.
 * One difference remains: an integer from 1e21 is a Python int, printed in full, and a double here.
 */
function pyNumber(n: number): string {
  return canonicalize(n);
}

/** Characters Python's `str.isprintable` rejects: the C and Z categories, except the space. */
const UNPRINTABLE = /[\p{C}\p{Z}]/u;

function pyString(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    if (ch === "\\") out += "\\\\";
    else if (ch === quote) out += `\\${ch}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch !== " " && UNPRINTABLE.test(ch)) {
      const code = ch.codePointAt(0) as number;
      if (code < 0x100) out += `\\x${code.toString(16).padStart(2, "0")}`;
      else if (code < 0x10000) out += `\\u${code.toString(16).padStart(4, "0")}`;
      else out += `\\U${code.toString(16).padStart(8, "0")}`;
    } else out += ch;
  }
  return out + quote;
}
