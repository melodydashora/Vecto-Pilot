// server/lib/location/airports.js
//
// Airport identity adapter (todo #22, 2026-07-06) — the ONLY way to answer
// "which airports are near these coords". Deterministic: GPS coords →
// haversine over the airports table (seeded exclusively from Google Places
// by scripts/seed-airports.mjs). Replaces the hardcoded 20-airport list in
// faa-asws.js AND the model-discovers-airports briefing prompt — the two
// sources of the "1 vs 3 airports" nondeterminism.
//
// ONE radius for the whole app (Melody, 2026-07-06): 50 miles. The old code
// used 25 in the snapshot path and 50 in the briefing prompt; from Frisco,
// 25 miles misses Dallas Love Field.

import { db } from '../../db/drizzle.js';
import { airports } from '../../../shared/schema.js';
import { haversineDistanceMiles } from './geo.js';
import { normalizeCoordinates } from '../../../shared/coordinates.js';

export const AIRPORT_RADIUS_MILES = 50;

/**
 * Find major airports within radius of GPS coords, nearest first.
 * Deterministic: same coords → same airports, every time.
 *
 * @param {number} lat - GPS latitude at supplied precision (required, finite)
 * @param {number} lng - GPS longitude at supplied precision (required, finite)
 * @param {{ radiusMiles?: number, limit?: number }} [opts]
 * @returns {Promise<Array<{ iata: string, name: string, city: string|null,
 *   country: string, lat: number, lng: number, distance_miles: number,
 *   terminals: Array|null, terminals_provenance: string|null }>>}
 * @throws {Error} on missing/non-finite coords (no fallbacks — airport
 *   selection without real GPS coords would be a guess)
 */
export async function findNearbyAirports(lat, lng, { radiusMiles = AIRPORT_RADIUS_MILES, limit = 5 } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !normalizeCoordinates(lat, lng)) {
    throw new Error(`findNearbyAirports: finite GPS coords required (got ${lat}, ${lng}) — no fallbacks`);
  }

  if (!Number.isFinite(radiusMiles) || radiusMiles < 0 || !Number.isInteger(limit) || limit < 1) {
    throw new Error('findNearbyAirports: invalid radius or limit');
  }
  const rows = await db.select().from(airports);

  return rows
    .filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lng) && normalizeCoordinates(a.lat, a.lng))
    .map((a) => ({
      iata: a.iata,
      name: a.name,
      city: a.city,
      country: a.country,
      lat: a.lat,
      lng: a.lng,
      distance_miles: haversineDistanceMiles(lat, lng, a.lat, a.lng),
      terminals: a.terminals ?? null,
      terminals_provenance: a.terminals_provenance ?? null,
    }))
    .filter((a) => a.distance_miles <= radiusMiles)
    .sort((a, b) => a.distance_miles - b.distance_miles)
    .slice(0, limit)
    .map(a => ({ ...a, distance_miles: Number(a.distance_miles.toFixed(1)) }));
}
