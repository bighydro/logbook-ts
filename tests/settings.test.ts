import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDay } from "../src/day.js";
import {
  DEFAULT_STAY_SETTINGS,
  readAssets,
  readOwnerPolicy,
  readPlaces,
  readStaySettings,
  SettingsError,
} from "../src/settings.js";
import { LogbookError } from "../src/store.js";
import { cleanup, tempDir, writeRecord } from "./helpers.js";

afterEach(cleanup);

/** A record folder holding one settings file, as the reference reads it. */
function withFile(rel: string[], text: string): string {
  const root = tempDir();
  mkdirSync(join(root, ...rel.slice(0, -1)), { recursive: true });
  writeFileSync(join(root, ...rel), text, "utf-8");
  return root;
}
const stays = (data: unknown): string => withFile(["policy", "stays.json"], JSON.stringify(data));
const places = (data: unknown): string => withFile(["places.json"], JSON.stringify(data));
const assets = (data: unknown): string => withFile(["assets.json"], JSON.stringify(data));
const owner = (data: unknown): string => withFile(["policy", "owner.json"], JSON.stringify(data));

describe("policy/stays.json is validated as the reference's stays.Settings.from_json validates it", () => {
  it("reads the defaults without the file, the file's values over them, and aboard_min_s", () => {
    expect(readStaySettings(tempDir())).toEqual({ ...DEFAULT_STAY_SETTINGS });
    expect(DEFAULT_STAY_SETTINGS.aboard_min_s).toBe(1200);
    const read = readStaySettings(
      stays({
        stay_min_s: 600,
        night: ["23:00", "07:00"],
        aboard_min_s: 60,
        modes: { walk_max_kmh: 6 },
      }),
    );
    expect(read).toMatchObject({
      stay_min_s: 600,
      night: ["23:00", "07:00"],
      aboard_min_s: 60,
      stop_min_s: 180,
    });
    expect(read.modes).toEqual({ walk_max_kmh: 6, car_max_kmh: 130, flight_min_kmh: 150 });
    // A float of seconds is truncated to an integer, as int() does.
    expect(readStaySettings(stays({ stop_min_s: 90.9 })).stop_min_s).toBe(90);
  });

  it("refuses what the reference refuses, naming the file: not an object, modes, night, seconds, positive numbers", () => {
    const where = (root: string) => join(root, "policy", "stays.json");
    const list = stays([]);
    expect(() => readStaySettings(list)).toThrow(SettingsError);
    expect(() => readStaySettings(list)).toThrow(`${where(list)} must be a JSON object`);
    expect(new SettingsError("x")).toBeInstanceOf(LogbookError);
    const modes = stays({ modes: [] });
    expect(() => readStaySettings(modes)).toThrow(`${where(modes)}: modes must be an object`);
    for (const night of [["22:00"], ["22:00", "8"], "22:00-08:00", ["22:00", 8]]) {
      const broken = stays({ night });
      expect(() => readStaySettings(broken)).toThrow(
        `${where(broken)}: night must be two clock times, like ["22:00", "08:00"]`,
      );
    }
    for (const [key, value, shown] of [
      ["stay_min_s", -1, "-1"],
      ["merge_gap_s", "600", "'600'"],
      ["aboard_window_s", true, "True"],
      ["aboard_min_s", null, "None"],
    ] as const) {
      const broken = stays({ [key]: value });
      expect(() => readStaySettings(broken)).toThrow(
        `${where(broken)}: ${key} must be a number of seconds, not ${shown}`,
      );
    }
    for (const [key, value, shown] of [
      ["radius_m", 0, "0"],
      ["airport_km", -2.5, "-2.5"],
    ] as const) {
      const broken = stays({ [key]: value });
      expect(() => readStaySettings(broken)).toThrow(
        `${where(broken)}: ${key} must be a positive number, not ${shown}`,
      );
    }
    const mode = stays({ modes: { car_max_kmh: "fast" } });
    expect(() => readStaySettings(mode)).toThrow(
      `${where(mode)}: car_max_kmh must be a positive number, not 'fast'`,
    );
    const notJson = withFile(["policy", "stays.json"], "{");
    expect(() => readStaySettings(notJson)).toThrow(`${where(notJson)} is not JSON: `);
  });
});

describe("places.json is validated as the reference's places.read validates it", () => {
  it("reads the places in file order with the settings' radius as the default, none without the file", () => {
    expect(readPlaces(tempDir(), 150)).toEqual([]);
    const read = readPlaces(
      places({
        Home: { lat: 59.91, lon: 10.75, kind: "home", country: "NO" },
        Marina: { lat: "59.905", lon: 10.735, radius_m: 200, tags: ["boat"] },
      }),
      120,
    );
    expect(read).toEqual([
      {
        name: "Home",
        lat: 59.91,
        lon: 10.75,
        radius_m: 120,
        kind: "home",
        tags: [],
        country: "NO",
      },
      { name: "Marina", lat: 59.905, lon: 10.735, radius_m: 200, kind: "other", tags: ["boat"] },
    ]);
  });

  it("refuses what the reference refuses, naming the file and the place", () => {
    const where = (root: string) => join(root, "places.json");
    const list = places([]);
    expect(() => readPlaces(list, 150)).toThrow(SettingsError);
    expect(() => readPlaces(list, 150)).toThrow(
      `${where(list)} must map a place name to {lat, lon, radius_m, kind, tags}`,
    );
    const cases: Array<[unknown, string]> = [
      [{ Home: 1 }, "'Home' must be an object with lat and lon"],
      [{ Home: { lat: 59.9 } }, "'Home' needs numeric lat and lon (and radius_m)"],
      [{ Home: { lat: "north", lon: 10 } }, "'Home' needs numeric lat and lon (and radius_m)"],
      [
        { Home: { lat: 59.9, lon: 10, radius_m: null } },
        "'Home' needs numeric lat and lon (and radius_m)",
      ],
      [{ Home: { lat: 59.9, lon: 10, tags: "boat" } }, "'Home': tags must be a list of strings"],
      [{ " ": { lat: 59.9, lon: 10 } }, "a place needs a name"],
      [{ Home: { lat: 91, lon: 10 } }, "'Home' has coordinates off the earth"],
      [{ Home: { lat: 59.9, lon: 181 } }, "'Home' has coordinates off the earth"],
      [{ Home: { lat: 59.9, lon: 10, radius_m: 0 } }, "'Home' needs a positive radius"],
      [
        { Home: { lat: 59.9, lon: 10, kind: "office" } },
        "'Home': kind must be one of home, asset-berth, other, not 'office'",
      ],
    ];
    for (const [data, message] of cases) {
      const broken = places(data);
      expect(() => readPlaces(broken, 150)).toThrow(`${where(broken)}: ${message}`);
    }
    const notJson = withFile(["places.json"], "{");
    expect(() => readPlaces(notJson, 150)).toThrow(`${where(notJson)} is not JSON: `);
  });
});

describe("assets.json is validated as the reference's assets.read validates it", () => {
  it("reads the registry in file order with its identifiers, icao24 lower-cased; none without the file", () => {
    expect(readAssets(tempDir())).toEqual([]);
    const read = readAssets(
      assets({
        assets: [
          {
            id: "nordlys",
            kind: "yacht",
            name: "Nordlys",
            mmsi: "970123456",
            registration: "ZZ-NLY",
          },
          { id: "ln-xya", kind: "aircraft", name: "LN-XYA", icao24: "ABCDEF" },
        ],
        note: "kept",
      }),
    );
    expect(read).toEqual([
      { id: "nordlys", kind: "yacht", name: "Nordlys", mmsi: "970123456", registration: "ZZ-NLY" },
      { id: "ln-xya", kind: "aircraft", name: "LN-XYA", icao24: "abcdef" },
    ]);
  });

  it("refuses what the reference refuses", () => {
    const where = (root: string) => join(root, "assets.json");
    for (const data of [[], { assets: {} }, {}]) {
      const broken = assets(data);
      expect(() => readAssets(broken)).toThrow(SettingsError);
      expect(() => readAssets(broken)).toThrow(
        `${where(broken)} must be an object with an "assets" list`,
      );
    }
    const cases: Array<[unknown, string]> = [
      [[1], "an asset is an object with id, kind and name, not int"],
      [["x"], "an asset is an object with id, kind and name, not str"],
      [[null], "an asset is an object with id, kind and name, not NoneType"],
      [[[]], "an asset is an object with id, kind and name, not list"],
      [[{ kind: "yacht", name: "x" }], "an asset needs a id"],
      [[{ id: "x", name: "x" }], "an asset needs a kind"],
      [[{ id: "x", kind: "car" }], "an asset needs a name"],
      [
        [{ id: "Nordlys", kind: "yacht", name: "x" }],
        "id must be lower-case letters, digits and hyphens, not 'Nordlys'",
      ],
      [
        [{ id: 7, kind: "yacht", name: "x" }],
        "id must be lower-case letters, digits and hyphens, not 7",
      ],
      [
        [{ id: "x", kind: "boat", name: "x" }],
        "kind must be one of yacht, aircraft, car, not 'boat'",
      ],
      [[{ id: "x", kind: "car", name: " " }], "name is required"],
      [
        [{ id: "x", kind: "yacht", name: "x", mmsi: "12345" }],
        "mmsi must be nine digits, not '12345'",
      ],
      [
        [{ id: "x", kind: "aircraft", name: "x", icao24: "xyz" }],
        "icao24 must be six hex digits, not 'xyz'",
      ],
      [
        [{ id: "x", kind: "car", name: "x", registration: "" }],
        "registration must be text, not ''",
      ],
    ];
    for (const [list, message] of cases) {
      const broken = assets({ assets: list });
      expect(() => readAssets(broken)).toThrow(message);
    }
    const notJson = withFile(["assets.json"], "{");
    expect(() => readAssets(notJson)).toThrow(`${where(notJson)} is not JSON: `);
  });
});

describe("policy/owner.json is validated as the reference's policy.owner_aliases validates it", () => {
  it("reads every key, absent as empty, entries stripped and the blank ones dropped; empty without the file", () => {
    expect(readOwnerPolicy(tempDir())).toEqual({ names: [], emails: [], phones: [] });
    expect(readOwnerPolicy(owner({ names: [" Ola ", ""], emails: ["ola@example.org"] }))).toEqual({
      names: ["Ola"],
      emails: ["ola@example.org"],
      phones: [],
    });
  });

  it("refuses what the reference refuses, naming the file", () => {
    const shape = (root: string) =>
      `${join(root, "policy", "owner.json")} must be {"names": [...], "emails": [...], "phones": [...]}, each a list of strings`;
    for (const data of [[], { names: "Ola" }, { phones: [1] }]) {
      const broken = owner(data);
      expect(() => readOwnerPolicy(broken)).toThrow(SettingsError);
      expect(() => readOwnerPolicy(broken)).toThrow(shape(broken));
    }
    const notJson = withFile(["policy", "owner.json"], "{");
    expect(() => readOwnerPolicy(notJson)).toThrow(
      `${join(notJson, "policy", "owner.json")} is not JSON: `,
    );
  });
});

describe("a reader refuses a record whose settings file is not what it should be, as the reference does", () => {
  it("day names the broken file instead of reading the day without it", () => {
    const root = writeRecord([
      {
        at: "2026-05-01T10:00:00Z",
        source: "manual",
        kind: "note",
        tier: 2,
        payload: { schema: "note/v1", text: "a day" },
      },
    ]);
    writeFileSync(
      join(root, "places.json"),
      JSON.stringify({ Home: { lat: 95, lon: 10 } }),
      "utf-8",
    );
    expect(() => readDay(root, { day: "2026-05-01" })).toThrow(SettingsError);
    expect(() => readDay(root, { day: "2026-05-01" })).toThrow(
      "'Home' has coordinates off the earth",
    );
  });
});
