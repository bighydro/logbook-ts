import { describe, expect, it } from "vitest";
import { pyRepr, pyStr } from "../src/pyrepr.js";

// The reference implementation's generic row is `key=str(value)` over the payload, and `str` of a
// nested dict or list is Python's repr. These vectors were taken from `logbook show` of openlogbook
// at b60ae11 on synthetic payloads (see tests/fixtures/profiles-sample/expected-show).
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

  it("prints floats as Python repr: exponent form below 1e-4 and from 1e16, two-digit signed exponent", () => {
    expect(pyStr(2.5)).toBe("2.5");
    expect(pyStr(-42.5)).toBe("-42.5");
    expect(pyStr(78.4)).toBe("78.4");
    expect(pyStr(0.0001)).toBe("0.0001");
    expect(pyStr(0.00001)).toBe("1e-05");
    expect(pyStr(0.000001)).toBe("1e-06");
    expect(pyStr(1e-7)).toBe("1e-07");
    expect(pyStr(1.5e-7)).toBe("1.5e-07");
    expect(pyStr(123456789012345.6)).toBe("123456789012345.6");
    expect(pyStr(123456.789)).toBe("123456.789");
    expect(pyStr(1e16)).toBe("10000000000000000"); // an integer in the file, so a Python int
    expect(pyStr(1e21)).toBe("1e+21");
    expect(pyStr(1e100)).toBe("1e+100");
    expect(pyStr(1.5e300)).toBe("1.5e+300");
    expect(pyStr(1.7976931348623157e308)).toBe("1.7976931348623157e+308");
    expect(pyStr(5e-324)).toBe("5e-324");
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
      "{'t': True, 'f': False, 'e': 1e+21, 'z': 1e-06}",
    );
  });
});
