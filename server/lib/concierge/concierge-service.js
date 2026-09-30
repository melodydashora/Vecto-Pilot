import { withEventVenueLock, mergeIntoOverlappingActiveSpan, resolveEventWriteHash } from '../briefing/cleanup-events.js';
// server/lib/concierge/concierge-service.js
// 2026-02-13: Public concierge service — token management, profile lookup, event search
// 2026-02-13: DB-FIRST ARCHITECTURE — query discovered_events + venue_catalog first,
//             Gemini fallback only for uncatalogued locations, persist new discoveries
//
// This service powers the Concierge QR code feature:
// - Anonymous guests receive a signed bookmark and use their own location.
// - Driver-sharing helper exports remain for historical compatibility only; the
//   public API does not call them and retired driver endpoints return 410.

import crypto from 'crypto';
import { db } from '../../db/drizzle.js';
import { driver_profiles, driver_vehicles, discovered_events, venue_catalog, concierge_feedback } from '../../../shared/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { callModel } from '../ai/adapters/index.js';
import { VALIDATION_SCHEMA_VERSION, validateEvent } from '../events/pipeline/validateEvent.js';
import { haversineDistanceMiles } from '../location/geo.js';
import { findOrCreateVenue } from '../venue/venue-cache.js';
import { searchPlaceWithTextSearch } from '../venue/venue-address-resolver.js';
import { normalizeCoordinates } from '../../../shared/coordinates.js';
import { normalizeEvent } from '../events/pipeline/normalizeEvent.js';
import { generateEventHash } from '../events/pipeline/hashEvent.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const RADIUS_MILES = 10; // Default search radius for concierge
const MIN_DB_RESULTS = 3; // If fewer than this, trigger Gemini fallback

// Both catalog queries use the same coarse bounds. Longitude wraps at the
// dateline; a circle reaching a pole spans every longitude. Haversine below
// still enforces the exact ten-mile radius.
function nearbyCoordinateConditions(lat, lng) {
  const latDelta = RADIUS_MILES / 69;
  const conditions = [sql`${venue_catalog.lat} BETWEEN ${Math.max(-90, lat - latDelta)} AND ${Math.min(90, lat + latDelta)}`];
  if (lat - latDelta <= -90 || lat + latDelta >= 90) return conditions;
  // Spherical longitude extrema; the center-latitude linear approximation
  // under-bounds nearby circles at high latitudes before they reach a pole.
  const lngDelta = Math.asin(Math.sin(latDelta * Math.PI / 180) / Math.cos(lat * Math.PI / 180)) * 180 / Math.PI;
  const west = lng - lngDelta, east = lng + lngDelta;
  if (west < -180) conditions.push(sql`(${venue_catalog.lng} >= ${west + 360} OR ${venue_catalog.lng} <= ${east})`);
  else if (east > 180) conditions.push(sql`(${venue_catalog.lng} >= ${west} OR ${venue_catalog.lng} <= ${east - 360})`);
  else conditions.push(sql`${venue_catalog.lng} BETWEEN ${west} AND ${east}`);
  return conditions;
}

// ============================================================================
// CONCIERGE FILTER DEFINITIONS
// ============================================================================
// Each filter maps to DB query conditions AND a Gemini fallback prompt.
// DB is always tried first; Gemini only fires when DB returns < MIN_DB_RESULTS.

const CONCIERGE_FILTERS = {
  all: {
    label: 'All Events',
    // DB filters: no category restriction
    dbEventCategories: null,
    dbVenueTypes: null,
    // Gemini fallback
    searchTerms: (date) => `events tonight ${date} concerts live music comedy sports bars nightlife`,
    system: 'Find ALL types of events and entertainment happening tonight.',
  },
  bars: {
    label: 'Best Bars',
    dbEventCategories: ['nightlife'],
    dbVenueTypes: ['bar', 'nightclub', 'wine_bar', 'cocktail_bar'],
    searchTerms: (date) => `best bars cocktail lounges rooftop bars speakeasy ${date} happy hour`,
    system: 'Find the best bars, cocktail lounges, and nightlife spots open tonight.',
  },
  live_music: {
    label: 'Live Music',
    dbEventCategories: ['concert', 'festival'],
    dbVenueTypes: ['bar', 'nightclub', 'event_host'],
    searchTerms: (date) => `live music concerts acoustic sets DJ sets ${date} tonight`,
    system: 'Find live music events, concerts, acoustic sets, and DJ performances tonight.',
  },
  comedy: {
    label: 'Comedy',
    dbEventCategories: ['theater'],
    dbVenueTypes: null,
    searchTerms: (date) => `comedy shows stand up comedy open mic improv ${date} tonight`,
    system: 'Find comedy shows, stand-up performances, open mic nights, and improv tonight.',
  },
  late_night: {
    label: 'Late Night Food',
    dbEventCategories: null,
    dbVenueTypes: ['restaurant'],
    searchTerms: (date) => `late night restaurants food trucks diners open late ${date}`,
    system: 'Find restaurants, diners, and food spots that are open late tonight.',
  },
  sports: {
    label: 'Sports',
    dbEventCategories: ['sports'],
    dbVenueTypes: ['stadium', 'bar'],
    searchTerms: (date) => `sports bars games tonight stadium arena match ${date}`,
    system: 'Find sports bars showing games and sports events happening tonight.',
  },
};

// ============================================================================
// TOKEN MANAGEMENT
// ============================================================================

/**
 * Generate a unique 8-character URL-safe share token for a driver
 * @param {string} profileId - driver_profiles.id (UUID)
 * @returns {Promise<string>} The generated token
 */
export async function generateShareToken(profileId) {
  // Generate 6 random bytes → 8 base64url characters
  const token = crypto.randomBytes(6).toString('base64url');

  await db.update(driver_profiles)
    .set({ concierge_share_token: token })
    .where(eq(driver_profiles.id, profileId));

  console.log(`[CONCIERGE] Generated share token for profile ${profileId.slice(0, 8)}...`);
  return token;
}

/**
 * Get the current share token for a driver (by user_id)
 * @param {string} userId - users.user_id (UUID)
 * @returns {Promise<{ token: string|null, profileId: string }>}
 */
export async function getShareToken(userId) {
  const profile = await db.query.driver_profiles.findFirst({
    where: eq(driver_profiles.user_id, userId),
    columns: { id: true, concierge_share_token: true },
  });

  if (!profile) {
    throw new Error('Driver profile not found');
  }

  return { token: profile.concierge_share_token, profileId: profile.id };
}

// ============================================================================
// PUBLIC PROFILE LOOKUP
// ============================================================================

/**
 * Get sanitized public profile for a driver by share token
 * Privacy: NEVER returns email, last_name, address, home coords, user_id, phone
 * 2026-04-10: SECURITY FIX — Removed phone from public profile (PII leak on public page)
 * @param {string} token - concierge_share_token
 * @returns {Promise<Object|null>} Public profile or null if not found
 */
export async function getDriverPublicProfile(token) {
  const profile = await db.query.driver_profiles.findFirst({
    where: eq(driver_profiles.concierge_share_token, token),
    columns: {
      id: true,
      first_name: true,
      driver_nickname: true,
      // 2026-04-10: phone REMOVED from public profile — PII should never be on a public page
    },
  });

  if (!profile) return null;

  // Get primary vehicle
  const vehicle = await db.query.driver_vehicles.findFirst({
    where: and(
      eq(driver_vehicles.driver_profile_id, profile.id),
      eq(driver_vehicles.is_primary, true),
    ),
    columns: {
      year: true,
      make: true,
      model: true,
      seatbelts: true,
    },
  });

  return {
    name: profile.driver_nickname || profile.first_name,
    vehicle: vehicle ? {
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      seatbelts: vehicle.seatbelts,
    } : null,
  };
}

/**
 * Get driver's own card data (for preview on authenticated page)
 * @param {string} userId - users.user_id (UUID)
 * @returns {Promise<Object>} Driver card data
 */
export async function getDriverPreview(userId) {
  const profile = await db.query.driver_profiles.findFirst({
    where: eq(driver_profiles.user_id, userId),
    columns: {
      id: true,
      first_name: true,
      driver_nickname: true,
      phone: true,
      concierge_share_token: true,
    },
  });

  if (!profile) {
    throw new Error('Driver profile not found');
  }

  const vehicle = await db.query.driver_vehicles.findFirst({
    where: and(
      eq(driver_vehicles.driver_profile_id, profile.id),
      eq(driver_vehicles.is_primary, true),
    ),
    columns: {
      year: true,
      make: true,
      model: true,
      seatbelts: true,
    },
  });

  return {
    name: profile.driver_nickname || profile.first_name,
    phone: profile.phone || null,
    token: profile.concierge_share_token,
    vehicle: vehicle ? {
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      seatbelts: vehicle.seatbelts,
    } : null,
  };
}

// ============================================================================
// VENUE TYPE DERIVATION
// ============================================================================

/**
 * 2026-02-26: Derive a human-readable venue type from venue_types array + category.
 * Avoids blindly labeling everything with is_bar=true as "bar".
 * Priority: venue_types array (most specific) → category → fallback
 */
function deriveVenueType(venue) {
  const types = venue.venue_types || [];

  // Check for specific types in priority order
  if (types.includes('restaurant')) return 'restaurant';
  if (types.includes('comedy_club')) return 'comedy';
  if (types.includes('stadium') || types.includes('arena')) return 'stadium';
  if (types.includes('event_host') || types.includes('concert_hall')) return 'event venue';
  if (types.includes('nightclub')) return 'nightclub';
  if (types.includes('wine_bar')) return 'wine bar';
  if (types.includes('cocktail_bar')) return 'cocktail bar';
  if (types.includes('bar')) return 'bar';

  // Fall back to category, then is_bar flag
  if (venue.category) return venue.category;
  if (venue.is_bar) return 'bar';

  return 'venue';
}

// ============================================================================
// DB-FIRST SEARCH — query existing data before calling Gemini
// ============================================================================

/**
 * Query venue_catalog for upscale venues/lounges near coordinates.
 * Follows the "Cache First" pattern from venue-intelligence.js.
 *
 * @param {{ lat: number, lng: number, filter: string }} params
 * @returns {Promise<Array>} Formatted venue objects
 */
async function queryNearbyVenues({ lat, lng, filter }) {
  const filterConfig = CONCIERGE_FILTERS[filter] || CONCIERGE_FILTERS.all;

  try {
    let conditions = [
      ...nearbyCoordinateConditions(lat, lng),
      sql`${venue_catalog.auto_suppressed} IS NOT TRUE`,
    ];

    // If filter specifies venue types, add JSONB filter
    if (filterConfig.dbVenueTypes && filterConfig.dbVenueTypes.length > 0) {
      conditions.push(
        sql`${venue_catalog.venue_types} ?| array[${sql.join(filterConfig.dbVenueTypes.map(t => sql`${t}`), sql`, `)}]`
      );
    }

    const rows = await db.select({
      venue_id: venue_catalog.venue_id,
      venue_name: venue_catalog.venue_name,
      address: venue_catalog.formatted_address,
      address_fallback: venue_catalog.address,
      lat: venue_catalog.lat,
      lng: venue_catalog.lng,
      category: venue_catalog.category,
      venue_types: venue_catalog.venue_types,
      expense_rank: venue_catalog.expense_rank,
      is_bar: venue_catalog.is_bar,
      hours_full_week: venue_catalog.hours_full_week,
      city: venue_catalog.city,
      state: venue_catalog.state,
    })
      .from(venue_catalog)
      .where(and(...conditions))
      .limit(200); // Broad pull, Haversine filters next

    // Haversine filter to exact radius + compute distance
    const nearby = rows
      .filter(v => normalizeCoordinates(v.lat, v.lng) && Number.isFinite(v.lat) && Number.isFinite(v.lng))
      .map(v => ({
        ...v,
        distance_miles: haversineDistanceMiles(lat, lng, v.lat, v.lng),
      }))
      .filter(v => v.distance_miles <= RADIUS_MILES)
      .sort((a, b) => a.distance_miles - b.distance_miles);

    // 2026-02-26: FIX - Respect user's filter selection when returning venues.
    // Previously `|| v.is_bar` unconditionally included all bars regardless of filter,
    // making every category (Late Night Food, Comedy, etc.) show mostly bars.
    // Now: for 'bars'/'all' filters, include bars + upscale venues.
    // For all other filters, trust the DB query's venue_types filter — don't override it.
    const isBarFilter = filter === 'bars' || filter === 'all';
    return nearby
      .filter(v => {
        if (isBarFilter) {
          // Bars/All: show upscale venues + bars (original behavior)
          return (v.expense_rank && v.expense_rank >= 2) || v.is_bar;
        }
        // Other filters: DB already filtered by venue_types — just ensure quality
        // Accept all results (the DB query already applied the right filter)
        return true;
      })
      .slice(0, 15)
      .map(v => ({
        venue_id: v.venue_id,
        title: v.venue_name,
        address: v.address || v.address_fallback || '',
        // 2026-02-26: FIX - Use actual venue category instead of blindly labeling as 'bar'.
        // Derive type from venue_types array first, then fall back to category.
        type: deriveVenueType(v),
        expense_rank: v.expense_rank || null,
        venue_types: v.venue_types || [],
        distance_hint: `${v.distance_miles.toFixed(1)} mi`,
        // 2026-02-13: Include coords so ConciergeMap can plot markers
        lat: v.lat,
        lng: v.lng,
        city: v.city,
        state: v.state,
        source: 'db',
      }));
  } catch (err) {
    console.error('[CONCIERGE] Venue DB query error:', err.message);
    throw new Error(`Concierge venues DB query failed: ${err.message}`);
  }
}

/**
 * Query discovered_events for today's active events near coordinates.
 *
 * @param {{ lat: number, lng: number, filter: string }} params
 * @returns {Promise<Array>} Formatted event objects
 */
async function queryNearbyEvents({ lat, lng, filter }) {
  const filterConfig = CONCIERGE_FILTERS[filter] || CONCIERGE_FILTERS.all;

  try {
    // Nearby venues may be across a timezone/date boundary. Unknown stored
    // zones produce NULL, not a guessed viewer date or a query-wide PG error.
    const venueToday = sql`CASE WHEN ${venue_catalog.timezone} IN (SELECT name FROM pg_timezone_names)
      THEN (${new Date().toISOString()}::timestamptz AT TIME ZONE ${venue_catalog.timezone})::date::text END`;

    // 2026-09-13: coordinates come from venue_catalog (single source of truth) via
    // discovered_events.venue_id. The previous `discovered_events.lat` reference was
    // undefined in Drizzle, rendered as ` BETWEEN $1 AND $2`, and made this query
    // fail (and return []) on every call — DB_SCHEMA_EVALUATION_2026-09-13 §2.1.
    // Independently found 2026-09-10 as Astra product finding #4 (same root cause).
    let conditions = [
      eq(discovered_events.is_active, true),
      sql`${discovered_events.event_start_date} <= (${venueToday})`,
      sql`COALESCE(${discovered_events.event_end_date}, ${discovered_events.event_start_date}) >= (${venueToday})`,
      ...nearbyCoordinateConditions(lat, lng),
    ];

    // If filter specifies event categories, restrict
    if (filterConfig.dbEventCategories && filterConfig.dbEventCategories.length > 0) {
      conditions.push(
        sql`${discovered_events.category} IN (${sql.join(filterConfig.dbEventCategories.map(c => sql`${c}`), sql`, `)})`
      );
    }

    const rows = await db.select({
      id: discovered_events.id,
      event_hash: discovered_events.event_hash,
      venue_id: discovered_events.venue_id,
      venue_timezone: venue_catalog.timezone,
      title: discovered_events.title,
      venue_name: discovered_events.venue_name,
      address: discovered_events.address,
      city: discovered_events.city,
      state: discovered_events.state,
      lat: venue_catalog.lat,
      lng: venue_catalog.lng,
      event_start_date: discovered_events.event_start_date,
      event_end_date: discovered_events.event_end_date,
      event_start_time: discovered_events.event_start_time,
      event_end_time: discovered_events.event_end_time,
      category: discovered_events.category,
      expected_attendance: discovered_events.expected_attendance,
    })
      .from(discovered_events)
      .innerJoin(venue_catalog, eq(discovered_events.venue_id, venue_catalog.venue_id))
      .where(and(...conditions))
      .limit(200);

    // Haversine filter + distance
    // 2026-09-11 (todo #62): coordinates are the joined venue_catalog doubles; a joined row
    // without finite coords is unmappable and is dropped here (never coerced or defaulted).
    const nearby = rows
      .filter(e => {
        if (!e.venue_timezone) return false;
        try { new Intl.DateTimeFormat('en', { timeZone: e.venue_timezone }); } catch { return false; }
        return validateEvent({ ...e }, { timezone: e.venue_timezone }).valid;
      })
      .filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lng))
      .map(e => ({
        ...e,
        distance_miles: haversineDistanceMiles(lat, lng, e.lat, e.lng),
      }))
      .filter(e => e.distance_miles <= RADIUS_MILES)
      .sort((a, b) => a.distance_miles - b.distance_miles);

    return nearby.slice(0, 15).map(e => ({
      event_hash: e.event_hash,
      venue_id: e.venue_id,
      title: e.title,
      venue: e.venue_name || null,
      address: e.address || '',
      type: e.category || 'event',
      time: formatEventTime(e.event_start_time, e.event_end_time),
      description: e.expected_attendance ? `Expected attendance: ${e.expected_attendance}` : null,
      distance_hint: `${e.distance_miles.toFixed(1)} mi`,
      // 2026-02-13: Include coords so ConciergeMap can plot markers
      lat: e.lat,
      lng: e.lng,
      city: e.city,
      state: e.state,
      source: 'db',
    }));
  } catch (err) {
    // 2026-09-11 (todo #62, CLAUDE.md "fail loud; never fake"): this catch used to return []
    // — which is exactly how the dropped-column predicate (FIX H-7) hid for months: the
    // concierge showed "no events" as if the city were empty, and searchNearby counted the
    // failure as zero results and paid for a Gemini fallback. A failed query is an error,
    // not missing optional data: propagate it with its cause so the route returns 500 and
    // the log names the real problem.
    console.error('[CONCIERGE] Events DB query FAILED:', err.message);
    throw new Error(`Concierge events DB query failed: ${err.message}`);
  }
}

/**
 * Format event start/end time for display
 */
function formatEventTime(startTime, endTime) {
  if (!startTime && !endTime) return null;
  if (startTime && endTime) return `${startTime} - ${endTime}`;
  return startTime || endTime;
}

// ============================================================================
// GEMINI FALLBACK — only called when DB has insufficient results
// ============================================================================

/**
 * Safe JSON parse for LLM output (handles markdown code blocks, trailing commas)
 */
function safeJsonParse(jsonString) {
  if (!jsonString || typeof jsonString !== 'string') return null;

  let cleaned = jsonString.trim();
  // Remove markdown code blocks
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  }
  cleaned = cleaned.replace(/```json/g, '').replace(/```/g, '').trim();

  // Remove trailing commas
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  // 2026-02-26: Strip inline markdown citations before parsing/regex extraction.
  // Gemini's google_search grounding injects [Source](url) which corrupts []-based regex matching.
  cleaned = cleaned.replace(/\[([^\]]*)\]\([^)]+\)/g, '$1');

  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract JSON array from the string
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0].replace(/,\s*([}\]])/g, '$1'));
      } catch {
        // Fall through to balanced-brace extraction
      }
    }

    // 2026-02-26: Balanced-brace extraction — last resort when greedy regex fails
    let depth = 0, start = -1;
    const objs = [];
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === '{') { if (depth === 0) start = i; depth++; }
      else if (cleaned[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          try { objs.push(JSON.parse(cleaned.slice(start, i + 1))); } catch { /* skip */ }
          start = -1;
        }
      }
    }
    if (objs.length > 0) return objs;

    return null;
  }
}

/**
 * Call Gemini to discover events/venues for an uncatalogued location.
 * Results are returned AND persisted to the database.
 *
 * @param {{ lat: number, lng: number, filter: string, timezone: string, todayDate: string, dayOfWeek: string }} params
 * @returns {Promise<{ venues: Array, events: Array }>}
 */
async function geminiDiscoverAndPersist({ lat, lng, filter, timezone, todayDate, dayOfWeek, signal }) {
  const filterConfig = CONCIERGE_FILTERS[filter] || CONCIERGE_FILTERS.all;

  const prompt = `Find ${filterConfig.label.toLowerCase()} near latitude ${lat}, longitude ${lng} TODAY (${dayOfWeek}, ${todayDate}).

SEARCH FOCUS: "${filterConfig.searchTerms(todayDate)}"

Search for places and events within approximately 10 miles.

Return a JSON object with TWO arrays — "venues" for permanent establishments, "events" for time-limited happenings:
{
  "venues": [{
    "name": "Venue Name",
    "address": "Full Street Address, City, State ZIP",
    "city": "City",
    "state": "Provider region code",
    "type": "bar",
    "hours": "5:00 PM - 2:00 AM",
    "description": "Brief description"
  }],
  "events": [{
    "title": "Event Name",
    "venue": "Venue Name",
    "address": "Full Street Address, City, State ZIP",
    "city": "City",
    "state": "Provider region code",
    "category": "concert",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "start_time": "HH:MM",
    "end_time": "HH:MM",
    "description": "Brief description"
  }]
}

RULES:
- Return REAL places and events — do NOT make up venues
- Give the actual event dates and start/end times; omit events with unconfirmed timing
- Do not supply coordinates; venue identity and coordinates are resolved separately through Google Places
- Include full street address for navigation
- "venues" = bars, restaurants, lounges (permanent places)
- "events" = concerts, comedy shows, sports games (time-limited)
- Return empty arrays if nothing found
- Prioritize places currently open or events happening tonight`;

  const system = filterConfig.system + `
You are a local concierge assistant helping someone discover great places nearby.
Return ONLY a valid JSON object with "venues" and "events" arrays. No explanation text.`;

  try {
    console.log('[CONCIERGE] Searching current local information for uncatalogued results');
    const startTime = Date.now();

    signal?.throwIfAborted();
    const result = await callModel('CONCIERGE_SEARCH', { system, user: prompt, signal });
    signal?.throwIfAborted();

    const elapsed = Date.now() - startTime;
    console.log(`[CONCIERGE] Gemini complete in ${elapsed}ms`);

    if (!result.ok) {
      throw new Error('Concierge discovery provider failed');
    }

    const parsed = safeJsonParse(result.output);
    if (!parsed || (!Array.isArray(parsed) && (!Array.isArray(parsed.venues) || !Array.isArray(parsed.events)))) throw new Error('Concierge discovery returned an invalid result');

    // Handle both object {venues, events} and legacy array format
    let geminiVenues = [];
    let geminiEvents = [];

    if (Array.isArray(parsed)) {
      // Legacy array format — split by whether it has a "time" or "start_time"
      geminiVenues = parsed.filter(i => !i.start_time && !i.time);
      geminiEvents = parsed.filter(i => i.start_time || i.time);
    } else if (parsed && typeof parsed === 'object') {
      geminiVenues = Array.isArray(parsed.venues) ? parsed.venues : [];
      geminiEvents = Array.isArray(parsed.events) ? parsed.events : [];
    }

    return await persistGeminiResults({ venues: geminiVenues, events: geminiEvents, lat, lng, timezone, signal });
  } catch (err) {
    console.error('[CONCIERGE] Discovery failed:', err.message);
    throw err;
  }
}

// Public discoveries can feed the shared event catalog only after the same
// canonical normalization/validation as MAIN and a Google-resolved venue link.
// Work is awaited: failed/unverified candidates cannot look like saved success.
async function persistGeminiResults({ venues, events, lat, lng, timezone, signal }) {
  const resolved = new Map();
  const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
  const resolveVenue = async candidate => {
    const name = text(candidate.name) || text(candidate.venue);
    if (!name) throw new Error('missing_venue_identity');
    const query = [name, text(candidate.address)].filter(Boolean).join(', ');
    if (!resolved.has(query)) resolved.set(query, (async () => {
      signal?.throwIfAborted();
      const deadline = AbortSignal.timeout(8000);
      const place = await searchPlaceWithTextSearch(lat, lng, query, { radius: RADIUS_MILES * 1609.344, signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
      signal?.throwIfAborted();
      const coords = normalizeCoordinates(place?.lat, place?.lng);
      if (!coords || !text(place?.placeId) || !text(place?.displayName) || !text(place?.formattedAddress) ||
          !text(place?.parsed?.city) || !text(place?.parsed?.state) || !/^[A-Z]{2}$/.test(place?.parsed?.country || '') ||
          haversineDistanceMiles(lat, lng, coords.lat, coords.lng) > RADIUS_MILES) throw new Error('venue_not_verified_nearby');
      const saved = await findOrCreateVenue({ venue: place.displayName, address: place.formattedAddress,
        formattedAddress: place.formattedAddress, latitude: coords.lat, longitude: coords.lng,
        city: place.parsed.city, state: place.parsed.state, country: place.parsed.country, placeId: place.placeId }, 'concierge_discovery');
      if (!saved?.venue_id || saved.place_id !== place.placeId || !normalizeCoordinates(saved.lat, saved.lng) ||
          haversineDistanceMiles(lat, lng, saved.lat, saved.lng) > RADIUS_MILES) throw new Error('venue_link_not_verified');
      return { ...saved, venue_name: place.displayName, formatted_address: place.formattedAddress,
        city: place.parsed.city, state: place.parsed.state, country: place.parsed.country, lat: coords.lat, lng: coords.lng };
    })());
    return resolved.get(query);
  };
  const verifiedVenues = new Map(), verifiedEvents = new Map(), eventWrites = new Map();
  const rejected = [];
  const candidates = [...venues.map(value => ({ type: 'venue', value })), ...events.map(value => ({ type: 'event', value }))];
  // A bounded worker batch avoids a Places burst while retaining every result.
  for (let start = 0; start < candidates.length; start += 3) {
    signal?.throwIfAborted();
    await Promise.all(candidates.slice(start, start + 3).map(async ({ type, value }) => {
      try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_candidate');
        let normalized;
        if (type === 'event') {
          normalized = normalizeEvent({ ...value, event_start_date: value.start_date, event_end_date: value.end_date,
            event_start_time: value.start_time, event_end_time: value.end_time });
          const check = validateEvent(normalized, { timezone });
          // Content errors can be rejected before Google. Date-boundary
          // decisions require the resolved venue timezone below.
          if (!check.valid && !['starts_in_future', 'ended_before_today'].includes(check.reason)) throw new Error(check.reason);
        }
        const venue = await resolveVenue(value);
        signal?.throwIfAborted();
        const base = { venue_id: venue.venue_id, address: venue.formatted_address, lat: venue.lat, lng: venue.lng,
          city: venue.city, state: venue.state, distance_hint: `${haversineDistanceMiles(lat, lng, venue.lat, venue.lng).toFixed(1)} mi` };
        if (type === 'venue') {
          verifiedVenues.set(venue.venue_id, { ...base, title: venue.venue_name, type: text(value.type) || 'venue',
            description: text(value.description), time: null, source: 'google_places' });
          return;
        }
        normalized = { ...normalized, venue_name: venue.venue_name, address: venue.formatted_address, city: venue.city, state: venue.state };
        if (!venue.timezone) throw new Error('venue_timezone_unverified');
        const check = validateEvent(normalized, { timezone: venue.timezone });
        if (!check.valid) throw new Error(check.reason);
        const hash = generateEventHash(normalized);
        const { place_id: _placeId, ...stored } = normalized;
        // Drizzle queries are lazy thenables; share a real Promise so multiple
        // awaiters cannot execute the same INSERT builder more than once.
        const writeKey = JSON.stringify([hash, venue.venue_id, normalized.event_start_time, normalized.event_end_time]);
        if (!eventWrites.has(writeKey)) eventWrites.set(writeKey, withEventVenueLock(venue.venue_id, async tx => {
          signal?.throwIfAborted();
          const merged = await mergeIntoOverlappingActiveSpan({ venueId: venue.venue_id, title: normalized.title,
            startDate: normalized.event_start_date, endDate: normalized.event_end_date,
            startTime: normalized.event_start_time, endTime: normalized.event_end_time }, tx, { returnRecord: true });
          if (merged) return merged.event_hash;
          const storedHash = await resolveEventWriteHash(tx, { ...normalized, venue_id: venue.venue_id }, hash);
          await tx.insert(discovered_events).values({ ...stored, venue_id: venue.venue_id,
            expected_attendance: ['low', 'medium', 'high'].includes(value.expected_attendance) ? value.expected_attendance : null,
            event_hash: storedHash, is_active: true, schema_version: VALIDATION_SCHEMA_VERSION,
          }).onConflictDoNothing({ target: discovered_events.event_hash });
          return storedHash;
        }, { refreshTag: true }));
        const savedHash = await eventWrites.get(writeKey);

        verifiedEvents.set(savedHash, { ...base, title: normalized.title, venue: venue.venue_name, type: normalized.category,
          time: formatEventTime(normalized.event_start_time, normalized.event_end_time),
          description: text(value.description), source: 'gemini_google_places', event_hash: savedHash });
      } catch (error) {
        signal?.throwIfAborted();
        rejected.push({ type, reason: error.message });
      }
    }));
  }
  return { venues: [...verifiedVenues.values()], events: [...verifiedEvents.values()],
    discovery: { complete: rejected.length === 0, rejected_candidates: rejected } };
}

// ============================================================================
// MAIN SEARCH — DB-FIRST, GEMINI FALLBACK
// ============================================================================

/**
 * Search for events/venues near coordinates.
 * Architecture: DB first → Gemini fallback if DB is sparse → persist new discoveries.
 *
 * @param {{ lat: number, lng: number, filter: string, timezone: string }} params
 * @returns {Promise<{ venues: Array, events: Array, filter: string, source: string }>}
 */
export async function searchNearby({ lat, lng, filter = 'all', timezone, signal }) {
  signal?.throwIfAborted();
  if (!normalizeCoordinates(lat, lng) || typeof lat !== 'number' || typeof lng !== 'number') {
    throw new Error('Valid lat/lng coordinates are required');
  }

  if (!timezone) throw new Error('GPS-resolved timezone is required for local discovery');
  // Get local date in viewer's timezone
  const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone });

  console.log(`[CONCIERGE] Local search requested (${todayDate})`);
  const startTime = Date.now();

  // ─── STEP 1: Query DB for existing data ───────────────────────────────
  const [dbVenues, dbEvents] = await Promise.all([
    queryNearbyVenues({ lat, lng, filter }),
    queryNearbyEvents({ lat, lng, filter }),
  ]);
  signal?.throwIfAborted();

  const dbTotal = dbVenues.length + dbEvents.length;
  console.log(`[CONCIERGE] DB: ${dbVenues.length} venues, ${dbEvents.length} events (${Date.now() - startTime}ms)`);

  // ─── STEP 2: If DB has enough results, return immediately ─────────────
  if (dbTotal >= MIN_DB_RESULTS) {
    console.log(`[CONCIERGE] DB-first hit: ${dbTotal} results, skipping Gemini`);
    return {
      venues: dbVenues,
      events: dbEvents,
      filter,
      source: 'db',
    };
  }

  // ─── STEP 3: DB sparse → call Gemini as fallback ──────────────────────
  console.log(`[CONCIERGE] DB sparse (${dbTotal} results), calling Gemini fallback`);

  const geminiResults = await geminiDiscoverAndPersist({
    lat, lng, filter, timezone, todayDate, dayOfWeek, signal,
  });
  signal?.throwIfAborted();

  // Merge DB + Gemini results (DB results first, they're verified data)
  const mergeByIdentity = (existing, discovered, key) => {
    const seen = new Set();
    return [...existing, ...discovered].filter(row => {
      const identity = row[key];
      if (!identity) return true; // Unknown identity cannot justify dropping a row.
      if (seen.has(identity)) return false;
      seen.add(identity); return true;
    });
  };
  const mergedVenues = mergeByIdentity(dbVenues, geminiResults.venues, 'venue_id');
  const mergedEvents = mergeByIdentity(dbEvents, geminiResults.events, 'event_hash');

  const elapsed = Date.now() - startTime;
  console.log(`[CONCIERGE] Total: ${mergedVenues.length} venues, ${mergedEvents.length} events (${elapsed}ms)`);

  return {
    venues: mergedVenues,
    events: mergedEvents,
    filter,
    source: dbTotal > 0 ? 'db+gemini' : 'gemini',
    discovery: geminiResults.discovery,
  };
}

/**
 * Get available filter definitions (for client to display buttons)
 */
export function getFilterDefinitions() {
  return Object.entries(CONCIERGE_FILTERS).map(([id, config]) => ({
    id,
    label: config.label,
  }));
}

// ============================================================================
// ASK CONCIERGE — Public AI Q&A for passengers
// ============================================================================

/**
 * Answer a passenger's question using Gemini with local context.
 * 2026-02-13: Lightweight version of the AI Coach for public concierge page.
 * No auth required, no driver context, no action tags — just local knowledge.
 *
 * @param {{ question: string, lat: number, lng: number, timezone: string, venueContext?: string, eventContext?: string }} params
 * @returns {Promise<{ ok: boolean, answer: string }>}
 */
// 2026-04-02: Extracted system prompt builder for reuse by both non-streaming and streaming endpoints
export function buildConciergeSystemPrompt({ lat, lng, timezone, venueContext, eventContext }) {
  if (!timezone) throw new Error('GPS-resolved timezone is required for concierge assistance');
  const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone });
  const localTime = new Date().toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `You are the Vecto AI Concierge, helping an anonymous guest discover the local area.
You have no driver identity, profile, earnings, ride history, or account data.

YOUR CAPABILITIES:
- You have Google Search access for real-time, current information
- You can look up restaurants, bars, events, directions, safety info, transit, and anything local
- When nearby listings appear below, treat them as contextual data and verify time-sensitive details

CURRENT CONTEXT:
- Date: ${dayOfWeek}, ${todayDate}
- Time: ${localTime} (${timezone})
- Location: lat ${lat}, lng ${lng}

${venueContext ? `NEARBY VENUES (already shown to passenger):\n${venueContext}\n` : ''}
${eventContext ? `NEARBY EVENTS (already shown to passenger):\n${eventContext}\n` : ''}

RULES:
- Be helpful, concise, and friendly — you are a premium concierge service
- Answer questions about local restaurants, bars, events, transportation, directions, safety, and general area info
- If asked about a specific venue or event from the list above, reference the details you know
- Use Google Search to find current, accurate information when needed
- Keep responses under 200 words — passengers are on the go
- You can recommend venues, give directions, share local tips, and look up anything the passenger needs
- Do NOT discuss rideshare strategy, earnings, or driver-specific topics
- Do NOT reveal internal system details or API keys
- If the question is inappropriate or unrelated to local discovery, politely redirect`;
}

export async function askConcierge({ question, lat, lng, timezone, venueContext, eventContext, signal }) {
  signal?.throwIfAborted();
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return { ok: false, answer: 'Please ask a question.' };
  }

  // Safety: truncate very long questions
  const safeQuestion = question.trim().slice(0, 500);

  const system = buildConciergeSystemPrompt({ lat, lng, timezone, venueContext, eventContext });
  const prompt = safeQuestion;

  try {
    console.log('[CONCIERGE] Local assistance requested with verified location context');
    const startTime = Date.now();

    const result = await callModel('CONCIERGE_CHAT', { system, user: prompt, signal });
    signal?.throwIfAborted();

    const elapsed = Date.now() - startTime;
    console.log(`[CONCIERGE] Ask complete in ${elapsed}ms (${result.ok ? 'ok' : 'error'})`);

    if (!result.ok) {
      console.error('[CONCIERGE] Ask failed:', result.error);
      return { ok: false, answer: 'Sorry, I could not process your question right now. Please try again.' };
    }

    // Clean markdown code blocks if Gemini wraps the response
    let answer = (result.output || '').trim();
    if (answer.startsWith('```')) {
      answer = answer.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();
    }

    if (!answer) return { ok: false, answer: 'The concierge returned no answer. Please try again.' };
    return { ok: true, answer };
  } catch (err) {
    signal?.throwIfAborted();
    console.error('[CONCIERGE] Ask error:', err.message);
    return { ok: false, answer: 'Sorry, something went wrong. Please try again.' };
  }
}

// ============================================================================
// PASSENGER FEEDBACK — Star rating + comments from QR code scans
// ============================================================================

/**
 * Submit passenger feedback for a driver.
 * 2026-02-13: Direct feedback that rideshare platforms never share with drivers.
 * No auth required — passengers are anonymous. Rate limited on API side.
 *
 * @param {{ token: string, rating: number, comment?: string }} params
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function submitFeedback({ token, rating, comment }) {
  if (!token || !rating || rating < 1 || rating > 5) {
    return { ok: false, error: 'Valid token and rating (1-5) required' };
  }

  try {
    // Look up driver by share token
    const profile = await db.query.driver_profiles.findFirst({
      where: eq(driver_profiles.concierge_share_token, token),
      columns: { id: true },
    });

    if (!profile) {
      return { ok: false, error: 'Driver not found' };
    }

    // Truncate comment to 500 chars to prevent abuse
    const safeComment = comment ? String(comment).trim().slice(0, 500) : null;

    await db.insert(concierge_feedback).values({
      driver_profile_id: profile.id,
      share_token: token,
      rating: Math.round(rating),
      comment: safeComment || null,
    });

    console.log(`[CONCIERGE] Feedback: ${rating}/5 for profile ${profile.id.slice(0, 8)}...${safeComment ? ' (with comment)' : ''}`);
    return { ok: true };
  } catch (err) {
    console.error('[CONCIERGE] Feedback error:', err.message);
    return { ok: false, error: 'Failed to submit feedback' };
  }
}

/**
 * Get feedback summary for a driver (for the authenticated concierge tab).
 * @param {string} userId - users.user_id
 * @returns {Promise<{ ok: boolean, avgRating: number|null, totalReviews: number, recentComments: Array }>}
 */
export async function getFeedbackSummary(userId) {
  try {
    const profile = await db.query.driver_profiles.findFirst({
      where: eq(driver_profiles.user_id, userId),
      columns: { id: true },
    });

    if (!profile) {
      return { ok: true, avgRating: null, totalReviews: 0, recentComments: [] };
    }

    // Get aggregate stats
    const [stats] = await db.select({
      avgRating: sql`ROUND(AVG(${concierge_feedback.rating})::numeric, 1)`,
      totalReviews: sql`COUNT(*)::int`,
    })
      .from(concierge_feedback)
      .where(eq(concierge_feedback.driver_profile_id, profile.id));

    // Get 10 most recent comments
    const recentComments = await db.select({
      rating: concierge_feedback.rating,
      comment: concierge_feedback.comment,
      created_at: concierge_feedback.created_at,
    })
      .from(concierge_feedback)
      .where(and(
        eq(concierge_feedback.driver_profile_id, profile.id),
        sql`${concierge_feedback.comment} IS NOT NULL AND ${concierge_feedback.comment} != ''`
      ))
      .orderBy(sql`${concierge_feedback.created_at} DESC`)
      .limit(10);

    return {
      ok: true,
      avgRating: stats?.avgRating ? Number(stats.avgRating) : null,
      totalReviews: stats?.totalReviews || 0,
      recentComments,
    };
  } catch (err) {
    console.error('[CONCIERGE] Feedback summary error:', err.message);
    return { ok: true, avgRating: null, totalReviews: 0, recentComments: [] };
  }
}
