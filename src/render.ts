import { pyStr } from "./pyrepr.js";
import { asRef, type Ref, type Resolver } from "./resolve.js";
import { signedDayRow } from "./signing.js";
import type { JsonValue, Line, Payload } from "./types.js";

/** What a row's summary needs besides the line itself. */
export interface RenderContext {
  resolver: Resolver;
  /** Print refs as the sources gave them, bodies whole, never a name. */
  raw: boolean;
  /** Local `HH:MM` of an RFC 3339 instant in the day's zone; undefined when it does not parse. */
  clock: (at: string) => string | undefined;
  /** For a `flight/v1` line another flight line supersedes: that line's seq. */
  supersededFlights: Map<string, number>;
}

/** The one-line summary of a line, as the reference implementation spells it for each profile. */
export function summarize(line: Line, ctx: RenderContext): string {
  const p = payloadOf(line);
  switch (line.kind) {
    case "message":
      return message(p, ctx);
    case "event":
      return event(p, ctx);
    case "note":
      return note(p, ctx);
    case "flight":
      return flight(line, p, ctx);
    case "call":
      return call(p, ctx);
    case "transcript":
      return transcript(p, ctx);
    case "mail":
      return mail(p, ctx);
    case "voice-memo":
      return voiceMemo(p);
    case "highlight":
      return highlight(p);
    case "trip":
      return trip(p);
    case "crossing":
      return crossing(p);
    case "keeper":
      return `hero photo (${pyStr(p.lane)}): ${keeperPhoto(p)}`;
    case "signed-day":
      return signedDayRow(p);
    default:
      return fallback(line.kind, p);
  }
}

/** Lines printed under a row: the body of a mail line with `--raw`, four spaces in. */
export function underneath(line: Line, ctx: RenderContext): string[] {
  if (!ctx.raw || line.kind !== "mail") return [];
  const body = text(payloadOf(line).body);
  return body === undefined ? [] : splitLines(body).map((row) => `    ${row}`);
}

/** A run of location points, from one source and of one subject (SPEC §3.2, RFC 0001 rule 3). */
export function points(count: number, subject: string | undefined): string {
  const n = `${count} point${count === 1 ? "" : "s"}`;
  return subject === undefined ? n : `${subject}: ${n}`;
}

/** `[retracted …]` is the reference's `retracted #<seq>: <reason>`; the row has no kind or source. */
export function retracted(retraction: Line): string {
  const seq = retraction.payload?.seq;
  const reason = text(retraction.payload?.reason) ?? "";
  return `retracted #${Number.isInteger(seq) ? String(seq) : "?"}: ${reason}`;
}

/**
 * How a keeper names its photo (RFC 0024), as the reference spells it: the photo's `file_name`,
 * else its `asset_id`, else the photo line's id, else `?`; a `photo` that is not an object is `?`.
 */
export function keeperPhoto(p: Payload): string {
  const photo = obj(p.photo);
  if (photo === undefined) return "?";
  for (const key of ["file_name", "asset_id", "line"]) {
    const value = photo[key];
    if (truthy(value)) return pyStr(value);
  }
  return "?";
}

/** Python's truth of a JSON value: null, false, 0, "", [] and {} are false. */
function truthy(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null || value === false || value === 0 || value === "")
    return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function payloadOf(line: Line): Payload {
  const p = line.payload;
  return p !== null && typeof p === "object" && !Array.isArray(p) ? p : { schema: "" };
}

/** Python's `str.splitlines()`: every line break, a trailing one ending the last line. */
export function splitLines(s: string): string[] {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the breaks Python's str.splitlines knows
  const rows = s.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (rows[rows.length - 1] === "") rows.pop();
  return rows;
}

type Obj = { [key: string]: JsonValue };

function obj(value: JsonValue | undefined): Obj | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

/** A non-empty string, else undefined (Python's `or` treats "" as nothing). */
function text(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function num(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** Python's `round()`: half to even. */
function roundHalfEven(x: number): number {
  return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A ref's name: the record's resolution, else the source's own name, else the ref itself. */
function named(
  ref: Ref | undefined,
  name: string | undefined,
  ctx: RenderContext,
): string | undefined {
  if (ctx.raw) return ref?.value;
  return (ref && ctx.resolver.name(ref)) ?? name ?? ref?.value;
}

function message(p: Payload, ctx: RenderContext): string {
  const chat = obj(p.chat);
  // SPEC §3.2: a string chat (the conformance sample's shape) is read as a direct chat's name.
  const chatName = typeof p.chat === "string" ? p.chat : text(chat?.name);
  const chatLabel = chatName ?? text(chat?.id) ?? "";
  const direct = typeof p.chat === "string" || chat?.type === "direct";
  const body = text(p.text) ?? `[${text(p.media_kind) ?? "media"}]`;
  if (p.from_me === true)
    return direct ? `me → ${chatLabel}: ${body}` : `me in ${chatLabel}: ${body}`;
  const sender = obj(p.sender);
  const ref = asRef(p.sender);
  let who: string | undefined;
  if (ctx.raw) who = ref?.value;
  else {
    // In a direct chat the chat's own name stands in for a sender nothing names.
    who =
      (ref && ctx.resolver.name(ref)) ??
      text(sender?.name) ??
      (direct ? chatName : undefined) ??
      ref?.value;
  }
  return direct ? `${who ?? ""}: ${body}` : `${who ?? ""} in ${chatLabel}: ${body}`;
}

/** An attendee as RFC 0009 shapes it, or a bare string read as an email (SPEC §3.2). */
function attendee(item: JsonValue, ctx: RenderContext): string | undefined {
  if (typeof item === "string") return named({ kind: "email", value: item }, undefined, ctx);
  const o = obj(item);
  if (o === undefined) return undefined;
  const ref = asRef(o.ref);
  const name = text(o.name);
  return ctx.raw ? (ref?.value ?? name) : named(ref, name, ctx);
}

function event(p: Payload, ctx: RenderContext): string {
  const parts: string[] = [];
  const title = text(p.title);
  if (title !== undefined) parts.push(title);
  const organizer =
    typeof p.organizer === "string" ? { kind: "email", value: p.organizer } : asRef(p.organizer);
  if (organizer) parts.push(`by ${named(organizer, undefined, ctx) ?? organizer.value}`);
  if (Array.isArray(p.attendees)) {
    const names = p.attendees
      .map((a) => attendee(a, ctx))
      .filter((n): n is string => n !== undefined);
    if (names.length) parts.push(`with ${names.join(", ")}`);
  }
  return parts.join(" · ");
}

function note(p: Payload, ctx: RenderContext): string {
  const body = typeof p.text === "string" ? p.text : "";
  if (ctx.raw) return body;
  const rows = splitLines(body);
  while (rows.length && (rows[0] as string).trim() === "") rows.shift();
  const first = rows[0] ?? "";
  const more = rows.length - 1;
  return more > 0 ? `${first} … (+${plural(more, "line")})` : first;
}

function flight(line: Line, p: Payload, ctx: RenderContext): string {
  const by = ctx.supersededFlights.get(line.id);
  if (by !== undefined) return `superseded by #${by}`;
  const code = (o: JsonValue | undefined) => text(obj(o)?.iata) ?? text(obj(o)?.icao) ?? "";
  const diverted = obj(p.diverted_to) ? ` (landed ${code(p.diverted_to)})` : "";
  const parts = [
    `${text(p.carrier) ?? ""} ${text(p.number) ?? ""} ${code(p.from)} → ${code(p.to)}${diverted}`.trim(),
  ];
  if (p.cancelled === true) parts.push("cancelled");
  const arrival = text(p.actual_arrival) ?? text(p.scheduled_arrival);
  const arrives = arrival === undefined ? undefined : ctx.clock(arrival);
  if (arrives !== undefined) parts.push(`arrives ${arrives}`);
  const aircraft = [text(obj(p.aircraft)?.type), text(obj(p.aircraft)?.registration)]
    .filter(Boolean)
    .join(" ");
  if (aircraft) parts.push(aircraft);
  const evidence = text(p.evidence);
  if (evidence !== undefined) parts.push(evidence);
  if (p.role === "pilot") parts.push("as pilot");
  return parts.join(", ");
}

function call(p: Payload, ctx: RenderContext): string {
  const outgoing = p.direction === "outgoing";
  const ref = asRef(p.counterparty);
  const who = named(ref, undefined, ctx) ?? "withheld";
  const parts = [`${outgoing ? "→" : "←"} ${who}`];
  const seconds = num(p.duration_s);
  if (p.answered !== true && !p.answered) parts.push(outgoing ? "no answer" : "missed");
  else if (seconds !== undefined && seconds > 0) {
    parts.push(seconds >= 60 ? `${Math.floor(seconds / 60)} min` : `${pyStr(seconds)} s`);
  }
  const service = text(p.service);
  if (service !== undefined) parts.push(service);
  return parts.join(", ");
}

function transcript(p: Payload, ctx: RenderContext): string {
  let out = text(p.title) ?? "transcript";
  if (Array.isArray(p.participants)) {
    const names: string[] = [];
    for (const item of p.participants) {
      const o = obj(item);
      if (o === undefined) continue;
      const email = text(o.email);
      const name = text(o.name);
      const who = ctx.raw
        ? (name ?? email)
        : ((email === undefined ? undefined : ctx.resolver.name({ kind: "email", value: email })) ??
          name ??
          email);
      if (who !== undefined) names.push(who);
    }
    if (names.length) out += ` — ${names.join(", ")}`;
  }
  const extra = obj(p.extra);
  const tail: string[] = [];
  const turns = num(extra?.turns);
  if (turns !== undefined) tail.push(plural(turns, "turn"));
  const length = num(extra?.duration_s);
  if (length !== undefined) tail.push(`${roundHalfEven(length / 60)} min`);
  return tail.length ? `${out}; ${tail.join(", ")}` : out;
}

function mail(p: Payload, ctx: RenderContext): string {
  const person = (value: JsonValue): string | undefined => {
    const o = obj(value);
    if (o === undefined) return undefined;
    const email = text(o.email);
    if (ctx.raw) return email;
    return (
      (email === undefined ? undefined : ctx.resolver.name({ kind: "email", value: email })) ??
      text(o.name) ??
      email
    );
  };
  const from = !ctx.raw && p.direction === "sent" ? "me" : (person(p.from ?? null) ?? "?");
  const recipients = [...(Array.isArray(p.to) ? p.to : []), ...(Array.isArray(p.cc) ? p.cc : [])]
    .map(person)
    .filter((r): r is string => r !== undefined);
  let out = `✉ ${text(p.subject) ?? "(no subject)"} — ${from}`;
  if (recipients.length) out += ` → ${recipients.join(", ")}`;
  const attachments = Array.isArray(p.attachments) ? p.attachments.length : 0;
  if (attachments > 0) out += ` (${plural(attachments, "attachment")})`;
  return out;
}

function voiceMemo(p: Payload): string {
  let out = text(p.title) ?? "recording";
  const duration = num(p.duration_s);
  if (duration !== undefined) {
    const s = roundHalfEven(duration);
    out += ` (${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")})`;
  }
  const media = obj(p.media);
  if (media === undefined) return `${out}, audio missing`;
  return text(media.path) === undefined ? `${out}, not stored` : out;
}

function highlight(p: Payload): string {
  const book = text(p.title) ?? text(p.asset_id);
  if (p.type === "bookmark") {
    const where = text(p.location);
    return `bookmark — ${book ?? ""}${where === undefined ? "" : ` @ ${where}`}`;
  }
  let out = `“${text(p.quote) ?? ""}”`;
  if (book !== undefined) out += ` — ${book}`;
  const note = text(p.note);
  if (note !== undefined) out += ` · ${note}`;
  return out;
}

function trip(p: Payload): string {
  const place = (value: JsonValue | undefined): string => {
    const o = obj(value);
    return text(o?.name) ?? text(o?.address) ?? text(o?.code) ?? "";
  };
  const from = place(p.from);
  const to = place(p.to);
  const parts: string[] = [];
  const places = to === "" ? from : `${from} → ${to}`;
  if (places !== "") parts.push(places);
  const mode = text(p.mode);
  if (mode !== undefined) parts.push(mode);
  const provider = text(p.provider);
  if (provider !== undefined) parts.push(provider);
  const price = obj(p.price);
  if (price !== undefined && price.amount !== undefined) {
    parts.push(`${pyStr(price.amount)} ${text(price.currency) ?? ""}`.trim());
  }
  if (p.status === "cancelled") parts.push("cancelled");
  const extra = obj(p.extra);
  const transfers = num(extra?.transfers);
  if (transfers !== undefined && transfers > 0) parts.push(plural(transfers, "change"));
  if (extra?.observed === "ticket") parts.push("ticket");
  return parts.join(", ");
}

function crossing(p: Payload): string {
  const counts = obj(p.counts);
  const crossed = num(counts?.crossed) ?? 0;
  let out = `crossed to ${text(p.destination) ?? ""}: ${plural(crossed, "line")}`;
  const byTier = obj(counts?.by_tier);
  const tiers =
    byTier === undefined
      ? []
      : Object.entries(byTier).filter(([, n]) => num(n) !== undefined && (n as number) > 0);
  if (tiers.length) out += ` (${tiers.map(([tier, n]) => `tier ${tier}: ${pyStr(n)}`).join(", ")})`;
  return out;
}

/** `text`, else `title`, else (a page) `url`, else every field but `schema` as `key=value`. */
function fallback(kind: string, p: Payload): string {
  const own = text(p.text) ?? text(p.title) ?? (kind === "browse" ? text(p.url) : undefined);
  if (own !== undefined) return own;
  return Object.keys(p)
    .filter((k) => k !== "schema")
    .sort()
    .map((k) => `${k}=${pyStr(p[k])}`)
    .join(", ");
}
