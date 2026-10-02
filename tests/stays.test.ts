import { describe, expect, it } from "vitest";
import { distanceM } from "../src/geo.js";
import { DEFAULT_STAY_SETTINGS, type Place, type StaySettings } from "../src/settings.js";
import {
  deriveSegments,
  type Move,
  markAboard,
  type Point,
  placeAt,
  type Segment,
  type Stay,
} from "../src/stays.js";

// A metre of latitude near Oslo, in degrees; longitude degrees are about half as long there.
const LAT_M = 1 / 111_320;
const HOME = { lat: 59.9139, lon: 10.7522 };
const home: Place = { name: "Home", ...HOME, radius_m: 120, kind: "home", tags: [], country: "NO" };
const T0 = Date.parse("2026-04-06T06:00:00Z");

let seq = 0;
/** A point `minutes` after T0, `north` metres north of a base and `east` metres east of it. */
function pt(minutes: number, north = 0, east = 0, base = HOME): Point {
  seq += 1;
  return {
    ms: T0 + minutes * 60_000,
    lat: base.lat + north * LAT_M,
    lon: base.lon + (east * LAT_M) / Math.cos((base.lat * Math.PI) / 180),
    id: `p${seq}`,
    seq,
  };
}

const settings: StaySettings = DEFAULT_STAY_SETTINGS;
const derive = (
  points: Point[],
  places: Place[] = [],
  evidence = [] as { startMs: number; endMs: number }[],
) => deriveSegments(points, { settings, places, evidence, airportNear: () => undefined });
const stays = (segments: Segment[]): Stay[] => segments.filter((s): s is Stay => s.kind !== "move");
const moves = (segments: Segment[]): Move[] => segments.filter((s): s is Move => s.kind === "move");
const at = (s: Segment): string =>
  `${new Date(s.startMs).toISOString().slice(11, 16)}–${new Date(s.endMs).toISOString().slice(11, 16)}`;

describe("a cluster of points (the documented rules of derive stays)", () => {
  it("is anchored at its first point and takes every later point within the radius", () => {
    const far = { lat: 59.95, lon: 10.8 };
    const points = [
      pt(0, 0, 0, far),
      pt(5, 140, 0, far),
      pt(10, 0, 140, far),
      pt(15, 100, 100, far),
      pt(20, 50, 50, far),
      pt(25, 0, 0, far),
    ];
    const found = stays(derive(points));
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("stay");
    expect(found[0]?.inside).toHaveLength(6);
    expect(at(found[0] as Stay)).toBe("06:00–06:25");
  });

  it("is anchored at a named place's centre, with the place's radius, when its first point lies in one", () => {
    const points = [pt(0, 100), pt(5, -100), pt(10, 110), pt(15, -110), pt(20, 0), pt(25, 0)];
    const found = stays(derive(points, [home]));
    expect(found).toHaveLength(1);
    expect(found[0]?.place?.name).toBe("Home");
    expect(found[0]?.inside).toHaveLength(6); // 220 m apart, but every one within 120 m of the centre
  });

  it("keeps an excursion that is back inside within merge_gap_s of the last point inside, counting only the points inside", () => {
    const points = [pt(0), pt(5), pt(10, 300), pt(15), pt(20, 300), pt(25), pt(30)];
    const found = stays(derive(points));
    expect(found).toHaveLength(1);
    expect(at(found[0] as Stay)).toBe("06:00–06:30");
    expect(found[0]?.inside.map((p) => points.indexOf(p))).toEqual([0, 1, 3, 5, 6]);
    expect(found[0]?.lat).toBeCloseTo(HOME.lat, 9);
  });

  it("ends at the last point inside when the excursion does not come back in time", () => {
    const points = [
      pt(0),
      pt(5),
      pt(10),
      pt(15, 300),
      pt(20, 300),
      pt(25, 300),
      pt(30),
      pt(35),
      pt(40),
    ];
    const segments = derive(points);
    // The excursion's three points are then a cluster of their own: ten minutes, nothing attached.
    expect(segments.map((s) => `${s.kind} ${at(s)}`)).toEqual([
      "stop 06:00–06:10",
      "move 06:10–06:15",
      "stop 06:15–06:25",
      "move 06:25–06:30",
      "stop 06:30–06:40",
    ]);
  });

  it("is a stay from stay_min_s, a stop from stop_min_s, and dissolves into the move below that", () => {
    const base = { lat: 59.95, lon: 10.8 };
    const points = [
      ...[0, 5, 10, 15, 20].map((m) => pt(m, 0, 0, base)), // 20 min: a stay
      pt(25, 500, 0, base), // alone: dissolves
      pt(30, 1000, 0, base),
      pt(33, 1000, 0, base), // 3 min: a stop
      pt(40, 2000, 0, base),
      pt(42, 2000, 0, base), // 2 min: dissolves
      ...[50, 55, 60, 65, 70].map((m) => pt(m, 3000, 0, base)),
    ];
    const segments = derive(points);
    expect(segments.map((s) => `${s.kind} ${at(s)}`)).toEqual([
      "stay 06:00–06:20",
      "move 06:20–06:30",
      "stop 06:30–06:33",
      "move 06:33–06:50",
      "stay 06:50–07:10",
    ]);
    const dissolved = moves(segments)[1] as Move;
    expect(dissolved.interior.map((p) => p.ms)).toEqual([T0 + 40 * 60_000, T0 + 42 * 60_000]);
  });

  it("is promoted to a stay by anything attached inside it, however short", () => {
    const base = { lat: 59.95, lon: 10.8 };
    const points = [
      pt(0, 0, 0, base),
      pt(5, 0, 0, base),
      pt(20, 3000, 0, base),
      pt(40, 3000, 0, base),
    ];
    const plain = stays(derive(points));
    expect(plain.map((s) => s.kind)).toEqual(["stop", "stay"]);
    const promoted = stays(
      derive(points, [], [{ startMs: T0 + 2 * 60_000, endMs: T0 + 2 * 60_000 }]),
    );
    expect(promoted.map((s) => [s.kind, s.promoted])).toEqual([
      ["stay", true],
      ["stay", false],
    ]);
  });

  it("never makes a stay or a stop of one point", () => {
    const base = { lat: 59.95, lon: 10.8 };
    const points = [
      pt(0, 0, 0, base),
      pt(5, 0, 0, base),
      pt(20, 0, 0, base),
      pt(30, 3000, 0, base),
      pt(60, 6000, 0, base),
      pt(65, 6000, 0, base),
      pt(90, 6000, 0, base),
    ];
    const segments = derive(points, [], [{ startMs: T0 + 30 * 60_000, endMs: T0 + 30 * 60_000 }]);
    expect(segments.map((s) => s.kind)).toEqual(["stay", "move", "stay"]);
    expect((segments[1] as Move).interior).toHaveLength(1);
  });

  it("lasts through a silence until the next point when that point is within a short walk, which then opens the move", () => {
    const points = [
      pt(0),
      pt(5),
      pt(10),
      pt(15),
      pt(20),
      pt(25),
      pt(40, 800),
      pt(45, 1600),
      pt(50, 2400),
      pt(55, 2400),
      pt(60, 2400),
      pt(65, 2400),
      pt(70, 2400),
      pt(75, 2400),
    ];
    const segments = derive(points, [home]);
    expect(segments.map((s) => `${s.kind} ${at(s)}`)).toEqual([
      "stay 06:00–06:40",
      "move 06:40–06:50",
      "stay 06:50–07:15",
    ]);
    const stay = segments[0] as Stay;
    expect(stay.last.ms).toBe(T0 + 25 * 60_000); // the point that ended the silence is not the stay's
    const move = segments[1] as Move;
    expect(move.interior.map((p) => p.ms)).toEqual([T0 + 40 * 60_000, T0 + 45 * 60_000]);
    expect(move.first.ms).toBe(T0 + 25 * 60_000);
  });

  it("does not reach across a silence to a point beyond a short walk", () => {
    const points = [
      pt(0),
      pt(5),
      pt(10),
      pt(15),
      pt(20),
      pt(25),
      pt(40, 2000),
      pt(45, 2000),
      pt(50, 2000),
      pt(55, 2000),
      pt(60, 2000),
    ];
    const segments = derive(points, [home]);
    expect(segments.map((s) => `${s.kind} ${at(s)}`)).toEqual([
      "stay 06:00–06:25",
      "move 06:25–06:40",
      "stay 06:40–07:00",
    ]);
    expect((segments[1] as Move).gap).toBe(true); // 15 minutes of silence, no point, not a flight
  });

  it("names the nearest place whose radius holds a point", () => {
    const office: Place = {
      name: "Office",
      lat: 59.91,
      lon: 10.76,
      radius_m: 120,
      kind: "other",
      tags: [],
    };
    const near: Place = {
      name: "Cafe",
      lat: 59.9101,
      lon: 10.76,
      radius_m: 150,
      kind: "other",
      tags: [],
    };
    expect(placeAt(59.9101, 10.76, [home, office, near])?.name).toBe("Cafe");
    expect(placeAt(59.91, 10.76, [home, office, near])?.name).toBe("Office");
    expect(placeAt(60, 11, [home, office, near])).toBeUndefined();
  });
});

describe("a move between two clusters", () => {
  const base = { lat: 59.95, lon: 10.8 };
  const two = (gapMinutes: number, metres: number, interior: Point[] = []) => [
    pt(0, 0, 0, base),
    pt(5, 0, 0, base),
    pt(10, 0, 0, base),
    pt(15, 0, 0, base),
    pt(20, 0, 0, base),
    ...interior,
    pt(20 + gapMinutes, metres, 0, base),
    pt(25 + gapMinutes, metres, 0, base),
    pt(30 + gapMinutes, metres, 0, base),
    pt(35 + gapMinutes, metres, 0, base),
    pt(40 + gapMinutes, metres, 0, base),
  ];

  it("measures its distance along the points, from the stay's last point to the next stay's first", () => {
    const points = two(40, 2000, [
      pt(30, 500, 0, base),
      pt(40, 1000, 500, base),
      pt(50, 1500, 0, base),
    ]);
    const move = moves(derive(points))[0] as Move;
    let along = 0;
    for (let i = 4; i < 8; i++) {
      const a = points[i] as Point;
      const b = points[i + 1] as Point;
      along += distanceM(a.lat, a.lon, b.lat, b.lon);
    }
    expect(move.distanceM).toBe(Math.round(along));
    expect(move.interior).toHaveLength(3);
    expect(move.mode).toBe("walk");
  });

  it("takes its mode from the speed: walk, car, train, flight, and none below a kilometre an hour", () => {
    expect(moves(derive(two(15, 200)))[0]?.mode).toBeNull(); // 200 m in 15 min: 0.8 km/h
    expect(moves(derive(two(5, 400)))[0]?.mode).toBe("walk"); // 4.8 km/h
    expect(moves(derive(two(5, 4000)))[0]?.mode).toBe("car"); // 48 km/h
    expect(moves(derive(two(5, 11_500)))[0]?.mode).toBe("train"); // 138 km/h
    expect(moves(derive(two(5, 40_000)))[0]?.mode).toBe("flight"); // 480 km/h
  });

  it("is a gap when no point fell in a silence or more, unless it is a flight", () => {
    const points = two(60, 5000);
    const move = moves(derive(points))[0] as Move;
    expect(move.gap).toBe(true);
    expect(move.interior).toHaveLength(0);
    const flown = deriveSegments(points, {
      settings,
      places: [],
      evidence: [],
      airportNear: (lat) => (lat > base.lat + 0.01 ? "ZRH" : "OSL"),
    });
    const flight = moves(flown)[0] as Move;
    expect(flight.gap).toBe(false);
    expect(flight.mode).toBe("flight");
    expect(flight.airports).toEqual(["OSL", "ZRH"]);
  });

  it("is not a flight between one airport and itself", () => {
    const flown = deriveSegments(two(60, 5000), {
      settings,
      places: [],
      evidence: [],
      airportNear: () => "OSL",
    });
    expect(moves(flown)[0]?.airports).toEqual([]);
    expect(moves(flown)[0]?.gap).toBe(true);
  });
});

describe("aboard an asset", () => {
  const asset = { id: "solvind", kind: "yacht", name: "Solvind" };
  const berth = { lat: 59.905, lon: 10.735 };

  it("marks a segment whose points match the asset's track, and a move aboard a yacht is by boat", () => {
    const owner = [
      ...[0, 5, 10, 15, 20, 25].map((m) => pt(m, 0, 0, berth)),
      ...[30, 35, 40, 45, 50].map((m) => pt(m, (m - 25) * 100, 0, berth)),
      ...[55, 60, 65, 70, 75].map((m) => pt(m, 2500, 0, berth)),
    ];
    const track = owner.map((p) => ({ ...p, id: `a${p.seq}`, lat: p.lat + 20 * LAT_M }));
    const segments = derive(owner);
    markAboard(segments, [{ asset, points: track }], settings);
    expect(
      segments.map((s) => [s.kind, s.aboard?.id, s.kind === "move" ? s.mode : undefined]),
    ).toEqual([
      ["stay", "solvind", undefined],
      ["move", "solvind", "boat"],
      ["stay", "solvind", undefined],
    ]);
  });

  it("judges only the points that have an asset position within the window, and needs more than half to match", () => {
    const owner = [...[0, 5, 10, 15, 20, 25].map((m) => pt(m, 0, 0, berth))];
    const hourly = [{ ...(owner[0] as Point), id: "a1" }];
    const near = derive(owner);
    markAboard(near, [{ asset, points: hourly }], settings);
    expect(near[0]?.aboard?.id).toBe("solvind"); // one point judged, and it matches

    const away = derive(owner);
    const elsewhere = owner.map((p, i) => ({
      ...p,
      id: `b${i}`,
      lat: p.lat + (i % 3 === 0 ? 0 : 400) * LAT_M,
    }));
    markAboard(away, [{ asset, points: elsewhere }], settings);
    expect(away[0]?.aboard).toBeUndefined(); // two of six match
  });

  it("leaves a segment alone when the asset has no position near it in time", () => {
    const owner = [...[0, 5, 10, 15, 20, 25].map((m) => pt(m, 0, 0, berth))];
    const later = owner.map((p) => ({ ...p, id: `c${p.seq}`, ms: p.ms + 3_600_000 }));
    const segments = derive(owner);
    markAboard(segments, [{ asset, points: later }], settings);
    expect(segments[0]?.aboard).toBeUndefined();
  });
});
