// server/lib/venue/venue-cache.js
// Venue cache operations: lookup, insert, update, and event linking
// Uses venue_cache table for precise coordinates and deduplication

import { db } from '../../db/drizzle.js';
import { venue_cache, discovered_events } from '../../../shared/schema.js';
import { eq, and, or, sql, ilike } from 'drizzle-orm';

/**
 * Normalize a venue name for consistent matching.
 * Removes common prefixes/suffixes, lowercases, strips punctuation.
 *
 * Examples:
 *   "The Rustic" → "rustic"
 *   "AT&T Stadium" → "att stadium"
 *   "Toyota Center - Houston" → "toyota center houston"
 *   "American Airlines Center (AAC)" → "american airlines center aac"
 *
 * @param {string} name - Raw venue name
 * @returns {string} Normalized name for matching
 */
export function normalizeVenueName(name) {
  if (!name) return '';

  return name
    .toLowerCase()
    .replace(/^the\s+/i, '')           // Remove leading "The"
    .replace(/&/g, ' and ')            // AT&T → AT and T → att
    .replace(/[^\w\s]/g, '')           // Remove punctuation
    .replace(/\s+/g, ' ')              // Collapse whitespace
    .trim();
}

/**
 * Generate a coord_key from lat/lng for approximate location matching.
 * Uses 4 decimal places (~11 meter precision).
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {string} Coordinate key like "32.7473,-97.0945"
 */
export function generateCoordKey(lat, lng) {
  if (!lat || !lng) return null;
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/**
 * Look up a venue in the cache.
 * Searches by: place_id (exact), normalized name + city/state, or coord_key.
 *
 * @param {Object} criteria - Lookup criteria
 * @param {string} [criteria.placeId] - Google Place ID (exact match)
 * @param {string} [criteria.venueName] - Venue name (will be normalized)
 * @param {string} [criteria.city] - City name
 * @param {string} [criteria.state] - State code
 * @param {number} [criteria.lat] - Latitude for coord lookup
 * @param {number} [criteria.lng] - Longitude for coord lookup
 * @returns {Promise<Object|null>} Cached venue or null
 */
export async function lookupVenue(criteria) {
  const { placeId, venueName, city, state, lat, lng } = criteria;

  // Strategy 1: Exact match on place_id (most reliable)
  if (placeId) {
    const [venue] = await db
      .select()
      .from(venue_cache)
      .where(eq(venue_cache.place_id, placeId))
      .limit(1);

    if (venue) {
      // Update access stats
      await updateAccessStats(venue.id);
      return venue;
    }
  }

  // Strategy 2: Normalized name + city/state
  if (venueName && city && state) {
    const normalized = normalizeVenueName(venueName);
    const [venue] = await db
      .select()
      .from(venue_cache)
      .where(and(
        eq(venue_cache.normalized_name, normalized),
        ilike(venue_cache.city, city),
        eq(venue_cache.state, state.toUpperCase())
      ))
      .limit(1);

    if (venue) {
      await updateAccessStats(venue.id);
      return venue;
    }
  }

  // Strategy 3: Coordinate proximity (within ~11 meters via coord_key)
  if (lat && lng) {
    const coordKey = generateCoordKey(lat, lng);
    const [venue] = await db
      .select()
      .from(venue_cache)
      .where(eq(venue_cache.coord_key, coordKey))
      .limit(1);

    if (venue) {
      await updateAccessStats(venue.id);
      return venue;
    }
  }

  return null;
}

/**
 * Look up venue with fuzzy name matching (for LLM-generated event names).
 * Uses LIKE for partial matching when exact normalized match fails.
 *
 * @param {Object} criteria - Same as lookupVenue
 * @returns {Promise<Object|null>} Best matching venue or null
 */
export async function lookupVenueFuzzy(criteria) {
  // First try exact match
  const exact = await lookupVenue(criteria);
  if (exact) return exact;

  const { venueName, city, state } = criteria;
  if (!venueName || !city || !state) return null;

  const normalized = normalizeVenueName(venueName);

  // Fuzzy: look for venues where name contains the search term or vice versa
  const results = await db
    .select()
    .from(venue_cache)
    .where(and(
      or(
        ilike(venue_cache.normalized_name, `%${normalized}%`),
        sql`${normalized} LIKE '%' || ${venue_cache.normalized_name} || '%'`
      ),
      ilike(venue_cache.city, city),
      eq(venue_cache.state, state.toUpperCase())
    ))
    .limit(5);

  if (results.length === 1) {
    await updateAccessStats(results[0].id);
    return results[0];
  }

  // If multiple matches, prefer the one with place_id (more reliable)
  const withPlaceId = results.find(v => v.place_id);
  if (withPlaceId) {
    await updateAccessStats(withPlaceId.id);
    return withPlaceId;
  }

  return results[0] || null;
}

/**
 * Insert a new venue into the cache.
 *
 * @param {Object} venue - Venue data
 * @param {string} venue.venueName - Raw venue name
 * @param {string} venue.city - City
 * @param {string} venue.state - State code
 * @param {number} venue.lat - Latitude (full precision)
 * @param {number} venue.lng - Longitude (full precision)
 * @param {string} venue.source - Where data came from (e.g., 'google_places', 'llm_discovery')
 * @param {string} [venue.address] - Street address
 * @param {string} [venue.formattedAddress] - Full formatted address
 * @param {string} [venue.zip] - ZIP code
 * @param {string} [venue.placeId] - Google Place ID
 * @param {Object} [venue.hours] - Opening hours
 * @param {string} [venue.hoursSource] - Where hours came from
 * @param {string} [venue.venueType] - Type (stadium, arena, bar, restaurant, etc.)
 * @param {number} [venue.capacityEstimate] - Estimated capacity
 * @param {string} [venue.sourceModel] - AI model if from LLM
 * @param {string} [venue.country] - Country code (default: USA)
 * @returns {Promise<Object>} Inserted venue record
 */
export async function insertVenue(venue) {
  const normalized = normalizeVenueName(venue.venueName);
  const coordKey = generateCoordKey(venue.lat, venue.lng);

  const [inserted] = await db
    .insert(venue_cache)
    .values({
      venue_name: venue.venueName,
      normalized_name: normalized,
      city: venue.city,
      state: venue.state.toUpperCase(),
      country: venue.country || 'USA',
      lat: venue.lat,
      lng: venue.lng,
      coord_key: coordKey,
      address: venue.address,
      formatted_address: venue.formattedAddress,
      zip: venue.zip,
      place_id: venue.placeId,
      hours: venue.hours,
      hours_source: venue.hoursSource,
      venue_type: venue.venueType,
      capacity_estimate: venue.capacityEstimate,
      source: venue.source,
      source_model: venue.sourceModel,
    })
    .onConflictDoNothing()
    .returning();

  return inserted;
}

/**
 * Upsert a venue - insert if new, update if exists.
 * Matches on (normalized_name, city, state) or place_id.
 *
 * @param {Object} venue - Same as insertVenue
 * @returns {Promise<Object>} Upserted venue record
 */
export async function upsertVenue(venue) {
  const normalized = normalizeVenueName(venue.venueName);
  const coordKey = generateCoordKey(venue.lat, venue.lng);

  const [upserted] = await db
    .insert(venue_cache)
    .values({
      venue_name: venue.venueName,
      normalized_name: normalized,
      city: venue.city,
      state: venue.state.toUpperCase(),
      country: venue.country || 'USA',
      lat: venue.lat,
      lng: venue.lng,
      coord_key: coordKey,
      address: venue.address,
      formatted_address: venue.formattedAddress,
      zip: venue.zip,
      place_id: venue.placeId,
      hours: venue.hours,
      hours_source: venue.hoursSource,
      venue_type: venue.venueType,
      capacity_estimate: venue.capacityEstimate,
      source: venue.source,
      source_model: venue.sourceModel,
    })
    .onConflictDoUpdate({
      target: [venue_cache.normalized_name, venue_cache.city, venue_cache.state],
      set: {
        // Update with new data if more complete
        lat: venue.lat,
        lng: venue.lng,
        coord_key: coordKey,
        address: venue.address || sql`COALESCE(${venue_cache.address}, NULL)`,
        formatted_address: venue.formattedAddress || sql`COALESCE(${venue_cache.formatted_address}, NULL)`,
        place_id: venue.placeId || sql`COALESCE(${venue_cache.place_id}, NULL)`,
        hours: venue.hours || sql`COALESCE(${venue_cache.hours}, NULL)`,
        hours_source: venue.hoursSource || sql`COALESCE(${venue_cache.hours_source}, NULL)`,
        venue_type: venue.venueType || sql`COALESCE(${venue_cache.venue_type}, NULL)`,
        capacity_estimate: venue.capacityEstimate || sql`COALESCE(${venue_cache.capacity_estimate}, NULL)`,
        updated_at: sql`NOW()`,
      }
    })
    .returning();

  return upserted;
}

/**
 * Update access statistics for a venue (called on cache hit).
 * @param {string} venueId - Venue UUID
 */
async function updateAccessStats(venueId) {
  await db
    .update(venue_cache)
    .set({
      access_count: sql`${venue_cache.access_count} + 1`,
      last_accessed_at: sql`NOW()`,
    })
    .where(eq(venue_cache.id, venueId));
}

/**
 * Link a discovered event to a cached venue.
 *
 * @param {string} eventId - Event UUID
 * @param {string} venueId - Venue UUID
 * @returns {Promise<Object>} Updated event record
 */
export async function linkEventToVenue(eventId, venueId) {
  const [updated] = await db
    .update(discovered_events)
    .set({ venue_id: venueId })
    .where(eq(discovered_events.id, eventId))
    .returning();

  return updated;
}

/**
 * Get all events linked to a specific venue.
 * Useful for SmartBlocks "event tonight" flagging.
 *
 * @param {string} venueId - Venue UUID
 * @param {Object} [options] - Query options
 * @param {string} [options.fromDate] - Filter events from this date (YYYY-MM-DD)
 * @param {string} [options.toDate] - Filter events to this date (YYYY-MM-DD)
 * @returns {Promise<Array>} Events at this venue
 */
export async function getEventsForVenue(venueId, options = {}) {
  const { fromDate, toDate } = options;

  let query = db
    .select()
    .from(discovered_events)
    .where(eq(discovered_events.venue_id, venueId));

  if (fromDate) {
    query = query.where(sql`${discovered_events.event_date} >= ${fromDate}`);
  }

  if (toDate) {
    query = query.where(sql`${discovered_events.event_date} <= ${toDate}`);
  }

  return query;
}

/**
 * Find or create a venue for an event.
 * Used during event discovery to ensure venues are cached.
 *
 * @param {Object} eventData - Event with venue information
 * @param {string} eventData.venue - Venue name
 * @param {string} eventData.address - Venue address
 * @param {number} eventData.latitude - Latitude
 * @param {number} eventData.longitude - Longitude
 * @param {string} eventData.city - City
 * @param {string} eventData.state - State
 * @param {string} source - Data source (e.g., 'sync_events_gpt52')
 * @returns {Promise<Object>} Venue record (existing or new)
 */
export async function findOrCreateVenue(eventData, source) {
  const { venue: venueName, address, latitude, longitude, city, state } = eventData;

  if (!venueName || !city || !state) {
    return null;
  }

  // First, try to find existing venue
  const existing = await lookupVenueFuzzy({
    venueName,
    city,
    state,
    lat: latitude,
    lng: longitude,
  });

  if (existing) {
    return existing;
  }

  // Only create if we have coordinates
  if (!latitude || !longitude) {
    return null;
  }

  // Create new venue
  const created = await insertVenue({
    venueName,
    city,
    state,
    lat: latitude,
    lng: longitude,
    address,
    source,
    venueType: guessVenueType(venueName),
  });

  return created;
}

/**
 * Guess venue type from name.
 * @param {string} name - Venue name
 * @returns {string} Venue type guess
 */
function guessVenueType(name) {
  const lower = name.toLowerCase();

  if (/stadium/.test(lower)) return 'stadium';
  if (/arena|center|centre/.test(lower)) return 'arena';
  if (/theater|theatre|amphitheatre|amphitheater/.test(lower)) return 'theater';
  if (/convention|expo|fairground/.test(lower)) return 'convention_center';
  if (/university|college|campus/.test(lower)) return 'university';
  if (/bar|pub|tavern|lounge/.test(lower)) return 'bar';
  if (/restaurant|grill|steakhouse|kitchen/.test(lower)) return 'restaurant';
  if (/hotel|resort/.test(lower)) return 'hotel';
  if (/park|garden/.test(lower)) return 'park';
  if (/club|nightclub/.test(lower)) return 'club';

  return 'venue'; // Generic fallback
}
