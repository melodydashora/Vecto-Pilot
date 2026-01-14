// server/lib/venue/venue-address-resolver.js
//
// Resolve venue coordinates to addresses using:
// 1. venue_catalog cache (by coord_key)
// 2. Google Places API (New) with 50m locationBias
// 3. Fallback to Google Geocoding API
//
// Updated 2026-01-05: Migrated to Google Places API (New) and venue_catalog integration
// See: /home/runner/.claude/plans/noble-purring-yeti.md

import { db } from '../../db/drizzle.js';
import { eq, and, sql } from 'drizzle-orm';
import { venue_catalog } from '../../../shared/schema.js';
import { isPlusCode } from '../../api/utils/http-helpers.js';
import {
  generateCoordKey,
  normalizeVenueName,
  parseAddressComponents
} from './venue-utils.js';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

/**
 * Resolve venue coordinates to a formatted address
 *
 * Flow:
 * 1. Check venue_catalog cache by coord_key (6 decimal precision)
 * 2. If not cached, call Google Places API (New) with 50m radius
 * 3. Parse address components into granular fields
 * 4. Upsert into venue_catalog for future lookups
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {string} venueName - Venue name (used for Places search)
 * @param {Object} options - Optional configuration
 * @param {boolean} options.skipCache - Skip cache lookup (force fresh API call)
 * @param {boolean} options.upsertCache - Whether to upsert result into venue_catalog (default: true)
 * @returns {Promise<Object|null>} - Venue object with address fields or null
 */
export async function resolveVenueAddress(lat, lng, venueName = null, options = {}) {
  const { skipCache = false, upsertCache = true } = options;

  if (!lat || !lng) return null;

  const coordKey = generateCoordKey(lat, lng);
  const normalizedName = normalizeVenueName(venueName);

  try {
    // Step 1: Check venue_catalog cache by coord_key
    if (!skipCache && coordKey) {
      const [cached] = await db.select()
        .from(venue_catalog)
        .where(eq(venue_catalog.coord_key, coordKey))
        .limit(1);

      if (cached) {
        // Update access tracking
        await db.update(venue_catalog)
          .set({
            access_count: (cached.access_count || 0) + 1,
            last_accessed_at: new Date()
          })
          .where(eq(venue_catalog.venue_id, cached.venue_id))
          .catch(() => {}); // Non-blocking

        return {
          venue_id: cached.venue_id,
          formatted_address: cached.formatted_address || cached.address,
          address: cached.address,
          address_1: cached.address_1,
          city: cached.city,
          state: cached.state,
          zip: cached.zip,
          country: cached.country,
          place_id: cached.place_id,
          lat: cached.lat,
          lng: cached.lng,
          source: 'cache'
        };
      }
    }

    // Step 2: Try Google Places API (New) with 50m radius
    if (venueName && GOOGLE_MAPS_API_KEY) {
      const placeResult = await searchPlaceWithTextSearch(lat, lng, venueName);

      if (placeResult) {
        // Upsert into venue_catalog
        if (upsertCache) {
          await upsertVenueCatalog({
            venue_name: placeResult.displayName || venueName,
            place_id: placeResult.placeId,
            formatted_address: placeResult.formattedAddress,
            ...placeResult.parsed,
            lat: placeResult.lat || lat,
            lng: placeResult.lng || lng,
            coord_key: coordKey,
            normalized_name: normalizedName,
            source: 'google_places_new'
          });
        }

        return {
          formatted_address: placeResult.formattedAddress,
          address: placeResult.formattedAddress,
          address_1: placeResult.parsed.address_1,
          city: placeResult.parsed.city,
          state: placeResult.parsed.state,
          zip: placeResult.parsed.zip,
          country: placeResult.parsed.country,
          place_id: placeResult.placeId,
          lat: placeResult.lat || lat,
          lng: placeResult.lng || lng,
          source: 'google_places_new'
        };
      }
    }

    // Step 3: Fallback to reverse geocoding
    const geocodeResult = await reverseGeocode(lat, lng);

    if (geocodeResult) {
      // Upsert into venue_catalog if we have a venue name
      if (upsertCache && venueName) {
        await upsertVenueCatalog({
          venue_name: venueName,
          formatted_address: geocodeResult.formattedAddress,
          ...geocodeResult.parsed,
          lat,
          lng,
          coord_key: coordKey,
          normalized_name: normalizedName,
          source: 'geocoding'
        });
      }

      return {
        formatted_address: geocodeResult.formattedAddress,
        address: geocodeResult.formattedAddress,
        address_1: geocodeResult.parsed.address_1,
        city: geocodeResult.parsed.city,
        state: geocodeResult.parsed.state,
        zip: geocodeResult.parsed.zip,
        country: geocodeResult.parsed.country,
        lat,
        lng,
        source: 'geocoding'
      };
    }

    // 2026-01-05: With valid lat/lng, geocoding should ALWAYS return a result
    // If we reach here, something is wrong upstream (API key, network, rate limit)
    // Throw instead of returning null - fail loudly per NO FALLBACKS rule
    throw new Error(`[venue-address-resolver] Failed to resolve address for coords (${lat}, ${lng}) with name "${venueName}" - all resolution methods exhausted`);
  } catch (err) {
    // Re-throw with context - don't mask the error
    console.error('[venue-address-resolver] Address resolution failed:', err.message);
    throw err;
  }
}

/**
 * Search for a place using Google Places API (New) with 50m locationBias
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {string} textQuery - Venue name to search
 * @returns {Promise<Object|null>} - Place result with parsed address
 */
async function searchPlaceWithTextSearch(lat, lng, textQuery) {
  if (!GOOGLE_MAPS_API_KEY || !textQuery) return null;

  try {
    const response = await fetch(PLACES_TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.addressComponents,places.formattedAddress,places.location,places.types'
      },
      body: JSON.stringify({
        textQuery,
        locationBias: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: 50.0  // 50m radius - tight match for precise venue lookup
          }
        },
        maxResultCount: 1
      })
    });

    if (!response.ok) {
      console.warn(`[venue-address-resolver] Places API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const place = data.places?.[0];

    if (!place) return null;

    // Parse address components into granular fields
    const parsed = parseAddressComponents(place.addressComponents || []);

    // Reject plus codes
    if (place.formattedAddress && isPlusCode(place.formattedAddress)) {
      console.log(`[venue-address-resolver] Rejecting plus code: ${place.formattedAddress}`);
      return null;
    }

    return {
      placeId: place.id,
      displayName: place.displayName?.text,
      formattedAddress: place.formattedAddress,
      lat: place.location?.latitude,
      lng: place.location?.longitude,
      types: place.types || [],
      parsed
    };
  } catch (err) {
    console.warn('[venue-address-resolver] Places API search failed:', err.message);
    return null;
  }
}

/**
 * Reverse geocode coordinates to address using Google Geocoding API
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<Object|null>} - Geocode result with parsed address
 */
async function reverseGeocode(lat, lng) {
  if (!GOOGLE_MAPS_API_KEY) return null;

  try {
    const geocodeUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    geocodeUrl.searchParams.set('latlng', `${lat},${lng}`);
    geocodeUrl.searchParams.set('key', GOOGLE_MAPS_API_KEY);

    const response = await fetch(geocodeUrl.toString());

    if (!response.ok) return null;

    const data = await response.json();

    if (data.status !== 'OK' || !data.results?.[0]) return null;

    const result = data.results[0];

    // Reject plus codes
    if (isPlusCode(result.formatted_address)) {
      return null;
    }

    // Parse address components (legacy format uses long_name)
    const parsed = parseAddressComponents(result.address_components || []);

    return {
      formattedAddress: result.formatted_address,
      placeId: result.place_id,
      parsed
    };
  } catch (err) {
    console.warn('[venue-address-resolver] Geocoding failed:', err.message);
    return null;
  }
}

/**
 * Upsert venue into venue_catalog
 *
 * Uses coord_key for conflict detection
 *
 * @param {Object} venue - Venue data to upsert
 */
async function upsertVenueCatalog(venue) {
  try {
    // Check if venue exists by coord_key or place_id
    const existingQuery = [];

    if (venue.coord_key) {
      existingQuery.push(eq(venue_catalog.coord_key, venue.coord_key));
    }
    if (venue.place_id) {
      existingQuery.push(eq(venue_catalog.place_id, venue.place_id));
    }

    if (existingQuery.length === 0) return;

    const [existing] = await db.select({ venue_id: venue_catalog.venue_id })
      .from(venue_catalog)
      .where(existingQuery.length === 1 ? existingQuery[0] : sql`${existingQuery[0]} OR ${existingQuery[1]}`)
      .limit(1);

    if (existing) {
      // Update existing venue
      await db.update(venue_catalog)
        .set({
          formatted_address: venue.formatted_address,
          address_1: venue.address_1,
          city: venue.city,
          state: venue.state,
          zip: venue.zip,
          country: venue.country,
          source: venue.source,
          updated_at: new Date(),
          access_count: sql`COALESCE(access_count, 0) + 1`,
          last_accessed_at: new Date()
        })
        .where(eq(venue_catalog.venue_id, existing.venue_id));
    } else {
      // Insert new venue
      // 2026-01-14: Set record_status: 'stub' for address-resolver-only venues
      await db.insert(venue_catalog)
        .values({
          venue_name: venue.venue_name,
          address: venue.formatted_address,
          lat: venue.lat,
          lng: venue.lng,
          city: venue.city,
          state: venue.state,
          zip: venue.zip,
          // 2026-01-10: D-004 Fix - Use ISO-3166-1 alpha-2 code
          country: venue.country || 'US',
          formatted_address: venue.formatted_address,
          address_1: venue.address_1,
          place_id: venue.place_id,
          coord_key: venue.coord_key,
          normalized_name: venue.normalized_name,
          category: 'venue', // Default category
          source: venue.source,
          discovery_source: 'address_resolver',
          access_count: 1,
          last_accessed_at: new Date(),
          updated_at: new Date(),
          // 2026-01-14: Progressive Enrichment - address resolver creates stubs
          is_bar: false,
          is_event_venue: false,
          record_status: 'stub'
        })
        .onConflictDoNothing(); // Handle race conditions
    }
  } catch (err) {
    // Non-blocking - log and continue
    console.warn('[venue-address-resolver] Upsert failed:', err.message);
  }
}

/**
 * Batch resolve addresses for multiple venues (optimized for performance)
 *
 * @param {Array} venues - Array of {lat, lng, name}
 * @returns {Promise<Object>} - Map of venue key → address result
 */
export async function resolveVenueAddressesBatch(venues) {
  const results = {};

  // Resolve in parallel with Promise.all but limit concurrency to 5 simultaneous requests
  const chunks = [];
  for (let i = 0; i < venues.length; i += 5) {
    chunks.push(venues.slice(i, i + 5));
  }

  for (const chunk of chunks) {
    const promises = chunk.map(async (v) => {
      const key = `${v.lat},${v.lng}`;
      // 2026-01-05: With name + 6-decimal coords, resolution should NEVER fail
      // If it does, it's an upstream issue (API key, network) that must be fixed
      // Let errors propagate - don't mask with null
      const result = await resolveVenueAddress(v.lat, v.lng, v.name);
      return { key, result };
    });

    const resolved = await Promise.all(promises);
    resolved.forEach(({ key, result }) => {
      results[key] = result;
    });
  }

  return results;
}
