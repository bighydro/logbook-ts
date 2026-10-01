import type { JsonValue } from "./types.js";

/**
 * Python's `str()` of a JSON value: a string as itself, anything else as `repr()`. The reference
 * implementation prints a payload it has no renderer for as `key=str(value)`, so a second
 * implementation that wants to print the same row has to spell values the way Python does.
 */
export function pyStr(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : pyRepr(value);
}

/** Python's `repr()` of a JSON value as `json.loads` would have parsed it from canonical JSON. */
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
 * RFC 8785 writes an integral number below 1e21 without a point or an exponent, which Python
 * parses as an int and prints in full; everything else is a float, whose repr uses the shortest
 * round-trip digits with an exponent (two digits at least, always signed) below 1e-4 and from 1e16.
 */
function pyNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return n === 0 ? "0" : String(n);
  const [mantissa, e] = n.toExponential().split("e") as [string, string];
  const exponent = Number(e);
  if (exponent >= -4 && exponent < 16) return String(n);
  const abs = Math.abs(exponent);
  return `${mantissa}e${exponent < 0 ? "-" : "+"}${abs < 10 ? `0${abs}` : abs}`;
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
