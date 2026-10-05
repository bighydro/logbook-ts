import { nearestAirport } from "./airports.js";
import { addDays, localOf, localToMs, monthKey } from "./clock.js";
import { coordinates, distanceM, roundTo } from "./geo.js";
import { eachLine, monthFiles, parseLine } from "./lines.js";
import { type Opened, openWindow, type ReadingStats, type RowUnit, readDays } from "./reading.js";
import { payloadOf } from "./render.js";
import { asRef, type Ref } from "./resolve.js";
import type { Asset, Place } from "./settings.js";
import type { Stay } from "./stays.js";
import type { JsonValue, Line } from "./types.js";

export interface PeopleOptions {
  year?: string;
}

/** The channels a person is heard on, in the order the report lists them. */
export const CHANNELS = ["messages", "calls", "mail", "calendar", "transcripts", "faces"] as const;
export type ChannelName = (typeof CHANNELS)[number];

export interface Channel {
  lines: number;
  first: string;
  last: string;
  tier: number;
  last_line: string;
}

export interface RealContact {
  day: string;
  via: "meeting" | "message" | "call";
  line: string;
}

/** One person the record names and what it knows of them in the window. */
export interface PersonReport {
  id: string;
  name: string;
  refs: Ref[];
  tier: number;
  birthday: string | null;
  first_contact: string;
  last_contact: string;
  last_real_contact: RealContact | null;
  channels: Partial<Record<ChannelName, Channel>>;
  /** Days together: the confirmed company of the with module, by the evidence's own day. */
  days: number;
  /** Nights whose overnight stay the person was confirmed at on that day. */
  nights: number;
  /** Where the days together were, by days there, most first. */
  places: Array<{ where: string; days: number }>;
  /** The ids of the shared days' evidence. */
  lines: string[];
}

/** What `people --json` prints. */
export interface People {
  window: { since: string; until: string } | null;
  /** The highest tier of any evidence the report rests on; null without people. */
  tier: number | null;
  people: PersonReport[];
}

type Obj = { [key: string]: JsonValue };
const obj = (value: JsonValue | undefined): Obj | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
const text = (value: JsonValue | undefined): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** Names a transcript gives a speaker that are nobody: `Speaker A`, `me`, `them`, `Unknown`. */
const NOBODY = /^(speaker\s+\S+|me|them|unknown)$/i;
/** A WhatsApp JID names a direct chat by the phone number. */
const JID = /^(\d+)@s\.whatsapp\.net$/;

interface ChannelCount {
  lines: number;
  first: string;
  last: string;
  tier: number;
  lastLine: Line;
  lastMs: number;
}

interface RealDay {
  /** The earliest confirming evidence line of the day, when there was a day together. */
  meeting?: { ms: number; seq: number; line: string };
  /** The latest message or answered call of the day. */
  latest?: { ms: number; seq: number; line: string; via: "message" | "call" };
}

interface Account {
  id: string;
  channels: Map<ChannelName, ChannelCount>;
  days: Set<string>;
  nights: Set<string>;
  places: Map<string, Set<string>>;
  evidence: Array<{ day: string; ms: number; seq: number; line: string }>;
  evidenceTier: number;
  real: Map<string, RealDay>;
}

/**
 * Everyone the record's resolution lines name as a person, never the owner, and what the record
 * knows of each in the window, as the reference's `logbook people` reads it (docs/people.md): the
 * channels they are heard on — messages they sent and the owner's in a direct chat with them,
 * calls, mail from or to them, calendar entries they attend, transcripts they took part in, faces
 * tagged — the days together of the with module's confirmed set, the nights under one roof, the
 * places shared, the first and last contact and the last real one. The window is the whole record,
 * the first to the last local day with a line of any kind, or one year clipped to it. Nothing is
 * written.
 */
export function readPeople(root: string, options: PeopleOptions, stats?: ReadingStats): People {
  const opened = openWindow(root, options, { coverage: "lines" });
  if (opened.window === null) return { window: null, tier: null, people: [] };
  const { since, until } = opened.window;
  const resolver = opened.judgements.resolver;
  const accounts = new Map<string, Account>();
  const account = (id: string): Account => {
    let found = accounts.get(id);
    if (found === undefined) {
      found = {
        id,
        channels: new Map(),
        days: new Set(),
        nights: new Set(),
        places: new Map(),
        evidence: [],
        evidenceTier: 0,
        real: new Map(),
      };
      accounts.set(id, found);
    }
    return found;
  };
  const isOwner = (id: string, label: string | undefined): boolean =>
    opened.owner.ids.has(id) ||
    (label !== undefined && opened.owner.names.has(label.toLowerCase()));
  /** The person a ref resolves to, never the owner. */
  const personOf = (ref: Ref | undefined): string | undefined => {
    if (ref === undefined) return undefined;
    const entity = resolver.entity(ref);
    if (entity === undefined || entity.type !== "person") return undefined;
    return isOwner(entity.id, entity.label) ? undefined : entity.id;
  };
  const byName = namesIndex(opened);
  /** The one person the record labels by this name, or by its first word. */
  const personByName = (name: string): string | undefined => {
    const exact = byName.labels.get(name.trim().toLowerCase());
    if (exact !== undefined) return exact.size === 1 ? [...exact][0] : undefined;
    const first = byName.firstWords.get(name.trim().split(/\s+/)[0]?.toLowerCase() ?? "");
    return first !== undefined && first.size === 1 ? [...first][0] : undefined;
  };

  const touch = (id: string, channel: ChannelName, line: Line, ms: number, day: string): void => {
    const acc = account(id);
    const current = acc.channels.get(channel);
    if (current === undefined) {
      acc.channels.set(channel, {
        lines: 1,
        first: day,
        last: day,
        tier: line.tier,
        lastLine: line,
        lastMs: ms,
      });
      return;
    }
    current.lines += 1;
    if (day < current.first) current.first = day;
    if (day > current.last) current.last = day;
    current.tier = Math.max(current.tier, line.tier);
    if (ms > current.lastMs || (ms === current.lastMs && line.seq > current.lastLine.seq)) {
      current.lastLine = line;
      current.lastMs = ms;
    }
  };
  const realContact = (
    id: string,
    day: string,
    via: "message" | "call",
    line: Line,
    ms: number,
  ): void => {
    const acc = account(id);
    const real = acc.real.get(day) ?? {};
    if (
      real.latest === undefined ||
      ms > real.latest.ms ||
      (ms === real.latest.ms && line.seq > real.latest.seq)
    )
      real.latest = { ms, seq: line.seq, line: line.id, via };
    acc.real.set(day, real);
  };

  // The channels: the lines of the six kinds standing in the window, one file at a time.
  const startMs = localToMs(since, "00:00", opened.timezone);
  const endMs = localToMs(addDays(until, 1), "00:00", opened.timezone);
  const firstMonth = monthKey(startMs);
  const lastMonth = monthKey(endMs);
  const senders = new Map<string, Set<string>>();
  const ownerMessages: Array<{ chat: string | undefined; line: Line; ms: number; day: string }> =
    [];
  for (const month of monthFiles(root)) {
    const key = `${month.year}-${month.month}`;
    if (key < firstMonth || key > lastMonth) continue;
    for (const { raw, row } of eachLine(month.file)) {
      const parsed = parseLine(raw, `${month.rel} line ${row}`);
      if ("error" in parsed) continue;
      const { line } = parsed;
      if (typeof line.at !== "string") continue;
      const ms = Date.parse(line.at);
      if (Number.isNaN(ms) || ms < startMs || ms >= endMs) continue;
      if (resolver.retractedBy(line.id) !== undefined) continue;
      const p = payloadOf(line);
      const day = localOf(ms, opened.timezone).day;
      switch (line.kind) {
        case "message": {
          if (p.schema !== "message/v1") break;
          const chat = obj(p.chat);
          const direct = typeof p.chat === "string" || chat?.type === "direct";
          const chatId = text(chat?.id);
          if (p.from_me === true) {
            if (direct) ownerMessages.push({ chat: chatId, line, ms, day });
            break;
          }
          const who = personOf(asRef(p.sender));
          if (who === undefined) break;
          touch(who, "messages", line, ms, day);
          realContact(who, day, "message", line, ms);
          if (direct && chatId !== undefined) {
            const set = senders.get(chatId) ?? new Set<string>();
            set.add(who);
            senders.set(chatId, set);
          }
          break;
        }
        case "call": {
          if (p.schema !== "call/v1") break;
          const who = personOf(asRef(p.counterparty));
          if (who === undefined) break;
          touch(who, "calls", line, ms, day);
          if (p.answered === true) realContact(who, day, "call", line, ms);
          break;
        }
        case "mail": {
          if (p.schema !== "mail/v1") break;
          const named = new Set<string>();
          const address = (value: JsonValue | undefined): void => {
            const o = obj(value);
            const ref =
              asRef(value) ??
              (text(o?.email) === undefined
                ? undefined
                : { kind: "email", value: text(o?.email) as string });
            const who = personOf(ref);
            if (who !== undefined) named.add(who);
          };
          address(p.from);
          for (const field of ["to", "cc", "bcc"]) {
            const list = p[field];
            if (Array.isArray(list)) for (const item of list) address(item);
          }
          for (const who of named) touch(who, "mail", line, ms, day);
          break;
        }
        case "event": {
          if (p.schema !== "event/v1" || opened.judgements.superseded.has(line.id)) break;
          if (!Array.isArray(p.attendees)) break;
          const named = new Set<string>();
          for (const item of p.attendees) {
            const o = obj(item);
            if (
              o !== undefined &&
              (o.response === "declined" || o.status === "declined" || o.declined === true)
            )
              continue;
            const email = text(o?.email);
            const ref =
              typeof item === "string"
                ? { kind: "email", value: item }
                : (asRef(o?.ref) ??
                  (email === undefined ? undefined : { kind: "email", value: email }));
            const who = personOf(ref);
            if (who !== undefined) named.add(who);
          }
          for (const who of named) touch(who, "calendar", line, ms, day);
          break;
        }
        case "transcript": {
          if (p.schema !== "transcript/v1" || !Array.isArray(p.participants)) break;
          const named = new Set<string>();
          for (const item of p.participants) {
            const o = obj(item);
            if (o === undefined) continue;
            let who: string | undefined;
            for (const [kind, key] of [
              ["email", "email"],
              ["phone", "phone"],
              ["provider_id", "provider_id"],
            ]) {
              const value = text(o[key as string]);
              if (value === undefined) continue;
              who = personOf({ kind: kind as string, value });
              if (who !== undefined) break;
            }
            const name = text(o.name);
            if (who === undefined && name !== undefined && !NOBODY.test(name.trim())) {
              const found = personByName(name);
              if (found !== undefined && !isOwner(found, byName.label.get(found))) who = found;
            }
            if (who !== undefined) named.add(who);
          }
          for (const who of named) touch(who, "transcripts", line, ms, day);
          break;
        }
        case "photo": {
          if (p.schema !== "photo/v1") break;
          const library = text(p.library);
          if (library === undefined || !Array.isArray(p.people)) break;
          const named = new Set<string>();
          for (const face of p.people) {
            if (typeof face !== "string") continue;
            const who = personOf({ kind: "provider_id", value: `${library}:${face}` });
            if (who !== undefined) named.add(who);
          }
          for (const who of named) touch(who, "faces", line, ms, day);
          break;
        }
        default:
          break;
      }
    }
  }
  // The owner's lines in a direct chat go to the one person who wrote in it; in a chat only the
  // owner wrote in, to the person the chat's id names.
  for (const sent of ownerMessages) {
    if (sent.chat === undefined) continue;
    const wrote = senders.get(sent.chat);
    let who: string | undefined;
    if (wrote !== undefined && wrote.size === 1) who = [...wrote][0];
    else if (wrote === undefined || wrote.size === 0) who = personOf(chatRef(sent.chat));
    if (who === undefined) continue;
    touch(who, "messages", sent.line, sent.ms, sent.day);
    realContact(who, sent.day, "message", sent.line, sent.ms);
  }

  // The days together: the confirmed company of every stay of the window, by the evidence's own day.
  for (const day of readDays(opened, stats)) {
    for (const row of day.rows) {
      for (const unit of row.units) {
        for (const e of unit.evidence) {
          if (!e.confirms || e.person === null || e.entry.day !== day.day) continue;
          if (isOwner(e.person, e.name)) continue;
          const acc = account(e.person);
          acc.days.add(day.day);
          if (day.night !== undefined && day.night.row === row) acc.nights.add(day.day);
          const where = unitLabel(unit, row.asset, opened);
          const at = acc.places.get(where) ?? new Set<string>();
          at.add(day.day);
          acc.places.set(where, at);
          acc.evidence.push({ day: day.day, ms: e.entry.ms, seq: e.entry.line.seq, line: e.line });
          acc.evidenceTier = Math.max(acc.evidenceTier, e.entry.line.tier);
          const real = acc.real.get(day.day) ?? {};
          if (
            real.meeting === undefined ||
            e.entry.ms < real.meeting.ms ||
            (e.entry.ms === real.meeting.ms && e.entry.line.seq < real.meeting.seq)
          )
            real.meeting = { ms: e.entry.ms, seq: e.entry.line.seq, line: e.line };
          acc.real.set(day.day, real);
        }
      }
    }
  }

  const people: PersonReport[] = [];
  for (const acc of accounts.values()) {
    if (acc.channels.size === 0 && acc.days.size === 0) continue;
    const named = resolver.refsOf(acc.id);
    const minted = named.find(
      (r) =>
        asRef(r.line.payload.alias_of) === undefined && text(r.line.payload.label) !== undefined,
    );
    const name = text(minted?.line.payload.label) ?? resolver.people().get(acc.id) ?? acc.id;
    let tier = acc.evidenceTier;
    for (const r of named) tier = Math.max(tier, r.line.tier);
    const channels: Partial<Record<ChannelName, Channel>> = {};
    const firsts: string[] = [...acc.days];
    const lasts: string[] = [...acc.days];
    for (const channel of CHANNELS) {
      const c = acc.channels.get(channel);
      if (c === undefined) continue;
      channels[channel] = {
        lines: c.lines,
        first: c.first,
        last: c.last,
        tier: c.tier,
        last_line: c.lastLine.id,
      };
      tier = Math.max(tier, c.tier);
      firsts.push(c.first);
      lasts.push(c.last);
    }
    firsts.sort();
    lasts.sort();
    const birthdayLine = named.find((r) => text(obj(r.line.payload.extra)?.birthday) !== undefined);
    const evidence = [...acc.evidence].sort(
      (a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) || a.ms - b.ms || a.seq - b.seq,
    );
    const lines: string[] = [];
    for (const e of evidence) if (!lines.includes(e.line)) lines.push(e.line);
    people.push({
      id: acc.id,
      name,
      refs: named.map((r) => r.ref),
      tier,
      birthday: text(obj(birthdayLine?.line.payload.extra)?.birthday) ?? null,
      first_contact: firsts[0] as string,
      last_contact: lasts[lasts.length - 1] as string,
      last_real_contact: lastReal(acc.real),
      channels,
      days: acc.days.size,
      nights: acc.nights.size,
      places: [...acc.places.entries()]
        .map(([where, days]) => ({ where, days: days.size }))
        .sort((a, b) => b.days - a.days || (a.where < b.where ? -1 : a.where > b.where ? 1 : 0)),
      lines,
    });
  }
  people.sort(
    (a, b) =>
      b.days - a.days ||
      (a.last_contact < b.last_contact ? 1 : a.last_contact > b.last_contact ? -1 : 0) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  const tier = people.length ? Math.max(...people.map((p) => p.tier)) : null;
  return { window: { since, until }, tier, people };
}

/** The latest real contact: the latest day with one; on that day a meeting first, else the later of a message and a call. */
function lastReal(real: Map<string, RealDay>): RealContact | null {
  const days = [...real.keys()].sort();
  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i] as string;
    const r = real.get(day) as RealDay;
    if (r.meeting !== undefined) return { day, via: "meeting", line: r.meeting.line };
    if (r.latest !== undefined) return { day, via: r.latest.via, line: r.latest.line };
  }
  return null;
}

/** The ref a direct chat's id names: a WhatsApp JID is the phone number, an address is an email, a `+` number a phone. */
function chatRef(id: string): Ref | undefined {
  const jid = JID.exec(id);
  if (jid !== null) return { kind: "phone", value: `+${jid[1]}` };
  if (id.includes("@")) return { kind: "email", value: id };
  if (id.startsWith("+")) return { kind: "phone", value: id };
  return undefined;
}

/** Where a day together was: the stay's named place, `aboard <asset>` for a run aboard or a stay aboard, else the unnamed label. */
function unitLabel(unit: RowUnit, asset: Asset | undefined, opened: Opened): string {
  if (unit.whole && asset !== undefined) return `aboard ${asset.id}`;
  const stay = unit.stays[0];
  if (stay === undefined) return asset === undefined ? "" : `aboard ${asset.id}`;
  if (stay.place !== undefined) return stay.place.name;
  if (stay.aboard !== undefined) return `aboard ${stay.aboard.id}`;
  return unnamedLabel(stay, opened.places);
}

/** An unnamed place as `people` labels it: the coordinates, `near <place>, x km` for a named place within 5 km, else the city of the nearest large airport within 30 km; never the airport's code, as a trip's route has it. */
function unnamedLabel(stay: Stay, places: Place[]): string {
  const coords = coordinates(stay.lat, stay.lon);
  let nearest: { place: Place; m: number } | undefined;
  for (const place of places) {
    const m = distanceM(stay.lat, stay.lon, place.lat, place.lon);
    if (m <= NEAR_PLACE_KM * 1000 && (nearest === undefined || m < nearest.m))
      nearest = { place, m };
  }
  if (nearest !== undefined)
    return `${coords} near ${nearest.place.name}, ${roundTo(nearest.m / 1000, 1).toFixed(1)} km`;
  const near = nearestAirport(stay.lat, stay.lon, CITY_AIRPORT_KM);
  return near === undefined ? coords : `${coords} (${near.airport.city})`;
}

/** An unnamed stay with a named place within this many km reads as its coordinates near that place. */
const NEAR_PLACE_KM = 5;
/** The city of the nearest large airport within this many km labels an unnamed stay otherwise. */
const CITY_AIRPORT_KM = 30;

/** Every person's label, and the people labelled by each name and by each first word. */
function namesIndex(opened: Opened): {
  label: Map<string, string>;
  labels: Map<string, Set<string>>;
  firstWords: Map<string, Set<string>>;
} {
  const label = opened.judgements.resolver.people();
  const labels = new Map<string, Set<string>>();
  const firstWords = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, id: string): void => {
    const set = map.get(key) ?? new Set<string>();
    set.add(id);
    map.set(key, set);
  };
  for (const [id, name] of label) {
    add(labels, name.trim().toLowerCase(), id);
    add(firstWords, name.trim().split(/\s+/)[0]?.toLowerCase() ?? "", id);
  }
  return { label, labels, firstWords };
}

const DASH = "–";
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
const width = (s: string): number => [...s].length;

/** The text of the report, as the reference prints it: the head, then one row per person. */
export function renderPeople(report: People, options: PeopleOptions = {}): string {
  if (report.window === null)
    return `no people: the record has no days${options.year === undefined ? "" : ` in ${options.year}`}\n`;
  const head = [
    `${report.people.length} people · ${report.window.since} ${DASH} ${report.window.until}`,
  ];
  if (report.tier !== null) head.push(`tier ${report.tier}`);
  const lines = [head.join(" · ")];
  const w = Math.max(0, ...report.people.map((p) => width(p.name)));
  for (const p of report.people) {
    const channels = CHANNELS.filter((c) => p.channels[c] !== undefined)
      .map((c) => `${c} ${(p.channels[c] as Channel).lines}`)
      .join(" · ");
    const parts = [channels];
    if (p.days) parts.push(plural(p.days, "day"));
    if (p.nights) parts.push(plural(p.nights, "night"));
    if (p.last_real_contact !== null)
      parts.push(`last real contact ${p.last_real_contact.day} (${p.last_real_contact.via})`);
    if (p.places.length) parts.push(p.places.map((x) => x.where).join(", "));
    lines.push(`  ${p.name}${" ".repeat(w - width(p.name))}  ${parts.join(" · ")}`);
  }
  return `${lines.join("\n")}\n`;
}
