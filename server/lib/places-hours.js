/**
 * PLACES API (New) - Business Hours (Regular + Holiday Hours)
 * 
 * Retrieves real-time business hours including:
 * - Regular weekly schedule
 * - Holiday hours (via currentOpeningHours)
 * - Open/closed status
 * 
 * Migration: Converted from Places API (Old) to Places API (New) for consistency
 * Uses POST requests with X-Goog-Api-Key and X-Goog-FieldMask headers
 * 
 * Cost: Basic Data category billing
 */

const PLACES_API_BASE_URL = 'https://places.googleapis.com/v1';

/**
 * Get business hours for a place using Places API (New)
 * @param {string} placeId - Google Place ID
 * @returns {Promise<{openNow, weekdayText, currentHours, periods}>}
 */
export async function getPlaceHours(placeId) {
  try {
    // Places API (New): GET /v1/places/{place_id}
    const url = `${PLACES_API_BASE_URL}/places/${placeId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'displayName,formattedAddress,location,currentOpeningHours,regularOpeningHours,businessStatus'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Places API (New)] Error ${response.status}: ${errorText}`);
      throw new Error(`Places API failed: ${response.status}`);
    }

    const place = await response.json();
    
    // Extract opening hours (prioritize currentOpeningHours for holiday-adjusted hours)
    const hours = place.currentOpeningHours || place.regularOpeningHours;
    const weekdayTexts = hours?.weekdayDescriptions || [];
    const periods = hours?.periods || [];
    
    const hoursData = {
      name: place.displayName?.text || null,
      address: place.formattedAddress || null,
      lat: place.location?.latitude || null,
      lng: place.location?.longitude || null,
      openNow: hours?.openNow || false,
      weekdayText: weekdayTexts,
      periods: periods,
      currentHours: place.currentOpeningHours?.weekdayDescriptions || null, // Holiday-adjusted hours
      hasHolidayHours: !!place.currentOpeningHours
    };

    // Cache the hours data (non-blocking)
    if (hours) {
      try {
        const { db } = await import('../db/drizzle.js');
        const { sql } = await import('drizzle-orm');
        
        await db.execute(sql`
          INSERT INTO places_cache (place_id, formatted_hours, cached_at, access_count)
          VALUES (${placeId}, ${JSON.stringify(hours)}, NOW(), 1)
          ON CONFLICT (place_id) DO UPDATE
          SET formatted_hours = EXCLUDED.formatted_hours,
              cached_at = NOW(),
              access_count = places_cache.access_count + 1
        `);
      } catch (cacheErr) {
        console.warn(`⚠️ Places cache upsert skipped for ${placeId}:`, cacheErr.message);
      }
    }
    
    return hoursData;
  } catch (error) {
    console.error('[Places API (New)] getPlaceHours failed:', error.message);
    throw error;
  }
}

/**
 * Search for place ID by name and location using Text Search API (New)
 * @param {string} name - Business name
 * @param {Object} location - {lat, lng}
 * @returns {Promise<string>} Place ID
 */
export async function findPlaceId(name, location) {
  try {
    // Places API (New): POST /v1/places:searchText
    const url = `${PLACES_API_BASE_URL}/places:searchText`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName'
      },
      body: JSON.stringify({
        textQuery: name,
        locationBias: {
          circle: {
            center: {
              latitude: location.lat,
              longitude: location.lng
            },
            radius: 500.0 // 500m radius for text search
          }
        },
        maxResultCount: 1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Places API (New)] Error ${response.status}: ${errorText}`);
      throw new Error(`Places API failed: ${response.status}`);
    }

    const data = await response.json();

    if (!data.places || data.places.length === 0) {
      throw new Error(`No place found for: ${name}`);
    }

    return data.places[0].id;
  } catch (error) {
    console.error('[Places API (New)] findPlaceId failed:', error.message);
    throw error;
  }
}

/**
 * Search for place by text name and return place_id + coordinates using Text Search API (New)
 * Used for name-to-place_id resolution per architectural guidance
 * @param {Object} params
 * @param {string} params.text - Business name or search text
 * @param {number} [params.lat] - Optional latitude for location bias
 * @param {number} [params.lng] - Optional longitude for location bias
 * @param {string} [params.apiKey] - Google Maps API key
 * @returns {Promise<{place_id, lat, lng, formatted_address}>}
 */
export async function findPlaceIdByText({ text, lat, lng, apiKey = process.env.GOOGLE_MAPS_API_KEY }) {
  try {
    // Places API (New): POST /v1/places:searchText
    const url = `${PLACES_API_BASE_URL}/places:searchText`;

    const requestBody = {
      textQuery: text,
      maxResultCount: 1
    };

    // Add location bias if coordinates provided
    if (lat != null && lng != null) {
      requestBody.locationBias = {
        circle: {
          center: {
            latitude: lat,
            longitude: lng
          },
          radius: 500.0 // 500m radius for text search
        }
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.location,places.displayName,places.formattedAddress'
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Places API (New)] Error ${response.status}: ${errorText}`);
      throw new Error(`Places API failed: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.places || data.places.length === 0) {
      throw new Error(`places_no_match: ${text}`);
    }

    const place = data.places[0];
    
    if (!place.id) {
      throw new Error('places_no_match');
    }

    console.log(`🔍 [Places API (New)] Found place_id for "${text}": ${place.id}`);

    return {
      place_id: place.id,
      lat: place.location?.latitude || null,
      lng: place.location?.longitude || null,
      formatted_address: place.formattedAddress || null
    };
  } catch (error) {
    console.error('[Places API (New)] findPlaceIdByText failed:', error.message);
    throw error;
  }
}

/**
 * Check if a place is currently open
 * @param {string} placeId - Google Place ID
 * @returns {Promise<boolean>}
 */
export async function isPlaceOpen(placeId) {
  try {
    const hours = await getPlaceHours(placeId);
    return hours.openNow;
  } catch (error) {
    console.error('[Places API] isPlaceOpen failed:', error.message);
    return null; // Unknown status
  }
}

/**
 * Format hours array into concise human-readable format
 * @param {string[]} hoursArray - Array like ["Monday: 10:00 AM – 10:00 PM", ...]
 * @returns {string} - Formatted like "Mon-Sun: 11am-10pm"
 */
function formatHoursCompact(hoursArray) {
  if (!hoursArray || hoursArray.length === 0) return null;
  
  // Handle "Open 24 hours" case
  if (hoursArray[0].includes('Open 24 hours')) {
    return 'Open 24 hours';
  }
  
  // Extract day and hours
  const schedule = hoursArray.map(line => {
    const [day, hours] = line.split(': ');
    return { day, hours: hours || 'Closed' };
  });
  
  // Group consecutive days with same hours
  const groups = [];
  let currentGroup = { days: [schedule[0].day], hours: schedule[0].hours };
  
  for (let i = 1; i < schedule.length; i++) {
    if (schedule[i].hours === currentGroup.hours) {
      currentGroup.days.push(schedule[i].day);
    } else {
      groups.push(currentGroup);
      currentGroup = { days: [schedule[i].day], hours: schedule[i].hours };
    }
  }
  groups.push(currentGroup);
  
  // Format each group
  const formatted = groups.map(group => {
    const dayRange = group.days.length === 1 
      ? group.days[0].slice(0, 3) 
      : `${group.days[0].slice(0, 3)}-${group.days[group.days.length - 1].slice(0, 3)}`;
    
    // Simplify hours (remove AM/PM, use lowercase)
    const simpleHours = group.hours
      .replace(/ AM/g, 'am')
      .replace(/ PM/g, 'pm')
      .replace(':00', '')
      .replace(' – ', '-');
    
    return `${dayRange}: ${simpleHours}`;
  }).join(', ');
  
  return formatted;
}

/**
 * Get formatted hours for display (ONLY business metadata, no coordinates)
 * Per architectural guidance: Places Details is ONLY for opening_hours and business_status
 * Coordinates should come from Geocoding API, not Places API
 * @param {string} placeId - Google Place ID
 * @returns {Promise<{status, hours, hasSpecialHours}>}
 */
export async function getFormattedHours(placeId) {
  try {
    const data = await getPlaceHours(placeId);
    const hoursArray = data.currentHours || data.weekdayText;
    
    return {
      status: data.openNow ? 'open' : 'closed',
      hours: formatHoursCompact(hoursArray),
      hasSpecialHours: data.hasHolidayHours
    };
  } catch (error) {
    console.error('[Places API] getFormattedHours failed:', error.message);
    return {
      status: 'unknown',
      hours: null,
      hasSpecialHours: false
    };
  }
}

/**
 * Get business hours ONLY for a place (no coordinates per architectural guidance) using Places API (New)
 * @param {string} placeId - Google Place ID
 * @returns {Promise<{status, hours, weekdayText}>}
 */
export async function getBusinessHoursOnly(placeId) {
  try {
    // Places API (New): GET /v1/places/{place_id}
    const url = `${PLACES_API_BASE_URL}/places/${placeId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'currentOpeningHours,regularOpeningHours,businessStatus'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Places API (New)] Error ${response.status}: ${errorText}`);
      throw new Error(`Places API failed: ${response.status}`);
    }

    const place = await response.json();
    
    const hours = place.currentOpeningHours || place.regularOpeningHours;
    const weekdayTexts = hours?.weekdayDescriptions || [];
    
    return {
      status: hours?.openNow ? 'open' : 'closed',
      hours: formatHoursCompact(weekdayTexts),
      weekdayText: weekdayTexts,
      hasHolidayHours: !!place.currentOpeningHours
    };
  } catch (error) {
    console.error('[Places API (New)] getBusinessHoursOnly failed:', error.message);
    throw error;
  }
}
