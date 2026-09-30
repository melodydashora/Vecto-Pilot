// server/lib/venue/venue-intelligence.js
// Real-time venue intelligence using Google Places API (New) for bar discovery
// Provides: upscale bars/lounges sorted by expense, filtered by operating hours
// Uses Haiku for fast filtering of non-bar venues
//
// Updated 2026-01-05: Migrated from nearby_venues to venue_catalog
// See: /home/runner/.claude/plans/noble-purring-yeti.md

import { db } from '../../db/drizzle.js';
import { venue_catalog } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { callModel } from '../ai/adapters/index.js';
// 2026-02-13: Removed direct callGemini import — traffic call now uses callModel('VENUE_TRAFFIC')
import { barsLog, placesLog, venuesLog, aiLog, matrixLog } from '../../logger/workflow.js';
import { parseAddressComponents } from './venue-utils.js';
import { normalizeCoordinates } from '../../../shared/coordinates.js';
// 2026-01-14: Cache First pattern - check database before calling Google Places API
import { getVenuesByType, upsertVenue } from './venue-cache.js';
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
    default: return { level: null, rank: null };
  }
}

/**
 * Calculate if venue is open, time until close, and time until open
 * 2026-01-09: Added opens_in_minutes for "opening soon" UI feature
 */
function validTimezone(value) {
  try { if (typeof value !== 'string' || !value) return null; new Intl.DateTimeFormat('en-US', { timeZone: value }); return value; } catch { return null; }
}
function calculateOpenStatus(place) {
  const timezone = validTimezone(place.timeZone?.id);
  const hours = place.currentOpeningHours || place.regularOpeningHours;
  const unknown = { is_open: null, hours_today: null, closing_soon: false, minutes_until_close: null, opens_in_minutes: null };
  if (!hours) return unknown;
  const descriptions = Array.isArray(hours.weekdayDescriptions) ? hours.weekdayDescriptions : [];
  let canonical = null;
  if (timezone && descriptions.length) {
    const parsed = parseGoogleWeekdayText(descriptions);
    if (parsed.ok) canonical = getOpenStatus(parsed.schedule, timezone);
  }
  const is_open = typeof hours.openNow === 'boolean' ? hours.openNow : canonical?.is_open ?? null;
  const now = new Date();
  const minutesUntil = value => {
    const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(timestamp) && timestamp >= now.getTime() ? Math.ceil((timestamp - now.getTime()) / 60000) : null;
  };
  // Provider timestamps include the correct local date, split shifts and holidays.
  // Do not scan arbitrary periods by clock time or borrow the viewer's timezone.
  const minutes_until_close = is_open === true ? minutesUntil(hours.nextCloseTime) ?? canonical?.minutes_until_close ?? null : null;
  const opens_in_minutes = is_open === false ? minutesUntil(hours.nextOpenTime) ?? canonical?.minutes_until_open ?? null : null;
  const day = timezone ? new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(now) : null;
  const today = day ? descriptions.find(text => typeof text === 'string' && text.toLowerCase().startsWith(day.toLowerCase() + ':')) : null;
  return { is_open, hours_today: today?.replace(/^[^:]+:\s*/, '') || null,
    closing_soon: is_open === true && minutes_until_close !== null && minutes_until_close <= 60,
    minutes_until_close, opens_in_minutes };
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
 * 2026-02-18: Enhanced from simple keep/remove to quality classification.
 * Haiku classifies each venue as Premium (P), Standard (S), or Remove (X).
 * The quality tier is stored on the venue object and persisted to venue_catalog.
 * Catalog recommendations require fresh provider hours; new discovery batches are classified.
 *
 * @param {Array} venues - Venues from Google Places (after quick filter + upscale filter)
 * @returns {Array} Classified venues with venue_quality_tier set (removes X-tier)
 */
async function classifyAndFilterVenues(venues) {
  if (!venues.length) return [];
  const venueList = venues.map((v, i) => {
    const ratingStr = v.rating ? ` | rating: ${v.rating}` : '';
    return `${i + 1}. ${v.name} (${v.expense_level}${ratingStr})`;
  }).join('\n');

  const prompt = `You are classifying bars and lounges for a rideshare driver looking for UPSCALE venues with high passenger potential.

For each venue, classify as:
- "P" (PREMIUM): Upscale lounges, cocktail bars, rooftop bars, hotel bars, speakeasies, high-end nightclubs, fine dining with prominent bar areas. Places people dress up for. High ratings (4.5+) with $$$ or $$$$ pricing.
- "S" (STANDARD): Regular sports bars, casual pubs, breweries, taphouses, moderate restaurants with bars. Decent spots with bar crowds but not a destination nightlife venue.
- "X" (REMOVE): Fast food, pizza delivery, ice cream, coffee shops, casual chain restaurants (Applebee's, Chili's), grocery stores, gas stations, smoke/hookah shops, restaurants with no real bar scene.

Venue list:
${venueList}

Return ONLY a JSON object mapping venue number to classification. Example: {"1":"P","2":"S","3":"X","4":"P","5":"S"}
Classify ALL venues. No explanation.`;

  const result = await callModel('VENUE_FILTER', {
    system: 'Classify each listed venue as P, S or X. Return only the complete JSON index mapping.', user: prompt,
    maxTokens: 300, temperature: 0, signal: AbortSignal.timeout(30000),
  });
  if (!result.ok) throw new Error('Venue classification unavailable');
  let classifications;
  try { classifications = JSON.parse(result.output.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch { throw new Error('Venue classification returned invalid JSON'); }
  if (!classifications || Array.isArray(classifications) || Object.keys(classifications).length !== venues.length ||
      venues.some((_venue, index) => !['P', 'S', 'X'].includes(classifications[String(index + 1)]))) {
    throw new Error('Venue classification is incomplete or invalid');
  }
  return venues.flatMap((venue, index) => {
    const tier = classifications[String(index + 1)];
    return tier === 'X' ? [] : [{ ...venue, venue_quality_tier: tier === 'P' ? 'premium' : 'standard' }];
  });
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
// TODO (2026-04-16): Bars tab does not compute beyond_deadhead. The strategy pipeline
// sets this flag via tactical-planner.js, but the Bars pipeline is independent.
// Decision pending: either call loadDriverPreferences() here and compute haversine
// inline, or restructure to share the scoring step. See SESSION_HANDOFF_2026-04-16.md.
/**
 * Map Google Places (New) results to the venue shape used by the bars pipeline.
 *
 * 2026-09-11 (todo #64): extracted from discoverNearbyVenues and guarded. The old inline
 * map wrote `lat: place.location?.latitude` / `lng: place.location?.longitude`, and NO later
 * boundary re-checked them (transformers.js toApiVenue passes them through; the client's
 * StrategyMap feeds them straight into AdvancedMarkerElement) — so one Places result
 * without a `location` crashed the whole Strategy route with a TypeError. The cache branch
 * already filtered with Number.isFinite; this is the same rule for the Google branch:
 * a venue without finite coordinates is dropped LOUDLY, never emitted with undefined
 * coords and never given substitute coordinates.
 *
 * @param {Array<object>} places - `data.places` from the Places API response
 * @returns {Array<object>} venues with finite lat/lng only
 */
export function mapGooglePlacesToVenues(places) {
  const venues = [];
  for (const place of places || []) {
    const venueName = place.displayName?.text;
    const latitude = place.location?.latitude;
    const longitude = place.location?.longitude;
    const point = normalizeCoordinates(latitude, longitude);
    if (!venueName || !place.id || !point) {
      barsLog.warn(1, `"${venueName}" (${place.id || 'no place_id'}) dropped: Google Places returned no usable coordinates (lat=${String(latitude)}, lng=${String(longitude)})`);
      continue;
    }

    if (['CLOSED_PERMANENTLY', 'CLOSED_TEMPORARILY'].includes(place.businessStatus)) continue;
    const price = getPriceDisplay(place.priceLevel);
    const openStatus = calculateOpenStatus(place);
    const type = place.primaryType === 'night_club' ? 'nightclub' :
                 place.primaryType === 'wine_bar' ? 'wine_bar' : 'bar';

    // Debug: Log hours for each venue
    barsLog.debug(`"${venueName}" - is_open=${openStatus.is_open}, hours_today="${openStatus.hours_today || 'none'}"`);

    venues.push({
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
      rating: Number.isFinite(place.rating) ? place.rating : null,
      crowd_level: null,
      rideshare_potential: null,
      ...parseAddressComponents(place.addressComponents),
      timezone: validTimezone(place.timeZone?.id),
      business_status: place.businessStatus || 'UNKNOWN',
      lat: point.lat,
      lng: point.lng,
      place_id: place.id,
      google_types: place.types || [],
      // 2026-02-26: Capture raw hours for persistence to venue_catalog
      // Without this, cached venues have no hours and get filtered out
      _regularOpeningHours: place.regularOpeningHours || null,
      _currentOpeningHours: place.currentOpeningHours || null
    });
  }
  return venues;
}

const discoveryInFlight = new Map();
const CATALOG_HOURS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
function relevantVenues(venues) {
  return venues.filter(venue => {
    if (!venue.place_id || !Number.isFinite(venue.expense_rank) || venue.expense_rank < 2 ||
        !Number.isFinite(venue.rating) || venue.rating < 4.6 || isExcludedVenue(venue.name)) return false;
    if (venue.isOpen === true) return true;
    if (venue.isOpen === false && venue.expense_rank >= 3) {
      venue.closed_go_anyway = true;
      venue.closed_reason = 'Outside opening hours; nearby staging is a suggestion, not confirmed demand.';
      return true;
    }
    return false;
  }).sort((a, b) => Number(b.isOpen === true) - Number(a.isOpen === true) ||
    Number(a.closing_soon === true) - Number(b.closing_soon === true) ||
    Number(b.venue_quality_tier === 'premium') - Number(a.venue_quality_tier === 'premium') ||
    b.expense_rank - a.expense_rank || Number(a.distance_miles) - Number(b.distance_miles));
}
function cachedPlace(row) {
  const descriptions = value => Array.isArray(value?.weekdayDescriptions) ? value.weekdayDescriptions :
    typeof value === 'string' ? value.split('; ').filter(Boolean) : [];
  const weekdays = descriptions(row.business_hours).length ? descriptions(row.business_hours) : descriptions(row.hours_full_week);
  return { id: row.place_id, displayName: { text: row.venue_name }, formattedAddress: row.formatted_address || row.address,
    location: { latitude: row.lat, longitude: row.lng }, timeZone: { id: row.timezone },
    priceLevel: ({ 1: 'PRICE_LEVEL_INEXPENSIVE', 2: 'PRICE_LEVEL_MODERATE', 3: 'PRICE_LEVEL_EXPENSIVE', 4: 'PRICE_LEVEL_VERY_EXPENSIVE' })[row.expense_rank],
    rating: row.google_rating == null ? null : Number(row.google_rating), nationalPhoneNumber: row.phone_number,
    primaryType: row.category === 'nightclub' ? 'night_club' : row.category, types: row.venue_types,
    regularOpeningHours: weekdays.length ? { weekdayDescriptions: weekdays } : null };
}
export async function discoverNearbyVenues({ lat, lng, city, state, radiusMiles = 25, timezone = null }) {
  const point = normalizeCoordinates(lat, lng);
  if (!point || !city || !validTimezone(timezone) || !Number.isFinite(radiusMiles) || radiusMiles <= 0) throw new Error('Invalid venue discovery location, timezone or radius');
  const radiusMeters = Math.min(radiusMiles * 1609.344, 50000);
  const args = { ...point, city, state: state || '', radiusMiles: radiusMeters / 1609.344, timezone };
  const key = JSON.stringify(args);
  if (discoveryInFlight.has(key)) return structuredClone(await discoveryInFlight.get(key));
  const pending = discoverNearbyVenuesOnce(args, radiusMeters);
  discoveryInFlight.set(key, pending);
  try { return structuredClone(await pending); }
  finally { if (discoveryInFlight.get(key) === pending) discoveryInFlight.delete(key); }
}
async function discoverNearbyVenuesOnce(args, radiusMeters) {
  const { lat, lng, city, state, radiusMiles, timezone } = args;
  const response = (venues, source) => ({ query_time: new Date().toLocaleTimeString('en-US', { timeZone: timezone }),
    location: [city, state].filter(Boolean).join(', '), total_venues: venues.length, venues,
    last_call_venues: venues.filter(venue => venue.isOpen === true && venue.closing_soon), search_sources: [source] });
  // A failed catalog query is not proof that the area is empty.
  const cached = await getVenuesByType({ venueTypes: ['bar', 'nightclub', 'wine_bar'], city, state, limit: 100 });
  const seen = new Set();
  const nearby = cached.filter(row => {
    const age = Date.now() - Date.parse(row.business_hours?._fetchedAt);
    if (!row.place_id || seen.has(row.place_id) || !normalizeCoordinates(row.lat, row.lng) ||
        !['premium', 'standard'].includes(row.venue_quality_tier) ||
        !Number.isFinite(age) || age < 0 || age > CATALOG_HOURS_MAX_AGE_MS ||
        ['closed', 'permanently_closed', 'temporarily_closed'].includes(row.last_known_status) ||
        haversineDistanceMiles(lat, lng, row.lat, row.lng) > radiusMiles) return false;
    seen.add(row.place_id); return true;
  });
  const rehydrated = nearby.flatMap(row => mapGooglePlacesToVenues([cachedPlace(row)]).map(venue => ({ ...venue,
    city: row.city, state: row.state, country: row.country, venue_quality_tier: row.venue_quality_tier || null,
    distance_miles: haversineDistanceMiles(lat, lng, venue.lat, venue.lng), from_cache: true })));
  const reusable = relevantVenues(rehydrated);
  if (reusable.length >= 5) return response(reusable, 'Database Cache');
  if (!GOOGLE_MAPS_API_KEY) throw new Error('Places provider is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Places discovery timed out')), 15000);
  let data;
  try {
    const result = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.businessStatus,places.formattedAddress,places.addressComponents,places.timeZone,places.nationalPhoneNumber,places.currentOpeningHours,places.regularOpeningHours,places.priceLevel,places.rating,places.location,places.primaryType,places.types' },
      body: JSON.stringify({ includedTypes: ['bar', 'night_club', 'wine_bar'],
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters } },
        maxResultCount: 20, rankPreference: 'DISTANCE' }) });
    if (!result.ok) throw new Error(`Places discovery failed: HTTP ${result.status}`);
    data = await result.json(); controller.signal.throwIfAborted();
  } finally { clearTimeout(timer); controller.abort(); }
  if (!data || (data.places !== undefined && !Array.isArray(data.places))) throw new Error('Places discovery returned invalid data');
  const providerIds = new Set();
  const places = mapGooglePlacesToVenues(data.places).filter(venue => {
    if (providerIds.has(venue.place_id)) return false;
    providerIds.add(venue.place_id);
    venue.distance_miles = haversineDistanceMiles(lat, lng, venue.lat, venue.lng);
    return venue.distance_miles <= radiusMiles;
  });
  const candidates = relevantVenues(places);
  const classified = await classifyAndFilterVenues(candidates);
  // Keep the single-flight receipt until persistence finishes, avoiding a second
  // miss/provider call while the first request's detached writes are pending.
  await persistVenuesToDatabase(classified, args);
  return response(relevantVenues(classified), 'Google Places API');
}

/**
 * Get traffic density for a specific area using robust Gemini adapter
 * @param {Object} params - Traffic query parameters
 * @param {number} params.lat - Latitude
 * @param {number} params.lng - Longitude
 * @param {string} params.city - City name
 * @returns {Promise<Object>} Traffic intelligence
 */
const trafficInFlight = new Map();
export async function getTrafficIntelligence(args) {
  const point = normalizeCoordinates(args.lat, args.lng);
  if (!point) throw new Error('Traffic requires valid coordinates');
  const key = JSON.stringify({ ...point, city: args.city, state: args.state, timezone: args.timezone });
  if (trafficInFlight.has(key)) return structuredClone(await trafficInFlight.get(key));
  const pending = getTrafficIntelligenceOnce({ ...args, ...point });
  trafficInFlight.set(key, pending);
  try { return structuredClone(await pending); }
  finally { if (trafficInFlight.get(key) === pending) trafficInFlight.delete(key); }
}
async function getTrafficIntelligenceOnce({ lat, lng, city, state, timezone }) {
  const currentTime = new Date();
  const timeString = currentTime.toISOString();
  
  const prompt = `Analyze CURRENT traffic conditions RIGHT NOW at coordinates (${lat}, ${lng}) in ${city}, ${state}.
Current instant: ${timeString}. Driver timezone: ${timezone || 'unknown'}.

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
    matrixLog.info({
      category: 'VENUE',
      connection: 'AI',
      action: 'DISPATCH',
      roleName: 'VENUE_TRAFFIC',
      location: 'venue-intelligence.js:getTrafficIntelligence',
    }, 'Calling VENUE_TRAFFIC role for traffic intelligence');
    const result = await callModel('VENUE_TRAFFIC', {
      system: 'You are a traffic intelligence system. Return ONLY valid JSON with no preamble.',
      user: prompt,
      signal: AbortSignal.timeout(30000)
    });

    if (!result.ok) {
      throw new Error(result.error);
    }

    const trafficData = JSON.parse(result.output);
    if (!['high', 'medium', 'low'].includes(trafficData?.density_level) || typeof trafficData.driver_advice !== 'string' ||
        !trafficData.driver_advice.trim() || !Array.isArray(trafficData.congestion_areas) || !Array.isArray(trafficData.high_demand_zones)) {
      throw new Error('Venue traffic returned incomplete data');
    }
    matrixLog.info({
      category: 'VENUE',
      connection: 'AI',
      action: 'COMPLETE',
      roleName: 'VENUE_TRAFFIC',
      location: 'venue-intelligence.js:getTrafficIntelligence',
    }, `VENUE_TRAFFIC parsed: density=${trafficData.density_level}`);

    // MAP TO UNIFIED SCHEMA for briefing-service compatibility
    return {
      summary: trafficData.driver_advice || '',
      congestionLevel: trafficData.density_level || null,
      incidents: (trafficData.congestion_areas || []).map(c => ({
        description: c.area + ': ' + c.reason,
        severity: Number.isFinite(c.severity) ? (c.severity > 7 ? 'high' : c.severity > 3 ? 'medium' : 'low') : null
      })),
      highDemandZones: trafficData.high_demand_zones || [],
      driver_advice: trafficData.driver_advice || '',
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    matrixLog.error({
      category: 'VENUE',
      connection: 'AI',
      action: 'COMPLETE',
      roleName: 'VENUE_TRAFFIC',
      location: 'venue-intelligence.js:getTrafficIntelligence',
    }, 'VENUE_TRAFFIC failed', error);
    throw error;
  }
}

/**
 * Combined venue + traffic intelligence for Smart Blocks
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Combined intelligence
 */
export async function getSmartBlocksIntelligence({ lat, lng, city, state, radiusMiles = 5, timezone = null, localIso = null }) {
  try {
    venuesLog.start(`Venue cards for ${city}, ${state} (${radiusMiles} mile radius)`);

    // Run venue discovery and traffic intelligence in parallel
    const venuePromise = discoverNearbyVenues({ lat, lng, city, state, radiusMiles, timezone, localIso });
    const trafficPromise = getTrafficIntelligence({ lat, lng, city, state, timezone }).catch(err => {
      venuesLog.warn(1, `Traffic intelligence failed: ${err.message}`);
      return { available: false, congestionLevel: null, highDemandZones: [], driver_advice: 'Traffic data unavailable' };
    });

    const [venueData, trafficData] = await Promise.all([venuePromise, trafficPromise]);

    venuesLog.done(1, `Combined intelligence: venues=${venueData.total_venues}, traffic=${trafficData.congestionLevel}`);

    return {
      timestamp: new Date().toISOString(),
      location: { lat, lng, city, state },
      venues: venueData,
      traffic: trafficData,
      combined_insights: {
        top_opportunities: venueData.venues?.slice(0, 5) || [],
        last_call_alerts: venueData.last_call_venues || [],
        traffic_hotspots: trafficData.highDemandZones || [],
        driver_summary: `${venueData.total_venues || 0} venues nearby. Traffic: ${trafficData.congestionLevel || 'unknown'}. ${trafficData.driver_advice || ''}`
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
export async function persistVenuesToDatabase(venues) {
  const saved = [];
  for (const venue of venues || []) {
    if (!venue.place_id || !normalizeCoordinates(venue.lat, venue.lng) || !venue.address) continue;
    try {
      const row = await upsertVenue({ venueName: venue.name, placeId: venue.place_id, lat: venue.lat, lng: venue.lng,
        address: venue.address, formattedAddress: venue.address, city: venue.city, state: venue.state, country: venue.country,
        timezone: venue.timezone, hours: (venue._currentOpeningHours || venue._regularOpeningHours) ? { ...(venue._currentOpeningHours || venue._regularOpeningHours), _fetchedAt: new Date().toISOString() } : null, hoursFullWeek: venue._regularOpeningHours,
        hoursSource: (venue._currentOpeningHours || venue._regularOpeningHours) ? 'google_places' : null, venueTypes: [venue.type], category: venue.type,
        expenseRank: venue.expense_rank, source: 'google_places_new', discoverySource: 'bar_discovery',
      }, { isBar: true, recordStatus: 'verified' });
      if (!row?.venue_id || row.place_id !== venue.place_id) continue;
      await db.update(venue_catalog).set({ google_rating: venue.rating,
        phone_number: venue.phone, venue_quality_tier: venue.venue_quality_tier || null,
        last_known_status: venue.business_status === 'OPERATIONAL' ? 'open' : null,
        // Rating and price are not live crowd counts or measured ride demand.
        crowd_level: null, rideshare_potential: null,
      }).where(eq(venue_catalog.venue_id, row.venue_id));
      saved.push(row);
    } catch (error) { venuesLog.warn(4, `Venue persistence unavailable: ${error.message}`); }
  }
  return saved;
}

export default {
  discoverNearbyVenues,
  getTrafficIntelligence,
  getSmartBlocksIntelligence,
  persistVenuesToDatabase
};
