import { describe, expect, it } from "vitest";
import { pyRepr, pyStr } from "../src/pyrepr.js";

// The reference implementation's generic row is `key=value` over the payload: a string as itself, a
// nested dict or list as Python's repr, and since b3cd8c5 (2026-10-02) every number, nested or not,
// as RFC 8785 §3.2.2.3 lays it out, by value and never by the text the writer stored. These vectors
// were taken from `logbook show` of openlogbook on synthetic payloads (see tests/fixtures/*/expected-show
// and the reference's own tests/test_show.py).
describe("pyStr: Python str() of a JSON value", () => {
  it("prints a string as itself and scalars as Python spells them", () => {
    expect(pyStr("it's")).toBe("it's");
    expect(pyStr("tab\there")).toBe("tab\there");
    expect(pyStr(true)).toBe("True");
    expect(pyStr(false)).toBe("False");
    expect(pyStr(null)).toBe("None");
    expect(pyStr(0)).toBe("0");
    expect(pyStr(-0)).toBe("0");
    expect(pyStr(100)).toBe("100");
    expect(pyStr(-30)).toBe("-30");
  });

  it("prints a non-integral number as RFC 8785 does: plain form for 1e-7 < |n| < 1e21, else a signed exponent", () => {
    expect(pyStr(2.5)).toBe("2.5");
    expect(pyStr(-42.5)).toBe("-42.5");
    expect(pyStr(78.4)).toBe("78.4");
    expect(pyStr(0.0001)).toBe("0.0001");
    expect(pyStr(0.00001)).toBe("0.00001"); // Python's str would be 1e-05
    expect(pyStr(0.000001)).toBe("0.000001"); // the conformance sample's `epsilon`; Python: 1e-06
    expect(pyStr(1e-7)).toBe("1e-7"); // Python: 1e-07
    expect(pyStr(1.5e-7)).toBe("1.5e-7");
    expect(pyStr(-0.0000033333333333333333)).toBe("-0.0000033333333333333333");
    expect(pyStr(123456789012345.6)).toBe("123456789012345.6");
    expect(pyStr(123456.789)).toBe("123456.789");
    expect(pyStr(1424953923781206.2)).toBe("1424953923781206.2"); // Python: 1.4249539237812062e+15
    expect(pyStr(1e21)).toBe("1e+21");
    expect(pyStr(1e100)).toBe("1e+100");
    expect(pyStr(1.5e300)).toBe("1.5e+300");
    expect(pyStr(1.7976931348623157e308)).toBe("1.7976931348623157e+308");
    expect(pyStr(5e-324)).toBe("5e-324");
  });

  it("prints an integral number in full below 1e21, as both RFC 8785 and Python do", () => {
    expect(pyStr(120)).toBe("120"); // the sample stores `120.0`; by value it is 120 (SPEC-QUESTIONS 24)
    expect(pyStr(1e16)).toBe("10000000000000000");
    expect(pyStr(1e20)).toBe("100000000000000000000"); // the conformance sample's `offset`, stored as `1e+20`
    expect(pyStr(9007199254740992)).toBe("9007199254740992");
    expect(pyStr(999999999999999900000)).toBe("999999999999999900000");
  });

  it("prints an integral number from 1e21 in exponent form, where Python's int would print in full", () => {
    // JSON.parse reads every number as a double, so an integer this large has lost its digits before
    // it can be printed; the reference, reading it as a Python int, prints `12345678901234567890123`.
    expect(pyStr(JSON.parse("12345678901234567890123") as number)).toBe("1.2345678901234568e+22");
    expect(pyStr(1e23)).toBe("1e+23");
  });
});

describe("pyRepr: Python repr() of a JSON value", () => {
  it("quotes strings the way Python does", () => {
    expect(pyRepr("plain")).toBe("'plain'");
    expect(pyRepr("it's")).toBe('"it\'s"');
    expect(pyRepr('say "hi"')).toBe("'say \"hi\"'");
    expect(pyRepr("both ' and \"")).toBe("'both \\' and \"'");
    expect(pyRepr("back\\slash")).toBe("'back\\\\slash'");
    expect(pyRepr("tab\there")).toBe("'tab\\there'");
    expect(pyRepr("nl\nhere")).toBe("'nl\\nhere'");
    expect(pyRepr("cr\rhere")).toBe("'cr\\rhere'");
    expect(pyRepr("\x01")).toBe("'\\x01'");
    expect(pyRepr("\x7f")).toBe("'\\x7f'");
    expect(pyRepr("\xa0")).toBe("'\\xa0'");
    expect(pyRepr("ø")).toBe("'ø'");
    expect(pyRepr("")).toBe("''");
  });

  it("prints dicts and lists in file order with Python spacing", () => {
    expect(pyRepr({ kind: "email", value: "ola@example.org" })).toBe(
      "{'kind': 'email', 'value': 'ola@example.org'}",
    );
    expect(pyRepr({ x: null, y: [1, 2.5] })).toBe("{'x': None, 'y': [1, 2.5]}");
    expect(pyRepr(["a", "b"])).toBe("['a', 'b']");
    expect(pyRepr([])).toBe("[]");
    expect(pyRepr({})).toBe("{}");
    expect(pyRepr({ t: true, f: false, e: 1e21, z: 0.000001 })).toBe(
      "{'t': True, 'f': False, 'e': 1e+21, 'z': 0.000001}",
    );
    // The reference's own vector (tests/test_show.py, b3cd8c5): Python spelling for everything but numbers.
    expect(pyRepr({ epsilon: 1e-6, gain: 1e21, offset: 1e20 })).toBe(
      "{'epsilon': 0.000001, 'gain': 1e+21, 'offset': 100000000000000000000}",
    );
    expect(pyRepr([true, null, "it's", -0.5])).toBe('[True, None, "it\'s", -0.5]');
  });
});
