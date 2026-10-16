import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import {
  checkDayStart,
  DAY_START,
  DayStartError,
  DEFAULT_DAY_START,
  localDayOf,
  localToday,
  readDayStart,
} from "../src/dayStart.js";
import { FLAGS_ENV } from "../src/flags.js";
import { showDay } from "../src/show.js";
import { LogbookError } from "../src/store.js";
import type { Meta } from "../src/types.js";
import { cleanup, copySample, readMetaFile, writeMeta } from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

const META: Meta = {
  format: "logbook/0.2",
  owner_id: "00000000-0000-4000-8000-000000000001",
  created_at: "2026-03-01T06:00:00Z",
  timezone: "Europe/Oslo",
  seq: 0,
  head: "0".repeat(64),
};
const meta = (dayStart: unknown): Meta => ({ ...META, [DAY_START]: dayStart }) as unknown as Meta;

/** The reference's sentence (openlogbook 0.6.1, run on the conformance sample with the key set), after `<command>: `. */
const notAClock = (repr: string): string =>
  `logbook.json has day_start ${repr}, which is not a clock from 00:00 to 23:59 written HH:MM; a reader that groups lines by day refuses rather than guess (RFC 0036): write it as "06:00", or remove the key for midnight`;

const notYet = (repr: string): string =>
  `logbook.json has day_start ${repr}, and this implementation does not yet put a line on a day by it; a reader that groups lines by day refuses rather than guess (RFC 0036)`;

describe("day_start in logbook.json (RFC 0036): read", () => {
  it("is midnight when absent, as every record written so far is, and when null, as the reference reads it", () => {
    expect(DEFAULT_DAY_START).toBe("00:00");
    expect(readDayStart(META)).toBe("00:00");
    expect(readDayStart(meta(null))).toBe("00:00");
  });

  it("is the clock written, HH:MM from 00:00 to 23:59", () => {
    for (const clock of ["00:00", "06:00", "05:30", "12:00", "23:59"]) {
      expect(readDayStart(meta(clock))).toBe(clock);
    }
  });

  // Every value the reference was run on, with what it printed.
  const refused: Array<[unknown, string]> = [
    ["6am", "'6am'"],
    ["24:00", "'24:00'"],
    ["6:00", "'6:00'"],
    [6, "6"],
    ["06:00:00", "'06:00:00'"],
    ["06:60", "'06:60'"],
    ["", "''"],
    [true, "True"],
    ["00:00 ", "'00:00 '"],
    [["06:00"], "['06:00']"],
  ];
  for (const [value, repr] of refused) {
    it(`refuses ${JSON.stringify(value)} in the reference's words`, () => {
      const run = (): string => readDayStart(meta(value));
      expect(run).toThrow(DayStartError);
      expect(run).toThrow(LogbookError);
      expect(run).toThrow(notAClock(repr));
    });
  }
});

describe("the local day of an instant (RFC 0036, the rule)", () => {
  const at = (iso: string): number => Date.parse(iso);
  const OSLO = "Europe/Oslo";

  it("is the calendar day in the record's zone at midnight", () => {
    expect(localDayOf(at("2026-06-12T23:30:00Z"), OSLO)).toBe("2026-06-13");
    expect(localDayOf(at("2026-06-12T21:59:59Z"), OSLO, "00:00")).toBe("2026-06-12");
  });

  it("with 06:00, a line at 02:00 on the 13th is on the 12th, at 06:00 or 23:30 on the 13th", () => {
    // CEST, UTC+2 in June.
    expect(localDayOf(at("2026-06-13T00:00:00Z"), OSLO, "06:00")).toBe("2026-06-12");
    expect(localDayOf(at("2026-06-13T03:59:59Z"), OSLO, "06:00")).toBe("2026-06-12");
    expect(localDayOf(at("2026-06-13T04:00:00Z"), OSLO, "06:00")).toBe("2026-06-13");
    expect(localDayOf(at("2026-06-13T21:30:00Z"), OSLO, "06:00")).toBe("2026-06-13");
  });

  it("compares the wall clock after localising, so the night the clocks go back moves no line", () => {
    // 2026-10-25, Oslo: 03:00 CEST becomes 02:00 CET. Both 02:30s are before 06:00: the 24th.
    expect(localDayOf(at("2026-10-25T00:30:00Z"), OSLO, "06:00")).toBe("2026-10-24");
    expect(localDayOf(at("2026-10-25T01:30:00Z"), OSLO, "06:00")).toBe("2026-10-24");
    expect(localDayOf(at("2026-10-25T04:59:59Z"), OSLO, "06:00")).toBe("2026-10-24");
    expect(localDayOf(at("2026-10-25T05:00:00Z"), OSLO, "06:00")).toBe("2026-10-25");
  });

  it("and the night they go forward", () => {
    // 2026-03-29, Oslo: 02:00 CET becomes 03:00 CEST; 05:59 CEST is 03:59Z.
    expect(localDayOf(at("2026-03-29T03:59:00Z"), OSLO, "06:00")).toBe("2026-03-28");
    expect(localDayOf(at("2026-03-29T04:00:00Z"), OSLO, "06:00")).toBe("2026-03-29");
  });

  it("puts the first of a month on the last of the one before, and of a year", () => {
    expect(localDayOf(at("2026-01-01T01:00:00Z"), OSLO, "06:00")).toBe("2025-12-31");
    expect(localDayOf(at("2026-03-01T04:00:00Z"), OSLO, "06:00")).toBe("2026-02-28");
  });

  it("names today by the same rule", () => {
    expect(localToday(new Date("2026-10-13T03:00:00Z"), OSLO, "06:00")).toBe("2026-10-12");
    expect(localToday(new Date("2026-10-13T03:00:00Z"), OSLO)).toBe("2026-10-13");
  });
});

describe("a reader that groups by day, under the rfc0036 flag", () => {
  const on = (): void => {
    vi.stubEnv(FLAGS_ENV, "rfc0036");
  };

  it("does not look at the key with the flag off: the record reads as it did", () => {
    vi.stubEnv(FLAGS_ENV, "");
    for (const value of ["6am", "06:00", 6]) {
      expect(() => checkDayStart(meta(value))).not.toThrow();
    }
  });

  it("reads midnight, written or absent or null, as the calendar day", () => {
    on();
    expect(checkDayStart(META)).toBe("00:00");
    expect(checkDayStart(meta("00:00"))).toBe("00:00");
    expect(checkDayStart(meta(null))).toBe("00:00");
  });

  it("refuses a value that is not a clock, in the reference's words", () => {
    on();
    expect(() => checkDayStart(meta("6am"))).toThrow(notAClock("'6am'"));
  });

  it("refuses a clock other than midnight, since no reader here puts a line on a day by it yet", () => {
    on();
    expect(() => checkDayStart(meta("06:00"))).toThrow(DayStartError);
    expect(() => checkDayStart(meta("06:00"))).toThrow(notYet("'06:00'"));
  });

  it("is refused by the library's readers too, not only the CLI", () => {
    on();
    const root = copySample();
    writeMeta(root, { ...readMetaFile(root), day_start: "6am" });
    expect(() => showDay(root, { day: "2026-03-02" })).toThrow(notAClock("'6am'"));
  });
});

describe("the CLI refuses as the reference does: `<command>: <sentence>`, exit 2, nothing printed", () => {
  const run = (argv: string[]): { code: number; out: string; err: string } => {
    let out = "";
    let err = "";
    const code = main(argv, {
      stdout: (t) => {
        out += t;
      },
      stderr: (t) => {
        err += t;
      },
    });
    return { code, out, err };
  };

  const commands = (root: string): Array<[string, string[]]> => [
    ["show", ["show", root, "--day", "2026-03-02"]],
    ["show", ["show", root, "--since", "2026-03-01", "--until", "2026-03-03"]],
    ["day", ["day", root, "2026-03-02"]],
    ["days", ["days", root]],
    ["trips", ["trips", root]],
    ["rollup", ["rollup", "countries", root]],
    ["rollup", ["rollup", "nights", root]],
    ["people", ["people", root]],
    ["stats", ["stats", root]],
    ["sources", ["sources", root, "--gaps", "--since", "2026-03-01"]],
  ];

  it("on every command that groups lines by day, with a value that is not a clock", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0036");
    const root = copySample();
    writeMeta(root, { ...readMetaFile(root), day_start: "24:00" });
    for (const [name, argv] of commands(root)) {
      const { code, out, err } = run(argv);
      expect({ argv: argv.join(" "), code, out, err }).toEqual({
        argv: argv.join(" "),
        code: 2,
        out: "",
        err: `${name}: ${notAClock("'24:00'")}\n`,
      });
    }
  });

  it("and with a clock it does not apply yet", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0036");
    const root = copySample();
    writeMeta(root, { ...readMetaFile(root), day_start: "06:00" });
    for (const [name, argv] of commands(root)) {
      expect(run(argv).err).toBe(`${name}: ${notYet("'06:00'")}\n`);
    }
  });

  it("but verify and the list of sources never group by day, and go on", () => {
    vi.stubEnv(FLAGS_ENV, "rfc0036");
    const root = copySample();
    writeMeta(root, { ...readMetaFile(root), day_start: "6am" });
    expect(run(["verify", root]).code).toBe(0);
    expect(run(["sources", root]).code).toBe(0);
  });

  it("and with the flag off every command reads the record as before", () => {
    vi.stubEnv(FLAGS_ENV, "");
    const root = copySample();
    // `stats` prints how long it took; the rest is compared whole.
    const runAll = (): Array<{ code: number; out: string; err: string }> =>
      commands(root).map(([, argv]) => {
        const r = run(argv);
        return { ...r, out: r.out.replace(/took \d+\.\d+s/, "took ?s") };
      });
    const before = runAll();
    writeMeta(root, { ...readMetaFile(root), day_start: "6am" });
    const after = runAll();
    expect(after).toEqual(before);
    expect(after.every((r) => r.code === 0 || r.code === 1)).toBe(true);
  });

  it("names an unknown flag and stops", () => {
    vi.stubEnv(FLAGS_ENV, "rfc36");
    const root = copySample();
    const { code, err } = run(["show", root, "--day", "2026-03-02"]);
    expect(code).toBe(1);
    expect(err).toBe(
      "error: LOGBOOK_TS_FLAGS names rfc36, which is not a flag of this implementation; the flags are rfc0036, rfc0037, rfc0038\n",
    );
  });
});
