/** Text helpers shared by the screens `stats` and `sources` print, spelled as the reference spells them. */

/** `12772` as `12,772`. */
export function withCommas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** `n` with the noun, singular for one: `1 line`, `2 lines`, `1 entity`, `3 entities`. */
export function plural(n: number, noun: string, nouns = `${noun}s`): string {
  return `${withCommas(n)} ${n === 1 ? noun : nouns}`;
}

export const padEnd = (s: string, width: number): string =>
  s + " ".repeat(Math.max(0, width - [...s].length));

export const padStart = (s: string, width: number): string =>
  " ".repeat(Math.max(0, width - [...s].length)) + s;

/** Python's `round()`: half to even. */
export function roundHalfEven(x: number): number {
  return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x);
}

/** A bar of one character per percent of `busiest`, a hundred for the busiest itself. */
export function bar(lines: number, busiest: number): string {
  return "█".repeat(busiest === 0 ? 0 : roundHalfEven((lines / busiest) * 100));
}
