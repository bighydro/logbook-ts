import { eachLine, type MonthFile, monthFiles, parseLine } from "./lines.js";
import { asRef, buildResolver, type Ref, type Resolver } from "./resolve.js";
import { formatRefusal, LogbookError, readMeta } from "./store.js";
import type { JsonValue, Line, Payload } from "./types.js";

export interface ShowOptions {
  /** The local day, `YYYY-MM-DD`. */
  day: string;
  /** An IANA zone. Defaults to `timezone` in logbook.json. */
  timezone?: string;
  /** Print every point and every ref as the source gave them. */
  raw?: boolean;
}

export interface ShowResult {
  /** One row per line, newline-terminated; or one sentence when the day has no lines. */
  text: string;
  /** The zone the times were printed in. */
  timezone: string;
  /** Rows printed (a run of collapsed points counts once). */
  rows: number;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const SUMMARY_WIDTH = 80;
const ELLIPSIS = "…";
const DASH = "–";

/** Throws LogbookError unless the zone is one this Node's ICU knows. */
export function checkTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
  } catch {
    throw new LogbookError(`unknown timezone ${timezone}`);
  }
}

/** True for `YYYY-MM-DD` naming a real calendar day. */
export function isDay(day: string): boolean {
  const m = DAY.exec(day);
  if (!m) return false;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(utc).toISOString().slice(0, 10) === day;
}

interface Local {
  day: string;
  clock: string;
}

/** Local calendar day and HH:MM of an instant in a zone; undefined when `at` is not a date. */
type Localize = (at: string) => Local | undefined;

function localizer(timezone: string): Localize {
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return (at) => {
    const ms = Date.parse(at);
    if (Number.isNaN(ms)) return undefined;
    const parts = format.formatToParts(new Date(ms));
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
    return {
      day: `${get("year")}-${get("month")}-${get("day")}`,
      clock: `${get("hour")}:${get("minute")}`,
    };
  };
}

/** The `YYYY-MM` keys whose files can hold a line of this local day: the UTC days around it. */
function candidateMonths(day: string): Set<string> {
  const m = DAY.exec(day) as RegExpExecArray;
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const months = new Set<string>();
  for (const offset of [-1, 0, 1]) {
    months.add(new Date(base + offset * 86_400_000).toISOString().slice(0, 7));
  }
  return months;
}

interface Entry {
  line: Line;
  ms: number;
  local: Local;
}

/**
 * The lines of one local day, as the reference CLI prints them: local time, kind, source, tier
 * and a short summary, sorted by `at`. Reads the month files around the day and streams every
 * file once for the resolution and retraction lines; nothing is loaded whole.
 */
export function showDay(root: string, options: ShowOptions): ShowResult {
  if (!isDay(options.day)) throw new LogbookError(`not a day: ${options.day}`);
  const meta = readMeta(root);
  const refusal = formatRefusal(meta);
  if (refusal) throw new LogbookError(refusal);
  const timezone = options.timezone ?? meta.timezone;
  if (typeof timezone !== "string" || timezone === "") {
    throw new LogbookError("logbook.json: timezone is missing; pass --tz");
  }
  checkTimezone(timezone);
  const local = localizer(timezone);

  const files = monthFiles(root);
  const resolver = buildResolver(judgements(files));
  const months = candidateMonths(options.day);
  const entries: Entry[] = [];
  for (const month of files) {
    if (!months.has(`${month.year}-${month.month}`)) continue;
    for (const { raw, row } of eachLine(month.file)) {
      const parsed = parseLine(raw, `${month.rel} line ${row}`);
      if ("error" in parsed) continue; // verify reports it; show reads what it can
      const { line } = parsed;
      if (line.kind === "retraction") continue; // shown where the line it hides is (RFC 0003 rule 3)
      if (typeof line.at !== "string") continue;
      const at = local(line.at);
      if (at === undefined || at.day !== options.day) continue;
      entries.push({ line, ms: Date.parse(line.at), local: at });
    }
  }
  entries.sort((a, b) => a.ms - b.ms || a.line.seq - b.line.seq);

  if (entries.length === 0) {
    return { text: `no lines on ${options.day} in ${timezone}\n`, timezone, rows: 0 };
  }
  const rows = toRows(entries, local, resolver, options.raw === true);
  return { text: layout(rows), timezone, rows: rows.length };
}

/** Every resolution and retraction line in the record, streamed. */
function* judgements(files: MonthFile[]): Generator<Line> {
  for (const month of files) {
    for (const { raw, row } of eachLine(month.file)) {
      const parsed = parseLine(raw, `${month.rel} line ${row}`);
      if ("error" in parsed) continue;
      const { kind } = parsed.line;
      if (kind === "resolution" || kind === "retraction") yield parsed.line;
    }
  }
}

interface RowText {
  time: string;
  kind: string;
  source: string;
  tier: string;
  summary: string;
}

function toRows(entries: Entry[], local: Localize, resolver: Resolver, raw: boolean): RowText[] {
  const rows: RowText[] = [];
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i] as Entry;
    let run = i + 1;
    if (
      !raw &&
      entry.line.kind === "location" &&
      resolver.retractedBy(entry.line.id) === undefined
    ) {
      while (
        run < entries.length &&
        (entries[run] as Entry).line.kind === "location" &&
        resolver.retractedBy((entries[run] as Entry).line.id) === undefined
      )
        run += 1;
    }
    if (run - i > 1) {
      const points = entries.slice(i, run);
      const last = points[points.length - 1] as Entry;
      const until =
        (typeof last.line.end === "string" ? local(last.line.end)?.clock : undefined) ??
        last.local.clock;
      rows.push({
        time: entry.local.clock,
        kind: "location",
        source: [...new Set(points.map((p) => String(p.line.source)))].join("+"),
        tier: `tier ${Math.max(...points.map((p) => Number(p.line.tier)))}`,
        summary: `${points.length} points ${entry.local.clock}${DASH}${until}`,
      });
    } else {
      rows.push(row(entry, local, resolver, raw));
    }
    i = run;
  }
  return rows;
}

function row(entry: Entry, local: Localize, resolver: Resolver, raw: boolean): RowText {
  const { line } = entry;
  const end = typeof line.end === "string" ? local(line.end) : undefined;
  const retraction = resolver.retractedBy(line.id);
  let summary: string;
  if (retraction) {
    const reason = retraction.payload.reason;
    summary =
      typeof reason === "string" && reason !== "" ? `[retracted: ${reason}]` : "[retracted]";
  } else {
    summary = summarize(line, resolver, raw);
  }
  return {
    time: end ? `${entry.local.clock}${DASH}${end.clock}` : entry.local.clock,
    kind: String(line.kind),
    source: String(line.source),
    tier: `tier ${String(line.tier)}`,
    summary: oneLine(summary),
  };
}

function summarize(line: Line, resolver: Resolver, raw: boolean): string {
  const p = line.payload ?? ({} as Payload);
  switch (line.kind) {
    case "location":
      return `${String(p.lat)},${String(p.lon)}`;
    case "message":
      return message(p, resolver, raw);
    case "event": {
      const title = typeof p.title === "string" ? p.title : String(p.schema ?? "event");
      const people = attendees(p.attendees, resolver, raw);
      return people.length ? `${title} (${people.join(", ")})` : title;
    }
    case "note":
      return typeof p.text === "string" ? p.text : String(p.schema ?? "note");
    case "resolution":
      return resolution(p);
    default:
      if (typeof p.text === "string") return p.text;
      if (typeof p.title === "string") return p.title;
      return String(p.schema ?? line.kind);
  }
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Who a ref is: the record's resolution, else the source's own name for it, else the ref itself. */
function who(
  ref: Ref | undefined,
  sourceName: string | undefined,
  resolver: Resolver,
  raw: boolean,
) {
  if (ref === undefined) return sourceName;
  if (raw) return ref.value;
  return resolver.name(ref) ?? sourceName ?? ref.value;
}

function message(p: Payload, resolver: Resolver, raw: boolean): string {
  const chat = p.chat;
  const chatLabel =
    typeof chat === "string"
      ? chat
      : chat !== null && typeof chat === "object" && !Array.isArray(chat)
        ? (text(chat.name) ?? text(chat.id))
        : undefined;
  const direct =
    chat !== null && typeof chat === "object" && !Array.isArray(chat) && chat.type === "direct";
  const sender = p.sender;
  const senderRef = asRef(sender);
  const senderName =
    sender !== null && typeof sender === "object" && !Array.isArray(sender)
      ? text(sender.name)
      : undefined;
  let by: string | undefined;
  if (p.from_me === true) by = "me";
  else {
    by = who(senderRef, raw ? undefined : senderName, resolver, raw);
    if (by === undefined && direct && !raw) by = chatLabel;
  }
  const head = chatLabel ?? by ?? String(p.schema ?? "message");
  const opener = by !== undefined && by !== chatLabel ? `${head} (${by})` : head;
  const body = text(p.text);
  return body === undefined ? opener : `${opener}: ${body}`;
}

function attendees(value: JsonValue | undefined, resolver: Resolver, raw: boolean): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      names.push(who({ kind: "email", value: item }, undefined, resolver, raw) ?? item);
    } else if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const ref = asRef(item.ref);
      const name = who(ref, raw ? undefined : text(item.name), resolver, raw);
      if (name !== undefined) names.push(name);
    }
  }
  return names;
}

function resolution(p: Payload): string {
  const ref = asRef(p.ref);
  const subject = ref ? `${ref.kind} ${ref.value}` : "?";
  const alias = asRef(p.alias_of);
  if (alias) return `${subject} → alias of ${alias.kind} ${alias.value}`;
  const entity = p.entity;
  if (entity !== null && typeof entity === "object" && !Array.isArray(entity)) {
    const type = text(entity.type) ?? "entity";
    return `${subject} → ${type} ${text(p.label) ?? text(entity.id) ?? "?"}`;
  }
  return `${subject} → ${text(p.label) ?? "?"}`;
}

/** The first line, at most SUMMARY_WIDTH characters, with an ellipsis when cut. */
function oneLine(value: string): string {
  const first = value.split(/\r?\n/, 1)[0] as string;
  const chars = [...first];
  if (chars.length <= SUMMARY_WIDTH) return first;
  return `${chars.slice(0, SUMMARY_WIDTH - 1).join("")}${ELLIPSIS}`;
}

function layout(rows: RowText[]): string {
  const width = (pick: (r: RowText) => string) => Math.max(...rows.map((r) => [...pick(r)].length));
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - [...s].length));
  const time = width((r) => r.time);
  const kind = width((r) => r.kind);
  const source = width((r) => r.source);
  return rows
    .map(
      (r) =>
        `${pad(r.time, time)}  ${pad(r.kind, kind)}  ${pad(r.source, source)}  ${r.tier}  ${r.summary}\n`,
    )
    .join("");
}
