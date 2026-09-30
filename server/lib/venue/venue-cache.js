// server/lib/venue/venue-cache.js
//
// Venue cache operations: lookup, insert, update, and event linking
// Uses venue_catalog table (consolidated from venue_cache + nearby_venues)
//
// Updated 2026-01-05: Migrated to venue_catalog
// See: /home/runner/.claude/plans/noble-purring-yeti.md

import { db } from '../../db/drizzle.js';
import { venue_catalog, discovered_events } from '../../../shared/schema.js';
import { eq, and, or, sql, isNull, ilike } from 'drizzle-orm';
import {
  normalizeVenueName,
  generateCoordKey
} from './venue-utils.js';
import { extractDistrictFromVenueName, normalizeDistrictSlug } from './district-detection.js';
// 2026-02-17: Shared timezone resolution — set timezone + market_slug on venue creation
import { resolveTimezoneFromMarket, resolveTimezoneFromCoords } from '../location/resolveTimezone.js';
// 2026-04-11: Address quality validation — catches bad Places (NEW) API results before they persist
// 2026-04-27 (Commit 3 of CLEAR_CONSOLE_WORKFLOW spec): per-venue enrichment lines
// demoted from info to debug. Set LOG_VERBOSE_COMPONENTS=VENUES to see them again.
import { createWorkflowLogger } from '../../logger/workflow.js';
const venueCacheLog = createWorkflowLogger('VENUES');
import { validateVenueAddress } from './venue-address-validator.js';
import { normalizeCoordinates } from '../../../shared/coordinates.js';
// 2026-04-11: Places (NEW) API re-resolution when cached address fails validation
import { searchPlaceWithTextSearch } from './venue-address-resolver.js';

// Re-export utils for backward compatibility
export { normalizeVenueName };

const countryCode = value => typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim()) ? value.trim().toUpperCase() : null;
const validTimezone = value => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return value; } catch { return null; }
};
const pendingIdentityRepairs = new Map();
const identityRepairRetries = new Map();
const IDENTITY_REPAIR_RETRY_MS = 5 * 60 * 1000;
const IDENTITY_REPAIR_RETRY_LIMIT = 1000;

/** Repair missing catalog facts from their own authorities, never caller hints. */
export function repairVenueIdentity(venue) {
  if (!venue?.venue_id || (countryCode(venue.country) && validTimezone(venue.timezone))) return Promise.resolve(venue);
  const key = JSON.stringify([venue.venue_id, venue.place_id, venue.lat, venue.lng]);
  if (pendingIdentityRepairs.has(key)) return pendingIdentityRepairs.get(key);
  const now = Date.now();
  for (const [entry, retryAt] of identityRepairRetries) if (retryAt <= now) identityRepairRetries.delete(entry);
  if (identityRepairRetries.has(key)) return Promise.resolve(venue);
  const pending = refreshVenueIdentity(venue).catch(err => {
    venueCacheLog.warn(3, `[VENUE_IDENTITY_REPAIR] catalog repair failed for ${venue.venue_id}: ${err.message}`);
    return venue;
  }).then(result => {
    if (!countryCode(result?.country) || !validTimezone(result?.timezone)) {
      identityRepairRetries.set(key, Date.now() + IDENTITY_REPAIR_RETRY_MS);
      // Failed repairs are a bounded retry receipt, never a saved venue cache.
      while (identityRepairRetries.size > IDENTITY_REPAIR_RETRY_LIMIT) identityRepairRetries.delete(identityRepairRetries.keys().next().value);
    }
    return result;
  }).finally(() => {
    if (pendingIdentityRepairs.get(key) === pending) pendingIdentityRepairs.delete(key);
  });
  pendingIdentityRepairs.set(key, pending);
  return pending;
}

async function refreshVenueIdentity(venue) {
  const needsCountry = !countryCode(venue.country), needsTimezone = !validTimezone(venue.timezone);
  const requests = [];
  if (needsCountry) requests.push(['country', (async () => {
    if (typeof venue.place_id !== 'string' || !venue.place_id.trim()) throw new Error('country has no provider identity');
    if (!GOOGLE_MAPS_API_KEY) throw new Error('country provider is not configured');
    const place = await requestCatalogDetails(venue.place_id, 'id,addressComponents');
    if (place?.id !== venue.place_id) throw new Error('country provider returned a different identity');
    const component = place.addressComponents?.find(part => part.types?.includes('country'));
    const country = countryCode(component?.shortText);
    if (!country) throw new Error('country provider returned no ISO-2 country code');
    return country;
  })()]);
  if (needsTimezone) requests.push(['timezone', (async () => {
    const point = normalizeCoordinates(venue.lat, venue.lng);
    if (!point) throw new Error('timezone has no usable stored coordinates');
    return requestVenueTimezone(point.lat, point.lng);
  })()]);
  const outcomes = await Promise.allSettled(requests.map(([, request]) => request));
  const updates = {};
  outcomes.forEach((outcome, index) => {
    const field = requests[index][0];
    if (outcome.status === 'fulfilled') {
      // CAS each field independently so a concurrent repair of either fact wins.
      updates[field] = sql`CASE WHEN ${venue_catalog[field]} IS NOT DISTINCT FROM ${venue[field] ?? null}
        THEN ${outcome.value} ELSE ${venue_catalog[field]} END`;
    } else {
      venueCacheLog.warn(3, `[VENUE_IDENTITY_REPAIR] ${field} repair failed for ${venue.venue_id}: ${outcome.reason?.message || outcome.reason}`);
    }
  });
  const identity = and(eq(venue_catalog.venue_id, venue.venue_id),
    sql`${venue_catalog.place_id} IS NOT DISTINCT FROM ${venue.place_id ?? null}`);
  if (Object.keys(updates).length) {
    const [updated] = await db.update(venue_catalog).set({ ...updates, updated_at: new Date() }).where(and(identity,
      sql`${venue_catalog.lat} IS NOT DISTINCT FROM ${venue.lat ?? null}`,
      sql`${venue_catalog.lng} IS NOT DISTINCT FROM ${venue.lng ?? null}`)).returning();
    if (updated) {
      venueCacheLog.info(3, `[VENUE_IDENTITY_REPAIR] reconciled catalog identity facts for ${venue.venue_id}`);
      return updated;
    }
  }
  // Return the current row after a race, but never another provider identity.
  const [current] = await db.select().from(venue_catalog).where(identity).limit(1);
  return current || venue;
}

async function requestVenueTimezone(lat, lng) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = Object.assign(new Error('venue timezone lookup timed out'), { code: 'upstream_timeout' });
      controller.abort(error); reject(error);
    }, CATALOG_DETAILS_TIMEOUT_MS);
  });
  try {
    const timezone = await Promise.race([resolveTimezoneFromCoords(lat, lng, { signal: controller.signal }), deadline]);
    if (!validTimezone(timezone)) throw new Error('timezone provider returned no valid IANA timezone');
    return timezone;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 2026-04-28 (Step 4, spec §5.3): Planner-grade venue completeness predicate.
 *
 * A venue is "planner-grade" only when it carries the full identity needed for
 * the planner / matcher / map: place_id (Google identity), formatted_address,
 * city, state, lat, lng, and timezone. Anything missing means the planner
 * input would degrade silently (e.g., haversine distance becomes Infinity for
 * null coords, the matcher loses its primary key without place_id, the map
 * cannot pin without lat/lng).
 *
 * This is a pure predicate — does not mutate, does not call APIs, does not
 * decide whether to drop or re-resolve. Callers use the result to classify
 * into planner-ready / re-resolve-needed / orphan buckets and log telemetry
 * before downstream filtering.
 *
 * @param {Object|null|undefined} venue - Venue-shaped object with the seven required fields
 * @returns {{ ok: boolean, missing: string[] }} Predicate result + missing field names
 */
export function isPlannerGradeVenue(venue) {
  if (!venue) return { ok: false, missing: ['venue (null)'] };
  const required = ['place_id', 'formatted_address', 'city', 'state', 'lat', 'lng', 'timezone'];
  const missing = required.filter(f => venue[f] == null || venue[f] === '');
  return { ok: missing.length === 0, missing };
}

/**
 * Look up a venue in the catalog.
 * An explicit place_id is exact; otherwise combine known hints and require one match.
 *
 * @param {Object} criteria - Lookup criteria
 * @param {string} [criteria.placeId] - Google Place ID (exact match)
 * @param {string} [criteria.venueName] - Venue name (will be normalized)
 * @param {string} [criteria.city] - City name
 * @param {string} [criteria.state] - State code
 * @param {number} [criteria.lat] - Latitude for coord lookup
 * @param {number} [criteria.lng] - Longitude for coord lookup
 * @param {string} [criteria.coordKey] - Pre-computed coord_key
 * @param {string} [criteria.country] - Known provider country (ISO-2)
 * @returns {Promise<Object|null>} Cached venue or null
 */
// A coordinate is a search hint, never a unique establishment identity. Combine
// every supplied hint and require exactly one candidate; never drop a failed name
// match and silently select its neighbor. Country stays unknown when not supplied.
function venueLookupConditions(criteria) {
  const conditions = [];
  const coordKey = criteria.coordKey || generateCoordKey(criteria.lat, criteria.lng);
  const name = normalizeVenueName(criteria.venueName);
  if (name) conditions.push(eq(venue_catalog.normalized_name, name));
  if (coordKey) conditions.push(eq(venue_catalog.coord_key, coordKey));
  if (criteria.city) conditions.push(sql`lower(${venue_catalog.city}) = ${criteria.city.trim().toLowerCase()}`);
  if (criteria.state) conditions.push(eq(venue_catalog.state, criteria.state.trim().toUpperCase()));
  const country = countryCode(criteria.country);
  if (criteria.country != null && !country) return null;
  if (country) conditions.push(eq(venue_catalog.country, country));
  // A locality alone is not a venue identity.
  return name || coordKey ? conditions : null;
}

export async function lookupVenue(criteria) {
  const conditions = criteria.placeId
    ? [eq(venue_catalog.place_id, criteria.placeId)]
    : venueLookupConditions(criteria);
  if (!conditions) return null;
  const results = await db.select().from(venue_catalog).where(and(...conditions)).limit(2);
  if (results.length !== 1) return null;
  await updateAccessStats(results[0].venue_id);
  return results[0];
}

/** Find a single fuzzy-name candidate within the supplied locality/point. */
export async function lookupVenueFuzzy(criteria) {
  const exact = await lookupVenue(criteria);
  if (exact || criteria.placeId) return exact;
  const { venueName, city, state } = criteria;
  const normalized = normalizeVenueName(venueName);
  if (!normalized || !city || !state) return null;
  // Use the same geographic bounds as exact lookup. String position, unlike
  // LIKE, treats model/user punctuation as text rather than wildcard syntax.
  const conditions = venueLookupConditions({ ...criteria, venueName: null });
  if (!conditions) {
    // The caller has a name + locality but no coordinate hint.
    if (criteria.country != null && !countryCode(criteria.country)) return null;
  }
  const geographic = conditions || [
    sql`lower(${venue_catalog.city}) = ${city.trim().toLowerCase()}`,
    eq(venue_catalog.state, state.trim().toUpperCase()),
    ...(countryCode(criteria.country) ? [eq(venue_catalog.country, countryCode(criteria.country))] : []),
  ];
  const results = await db.select().from(venue_catalog).where(and(
    ...geographic,
    sql`${venue_catalog.normalized_name} <> ''`,
    or(sql`strpos(${venue_catalog.normalized_name}, ${normalized}) > 0`,
      sql`strpos(${normalized}, ${venue_catalog.normalized_name}) > 0`)
  )).limit(2);
  if (results.length !== 1) return null;
  await updateAccessStats(results[0].venue_id);
  return results[0];
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
 * @param {string} venue.source - External supplier (e.g., 'google_places_new', 'serpapi', 'llm', 'manual')
 * @param {string} [venue.discoverySource] - Internal flow that added the row
 *   (e.g., 'briefing_discovery', 'address_resolver'). Defaults to venue.source for back-compat;
 *   prefer passing a distinct value so the supplier vs flow distinction is preserved.
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
 * @param {number} [venue.expenseRank] - 1-4 expense ranking
 * @param {string} [venue.category] - Category for venue_catalog
 * @param {string} [venue.country] - Provider-resolved country code (ISO-2; unknown stays null)
 * @param {string} [venue.district] - Explicit district name
 * @param {boolean} [venue.isBar] - 2026-01-14: Progressive enrichment - is_bar flag
 * @param {boolean} [venue.isEventVenue] - 2026-01-14: Progressive enrichment - is_event_venue flag
 * @param {string} [venue.recordStatus] - 2026-01-14: Progressive enrichment - record_status
 * @param {{insertOnly?: boolean}} [options] - Preserve an identified row that wins an insert race
 * @returns {Promise<Object>} Inserted venue record
 */
export async function insertVenue(venue, options = {}) {
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
    address_1: venue.address1,
    city: venue.city,
    state: venue.state?.toUpperCase(),
    zip: venue.zip,
    // An absent country is unknown, never proof that this global venue is in US.
    country: countryCode(venue.country),
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
    expense_rank: venue.expenseRank,
    // 2026-05-03: prefer venue.discoverySource (internal flow) over venue.source (external
    // supplier) so the two columns encode distinct facts. Fallback preserves callers that
    // haven't been updated yet — the address-resolver path already passes them separately.
    discovery_source: venue.discoverySource || venue.source,
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
    timezone: validTimezone(venue.timezone)
  };

  // Merge only supplied facts. This set is evaluated by PostgreSQL against the
  // current row, so simultaneous promotions cannot erase flags/types/status set
  // by another writer. Missing provider fields never clear a known value.
  const update = {
    access_count: sql`COALESCE(${venue_catalog.access_count}, 0) + 1`,
    last_accessed_at: new Date(), updated_at: new Date(),
    is_bar: sql`COALESCE(${venue_catalog.is_bar}, false) OR ${Boolean(venue.isBar)}`,
    is_event_venue: sql`COALESCE(${venue_catalog.is_event_venue}, false) OR ${Boolean(venue.isEventVenue)}`,
    record_status: sql`CASE
      WHEN ${venue_catalog.record_status} = 'verified' OR ${venue.recordStatus || 'stub'} = 'verified' THEN 'verified'
      WHEN ${venue_catalog.record_status} = 'enriched' OR ${venue.recordStatus || 'stub'} = 'enriched' THEN 'enriched'
      ELSE 'stub' END`,
    venue_types: sql`(SELECT COALESCE(jsonb_agg(DISTINCT item), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(${venue_catalog.venue_types}, '[]'::jsonb) || ${JSON.stringify(venueTypes)}::jsonb) AS types(item))`,
  };
  const supplied = {
    venue_name: venue.venueName, normalized_name: normalized,
    address: venue.address || venue.formattedAddress,
    address_1: venue.address1, formatted_address: venue.formattedAddress,
    city: venue.city, state: venue.state?.toUpperCase(), zip: venue.zip,
    country: countryCode(venue.country),
    ...(coordKey ? { lat: venue.lat, lng: venue.lng, coord_key: coordKey } : {}),
    timezone: validTimezone(venue.timezone), market_slug: venue.marketSlug,
    business_hours: venue.hours, hours_full_week: venue.hoursFullWeek, hours_source: venue.hoursSource,
    capacity_estimate: venue.capacityEstimate, expense_rank: venue.expenseRank,
    category: venue.category || venue.venueType, source: venue.source,
    district, district_slug: districtSlug,
  };
  for (const [key, value] of Object.entries(supplied)) {
    if (value != null && value !== '') update[key] = value;
  }

  if (coordKey) {
    // PostgreSQL evaluates this against the current row during conflict
    // arbitration. A new point cannot inherit unsupported facts for the old
    // one; an unchanged point retains its known observations.
    const changedPoint = sql`(${venue_catalog.lat} IS DISTINCT FROM ${venue.lat} OR ${venue_catalog.lng} IS DISTINCT FROM ${venue.lng})`;
    for (const [field, fresh] of [['timezone', validTimezone(venue.timezone)],
      ['country', countryCode(venue.country)], ['market_slug', venue.marketSlug]]) {
      if (fresh == null || fresh === '') update[field] = sql`CASE WHEN ${changedPoint} THEN NULL ELSE ${venue_catalog[field]} END`;
    }
  }

  if (venue.placeId) {
    // The database arbitrates simultaneous discoveries of the same Google ID.
    // A different ID at this point inserts a different row.
    const insert = db.insert(venue_catalog).values(insertValues);
    if (options.insertOnly === true) {
      const [created] = await insert.onConflictDoNothing({ target: venue_catalog.place_id }).returning();
      return created || lookupVenue({ placeId: venue.placeId });
    }
    const [result] = await insert.onConflictDoUpdate({ target: venue_catalog.place_id, set: update }).returning();
    return result;
  }

  // Unknown IDs are not promoted by proximity. Repeated identical unidentified
  // evidence can reuse its own stub, but a different name/address/locality keeps
  // its own row. Serialize the check+insert across workers without a coordinate
  // uniqueness constraint that would exclude neighboring establishments.
  if (!coordKey || !normalized) return null;
  const identity = [coordKey, normalized, venue.city?.trim().toLowerCase() || null,
    venue.state?.trim().toUpperCase() || null, countryCode(venue.country), resolvedAddress.trim().toLowerCase()];
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('venue_catalog:unidentified'), hashtext(${JSON.stringify(identity)}))`);
    const matches = await tx.select().from(venue_catalog).where(and(
      isNull(venue_catalog.place_id), eq(venue_catalog.coord_key, coordKey), eq(venue_catalog.normalized_name, normalized),
      sql`lower(trim(${venue_catalog.city})) IS NOT DISTINCT FROM ${identity[2]}`,
      sql`${venue_catalog.state} IS NOT DISTINCT FROM ${identity[3]}`,
      sql`${venue_catalog.country} IS NOT DISTINCT FROM ${identity[4]}`,
      sql`lower(trim(${venue_catalog.address})) = ${identity[5]}`
    )).limit(2);
    if (matches.length > 1) return null;
    if (matches.length === 1) {
      const [result] = await tx.update(venue_catalog).set(update)
        .where(and(eq(venue_catalog.venue_id, matches[0].venue_id), isNull(venue_catalog.place_id))).returning();
      // Another path may have verified the stub while this transaction waited.
      // Never rewrite that newly established provider identity.
      if (result) return result;
    }
    const [result] = await tx.insert(venue_catalog).values(insertValues).returning();
    return result;
  });
}

/** Insert or promote a catalog row using the same atomic identity writer. */
export async function upsertVenue(venue, options = {}) {
  if (!venue.placeId) {
    const existing = await lookupVenue(venue);
    // An unverified candidate can read an unambiguous known place, but cannot
    // replace Google identity facts with its own address/coordinates.
    if (existing?.place_id) return existing;
  }
  return insertVenue({ ...venue, isBar: options.isBar ?? venue.isBar,
    isEventVenue: options.isEventVenue ?? venue.isEventVenue,
    recordStatus: options.recordStatus ?? venue.recordStatus });
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
 * @param {string} [eventData.country] - Provider-resolved ISO alpha-2 country
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
    country,
    placeId,          // 2026-01-10: AUDIT FIX - Accept place_id from geocoding
    formattedAddress  // 2026-01-10: AUDIT FIX - Accept formatted_address from geocoding
  } = eventData;

  if (!venueName || !city || !state) {
    return null;
  }

  // 2026-01-10: AUDIT FIX - place_id-first lookup strategy
  // Check by place_id first (most reliable), then coord_key, then fuzzy match
  // This follows the standard: "venue identification should be place_id-first"

  // A supplied Google place ID is authoritative (IDs have no required prefix).
  if (placeId) {
    const byPlaceId = await lookupVenue({ placeId });
    if (byPlaceId) {
      // 2026-04-11: Validate cached address quality before returning
      const validated = await maybeReResolveAddress(byPlaceId, venueName, latitude, longitude, city, state);
      // 2026-02-26: Backfill missing data on existing venues (non-blocking)
      const repaired = await repairVenueIdentity(validated || byPlaceId);
      maybeBackfillVenue(repaired, placeId);
      return repaired;
    }
  }

  // Strategy 2: Check by coord_key (exact coordinate match)
  if (!placeId && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const coordKey = generateCoordKey(latitude, longitude);
    const byCoords = await lookupVenue({ coordKey, venueName, city, state, country });
    if (byCoords) {
      // 2026-04-11: Validate cached address quality before returning
      const validated = await maybeReResolveAddress(byCoords, venueName, latitude, longitude, city, state);
      // 2026-02-26: Backfill missing data on existing venues (non-blocking)
      const repaired = await repairVenueIdentity(validated || byCoords);
      maybeBackfillVenue(repaired, repaired.place_id);
      return repaired;
    }
  }

  // Strategy 3: Fall back to fuzzy matching (last resort)
  const existing = placeId ? null : await lookupVenueFuzzy({
    venueName,
    city,
    state,
    country,
    lat: latitude,
    lng: longitude,
  });

  if (existing) {
    // 2026-04-11: Validate cached address quality before returning
    const validated = await maybeReResolveAddress(existing, venueName, latitude, longitude, city, state);
    // 2026-02-26: Backfill missing data on existing venues (non-blocking)
    const repaired = await repairVenueIdentity(validated || existing);
    maybeBackfillVenue(repaired, repaired.place_id);
    return repaired;
  }

  // Only create if we have coordinates
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  // Create new venue with District Tagging
  const district = extractDistrictFromVenueName(venueName);

  // 2026-07-06: Venue timezone from its GPS coords via the Google Timezone API
  // (was: market lookup by city name — a market's blanket timezone is wrong
  // near zone borders, which corrupts open/closed math). Market lookup remains
  // for market_slug IDENTITY only. Non-blocking: venue creation succeeds with
  // timezone omitted (null) — never guessed.
  let venueTimezone = null;
  let venueMarketSlug = null;
  try {
    venueTimezone = await requestVenueTimezone(latitude, longitude);
  } catch (err) {
    venueCacheLog.warn(3, `[VENUE_CREATE] timezone lookup failed: ${err.message}`);
  }
  try {
    const mktResult = await resolveTimezoneFromMarket(city, state, country);
    if (mktResult) {
      venueMarketSlug = mktResult.market_slug;
    }
  } catch (_err) {
    // Non-fatal — market linkage is optional
  }

  // 2026-01-10: AUDIT FIX - Include place_id and formatted_address in new venue
  // 2026-01-14: Progressive Enrichment - Set isEventVenue flag for event-discovered venues
  const created = await insertVenue({
    venueName,
    city,
    state,
    country,
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

  // 2026-02-26: Non-blocking enrichment — fetch phone, hours, rating from Google Places (NEW) API
  // Fire-and-forget: event processing continues immediately
  if (created && placeId) {
    enrichVenueFromPlaceId(created.venue_id, placeId).catch(err => {
      console.warn(`[VENUE] Non-blocking enrichment failed for ${venueName}: ${err.message}`);
    });
  }

  // 2026-04-11: Validate newly created venue's address quality too
  if (created) {
    const validated = await maybeReResolveAddress(created, venueName, latitude, longitude, city, state);
    // Address repair can move the saved point and clear its old timezone.
    return validated ? repairVenueIdentity(validated) : created;
  }

  return created;
}

/**
 * 2026-04-11: Validate a venue's address quality and re-resolve via Places (NEW) API if it fails.
 * This prevents bad cached data (e.g., "Theatre, Frisco, TX 75034") from propagating.
 *
 * Only triggers a Places (NEW) API call when validation FAILS — no extra cost for good addresses.
 *
 * @param {Object} venue - Venue record from venue_catalog
 * @param {string} venueName - Venue name for search
 * @param {number} lat - Latitude hint for Places (NEW) API location bias
 * @param {number} lng - Longitude hint for Places (NEW) API location bias
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

  // Address failed validation — attempt Places (NEW) API re-resolution
  console.warn(`[VENUE] Re-resolving "${venue.venue_name}" (${venue.venue_id?.slice(0, 8)}): ${issues.join('; ')}`);

  try {
    // Use venue's own coords if available, otherwise caller's coords
    const searchLat = venue.lat ?? lat;
    const searchLng = venue.lng ?? lng;
    const searchName = venueName || venue.venue_name;

    if (!Number.isFinite(searchLat) || !Number.isFinite(searchLng) || !searchName) return null;

    // 50km radius — metro-wide search to find the real venue
    const placeResult = await searchPlaceWithTextSearch(searchLat, searchLng, searchName, { radius: 50000 });

    if (!placeResult || !placeResult.formattedAddress ||
        (venue.place_id && placeResult.placeId !== venue.place_id)) {
      console.warn(`[VENUE] Re-resolution returned no result for "${searchName}"`);
      return null;
    }

    // Validate the NEW address too — don't replace bad with bad
    const recheck = validateVenueAddress({
      formattedAddress: placeResult.formattedAddress,
      venueName: searchName
    });

    if (!recheck.valid) {
      console.warn(`[VENUE] Re-resolution also failed for "${searchName}": "${placeResult.formattedAddress}" — ${recheck.issues.join('; ')}`);
      return null;
    }

    // Good address — update venue_catalog
    // Preserve provider coordinate precision; only the lookup key is quantized.
    const fixedLat = Number.isFinite(placeResult.lat) ? placeResult.lat : venue.lat;
    const fixedLng = Number.isFinite(placeResult.lng) ? placeResult.lng : venue.lng;
    const pointChanged = fixedLat !== venue.lat || fixedLng !== venue.lng;

    let updated;
    try {
      [updated] = await db.update(venue_catalog)
      .set({
        formatted_address: placeResult.formattedAddress,
        address: placeResult.formattedAddress,
        address_1: placeResult.parsed?.address_1 || venue.address_1,
        city: placeResult.parsed?.city || venue.city,
        state: placeResult.parsed?.state || venue.state,
        zip: placeResult.parsed?.zip || venue.zip,
        country: countryCode(placeResult.parsed?.country) || (pointChanged ? null : venue.country) || null,
        lat: fixedLat,
        lng: fixedLng,
        coord_key: generateCoordKey(fixedLat, fixedLng) || venue.coord_key,
        // A valid zone for the old point is not evidence for a moved venue.
        // findOrCreateVenue resolves the missing zone from the saved new point.
        timezone: pointChanged ? null : venue.timezone,
        market_slug: pointChanged ? null : venue.market_slug,
        place_id: placeResult.placeId || venue.place_id,
        updated_at: new Date()
      })
      .where(and(eq(venue_catalog.venue_id, venue.venue_id),
        venue.place_id ? eq(venue_catalog.place_id, venue.place_id) : isNull(venue_catalog.place_id),
        ...['address', 'formatted_address', 'address_1', 'city', 'state', 'zip', 'country', 'lat', 'lng', 'coord_key', 'timezone', 'market_slug']
          .map(field => sql`${venue_catalog[field]} IS NOT DISTINCT FROM ${venue[field] ?? null}`)))
      .returning();
    } catch (err) {
      const code = err?.cause?.code || err?.original?.code || err?.code;
      if (code !== '23505' || !placeResult.placeId) throw err;
      // A parallel discovery may already own this provider ID. Reuse its
      // canonical row below, rather than overwrite or return this stale stub.
    }
    if (!updated && placeResult.placeId) {
      // A lost compare-and-set or ID conflict already has a canonical winner.
      // Passing the stale response to the upsert writer would erase that winner.
      const canonical = await lookupVenue({ placeId: placeResult.placeId });
      if (canonical) return canonical;
      return insertVenue({
        venueName: placeResult.displayName || searchName, placeId: placeResult.placeId,
        address: placeResult.formattedAddress, formattedAddress: placeResult.formattedAddress,
        address1: placeResult.parsed?.address_1, city: placeResult.parsed?.city,
        state: placeResult.parsed?.state, zip: placeResult.parsed?.zip,
        country: placeResult.parsed?.country, lat: fixedLat, lng: fixedLng,
        venueTypes: placeResult.types, source: 'google_places_new', discoverySource: 'address_repair',
        isBar: venue.is_bar, isEventVenue: venue.is_event_venue, recordStatus: 'enriched',
      }, { insertOnly: true });
    }

    if (updated) {
      venueCacheLog.debug(`Fixed "${venue.venue_name}" address: "${addrToCheck}" -> "${placeResult.formattedAddress}"`);
      return updated;
    }
  } catch (err) {
    // Non-fatal — return null so caller uses original venue
    console.warn(`[VENUE] Re-resolution error for "${venue.venue_name}": ${err.message}`);
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
// 2026-02-26: Venue Enrichment via Google Places (NEW) API
// ─────────────────────────────────────────────────

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const pendingCatalogEnrichments = new Map();
const CATALOG_DETAILS_TIMEOUT_MS = 15000;

/**
 * 2026-02-26: Check if an existing venue needs enrichment and trigger it non-blockingly.
 * Enrichment is needed if the venue is missing phone, hours, or rating AND has a place_id.
 *
 * @param {Object} venue - Existing venue record from DB
 * @param {string|null} placeId - Google Place ID (no prefix assumption)
 */
// 2026-04-04: Also trigger on missing hours data (was only checking phone+rating).
// Venues created via event discovery get place_id but no hours → shows "0 open".
function maybeBackfillVenue(venue, placeId) {
  if (typeof placeId !== 'string' || !placeId.trim()) return;
  if (!venue?.venue_id) return;

  // Check if enrichment is needed: missing phone, rating, OR hours
  const hasPhone = !!venue.phone_number;
  const hasRating = !!venue.google_rating;
  const hasHours = !!(venue.business_hours || venue.hours_full_week);

  if (hasPhone && hasRating && hasHours) return; // Fully enriched

  // Trigger non-blocking enrichment
  enrichVenueFromPlaceId(venue.venue_id, placeId).catch(err => {
    console.warn(`[VENUE] Backfill failed for venue ${venue.venue_id}: ${err.message}`);
  });
}

/**
 * 2026-02-26: Enrich a venue with data from Google Places (NEW) API using place_id.
 * Fetches: phone, rating, business hours, business status, venue types.
 * Updates the venue_catalog row directly.
 *
 * Uses Google Places (New) API: GET /v1/places/{placeId}
 * This is cheaper than searchNearby — single place lookup by known ID.
 *
 * @param {string} venueId - venue_catalog.venue_id to update
 * @param {string} placeId - Google Place ID (no prefix assumption)
 */
// 2026-04-04: Exported for batch backfill in venue-intelligence.js cache path
export function enrichVenueFromPlaceId(venueId, placeId) {
  if (!GOOGLE_MAPS_API_KEY || !venueId || typeof placeId !== 'string' || !placeId.trim()) return Promise.resolve();
  const key = JSON.stringify([venueId, placeId]);
  if (pendingCatalogEnrichments.has(key)) return pendingCatalogEnrichments.get(key);
  // Keep provider work AND its identity-bound write under one pending operation.
  // Settled results are never a cache: later attempts get a fresh observation.
  const pending = refreshCatalogDetails(venueId, placeId).finally(() => {
    if (pendingCatalogEnrichments.get(key) === pending) pendingCatalogEnrichments.delete(key);
  });
  pendingCatalogEnrichments.set(key, pending);
  return pending;
}

async function requestCatalogDetails(placeId, fieldMask = [
    'displayName',
    'nationalPhoneNumber',
    'regularOpeningHours',
    'rating',
    'priceLevel',
    'businessStatus',
    'types',
    'primaryType'
  ].join(',')) {

  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = Object.assign(new Error('Catalog Places Details timed out'), { code: 'upstream_timeout' });
      controller.abort(error);
      reject(error);
    }, CATALOG_DETAILS_TIMEOUT_MS);
  });
  try {
    // Include body parsing in the deadline. Persistence is outside this race,
    // so even a transport ignoring abort cannot publish a late response.
    return await Promise.race([(async () => {
      const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
        method: 'GET', signal: controller.signal,
        headers: { 'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY, 'X-Goog-FieldMask': fieldMask }
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => 'unknown');
        throw new Error(`Places (NEW) API ${response.status}: ${errText.slice(0, 200)}`);
      }
      return response.json();
    })(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function refreshCatalogDetails(venueId, placeId) {
  const place = await requestCatalogDetails(placeId);

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

  // Mark as verified since we confirmed via Places (NEW) API
  updates.record_status = 'verified';

  // Only update if we actually got useful data
  const hasUsefulData = updates.phone_number || updates.google_rating || updates.business_hours;
  if (!hasUsefulData) return;

  await db.update(venue_catalog)
    .set(updates)
    .where(and(eq(venue_catalog.venue_id, venueId), eq(venue_catalog.place_id, placeId)));

  venueCacheLog.debug(`Enriched venue ${venueId} from Places (NEW) API: phone=${!!updates.phone_number}, rating=${updates.google_rating || 'n/a'}, hours=${!!updates.business_hours}`);
}
