/**
 * VENUE ENRICHMENT LAYER
 *
 * Takes minimal GPT-5 output (coords + category + tips) and enriches with Google APIs:
 * - Places API (New): Resolve addresses, business status, place details
 * - Routes API (New): Calculate accurate distances and drive times with traffic
 *
 * Architecture: Separate AI reasoning (GPT-5) from factual lookups (Google)
 */

import { getRouteWithTraffic, getRouteMatrix } from "../external/routes-api.js";
import { getStreetViewUrl, checkStreetViewAvailability } from "../external/streetview-api.js";
import { venuesLog, OP } from "../../logger/workflow.js";
import { db } from "../../db/drizzle.js";
import { places_cache } from "../../../shared/schema.js";
import { eq } from "drizzle-orm";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PLACES_NEW_URL = "https://places.googleapis.com/v1/places:searchNearby";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

// In-memory cache for places (lasts duration of request batch)
// Key: rounded coords "lat_lng" → value: place details
const placesMemoryCache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Enrich GPT-5 venue recommendations with Google API data
 * @param {Array} venues - GPT-5 output: [{name, lat, lng, category, pro_tips}]
 * @param {Object} driverLocation - {lat, lng}
 * @param {Object} snapshot - Full snapshot with timezone for accurate hours calculation
 * @returns {Promise<Array>} Enriched venues with addresses, distances, drive times
 */
export async function enrichVenues(venues, driverLocation, snapshot = null) {
  if (!venues || venues.length === 0) {
    return [];
  }

  const timezone = snapshot?.timezone || "UTC"; // Fallback to UTC for global app
  venuesLog.start(`${venues.length} venues (tz: ${timezone})`);

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

  // Parallelize remaining enrichments (geocoding + places)
  const enriched = await Promise.all(
    venues.map(async (venue, index) => {
      const venueName = venue.name.length > 35 ? venue.name.slice(0, 32) + '...' : venue.name;
      try {
        // 1. Reverse geocode coords → address
        const address = await reverseGeocode(venue.lat, venue.lng);

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

        // 3. Get place details from Google Places API (New) with timezone
        const placeDetails = await getPlaceDetails(
          venue.lat,
          venue.lng,
          venue.name,
          timezone,
        );

        // 3a. LOG name differences (but ACCEPT nearby venues - they share event context)
        if (
          placeDetails?.google_name &&
          placeDetails.google_name !== venue.name
        ) {
          const similarity = calculateNameSimilarity(
            venue.name,
            placeDetails.google_name,
          );

          if (similarity < 0.4) {
            venuesLog.warn(3, `"${venue.name}" → Google found "${placeDetails.google_name}" (${(similarity * 100).toFixed(0)}% match) - accepting nearby venue`, OP.API);
          }
        }

        // 4. Cache stable data in database - REMOVED (places table doesn't exist)
        // Only places_cache table exists for storing business hours
        // Coordinates are preserved in venue_catalog and rankings tables

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
          address: address || "Address unavailable",
          placeId: placeDetails?.place_id || null,
          businessStatus: placeDetails?.business_status || "UNKNOWN",
          isOpen: placeDetails?.isOpen ?? null,
          businessHours: placeDetails?.businessHours || null,
          distanceMeters: route.distanceMeters,
          distanceMiles: (route.distanceMeters * 0.000621371).toFixed(1),
          driveTimeMinutes: Math.ceil(route.durationSeconds / 60),
          trafficDelayMinutes: Math.ceil((route.trafficDelaySeconds || 0) / 60),
          distanceSource: "google_route_matrix", // Updated source
          streetViewUrl: streetViewUrl, // Street View preview image
        };

        const openStatus = enrichedVenue.isOpen === true ? 'OPEN' : enrichedVenue.isOpen === false ? 'CLOSED' : 'UNKNOWN';
        venuesLog.done(3, `"${venueName}" → ${openStatus}, ${enrichedVenue.businessHours || 'no hours'}`, OP.API);
        return enrichedVenue;
      } catch (error) {
        venuesLog.error(3, `"${venueName}" enrichment failed`, error, OP.API);

        // CRITICAL: Always preserve GPT-5 coords even if enrichment fails
        return {
          ...venue,
          rank: index + 1,
          lat: venue.lat, // Preserve GPT-5 coords
          lng: venue.lng, // Preserve GPT-5 coords
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

/**
 * Reverse geocode coordinates to formatted address
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<string>} Formatted address
 */
async function reverseGeocode(lat, lng) {
  try {
    const url = `${GEOCODE_URL}?latlng=${lat},${lng}&key=${GOOGLE_PLACES_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === "OK" && data.results?.length > 0) {
      // Filter out Plus Codes - look for proper street addresses
      for (const result of data.results) {
        const addr = result.formatted_address;
        // Skip Plus Codes (format: "XXXX+XX City, State, Country")
        if (!/^\w{4}\+\w{2}/.test(addr)) {
          return addr;
        }
      }
      // Fallback to first result if no street address found
      return data.results[0].formatted_address;
    }

    throw new Error(`Geocoding failed: ${data.status}`);
  } catch (error) {
    console.error(`[Reverse Geocode] Failed for ${lat},${lng}:`, error.message);
    return null;
  }
}

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
 * Calculate if venue is currently open based on Google hours and snapshot timezone
 * @param {Array<string>} weekdayTexts - e.g., ["Monday: 6:00 AM – 11:00 PM", ...]
 * @param {string} timezone - IANA timezone (e.g., "America/Chicago")
 * @returns {boolean|null} - true if open, false if closed, null if hours unavailable
 */
function calculateIsOpen(weekdayTexts, timezone = "UTC") {
  if (!weekdayTexts || weekdayTexts.length === 0) {
    return null; // No hours data available
  }

  try {
    // Get current time in the venue's timezone
    const now = new Date();
    // Validate timezone to avoid Intl errors on invalid timezones
    try {
      // Test if timezone is valid by creating formatter
      const testFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
      });
    } catch {
      console.warn(`[calculateIsOpen] Invalid timezone "${timezone}", falling back to UTC`);
      timezone = "UTC";
    }
    
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const dayName = parts.find((p) => p.type === "weekday")?.value;
    const currentHour = parseInt(
      parts.find((p) => p.type === "hour")?.value || "0",
    );
    const currentMinute = parseInt(
      parts.find((p) => p.type === "minute")?.value || "0",
    );
    const currentTimeMinutes = currentHour * 60 + currentMinute;

    // Find today's hours (e.g., "Monday: 6:00 AM – 11:00 PM" or "Monday: Closed")
    const todayHours = weekdayTexts.find((text) => text.startsWith(dayName));
    if (!todayHours) {
      return null; // Can't find today's hours
    }

    // Check if closed for the day or open 24 hours
    if (todayHours.includes("Closed")) return false;
    if (todayHours.includes("Open 24 hours")) return true;

    // Try 12-hour format first (e.g., "Monday: 6:00 AM – 11:00 PM")
    let hoursMatch = todayHours.match(
      /(\d{1,2}):(\d{2})\s*(AM|PM)\s*[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i,
    );
    let openHour24, closeHour24, openMin, closeMin;

    if (hoursMatch) {
      // Parse 12-hour AM/PM format
      const [_, openHour, oMin, openPeriod, closeHour, cMin, closePeriod] =
        hoursMatch;
      openMin = parseInt(oMin);
      closeMin = parseInt(cMin);

      openHour24 = parseInt(openHour);
      if (openPeriod.toUpperCase() === "PM" && openHour24 !== 12)
        openHour24 += 12;
      if (openPeriod.toUpperCase() === "AM" && openHour24 === 12)
        openHour24 = 0;

      closeHour24 = parseInt(closeHour);
      if (closePeriod.toUpperCase() === "PM" && closeHour24 !== 12)
        closeHour24 += 12;
      if (closePeriod.toUpperCase() === "AM" && closeHour24 === 12)
        closeHour24 = 0;
    } else {
      // Try 24-hour format (e.g., "Monday: 06:00–23:00" or "Monday: 6:00–24:00")
      hoursMatch = todayHours.match(
        /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/,
      );
      if (!hoursMatch) {
        console.warn(
          `[calculateIsOpen] Can't parse hours format: "${todayHours}"`,
        );
        return null; // Can't parse hours format
      }

      const [_, openHour, oMin, closeHour, cMin] = hoursMatch;
      openHour24 = parseInt(openHour);
      closeHour24 = parseInt(closeHour);
      openMin = parseInt(oMin);
      closeMin = parseInt(cMin);

      // Google API allows "24:00" for midnight closing
      if (closeHour24 === 24) {
        closeHour24 = 0; // Convert 24:00 to 00:00 (next day)
      }
    }

    const openTimeMinutes = openHour24 * 60 + openMin;
    let closeTimeMinutes = closeHour24 * 60 + closeMin;

    // Handle overnight hours (e.g., 23:00–02:00 or 11:00 PM - 2:00 AM)
    // Special case: If closing is 24:00 (midnight), treat as end of day
    if (closeHour24 === 0 && closeMin === 0 && openTimeMinutes > 0) {
      closeTimeMinutes = 24 * 60; // Midnight closing
    }

    if (closeTimeMinutes < openTimeMinutes) {
      // Overnight hours (closes after midnight)
      closeTimeMinutes += 24 * 60; // Add 24 hours
      if (currentTimeMinutes < openTimeMinutes) {
        // Current time is in the early AM (after midnight)
        return currentTimeMinutes + 24 * 60 < closeTimeMinutes;
      }
    }

    const isCurrentlyOpen =
      currentTimeMinutes >= openTimeMinutes &&
      currentTimeMinutes < closeTimeMinutes;

    // Debug log
    console.log(
      `[calculateIsOpen] ${todayHours} → open: ${openHour24}:${openMin.toString().padStart(2, "0")} (${openTimeMinutes}min), close: ${closeHour24}:${closeMin.toString().padStart(2, "0")} (${closeTimeMinutes}min), now: ${currentHour}:${currentMinute.toString().padStart(2, "0")} (${currentTimeMinutes}min) → ${isCurrentlyOpen ? "OPEN" : "CLOSED"}`,
    );

    return isCurrentlyOpen;
  } catch (error) {
    console.error(`[calculateIsOpen] Error parsing hours:`, error.message);
    return null; // Parsing error - can't determine
  }
}

/**
 * Generate cache key from coordinates (rounded to ~10m precision)
 */
function getCoordsKey(lat, lng) {
  // Round to 4 decimal places (~11m precision) for cache hits on nearby coords
  return `${lat.toFixed(4)}_${lng.toFixed(4)}`;
}

/**
 * Get place details from Google Places API (New) with caching and retry logic
 * @param {number} lat
 * @param {number} lng
 * @param {string} name - Venue name for verification
 * @param {string} timezone - IANA timezone for accurate hours calculation
 * @returns {Promise<Object>} {place_id, business_status, ...}
 */
async function getPlaceDetails(lat, lng, name, timezone = "UTC") {
  const coordsKey = getCoordsKey(lat, lng);

  // 1. Check in-memory cache first (fastest)
  const memCached = placesMemoryCache.get(coordsKey);
  if (memCached && (Date.now() - memCached.cachedAt) < CACHE_TTL_MS) {
    venuesLog.info(`Places CACHE HIT (memory): "${name}"`, OP.CACHE);
    // Recalculate isOpen with current timezone (hours data is cached, not the open status)
    const isOpen = calculateIsOpen(memCached.allHours, timezone);
    return { ...memCached, isOpen };
  }

  // 2. Check database cache (second fastest)
  try {
    const [dbCached] = await db.select().from(places_cache).where(eq(places_cache.place_id, coordsKey)).limit(1);
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
          .where(eq(places_cache.place_id, coordsKey))
          .catch(() => {}); // Fire and forget
        // Recalculate isOpen with current timezone
        const isOpen = calculateIsOpen(cached.allHours, timezone);
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
              radius: 150.0, // 150m radius - GPT coords can be slightly off, find nearest venue
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
        const isOpen = calculateIsOpen(weekdayTexts, timezone);


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
        db.insert(places_cache)
          .values({
            place_id: coordsKey,
            formatted_hours: result,
            cached_at: new Date(),
            access_count: 1
          })
          .onConflictDoUpdate({
            target: places_cache.place_id,
            set: {
              formatted_hours: result,
              cached_at: new Date(),
              access_count: 1
            }
          })
          .catch(err => venuesLog.warn(3, `Places cache write failed: ${err.message}`, OP.CACHE));

        return result;
      }

      venuesLog.warn(3, `Places API: No results for "${name}" at ${lat.toFixed(4)},${lng.toFixed(4)}`, OP.API);

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
 * @param {string} name1 - GPT-5 venue name
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