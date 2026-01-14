/**
 * VENUE ENRICHMENT LAYER
 *
 * Takes minimal VENUE_SCORER output (coords + category + tips) and enriches with Google APIs:
 * - Places API (New): Resolve addresses, business status, place details
 * - Routes API (New): Calculate accurate distances and drive times with traffic
 *
 * Architecture: Separate AI reasoning (VENUE_SCORER role) from factual lookups (Google)
 *
 * District Fallback (Dec 2025):
 * When coordinate-based Places API search fails (name match < 20%),
 * falls back to text search using: "venue_name district city"
 * This handles LLM coordinate imprecision (50-150m off target).
 *
 * 2026-01-05: Radius increased from 150m to 500m for better venue matching
 */

import { getRouteWithTraffic, getRouteMatrix } from "../external/routes-api.js";
import { getStreetViewUrl, checkStreetViewAvailability } from "../external/streetview-api.js";
import { venuesLog, OP } from "../../logger/workflow.js";
// 2026-01-14: Import batch address resolver to replace per-venue geocoding
import { resolveVenueAddressesBatch } from "./venue-address-resolver.js";
import { db } from "../../db/drizzle.js";
import { places_cache } from "../../../shared/schema.js";
import { eq } from "drizzle-orm";
import { extractDistrictFromVenueName, normalizeDistrictSlug } from "./district-detection.js";
// 2026-01-10: D-014 Phase 4 - Use canonical hours module for all isOpen calculations
import { parseGoogleWeekdayText, getOpenStatus } from "./hours/index.js";
// 2026-01-10: Use canonical coords-key module (consolidated from 4 duplicates)
import { getCoordsKey } from "../location/coords-key.js";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PLACES_NEW_URL = "https://places.googleapis.com/v1/places:searchNearby";
const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
// 2026-01-14: GEOCODE_URL REMOVED - now using resolveVenueAddressesBatch from venue-address-resolver.js

// In-memory cache for places (lasts duration of request batch)
// Key: rounded coords "lat_lng" → value: place details
const placesMemoryCache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Enrich VENUE_SCORER role output with Google API data
 * @param {Array} venues - VENUE_SCORER output: [{name, lat, lng, category, pro_tips}]
 * @param {Object} driverLocation - {lat, lng}
 * @param {Object} snapshot - Full snapshot with timezone for accurate hours calculation
 * @returns {Promise<Array>} Enriched venues with addresses, distances, drive times
 */
export async function enrichVenues(venues, driverLocation, snapshot = null) {
  if (!venues || venues.length === 0) {
    return [];
  }

  // 2026-01-07: NO FALLBACK - if timezone is missing, isOpen will be null (unknown)
  // Per CLAUDE.md: "If data is missing, return an error - don't mask the bug with defaults"
  // UTC fallback was wrong for global app (Tokyo user would see wrong open/closed status)
  const timezone = snapshot?.timezone || null;
  if (!timezone) {
    venuesLog.warn(1, `[venue-enrichment] ⚠️ No timezone in snapshot - isOpen will be null`);
  }
  venuesLog.start(`${venues.length} venues (tz: ${timezone || 'UNKNOWN'})`);

  // OPTIMIZATION: Batch all route calculations in ONE API call using Route Matrix
  // Before: N venues = N API calls (sequential or parallel but still N calls)
  // After: N venues = 1 API call (single batch request)
  const startRouteTime = Date.now();
  let routeResults = new Map();

  try {
    venuesLog.phase(2, `[venue-enrichment] Batch routes for ${venues.length} venues`, OP.API);

    const destinations = venues.map(v => ({ lat: v.lat, lng: v.lng }));
    const matrixResults = await getRouteMatrix([driverLocation], destinations);

    // Map results by destination index for quick lookup
    matrixResults.forEach(result => {
      routeResults.set(result.destinationIndex, {
        distanceMeters: result.distanceMeters,
        durationSeconds: result.durationSeconds,
        trafficDelaySeconds: 0 // Matrix API doesn't return traffic delay separately
      });
    });

    const routeDuration = Date.now() - startRouteTime;
    const distances = matrixResults.map(r => `${(r.distanceMeters * 0.000621371).toFixed(1)}mi`).join(', ');
    venuesLog.done(2, `[venue-enrichment] Batch routes complete: ${distances} (${routeDuration}ms)`, OP.API);
  } catch (routeError) {
    venuesLog.warn(2, `[venue-enrichment] Batch routes failed, falling back to individual calls: ${routeError.message}`, OP.API);
    // routeResults stays empty, will fall back to individual calls below
  }

  // 2026-01-14: BATCH ADDRESS RESOLUTION (replaces per-venue reverseGeocode calls)
  // This reduces N API calls to a single batch operation with concurrency limiting
  let addressResults = {};
  try {
    venuesLog.phase(1, `[venue-enrichment] Batch resolving ${venues.length} addresses`, OP.API);
    const venueKeys = venues.map(v => ({ lat: v.lat, lng: v.lng, name: v.name }));
    addressResults = await resolveVenueAddressesBatch(venueKeys);
    venuesLog.done(1, `[venue-enrichment] Batch address resolution complete`, OP.API);
  } catch (addressError) {
    venuesLog.warn(1, `[venue-enrichment] Batch address resolution failed: ${addressError.message}`, OP.API);
    // addressResults stays empty, places API fallback will handle below
  }

  // Parallelize remaining enrichments (places details)
  const enriched = await Promise.all(
    venues.map(async (venue, index) => {
      const venueName = venue.name.length > 35 ? venue.name.slice(0, 32) + '...' : venue.name;
      try {
        // 1. Get address from BATCH RESULTS (2026-01-14: replaces per-venue reverseGeocode)
        const coordKey = `${venue.lat},${venue.lng}`;
        const addressData = addressResults[coordKey];
        const address = addressData?.formatted_address || null;

        // 2. Get route from batch results OR fallback to individual call
        let route = routeResults.get(index);
        if (!route) {
          // Fallback: individual API call if batch failed
          venuesLog.api(2, 'Google Routes (fallback)', `"${venueName}"`);
          route = await getRouteWithTraffic(driverLocation, {
            lat: venue.lat,
            lng: venue.lng,
          });
          venuesLog.done(2, `"${venueName}" → ${(route.distanceMeters * 0.000621371).toFixed(1)}mi, ${Math.ceil(route.durationSeconds / 60)}min`, OP.API);
        }

        // 3. Get place details using Fallback Logic (Coordinate -> Text Search)
        // This fixes the issue where strict coordinate search rejects valid venues 151m away
        const effectiveDistrict = venue.district || extractDistrictFromVenueName(venue.name);

        const placeDetails = await getPlaceDetailsWithFallback(
          venue.lat,
          venue.lng,
          venue.name,
          effectiveDistrict,
          snapshot?.city || null,
          snapshot?.state || null,
          timezone
        );

        // 3a. Validate results based on the placeVerified flag returned by the fallback function
        const useGoogleDetails = placeDetails?.placeVerified === true;

        if (placeDetails && !useGoogleDetails) {
             venuesLog.warn(3, `"${venue.name}" → Google found "${placeDetails.google_name}" but verification failed (Method: ${placeDetails.matchMethod})`, OP.API);
        } else if (placeDetails) {
             // Log the successful match method for debugging
             const matchInfo = placeDetails.matchMethod === 'text_search' ? ` [via ${placeDetails.district || 'text'}]` : '';
             venuesLog.info(`Match confirmed: "${venue.name}" ↔ "${placeDetails.google_name}"${matchInfo}`, OP.API);
        }

        // CRITICAL FIX: Filter out permanently closed venues before recommending to drivers
        if (placeDetails?.business_status === 'CLOSED_PERMANENTLY') {
          venuesLog.warn(3, `FILTERED: "${venueName}" - permanently closed`, OP.API);
          return null; // Filter this venue out
        }

        // 4. Generate Street View URL (no API call - just URL construction)
        const streetViewUrl = getStreetViewUrl(
          { lat: venue.lat, lng: venue.lng },
          { width: 400, height: 300 }
        );

        const enrichedVenue = {
          ...venue,
          rank: index + 1,
          // Google-enriched data (camelCase for consistency with blocks route)
          // Only use Google place details if name match passed threshold
          address: address || "Address unavailable",
          placeId: useGoogleDetails ? (placeDetails?.place_id || null) : null,
          businessStatus: useGoogleDetails ? (placeDetails?.business_status || "UNKNOWN") : "UNVERIFIED",
          isOpen: useGoogleDetails ? (placeDetails?.isOpen ?? null) : null,
          businessHours: useGoogleDetails ? (placeDetails?.businessHours || null) : null,
          placeVerified: useGoogleDetails, // Flag indicating if Google place match was accepted
          distanceMeters: route.distanceMeters,
          distanceMiles: (route.distanceMeters * 0.000621371).toFixed(1),
          driveTimeMinutes: Math.ceil(route.durationSeconds / 60),
          trafficDelayMinutes: Math.ceil((route.trafficDelaySeconds || 0) / 60),
          distanceSource: "google_route_matrix", // Updated source
          streetViewUrl: streetViewUrl, // Street View preview image
        };

        const openStatus = enrichedVenue.isOpen === true ? 'OPEN' : enrichedVenue.isOpen === false ? 'CLOSED' : 'UNKNOWN';
        const verifiedStatus = useGoogleDetails ? '' : ' [UNVERIFIED]';
        venuesLog.done(3, `"${venueName}" → ${openStatus}, ${enrichedVenue.businessHours || 'no hours'}${verifiedStatus}`, OP.API);
        return enrichedVenue;
      } catch (error) {
        venuesLog.error(3, `"${venueName}" enrichment failed`, error, OP.API);

        // CRITICAL: Always preserve VENUE_SCORER coords even if enrichment fails
        return {
          ...venue,
          rank: index + 1,
          lat: venue.lat, // Preserve VENUE_SCORER coords
          lng: venue.lng, // Preserve VENUE_SCORER coords
          address: "Unavailable",
          placeId: null,
          distanceMeters: null,
          distanceMiles: null,
          driveTimeMinutes: null,
          distanceSource: "enrichment_failed",
        };
      }
    }),
  );

  // Filter out null entries (permanently closed venues that were filtered out)
  const filtered = enriched.filter(Boolean);
  const permanentlyClosedCount = enriched.length - filtered.length;

  if (permanentlyClosedCount > 0) {
    venuesLog.warn(3, `Filtered out ${permanentlyClosedCount} permanently closed venue(s), ${filtered.length} remain`);
  }

  venuesLog.done(3, `Enriched ${filtered.length} venues (${permanentlyClosedCount} permanently closed filtered)`);
  return filtered;
}

// 2026-01-14: reverseGeocode function REMOVED - now using resolveVenueAddressesBatch
// from venue-address-resolver.js which handles caching and batch resolution

/**
 * Condense weekly hours into readable format
 * Example: ["Monday: 6:00 AM – 10:00 PM", "Tuesday: 6:00 AM – 10:00 PM", ...]
 * Output: "Mon-Fri: 6AM-10PM, Sat-Sun: 7AM-9PM"
 * Filters out "Closed" days to show only when venue is open
 */
function condenseWeeklyHours(weekdayTexts) {
  if (!weekdayTexts || weekdayTexts.length === 0) return null;

  // Parse each day and filter out "Closed" days
  const days = weekdayTexts
    .map((text) => {
      const match = text.match(/^(\w+):\s*(.+)$/);
      if (!match) return null;

      const [, day, hours] = match;

      // Skip closed days
      if (/closed/i.test(hours)) return null;

      // Simplify hours format: "6:00 AM – 10:00 PM" → "6AM-10PM"
      const simplified = hours
        .replace(/(\d+):00\s*/g, "$1") // Remove :00
        .replace(/\s*–\s*/g, "-") // Replace – with -
        .replace(/\s+/g, ""); // Remove spaces

      return { day, hours: simplified };
    })
    .filter(Boolean);

  if (days.length === 0) return null;

  // Group consecutive days with same hours
  const groups = [];
  let currentGroup = [days[0]];

  for (let i = 1; i < days.length; i++) {
    if (days[i].hours === currentGroup[0].hours) {
      currentGroup.push(days[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [days[i]];
    }
  }
  groups.push(currentGroup);

  // Format groups
  const formatted = groups.map((group) => {
    const startDay = group[0].day.slice(0, 3); // Mon, Tue, etc.
    const endDay = group[group.length - 1].day.slice(0, 3);
    const dayRange = group.length === 1 ? startDay : `${startDay}-${endDay}`;
    return `${dayRange}: ${group[0].hours}`;
  });

  return formatted.join(", ");
}

/**
 * Calculate if venue is currently open based on Google Places weekday_text array
 *
 * 2026-01-10: D-014 Phase 4 - Now uses canonical hours module (parseGoogleWeekdayText + getOpenStatus)
 * This wrapper maintains backward compatibility while using the consolidated evaluation logic.
 *
 * @param {Array<string>} weekdayTexts - Google Places weekday_text array, e.g., ["Monday: 6:00 AM – 11:00 PM", ...]
 * @param {string|null} timezone - IANA timezone (e.g., "America/Chicago")
 * @returns {boolean|null} - true if open, false if closed, null if hours unavailable or no timezone
 */
function calculateIsOpenFromGoogleWeekdayText(weekdayTexts, timezone = null) {
  if (!weekdayTexts || weekdayTexts.length === 0) {
    return null; // No hours data available
  }

  // 2026-01-07: NO FALLBACK - if timezone missing, return null (unknown)
  // Per CLAUDE.md: Don't mask bugs with defaults. UTC would be wrong for non-UTC users.
  if (!timezone) {
    return null; // Cannot determine open/closed without timezone
  }

  // 2026-01-10: D-014 Phase 4 - Use canonical parser + evaluator
  const parseResult = parseGoogleWeekdayText(weekdayTexts);

  if (!parseResult.ok) {
    console.warn(`[calculateIsOpenFromGoogleWeekdayText] Parse failed: ${parseResult.error}`);
    return null;
  }

  const status = getOpenStatus(parseResult.schedule, timezone);

  // Debug log for backward compatibility (same info as before)
  if (status.is_open !== null) {
    console.log(
      `[calculateIsOpenFromGoogleWeekdayText] ${status.reason} → ${status.is_open ? "OPEN" : "CLOSED"}`
    );
  }

  return status.is_open;
}

// getCoordsKey imported from canonical coords-key.js module (2026-01-10)

/**
 * Get place details from Google Places API (New) with caching and retry logic
 * @param {number} lat
 * @param {number} lng
 * @param {string} name - Venue name for verification
 * @param {string|null} timezone - IANA timezone for accurate hours calculation (null = isOpen unknown)
 * @returns {Promise<Object>} {place_id, business_status, ...}
 */
async function getPlaceDetails(lat, lng, name, timezone = null) {
  const coordsKey = getCoordsKey(lat, lng);

  // 1. Check in-memory cache first (fastest)
  const memCached = placesMemoryCache.get(coordsKey);
  if (memCached && (Date.now() - memCached.cachedAt) < CACHE_TTL_MS) {
    venuesLog.info(`Places CACHE HIT (memory): "${name}"`, OP.CACHE);
    // Recalculate isOpen with current timezone (hours data is cached, not the open status)
    const isOpen = calculateIsOpenFromGoogleWeekdayText(memCached.allHours, timezone);
    return { ...memCached, isOpen };
  }

  // 2. Check database cache (second fastest)
  try {
    const [dbCached] = await db.select().from(places_cache).where(eq(places_cache.coords_key, coordsKey)).limit(1);
    if (dbCached && dbCached.formatted_hours) {
      const cachedAge = Date.now() - new Date(dbCached.cached_at).getTime();
      if (cachedAge < CACHE_TTL_MS) {
        const cached = dbCached.formatted_hours;
        venuesLog.info(`Places CACHE HIT (db): "${name}"`, OP.CACHE);
        // Update memory cache
        placesMemoryCache.set(coordsKey, { ...cached, cachedAt: Date.now() });
        // Update access count
        db.update(places_cache)
          .set({ access_count: (dbCached.access_count || 0) + 1 })
          .where(eq(places_cache.coords_key, coordsKey))
          .catch(() => {}); // Fire and forget
        // Recalculate isOpen with current timezone
        const isOpen = calculateIsOpenFromGoogleWeekdayText(cached.allHours, timezone);
        return { ...cached, isOpen };
      }
    }
  } catch (cacheErr) {
    // Cache miss or error - proceed with API call
    venuesLog.warn(3, `Places cache check failed: ${cacheErr.message}`, OP.CACHE);
  }

  // 3. No cache hit - call Google Places API
  // CRITICAL: Add retry logic for transient Google API failures (5xx, 429)
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second base delay

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Use Places API (New) - Search Nearby with PRECISE location
      // 2026-01-05: Radius increased from 150m to 500m to catch venues with slight coord mismatch
      const response = await fetch(PLACES_NEW_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.businessStatus,places.formattedAddress,places.currentOpeningHours,places.regularOpeningHours,places.utcOffsetMinutes,places.location",
        },
        body: JSON.stringify({
          locationRestriction: {
            circle: {
              center: {
                latitude: lat,
                longitude: lng,
              },
              radius: 500.0, // 500m radius - Increased from 150m to catch venues with slight coord mismatch
            },
          },
          maxResultCount: 3, // Get top 3 and pick closest match
          rankPreference: "DISTANCE", // Prioritize closest venue to coords
        }),
      });

      if (!response.ok) {
        // Retry on 429 (rate limit) and 5xx errors
        if ((response.status === 429 || response.status >= 500) && attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
          console.warn(
            `[Places API] HTTP ${response.status} for "${name}" - Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
          );
          await new Promise(resolve => setTimeout(resolve, delay));
          continue; // Retry
        }

        const errorText = await response.text();
        console.error(
          `[Places API (New)] HTTP ${response.status} for "${name}":`,
          errorText,
        );
        throw new Error(
          `Places API returned ${response.status}: ${errorText.substring(0, 200)}`,
        );
      }

      // Parse response
      const data = await response.json();

      if (data.places && data.places.length > 0) {
        // Pick best match from results based on name similarity
        let bestPlace = data.places[0];
        let bestSimilarity = 0;

        for (const place of data.places) {
          const placeName = place.displayName?.text || place.name || '';
          const similarity = calculateNameSimilarity(name, placeName);
          if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestPlace = place;
          }
        }

        const place = bestPlace;
        const googleName = place.displayName?.text || place.name;
        const googleLat = place.location?.latitude;
        const googleLng = place.location?.longitude;

        // Calculate distance between requested coords and Google's returned coords
        const distance =
          googleLat && googleLng
            ? Math.sqrt(
                Math.pow((lat - googleLat) * 111000, 2) +
                  Math.pow((lng - googleLng) * 111000, 2),
              )
            : null;

        // Only log if name mismatch or significant distance
        if (distance && distance > 50) {
          venuesLog.info(`Places API: "${name}" → "${googleName}" (${distance.toFixed(0)}m away, ${(bestSimilarity * 100).toFixed(0)}% match)`, OP.API);
        }

        // Extract business hours
        const hours = place.currentOpeningHours || place.regularOpeningHours;
        const weekdayTexts = hours?.weekdayDescriptions || [];

        // CRITICAL: Calculate isOpen ourselves using snapshot timezone (don't trust Google's openNow)
        const isOpen = calculateIsOpenFromGoogleWeekdayText(weekdayTexts, timezone);


        // Condense weekly hours into readable format
        const condensedHours = condenseWeeklyHours(weekdayTexts);

        const result = {
          place_id: place.id,
          google_name: googleName, // Return Google's name for validation
          business_status: place.businessStatus || "OPERATIONAL",
          formatted_address: place.formattedAddress,
          isOpen: isOpen,
          businessHours: condensedHours || null,
          allHours: weekdayTexts,
        };

        // 4. Save to cache (both memory and DB) - fire and forget
        const cacheData = { ...result, cachedAt: Date.now() };
        placesMemoryCache.set(coordsKey, cacheData);

        // Save to DB cache (async, don't await)
        // 2026-01-10: D-013 Fix - Renamed place_id → coords_key
        db.insert(places_cache)
          .values({
            coords_key: coordsKey,
            formatted_hours: result,
            cached_at: new Date(),
            access_count: 1
          })
          .onConflictDoUpdate({
            target: places_cache.coords_key,
            set: {
              formatted_hours: result,
              cached_at: new Date(),
              access_count: 1
            }
          })
          .catch(err => venuesLog.warn(3, `Places cache write failed: ${err.message}`, OP.CACHE));

        return result;
      }

      // 2026-01-05: Use 6 decimals in logs for consistency
      venuesLog.warn(3, `Places API: No results for "${name}" at ${lat.toFixed(6)},${lng.toFixed(6)}`, OP.API);

      return null;
    } catch (error) {
      // Network errors: retry
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        venuesLog.warn(3, `Places API: ${error.message} - retry ${attempt + 1}/${maxRetries} in ${delay}ms`, OP.RETRY);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue; // Retry
      }

      // Final attempt failed
      venuesLog.error(3, `Places API failed for "${name}"`, error, OP.API);
      return null;
    }
  }
}

/**
 * Calculate similarity between two venue names (0-1 scale)
 * Uses simple word overlap - accounts for variations like "City Square" vs "Cinemark City Square"
 * @param {string} name1 - VENUE_SCORER role venue name
 * @param {string} name2 - Google venue name
 * @returns {number} Similarity score 0-1 (0=no match, 1=perfect match)
 */
function calculateNameSimilarity(name1, name2) {
  if (!name1 || !name2) return 0;

  // Normalize: lowercase, remove special chars, split into words
  const normalize = (str) =>
    str
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2); // Ignore short words like "at", "by", "of"

  const words1 = normalize(name1);
  const words2 = normalize(name2);

  if (words1.length === 0 || words2.length === 0) return 0;

  // Count matching words
  const matches = words1.filter((w) => words2.includes(w)).length;

  // Similarity = (2 × matches) / (total words in both)
  return (2 * matches) / (words1.length + words2.length);
}

/**
 * TEXT SEARCH FALLBACK FOR DISTRICT-BASED MATCHING
 *
 * When coordinate-based search fails (name match < 20%), this function
 * searches by text query: "venue_name district city"
 *
 * Example: "Legacy Hall Legacy West Plano TX"
 *
 * @param {string} venueName - Venue name from LLM
 * @param {string} district - District/neighborhood name
 * @param {string} city - City name
 * @param {string} state - State abbreviation
 * @param {string|null} timezone - IANA timezone for hours calculation (null = isOpen unknown)
 * @returns {Promise<Object|null>} Place details or null if not found
 */
export async function searchPlaceByText(venueName, district, city, state, timezone = null) {
  // Build text query: "Legacy Hall Legacy West Plano TX"
  const queryParts = [venueName];
  if (district) queryParts.push(district);
  if (city) queryParts.push(city);
  if (state) queryParts.push(state);

  const textQuery = queryParts.join(' ');

  venuesLog.info(`[Places Text Search] Trying: "${textQuery}"`, OP.API);

  try {
    const response = await fetch(PLACES_TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.businessStatus,places.formattedAddress,places.currentOpeningHours,places.regularOpeningHours,places.location",
      },
      body: JSON.stringify({
        textQuery: textQuery,
        maxResultCount: 3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      venuesLog.warn(3, `[Places Text Search] HTTP ${response.status}: ${errorText.substring(0, 100)}`, OP.API);
      return null;
    }

    const data = await response.json();

    if (!data.places || data.places.length === 0) {
      venuesLog.warn(3, `[Places Text Search] No results for: "${textQuery}"`, OP.API);
      return null;
    }

    // Pick best match by name similarity
    let bestPlace = data.places[0];
    let bestSimilarity = 0;

    for (const place of data.places) {
      const placeName = place.displayName?.text || '';
      const similarity = calculateNameSimilarity(venueName, placeName);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestPlace = place;
      }
    }

    const googleName = bestPlace.displayName?.text || '';

    venuesLog.done(3, `[Places Text Search] Found: "${googleName}" (${(bestSimilarity * 100).toFixed(0)}% match)`, OP.API);

    // Extract business hours
    const hours = bestPlace.currentOpeningHours || bestPlace.regularOpeningHours;
    const weekdayTexts = hours?.weekdayDescriptions || [];
    const isOpen = calculateIsOpenFromGoogleWeekdayText(weekdayTexts, timezone);
    const condensedHours = condenseWeeklyHours(weekdayTexts);

    return {
      place_id: bestPlace.id,
      google_name: googleName,
      business_status: bestPlace.businessStatus || "OPERATIONAL",
      formatted_address: bestPlace.formattedAddress,
      isOpen: isOpen,
      businessHours: condensedHours || null,
      allHours: weekdayTexts,
      similarity: bestSimilarity,
      matchMethod: 'text_search',
      google_lat: bestPlace.location?.latitude,
      google_lng: bestPlace.location?.longitude,
    };

  } catch (error) {
    venuesLog.error(3, `[Places Text Search] Error: ${error.message}`, error, OP.API);
    return null;
  }
}

/**
 * Get place details with district fallback
 *
 * Fallback chain:
 * 1. Coordinate-based searchNearby (current method)
 * 2. If name match < 20%: Text search with district + city
 * 3. If still failing: Mark as UNVERIFIED
 *
 * @param {number} lat - Venue latitude from LLM
 * @param {number} lng - Venue longitude from LLM
 * @param {string} name - Venue name from LLM
 * @param {string} district - District/neighborhood name (optional)
 * @param {string} city - City name
 * @param {string} state - State abbreviation
 * @param {string|null} timezone - IANA timezone (null = isOpen unknown)
 * @returns {Promise<Object>} Place details with placeVerified flag
 */
export async function getPlaceDetailsWithFallback(lat, lng, name, district, city, state, timezone = null) {
  // 1. Try coordinate-based search first
  const coordResult = await getPlaceDetails(lat, lng, name, timezone);

  if (coordResult) {
    // Check name match quality
    const similarity = coordResult.google_name
      ? calculateNameSimilarity(name, coordResult.google_name)
      : 0;

    if (similarity >= 0.20) {
      // Good match, use coordinate result
      return { ...coordResult, placeVerified: true, matchMethod: 'coord_search' };
    }

    venuesLog.warn(3, `[Enrichment] Coord match failed for "${name}" (${(similarity * 100).toFixed(0)}% match), trying text search...`, OP.API);
  }

  // 2. Coordinate match failed - try text search with district
  // First, try to extract district from venue name if not provided
  const effectiveDistrict = district || extractDistrictFromVenueName(name);

  if (effectiveDistrict || city) {
    const textResult = await searchPlaceByText(name, effectiveDistrict, city, state, timezone);

    if (textResult && textResult.similarity >= 0.40) {
      venuesLog.done(3, `[Enrichment] Text search succeeded for "${name}" via district "${effectiveDistrict}"`, OP.API);
      return { ...textResult, placeVerified: true, district: effectiveDistrict };
    }
  }

  // 3. Both methods failed - return coord result as unverified (or null)
  if (coordResult) {
    venuesLog.warn(3, `[Enrichment] Both coord and text search failed for "${name}" - marking UNVERIFIED`, OP.API);
    return { ...coordResult, placeVerified: false, matchMethod: 'unverified' };
  }

  return null;
}
