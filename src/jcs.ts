/**
 * RFC 8785 — JSON Canonicalization Scheme (JCS), implemented by hand.
 *
 *  - object keys sorted by UTF-16 code units (§3.2.3)
 *  - no whitespace
 *  - numbers laid out per ECMAScript Number::toString (§3.2.2.3); NaN and ±Infinity are errors
 *  - strings escaped per §3.2.2.2: \b \t \n \f \r \" \\, other C0 controls as \u00xx (lowercase),
 *    everything else literal; lone surrogates are errors because they cannot be encoded as UTF-8
 *
 * The result is a JS string; encode it as UTF-8 to get the canonical bytes.
 */

export class JcsError extends Error {
  override readonly name = "JcsError";
}

/** Canonical JSON text for any JSON-compatible value. Throws JcsError for anything else. */
export function canonicalize(value: unknown): string {
  const out: string[] = [];
  serialize(value, out, "$");
  return out.join("");
}

function serialize(value: unknown, out: string[], path: string): void {
  if (value === null) {
    out.push("null");
    return;
  }
  switch (typeof value) {
    case "boolean":
      out.push(value ? "true" : "false");
      return;
    case "number":
      out.push(serializeNumber(value, path));
      return;
    case "string":
      out.push(serializeString(value, path));
      return;
    case "object":
      break;
    default:
      throw new JcsError(`${path}: ${typeof value} is not a JSON value`);
  }
  if (Array.isArray(value)) {
    out.push("[");
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out.push(",");
      serialize(value[i], out, `${path}[${i}]`);
    }
    out.push("]");
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new JcsError(`${path}: only plain objects and arrays are JSON values`);
  }
  const record = value as Record<string, unknown>;
  // Default Array.prototype.sort compares strings by UTF-16 code units: exactly RFC 8785 §3.2.3.
  const keys = Object.keys(record).sort();
  out.push("{");
  let first = true;
  for (const key of keys) {
    const item = record[key];
    if (item === undefined) throw new JcsError(`${path}.${key}: undefined is not a JSON value`);
    if (!first) out.push(",");
    first = false;
    out.push(serializeString(key, `${path}.${key}`), ":");
    serialize(item, out, `${path}.${key}`);
  }
  out.push("}");
}

function serializeNumber(n: number, path: string): string {
  if (Number.isNaN(n)) throw new JcsError(`${path}: NaN is not a JSON value`);
  if (!Number.isFinite(n)) throw new JcsError(`${path}: Infinity is not a JSON value`);
  // Number.prototype.toString is the ECMAScript Number::toString algorithm RFC 8785 §3.2.2.3
  // requires: shortest round-trip digits, plain form for 1e-7 < |n| < 1e21, exponent form
  // "1e+21" / "5e-324" outside. Negative zero prints as "0".
  if (n === 0) return "0";
  return String(n);
}

const HEX = "0123456789abcdef";

function serializeString(s: string, path: string): string {
  let result = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdfff) {
      // Surrogates: a high one must be followed by a low one; emit the pair literally.
      const next = c <= 0xdbff ? s.charCodeAt(i + 1) : Number.NaN;
      if (c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        result += s[i] as string;
        result += s[i + 1] as string;
        i++;
        continue;
      }
      throw new JcsError(`${path}: lone surrogate U+${c.toString(16)} cannot be encoded as UTF-8`);
    }
    switch (c) {
      case 0x08:
        result += "\\b";
        break;
      case 0x09:
        result += "\\t";
        break;
      case 0x0a:
        result += "\\n";
        break;
      case 0x0c:
        result += "\\f";
        break;
      case 0x0d:
        result += "\\r";
        break;
      case 0x22:
        result += '\\"';
        break;
      case 0x5c:
        result += "\\\\";
        break;
      default:
        if (c < 0x20) {
          result += `\\u00${HEX[c >> 4]}${HEX[c & 0xf]}`;
        } else {
          result += s[i] as string;
        }
    }
  }
  return `${result}"`;
}
