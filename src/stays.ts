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
  evidence?: Span[];
  /** The same as a question, for a reader that streams: is anything attached inside this span? */
  attached?: (startMs: number, endMs: number) => boolean;
  /** The code of an airport within `airport_km` of a point, else undefined. */
  airportNear: (lat: number, lon: number) => string | undefined;
}

/** A candidate cluster being scanned: anchored at its first point, or at the named place that holds it. */
interface Scan {
  lat: number;
  lon: number;
  radius: number;
  place: Place | undefined;
  first: Point;
  /** Every point since the first, in order. */
  all: Point[];
  /** The points within the radius, the first among them. */
  inside: Point[];
  last: Point;
  /** The points after the last one inside: an excursion that may still come back. */
  tail: Point[];
}

/** A cluster that was a stay or a stop, kept for the move to the next one. */
interface Closed {
  stay: Stay;
}

/** Below this speed a move has no mode: two clusters a few metres apart, not a journey. */
const STILL_KMH_LIMIT = STILL_KMH;

/**
 * The stays, stops and moves of one subject, derived point by point as they arrive in time order,
 * so that a reader of a year holds the open cluster and the points of the move being walked, never
 * the record. The rules are the reference's documented ones: a cluster is anchored at its first
 * point, or at the centre of the named place that holds it, and takes every later point within the
 * radius; a point outside starts an excursion, which is part of the stay when a point is back
 * inside within `merge_gap_s` of the last one inside, else the stay ends at that last point. A
 * cluster of two points or more is a stay when it lasts `stay_min_s` or anything is attached inside
 * it, a stop when it lasts `stop_min_s`, and dissolves into the move otherwise. A stay whose next
 * point comes after a silence of `merge_gap_s` and lies within a short walk (`walk_max_kmh` for
 * `merge_gap_s`) lasts until that point, which then opens the move. A move spans the gap between
 * two clusters along the points; its mode comes from the speed along it (none below 1 km/h), or is
 * `flight` when it starts and ends near two different airports; a move with no point for a silence
 * or more, and not a flight, is a gap. Segments are handed to `emit` in time order, each as soon as
 * the points decide it.
 */
export class SegmentStream {
  private readonly settings: StaySettings;
  private readonly places: Place[];
  private readonly attached: (startMs: number, endMs: number) => boolean;
  private readonly airportNear: DeriveOptions["airportNear"];
  private readonly mergeGapMs: number;
  private readonly walkM: number;
  private scan: Scan | undefined;
  private previous: Closed | undefined;
  /** The points since the previous cluster's last point inside, not in any cluster: the move so far. */
  private carry: Point[] = [];

  constructor(
    options: DeriveOptions,
    private readonly emit: (segment: Segment) => void,
  ) {
    this.settings = options.settings;
    this.places = options.places;
    const evidence = options.evidence ?? [];
    this.attached =
      options.attached ??
      ((startMs, endMs) => evidence.some((e) => e.startMs <= endMs && e.endMs >= startMs));
    this.airportNear = options.airportNear;
    this.mergeGapMs = this.settings.merge_gap_s * 1000;
    this.walkM = (this.settings.modes.walk_max_kmh * 1000 * this.settings.merge_gap_s) / 3600;
  }

  /** The instant from which a segment may still be emitted: the open cluster's first point. */
  get openSinceMs(): number | undefined {
    return this.scan?.first.ms;
  }

  /** The points held: the open cluster's and the move's so far. */
  get held(): number {
    return (this.scan?.all.length ?? 0) + this.carry.length;
  }

  /** The next point, later than every one before it. */
  push(point: Point): void {
    const scan = this.scan;
    if (scan === undefined) {
      this.scan = this.open(point);
      return;
    }
    const within = distanceM(point.lat, point.lon, scan.lat, scan.lon) <= scan.radius;
    const soon = point.ms - scan.last.ms <= this.mergeGapMs;
    if (within && (scan.tail.length === 0 || soon)) {
      // Inside: a silence at the place is still the stay; an excursion that is back in time is too.
      scan.inside.push(point);
      scan.last = point;
      scan.all.push(point);
      scan.tail = [];
      return;
    }
    if (!within && soon) {
      scan.tail.push(point);
      scan.all.push(point);
      return;
    }
    // No return within the gap: the cluster ends at its last point inside, and the points after it
    // are examined again as the start of the next one.
    const rest = [...scan.tail, point];
    this.close(scan, rest[0]);
    this.scan = undefined;
    for (const p of rest) this.push(p);
  }

  /** No more points: whatever is open is closed by the rules, with no point after it. */
  finish(): void {
    while (this.scan !== undefined) {
      const scan = this.scan;
      const rest = scan.tail;
      this.close(scan, rest[0]);
      this.scan = undefined;
      for (const p of rest) this.push(p);
    }
  }

  private open(point: Point): Scan {
    const place = placeAt(point.lat, point.lon, this.places);
    return {
      lat: place === undefined ? point.lat : place.lat,
      lon: place === undefined ? point.lon : place.lon,
      radius: place === undefined ? this.settings.radius_m : place.radius_m,
      place,
      first: point,
      all: [point],
      inside: [point],
      last: point,
      tail: [],
    };
  }

  /** Classifies a scanned cluster; `next` is the point right after its last one inside, when there is one. */
  private close(scan: Scan, next: Point | undefined): void {
    const settings = this.settings;
    const startMs = scan.first.ms;
    let endMs = scan.last.ms;
    const duration = (endMs - startMs) / 1000;
    let kind: "stay" | "stop" | undefined;
    let promoted = false;
    if (scan.inside.length >= 2) {
      promoted = this.attached(startMs, endMs) && duration < settings.stay_min_s;
      if (duration >= settings.stay_min_s || promoted) kind = "stay";
      else if (duration >= settings.stop_min_s) kind = "stop";
    }
    if (kind === undefined) {
      // Dissolved: its points are on the way; the tail is examined again by the caller.
      this.carry.push(...scan.all.slice(0, scan.all.length - scan.tail.length));
      return;
    }
    if (
      kind === "stay" &&
      next !== undefined &&
      next.ms - endMs >= this.mergeGapMs &&
      distanceM(next.lat, next.lon, scan.lat, scan.lon) <= this.walkM
    ) {
      endMs = next.ms; // the silence was time at the place; the point itself opens the move
    }
    const stay: Stay = {
      kind,
      startMs,
      endMs,
      place: scan.place,
      lat: mean(scan.inside.map((p) => p.lat)),
      lon: mean(scan.inside.map((p) => p.lon)),
      inside: scan.inside,
      first: scan.first,
      last: scan.last,
      promoted,
      aboard: undefined,
    };
    if (this.previous !== undefined) this.emit(this.move(this.previous.stay, stay));
    this.emit(stay);
    this.previous = { stay };
    this.carry = []; // the tail is examined again by the caller, and joins the move if it dissolves
  }

  /** The move from one cluster to the next, along the points between them. */
  private move(from: Stay, to: Stay): Move {
    const settings = this.settings;
    const path = [from.last, ...this.carry, to.first];
    let distance = 0;
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1] as Point;
      const b = path[k] as Point;
      distance += distanceM(a.lat, a.lon, b.lat, b.lon);
    }
    const interior = path.slice(1, -1);
    const startMs = from.endMs;
    const endMs = to.startMs;
    const first = path[0] as Point;
    const last = path[path.length - 1] as Point;
    const depart = this.airportNear(first.lat, first.lon);
    const arrive = this.airportNear(last.lat, last.lon);
    const airports: [string, string] | [] =
      depart !== undefined && arrive !== undefined && depart !== arrive ? [depart, arrive] : [];
    const seconds = (endMs - startMs) / 1000;
    let mode: string | null = null;
    if (airports.length) mode = "flight";
    else if (seconds > 0) {
      const kmh = (distance / seconds) * 3.6;
      if (kmh < STILL_KMH_LIMIT)
        mode = null; // not moving: the jitter between two clusters
      else if (kmh <= settings.modes.walk_max_kmh) mode = "walk";
      else if (kmh <= settings.modes.car_max_kmh) mode = "car";
      else if (kmh < settings.modes.flight_min_kmh) mode = "train";
      else mode = "flight";
    }
    return {
      kind: "move",
      startMs,
      endMs,
      distanceM: roundHalfEven(distance),
      mode,
      airports,
      interior,
      first,
      last,
      gap: interior.length === 0 && seconds >= settings.merge_gap_s && mode !== "flight",
      aboard: undefined,
    };
  }
}

/** Stays, stops and moves of one subject from its points in time order; see `SegmentStream`. */
export function deriveSegments(points: Point[], options: DeriveOptions): Segment[] {
  const segments: Segment[] = [];
  const stream = new SegmentStream(options, (segment) => segments.push(segment));
  for (const point of points) stream.push(point);
  stream.finish();
  return segments;
}

/** The points a segment is judged by: a stay's points inside the radius, a move's interior. */
export function judged(segment: Segment): Point[] {
  return segment.kind === "move" ? segment.interior : segment.inside;
}

/**
 * Whether a subject's points match an asset's track: of the points that have an asset position,
 * more than half lie within `radius_m` of it. The asset's position at a point's instant is read
 * between the two fixes around it when they are at most twice `aboard_window_s` apart (an AIS fix
 * every ten minutes still places a boat under way), else from the nearest fix within
 * `aboard_window_s`; a point with neither is not judged. The track is in time order.
 */
export function aboardMatch(points: Point[], track: Point[], settings: StaySettings): boolean {
  if (points.length === 0 || track.length === 0) return false;
  const windowMs = settings.aboard_window_s * 1000;
  let judgedCount = 0;
  let matched = 0;
  let cursor = 0;
  for (const p of points) {
    // `cursor` is the first fix at or after the point; the one before it is the last fix before.
    while (cursor < track.length && (track[cursor] as Point).ms < p.ms) cursor++;
    const after = track[cursor];
    const before = cursor > 0 ? track[cursor - 1] : undefined;
    let at: { lat: number; lon: number } | undefined;
    if (before !== undefined && after !== undefined && after.ms - before.ms <= 2 * windowMs) {
      const f = after.ms === before.ms ? 0 : (p.ms - before.ms) / (after.ms - before.ms);
      at = {
        lat: before.lat + (after.lat - before.lat) * f,
        lon: before.lon + (after.lon - before.lon) * f,
      };
    } else {
      let nearest: Point | undefined;
      for (const candidate of [before, after]) {
        if (candidate === undefined || Math.abs(candidate.ms - p.ms) > windowMs) continue;
        if (nearest === undefined || Math.abs(candidate.ms - p.ms) < Math.abs(nearest.ms - p.ms))
          nearest = candidate;
      }
      if (nearest !== undefined) at = nearest;
    }
    if (at === undefined) continue;
    judgedCount += 1;
    if (distanceM(p.lat, p.lon, at.lat, at.lon) <= settings.radius_m) matched += 1;
  }
  return judgedCount > 0 && matched * 2 > judgedCount;
}

/**
 * Marks one segment `aboard` the first asset whose track its position matches (`aboardMatch`). A
 * move aboard a yacht is by `boat`, aboard an aircraft a `flight`, aboard a car by `car`.
 */
export function markSegmentAboard(
  segment: Segment,
  tracks: Array<{ asset: Asset; points: Point[] }>,
  settings: StaySettings,
): void {
  const points = judged(segment);
  for (const { asset, points: track } of tracks) {
    if (!aboardMatch(points, track, settings)) continue;
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
    return;
  }
}

/** Marks each of the owner's segments `aboard` the asset whose track its position matches; see `markSegmentAboard`. */
export function markAboard(
  segments: Segment[],
  tracks: Array<{ asset: Asset; points: Point[] }>,
  settings: StaySettings,
): void {
  for (const segment of segments) markSegmentAboard(segment, tracks, settings);
}
