import { distanceM, mean, roundHalfEven } from "./geo.js";
import type { Asset, Place, StaySettings } from "./settings.js";

/** One `location/v1` point of one subject, parsed. */
export interface Point {
  ms: number;
  lat: number;
  lon: number;
  id: string;
  seq: number;
}

/** A span something else is attached to: an event, a transcript, a note, a call, a message, a photo. */
export interface Span {
  startMs: number;
  endMs: number;
}

/** A span at one place: a stay (long enough, or with something attached) or a stop (shorter, nothing attached). */
export interface Stay {
  kind: "stay" | "stop";
  startMs: number;
  endMs: number;
  place: Place | undefined;
  /** The centroid of the points inside the radius. */
  lat: number;
  lon: number;
  /** The points inside the radius: an excursion's points are neither here nor in a move. */
  inside: Point[];
  first: Point;
  last: Point;
  promoted: boolean;
  aboard: Asset | undefined;
}

/** What lies between two stays. */
export interface Move {
  kind: "move";
  startMs: number;
  endMs: number;
  /** Along the points, from the stay's last point to the next stay's first. */
  distanceM: number;
  /** `walk`, `car`, `train`, `flight`, `boat`; null when no point says. */
  mode: string | null;
  /** The airports a flight connects, when the move is one by the airport rule. */
  airports: [string, string] | [];
  /** The points strictly between the two stays. */
  interior: Point[];
  first: Point;
  last: Point;
  /** No point for a silence or more, and not a flight: the tracker did not see it. */
  gap: boolean;
  aboard: Asset | undefined;
}

export type Segment = Stay | Move;

/** Below this speed a move has no mode: two clusters a few metres apart, not a journey. */
const STILL_KMH = 1;

/** The named place whose radius holds the point, the nearest when several do. */
export function placeAt(lat: number, lon: number, places: Place[]): Place | undefined {
  let best: { place: Place; d: number } | undefined;
  for (const place of places) {
    const d = distanceM(lat, lon, place.lat, place.lon);
    if (d <= place.radius_m && (best === undefined || d < best.d)) best = { place, d };
  }
  return best?.place;
}

export interface DeriveOptions {
  settings: StaySettings;
  places: Place[];
  /** Standing evidence of the window; a span inside a cluster promotes it to a stay. */
  evidence: Span[];
  /** The code of an airport within `airport_km` of a point, else undefined. */
  airportNear: (lat: number, lon: number) => string | undefined;
}

interface Cluster {
  inside: number[];
  first: number;
  lastInside: number;
  startMs: number;
  endMs: number;
  place: Place | undefined;
  promoted: boolean;
  kind: "stay" | "stop";
}

/**
 * Stays, stops and moves of one subject from its points in time order, by the reference's
 * documented rules: a cluster is anchored at its first point, or at the centre of the named place
 * that holds it, and takes every later point within the radius; a point outside starts an
 * excursion, which is part of the stay when a point is back inside within `merge_gap_s` of the last
 * one inside, else the stay ends at that last point. A cluster of two points or more is a stay when
 * it lasts `stay_min_s` or anything is attached inside it, a stop when it lasts `stop_min_s`, and
 * dissolves into the move otherwise. A stay whose next point comes after a silence of `merge_gap_s`
 * and lies within a short walk (`walk_max_kmh` for `merge_gap_s`) lasts until that point, which then
 * opens the move. A move spans the gap between two clusters along the points; its mode comes from
 * the speed along it (none below 1 km/h), or is `flight` when it starts and ends near two different
 * airports; a move with no point for a silence or more, and not a flight, is a gap.
 */
export function deriveSegments(points: Point[], options: DeriveOptions): Segment[] {
  const { settings, places, evidence, airportNear } = options;
  const mergeGapMs = settings.merge_gap_s * 1000;
  const walkM = (settings.modes.walk_max_kmh * 1000 * settings.merge_gap_s) / 3600;
  const attached = (startMs: number, endMs: number): boolean =>
    evidence.some((e) => e.startMs <= endMs && e.endMs >= startMs);

  const clusters: Cluster[] = [];
  const n = points.length;
  let i = 0;
  while (i < n) {
    const start = points[i] as Point;
    const place = placeAt(start.lat, start.lon, places);
    const anchor =
      place === undefined
        ? { lat: start.lat, lon: start.lon, radius: settings.radius_m }
        : { lat: place.lat, lon: place.lon, radius: place.radius_m };
    const within = (p: Point): boolean =>
      distanceM(p.lat, p.lon, anchor.lat, anchor.lon) <= anchor.radius;
    const inside = [i];
    let lastInside = i;
    let j = i + 1;
    while (j < n) {
      if (within(points[j] as Point)) {
        inside.push(j);
        lastInside = j;
        j += 1;
        continue;
      }
      // An excursion: back inside within merge_gap_s of the last point inside, and the stay goes on.
      let back = -1;
      for (
        let k = j;
        k < n && (points[k] as Point).ms - (points[lastInside] as Point).ms <= mergeGapMs;
        k++
      ) {
        if (within(points[k] as Point)) {
          back = k;
          break;
        }
      }
      if (back === -1) break;
      inside.push(back);
      lastInside = back;
      j = back + 1;
    }
    const startMs = start.ms;
    let endMs = (points[lastInside] as Point).ms;
    const duration = (endMs - startMs) / 1000;
    let kind: "stay" | "stop" | undefined;
    let promoted = false;
    if (inside.length >= 2) {
      promoted = attached(startMs, endMs) && duration < settings.stay_min_s;
      if (duration >= settings.stay_min_s || promoted) kind = "stay";
      else if (duration >= settings.stop_min_s) kind = "stop";
    }
    if (kind === "stay" && lastInside + 1 < n) {
      const next = points[lastInside + 1] as Point;
      if (
        next.ms - endMs >= mergeGapMs &&
        distanceM(next.lat, next.lon, anchor.lat, anchor.lon) <= walkM
      ) {
        endMs = next.ms; // the silence was time at the place; the point itself opens the move
      }
    }
    if (kind !== undefined) {
      clusters.push({ inside, first: i, lastInside, startMs, endMs, place, promoted, kind });
    }
    i = lastInside + 1;
  }

  const segments: Segment[] = [];
  const toStay = (c: Cluster): Stay => {
    const pts = c.inside.map((k) => points[k] as Point);
    return {
      kind: c.kind,
      startMs: c.startMs,
      endMs: c.endMs,
      place: c.place,
      lat: mean(pts.map((p) => p.lat)),
      lon: mean(pts.map((p) => p.lon)),
      inside: pts,
      first: points[c.first] as Point,
      last: points[c.lastInside] as Point,
      promoted: c.promoted,
      aboard: undefined,
    };
  };
  for (let c = 0; c < clusters.length; c++) {
    const cluster = clusters[c] as Cluster;
    segments.push(toStay(cluster));
    const next = clusters[c + 1];
    if (next === undefined) continue;
    const path = points.slice(cluster.lastInside, next.first + 1);
    let distance = 0;
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1] as Point;
      const b = path[k] as Point;
      distance += distanceM(a.lat, a.lon, b.lat, b.lon);
    }
    const interior = path.slice(1, -1);
    const startMs = cluster.endMs;
    const endMs = next.startMs;
    const from = airportNear((path[0] as Point).lat, (path[0] as Point).lon);
    const to = airportNear(
      (path[path.length - 1] as Point).lat,
      (path[path.length - 1] as Point).lon,
    );
    const airports: [string, string] | [] =
      from !== undefined && to !== undefined && from !== to ? [from, to] : [];
    const seconds = (endMs - startMs) / 1000;
    let mode: string | null = null;
    if (airports.length) mode = "flight";
    else if (seconds > 0) {
      const kmh = (distance / seconds) * 3.6;
      if (kmh < STILL_KMH)
        mode = null; // not moving: the jitter between two clusters
      else if (kmh <= settings.modes.walk_max_kmh) mode = "walk";
      else if (kmh <= settings.modes.car_max_kmh) mode = "car";
      else if (kmh < settings.modes.flight_min_kmh) mode = "train";
      else mode = "flight";
    }
    segments.push({
      kind: "move",
      startMs,
      endMs,
      distanceM: roundHalfEven(distance),
      mode,
      airports,
      interior,
      first: path[0] as Point,
      last: path[path.length - 1] as Point,
      gap: interior.length === 0 && seconds >= settings.merge_gap_s && mode !== "flight",
      aboard: undefined,
    });
  }
  return segments;
}

/** The points a segment is judged by: a stay's points inside the radius, a move's interior. */
export function judged(segment: Segment): Point[] {
  return segment.kind === "move" ? segment.interior : segment.inside;
}

/**
 * Marks each of the owner's segments `aboard` the asset whose track its position matches: of the
 * points that have an asset position within `aboard_window_s`, more than half lie within
 * `radius_m` of the nearest one in time. A move aboard a yacht is by `boat`, aboard an aircraft a
 * `flight`, aboard a car by `car`. Asset tracks are given in time order.
 */
export function markAboard(
  segments: Segment[],
  tracks: Array<{ asset: Asset; points: Point[] }>,
  settings: StaySettings,
): void {
  const windowMs = settings.aboard_window_s * 1000;
  for (const segment of segments) {
    const points = judged(segment);
    if (points.length === 0) continue;
    for (const { asset, points: track } of tracks) {
      if (track.length === 0) continue;
      let judgedCount = 0;
      let matched = 0;
      let cursor = 0;
      for (const p of points) {
        while (cursor < track.length && (track[cursor] as Point).ms < p.ms - windowMs) cursor++;
        let nearest: Point | undefined;
        for (let k = cursor; k < track.length && (track[k] as Point).ms <= p.ms + windowMs; k++) {
          const candidate = track[k] as Point;
          if (nearest === undefined || Math.abs(candidate.ms - p.ms) < Math.abs(nearest.ms - p.ms))
            nearest = candidate;
        }
        if (nearest === undefined) continue;
        judgedCount += 1;
        if (distanceM(p.lat, p.lon, nearest.lat, nearest.lon) <= settings.radius_m) matched += 1;
      }
      if (judgedCount > 0 && matched * 2 > judgedCount) {
        segment.aboard = asset;
        if (segment.kind === "move" && segment.mode !== "flight") {
          segment.mode =
            asset.kind === "yacht" || asset.kind === "boat"
              ? "boat"
              : asset.kind === "aircraft"
                ? "flight"
                : asset.kind === "car"
                  ? "car"
                  : segment.mode;
        }
        break;
      }
    }
  }
}
