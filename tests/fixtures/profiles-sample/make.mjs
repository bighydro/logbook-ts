// Regenerates this fixture from the list below. Run after `pnpm build`:
//   node tests/fixtures/profiles-sample/make.mjs
// One line of every payload profile the RFCs define as of openlogbook main (2026-10-01, dae84b0), in the
// shapes the RFC examples give, so that `show` can be checked against the reference implementation
// on the same record (tests/cross-impl.test.ts). Everything is synthetic: a person in Oslo who does
// not exist, example.org addresses, airline XY, reserved phone ranges, MMSI 999000001.
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, hashLine } from "../../../dist/index.js";

const root = dirname(fileURLToPath(import.meta.url));
const TZ = "Europe/Oslo";
const RECORDED = "2026-03-10T18:00:00Z";
const ZERO = "0".repeat(64);
const id = (n) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;
const person = (n) => `019c0000-0000-7000-8000-00000000001${n}`;

const STORED = Buffer.from("a voice memo that is in the store\n", "utf-8");
const STORED_SHA = createHash("sha256").update(STORED).digest("hex");
const LOST_SHA = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const media = (sha, bytes, media_type, stored = true) =>
  stored ? { sha256: sha, path: `attachments/${sha}`, bytes, media_type } : { sha256: sha, bytes, media_type };

const line = (at, end, source, kind, tier, payload) => ({ at, end, source, kind, tier, payload });
const point = (at, source, lat, lon, subject) =>
  line(at, null, source, "location", 1, { schema: "location/v1", lat, lon, accuracy_m: 12, ...(subject ? { subject } : {}) });

const ola = { kind: "email", value: "ola@example.org" };
const olaPhone = { kind: "phone", value: "+4790000001" };
const ines = { kind: "email", value: "ines@example.org" };

const lines = [
  // --- 2026-03-02: flights, calls, a transcript, mail, voice memos, highlights ---------------------
  line("2026-03-02T05:12:00Z", "2026-03-02T06:21:00Z", "manual", "flight", 1, {
    schema: "flight/v1", raw_id: "2026-03-02:XY:561@3f9a1c2b7e4d", date: "2026-03-02", carrier: "XY", number: "561",
    from: { iata: "OSL" }, to: { iata: "ZRH" }, actual_departure: "2026-03-02T05:12:00Z", actual_arrival: "2026-03-02T06:21:00Z",
    role: "pilot", evidence: "declared", observations: [{ evidence: "declared", source: "manual" }],
  }),
  line("2026-03-02T05:10:00Z", "2026-03-02T06:24:00Z", "flighty", "flight", 1, {
    schema: "flight/v1", raw_id: "fx-0001@8c1d0e5a9b2f", date: "2026-03-02", carrier: "XY", number: "561",
    from: { iata: "OSL", icao: "ENGM" }, to: { iata: "ZRH", icao: "LSZH" },
    scheduled_departure: "2026-03-02T05:05:00Z", actual_departure: "2026-03-02T05:10:00Z",
    scheduled_arrival: "2026-03-02T06:20:00Z", actual_arrival: "2026-03-02T06:24:00Z",
    aircraft: { type: "Airbus A320", registration: "LN-XYA" }, role: "pilot", evidence: "tracked",
    observations: [{ evidence: "declared", source: "manual", line: id(1) }, { evidence: "tracked", source: "flighty" }],
    supersedes: id(1), extra: { seat: "1A", cabin: "economy" },
  }),
  line("2026-03-02T16:00:00Z", "2026-03-02T17:10:00Z", "flighty", "flight", 1, {
    schema: "flight/v1", raw_id: "fx-0002@1111", date: "2026-03-02", carrier: "XY", number: "562",
    from: { iata: "ZRH" }, to: { iata: "OSL" }, scheduled_departure: "2026-03-02T16:00:00Z", scheduled_arrival: "2026-03-02T17:10:00Z",
    role: "passenger", cancelled: true, evidence: "tracked", observations: [{ evidence: "tracked", source: "flighty" }],
  }),
  line("2026-03-02T08:04:10Z", "2026-03-02T08:11:35Z", "ios-calls", "call", 1, {
    schema: "call/v1", raw_id: "3B1F8E2A-0000-4000-8000-000000000001", direction: "incoming", answered: true,
    duration_s: 445, counterparty: olaPhone, service: "cellular",
  }),
  line("2026-03-02T08:30:00Z", null, "ios-calls", "call", 1, {
    schema: "call/v1", raw_id: "3B1F8E2A-0000-4000-8000-000000000002", direction: "outgoing", answered: false,
    duration_s: 0, counterparty: { kind: "phone", value: "+4790000002" }, service: "facetime-audio",
  }),
  line("2026-03-02T08:40:00Z", "2026-03-02T08:40:30Z", "ios-calls", "call", 1, {
    schema: "call/v1", raw_id: "3B1F8E2A-0000-4000-8000-000000000003", direction: "outgoing", answered: true,
    duration_s: 30, service: "whatsapp",
  }),
  line("2026-03-02T09:00:00Z", "2026-03-02T09:35:00Z", "granola", "transcript", 2, {
    schema: "transcript/v1", provider: "granola", raw_id: "note_7f3a2b", title: "Catch-up with Ines",
    participants: [{ name: "Ines", email: "ines@example.org" }, { name: "Ola Nordmann" }],
    summary: "Ines is moving to Tromsø in May.", language: "en",
    content: media(STORED_SHA, STORED.length, "text/markdown"), source_uri: "https://granola.example/notes/7f3a2b",
  }),
  line("2026-03-02T10:15:00Z", null, "mail", "mail", 2, {
    schema: "mail/v1", raw_id: "kari.nordmann@example.org:a1b2c3@mail.example.org", message_id: "a1b2c3@mail.example.org",
    thread: "9f8e7d@mail.example.org", from: { email: "ola@example.org", name: "Ola Nordmann" },
    to: [{ email: "kari.nordmann@example.org", name: "Kari Nordmann" }], subject: "Re: Mooring for the weekend",
    date: "2026-03-02T11:15:00+01:00", direction: "received", labels: ["Inbox", "Important"],
    body: "Photos attached. The east berth is free from Friday.\n", size: 48213, account: "kari.nordmann@example.org",
    attachments: [{ filename: "berth.jpg", media_type: "image/jpeg", sha256: LOST_SHA, bytes: 41002 }],
  }),
  line("2026-03-02T10:40:00Z", null, "mail", "mail", 2, {
    schema: "mail/v1", raw_id: "kari.nordmann@example.org:d4e5f6@mail.example.org", message_id: "d4e5f6@mail.example.org",
    thread: "9f8e7d@mail.example.org", from: { email: "kari.nordmann@example.org", name: "Kari Nordmann" },
    to: [{ email: "ola@example.org", name: "Ola Nordmann" }, { email: "ines@example.org" }], cc: [{ email: "per@example.org", name: "Per" }],
    subject: "Re: Mooring for the weekend", date: "2026-03-02T11:40:00+01:00", direction: "sent",
    body: "Friday it is.\n", size: 2048, account: "kari.nordmann@example.org",
  }),
  line("2026-03-02T11:00:00Z", null, "mail", "mail", 2, {
    schema: "mail/v1", raw_id: "sha256:0000", thread: "sha256:0000", direction: "received", size: 512,
  }),
  line("2026-03-02T20:14:07Z", "2026-03-02T20:15:49Z", "voice-memos", "voice-memo", 2, {
    schema: "voice-memo/v1", raw_id: "7A1B2C3D-0000-4000-8000-000000000001", title: "Idea for the talk", duration_s: 102.4,
    file_name: "20260302 211407.m4a", media: media(STORED_SHA, STORED.length, "audio/mp4"),
  }),
  line("2026-03-02T20:20:00Z", "2026-03-02T20:20:05Z", "voice-memos", "voice-memo", 2, {
    schema: "voice-memo/v1", raw_id: "7A1B2C3D-0000-4000-8000-000000000002", title: "Marina", duration_s: 5,
    file_name: "20260302 212000.m4a", media: media(LOST_SHA, 1638400, "audio/mp4", false),
  }),
  line("2026-03-02T20:25:00Z", "2026-03-02T20:26:00Z", "voice-memos", "voice-memo", 2, {
    schema: "voice-memo/v1", raw_id: "7A1B2C3D-0000-4000-8000-000000000003", title: "Evicted", duration_s: 60,
    file_name: "20260302 212500.m4a", media: media(LOST_SHA, 1638400, "audio/mp4"),
  }),
  line("2026-03-02T20:30:00Z", null, "voice-memos", "voice-memo", 2, {
    schema: "voice-memo/v1", raw_id: "7A1B2C3D-0000-4000-8000-000000000004", title: "No file", file_name: "x.m4a",
  }),
  line("2026-03-02T21:14:07Z", null, "apple-books", "highlight", 2, {
    schema: "highlight/v1", raw_id: "6F1A2B3C-0000-4000-8000-000000000001", type: "highlight", title: "The Long Ships",
    author: "Frans G. Bengtsson", asset_id: "A1B2C3D4E5F60718293A4B5C6D7E8F90",
    quote: "They sailed west until the coast was a line and then was nothing.", note: "the moment the book turns",
    location: "epubcfi(/6/14!/4/2/8,/1:0,/1:66)", extra: { style: 3, underline: false },
  }),
  line("2026-03-02T21:20:00Z", null, "apple-books", "highlight", 2, {
    schema: "highlight/v1", raw_id: "6F1A2B3C-0000-4000-8000-000000000002", type: "highlight", title: "The Long Ships",
    quote: "Orm said nothing.", location: "epubcfi(/6/16!/4/2/2,/1:0,/1:17)",
  }),
  line("2026-03-02T21:25:00Z", null, "apple-books", "highlight", 2, {
    schema: "highlight/v1", raw_id: "6F1A2B3C-0000-4000-8000-000000000003", type: "bookmark", title: "The Long Ships",
    location: "epubcfi(/6/20!/4/2)", page: 212,
  }),
  line("2026-03-02T21:30:00Z", null, "apple-books", "highlight", 2, {
    schema: "highlight/v1", raw_id: "6F1A2B3C-0000-4000-8000-000000000004", type: "highlight",
    asset_id: "FFFF", quote: "A sample without a title.",
  }),

  // --- 2026-03-03: tasks, browsing, watching, listening, trips, transactions, health ---------------
  line("2026-03-03T12:10:00Z", null, "google-takeout", "task", 2, {
    schema: "task/v1", raw_id: "aGVsbG8tcm9wZQ@2026-03-03T12:10:00Z", title: "Buy the long rope", status: "done",
    due: "2026-03-05", completed_at: "2026-03-03T12:10:00Z", list: "My Tasks",
    notes: "30 m, 12 mm. Ask at the chandlery on Storgata 1.", modified_at: "2026-03-03T12:10:00Z",
  }),
  line("2026-03-03T12:12:00Z", null, "apple-reminders", "task", 2, {
    schema: "task/v1", raw_id: "reminders:0001@2026-03-03T12:12:00Z", title: "Call the surveyor", status: "open",
    due: "2026-03-06T09:00:00Z", list: "Boat", priority: "high", tags: ["boat"],
  }),
  line("2026-03-03T12:14:00Z", null, "apple-reminders", "task", 2, {
    schema: "task/v1", raw_id: "reminders:0002@2026-03-03T12:14:00Z", title: "Old idea", status: "cancelled",
  }),
  line("2026-03-03T08:00:00Z", null, "google-takeout", "browse", 2, {
    schema: "browse/v1", raw_id: "chrome:1772524800000000:1a6ee1a9f1c5be3e", url: "https://vans.example.org/booking/42",
    title: "Van hire - Oslo", action: "visit", browser: "chrome", transition: "typed",
  }),
  line("2026-03-03T08:05:00Z", null, "google-takeout", "browse", 2, {
    schema: "browse/v1", raw_id: "chrome-bookmark:1772525100:2b7ff2b0a2d6cf4f", url: "https://knots.example.org/bowline",
    title: "The bowline", action: "bookmark", browser: "chrome", folder: "Bookmarks bar/Boat",
  }),
  line("2026-03-03T08:10:00Z", null, "pocket", "browse", 2, {
    schema: "browse/v1", raw_id: "pocket:1772525400:3c80a3c1b3e7d050", url: "https://longreads.example.org/fjords?utm=1",
    action: "save", browser: "pocket", tags: ["sailing", "norway"], status: "unread",
  }),
  line("2026-03-03T08:15:00Z", null, "safari", "browse", 2, {
    schema: "browse/v1", raw_id: "safari:1772525700:4d91b4d2c4f8e161", url: "https://example.org/", action: "visit", browser: "safari",
  }),
  line("2026-03-03T09:00:00Z", null, "google-takeout", "watch", 2, {
    schema: "watch/v1", raw_id: "youtube:2026-03-03T09:00:00.123Z:5e2a4f0c9d1b7a3e", action: "watched",
    title: "Splicing a three-strand rope", url: "https://www.youtube.com/watch?v=aB3dE5fG7hI", video_id: "aB3dE5fG7hI",
    channel: { name: "Knots by Ola", url: "https://www.youtube.com/channel/UCa1b2c3d4e5f6g7h8i9j0k1l" }, service: "youtube",
  }),
  line("2026-03-03T09:05:00Z", null, "google-takeout", "watch", 2, {
    schema: "watch/v1", raw_id: "youtube:2026-03-03T09:05:00.000Z:6f3b5a1d0e2c8b4f", action: "searched",
    title: "eye splice", url: "https://www.youtube.com/results?search_query=eye+splice", service: "youtube",
  }),
  line("2026-03-03T09:10:00Z", null, "google-takeout", "watch", 2, {
    schema: "watch/v1", raw_id: "youtube-music:2026-03-03T09:10:00.000Z:7a4c6b2e1f3d9c50", action: "watched",
    title: "Fjordsang", channel: { name: "Kari Nordmann - Topic" }, service: "youtube-music",
  }),
  line("2026-03-03T20:15:30Z", null, "shazam", "listen", 2, {
    schema: "listen/v1", raw_id: "shazam:100000001:2026-03-03 21:15:30", media: "track", title: "Fjordsang",
    artist: "Kari Nordmann", url: "https://www.shazam.com/track/100000001/fjordsang", service: "shazam",
  }),
  line("2026-03-03T20:30:00Z", null, "apple-podcasts", "listen", 2, {
    schema: "listen/v1", raw_id: "apple-podcasts:EP-0001@2026-03-03T20:30:00Z", media: "episode", title: "Episode 12: The North Cape",
    show: "Sailing North", publisher: "Nordlys Media", duration_s: 2700, played_s: 1800, published: "2026-03-01T06:00:00Z",
    service: "apple-podcasts", extra: { play_count: 1 },
  }),
  line("2026-03-03T20:45:00Z", null, "shazam", "listen", 2, {
    schema: "listen/v1", raw_id: "shazam:100000002:2026-03-03 21:45:00", media: "track", title: "Untitled", service: "shazam",
  }),
  line("2026-03-03T14:05:08Z", null, "easypark", "trip", 1, {
    schema: "trip/v1", raw_id: "easypark:114681@2026-03-03T14:05:08Z", mode: "parking", provider: "easypark",
    from: { name: "Storgata 1-36", code: "8291", operator: "Oslo kommune", latitude: 59.9139, longitude: 10.7522 },
    extra: { area_type: "OnStreet", observed: "last_used" },
  }),
  line("2026-03-03T15:00:00Z", "2026-03-03T15:25:00Z", "uber", "trip", 3, {
    schema: "trip/v1", raw_id: "uber:ride-0001", mode: "ride", provider: "uber",
    from: { name: "Oslo S", address: "Jernbanetorget 1" }, to: { name: "Aker Brygge" }, distance_m: 2300,
    price: { amount: "189.00", currency: "NOK" }, extra: { product: "UberX" },
  }),
  line("2026-03-03T16:00:00Z", "2026-03-03T18:30:00Z", "sbb", "trip", 3, {
    schema: "trip/v1", raw_id: "trip:0001", mode: "transit", provider: "sbb",
    from: { name: "Zürich HB" }, to: { name: "Bern" }, price: { amount: "58.00", currency: "CHF" },
    extra: { observed: "journey", transfers: 1, legs: [{ mode: "train", line: "IC 8" }, { mode: "train", line: "S 1" }] },
  }),
  line("2026-03-03T16:30:00Z", "2026-03-03T16:45:00Z", "uber", "trip", 1, {
    schema: "trip/v1", raw_id: "uber:ride-0002", mode: "ride", provider: "uber", from: { address: "Storgata 1" }, status: "cancelled",
  }),
  line("2026-03-02T23:00:00Z", null, "copilot", "transaction", 3, {
    schema: "transaction/v1", raw_id: "6f1c2a9e-0000-4000-8000-000000000001", amount: -42.5, currency: "USD",
    merchant: "Harbour Cafe", category: "restaurants", date: "2026-03-03", account: "acct_0000000000000001",
    provider: "copilot", status: "posted", extra: { type: "regular", recurring: false, original_name: "HARBOUR CAFE OSLO" },
  }),
  line("2026-03-03T18:30:00Z", null, "splitwise", "transaction", 3, {
    schema: "transaction/v1", raw_id: "1000000001", amount: -30, currency: "NOK", merchant: "Dinner at the marina",
    category: "Dining out", account: "Sailing trip", provider: "splitwise",
    extra: { cost: 90, paid_share: 90, owed_share: 30, payment: false, members: [
      { ref: { kind: "email", value: "kari.nordmann@example.org" }, name: "Kari Nordmann", paid: 90, owed: 30 },
      { ref: ola, name: "Ola Nordmann", paid: 0, owed: 30 }, { ref: { kind: "provider_id", value: "3" }, name: "Per", paid: 0, owed: 30 } ] },
  }),
  line("2026-03-03T19:00:00Z", null, "copilot", "transaction", 3, {
    schema: "transaction/v1", raw_id: "6f1c2a9e-0000-4000-8000-000000000002", amount: 1200, currency: "NOK",
    merchant: "Refund", provider: "copilot", status: "pending", note: "the deposit",
  }),
  line("2026-03-03T07:00:00Z", "2026-03-03T07:15:00Z", "apple-health", "health", 3, {
    schema: "health-sample/v1", raw_id: "steps:2026-03-03T07:00:00Z:Watch7,1", type: "steps", value: 250, unit: "count",
    device: "Watch7,1", source_name: "Apple Watch", extra: { samples: 3 },
  }),
  line("2026-03-02T23:30:00Z", "2026-03-03T00:30:00Z", "apple-health", "health", 3, {
    schema: "health-sample/v1", raw_id: "sleep:1042", type: "sleep", value: 3600, unit: "s", stage: "deep", device: "Watch7,1",
  }),
  line("2026-03-03T07:20:00Z", null, "apple-health", "health", 3, {
    schema: "health-sample/v1", raw_id: "heart_rate:2001", type: "heart_rate", value: 62, unit: "bpm", device: "Watch7,1",
  }),
  line("2026-03-03T07:25:00Z", null, "withings", "health", 3, {
    schema: "health-sample/v1", raw_id: "weight:3001", type: "weight", value: 78.4, unit: "kg", device: "Body+",
  }),
  line("2026-03-03T17:00:00Z", "2026-03-03T17:45:00Z", "apple-health", "health", 3, {
    schema: "health-sample/v1", raw_id: "workout:4001", type: "workout", value: 2700, unit: "s", device: "Watch7,1",
    extra: { activity: "Running", distance_m: 7200, energy_kcal: 480 },
  }),
  line("2026-03-03T11:30:00Z", null, "myfitnesspal", "health", 3, {
    schema: "health-sample/v1", raw_id: "energy_intake:5001", type: "energy_intake", value: 650, unit: "kcal",
    extra: { meal: "Lunch", food: "Fish soup" },
  }),
  line("2026-03-03T07:26:00Z", null, "withings", "health", 3, {
    schema: "health-sample/v1", raw_id: "blood_pressure:6001", type: "blood_pressure", value: 120, unit: "mmHg",
  }),

  // --- 2026-03-04: location with subject, events, commitments, a crossing, a photo, messages -------
  point("2026-03-04T07:30:00Z", "dawarich", 59.911, 10.75),
  point("2026-03-04T07:35:00Z", "dawarich", 59.912, 10.748),
  point("2026-03-04T07:40:00Z", "ais", 59.905, 10.735, "solvind"),
  point("2026-03-04T07:45:00Z", "ais", 59.904, 10.734, "solvind"),
  point("2026-03-04T07:50:00Z", "dawarich", 59.913, 10.742),
  point("2026-03-04T07:55:00Z", "adsb", 59.95, 10.6, "ln-xya"),
  line("2026-03-04T08:30:00Z", "2026-03-04T09:15:00Z", "ios-calendar", "event", 1, {
    schema: "event/v1", raw_id: "7E0C2D4A-0000-4000-8000-000000000001@2026-02-27T16:05:00Z", title: "Boat survey — Tromsø marina",
    calendar: { id: "A1B2", name: "Personal" }, all_day: false, location: "Tromsø småbåthavn", organizer: ola,
    attendees: [{ ref: ola, name: "Ola Nordmann", response: "accepted" }, { ref: ines, name: "Ines", response: "tentative" }],
    status: "confirmed", notes: "Bring the survey form.",
  }),
  line("2026-03-04T08:30:00Z", "2026-03-04T09:15:00Z", "ics", "event", 1, {
    schema: "event/v1", raw_id: "survey@2026-02-27T16:05:00Z", title: "Boat survey — Tromsø Marina", all_day: false,
  }),
  line("2026-03-04T08:30:00Z", "2026-03-04T09:20:00Z", "gcal", "event", 1, {
    schema: "event/v1", raw_id: "survey@gcal", title: "Boat survey — Tromsø marina", all_day: false,
  }),
  line("2026-03-03T23:00:00Z", "2026-03-04T23:00:00Z", "ios-calendar", "event", 1, {
    schema: "event/v1", raw_id: "allday@2026-02-27T16:05:00Z", title: "Boat show", all_day: true, location: "Lillestrøm",
  }),
  line("2026-03-04T12:00:00Z", "2026-03-04T13:00:00Z", "ios-calendar", "event", 1, {
    schema: "event/v1", raw_id: "cancelled@2026-02-27T16:05:00Z", title: "Dentist", all_day: false, status: "cancelled",
  }),
  line("2026-03-04T14:00:00Z", "2026-03-04T14:30:00Z", "ios-calendar", "event", 1, {
    schema: "event/v1", raw_id: "edited@2026-03-01T10:00:00Z", title: "Call with the broker", all_day: false,
  }),
  line("2026-03-04T14:00:00Z", "2026-03-04T15:00:00Z", "ios-calendar", "event", 1, {
    schema: "event/v1", raw_id: "edited@2026-03-02T10:00:00Z", title: "Call with the broker (moved)", all_day: false, supersedes: id(59),
  }),
  line("2026-03-04T10:00:00Z", null, "immich", "photo", 1, {
    schema: "photo/v1", asset_id: "5d3e0000", library: "immich", file_name: "IMG_0001.HEIC", media: "image",
    lat: 59.913, lon: 10.742, camera: "SimPhone 3", width: 4032, height: 3024, live_photo: true, provenance: "camera",
    faces: 2, people: ["p_17", "p_42"], albums: ["Boat"],
  }),
  line("2026-03-04T10:00:01Z", null, "apple-photos", "photo", 1, {
    schema: "photo/v1", asset_id: "7B0C-0000", library: "apple-photos", file_name: "img_0001.heic", media: "image", favorite: true,
  }),
  line("2026-03-04T10:30:00Z", null, "apple-photos", "photo", 1, {
    schema: "photo/v1", asset_id: "7B0C-0001", library: "apple-photos", file_name: "IMG_0002.MOV", media: "video", duration_s: 12.5,
    provenance: "camera",
  }),
  line("2026-03-04T11:00:00Z", null, "whatsapp", "message", 2, {
    schema: "message/v1", raw_id: "3EB0A1F5C2D4E6B7", chat: { id: "4790000001@s.whatsapp.net", type: "direct", name: "Ola" },
    from_me: false, sender: olaPhone, media_kind: "image", media: media(LOST_SHA, 20000, "image/jpeg"),
  }),
  line("2026-03-04T11:01:00Z", null, "whatsapp", "message", 2, {
    schema: "message/v1", raw_id: "3EB0A1F5C2D4E6B8", chat: { id: "120363000000000001@g.us", type: "group" },
    from_me: false, sender: { kind: "handle", value: "236000000000009@lid", name: "Per" }, text: "ok", extra: { deleted: true },
  }),
  line("2026-03-04T11:02:00Z", null, "imessage", "message", 2, {
    schema: "message/v1", raw_id: "guid-1", chat: { id: "iMessage;-;+4790000002", type: "direct" }, from_me: true, text: "see you",
  }),
  line("2026-03-04T19:40:00Z", null, "manual", "commitment", 2, {
    schema: "commitment/v1", text: "send Ola the mooring photos", direction: "owed_by_owner", counterparty: ola,
    due: "2026-03-09T00:00:00Z", certainty: "stated",
  }),
  line("2026-03-04T19:45:00Z", null, "granola", "commitment", 2, {
    schema: "commitment/v1", text: "Ines sends the Tromsø dates", direction: "owed_to_owner", counterparty: { kind: "name", value: "Ines" },
    origin: id(7), certainty: "inferred",
  }),
  line("2026-03-04T20:12:00Z", null, "manual", "commitment-close", 2, {
    schema: "commitment-close/v1", closes: id(64), outcome: "kept", evidence: [id(9)],
  }),
  line("2026-03-04T02:00:00Z", null, "logbook", "crossing", 1, {
    schema: "crossing/v1", destination: "hermes", bundle_id: "019cadd3-6bc0-7dcd-9133-043f5aabf2b0",
    window: { from: "2026-03-03T00:00:00Z", to: "2026-03-04T00:00:00Z" }, tiers: [1, 2],
    counts: { logged: 7, crossed: 6, held_back: 1, by_tier: { 1: 2, 2: 4, 3: 0 }, by_kind: { location: 2, message: 3, note: 1 },
      resolutions: 2, resolutions_held_back: 0, attachments: { included: 1, bytes: 48213, missing: 1 } },
    policy: { file: "policy/crossing.json", max_tier: 2 }, logbook_head: ZERO, package_sha256: LOST_SHA,
  }),
  line("2026-03-04T21:00:00Z", null, "manual", "note", 2, { schema: "note/v1", text: "\n\nDecided: keep the boat one more season.\nSecond line.\nThird." }),
  line("2026-03-04T21:05:00Z", null, "google-takeout", "note", 2, {
    schema: "note/v1", raw_id: "keep:0001@2026-03-04T21:05:00Z", title: "Boat list", text: "[ ] rope\n[x] jib", labels: ["boat"], folder: "Keep",
  }),
  line("2026-03-04T21:10:00Z", null, "sim-sensor", "wind", 1, {
    schema: "wind/v1", speed_mps: 7.5, direction_deg: 240, gust: true, note: "it's blowing", tags: ["a", "b"], nested: { x: null, y: [1, 2.5] },
  }),
  line("2026-03-04T21:15:00Z", null, "manual", "note", 2, { schema: "note/v1", text: "wrong" }),
  line("2026-03-04T22:00:00Z", null, "manual", "retraction", 2, { schema: "retraction/v1", supersedes: id(72), seq: 72, reason: "" }),

  // --- 2026-03-05: the people, named -------------------------------------------------------------
  line("2026-03-05T09:00:00Z", null, "ios-contacts", "resolution", 2, {
    schema: "resolution/v1", ref: ola, entity: { type: "person", id: person(1), registry: "logbook" }, label: "Ola Nordmann", method: "exact",
  }),
  line("2026-03-05T09:00:01Z", null, "ios-contacts", "resolution", 2, {
    schema: "resolution/v1", ref: olaPhone, entity: { type: "person", id: person(1), registry: "logbook" }, label: "Ola Nordmann", method: "exact",
  }),
  line("2026-03-05T09:00:02Z", null, "ios-contacts", "resolution", 2, {
    schema: "resolution/v1", ref: ines, entity: { type: "person", id: person(2), registry: "logbook" }, label: "Ines Holm", method: "exact",
  }),
  line("2026-03-05T09:00:03Z", null, "ios-contacts", "resolution", 2, {
    schema: "resolution/v1", ref: { kind: "phone", value: "+4790000002" }, entity: { type: "person", id: person(3), registry: "logbook" }, label: "Kari Moe", method: "exact",
  }),
];

rmSync(join(root, "logbook"), { recursive: true, force: true });
const files = new Map();
let prev = ZERO;
let seq = 0;
for (const content of lines) {
  seq += 1;
  const row = { id: id(seq), seq, ...content, tz: TZ, recorded_at: RECORDED, prev, hash: "" };
  row.hash = hashLine(row);
  prev = row.hash;
  const rel = join("logbook", row.at.slice(0, 4), `${row.at.slice(5, 7)}.jsonl`);
  files.set(rel, (files.get(rel) ?? "") + `${canonicalize(row)}\n`);
}
for (const [rel, text] of files) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text, "utf-8");
}
mkdirSync(join(root, "attachments"), { recursive: true });
writeFileSync(join(root, "attachments", STORED_SHA), STORED);
mkdirSync(join(root, "notes", "2026"), { recursive: true });
writeFileSync(join(root, "notes", "2026", "2026-03-04.md"), "A long day at the marina.\n\nThe survey went well.\n", "utf-8");
const meta = {
  format: "logbook/0.2",
  owner_id: "00000000-0000-4000-8000-000000000004",
  created_at: "2026-03-01T06:00:00Z",
  timezone: TZ,
  owner_emails: ["kari.nordmann@example.org"],
  seq,
  head: prev,
};
writeFileSync(join(root, "logbook.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
process.stdout.write(`${seq} lines, head ${prev}\n`);
