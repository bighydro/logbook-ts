import { distanceM } from "./geo.js";
import { AIRPORT_ROWS, ZONE_ROWS } from "./tables.js";

/** One row of the airports table: OurAirports' large airports with scheduled service (RFC 0013 rule 5). */
export interface Airport {
  iata: string;
  icao: string;
  name: string;
  lat: number;
  lon: number;
  tz: string;
  /** The municipality as the table spells it: `Oslo (Gardermoen)`, `Sandefjord(Torp)`. */
  municipality: string;
  /** The city alone: the municipality up to its first parenthesis or comma. */
  city: string;
  type: string;
}

let table: Airport[] | undefined;
let zones: Map<string, string> | undefined;

export function airports(): Airport[] {
  if (table === undefined) {
    table = AIRPORT_ROWS.map(([iata, icao, name, lat, lon, tz, municipality, type]) => ({
      iata,
      icao,
      name,
      lat,
      lon,
      tz,
      municipality,
      city: municipality.split(/[(,]/)[0]?.trim() ?? municipality,
      type,
    }));
  }
  return table;
}

/** The code a reader prints for an airport: IATA, else ICAO. */
export const airportCode = (a: Airport): string => a.iata || a.icao;

/** The airport nearest a point within `maxKm`, and how far it is. */
export function nearestAirport(
  lat: number,
  lon: number,
  maxKm: number,
): { airport: Airport; km: number } | undefined {
  let best: { airport: Airport; km: number } | undefined;
  for (const airport of airports()) {
    const km = distanceM(lat, lon, airport.lat, airport.lon) / 1000;
    if (km <= maxKm && (best === undefined || km < best.km)) best = { airport, km };
  }
  return best;
}

/**
 * The airport a stay is at: within 3.5 km of the reference point of an airport with scheduled
 * traffic (OurAirports type large or medium; a terminal lies well off the runway midpoint), within
 * 2 km of any other row.
 */
export function airportAt(lat: number, lon: number): Airport | undefined {
  const near = nearestAirport(lat, lon, 3.5);
  if (near === undefined) return undefined;
  const scheduled = near.airport.type === "large_airport" || near.airport.type === "medium_airport";
  return scheduled || near.km <= 2 ? near.airport : undefined;
}

/** ISO 3166-1 alpha-2 country a zone is filed under in zone.tab; undefined for a zone it does not list. */
export function countryOfZone(tz: string): string | undefined {
  if (zones === undefined) zones = new Map(ZONE_ROWS);
  return zones.get(tz);
}
