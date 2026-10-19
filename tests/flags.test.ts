import { describe, expect, it } from "vitest";
import {
  FLAGS,
  FLAGS_ENV,
  FlagError,
  flagsOn,
  isOn,
  RFC0036,
  RFC0037,
  RFC0038,
} from "../src/flags.js";
import { LogbookError } from "../src/store.js";

describe("the draft-RFC flags (LOGBOOK_TS_FLAGS)", () => {
  it("names five flags, rfc0036, rfc0037, rfc0038, rfc0040 and rfc0041, read from LOGBOOK_TS_FLAGS", () => {
    expect(FLAGS).toEqual(["rfc0036", "rfc0037", "rfc0038", "rfc0040", "rfc0041"]);
    expect(RFC0036).toBe("rfc0036");
    expect(RFC0037).toBe("rfc0037");
    expect(RFC0038).toBe("rfc0038");
    expect(FLAGS_ENV).toBe("LOGBOOK_TS_FLAGS");
  });

  it("is off when the variable is unset or empty", () => {
    expect(isOn(RFC0036, {})).toBe(false);
    expect(isOn(RFC0036, { LOGBOOK_TS_FLAGS: "" })).toBe(false);
    expect(isOn(RFC0036, { LOGBOOK_TS_FLAGS: " , " })).toBe(false);
    expect([...flagsOn({})]).toEqual([]);
  });

  it("is on when the variable names it, alone or in a list with spaces or commas", () => {
    expect(isOn(RFC0036, { LOGBOOK_TS_FLAGS: "rfc0036" })).toBe(true);
    expect(isOn(RFC0036, { LOGBOOK_TS_FLAGS: " rfc0036 ," })).toBe(true);
    expect(isOn(RFC0036, { LOGBOOK_TS_FLAGS: "rfc0036 rfc0036" })).toBe(true);
  });

  it("turns each flag on alone: one RFC's draft never turns another's on", () => {
    const env = { LOGBOOK_TS_FLAGS: "rfc0038" };
    expect([isOn(RFC0036, env), isOn(RFC0037, env), isOn(RFC0038, env)]).toEqual([
      false,
      false,
      true,
    ]);
    expect([...flagsOn({ LOGBOOK_TS_FLAGS: "rfc0037,rfc0036" })].sort()).toEqual([
      "rfc0036",
      "rfc0037",
    ]);
  });

  it("refuses a name it does not know, so a typo never reads as off", () => {
    const run = (): boolean => isOn(RFC0036, { LOGBOOK_TS_FLAGS: "rfc36" });
    expect(run).toThrow(FlagError);
    expect(run).toThrow(LogbookError);
    expect(run).toThrow(
      "LOGBOOK_TS_FLAGS names rfc36, which is not a flag of this implementation; the flags are rfc0036, rfc0037, rfc0038, rfc0040, rfc0041",
    );
  });

  it("reads the process environment by default", () => {
    const before = process.env[FLAGS_ENV];
    try {
      delete process.env[FLAGS_ENV];
      expect(isOn(RFC0036)).toBe(false);
      process.env[FLAGS_ENV] = "rfc0036";
      expect(isOn(RFC0036)).toBe(true);
    } finally {
      if (before === undefined) delete process.env[FLAGS_ENV];
      else process.env[FLAGS_ENV] = before;
    }
  });
});
