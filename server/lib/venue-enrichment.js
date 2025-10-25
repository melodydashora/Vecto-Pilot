/**
 * VENUE ENRICHMENT LAYER
 * 
 * Takes minimal GPT-5 output (coords + category + tips) and enriches with Google APIs:
 * - Places API (New): Resolve addresses, business status, place details
 * - Routes API (New): Calculate accurate distances and drive times with traffic
 * 
 * Architecture: Separate AI reasoning (GPT-5) from factual lookups (Google)
 */

import { getRouteWithTraffic } from './routes-api.js';
import { getPlaceHours, findPlaceIdByText } from './places-hours.js';
import { upsertPlace } from './places-cache.js';

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PLACES_NEW_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

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

  const timezone = snapshot?.timezone || 'America/Chicago'; // Fallback to CDT
  console.log(`[Venue Enrichment] Enriching ${venues.length} venues (timezone: ${timezone})...`);

  // Parallelize all enrichments for speed
  const enriched = await Promise.all(
    venues.map(async (venue, index) => {
      try {
        // 1. Reverse geocode coords → address
        const address = await reverseGeocode(venue.lat, venue.lng);

        // 2. Calculate distance + drive time with traffic
        const route = await getRouteWithTraffic(
          driverLocation,
          { lat: venue.lat, lng: venue.lng }
        );

        // 3. Get place details from Google Places API (New) with timezone
        const placeDetails = await getPlaceDetails(venue.lat, venue.lng, venue.name, timezone);

        // 4. Cache stable data in database
        if (placeDetails?.place_id) {
          await upsertPlace({
            place_id: placeDetails.place_id,
            name: venue.name,
            formatted_address: address,
            lat: venue.lat,
            lng: venue.lng
          });
        } else {
          console.warn(`[Venue Enrichment] ⚠️ No place_id found for "${venue.name}" - coords will be preserved`);
        }

        const enrichedVenue = {
          ...venue,
          rank: index + 1,
          // Google-enriched data (camelCase for consistency with blocks route)
          address: address || 'Address unavailable',
          placeId: placeDetails?.place_id || null,
          businessStatus: placeDetails?.business_status || 'UNKNOWN',
          isOpen: placeDetails?.isOpen ?? null,
          businessHours: placeDetails?.businessHours || null,
          distanceMeters: route.distanceMeters,
          distanceMiles: (route.distanceMeters * 0.000621371).toFixed(1),
          driveTimeMinutes: Math.ceil(route.durationSeconds / 60),
          trafficDelayMinutes: Math.ceil(route.trafficDelaySeconds / 60),
          distanceSource: 'google_routes_api' // For ML training
        };

        console.log(`[Venue Enrichment] ✅ "${venue.name}": placeId=${enrichedVenue.placeId ? 'YES' : 'NO'}, coords=${enrichedVenue.lat},${enrichedVenue.lng}`);
        return enrichedVenue;
      } catch (error) {
        console.error(`[Venue Enrichment] Failed to enrich venue "${venue.name}":`, error.message);

        // CRITICAL: Always preserve GPT-5 coords even if enrichment fails
        return {
          ...venue,
          rank: index + 1,
          lat: venue.lat,  // Preserve GPT-5 coords
          lng: venue.lng,  // Preserve GPT-5 coords
          address: 'Unavailable',
          placeId: null,
          distanceMeters: null,
          distanceMiles: null,
          driveTimeMinutes: null,
          distanceSource: 'enrichment_failed'
        };
      }
    })
  );

  console.log(`[Venue Enrichment] ✅ Enriched ${enriched.length} venues`);
  return enriched;
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

    if (data.status === 'OK' && data.results?.length > 0) {
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
  const days = weekdayTexts.map(text => {
    const match = text.match(/^(\w+):\s*(.+)$/);
    if (!match) return null;

    const [, day, hours] = match;

    // Skip closed days
    if (/closed/i.test(hours)) return null;

    // Simplify hours format: "6:00 AM – 10:00 PM" → "6AM-10PM"
    const simplified = hours
      .replace(/(\d+):00\s*/g, '$1')  // Remove :00
      .replace(/\s*–\s*/g, '-')        // Replace – with -
      .replace(/\s+/g, '');            // Remove spaces

    return { day, hours: simplified };
  }).filter(Boolean);

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
  const formatted = groups.map(group => {
    const startDay = group[0].day.slice(0, 3); // Mon, Tue, etc.
    const endDay = group[group.length - 1].day.slice(0, 3);
    const dayRange = group.length === 1 ? startDay : `${startDay}-${endDay}`;
    return `${dayRange}: ${group[0].hours}`;
  });

  return formatted.join(', ');
}

/**
 * Calculate if venue is currently open based on Google hours and snapshot timezone
 * @param {Array<string>} weekdayTexts - e.g., ["Monday: 6:00 AM – 11:00 PM", ...]
 * @param {string} timezone - IANA timezone (e.g., "America/Chicago")
 * @returns {boolean|null} - true if open, false if closed, null if hours unavailable
 */
function calculateIsOpen(weekdayTexts, timezone) {
  if (!weekdayTexts || weekdayTexts.length === 0) {
    return null; // No hours data available
  }

  try {
    // Get current time in the venue's timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(now);
    const dayName = parts.find(p => p.type === 'weekday')?.value;
    const currentHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const currentMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    const currentTimeMinutes = currentHour * 60 + currentMinute;

    // Find today's hours (e.g., "Monday: 6:00 AM – 11:00 PM" or "Monday: Closed")
    const todayHours = weekdayTexts.find(text => text.startsWith(dayName));
    if (!todayHours) {
      return null; // Can't find today's hours
    }

    // Check if closed for the day
    if (todayHours.includes('Closed') || todayHours.includes('Open 24 hours')) {
      return todayHours.includes('Open 24 hours');
    }

    // Parse hours (e.g., "Monday: 6:00 AM – 11:00 PM")
    const hoursMatch = todayHours.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!hoursMatch) {
      return null; // Can't parse hours format
    }

    const [_, openHour, openMin, openPeriod, closeHour, closeMin, closePeriod] = hoursMatch;

    // Convert to 24-hour format
    let openHour24 = parseInt(openHour);
    if (openPeriod.toUpperCase() === 'PM' && openHour24 !== 12) openHour24 += 12;
    if (openPeriod.toUpperCase() === 'AM' && openHour24 === 12) openHour24 = 0;
    
    let closeHour24 = parseInt(closeHour);
    if (closePeriod.toUpperCase() === 'PM' && closeHour24 !== 12) closeHour24 += 12;
    if (closePeriod.toUpperCase() === 'AM' && closeHour24 === 12) closeHour24 = 0;

    const openTimeMinutes = openHour24 * 60 + parseInt(openMin);
    let closeTimeMinutes = closeHour24 * 60 + parseInt(closeMin);

    // Handle overnight hours (e.g., 11:00 PM - 2:00 AM)
    if (closeTimeMinutes < openTimeMinutes) {
      closeTimeMinutes += 24 * 60; // Add 24 hours
      if (currentTimeMinutes < openTimeMinutes) {
        // If current time is AM, add 24 hours to compare with overnight closing
        return currentTimeMinutes + (24 * 60) < closeTimeMinutes;
      }
    }

    return currentTimeMinutes >= openTimeMinutes && currentTimeMinutes < closeTimeMinutes;
  } catch (error) {
    console.error(`[calculateIsOpen] Error parsing hours:`, error.message);
    return null; // Parsing error - can't determine
  }
}

/**
 * Get place details from Google Places API (New)
 * @param {number} lat
 * @param {number} lng
 * @param {string} name - Venue name for verification
 * @param {string} timezone - IANA timezone for accurate hours calculation
 * @returns {Promise<Object>} {place_id, business_status, ...}
 */
async function getPlaceDetails(lat, lng, name, timezone = 'America/Chicago') {
  try {
    // Use Places API (New) - Search Nearby
    const response = await fetch(PLACES_NEW_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.businessStatus,places.formattedAddress,places.currentOpeningHours,places.regularOpeningHours,places.utcOffsetMinutes'
      },
      body: JSON.stringify({
        locationRestriction: {
          circle: {
            center: {
              latitude: lat,
              longitude: lng
            },
            radius: 100.0 // 100 meter radius for better venue matching
          }
        },
        maxResultCount: 1
      })
    });

    if (!response.ok) {
      throw new Error(`Places API returned ${response.status}`);
    }

    const data = await response.json();

    if (data.places && data.places.length > 0) {
      const place = data.places[0];

      // Extract business hours
      const hours = place.currentOpeningHours || place.regularOpeningHours;
      const weekdayTexts = hours?.weekdayDescriptions || [];

      // CRITICAL: Calculate isOpen ourselves using snapshot timezone (don't trust Google's openNow)
      const isOpen = calculateIsOpen(weekdayTexts, timezone);
      
      // DEBUG: Log raw hours and calculated status
      if (weekdayTexts.length > 0) {
        console.log(`[Places API] "${name}" - Calculated isOpen: ${isOpen} (timezone: ${timezone})`);
        console.log(`[Places API] Raw hours:`, weekdayTexts);
        console.log(`[Places API] Google's openNow was: ${hours?.openNow} (we calculate our own)`);
      }

      // Condense weekly hours into readable format
      const condensedHours = condenseWeeklyHours(weekdayTexts);

      return {
        place_id: place.id,
        business_status: place.businessStatus || 'OPERATIONAL',
        formatted_address: place.formattedAddress,
        isOpen: isOpen,
        businessHours: condensedHours || null,
        allHours: weekdayTexts
      };
    }

    return null;
  } catch (error) {
    console.error(`[Places API] Failed for ${name}:`, error.message);
    return null;
  }
}