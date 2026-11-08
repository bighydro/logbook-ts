import { localMidnight, localOf } from "./clock.js";
import { payloadOf } from "./render.js";
import type { Line } from "./types.js";

/** A calendar entry as a reader holds it: the `event/v1` line and its start in ms. */
export interface CalendarLine {
  line: Line;
  ms: number;
}

/** One calendar entry that one or more calendars carry: the lead, then the rest in the day's order. */
export interface CalendarGroup<T extends CalendarLine> {
  lead: T;
  members: T[];
  /** The distinct sources, in the order of `members`. */
  sources: string[];
}

/** An airline designator in a calendar title: `LX 561`, `XY561`. */
const DESIGNATOR = /\b([A-Z]{2})\s?(\d{1,4})\b/;

/** Whether a calendar flags the entry all-day. */
export const isFlagged = (e: CalendarLine): boolean => payloadOf(e.line).all_day === true;

const endOf = (e: CalendarLine): string => (typeof e.line.end === "string" ? e.line.end : "");

function titleKeys(e: CalendarLine): { title: string; flight: string | undefined } {
  const raw = payloadOf(e.line).title;
  const title = typeof raw === "string" ? raw : "";
  const m = DESIGNATOR.exec(title);
  return {
    title: title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " "),
    flight: m ? `${m[1]}${m[2]}` : undefined,
  };
}

/** Whether `other` is the entry `lead` is: one start, one title or flight, and one end unless a copy is flagged. */
function sameEntry(lead: CalendarLine, other: CalendarLine): boolean {
  if (other.ms !== lead.ms) return false;
  if (endOf(other) !== endOf(lead) && !isFlagged(lead) && !isFlagged(other)) return false;
  const a = titleKeys(lead);
  const b = titleKeys(other);
  return a.title === b.title || (a.flight !== undefined && a.flight === b.flight);
}

/**
 * One calendar entry that several calendars carry is one entry, as the reference's Day and `show`
 * read it at v1.1.0 (SPEC-QUESTIONS 28, 137, 138): lines with one start and one title (case, accents and
 * whitespace aside) or naming one flight, and one end unless a copy is flagged all-day, from two or
 * more sources. A timed copy leads, the first of them in the day's order, else the first flagged copy;
 * the members are the lead and then the rest in the day's order; the groups stand where their leads
 * do. One calendar holding an entry twice is still two entries. `entries` are the day's standing
 * `event/v1` lines in the order read (by instant, then seq).
 */
export function foldCalendar<T extends CalendarLine>(entries: T[]): CalendarGroup<T>[] {
  const index = new Map<T, number>(entries.map((e, i) => [e, i]));
  const leads = [...entries.filter((e) => !isFlagged(e)), ...entries.filter(isFlagged)];
  const taken = new Set<T>();
  const groups: CalendarGroup<T>[] = [];
  for (const lead of leads) {
    if (taken.has(lead)) continue;
    const members = [
      lead,
      ...entries.filter((e) => e !== lead && !taken.has(e) && sameEntry(lead, e)),
    ];
    const sources = [...new Set(members.map((m) => String(m.line.source)))];
    const group = sources.length >= 2 ? members : [lead];
    for (const m of group) taken.add(m);
    groups.push({
      lead,
      members: group,
      sources: sources.length >= 2 ? sources : [sources[0] as string],
    });
  }
  return groups.sort((a, b) => (index.get(a.lead) as number) - (index.get(b.lead) as number));
}

/** Whether the line runs from a local midnight to a later one, in the record's zone. */
export function isWholeDays(e: CalendarLine, timezone: string): boolean {
  const end = endOf(e);
  if (end === "") return false;
  const endMs = Date.parse(end);
  if (Number.isNaN(endMs) || endMs <= e.ms) return false;
  const atMidnight = (ms: number) => localMidnight(localOf(ms, timezone).day, timezone) === ms;
  return atMidnight(e.ms) && atMidnight(endMs);
}

/**
 * Whether a folded entry is all-day (the reference's #436) (SPEC-QUESTIONS 136): a calendar flags a copy of it, or it runs
 * from a local midnight to a later one. It is then on the Day's `all day` row, never in the timeline,
 * and no stay holds it.
 */
export function isAllDay<T extends CalendarLine>(
  group: CalendarGroup<T>,
  timezone: string,
): boolean {
  return group.members.some(isFlagged) || isWholeDays(group.lead, timezone);
}
