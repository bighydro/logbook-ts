import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalize, JcsError } from "../src/jcs.js";

/** Build an IEEE 754 double from its 64-bit hex pattern, as RFC 8785 Appendix B lists them. */
function doubleFromHex(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

const ch = (code: number): string => String.fromCharCode(code);

describe("canonicalize - RFC 8785 section 3.2.3 worked example", () => {
  // The RFC's input, as JSON text (backslashes doubled so the JSON parser sees the escapes).
  const rfcInput =
    "{\n" +
    '  "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],\n' +
    '  "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",\n' +
    '  "literals": [null, true, false]\n' +
    "}";

  it("produces the byte-exact output from the RFC", () => {
    const expected =
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
      `"string":"\u{20ac}$\\u000f\\nA'B\\"\\\\\\\\\\"/"}`;
    const out = canonicalize(JSON.parse(rfcInput));
    expect(out).toBe(expected);
    // The RFC gives the result as UTF-8 bytes; the Euro sign is the only multi-byte character.
    expect(Buffer.from(out, "utf8").length).toBe(expected.length + 2);
  });

  it("sorts object keys by UTF-16 code units, not code points (RFC 8785 section 3.2.3)", () => {
    const input = JSON.parse(
      "{" +
        '"\\u20ac": "Euro Sign",' +
        '"\\r": "Carriage Return",' +
        '"\\ufb33": "Hebrew Letter Dalet With Dagesh",' +
        '"1": "One",' +
        '"\\ud83d\\ude00": "Emoji: Grinning Face",' +
        '"\\u0080": "Control",' +
        '"\\u00f6": "Latin Small Letter O With Diaeresis"' +
        "}",
    );
    expect(canonicalize(input)).toBe(
      `{"\\r":"Carriage Return","1":"One","${ch(0x80)}":"Control","\u{f6}":"Latin Small Letter O With Diaeresis",` +
        `"\u{20ac}":"Euro Sign","\u{1f600}":"Emoji: Grinning Face","\u{fb33}":"Hebrew Letter Dalet With Dagesh"}`,
    );
  });

  it("sorts keys of nested objects and leaves arrays in order", () => {
    expect(canonicalize({ b: { z: [3, { y: 1, x: 2 }], a: null }, a: [] })).toBe(
      '{"a":[],"b":{"a":null,"z":[3,{"x":2,"y":1}]}}',
    );
  });

  it("sorts an empty key and integer-like keys by code units too", () => {
    expect(canonicalize({ "0": 1, "": 2, "-1": 3, "10": 4, "9": 5 })).toBe(
      '{"":2,"-1":3,"0":1,"10":4,"9":5}',
    );
  });
});

describe("canonicalize - RFC 8785 Appendix B number vectors", () => {
  const vectors: Array<[string, string]> = [
    ["0000000000000000", "0"],
    ["8000000000000000", "0"],
    ["0000000000000001", "5e-324"],
    ["8000000000000001", "-5e-324"],
    ["7fefffffffffffff", "1.7976931348623157e+308"],
    ["ffefffffffffffff", "-1.7976931348623157e+308"],
    ["4340000000000000", "9007199254740992"],
    ["c340000000000000", "-9007199254740992"],
    ["4430000000000000", "295147905179352830000"],
    ["44b52d02c7e14af5", "9.999999999999997e+22"],
    ["44b52d02c7e14af6", "1e+23"],
    ["44b52d02c7e14af7", "1.0000000000000001e+23"],
    ["444b1ae4d6e2ef4e", "999999999999999700000"],
    ["444b1ae4d6e2ef4f", "999999999999999900000"],
    ["444b1ae4d6e2ef50", "1e+21"],
    ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
    ["3eb0c6f7a0b5ed8d", "0.000001"],
    ["41b3de4355555553", "333333333.3333332"],
    ["41b3de4355555554", "333333333.33333325"],
    ["41b3de4355555555", "333333333.3333333"],
    ["41b3de4355555556", "333333333.3333334"],
    ["41b3de4355555557", "333333333.33333343"],
    ["becbf647612f3696", "-0.0000033333333333333333"],
    ["43143ff3c1cb0959", "1424953923781206.2"],
  ];
  for (const [hex, expected] of vectors) {
    it(`0x${hex} -> ${expected}`, () => {
      expect(canonicalize(doubleFromHex(hex))).toBe(expected);
    });
  }

  it("rejects NaN and both infinities", () => {
    expect(() => canonicalize(doubleFromHex("7fffffffffffffff"))).toThrow(JcsError);
    expect(() => canonicalize(doubleFromHex("7ff0000000000000"))).toThrow(JcsError);
    expect(() => canonicalize(Number.NEGATIVE_INFINITY)).toThrow(JcsError);
    expect(() => canonicalize({ a: [Number.NaN] })).toThrow(JcsError);
  });

  it("lays out the values the sample logbook relies on", () => {
    expect(canonicalize([120.0, 0.0, 1e21, 1e20, 1e-6, -14.5, 8.25, 10.75])).toBe(
      "[120,0,1e+21,100000000000000000000,0.000001,-14.5,8.25,10.75]",
    );
  });
});

describe("canonicalize - strings", () => {
  it("escapes only what RFC 8785 section 3.2.2.2 says to escape", () => {
    expect(canonicalize('\b\t\n\f\r"\\/')).toBe('"\\b\\t\\n\\f\\r\\"\\\\/"');
    expect(canonicalize(ch(0) + ch(0x1f) + ch(0x7f))).toBe(`"\\u0000\\u001f${ch(0x7f)}"`);
    expect(canonicalize("\u{2028}\u{2029}")).toBe('"\u{2028}\u{2029}"');
    expect(canonicalize("Troms\u{f8} \u{1f600}")).toBe('"Troms\u{f8} \u{1f600}"');
  });

  it("uses lowercase hex in escapes for control characters", () => {
    expect(canonicalize(ch(0x1b) + ch(0x1e))).toBe('"\\u001b\\u001e"');
    for (let c = 0; c < 0x20; c++) {
      const out = canonicalize(ch(c));
      expect(out).toMatch(/^"(\\[btnfr]|\\u00[0-1][0-9a-f])"$/);
      expect(JSON.parse(out)).toBe(ch(c));
    }
  });

  it("rejects lone surrogates in values and keys", () => {
    expect(() => canonicalize(ch(0xd83d))).toThrow(JcsError);
    expect(() => canonicalize(`a${ch(0xde00)}b`)).toThrow(JcsError);
    expect(() => canonicalize(ch(0xde00) + ch(0xd83d))).toThrow(JcsError);
    expect(() => canonicalize({ [ch(0xd800)]: 1 })).toThrow(JcsError);
    expect(canonicalize(ch(0xd83d) + ch(0xde00))).toBe('"\u{1f600}"');
  });
});

describe("canonicalize - non-JSON input", () => {
  it("rejects undefined, functions, symbols and bigint", () => {
    expect(() => canonicalize(undefined)).toThrow(JcsError);
    expect(() => canonicalize(() => 1)).toThrow(JcsError);
    expect(() => canonicalize(Symbol("x"))).toThrow(JcsError);
    expect(() => canonicalize(10n)).toThrow(JcsError);
    expect(() => canonicalize({ a: undefined })).toThrow(JcsError);
    expect(() => canonicalize([undefined])).toThrow(JcsError);
  });

  it("rejects non-plain objects such as Date and Map", () => {
    expect(() => canonicalize(new Date(0))).toThrow(JcsError);
    expect(() => canonicalize(new Map())).toThrow(JcsError);
  });

  it("accepts objects without a prototype", () => {
    const o = Object.create(null) as Record<string, unknown>;
    o.k = 1;
    expect(canonicalize(o)).toBe('{"k":1}');
  });
});

/**
 * A deliberately different second implementation to check against: JSON.stringify given a
 * property list. With an array replacer, JSON.stringify emits keys in the list's order at every
 * level, so a sorted list of every key in the tree yields RFC 8785 key order, and JSON.stringify
 * supplies the ECMAScript number layout on its own.
 *
 * JSON.stringify reads each listed key with an ordinary property get, which on a plain object
 * finds the inherited `__proto__` accessor whenever that name is in the list and emits
 * `Object.prototype` as a key the object does not own (issue #5). So the tree is first copied into
 * objects without a prototype, where every property found is an own one; `Object.defineProperty`
 * keeps an own `__proto__` a data property on the copy as well.
 */
function reference(value: unknown): string {
  const keys = new Set<string>();
  const copy = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(copy);
    if (v === null || typeof v !== "object") return v;
    const out = Object.create(null) as Record<string, unknown>;
    for (const k of Object.keys(v)) {
      keys.add(k);
      Object.defineProperty(out, k, {
        value: copy((v as Record<string, unknown>)[k]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  };
  const plain = copy(value);
  return JSON.stringify(plain, [...keys].sort());
}

describe("canonicalize - properties", () => {
  const json = fc.jsonValue({ maxDepth: 6 });

  it("round-trips any JSON value through parse to identical bytes", () => {
    fc.assert(
      fc.property(json, (value) => {
        const once = canonicalize(value);
        const twice = canonicalize(JSON.parse(once));
        expect(twice).toBe(once);
      }),
      { numRuns: 500 },
    );
  });

  it("agrees with an independent JSON.stringify-with-property-list reference", () => {
    fc.assert(
      fc.property(json, (value) => {
        expect(canonicalize(value)).toBe(reference(value));
      }),
      { numRuns: 500 },
    );
  });

  // Issue #5: fast-check once drew a value with an own `__proto__` data property on a nested object,
  // `{"": {"__proto__": ""}}`, and the reference helper leaked a second top-level `"__proto__"` key.
  // The counterexample is replayed by its seed and path so that it is run every time, and the same
  // shape is built with JSON.parse (which creates an own `__proto__` property, as a .jsonl line would).
  it("agrees with the reference on an own __proto__ property at any depth (issue #5)", () => {
    fc.assert(
      fc.property(json, (value) => {
        expect(canonicalize(value)).toBe(reference(value));
      }),
      { seed: -841407877, path: "351:1:0:0:2:87:87", endOnFailure: true },
    );
    const nested = JSON.parse('{"":{"__proto__":""}}') as unknown;
    expect(reference(nested)).toBe('{"":{"__proto__":""}}');
    expect(canonicalize(nested)).toBe('{"":{"__proto__":""}}');
    const top = JSON.parse('{"__proto__":{"b":1,"a":[{"__proto__":null}]},"a":2}') as unknown;
    expect(reference(top)).toBe('{"__proto__":{"a":[{"__proto__":null}],"b":1},"a":2}');
    expect(canonicalize(top)).toBe(reference(top));
  });

  it("contains no leading or trailing whitespace and parses back to an equal value", () => {
    fc.assert(
      fc.property(json, (value) => {
        const out = canonicalize(value);
        expect(JSON.parse(out)).toEqual(JSON.parse(JSON.stringify(value)));
        expect(out).not.toMatch(/^\s|\s$/);
      }),
      { numRuns: 300 },
    );
  });

  it("is a total function on the finite doubles and reads back exactly", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (n) => {
        const out = canonicalize(n);
        expect(Number(out)).toBe(n === 0 ? 0 : n);
        expect(out).not.toMatch(/E|Infinity|NaN/);
      }),
      { numRuns: 2000 },
    );
  });

  it("orders keys of arbitrary well-formed strings by UTF-16 code units", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ unit: "grapheme-composite" }), { minLength: 2 }), (ks) => {
        const unique = [...new Set(ks)];
        const obj: Record<string, number> = {};
        unique.forEach((k, i) => {
          Object.defineProperty(obj, k, { value: i, enumerable: true });
        });
        const out = canonicalize(obj);
        const emitted = [...out.matchAll(/"((?:[^"\\]|\\.)*)":/g)].map((m) =>
          JSON.parse(`"${m[1]}"`),
        );
        expect(emitted).toEqual([...unique].sort());
      }),
      { numRuns: 300 },
    );
  });
});
