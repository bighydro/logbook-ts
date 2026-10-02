import { localOf } from "./clock.js";
import {
  type Attached,
  type Company,
  callText,
  type Day,
  type DayNight,
  type FlightEntry,
  type SegmentEntry,
  type TimelineEntry,
} from "./day.js";
import { roundHalfEven } from "./geo.js";

const DASH = "–";
const pad = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - [...s].length));
const header = (label: string, value: string): string => `  ${pad(label, 13)} ${value}`;

/** `4 h 55 min`, `9 h`, `35 min`: a span to the nearest minute. */
export function durationText(seconds: number): string {
  const minutes = roundHalfEven(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h} h ${m} min`;
  if (h > 0) return `${h} h`;
  return `${m} min`;
}

/** `446 m`, `9.0 km`, `36.7 km`, `1426 km`. */
export function distanceText(metres: number): string {
  if (metres < 1000) return `${roundHalfEven(metres)} m`;
  const km = metres / 1000;
  return km < 100 ? `${km.toFixed(1)} km` : `${roundHalfEven(km)} km`;
}

const plural = (n: number, word: string, words = `${word}s`): string =>
  `${n} ${n === 1 ? word : words}`;

/** `1 event, 1 mail thread, 2 messages`: what a row carries, counted. */
function attachedCounts(a: Attached): string[] {
  const parts: string[] = [];
  if (a.events.length) parts.push(plural(a.events.length, "event"));
  if (a.transcripts.length) parts.push(plural(a.transcripts.length, "transcript"));
  if (a.notes.length) parts.push(plural(a.notes.length, "note"));
  if (a.mail.length) parts.push(plural(a.mail.length, "mail thread"));
  if (a.calls.length) parts.push(plural(a.calls.length, "call"));
  if (a.messages.count) parts.push(plural(a.messages.count, "message"));
  if (a.photos.count) parts.push(plural(a.photos.count, "photo"));
  if (a.keepers.length) parts.push(plural(a.keepers.length, "keeper"));
  return parts;
}

/** The text of a day, as the reference's `logbook day` prints it. */
export function renderDay(day: Day): string {
  const tz = day.tz;
  const dayStart = Date.parse(`${day.day}T00:00:00Z`);
  /** `HH:MM` on the day's clock; `24:00` at the end of the day. */
  const clock = (at: string): string => {
    const ms = Date.parse(at);
    const local = localOf(ms, tz);
    if (local.day > day.day) return "24:00";
    return local.clock;
  };
  /** `HH:MM`, with `+N` when the instant falls on a later local day. */
  const clockAcross = (at: string): string => {
    const local = localOf(Date.parse(at), tz);
    if (local.day <= day.day) return local.clock;
    const days = Math.round((Date.parse(`${local.day}T00:00:00Z`) - dayStart) / 86_400_000);
    return `${local.clock}+${days}`;
  };
  const span = (start: string, end: string | null): string =>
    end === null ? clock(start) : `${clock(start)}${DASH}${clock(end)}`;

  const lines: string[] = [`${day.day}  ${day.weekday}`];
  lines.push(header("night before", nightText(day.nights.before)));
  lines.push(header("night after", nightText(day.nights.after)));
  lines.push(header("country", countryText(day)));
  if (day.all_day.length)
    lines.push(header("all day", day.all_day.map((e) => e.title).join(" · ")));
  lines.push("");

  const under = (indent: string, label: string, value: string): string =>
    `${indent}${pad(label, 12)} ${value}`;
  const attachments = (indent: string, a: Attached, w: Company | undefined): void => {
    for (const e of a.events) {
      const when =
        e.end === null ? clock(e.start) : `${clock(e.start)}${DASH}${clockAcross(e.end)}`;
      lines.push(under(indent, "event", `${e.title} ${when}`));
    }
    for (const t of a.transcripts) lines.push(under(indent, "transcript", t.title));
    for (const n of a.notes) lines.push(under(indent, "note", n.text));
    for (const m of a.mail)
      lines.push(under(indent, "mail", `${m.subject} (${plural(m.messages, "message")})`));
    for (const c of a.calls) lines.push(under(indent, "call", callText(c)));
    for (const k of a.keepers)
      lines.push(under(indent, "keeper", `${k.name} (${k.lane ?? "None"})`));
    if (w !== undefined && (w.confirmed.length || w.proposed.length)) {
      const person = (p: { name: string; sources: string[] }) =>
        `${p.name} (${p.sources.join(", ")})`;
      const parts: string[] = [];
      if (w.confirmed.length) parts.push(w.confirmed.map(person).join(", "));
      if (w.proposed.length) parts.push(`proposed ${w.proposed.map(person).join(", ")}`);
      lines.push(under(indent, "with", parts.join(" · ")));
    }
  };

  const row = (indent: string, entry: TimelineEntry, inside = false): void => {
    if (entry.kind === "flight") {
      lines.push(
        `${indent}${span(entry.start, entry.end)}  ${pad("flight", 6)} ${flightText(entry)}`,
      );
      return;
    }
    const when = `${clock(entry.within_day.start)}${DASH}${clock(entry.within_day.end)}`;
    const kind = entry.kind === "move" && entry.gap ? "gap" : entry.kind;
    lines.push(`${indent}${when}  ${pad(kind, 6)} ${rowText(entry, inside)}`);
    if (entry.kind === "aboard") {
      for (const inner of entry.inside ?? []) row(`${indent}    `, inner, true);
    }
    if (entry.attached !== undefined) attachments(`${indent}    `, entry.attached, entry.with);
  };
  if (day.timeline.length === 0) lines.push(header("timeline", "nothing logged"));
  for (const entry of day.timeline) row("  ", entry);

  if (day.unplaced.length) {
    lines.push("");
    for (const u of day.unplaced) {
      lines.push(header("unplaced", `${span(u.at, u.end)}  ${pad(u.kind, 6)} ${u.title}`));
    }
  }

  lines.push("");
  lines.push(header("health", healthText(day)));
  lines.push(
    header(
      "sources",
      day.sources.length
        ? day.sources
            .map(
              (s) =>
                `${s.source} ${plural(s.lines, "line")}, last ${localOf(Date.parse(s.newest), tz).clock}`,
            )
            .join(" · ")
        : "none",
    ),
  );
  return `${lines.join("\n")}\n`;
}

function nightText(night: DayNight): string {
  if (night.in_transit || night.where === null) return "in transit";
  return `${night.where} · ${night.home ? "home" : "away"}`;
}

function countryText(day: Day): string {
  const c = day.country;
  if (c.code === null) return "unknown";
  const how = c.method === "place" ? `place ${c.by}` : `nearest airport ${c.by}`;
  return `${c.code} (${how})${c.from === "longest stay" ? " · from the longest stay" : ""}`;
}

/** The text column of a stay, stop, move or run aboard; a row inside a run does not repeat the asset. */
function rowText(entry: SegmentEntry, inside: boolean): string {
  const parts: string[] = [];
  const duration = durationText(entry.within_day.duration_s);
  const counts = entry.attached === undefined ? [] : attachedCounts(entry.attached);
  switch (entry.kind) {
    case "aboard":
      parts.push(
        `${entry.asset?.name ?? entry.aboard} (${entry.asset?.kind ?? "asset"})`,
        duration,
      );
      break;
    case "move":
      if (entry.gap) {
        parts.push(duration, "no points", distanceText(entry.distance_m ?? 0));
      } else {
        parts.push(distanceText(entry.distance_m ?? 0), duration, entry.mode ?? "mode unknown");
        if (entry.airports.length === 2) parts.push(`${entry.airports[0]} → ${entry.airports[1]}`);
      }
      break;
    default:
      parts.push(entry.where ?? "", duration);
      if (entry.aboard !== null && !inside) parts.push(`aboard ${entry.aboard}`);
      if (entry.kind === "stop") parts.push("nothing attached");
  }
  if (counts.length) parts.push(counts.join(", "));
  return parts.join(" · ");
}

/** `XY 561  OSL → ZRH · tracked`; a missing carrier or number is `None`, as the reference prints it (SPEC-QUESTIONS 47). */
function flightText(f: FlightEntry): string {
  const head = `${f.carrier ?? "None"} ${f.number ?? "None"}  ${f.from ?? "None"} → ${f.to ?? "None"}`;
  return `${head} · ${f.evidence ?? "None"}`;
}

/** `sleep 6.6 h · 8,115 steps · resting 53 bpm`; the heart-rate variability is in the JSON only. */
function healthText(day: Day): string {
  const h = day.health;
  if (h === null) return "no lines";
  const parts: string[] = [];
  if (h.sleep_h !== null) parts.push(`sleep ${h.sleep_h.toFixed(1)} h`);
  if (h.steps !== null) parts.push(`${h.steps.toLocaleString("en-US")} steps`);
  if (h.resting_hr !== null) parts.push(`resting ${h.resting_hr} bpm`);
  return parts.length ? parts.join(" · ") : "no lines";
}
