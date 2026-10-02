import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonValue } from "./types.js";

/** A named place of `places.json`: a centre, a reach, a kind (`home`, `asset-berth`, `other`). */
export interface Place {
  name: string;
  lat: number;
  lon: number;
  radius_m: number;
  kind: string;
  tags: string[];
  country?: string;
}

/** An asset of `assets.json` (ADR 0018): a boat, an aircraft or a car with a track of its own. */
export interface Asset {
  id: string;
  kind: string;
  name: string;
}

/** The thresholds of `policy/stays.json`, as the reference creates it with its defaults. */
export interface StaySettings {
  /** A span at one place this long is a stay whatever is attached to it. */
  stay_min_s: number;
  /** A shorter span is a stop when it lasts this long and nothing is attached; else it dissolves. */
  stop_min_s: number;
  /** An excursion outside the radius that returns within this is one stay; a silence is this long. */
  merge_gap_s: number;
  /** The reach of an unnamed place. */
  radius_m: number;
  /** A move that starts and ends this close to two airports is a flight. */
  airport_km: number;
  /** The night window, local `HH:MM` to `HH:MM`. */
  night: [string, string];
  modes: { walk_max_kmh: number; car_max_kmh: number; flight_min_kmh: number };
  /** How far apart in time a position of the owner's and one of an asset's may be and still match. */
  aboard_window_s: number;
}

export const DEFAULT_STAY_SETTINGS: StaySettings = {
  stay_min_s: 1200,
  stop_min_s: 180,
  merge_gap_s: 600,
  radius_m: 150,
  airport_km: 8,
  night: ["22:00", "08:00"],
  modes: { walk_max_kmh: 7, car_max_kmh: 130, flight_min_kmh: 150 },
  aboard_window_s: 300,
};

/** `policy/owner.json`: the owner's other names, addresses and numbers, so they are never their own company. */
export interface OwnerPolicy {
  names: string[];
  emails: string[];
  phones: string[];
}

type Obj = { [key: string]: JsonValue };

function readJson(file: string): JsonValue | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf-8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined; // a setting that is not JSON is no setting; a reader never fails on it
  }
}

function obj(value: JsonValue | undefined): Obj | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

const num = (value: JsonValue | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const str = (value: JsonValue | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

const strings = (value: JsonValue | undefined): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** The named places, in file order; none when the file is missing or malformed. */
export function readPlaces(root: string): Place[] {
  const places = obj(readJson(join(root, "places.json")));
  if (places === undefined) return [];
  const out: Place[] = [];
  for (const [name, value] of Object.entries(places)) {
    const p = obj(value);
    const lat = num(p?.lat);
    const lon = num(p?.lon);
    if (p === undefined || lat === undefined || lon === undefined) continue;
    const place: Place = {
      name,
      lat,
      lon,
      radius_m: num(p.radius_m) ?? DEFAULT_STAY_SETTINGS.radius_m,
      kind: str(p.kind) ?? "other",
      tags: strings(p.tags),
    };
    const country = str(p.country);
    if (country !== undefined && country !== "") place.country = country;
    out.push(place);
  }
  return out;
}

/** The registered assets, in file order; none when the file is missing or malformed. */
export function readAssets(root: string): Asset[] {
  const registry = obj(readJson(join(root, "assets.json")));
  const list = registry?.assets;
  if (!Array.isArray(list)) return [];
  const out: Asset[] = [];
  for (const item of list) {
    const a = obj(item);
    const id = str(a?.id);
    if (a === undefined || id === undefined || id === "") continue;
    out.push({ id, kind: str(a.kind) ?? "asset", name: str(a.name) ?? id });
  }
  return out;
}

/** `policy/stays.json` over the defaults; a missing or malformed field keeps its default. */
export function readStaySettings(root: string): StaySettings {
  const given = obj(readJson(join(root, "policy", "stays.json")));
  const d = DEFAULT_STAY_SETTINGS;
  if (given === undefined) return { ...d, night: [...d.night], modes: { ...d.modes } };
  const modes = obj(given.modes);
  const night = strings(given.night);
  const clock = /^\d{2}:\d{2}$/;
  return {
    stay_min_s: num(given.stay_min_s) ?? d.stay_min_s,
    stop_min_s: num(given.stop_min_s) ?? d.stop_min_s,
    merge_gap_s: num(given.merge_gap_s) ?? d.merge_gap_s,
    radius_m: num(given.radius_m) ?? d.radius_m,
    airport_km: num(given.airport_km) ?? d.airport_km,
    night:
      night.length === 2 && night.every((c) => clock.test(c))
        ? [night[0] as string, night[1] as string]
        : [...d.night],
    modes: {
      walk_max_kmh: num(modes?.walk_max_kmh) ?? d.modes.walk_max_kmh,
      car_max_kmh: num(modes?.car_max_kmh) ?? d.modes.car_max_kmh,
      flight_min_kmh: num(modes?.flight_min_kmh) ?? d.modes.flight_min_kmh,
    },
    aboard_window_s: num(given.aboard_window_s) ?? d.aboard_window_s,
  };
}

/** `policy/owner.json`; empty when missing. */
export function readOwnerPolicy(root: string): OwnerPolicy {
  const given = obj(readJson(join(root, "policy", "owner.json")));
  return {
    names: strings(given?.names),
    emails: strings(given?.emails),
    phones: strings(given?.phones),
  };
}
