// server/lib/concierge/concierge-service.js
// 2026-02-13: Public concierge service — token management, profile lookup, event search
// 2026-02-13: DB-FIRST ARCHITECTURE — query discovered_events + venue_catalog first,
//             Gemini fallback only for uncatalogued locations, persist new discoveries
//
// This service powers the Concierge QR code feature:
// - Drivers generate a share token displayed as a QR code
// - Passengers scan it and see events/venues near their location
// - No authentication required for the public page

import crypto from 'crypto';
import { db } from '../../db/drizzle.js';
import { driver_profiles, driver_vehicles, discovered_events, venue_catalog, concierge_feedback } from '../../../shared/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { callModel } from '../ai/adapters/index.js';
import { haversineDistanceMiles } from '../location/geo.js';
import { findOrCreateVenue } from '../venue/venue-cache.js';
import { normalizeEvent } from '../events/pipeline/normalizeEvent.js';
import { generateEventHash } from '../events/pipeline/hashEvent.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const RADIUS_MILES = 10; // Default search radius for concierge
const MIN_DB_RESULTS = 3; // If fewer than this, trigger Gemini fallback

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
    searchTerms: (date) => `sports bars games tonight NBA NFL NHL MLB MLS college ${date}`,
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

  console.log(`[concierge] Generated share token for profile ${profileId.slice(0, 8)}...`);
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
 * Privacy: NEVER returns email, last_name, address, home coords, user_id
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
      phone: true,
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
    phone: profile.phone || null,
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
    // 2026-02-13: Broad query — pull venues that aren't suppressed, then Haversine filter
    // We can't do a tight city/state filter because passenger may be at a boundary
    // Instead, use a bounding box approximation (~10 miles ≈ 0.145 degrees lat)
    const latDelta = RADIUS_MILES / 69.0; // 1 degree lat ≈ 69 miles
    const lngDelta = RADIUS_MILES / (69.0 * Math.cos(lat * Math.PI / 180));

    let conditions = [
      sql`${venue_catalog.lat} BETWEEN ${lat - latDelta} AND ${lat + latDelta}`,
      sql`${venue_catalog.lng} BETWEEN ${lng - lngDelta} AND ${lng + lngDelta}`,
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
      .filter(v => v.lat && v.lng)
      .map(v => ({
        ...v,
        distance_miles: haversineDistanceMiles(lat, lng, v.lat, v.lng),
      }))
      .filter(v => v.distance_miles <= RADIUS_MILES)
      .sort((a, b) => a.distance_miles - b.distance_miles);

    // Format for API response — prioritize upscale venues (expense_rank >= 2)
    return nearby
      .filter(v => (v.expense_rank && v.expense_rank >= 2) || v.is_bar)
      .slice(0, 15)
      .map(v => ({
        title: v.venue_name,
        address: v.address || v.address_fallback || '',
        type: v.is_bar ? 'bar' : (v.category || 'venue'),
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
    console.error('[concierge] Venue DB query error:', err.message);
    return [];
  }
}

/**
 * Query discovered_events for today's active events near coordinates.
 *
 * @param {{ lat: number, lng: number, filter: string, todayDate: string }} params
 * @returns {Promise<Array>} Formatted event objects
 */
async function queryNearbyEvents({ lat, lng, filter, todayDate }) {
  const filterConfig = CONCIERGE_FILTERS[filter] || CONCIERGE_FILTERS.all;

  try {
    // Bounding box for ~10 miles
    const latDelta = RADIUS_MILES / 69.0;
    const lngDelta = RADIUS_MILES / (69.0 * Math.cos(lat * Math.PI / 180));

    let conditions = [
      eq(discovered_events.is_active, true),
      sql`${discovered_events.event_start_date} = ${todayDate}`,
      sql`${discovered_events.lat} BETWEEN ${lat - latDelta} AND ${lat + latDelta}`,
      sql`${discovered_events.lng} BETWEEN ${lng - lngDelta} AND ${lng + lngDelta}`,
    ];

    // If filter specifies event categories, restrict
    if (filterConfig.dbEventCategories && filterConfig.dbEventCategories.length > 0) {
      conditions.push(
        sql`${discovered_events.category} IN (${sql.join(filterConfig.dbEventCategories.map(c => sql`${c}`), sql`, `)})`
      );
    }

    const rows = await db.select({
      id: discovered_events.id,
      title: discovered_events.title,
      venue_name: discovered_events.venue_name,
      address: discovered_events.address,
      city: discovered_events.city,
      state: discovered_events.state,
      lat: discovered_events.lat,
      lng: discovered_events.lng,
      event_start_date: discovered_events.event_start_date,
      event_start_time: discovered_events.event_start_time,
      event_end_time: discovered_events.event_end_time,
      category: discovered_events.category,
      expected_attendance: discovered_events.expected_attendance,
    })
      .from(discovered_events)
      .where(and(...conditions))
      .limit(200);

    // Haversine filter + distance
    const nearby = rows
      .filter(e => e.lat && e.lng)
      .map(e => ({
        ...e,
        distance_miles: haversineDistanceMiles(lat, lng, e.lat, e.lng),
      }))
      .filter(e => e.distance_miles <= RADIUS_MILES)
      .sort((a, b) => a.distance_miles - b.distance_miles);

    return nearby.slice(0, 15).map(e => ({
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
    console.error('[concierge] Events DB query error:', err.message);
    return [];
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
  if (!jsonString || typeof jsonString !== 'string') return [];

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

  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract JSON array from the string
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0].replace(/,\s*([}\]])/g, '$1'));
      } catch {
        return [];
      }
    }
    return [];
  }
}

/**
 * Call Gemini to discover events/venues for an uncatalogued location.
 * Results are returned AND persisted to the database.
 *
 * @param {{ lat: number, lng: number, filter: string, timezone: string, todayDate: string, dayOfWeek: string }} params
 * @returns {Promise<{ venues: Array, events: Array }>}
 */
async function geminiDiscoverAndPersist({ lat, lng, filter, timezone, todayDate, dayOfWeek }) {
  const filterConfig = CONCIERGE_FILTERS[filter] || CONCIERGE_FILTERS.all;

  const prompt = `Find ${filterConfig.label.toLowerCase()} near latitude ${lat.toFixed(6)}, longitude ${lng.toFixed(6)} TODAY (${dayOfWeek}, ${todayDate}).

SEARCH FOCUS: "${filterConfig.searchTerms(todayDate)}"

Search for places and events within approximately 10 miles.

Return a JSON object with TWO arrays — "venues" for permanent establishments, "events" for time-limited happenings:
{
  "venues": [{
    "name": "Venue Name",
    "address": "Full Street Address, City, State ZIP",
    "city": "City",
    "state": "TX",
    "type": "bar",
    "hours": "5:00 PM - 2:00 AM",
    "description": "Brief description"
  }],
  "events": [{
    "title": "Event Name",
    "venue": "Venue Name",
    "address": "Full Street Address, City, State ZIP",
    "city": "City",
    "state": "TX",
    "category": "concert",
    "start_time": "7:00 PM",
    "end_time": "10:00 PM",
    "description": "Brief description"
  }]
}

RULES:
- Return REAL places and events — do NOT make up venues
- Include full street address for navigation
- "venues" = bars, restaurants, lounges (permanent places)
- "events" = concerts, comedy shows, sports games (time-limited)
- Return empty arrays if nothing found
- Prioritize places currently open or events happening tonight`;

  const system = filterConfig.system + `
You are a local concierge assistant helping someone discover great places nearby.
Return ONLY a valid JSON object with "venues" and "events" arrays. No explanation text.`;

  try {
    console.log(`[concierge] Gemini fallback: "${filter}" near ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    const startTime = Date.now();

    const result = await callModel('CONCIERGE_SEARCH', { system, user: prompt });

    const elapsed = Date.now() - startTime;
    console.log(`[concierge] Gemini complete in ${elapsed}ms`);

    if (!result.ok) {
      console.error(`[concierge] Gemini search failed:`, result.error);
      return { venues: [], events: [] };
    }

    const parsed = safeJsonParse(result.output);

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

    // 2026-02-13: Persist new discoveries to DB (non-blocking, don't fail the response)
    persistGeminiResults({ venues: geminiVenues, events: geminiEvents, todayDate }).catch(err => {
      console.error('[concierge] Persist error (non-blocking):', err.message);
    });

    // Format for response
    // 2026-02-13: Gemini results may lack coords — map markers only appear for items with lat/lng.
    // We don't trust AI-generated coordinates (CLAUDE.md rule), but if Gemini provides them
    // they'll show on the map. DB-sourced results are always authoritative.
    const formattedVenues = geminiVenues.filter(v => v.name).map(v => ({
      title: v.name,
      address: v.address || '',
      type: v.type || 'venue',
      description: v.description || null,
      time: v.hours || null,
      lat: v.lat || null,
      lng: v.lng || null,
      city: v.city,
      state: v.state,
      source: 'gemini',
    }));

    const formattedEvents = geminiEvents.filter(e => e.title).map(e => ({
      title: e.title,
      venue: e.venue || null,
      address: e.address || '',
      type: e.category || 'event',
      time: formatEventTime(e.start_time, e.end_time),
      description: e.description || null,
      lat: e.lat || null,
      lng: e.lng || null,
      city: e.city,
      state: e.state,
      source: 'gemini',
    }));

    console.log(`[concierge] Gemini found ${formattedVenues.length} venues, ${formattedEvents.length} events`);
    return { venues: formattedVenues, events: formattedEvents };
  } catch (err) {
    console.error(`[concierge] Gemini fallback error:`, err.message);
    return { venues: [], events: [] };
  }
}

/**
 * Persist Gemini-discovered venues and events to the database.
 * Uses findOrCreateVenue for venues and direct INSERT for events.
 * This is fire-and-forget — errors are logged but don't block the response.
 *
 * @param {{ venues: Array, events: Array, todayDate: string }} data
 */
async function persistGeminiResults({ venues, events, todayDate }) {
  let venuesSaved = 0;
  let eventsSaved = 0;

  // Persist venues via findOrCreateVenue (handles dedup by coord_key/place_id/name)
  for (const v of venues) {
    if (!v.name || !v.city || !v.state) continue;
    try {
      await findOrCreateVenue({
        venue: v.name,
        address: v.address,
        city: v.city,
        state: v.state,
        // No coordinates from Gemini — we don't trust AI-generated coords (CLAUDE.md rule)
        // findOrCreateVenue will handle geocoding if needed
      }, 'concierge_gemini');
      venuesSaved++;
    } catch (err) {
      // Dedup conflicts are fine — venue already exists
      if (err.code !== '23505') {
        console.error(`[concierge] Persist venue "${v.name}" error:`, err.message);
      }
    }
  }

  // Persist events to discovered_events (with hash dedup)
  for (const e of events) {
    if (!e.title || !e.city || !e.state) continue;
    try {
      // Normalize event fields to canonical format
      const normalized = normalizeEvent({
        title: e.title,
        venue_name: e.venue || null,
        address: e.address || null,
        city: e.city,
        state: e.state,
        event_start_date: todayDate,
        event_start_time: e.start_time || null,
        event_end_time: e.end_time || '11:59 PM',
        category: e.category || 'other',
        expected_attendance: 'medium',
      });

      const eventHash = generateEventHash(normalized);

      await db.insert(discovered_events).values({
        title: normalized.title,
        venue_name: normalized.venue_name,
        address: normalized.address,
        city: normalized.city,
        state: normalized.state,
        event_start_date: normalized.event_start_date,
        event_start_time: normalized.event_start_time,
        event_end_date: normalized.event_end_date || todayDate,
        event_end_time: normalized.event_end_time,
        category: normalized.category || 'other',
        expected_attendance: normalized.expected_attendance || 'medium',
        event_hash: eventHash,
        is_active: true,
      }).onConflictDoNothing({ target: discovered_events.event_hash });

      eventsSaved++;
    } catch (err) {
      // Hash conflicts expected — event already exists
      if (err.code !== '23505') {
        console.error(`[concierge] Persist event "${e.title}" error:`, err.message);
      }
    }
  }

  if (venuesSaved > 0 || eventsSaved > 0) {
    console.log(`[concierge] Persisted ${venuesSaved} venues, ${eventsSaved} events from Gemini`);
  }
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
export async function searchNearby({ lat, lng, filter = 'all', timezone }) {
  if (!isFinite(lat) || !isFinite(lng)) {
    throw new Error('Valid lat/lng coordinates are required');
  }

  // Get local date in viewer's timezone
  const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: timezone || 'UTC' });
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone || 'UTC' });

  console.log(`[concierge] Search "${filter}" near ${lat.toFixed(4)}, ${lng.toFixed(4)} (${todayDate})`);
  const startTime = Date.now();

  // ─── STEP 1: Query DB for existing data ───────────────────────────────
  const [dbVenues, dbEvents] = await Promise.all([
    queryNearbyVenues({ lat, lng, filter }),
    queryNearbyEvents({ lat, lng, filter, todayDate }),
  ]);

  const dbTotal = dbVenues.length + dbEvents.length;
  console.log(`[concierge] DB: ${dbVenues.length} venues, ${dbEvents.length} events (${Date.now() - startTime}ms)`);

  // ─── STEP 2: If DB has enough results, return immediately ─────────────
  if (dbTotal >= MIN_DB_RESULTS) {
    console.log(`[concierge] DB-first hit: ${dbTotal} results, skipping Gemini`);
    return {
      venues: dbVenues,
      events: dbEvents,
      filter,
      source: 'db',
    };
  }

  // ─── STEP 3: DB sparse → call Gemini as fallback ──────────────────────
  console.log(`[concierge] DB sparse (${dbTotal} results), calling Gemini fallback`);

  const geminiResults = await geminiDiscoverAndPersist({
    lat, lng, filter, timezone, todayDate, dayOfWeek,
  });

  // Merge DB + Gemini results (DB results first, they're verified data)
  const mergedVenues = [...dbVenues, ...geminiResults.venues];
  const mergedEvents = [...dbEvents, ...geminiResults.events];

  const elapsed = Date.now() - startTime;
  console.log(`[concierge] Total: ${mergedVenues.length} venues, ${mergedEvents.length} events (${elapsed}ms)`);

  return {
    venues: mergedVenues,
    events: mergedEvents,
    filter,
    source: dbTotal > 0 ? 'db+gemini' : 'gemini',
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
export async function askConcierge({ question, lat, lng, timezone, venueContext, eventContext }) {
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return { ok: false, answer: 'Please ask a question.' };
  }

  // Safety: truncate very long questions
  const safeQuestion = question.trim().slice(0, 500);

  const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: timezone || 'UTC' });
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone || 'UTC' });
  const localTime = new Date().toLocaleTimeString('en-US', {
    timeZone: timezone || 'UTC',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // 2026-02-13: System prompt tells Gemini its identity, capabilities, and context
  const system = `You are the Vecto Pilot Concierge — a powerful AI assistant powered by Gemini 3 Pro.
You are helping a passenger in a rideshare discover the local area.

YOUR CAPABILITIES:
- You are Gemini 3 Pro Preview (NOT Flash) — a frontier multimodal AI model
- You have Google Search access for real-time, current information
- You have vision and OCR capabilities (can analyze images if provided)
- You can look up restaurants, bars, events, directions, safety info, transit, and anything local
- You have full knowledge of the venues and events already discovered for this passenger (listed below)

CURRENT CONTEXT:
- Date: ${dayOfWeek}, ${todayDate}
- Time: ${localTime} (${timezone || 'UTC'})
- Location: lat ${lat.toFixed(4)}, lng ${lng.toFixed(4)}

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

  const prompt = safeQuestion;

  try {
    console.log(`[concierge] Ask: "${safeQuestion.slice(0, 50)}..." near ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    const startTime = Date.now();

    const result = await callModel('CONCIERGE_CHAT', { system, user: prompt });

    const elapsed = Date.now() - startTime;
    console.log(`[concierge] Ask complete in ${elapsed}ms (${result.ok ? 'ok' : 'error'})`);

    if (!result.ok) {
      console.error('[concierge] Ask failed:', result.error);
      return { ok: false, answer: 'Sorry, I could not process your question right now. Please try again.' };
    }

    // Clean markdown code blocks if Gemini wraps the response
    let answer = (result.output || '').trim();
    if (answer.startsWith('```')) {
      answer = answer.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();
    }

    return { ok: true, answer };
  } catch (err) {
    console.error('[concierge] Ask error:', err.message);
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

    console.log(`[concierge] Feedback: ${rating}/5 for profile ${profile.id.slice(0, 8)}...${safeComment ? ' (with comment)' : ''}`);
    return { ok: true };
  } catch (err) {
    console.error('[concierge] Feedback error:', err.message);
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
    console.error('[concierge] Feedback summary error:', err.message);
    return { ok: true, avgRating: null, totalReviews: 0, recentComments: [] };
  }
}
