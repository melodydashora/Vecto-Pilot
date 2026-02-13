// server/lib/venue/venue-intelligence.js
// Real-time venue intelligence using Google Places API (New) for bar discovery
// Provides: upscale bars/lounges sorted by expense, filtered by operating hours
// Uses Haiku for fast filtering of non-bar venues
//
// Updated 2026-01-05: Migrated from nearby_venues to venue_catalog
// See: /home/runner/.claude/plans/noble-purring-yeti.md

import { db } from '../../db/drizzle.js';
import { venue_catalog } from '../../../shared/schema.js';
import { eq, and, or } from 'drizzle-orm';
import { callModel } from '../ai/adapters/index.js';
// 2026-02-13: Removed direct callGemini import — traffic call now uses callModel('VENUE_TRAFFIC')
import { barsLog, placesLog, venuesLog, aiLog } from '../../logger/workflow.js';
import { generateCoordKey, normalizeVenueName } from './venue-utils.js';
// 2026-01-14: Cache First pattern - check database before calling Google Places API
import { getVenuesByType } from './venue-cache.js';
import { extractDistrictFromVenueName, normalizeDistrictSlug } from './district-detection.js';
// 2026-01-10: D-014 Phase 4 - Use canonical hours module directly for all isOpen calculations
import { parseGoogleWeekdayText, getOpenStatus } from './hours/index.js';

// API Keys
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Convert Google priceLevel to expense display
 */
function getPriceDisplay(priceLevel) {
  switch (priceLevel) {
    case 'PRICE_LEVEL_VERY_EXPENSIVE': return { level: '$$$$', rank: 4 };
    case 'PRICE_LEVEL_EXPENSIVE': return { level: '$$$', rank: 3 };
    case 'PRICE_LEVEL_MODERATE': return { level: '$$', rank: 2 };
    case 'PRICE_LEVEL_INEXPENSIVE': return { level: '$', rank: 1 };
    default: return { level: '$$', rank: 2 }; // Default to moderate
  }
}

/**
 * Calculate if venue is open, time until close, and time until open
 * 2026-01-09: Added opens_in_minutes for "opening soon" UI feature
 */
function calculateOpenStatus(place, timezone) {
  const hours = place.currentOpeningHours || place.regularOpeningHours;
  if (!hours) {
    barsLog.info(`No hours data for "${place.displayName?.text}" - Google didn't return opening hours`);
    return { is_open: null, hours_today: null, closing_soon: false, minutes_until_close: null, opens_in_minutes: null };
  }

  // 2026-01-10: D-014 Phase 4 - Use canonical hours module for consistent evaluation
  const weekdayDescs = hours.weekdayDescriptions || [];
  let is_open = null;
  let canonicalStatus = null;

  // Try canonical calculation first (requires timezone + weekday descriptions)
  if (timezone && weekdayDescs.length > 0) {
    const parseResult = parseGoogleWeekdayText(weekdayDescs);
    if (parseResult.ok) {
      canonicalStatus = getOpenStatus(parseResult.schedule, timezone);
      is_open = canonicalStatus.is_open;
      barsLog.info(`"${place.displayName?.text}" - Calculated is_open=${is_open} from weekdayDescriptions (canonical)`);
    }
  }

  // 2026-01-10: D-018 Fix - openNow is ONLY for debug comparison, NOT as truth
  // Per CLAUDE.md: Never trust Google's openNow directly. Always parse weekdayDescriptions.
  if (hours.openNow !== undefined && is_open !== null) {
    // Log discrepancy for debugging (don't override canonical result)
    if (hours.openNow !== is_open) {
      barsLog.warn(`"${place.displayName?.text}" - openNow DISCREPANCY: Google=${hours.openNow}, Canonical=${is_open} (using canonical)`);
    }
  } else if (is_open === null && hours.openNow !== undefined) {
    // No canonical data available - log warning but still don't use openNow as truth
    barsLog.warn(`"${place.displayName?.text}" - Cannot calculate is_open (no weekdayDescriptions), Google openNow=${hours.openNow} (NOT USED)`);
  }

  // Get today's hours - NO FALLBACK, timezone required for accurate venue status
  if (!timezone) {
    barsLog.warn(`"${place.displayName?.text}" - Missing timezone, cannot determine today's hours`);
    return {
      is_open,
      hours_today: null,
      closing_soon: false,
      minutes_until_close: null,
      opens_in_minutes: null,
      weekday_descriptions: hours.weekdayDescriptions || []
    };
  }
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long'
  });
  const todayName = formatter.format(now);

  // Find today in weekdayDescriptions (weekdayDescs already defined above)
  const todayHours = weekdayDescs.find(d =>
    d.toLowerCase().startsWith(todayName.toLowerCase())
  );

  // Parse hours_today from weekday description (e.g., "Thursday: 4:00 PM – 2:00 AM")
  let hours_today = null;
  if (todayHours) {
    const match = todayHours.match(/:\s*(.+)$/);
    hours_today = match ? match[1].trim() : todayHours;
  }

  // Debug log for hours parsing
  if (!hours_today && weekdayDescs.length > 0) {
    barsLog.info(`"${place.displayName?.text}" - Could not find ${todayName} in weekdayDescriptions`);
  }

  // 2026-01-10: D-014 Phase 4 - Use canonical status data when available
  // The canonical evaluator already calculates these values accurately
  let closing_soon = canonicalStatus?.closing_soon || false;
  let minutes_until_close = canonicalStatus?.minutes_until_close || null;
  let opens_in_minutes = canonicalStatus?.minutes_until_open || null;

  // Fallback: If canonical status not available but we have Google periods data, calculate manually
  if (!canonicalStatus && hours.periods && timezone) {
    // Get current time in venue's timezone
    const localFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = localFormatter.formatToParts(now);
    const currentHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const currentMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    const currentMinutes = currentHour * 60 + currentMinute;

    // Calculate opens_in_minutes for closed venues
    if (is_open === false) {
      for (const period of hours.periods) {
        if (period.open?.hour !== undefined) {
          let openMinutes = period.open.hour * 60 + (period.open.minute || 0);
          if (openMinutes > currentMinutes) {
            opens_in_minutes = openMinutes - currentMinutes;
            break;
          }
        }
      }
    }

    // Calculate minutes until close for open venues
    if (is_open) {
      for (const period of hours.periods) {
        if (period.close?.hour !== undefined) {
          let closeMinutes = period.close.hour * 60 + (period.close.minute || 0);
          if (closeMinutes < currentMinutes) {
            closeMinutes += 24 * 60;
          }
          minutes_until_close = closeMinutes - currentMinutes;
          if (minutes_until_close <= 60) {
            closing_soon = true;
          }
          break;
        }
      }
    }
  }

  return { is_open, hours_today, closing_soon, minutes_until_close, opens_in_minutes };
}

/**
 * Fast food and chain restaurants to exclude (not real bars/lounges)
 */
const EXCLUDED_VENUES = new Set([
  'mcdonald', 'wendy', 'burger king', 'taco bell', 'pizza hut', 'domino',
  'subway', 'chick-fil-a', 'popeyes', 'kfc', 'arby', 'sonic', 'jack in the box',
  'whataburger', 'five guys', 'in-n-out', 'chipotle', 'panda express',
  'dunkin', 'starbucks', 'panera', 'jimmy john', 'jersey mike', 'firehouse sub',
  'little caesars', 'papa john', 'papa murphy', 'marco\'s pizza', 'cicis',
  'waffle house', 'ihop', 'denny', 'cracker barrel', 'golden corral',
  'creamery', 'ice cream', 'frozen yogurt', 'baskin', 'dairy queen', 'coldstone',
  'smoothie', 'jamba', 'tropical smoothie', 'orange julius',
  'cvs', 'walgreens', 'walmart', 'target', 'kroger', 'albertsons', 'safeway',
  '7-eleven', 'circle k', 'racetrac', 'quiktrip', 'loves', 'pilot',
  'shell', 'exxon', 'chevron', 'bp', 'mobil', 'texaco', 'valero'
]);

/**
 * Haversine distance calculation (miles)
 * Used for Cache First pattern to filter cached venues within search radius
 * 2026-01-14: Added for database-first venue lookup
 */
function toRadians(deg) {
  return deg * (Math.PI / 180);
}

function haversineDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Check if venue name suggests it's not a real bar/lounge
 */
function isExcludedVenue(name) {
  const lower = name.toLowerCase();
  for (const excluded of EXCLUDED_VENUES) {
    if (lower.includes(excluded)) return true;
  }
  return false;
}

/**
 * Use Haiku to filter venues - fast and cheap
 * Returns only actual upscale bars, lounges, nightclubs, wine bars
 */
async function filterVenuesWithLLM(venues) {
  if (venues.length === 0) return [];

  const venueList = venues.map((v, i) => `${i + 1}. ${v.name} (${v.expense_level})`).join('\n');

  const prompt = `You are filtering a list of venues for a rideshare driver looking for UPSCALE BARS to find passengers.

KEEP only: Actual bars, lounges, nightclubs, wine bars, cocktail bars, speakeasies, rooftop bars, hotel bars, upscale restaurants with prominent bar areas (steakhouses, fine dining)

REMOVE: Fast food, pizza places, ice cream shops, coffee shops, casual chain restaurants (Applebee's, Chili's, etc.), grocery stores, gas stations, convenience stores, any $ (cheap) venues

Venue list:
${venueList}

Return ONLY a JSON array of the numbers to KEEP. Example: [1, 3, 5, 7]
If none qualify, return: []`;

  try {
    barsLog.phase(1, `Filtering ${venues.length} venues with VENUE_FILTER role...`);
    const result = await callModel('VENUE_FILTER', {
      system: 'You are a venue filter. Return ONLY a JSON array of numbers. No explanation.',
      user: prompt,
      maxTokens: 200,
      temperature: 0
    });

    if (!result.ok) {
      aiLog.warn(1, `VENUE_FILTER role failed: ${result.error}`);
      return venues; // Return unfiltered on error
    }

    // Parse the response - extract JSON array
    const match = result.output.match(/\[[\d,\s]*\]/);
    if (!match) {
      aiLog.warn(1, `Could not parse Haiku filter response: ${result.output}`);
      return venues;
    }

    const keepIndices = JSON.parse(match[0]);
    const filtered = keepIndices
      .map(i => venues[i - 1]) // Convert 1-indexed to 0-indexed
      .filter(Boolean);

    barsLog.done(1, `Haiku kept ${filtered.length}/${venues.length} venues`);
    return filtered;
  } catch (error) {
    aiLog.warn(1, `LLM venue filter error: ${error.message}`);
    return venues; // Return unfiltered on error
  }
}

/**
 * Discover nearby upscale bars and lounges using Google Places API (New)
 * @param {Object} params - Discovery parameters
 * @param {number} params.lat - Driver latitude
 * @param {number} params.lng - Driver longitude
 * @param {string} params.city - City name
 * @param {string} params.state - State/region
 * @param {number} params.radiusMiles - Search radius in miles (default 25)
 * @param {string} [params.timezone] - Timezone for accurate hours display
 * @returns {Promise<Object>} Venue intelligence with sorted venues
 */
export async function discoverNearbyVenues({ lat, lng, city, state, radiusMiles = 25, timezone = null }) {
  if (!GOOGLE_MAPS_API_KEY) {
    barsLog.warn(1, `GOOGLE_MAPS_API_KEY not set`);
    return {
      query_time: new Date().toLocaleTimeString(),
      location: `${city}, ${state}`,
      total_venues: 0,
      venues: [],
      last_call_venues: []
    };
  }

  // Cap radius at 50km (Google Places limit)
  const radiusMeters = Math.min(radiusMiles * 1609.34, 50000);
  barsLog.start(`${city}, ${state} (${Math.round(radiusMeters/1609.34)} mile radius)`);

  // ==========================================================================
  // STEP 0: CACHE FIRST PATTERN
  // Check database before calling Google Places API to avoid redundant API calls
  // 2026-01-14: Added to reduce API costs and improve response time
  // ==========================================================================
  try {
    const cachedBars = await getVenuesByType({
      venueTypes: ['bar', 'nightclub', 'wine_bar'],
      city,
      state,
      limit: 100 // Get more than we need, filter by distance
    });

    if (cachedBars.length > 0) {
      barsLog.phase(0, `Found ${cachedBars.length} cached venues in ${city}, ${state}`);

      // Filter to venues within search radius using Haversine distance
      const nearbyBars = cachedBars.filter(v => {
        if (!v.lat || !v.lng) return false;
        const distance = haversineDistanceMiles(lat, lng, v.lat, v.lng);
        return distance <= radiusMiles;
      });

      barsLog.phase(0, `${nearbyBars.length} venues within ${radiusMiles} mile radius`);

      // If we have 5+ cached venues, re-hydrate with live status and return
      // This threshold ensures we don't serve stale data when cache is sparse
      if (nearbyBars.length >= 5) {
        barsLog.phase(0, `Using ${nearbyBars.length} cached venues (Cache First)`);

        // Re-hydrate cached venues with live open status calculations
        const rehydrated = nearbyBars.map(v => {
          // Build a mock place object for calculateOpenStatus
          const mockPlace = {
            displayName: { text: v.venue_name },
            currentOpeningHours: v.business_hours ? {
              weekdayDescriptions: v.business_hours.weekdayDescriptions || []
            } : null,
            regularOpeningHours: v.hours_full_week ? {
              weekdayDescriptions: v.hours_full_week.weekdayDescriptions || []
            } : null
          };

          const openStatus = calculateOpenStatus(mockPlace, timezone);

          return {
            name: v.venue_name,
            type: v.category || 'bar',
            address: v.formatted_address || v.address || '',
            phone: null,
            expense_level: v.expense_rank === 4 ? '$$$$' : v.expense_rank === 3 ? '$$$' : v.expense_rank === 2 ? '$$' : '$',
            expense_rank: v.expense_rank || 2,
            isOpen: openStatus.is_open,
            is_open: openStatus.is_open,
            hours_today: openStatus.hours_today,
            closing_soon: openStatus.closing_soon,
            minutes_until_close: openStatus.minutes_until_close,
            opens_in_minutes: openStatus.opens_in_minutes,
            rating: null,
            crowd_level: v.crowd_level || 'medium',
            rideshare_potential: v.rideshare_potential || 'medium',
            lat: v.lat,
            lng: v.lng,
            place_id: v.place_id,
            google_types: v.venue_types || [],
            distance_miles: haversineDistanceMiles(lat, lng, v.lat, v.lng).toFixed(1),
            from_cache: true // Flag to indicate cached data
          };
        });

        // Apply same filtering as Google Places results
        // Filter to only $$+ venues with known hours
        const filteredVenues = rehydrated.filter(v => {
          if (v.expense_rank < 2) return false;
          if (v.isOpen === true) return true;
          if (v.isOpen === false && v.expense_rank >= 3) {
            v.closed_go_anyway = true;
            v.closed_reason = "High-value venue - good for staging spillover";
            return true;
          }
          return false; // Skip unknown hours
        });

        // Sort by open status, expense, then distance
        filteredVenues.sort((a, b) => {
          const aOpen = a.isOpen === true;
          const bOpen = b.isOpen === true;
          if (aOpen && !bOpen) return -1;
          if (!aOpen && bOpen) return 1;
          if ((b.expense_rank || 0) !== (a.expense_rank || 0)) {
            return (b.expense_rank || 0) - (a.expense_rank || 0);
          }
          return parseFloat(a.distance_miles) - parseFloat(b.distance_miles);
        });

        const lastCallVenues = filteredVenues.filter(v => v.isOpen && v.closing_soon);

        barsLog.complete(`${filteredVenues.length} venues from cache (${filteredVenues.filter(v => v.isOpen).length} open)`);

        return {
          query_time: new Date().toLocaleTimeString(),
          location: `${city}, ${state}`,
          total_venues: filteredVenues.length,
          venues: filteredVenues,
          last_call_venues: lastCallVenues,
          search_sources: ['Database Cache']
        };
      }
    }
  } catch (cacheErr) {
    // Non-blocking: if cache lookup fails, fall through to Google Places API
    barsLog.warn(0, `Cache lookup failed, falling back to API: ${cacheErr.message}`);
  }
  // ==========================================================================
  // END CACHE FIRST PATTERN - Fall through to Google Places API
  // ==========================================================================

  try {
    // Call Google Places API (New) - searchNearby
    // Focus on bar-specific types only (not generic 'restaurant')
    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.businessStatus,places.formattedAddress,places.nationalPhoneNumber,places.currentOpeningHours,places.regularOpeningHours,places.priceLevel,places.rating,places.location,places.primaryType,places.types'
      },
      body: JSON.stringify({
        // Only bar-focused types - no generic 'restaurant' which returns fast food
        includedTypes: ['bar', 'night_club', 'wine_bar'],
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: radiusMeters
          }
        },
        maxResultCount: 20,
        rankPreference: 'DISTANCE'
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      placesLog.error(1, `Google Places API error ${response.status}: ${errText}`);
      throw new Error(`Google Places API error: ${response.status}`);
    }

    const data = await response.json();
    const places = data.places || [];

    barsLog.phase(1, `Google Places returned ${places.length} venues`);

    // Transform Google Places data to our venue format
    let venues = places.map(place => {
      const price = getPriceDisplay(place.priceLevel);
      const openStatus = calculateOpenStatus(place, timezone);
      const type = place.primaryType === 'night_club' ? 'nightclub' :
                   place.primaryType === 'wine_bar' ? 'wine_bar' : 'bar';

      const venueName = place.displayName?.text || 'Unknown Venue';

      // Debug: Log hours for each venue
      barsLog.info(`"${venueName}" - is_open=${openStatus.is_open}, hours_today="${openStatus.hours_today || 'none'}"`);

      return {
        name: venueName,
        type,
        address: place.formattedAddress || '',
        phone: place.nationalPhoneNumber || null,
        expense_level: price.level,
        expense_rank: price.rank,
        // 2026-01-10: Dual compatibility - camelCase for client, snake_case for legacy
        isOpen: openStatus.is_open,
        is_open: openStatus.is_open,
        hours_today: openStatus.hours_today,
        closing_soon: openStatus.closing_soon,
        minutes_until_close: openStatus.minutes_until_close,
        // 2026-01-09: Added opens_in_minutes for "opening soon" badges
        opens_in_minutes: openStatus.opens_in_minutes,
        rating: place.rating || null,
        crowd_level: place.rating >= 4.5 ? 'high' : place.rating >= 4 ? 'medium' : 'low',
        rideshare_potential: price.rank >= 3 ? 'high' : price.rank >= 2 ? 'medium' : 'low',
        lat: place.location?.latitude,
        lng: place.location?.longitude,
        place_id: place.id,
        google_types: place.types || []
      };
    });

    // Step 1: Quick filter - remove obvious fast food/chains
    venues = venues.filter(v => !isExcludedVenue(v.name));
    barsLog.phase(1, `After quick filter: ${venues.length} venues`);

    // Step 2: Only keep upscale venues ($$ and above)
    venues = venues.filter(v => v.expense_rank >= 2);
    barsLog.phase(1, `After upscale filter ($$+): ${venues.length} venues`);

    // Step 3: LLM filter for remaining ambiguous venues (if any remain)
    if (venues.length > 0) {
      venues = await filterVenuesWithLLM(venues);
    }

    // Step 4: "CLOSED GO ANYWAY" Logic
    // 2026-01-14: Filter venues to only those with KNOWN operating hours
    // - Open status (isOpen === true): Always keep
    // - Unknown status (isOpen === null): DROP - no hours data = unusable (Mikes, BBQ Galaxy, etc.)
    // - Closed status: Only keep if Expense Rank >= 3 ($$$ or $$$$) for staging
    const relevantVenues = venues.filter(v => {
      // 1. Open status ONLY - must have confirmed operating hours
      if (v.isOpen === true) return true;

      // 2. Closed Go Anyway: High value venues ($$$+) worth staging near
      if (v.isOpen === false && v.expense_rank >= 3) {
        v.closed_go_anyway = true; // Flag for UI/Strategy
        v.closed_reason = "High-value venue - good for staging spillover";
        return true;
      }

      // 3. Drop venues with unknown hours (isOpen === null)
      // These lack weekdayDescriptions from Google Places, making them unreliable
      if (v.isOpen === null) {
        barsLog.info(`Dropping "${v.name}" - no operating hours data available`);
      }

      return false; // Skip low-value closed AND unknown-hours venues
    });

    // 2026-01-14: Strategic sort for drivers (unknown-hours venues now filtered out)
    // 1. Open venues with time to work (not closing soon) - sorted by expense ($$$$ first)
    // 2. Last call venues (closing soon) - still valuable for quick pickups
    // 3. Closed High-Value Venues (Go Anyway) - staging spillover
    relevantVenues.sort((a, b) => {
      const aOpen = a.isOpen === true;
      const bOpen = b.isOpen === true;

      // Open venues first
      if (aOpen && !bOpen) return -1;
      if (!aOpen && bOpen) return 1;

      if (aOpen && bOpen) {
        // Within open venues:
        // Put non-closing-soon venues first (more time to work them)
        const aClosingSoon = a.closing_soon === true;
        const bClosingSoon = b.closing_soon === true;
        if (aClosingSoon !== bClosingSoon) return aClosingSoon ? 1 : -1;

        // Then sort by expense (highest first)
        if ((b.expense_rank || 0) !== (a.expense_rank || 0)) {
          return (b.expense_rank || 0) - (a.expense_rank || 0);
        }
        return (b.rating || 0) - (a.rating || 0);
      }

      // Both closed (Go Anyway) - sort by expense
      return (b.expense_rank || 0) - (a.expense_rank || 0);
    });

    // Extract last-call venues
    // 2026-01-10: Use isOpen (camelCase) for consistency
    const lastCallVenues = relevantVenues.filter(v => v.isOpen && v.closing_soon);

    barsLog.complete(`${relevantVenues.length} venues (incl. ${relevantVenues.filter(v => v.isOpen === false).length} closed high-value)`);

    return {
      query_time: new Date().toLocaleTimeString(),
      location: `${city}, ${state}`,
      total_venues: relevantVenues.length,
      venues: relevantVenues,
      last_call_venues: lastCallVenues,
      search_sources: ['Google Places API']
    };

  } catch (error) {
    barsLog.error(2, `Discovery failed`, error);
    // Return empty result on error - don't use stale fallback data
    return {
      query_time: new Date().toLocaleTimeString(),
      location: `${city || 'Unknown'}, ${state || ''}`,
      total_venues: 0,
      venues: [],
      last_call_venues: [],
      search_sources: ['Error - Google Places API failed'],
      error: error.message
    };
  }
}

/**
 * Get traffic density for a specific area using robust Gemini adapter
 * @param {Object} params - Traffic query parameters
 * @param {number} params.lat - Latitude
 * @param {number} params.lng - Longitude
 * @param {string} params.city - City name
 * @returns {Promise<Object>} Traffic intelligence
 */
export async function getTrafficIntelligence({ lat, lng, city, state }) {
  const currentTime = new Date();
  const timeString = currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  
  const prompt = `Analyze CURRENT traffic conditions RIGHT NOW at coordinates (${lat}, ${lng}) in ${city}, ${state}.
Current time: ${timeString}

Provide real-time traffic intelligence:
1. Overall traffic density (1-10 scale, 10 = gridlock)
2. Major congestion areas and why (events, accidents, construction, commute patterns)
3. High-demand rideshare zones based on traffic patterns
4. Best positioning advice for drivers

Return ONLY valid JSON:
{
  "traffic_density": 7,
  "density_level": "high|medium|low",
  "congestion_areas": [{"area": "specific street", "reason": "detailed reason", "severity": 1-10}],
  "high_demand_zones": [{"zone": "area name", "why": "reason"}],
  "driver_advice": "actionable advice for drivers"
}`;

  try {
    // 2026-02-13: Uses VENUE_TRAFFIC role via callModel adapter (hedged router + fallback)
    aiLog.info(`Calling VENUE_TRAFFIC role for traffic intelligence...`);
    const result = await callModel('VENUE_TRAFFIC', {
      system: 'You are a traffic intelligence system. Return ONLY valid JSON with no preamble.',
      user: prompt
    });

    if (!result.ok) {
      throw new Error(result.error);
    }

    const trafficData = JSON.parse(result.output);
    venuesLog.info(`Traffic parsed: density=${trafficData.density_level}`);

    // MAP TO UNIFIED SCHEMA for briefing-service compatibility
    return {
      summary: trafficData.driver_advice || '',
      congestionLevel: trafficData.density_level || 'low',
      incidents: (trafficData.congestion_areas || []).map(c => ({
        description: c.area + ': ' + c.reason,
        severity: c.severity ? (c.severity > 7 ? 'high' : c.severity > 3 ? 'medium' : 'low') : 'medium'
      })),
      highDemandZones: trafficData.high_demand_zones || [],
      driver_advice: trafficData.driver_advice || '',
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    venuesLog.error(1, `Traffic intelligence failed`, error);
    // Return safe fallback
    return {
      summary: 'Traffic data currently unavailable',
      congestionLevel: 'medium',
      incidents: [],
      highDemandZones: [],
      driver_advice: 'Traffic data currently unavailable',
      fetchedAt: new Date().toISOString()
    };
  }
}

/**
 * Combined venue + traffic intelligence for Smart Blocks
 * @param {Object} params - Query parameters
 * @param {string} [params.holiday] - Current holiday name (optional)
 * @returns {Promise<Object>} Combined intelligence
 */
export async function getSmartBlocksIntelligence({ lat, lng, city, state, radiusMiles = 5, holiday = null, timezone = null, localIso = null }) {
  try {
    venuesLog.start(`SmartBlocks for ${city}, ${state} (${radiusMiles} mile radius)`);

    // Run venue discovery and traffic intelligence in parallel
    const venuePromise = discoverNearbyVenues({ lat, lng, city, state, radiusMiles, holiday, timezone, localIso });
    const trafficPromise = getTrafficIntelligence({ lat, lng, city, state }).catch(err => {
      venuesLog.warn(1, `Traffic intelligence failed: ${err.message}`);
      return { density_level: 'unknown', high_demand_zones: [], driver_advice: '' };
    });

    const [venueData, trafficData] = await Promise.all([venuePromise, trafficPromise]);

    venuesLog.done(1, `Combined intelligence: venues=${venueData.total_venues}, traffic=${trafficData.density_level}`);

    return {
      timestamp: new Date().toISOString(),
      location: { lat, lng, city, state },
      venues: venueData,
      traffic: trafficData,
      combined_insights: {
        top_opportunities: venueData.venues?.slice(0, 5) || [],
        last_call_alerts: venueData.last_call_venues || [],
        traffic_hotspots: trafficData.high_demand_zones || [],
        driver_summary: `${venueData.total_venues || 0} venues nearby. Traffic: ${trafficData.density_level || 'unknown'}. ${trafficData.driver_advice || ''}`
      }
    };
  } catch (error) {
    venuesLog.error(1, `SmartBlocks intelligence failed`, error);
    throw error;
  }
}

/**
 * Persist venue data to venue_catalog for caching and deduplication.
 * Uses upsert pattern: update existing venues, insert new ones.
 *
 * Updated 2026-01-05: Migrated from nearby_venues to venue_catalog
 *
 * @param {Array} venues - Venues from Google Places discovery
 * @param {Object} context - Context {city, state}
 * @returns {Promise<Array>} - Upserted venue records
 */
export async function persistVenuesToDatabase(venues, context) {
  if (!venues || !Array.isArray(venues) || venues.length === 0) {
    return [];
  }

  try {
    const now = new Date();
    const upserted = [];

    for (const v of venues) {
      const coordKey = generateCoordKey(v.lat, v.lng);
      const normalizedName = normalizeVenueName(v.name);

      // Check if venue already exists by coord_key or (normalized_name + city + state)
      const conditions = [];
      if (coordKey) {
        conditions.push(eq(venue_catalog.coord_key, coordKey));
      }
      if (normalizedName && context.city && context.state) {
        conditions.push(and(
          eq(venue_catalog.normalized_name, normalizedName),
          eq(venue_catalog.city, context.city),
          eq(venue_catalog.state, context.state?.toUpperCase())
        ));
      }

      let existing = null;
      if (conditions.length > 0) {
        const [found] = await db.select()
          .from(venue_catalog)
          .where(conditions.length === 1 ? conditions[0] : or(...conditions))
          .limit(1);
        existing = found;
      }

      // District Extraction (from venue name)
      const district = extractDistrictFromVenueName(v.name);
      const districtSlug = district ? normalizeDistrictSlug(district) : null;

      if (existing) {
        // Update existing venue with latest bar data + district info
        const venueTypes = Array.isArray(existing.venue_types) ? existing.venue_types : [];
        if (!venueTypes.includes('bar')) {
          venueTypes.push('bar');
        }

        // 2026-01-14: Progressive Enrichment - Bar Tab discovery is a verified source
        // Use OR logic for is_bar (once true, stays true)
        // Use MAX logic for record_status (verified > enriched > stub)
        const statusPriority = { 'stub': 0, 'enriched': 1, 'verified': 2 };
        const existingPriority = statusPriority[existing.record_status] || 0;
        const finalRecordStatus = existingPriority < 2 ? 'verified' : existing.record_status;

        const [updated] = await db.update(venue_catalog)
          .set({
            expense_rank: v.expense_rank || existing.expense_rank,
            crowd_level: v.crowd_level || existing.crowd_level,
            rideshare_potential: v.rideshare_potential || existing.rideshare_potential,
            venue_types: venueTypes,
            // Prefer existing district if set, otherwise try new extraction
            district: existing.district || district,
            district_slug: existing.district_slug || districtSlug,
            // 2026-01-14: Progressive Enrichment fields
            is_bar: true, // Bar Tab discovery = is_bar
            record_status: finalRecordStatus, // Verified source
            access_count: (existing.access_count || 0) + 1,
            last_accessed_at: now,
            updated_at: now
          })
          .where(eq(venue_catalog.venue_id, existing.venue_id))
          .returning();

        if (updated) upserted.push(updated);
      } else {
        // Insert new venue with district
        const venueType = v.type === 'nightclub' ? 'nightclub' :
                          v.type === 'wine_bar' ? 'wine_bar' : 'bar';

        // 2026-01-14: Progressive Enrichment - Bar Tab discovery creates verified bars
        const [inserted] = await db.insert(venue_catalog)
          .values({
            venue_name: v.name,
            normalized_name: normalizedName,
            address: v.address,
            lat: v.lat,
            lng: v.lng,
            coord_key: coordKey,
            city: context.city,
            state: context.state?.toUpperCase(),
            formatted_address: v.address,
            place_id: v.place_id,
            venue_types: [venueType],
            category: venueType,
            expense_rank: v.expense_rank,
            crowd_level: v.crowd_level,
            rideshare_potential: v.rideshare_potential,
            district: district,
            district_slug: districtSlug,
            source: 'google_places',
            discovery_source: 'bar_discovery',
            // 2026-01-14: Progressive Enrichment fields
            is_bar: true,           // Bar Tab discovery = is_bar
            is_event_venue: false,
            record_status: 'verified', // Bar Tab is a trusted source
            access_count: 1,
            last_accessed_at: now,
            updated_at: now
          })
          .onConflictDoNothing()
          .returning();

        if (inserted) upserted.push(inserted);
      }
    }

    venuesLog.done(4, `Persisted ${upserted.length} venues to venue_catalog`);
    return upserted;
  } catch (error) {
    venuesLog.warn(4, `Failed to persist venues: ${error.message}`);
    // Don't throw - allow API to continue even if DB persistence fails
    return [];
  }
}

export default {
  discoverNearbyVenues,
  getTrafficIntelligence,
  getSmartBlocksIntelligence,
  persistVenuesToDatabase
};
