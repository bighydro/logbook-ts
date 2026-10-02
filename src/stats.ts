import { existsSync } from "node:fs";
import { join } from "node:path";
import { checkTimezone, localizer } from "./clock.js";
import { eachLine, monthFiles, parseLine } from "./lines.js";
import { formatRefusal, LogbookError, readMeta } from "./store.js";
import { bar, padEnd, padStart, plural, withCommas } from "./table.js";
import type { JsonValue, Line } from "./types.js";

export interface KindStats {
  kind: string;
  lines: number;
  /** First and last local day with a line of this kind. */
  first: string;
  last: string;
  /** Distinct sources. */
  sources: number;
}

export interface Counted {
  lines: number;
}

/** What `stats` reports: `stats --json` prints exactly this. */
export interface Stats {
  format: string;
  head: string;
  lines: number;
  /** The earliest and latest `at`, as stored; null on an empty record. */
  first: string | null;
  last: string | null;
  /** By lines, then by name. */
  kinds: KindStats[];
  sources: Array<{ source: string } & Counted>;
  /** Local years, oldest first. */
  years: Array<{ year: string } & Counted>;
  tiers: Array<{ tier: string } & Counted>;
  /** Local months, oldest first. */
  months: Array<{ month: string } & Counted>;
  /** Retraction lines, and the distinct lines they name in `supersedes`. */
  retractions: { lines: number; hidden: number };
  /** Resolution lines, and the distinct `entity.id` they carry. */
  resolutions: { lines: number; entities: number };
  /** Distinct digests referenced under `payload.media`, `payload.extra.media` or `payload.content`
   * (SPEC §1.1), the lines referencing one, and the digests with a file under `attachments/`. */
  attachments: { referenced: number; lines: number; present: number };
  took_seconds: number;
}

const HEX64 = /^[0-9a-f]{64}$/;

interface KindTally {
  lines: number;
  first: string;
  last: string;
  sources: Set<string>;
}

function bump<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function obj(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined;
}

/** The digests a line references under `media`, `extra.media` and `content`. */
function digestsOf(line: Line): string[] {
  const payload = obj(line.payload);
  if (payload === undefined) return [];
  const found: string[] = [];
  for (const candidate of [payload.media, obj(payload.extra)?.media, payload.content]) {
    const sha = obj(candidate)?.sha256;
    if (typeof sha === "string") found.push(sha);
  }
  return found;
}

/**
 * One screen of what a record holds, counted in one pass over every month file: lines per kind,
 * source, local year, tier and local month; the retractions and what they hide; the resolution
 * lines and the entities they mint; the attachments referenced and present. Numbers, kinds,
 * sources and dates only, never what a line says. What is held is one counter per distinct kind,
 * source, month, entity and digest, never the lines.
 */
export function collectStats(root: string): Stats {
  const started = performance.now();
  const meta = readMeta(root);
  const refusal = formatRefusal(meta);
  if (refusal) throw new LogbookError(refusal);
  const timezone = meta.timezone;
  if (typeof timezone !== "string" || timezone === "") {
    throw new LogbookError("logbook.json: timezone is missing");
  }
  checkTimezone(timezone);
  const local = localizer(timezone);

  let lines = 0;
  let first: { at: string; ms: number } | undefined;
  let last: { at: string; ms: number } | undefined;
  const kinds = new Map<string, KindTally>();
  const sources = new Map<string, number>();
  const years = new Map<string, number>();
  const tiers = new Map<string, number>();
  const months = new Map<string, number>();
  let retractions = 0;
  const hidden = new Set<string>();
  let resolutions = 0;
  const entities = new Set<string>();
  const digests = new Set<string>();
  let referencing = 0;

  for (const month of monthFiles(root)) {
    for (const { raw, row } of eachLine(month.file)) {
      const parsed = parseLine(raw, `${month.rel} line ${row}`);
      if ("error" in parsed) continue; // verify reports it; stats counts what it can read
      const { line } = parsed;
      lines += 1;
      const kind = String(line.kind);
      const source = String(line.source);
      bump(sources, source);
      bump(tiers, String(line.tier));
      const at = typeof line.at === "string" ? local(line.at) : undefined;
      if (at !== undefined) {
        const ms = Date.parse(line.at);
        if (first === undefined || ms < first.ms) first = { at: line.at, ms };
        if (last === undefined || ms > last.ms) last = { at: line.at, ms };
        bump(years, at.day.slice(0, 4));
        bump(months, at.day.slice(0, 7));
        const tally = kinds.get(kind);
        if (tally === undefined) {
          kinds.set(kind, { lines: 1, first: at.day, last: at.day, sources: new Set([source]) });
        } else {
          tally.lines += 1;
          if (at.day < tally.first) tally.first = at.day;
          if (at.day > tally.last) tally.last = at.day;
          tally.sources.add(source);
        }
      }
      const payload = obj(line.payload);
      if (kind === "retraction") {
        retractions += 1;
        const target = payload?.supersedes;
        if (typeof target === "string") hidden.add(target);
      }
      if (kind === "resolution") {
        resolutions += 1;
        const id = obj(payload?.entity)?.id;
        if (typeof id === "string") entities.add(id);
      }
      const found = digestsOf(line);
      if (found.length) referencing += 1;
      for (const sha of found) digests.add(sha);
    }
  }

  let present = 0;
  for (const sha of digests) {
    if (HEX64.test(sha) && existsSync(join(root, "attachments", sha))) present += 1;
  }

  const byCount =
    <T extends Counted>(name: (t: T) => string) =>
    (a: T, b: T) =>
      b.lines - a.lines || (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0);
  const chronological =
    <T>(key: (t: T) => string) =>
    (a: T, b: T) =>
      key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

  return {
    format: String(meta.format),
    head: String(meta.head),
    lines,
    first: first?.at ?? null,
    last: last?.at ?? null,
    kinds: [...kinds]
      .map(([kind, t]) => ({
        kind,
        lines: t.lines,
        first: t.first,
        last: t.last,
        sources: t.sources.size,
      }))
      .sort(byCount((k) => k.kind)),
    sources: [...sources]
      .map(([source, n]) => ({ source, lines: n }))
      .sort(byCount((s) => s.source)),
    years: [...years].map(([year, n]) => ({ year, lines: n })).sort(chronological((y) => y.year)),
    tiers: [...tiers].map(([tier, n]) => ({ tier, lines: n })).sort(chronological((t) => t.tier)),
    months: [...months]
      .map(([month, n]) => ({ month, lines: n }))
      .sort(chronological((m) => m.month)),
    retractions: { lines: retractions, hidden: hidden.size },
    resolutions: { lines: resolutions, entities: entities.size },
    attachments: { referenced: digests.size, lines: referencing, present },
    took_seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
  };
}

/** The screen, as the reference prints it, with the tier and month tables added after the years. */
export function statsText(stats: Stats): string {
  const out: string[] = [`${stats.format}  head ${stats.head}`];
  if (stats.first === null || stats.last === null) out.push(`${withCommas(stats.lines)} lines`);
  else out.push(`${withCommas(stats.lines)} lines  first ${stats.first}  last ${stats.last}`);
  out.push("");
  // Every lines column is as wide as the total, five at least; a name column is as wide as the
  // longest name, ten at least.
  const width = Math.max(5, withCommas(stats.lines).length);
  const count = (n: number): string => padStart(withCommas(n), width);
  const nameWidth = (names: string[]): number => Math.max(10, ...names.map((n) => [...n].length));

  if (stats.kinds.length) {
    const w = nameWidth(stats.kinds.map((k) => k.kind));
    out.push(`  ${padEnd("kind", w)}  ${padStart("lines", width)}   first       last`);
    for (const k of stats.kinds) {
      out.push(
        `  ${padEnd(k.kind, w)}  ${count(k.lines)}   ${k.first}  ${k.last}   ${plural(k.sources, "source")}`,
      );
    }
    out.push("");
  }
  if (stats.sources.length) {
    const w = nameWidth(stats.sources.map((s) => s.source));
    out.push(`  ${padEnd("source", w)}  ${padStart("lines", width)}`);
    for (const s of stats.sources) out.push(`  ${padEnd(s.source, w)}  ${count(s.lines)}`);
    out.push("");
  }
  const barred = (title: string, rows: Array<{ name: string } & Counted>): void => {
    if (rows.length === 0) return;
    const w = Math.max(title.length, ...rows.map((r) => r.name.length));
    const busiest = Math.max(...rows.map((r) => r.lines));
    out.push(`  ${padEnd(title, w)}  ${padStart("lines", width)}`);
    for (const r of rows)
      out.push(`  ${padEnd(r.name, w)}  ${count(r.lines)}  ${bar(r.lines, busiest)}`);
    out.push("");
  };
  barred(
    "year",
    stats.years.map((y) => ({ name: y.year, lines: y.lines })),
  );
  if (stats.tiers.length) {
    const w = Math.max(4, ...stats.tiers.map((t) => t.tier.length));
    out.push(`  ${padEnd("tier", w)}  ${padStart("lines", width)}`);
    for (const t of stats.tiers) out.push(`  ${padEnd(t.tier, w)}  ${count(t.lines)}`);
    out.push("");
  }
  barred(
    "month",
    stats.months.map((m) => ({ name: m.month, lines: m.lines })),
  );

  out.push(
    `${plural(stats.retractions.lines, "retraction")} hiding ${plural(stats.retractions.hidden, "line")}`,
  );
  out.push(
    `${plural(stats.resolutions.lines, "resolution line")} minting ${plural(stats.resolutions.entities, "entity", "entities")}`,
  );
  out.push(
    `${plural(stats.attachments.referenced, "attachment")} referenced by ${plural(stats.attachments.lines, "line")}, ${withCommas(stats.attachments.present)} present under attachments/`,
  );
  out.push("", `took ${stats.took_seconds.toFixed(3)}s`);
  return `${out.join("\n")}\n`;
}
