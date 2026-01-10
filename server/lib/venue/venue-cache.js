// server/lib/venue/venue-cache.js
//
// Venue cache operations: lookup, insert, update, and event linking
// Uses venue_catalog table (consolidated from venue_cache + nearby_venues)
//
// Updated 2026-01-05: Migrated to venue_catalog
// See: /home/runner/.claude/plans/noble-purring-yeti.md

import { db } from '../../db/drizzle.js';
import { venue_catalog, discovered_events } from '../../../shared/schema.js';
import { eq, and, or, sql, ilike } from 'drizzle-orm';
import {
  normalizeVenueName,
  generateCoordKey,
  mergeVenueTypes
} from './venue-utils.js';
import { extractDistrictFromVenueName, normalizeDistrictSlug } from './district-detection.js';

// Re-export utils for backward compatibility
export { normalizeVenueName, generateCoordKey };

/**
 * Look up a venue in the catalog.
 * Searches by: place_id (exact), normalized name + city/state, or coord_key.
 *
 * @param {Object} criteria - Lookup criteria
 * @param {string} [criteria.placeId] - Google Place ID (exact match)
 * @param {string} [criteria.venueName] - Venue name (will be normalized)
 * @param {string} [criteria.city] - City name
 * @param {string} [criteria.state] - State code
 * @param {number} [criteria.lat] - Latitude for coord lookup
 * @param {number} [criteria.lng] - Longitude for coord lookup
 * @param {string} [criteria.coordKey] - Pre-computed coord_key
 * @returns {Promise<Object|null>} Cached venue or null
 */
export async function lookupVenue(criteria) {
  const { placeId, venueName, city, state, lat, lng, coordKey } = criteria;

  // Strategy 1: Exact match on place_id (most reliable)
  if (placeId) {
    const [venue] = await db
      .select()
      .from(venue_catalog)
      .where(eq(venue_catalog.place_id, placeId))
      .limit(1);

    if (venue) {
      await updateAccessStats(venue.venue_id);
      return venue;
    }
  }

  // Strategy 2: Normalized name + city/state
  if (venueName && city && state) {
    const normalized = normalizeVenueName(venueName);
    const [venue] = await db
      .select()
      .from(venue_catalog)
      .where(and(
        eq(venue_catalog.normalized_name, normalized),
        ilike(venue_catalog.city, city),
        eq(venue_catalog.state, state.toUpperCase())
      ))
      .limit(1);

    if (venue) {
      await updateAccessStats(venue.venue_id);
      return venue;
    }
  }

  // Strategy 3: Coordinate proximity (6 decimal precision = ~11cm)
  const coordKeyToUse = coordKey || (lat && lng ? generateCoordKey(lat, lng) : null);
  if (coordKeyToUse) {
    const [venue] = await db
      .select()
      .from(venue_catalog)
      .where(eq(venue_catalog.coord_key, coordKeyToUse))
      .limit(1);

    if (venue) {
      await updateAccessStats(venue.venue_id);
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
  if (!normalized) return null;

  // Fuzzy: look for venues where name contains the search term or vice versa
  const results = await db
    .select()
    .from(venue_catalog)
    .where(and(
      or(
        ilike(venue_catalog.normalized_name, `%${normalized}%`),
        sql`${normalized} LIKE '%' || ${venue_catalog.normalized_name} || '%'`
      ),
      ilike(venue_catalog.city, city),
      eq(venue_catalog.state, state.toUpperCase())
    ))
    .limit(5);

  if (results.length === 1) {
    await updateAccessStats(results[0].venue_id);
    return results[0];
  }

  // If multiple matches, prefer the one with place_id (more reliable)
  const withPlaceId = results.find(v => v.place_id);
  if (withPlaceId) {
    await updateAccessStats(withPlaceId.venue_id);
    return withPlaceId;
  }

  return results[0] || null;
}

/**
 * Insert a new venue into the catalog.
 *
 * @param {Object} venue - Venue data
 * @param {string} venue.venueName - Raw venue name
 * @param {string} venue.city - City
 * @param {string} venue.state - State code
 * @param {number} venue.lat - Latitude (full precision)
 * @param {number} venue.lng - Longitude (full precision)
 * @param {string} venue.source - Where data came from
 * @param {string} [venue.address] - Street address
 * @param {string} [venue.formattedAddress] - Full formatted address
 * @param {string} [venue.zip] - ZIP code
 * @param {string} [venue.placeId] - Google Place ID
 * @param {Object} [venue.hours] - Opening hours (business_hours format)
 * @param {Object} [venue.hoursFullWeek] - Full week hours for bar markers
 * @param {string} [venue.hoursSource] - Where hours came from
 * @param {string} [venue.venueType] - Type (stadium, arena, bar, restaurant, etc.)
 * @param {string[]} [venue.venueTypes] - Multiple types ['bar', 'event_host']
 * @param {number} [venue.capacityEstimate] - Estimated capacity
 * @param {string} [venue.sourceModel] - AI model if from LLM
 * @param {number} [venue.expenseRank] - 1-4 expense ranking
 * @param {string} [venue.category] - Category for venue_catalog
 * @param {string} [venue.country] - Country code (default: USA)
 * @param {string} [venue.district] - Explicit district name
 * @returns {Promise<Object>} Inserted venue record
 */
export async function insertVenue(venue) {
  const normalized = normalizeVenueName(venue.venueName);
  const coordKey = generateCoordKey(venue.lat, venue.lng);

  // Determine venue_types array
  const venueTypes = venue.venueTypes ||
    (venue.venueType ? [venue.venueType] : ['venue']);

  // Auto-detect district if not provided (e.g., "Legacy Hall (Legacy West)" → "Legacy West")
  const district = venue.district || extractDistrictFromVenueName(venue.venueName);
  const districtSlug = district ? normalizeDistrictSlug(district) : null;

  const [inserted] = await db
    .insert(venue_catalog)
    .values({
      venue_name: venue.venueName,
      normalized_name: normalized,
      address: venue.address || venue.formattedAddress,
      city: venue.city,
      state: venue.state?.toUpperCase(),
      zip: venue.zip,
      // 2026-01-10: D-004 Fix - Use ISO-3166-1 alpha-2 code
      country: venue.country || 'US',
      lat: venue.lat,
      lng: venue.lng,
      coord_key: coordKey,
      formatted_address: venue.formattedAddress,
      place_id: venue.placeId,
      business_hours: venue.hours,
      hours_full_week: venue.hoursFullWeek,
      hours_source: venue.hoursSource,
      venue_types: venueTypes,
      category: venue.category || venue.venueType || 'venue',
      capacity_estimate: venue.capacityEstimate,
      source: venue.source,
      source_model: venue.sourceModel,
      expense_rank: venue.expenseRank,
      discovery_source: venue.source,
      district: district,
      district_slug: districtSlug,
      access_count: 1,
      last_accessed_at: new Date(),
      updated_at: new Date()
    })
    .onConflictDoNothing()
    .returning();

  return inserted;
}

/**
 * Upsert a venue - insert if new, update if exists.
 * Matches on coord_key or (normalized_name + city + state).
 *
 * @param {Object} venue - Same as insertVenue
 * @returns {Promise<Object>} Upserted venue record
 */
export async function upsertVenue(venue) {
  const normalized = normalizeVenueName(venue.venueName);
  const coordKey = generateCoordKey(venue.lat, venue.lng);

  // Check if venue exists
  const existing = await lookupVenue({
    venueName: venue.venueName,
    city: venue.city,
    state: venue.state,
    lat: venue.lat,
    lng: venue.lng,
    coordKey
  });

  if (existing) {
    // Merge venue_types
    const mergedTypes = mergeVenueTypes(
      existing.venue_types,
      venue.venueTypes || (venue.venueType ? [venue.venueType] : [])
    );

    // District logic: Use new if available, fallback to existing, fallback to extraction
    const newDistrict = venue.district || extractDistrictFromVenueName(venue.venueName);
    const finalDistrict = newDistrict || existing.district;
    const finalDistrictSlug = finalDistrict ? normalizeDistrictSlug(finalDistrict) : existing.district_slug;

    const [updated] = await db
      .update(venue_catalog)
      .set({
        lat: venue.lat,
        lng: venue.lng,
        coord_key: coordKey || existing.coord_key,
        address: venue.address || existing.address,
        formatted_address: venue.formattedAddress || existing.formatted_address,
        place_id: venue.placeId || existing.place_id,
        business_hours: venue.hours || existing.business_hours,
        hours_full_week: venue.hoursFullWeek || existing.hours_full_week,
        hours_source: venue.hoursSource || existing.hours_source,
        venue_types: mergedTypes,
        capacity_estimate: venue.capacityEstimate || existing.capacity_estimate,
        expense_rank: venue.expenseRank || existing.expense_rank,
        district: finalDistrict,
        district_slug: finalDistrictSlug,
        updated_at: new Date(),
        access_count: sql`COALESCE(access_count, 0) + 1`,
        last_accessed_at: new Date()
      })
      .where(eq(venue_catalog.venue_id, existing.venue_id))
      .returning();

    return updated;
  }

  // Insert new venue
  return insertVenue(venue);
}

/**
 * Update access statistics for a venue (called on cache hit).
 * @param {string} venueId - Venue UUID
 */
async function updateAccessStats(venueId) {
  try {
    await db
      .update(venue_catalog)
      .set({
        access_count: sql`COALESCE(access_count, 0) + 1`,
        last_accessed_at: new Date()
      })
      .where(eq(venue_catalog.venue_id, venueId));
  } catch (err) {
    // Non-blocking - don't fail lookups for stats updates
  }
}

/**
 * Link a discovered event to a venue in venue_catalog.
 *
 * @param {string} eventId - Event UUID
 * @param {string} venueId - Venue UUID (venue_catalog.venue_id)
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
 * @param {string} venueId - Venue UUID (venue_catalog.venue_id)
 * @param {Object} [options] - Query options
 * @param {string} [options.fromDate] - Filter events from this date (YYYY-MM-DD)
 * @param {string} [options.toDate] - Filter events to this date (YYYY-MM-DD)
 * @returns {Promise<Array>} Events at this venue
 */
export async function getEventsForVenue(venueId, options = {}) {
  const { fromDate, toDate } = options;

  let conditions = [eq(discovered_events.venue_id, venueId)];

  // 2026-01-10: Use symmetric field name (event_start_date)
  if (fromDate) {
    conditions.push(sql`${discovered_events.event_start_date} >= ${fromDate}`);
  }

  if (toDate) {
    conditions.push(sql`${discovered_events.event_start_date} <= ${toDate}`);
  }

  return db
    .select()
    .from(discovered_events)
    .where(and(...conditions));
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

  // Create new venue with District Tagging
  const district = extractDistrictFromVenueName(venueName);

  const created = await insertVenue({
    venueName,
    city,
    state,
    lat: latitude,
    lng: longitude,
    address,
    source,
    venueTypes: ['event_host'],
    category: guessVenueType(venueName),
    district: district  // Explicitly pass extracted district
  });

  return created;
}

/**
 * Guess venue type from name.
 * @param {string} name - Venue name
 * @returns {string} Venue type guess
 */
function guessVenueType(name) {
  if (!name) return 'venue';
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

/**
 * Get venues by type (for Bar Tab, nearby venues, etc.)
 *
 * @param {Object} options - Query options
 * @param {string[]} options.venueTypes - Types to filter by (['bar', 'restaurant'])
 * @param {string} [options.city] - Filter by city
 * @param {string} [options.state] - Filter by state
 * @param {number} [options.limit] - Max results (default 50)
 * @returns {Promise<Array>} Matching venues
 */
export async function getVenuesByType(options) {
  const { venueTypes, city, state, limit = 50 } = options;

  let conditions = [];

  if (venueTypes && venueTypes.length > 0) {
    // JSONB contains any of the specified types
    conditions.push(sql`venue_types ?| array[${sql.join(venueTypes.map(t => sql`${t}`), sql`, `)}]`);
  }

  if (city) {
    conditions.push(ilike(venue_catalog.city, city));
  }

  if (state) {
    conditions.push(eq(venue_catalog.state, state.toUpperCase()));
  }

  return db
    .select()
    .from(venue_catalog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(limit);
}
