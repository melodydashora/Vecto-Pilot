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
// 2026-02-17: Shared timezone resolution — set timezone + market_slug on venue creation
import { resolveTimezoneFromMarket } from '../location/resolveTimezone.js';
// 2026-04-11: Address quality validation — catches bad Places API results before they persist
// 2026-04-27 (Commit 3 of CLEAR_CONSOLE_WORKFLOW spec): per-venue enrichment lines
// demoted from info to debug. Set LOG_VERBOSE_COMPONENTS=VENUES to see them again.
import { createWorkflowLogger } from '../../logger/workflow.js';
const venueCacheLog = createWorkflowLogger('VENUES');
import { validateVenueAddress } from './venue-address-validator.js';
// 2026-04-11: Places API re-resolution when cached address fails validation
import { searchPlaceWithTextSearch } from './venue-address-resolver.js';

// Re-export utils for backward compatibility
export { normalizeVenueName };

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
  // 2026-02-09: RELAXED - Search by State only, not City.
  // This fixes linking errors where "Dallas" venues aren't found when searching from "Frisco".
  // The normalized_name match is strong enough to prevent collisions within a state.
  const results = await db
    .select()
    .from(venue_catalog)
    .where(and(
      or(
        ilike(venue_catalog.normalized_name, `%${normalized}%`),
        sql`${normalized} LIKE '%' || ${venue_catalog.normalized_name} || '%'`
      ),
      // ilike(venue_catalog.city, city), // Removed to allow cross-city matches in same metro
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
 * @param {string} [venue.country] - Country code (ISO-2, default: 'US')
 * @param {string} [venue.district] - Explicit district name
 * @param {boolean} [venue.isBar] - 2026-01-14: Progressive enrichment - is_bar flag
 * @param {boolean} [venue.isEventVenue] - 2026-01-14: Progressive enrichment - is_event_venue flag
 * @param {string} [venue.recordStatus] - 2026-01-14: Progressive enrichment - record_status
 * @returns {Promise<Object>} Inserted venue record
 */
// 2026-01-10: AUDIT FIX - insertVenue now uses onConflictDoUpdate instead of DoNothing
// Previously: onConflictDoNothing().returning() returned undefined on conflict
// This caused callers to think venue didn't exist when it actually did
// See: docs/AUDIT_LEDGER.md - Breakpoint 3
export async function insertVenue(venue) {
  const normalized = normalizeVenueName(venue.venueName);
  const coordKey = generateCoordKey(venue.lat, venue.lng);

  // Determine venue_types array
  const venueTypes = venue.venueTypes ||
    (venue.venueType ? [venue.venueType] : ['venue']);

  // Auto-detect district if not provided (e.g., "Legacy Hall (Legacy West)" → "Legacy West")
  const district = venue.district || extractDistrictFromVenueName(venue.venueName);
  const districtSlug = district ? normalizeDistrictSlug(district) : null;

  // 2026-04-02: FIX - Defensive fallback for address to prevent NOT NULL violations.
  // Postgres rejects the INSERT (including ON CONFLICT path) if address is null.
  const resolvedAddress = venue.address || venue.formattedAddress
    || (venue.city && venue.state ? `${venue.city}, ${venue.state}` : 'Address pending');

  const insertValues = {
    venue_name: venue.venueName,
    normalized_name: normalized,
    address: resolvedAddress,
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
    updated_at: new Date(),
    // 2026-01-14: Progressive Enrichment fields
    is_bar: venue.isBar || false,
    is_event_venue: venue.isEventVenue || false,
    record_status: venue.recordStatus || 'stub',
    // 2026-02-17: Market linkage + timezone (from resolveTimezoneFromMarket)
    market_slug: venue.marketSlug || null,
    timezone: venue.timezone || null
  };

  // 2026-01-10: AUDIT FIX - Use onConflictDoUpdate to always return a record
  // Conflict on coord_key ensures we don't create duplicate venues at same location
  // 2026-04-23: FIX — venue_catalog has THREE unique constraints (venue_id PK, coord_key,
  // place_id). PostgreSQL only supports ONE ON CONFLICT target per INSERT. If Google Places
  // returns drifted coords for the same place_id (common for re-resolved venues), the
  // coord_key target doesn't match and the place_id constraint throws 23505. Wrap in
  // try/catch and fall back to a place_id lookup so promotion never raises a raw constraint
  // violation to callers.
  try {
    const [result] = await db
      .insert(venue_catalog)
      .values(insertValues)
      .onConflictDoUpdate({
        target: venue_catalog.coord_key,
        set: {
          // Update access stats and potentially missing fields on conflict
          access_count: sql`COALESCE(${venue_catalog.access_count}, 0) + 1`,
          last_accessed_at: new Date(),
          updated_at: new Date(),
          // Update place_id if we have one and existing doesn't (backfill)
          place_id: sql`COALESCE(${venue_catalog.place_id}, ${venue.placeId})`,
          // Update formatted_address if we have one and existing doesn't
          formatted_address: sql`COALESCE(${venue_catalog.formatted_address}, ${venue.formattedAddress})`
        }
      })
      .returning();

    return result;
  } catch (err) {
    // Drizzle wraps pg errors in .cause/.original; unwrap to find the real PG code
    const pgCode = err?.cause?.code || err?.original?.code || err?.code;
    const constraint = err?.cause?.constraint || err?.original?.constraint || err?.constraint;

    if (pgCode === '23505' && venue.placeId) {
      // Most likely: place_id unique constraint collided because coord drifted for the
      // same place. Return the existing venue (skip duplicate) and bump access stats.
      const [byPlaceId] = await db
        .select()
        .from(venue_catalog)
        .where(eq(venue_catalog.place_id, venue.placeId))
        .limit(1);

      if (byPlaceId) {
        console.warn(
          `[venue-cache] insertVenue 23505 on ${constraint || 'unique'} — falling back to existing venue ${byPlaceId.venue_id} (place_id=${venue.placeId.slice(0, 12)}…)`
        );
        await db
          .update(venue_catalog)
          .set({
            access_count: sql`COALESCE(${venue_catalog.access_count}, 0) + 1`,
            last_accessed_at: new Date()
          })
          .where(eq(venue_catalog.venue_id, byPlaceId.venue_id))
          .catch(() => {}); // non-blocking stats update
        return byPlaceId;
      }
    }
    throw err;
  }
}

/**
 * Upsert a venue - insert if new, update if exists.
 * Matches on coord_key or (normalized_name + city + state).
 *
 * 2026-01-14: Progressive Enrichment - "Best Write Wins" merge logic
 * - Boolean flags (is_bar, is_event_venue): OR logic - once true, stays true
 * - record_status: MAX logic - verified > enriched > stub
 *
 * @param {Object} venue - Same as insertVenue
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.isBar] - Set is_bar flag to true
 * @param {boolean} [options.isEventVenue] - Set is_event_venue flag to true
 * @param {string} [options.recordStatus] - Record status: 'stub', 'enriched', 'verified'
 * @returns {Promise<Object>} Upserted venue record
 */
export async function upsertVenue(venue, options = {}) {
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

    // 2026-01-14: Progressive Enrichment - "Best Write Wins" merge logic
    // Boolean flags: OR logic (once true, stays true)
    const finalIsBar = existing.is_bar || options.isBar || false;
    const finalIsEventVenue = existing.is_event_venue || options.isEventVenue || false;

    // Record status: MAX logic (verified > enriched > stub)
    const statusPriority = { 'stub': 0, 'enriched': 1, 'verified': 2 };
    const existingPriority = statusPriority[existing.record_status] || 0;
    const newPriority = statusPriority[options.recordStatus] || 0;
    const finalRecordStatus = newPriority > existingPriority
      ? options.recordStatus
      : existing.record_status || 'stub';

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
        // 2026-01-14: Progressive Enrichment fields
        is_bar: finalIsBar,
        is_event_venue: finalIsEventVenue,
        record_status: finalRecordStatus,
        updated_at: new Date(),
        access_count: sql`COALESCE(access_count, 0) + 1`,
        last_accessed_at: new Date()
      })
      .where(eq(venue_catalog.venue_id, existing.venue_id))
      .returning();

    return updated;
  }

  // Insert new venue with progressive enrichment fields
  return insertVenue({
    ...venue,
    isBar: options.isBar,
    isEventVenue: options.isEventVenue,
    recordStatus: options.recordStatus
  });
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
 * 2026-01-10: AUDIT FIX - Now uses place_id-first lookup strategy
 * Previously used fuzzy matching which created duplicate venues
 * See: docs/AUDIT_LEDGER.md - Breakpoint 4
 *
 * @param {Object} eventData - Event with venue information
 * @param {string} eventData.venue - Venue name
 * @param {string} eventData.address - Venue address
 * @param {number} eventData.latitude - Latitude
 * @param {number} eventData.longitude - Longitude
 * @param {string} eventData.city - City
 * @param {string} eventData.state - State
 * @param {string} [eventData.placeId] - Google Place ID (ChIJ...) from geocoding
 * @param {string} [eventData.formattedAddress] - Verified formatted address from geocoding
 * @param {string} source - Data source (e.g., 'sync_events_gpt52')
 * @returns {Promise<Object>} Venue record (existing or new)
 */
export async function findOrCreateVenue(eventData, source) {
  const {
    venue: venueName,
    address,
    latitude,
    longitude,
    city,
    state,
    placeId,          // 2026-01-10: AUDIT FIX - Accept place_id from geocoding
    formattedAddress  // 2026-01-10: AUDIT FIX - Accept formatted_address from geocoding
  } = eventData;

  if (!venueName || !city || !state) {
    return null;
  }

  // 2026-01-10: AUDIT FIX - place_id-first lookup strategy
  // Check by place_id first (most reliable), then coord_key, then fuzzy match
  // This follows the standard: "venue identification should be place_id-first"

  // Strategy 1: If we have a valid ChIJ place_id, check by that first
  if (placeId && placeId.startsWith('ChIJ')) {
    const byPlaceId = await lookupVenue({ placeId });
    if (byPlaceId) {
      // 2026-04-11: Validate cached address quality before returning
      const validated = await maybeReResolveAddress(byPlaceId, venueName, latitude, longitude, city, state);
      // 2026-02-26: Backfill missing data on existing venues (non-blocking)
      maybeBackfillVenue(validated || byPlaceId, placeId);
      return validated || byPlaceId;
    }
  }

  // Strategy 2: Check by coord_key (exact coordinate match)
  if (latitude && longitude) {
    const coordKey = generateCoordKey(latitude, longitude);
    const byCoords = await lookupVenue({ coordKey });
    if (byCoords) {
      // If we have a place_id and existing venue doesn't, update it
      if (placeId && !byCoords.place_id) {
        await db.update(venue_catalog)
          .set({
            place_id: placeId,
            formatted_address: formattedAddress || byCoords.formatted_address,
            updated_at: new Date()
          })
          .where(eq(venue_catalog.venue_id, byCoords.venue_id))
          .catch(() => {}); // Non-blocking update
      }
      // 2026-04-11: Validate cached address quality before returning
      const validated = await maybeReResolveAddress(byCoords, venueName, latitude, longitude, city, state);
      // 2026-02-26: Backfill missing data on existing venues (non-blocking)
      maybeBackfillVenue(validated || byCoords, placeId || byCoords.place_id);
      return validated || byCoords;
    }
  }

  // Strategy 3: Fall back to fuzzy matching (last resort)
  const existing = await lookupVenueFuzzy({
    venueName,
    city,
    state,
    lat: latitude,
    lng: longitude,
  });

  if (existing) {
    // If we have a place_id and existing venue doesn't, update it
    if (placeId && !existing.place_id) {
      await db.update(venue_catalog)
        .set({
          place_id: placeId,
          formatted_address: formattedAddress || existing.formatted_address,
          updated_at: new Date()
        })
        .where(eq(venue_catalog.venue_id, existing.venue_id))
        .catch(() => {}); // Non-blocking update
    }
    // 2026-04-11: Validate cached address quality before returning
    const validated = await maybeReResolveAddress(existing, venueName, latitude, longitude, city, state);
    // 2026-02-26: Backfill missing data on existing venues (non-blocking)
    maybeBackfillVenue(validated || existing, placeId || existing.place_id);
    return validated || existing;
  }

  // Only create if we have coordinates
  if (!latitude || !longitude) {
    return null;
  }

  // Create new venue with District Tagging
  const district = extractDistrictFromVenueName(venueName);

  // 2026-02-17: Resolve timezone + market_slug from market lookup
  // Non-blocking: venue creation succeeds even if timezone resolution fails
  let venueTimezone = null;
  let venueMarketSlug = null;
  try {
    const tzResult = await resolveTimezoneFromMarket(city, state);
    if (tzResult) {
      venueTimezone = tzResult.timezone;
      venueMarketSlug = tzResult.market_slug;
    }
  } catch (_err) {
    // Non-fatal — timezone is a nice-to-have, not required for venue creation
  }

  // 2026-01-10: AUDIT FIX - Include place_id and formatted_address in new venue
  // 2026-01-14: Progressive Enrichment - Set isEventVenue flag for event-discovered venues
  const created = await insertVenue({
    venueName,
    city,
    state,
    lat: latitude,
    lng: longitude,
    address: formattedAddress || address,  // Prefer verified formatted_address
    formattedAddress,
    placeId,  // Now properly passed to insertVenue
    source,
    venueTypes: ['event_host'],
    category: guessVenueType(venueName),
    district: district,
    // 2026-01-14: Progressive Enrichment - Mark as event venue
    isEventVenue: true,
    recordStatus: 'enriched', // Events have geocoded addresses but not full bar details
    // 2026-02-17: Market linkage + timezone
    timezone: venueTimezone,
    marketSlug: venueMarketSlug
  });

  // 2026-02-26: Non-blocking enrichment — fetch phone, hours, rating from Google Places API
  // Fire-and-forget: event processing continues immediately
  if (created && placeId) {
    enrichVenueFromPlaceId(created.venue_id, placeId).catch(err => {
      console.warn(`[venue-cache] Non-blocking enrichment failed for ${venueName}: ${err.message}`);
    });
  }

  // 2026-04-11: Validate newly created venue's address quality too
  if (created) {
    const validated = await maybeReResolveAddress(created, venueName, latitude, longitude, city, state);
    return validated || created;
  }

  return created;
}

/**
 * 2026-04-11: Validate a venue's address quality and re-resolve via Places API if it fails.
 * This prevents bad cached data (e.g., "Theatre, Frisco, TX 75034") from propagating.
 *
 * Only triggers a Places API call when validation FAILS — no extra cost for good addresses.
 *
 * @param {Object} venue - Venue record from venue_catalog
 * @param {string} venueName - Venue name for search
 * @param {number} lat - Latitude hint for Places API location bias
 * @param {number} lng - Longitude hint for Places API location bias
 * @param {string} city - City context
 * @param {string} state - State context
 * @returns {Promise<Object|null>} Updated venue record if re-resolved, null if address was valid
 */
async function maybeReResolveAddress(venue, venueName, lat, lng, city, state) {
  if (!venue) return null;

  const addrToCheck = venue.formatted_address || venue.address;
  const { valid, issues } = validateVenueAddress({
    formattedAddress: addrToCheck,
    venueName: venueName || venue.venue_name,
    lat: venue.lat,
    lng: venue.lng,
    city: venue.city
  });

  if (valid) return null; // Address is fine, no action needed

  // Address failed validation — attempt Places API re-resolution
  console.warn(`[VENUE-VALIDATE] Re-resolving "${venue.venue_name}" (${venue.venue_id?.slice(0, 8)}): ${issues.join('; ')}`);

  try {
    // Use venue's own coords if available, otherwise caller's coords
    const searchLat = venue.lat || lat;
    const searchLng = venue.lng || lng;
    const searchName = venueName || venue.venue_name;

    if (!searchLat || !searchLng || !searchName) return null;

    // 50km radius — metro-wide search to find the real venue
    const placeResult = await searchPlaceWithTextSearch(searchLat, searchLng, searchName, { radius: 50000 });

    if (!placeResult || !placeResult.formattedAddress) {
      console.warn(`[VENUE-VALIDATE] Re-resolution returned no result for "${searchName}"`);
      return null;
    }

    // Validate the NEW address too — don't replace bad with bad
    const recheck = validateVenueAddress({
      formattedAddress: placeResult.formattedAddress,
      venueName: searchName
    });

    if (!recheck.valid) {
      console.warn(`[VENUE-VALIDATE] Re-resolution also failed for "${searchName}": "${placeResult.formattedAddress}" — ${recheck.issues.join('; ')}`);
      return null;
    }

    // Good address — update venue_catalog
    // 2026-04-11: Round coords to 6 decimal places (~11cm precision) to match coord_key
    const fixedLat = placeResult.lat ? parseFloat(Number(placeResult.lat).toFixed(6)) : venue.lat;
    const fixedLng = placeResult.lng ? parseFloat(Number(placeResult.lng).toFixed(6)) : venue.lng;

    const [updated] = await db.update(venue_catalog)
      .set({
        formatted_address: placeResult.formattedAddress,
        address: placeResult.formattedAddress,
        address_1: placeResult.parsed?.address_1 || venue.address_1,
        city: placeResult.parsed?.city || venue.city,
        state: placeResult.parsed?.state || venue.state,
        zip: placeResult.parsed?.zip || venue.zip,
        lat: fixedLat,
        lng: fixedLng,
        coord_key: generateCoordKey(fixedLat, fixedLng) || venue.coord_key,
        place_id: placeResult.placeId || venue.place_id,
        updated_at: new Date()
      })
      .where(eq(venue_catalog.venue_id, venue.venue_id))
      .returning();

    if (updated) {
      venueCacheLog.debug(`Fixed "${venue.venue_name}" address: "${addrToCheck}" -> "${placeResult.formattedAddress}"`);
      return updated;
    }
  } catch (err) {
    // Non-fatal — return null so caller uses original venue
    console.warn(`[VENUE-VALIDATE] Re-resolution error for "${venue.venue_name}": ${err.message}`);
  }

  return null;
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
  // 2026-04-16: Added optional district + orderByExpense for P0-6 catalog fallback
  const { venueTypes, city, state, district, orderByExpense, limit = 50 } = options;

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

  // 2026-04-16: District filter — try exact match first, fall back to slug
  if (district) {
    const slug = normalizeDistrictSlug(district);
    conditions.push(or(
      ilike(venue_catalog.district, district),
      eq(venue_catalog.district_slug, slug)
    ));
  }

  const query = db
    .select()
    .from(venue_catalog)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  if (orderByExpense) {
    return query.orderBy(sql`expense_rank DESC NULLS LAST`).limit(limit);
  }

  return query.limit(limit);
}

// ─────────────────────────────────────────────────
// 2026-02-26: Venue Enrichment via Google Places API
// ─────────────────────────────────────────────────

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * 2026-02-26: Check if an existing venue needs enrichment and trigger it non-blockingly.
 * Enrichment is needed if the venue is missing phone, hours, or rating AND has a place_id.
 *
 * @param {Object} venue - Existing venue record from DB
 * @param {string|null} placeId - Google Place ID (ChIJ...)
 */
// 2026-04-04: Also trigger on missing hours data (was only checking phone+rating).
// Venues created via event discovery get place_id but no hours → shows "0 open".
function maybeBackfillVenue(venue, placeId) {
  if (!placeId || !placeId.startsWith('ChIJ')) return;
  if (!venue?.venue_id) return;

  // Check if enrichment is needed: missing phone, rating, OR hours
  const hasPhone = !!venue.phone_number;
  const hasRating = !!venue.google_rating;
  const hasHours = !!(venue.business_hours || venue.hours_full_week);

  if (hasPhone && hasRating && hasHours) return; // Fully enriched

  // Trigger non-blocking enrichment
  enrichVenueFromPlaceId(venue.venue_id, placeId).catch(err => {
    console.warn(`[venue-cache] Backfill failed for venue ${venue.venue_id}: ${err.message}`);
  });
}

/**
 * 2026-02-26: Enrich a venue with data from Google Places API using place_id.
 * Fetches: phone, rating, business hours, business status, venue types.
 * Updates the venue_catalog row directly.
 *
 * Uses Google Places (New) API: GET /v1/places/{placeId}
 * This is cheaper than searchNearby — single place lookup by known ID.
 *
 * @param {string} venueId - venue_catalog.venue_id to update
 * @param {string} placeId - Google Place ID (ChIJ...)
 */
// 2026-04-04: Exported for batch backfill in venue-intelligence.js cache path
export async function enrichVenueFromPlaceId(venueId, placeId) {
  if (!GOOGLE_MAPS_API_KEY || !placeId) return;

  const fieldMask = [
    'displayName',
    'nationalPhoneNumber',
    'regularOpeningHours',
    'rating',
    'priceLevel',
    'businessStatus',
    'types',
    'primaryType'
  ].join(',');

  const url = `https://places.googleapis.com/v1/places/${placeId}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': fieldMask
    }
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown');
    throw new Error(`Places API ${response.status}: ${errText.slice(0, 200)}`);
  }

  const place = await response.json();

  // Build update payload — only set fields that have data
  const updates = { updated_at: new Date() };

  if (place.nationalPhoneNumber) {
    updates.phone_number = place.nationalPhoneNumber;
  }

  if (place.rating) {
    updates.google_rating = String(place.rating);
  }

  // 2026-04-04: Store the FULL regularOpeningHours object (weekdayDescriptions + periods).
  // Previously stored weekdayDescriptions as joined string and periods separately.
  // Bug: re-hydration in venue-intelligence.js expected .weekdayDescriptions array on
  // business_hours, but got a plain string → hours parsing always returned null → "0 open".
  if (place.regularOpeningHours) {
    // Store as structured object with weekdayDescriptions array for parseGoogleWeekdayText()
    if (place.regularOpeningHours.weekdayDescriptions) {
      updates.business_hours = {
        weekdayDescriptions: place.regularOpeningHours.weekdayDescriptions
      };
    }
    if (place.regularOpeningHours.periods) {
      // Store full regularOpeningHours so re-hydration can access .weekdayDescriptions
      updates.hours_full_week = {
        weekdayDescriptions: place.regularOpeningHours.weekdayDescriptions || [],
        periods: place.regularOpeningHours.periods
      };
    }
  }

  if (place.businessStatus) {
    updates.last_known_status = place.businessStatus === 'OPERATIONAL' ? 'open' : 'closed';
  }

  if (place.types && Array.isArray(place.types)) {
    updates.venue_types = place.types;
  }

  // Mark as verified since we confirmed via Places API
  updates.record_status = 'verified';

  // Only update if we actually got useful data
  const hasUsefulData = updates.phone_number || updates.google_rating || updates.business_hours;
  if (!hasUsefulData) return;

  await db.update(venue_catalog)
    .set(updates)
    .where(eq(venue_catalog.venue_id, venueId));

  venueCacheLog.debug(`Enriched venue ${venueId} from Places API: phone=${!!updates.phone_number}, rating=${updates.google_rating || 'n/a'}, hours=${!!updates.business_hours}`);
}
