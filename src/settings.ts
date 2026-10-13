/**
 * The settings beside the record, read and checked as the reference reads them (openlogbook 0.6.1:
 * `stays.read_settings`, `places.read`, `assets.read`, `policy.owner_aliases`): a file that is not
 * what it should be is refused naming it, never read as a default, so a reader of either
 * implementation refuses the same record in the same words. An absent file is the defaults. Nothing
 * here writes: where the reference writes a default file, this reads the same default in memory.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pyRepr, pyStr } from "./pyrepr.js";
import { LogbookError } from "./store.js";
import type { JsonValue } from "./types.js";

/** The settings file, the places file, the asset registry or the owner's aliases is not what it should be. */
export class SettingsError extends LogbookError {
  override readonly name = "SettingsError";
}

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

export const PLACE_KINDS = ["home", "asset-berth", "other"] as const;

/** An asset of `assets.json` (ADR 0018): a boat, an aircraft or a car with a track of its own. */
export interface Asset {
  id: string;
  kind: string;
  name: string;
  /** Nine digits. */
  mmsi?: string;
  /** Six hex digits, lower-case. */
  icao24?: string;
  /** Free text: a call sign, a plate. */
  registration?: string;
}

export const ASSET_KINDS = ["yacht", "aircraft", "car"] as const;
const ASSET_ID = /^[a-z0-9][a-z0-9-]*$/;
const MMSI = /^[0-9]{9}$/;
const ICAO24 = /^[0-9a-f]{6}$/;

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
  /** The asset within the owner's radius this long, and the owner is aboard. */
  aboard_min_s: number;
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
  aboard_min_s: 1200,
};

/** `policy/owner.json`: the owner's other names, addresses and numbers, so they are never their own company. */
export interface OwnerPolicy {
  names: string[];
  emails: string[];
  phones: string[];
}

const OWNER_KEYS = ["names", "emails", "phones"] as const;

type Obj = { [key: string]: JsonValue };

const isObject = (value: unknown): value is Obj =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The file parsed, undefined when it does not exist; one that is not JSON is refused naming it. */
function readJson(path: string): JsonValue | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch (err) {
    throw new SettingsError(`${path} is not JSON: ${(err as Error).message}`);
  }
}

/** Python's `type(x).__name__` of a JSON value, as the reference's message spells it. */
function pyTypeName(value: unknown): string {
  if (value === null) return "NoneType";
  if (Array.isArray(value)) return "list";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (typeof value === "string") return "str";
  return "dict";
}

/** What Python's `float()` makes of a JSON value: a number, a numeric string; else undefined. */
function asFloat(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// -- stays.json --------------------------------------------------------------------------------------------

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

function seconds(data: Obj, key: string, fallback: number, where: string): number {
  const value = key in data ? data[key] : fallback;
  if (typeof value !== "number" || value < 0) {
    throw new SettingsError(`${where}: ${key} must be a number of seconds, not ${pyRepr(value)}`);
  }
  return Math.trunc(value);
}

function positive(data: Obj, key: string, fallback: number, where: string): number {
  const value = key in data ? data[key] : fallback;
  if (typeof value !== "number" || value <= 0) {
    throw new SettingsError(`${where}: ${key} must be a positive number, not ${pyRepr(value)}`);
  }
  return value;
}

/** `policy/stays.json` over the defaults; a file that is not the documented shape is refused naming it. */
export function readStaySettings(root: string): StaySettings {
  const d = DEFAULT_STAY_SETTINGS;
  const where = join(root, "policy", "stays.json");
  const data = readJson(where);
  if (data === undefined) return { ...d, night: [...d.night], modes: { ...d.modes } };
  if (!isObject(data)) throw new SettingsError(`${where} must be a JSON object`);
  const modes = "modes" in data ? data.modes : {};
  if (!isObject(modes)) throw new SettingsError(`${where}: modes must be an object`);
  const night = "night" in data ? data.night : [...d.night];
  if (
    !Array.isArray(night) ||
    night.length !== 2 ||
    !night.every((t) => typeof t === "string" && CLOCK.test(t))
  ) {
    throw new SettingsError(`${where}: night must be two clock times, like ["22:00", "08:00"]`);
  }
  return {
    stay_min_s: seconds(data, "stay_min_s", d.stay_min_s, where),
    stop_min_s: seconds(data, "stop_min_s", d.stop_min_s, where),
    merge_gap_s: seconds(data, "merge_gap_s", d.merge_gap_s, where),
    radius_m: positive(data, "radius_m", d.radius_m, where),
    airport_km: positive(data, "airport_km", d.airport_km, where),
    night: [night[0] as string, night[1] as string],
    modes: {
      walk_max_kmh: positive(modes, "walk_max_kmh", d.modes.walk_max_kmh, where),
      car_max_kmh: positive(modes, "car_max_kmh", d.modes.car_max_kmh, where),
      flight_min_kmh: positive(modes, "flight_min_kmh", d.modes.flight_min_kmh, where),
    },
    aboard_window_s: seconds(data, "aboard_window_s", d.aboard_window_s, where),
    aboard_min_s: seconds(data, "aboard_min_s", d.aboard_min_s, where),
  };
}

// -- places.json -------------------------------------------------------------------------------------------

/**
 * The named places of `places.json`, in file order, each checked as the reference checks it; none
 * when there is no file. `defaultRadius` is the settings' `radius_m`, the reach of a place that names
 * none. A file that is not a places file is refused naming it and the place.
 */
export function readPlaces(
  root: string,
  defaultRadius: number = DEFAULT_STAY_SETTINGS.radius_m,
): Place[] {
  const where = join(root, "places.json");
  const data = readJson(where);
  if (data === undefined) return [];
  if (!isObject(data)) {
    throw new SettingsError(`${where} must map a place name to {lat, lon, radius_m, kind, tags}`);
  }
  const out: Place[] = [];
  for (const [name, entry] of Object.entries(data)) {
    if (!isObject(entry)) {
      throw new SettingsError(`${where}: ${pyRepr(name)} must be an object with lat and lon`);
    }
    const lat = asFloat(entry.lat);
    const lon = asFloat(entry.lon);
    const radius = entry.radius_m === undefined ? defaultRadius : asFloat(entry.radius_m);
    if (lat === undefined || lon === undefined || radius === undefined) {
      throw new SettingsError(`${where}: ${pyRepr(name)} needs numeric lat and lon (and radius_m)`);
    }
    const kind = "kind" in entry ? pyStr(entry.kind) : "other";
    const tags = "tags" in entry ? entry.tags : [];
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) {
      throw new SettingsError(`${where}: ${pyRepr(name)}: tags must be a list of strings`);
    }
    if (name.trim() === "") throw new SettingsError(`${where}: a place needs a name`);
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) {
      throw new SettingsError(`${where}: ${pyRepr(name)} has coordinates off the earth`);
    }
    if (!(radius > 0)) throw new SettingsError(`${where}: ${pyRepr(name)} needs a positive radius`);
    if (!(PLACE_KINDS as readonly string[]).includes(kind)) {
      throw new SettingsError(
        `${where}: ${pyRepr(name)}: kind must be one of ${PLACE_KINDS.join(", ")}, not ${pyRepr(kind)}`,
      );
    }
    const place: Place = { name, lat, lon, radius_m: radius, kind, tags: tags as string[] };
    const country = entry.country;
    if (typeof country === "string" && country !== "") place.country = country;
    out.push(place);
  }
  return out;
}

// -- assets.json -------------------------------------------------------------------------------------------

/** One entry of the registry, checked as the reference's `Asset.from_json` checks it; an icao24 is lower-cased. */
function assetOf(entry: JsonValue): Asset {
  if (!isObject(entry)) {
    throw new SettingsError(
      `an asset is an object with id, kind and name, not ${pyTypeName(entry)}`,
    );
  }
  for (const key of ["id", "kind", "name"]) {
    if (!(key in entry)) throw new SettingsError(`an asset needs a ${key}`);
  }
  const { id, kind, name } = entry;
  if (typeof id !== "string" || !ASSET_ID.test(id)) {
    throw new SettingsError(`id must be lower-case letters, digits and hyphens, not ${pyRepr(id)}`);
  }
  if (typeof kind !== "string" || !(ASSET_KINDS as readonly string[]).includes(kind)) {
    throw new SettingsError(`kind must be one of ${ASSET_KINDS.join(", ")}, not ${pyRepr(kind)}`);
  }
  if (typeof name !== "string" || name.trim() === "") throw new SettingsError("name is required");
  const asset: Asset = { id, kind, name };
  const mmsi = entry.mmsi;
  if (mmsi !== undefined && mmsi !== null) {
    if (typeof mmsi !== "string" || !MMSI.test(mmsi)) {
      throw new SettingsError(`mmsi must be nine digits, not ${pyRepr(mmsi)}`);
    }
    asset.mmsi = mmsi;
  }
  const icao24 = typeof entry.icao24 === "string" ? entry.icao24.toLowerCase() : entry.icao24;
  if (icao24 !== undefined && icao24 !== null) {
    if (typeof icao24 !== "string" || !ICAO24.test(icao24)) {
      throw new SettingsError(`icao24 must be six hex digits, not ${pyRepr(icao24)}`);
    }
    asset.icao24 = icao24;
  }
  const registration = entry.registration;
  if (registration !== undefined && registration !== null) {
    if (typeof registration !== "string" || registration.trim() === "") {
      throw new SettingsError(`registration must be text, not ${pyRepr(registration)}`);
    }
    asset.registration = registration;
  }
  return asset;
}

/** The registered assets of `assets.json` (ADR 0018), in file order; none when there is no file. A file that is not a registry is refused naming it. */
export function readAssets(root: string): Asset[] {
  const where = join(root, "assets.json");
  const data = readJson(where);
  if (data === undefined) return [];
  if (!isObject(data) || !Array.isArray(data.assets)) {
    throw new SettingsError(`${where} must be an object with an "assets" list`);
  }
  return data.assets.map(assetOf);
}

// -- policy/owner.json -------------------------------------------------------------------------------------

/**
 * The owner's extra aliases as `{names, emails, phones}`, every key present (an absent one is empty),
 * each entry stripped and the blank ones dropped; empty when the file is missing. A file that is not
 * the documented shape is refused naming it.
 */
export function readOwnerPolicy(root: string): OwnerPolicy {
  const where = join(root, "policy", "owner.json");
  const shape = `${where} must be {"names": [...], "emails": [...], "phones": [...]}, each a list of strings`;
  const data = readJson(where) ?? {};
  if (!isObject(data)) throw new SettingsError(shape);
  const out: OwnerPolicy = { names: [], emails: [], phones: [] };
  for (const key of OWNER_KEYS) {
    const values = key in data ? data[key] : [];
    if (!Array.isArray(values) || !values.every((v) => typeof v === "string")) {
      throw new SettingsError(shape);
    }
    out[key] = (values as string[]).map((v) => v.trim()).filter((v) => v !== "");
  }
  return out;
}
