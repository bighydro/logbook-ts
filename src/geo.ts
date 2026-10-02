/** The mean Earth radius the distances here use, in metres. */
export const EARTH_RADIUS_M = 6_371_000;

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two WGS-84 points (the haversine formula). */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = rad(lat1);
  const p2 = rad(lat2);
  const dl = rad(lon2 - lon1);
  const x = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, x)));
}

/**
 * The sum of doubles, exactly rounded (Shewchuk's algorithm, as Python's `math.fsum`): the order
 * of the terms does not change the result, so two implementations summing the same coordinates
 * get the same centroid to the last digit.
 */
export function fsum(values: Iterable<number>): number {
  const partials: number[] = [];
  for (let x of values) {
    let i = 0;
    for (let y of partials) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) partials[i++] = lo;
      x = hi;
    }
    partials.length = i;
    partials.push(x);
  }
  // Sum the partials from the smallest up, with the correction Python applies for a half-way case.
  let n = partials.length;
  if (n === 0) return 0;
  let hi = partials[--n] as number;
  let lo = 0;
  while (n > 0) {
    const x = hi;
    const y = partials[--n] as number;
    hi = x + y;
    const yr = hi - x;
    lo = y - yr;
    if (lo !== 0) break;
  }
  if (
    n > 0 &&
    ((lo < 0 && (partials[n - 1] as number) < 0) || (lo > 0 && (partials[n - 1] as number) > 0))
  ) {
    const y = lo * 2;
    const x = hi + y;
    const yr = x - hi;
    if (y === yr) hi = x;
  }
  return hi;
}

/** The arithmetic mean through `fsum`. */
export function mean(values: number[]): number {
  return fsum(values) / values.length;
}

/**
 * `x` rounded to `decimals` places as Python's `round(x, n)` does: by the exact value of the double,
 * and half to even when it sits exactly on a tie (6.25 to one place is 6.2).
 */
export function roundTo(x: number, decimals: number): number {
  // toFixed spells the double's exact decimal expansion, so a tie is a 5 followed by zeros only.
  const exact = x.toFixed(Math.min(100, decimals + 60));
  const dot = exact.indexOf(".");
  const tail = exact.slice(dot + 1 + decimals);
  if (!/^50*$/.test(tail)) return Number(x.toFixed(decimals));
  const kept = exact.slice(0, dot + 1 + decimals);
  let digits = BigInt(kept.replace(/[-.]/g, ""));
  if (digits % 2n === 1n) digits += 1n; // half to even
  const text = digits.toString().padStart(decimals + 1, "0");
  const value = Number(
    `${text.slice(0, text.length - decimals)}.${text.slice(text.length - decimals)}`,
  );
  return x < 0 ? -value : value;
}

/** Python's `round()`: to the nearest integer, half to even. */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** `lat,lon` to four decimals, as the reference labels an unnamed place. */
export function coordinates(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}
