/** Resolve Google venue identity once, then route to that same identity. */
import { getRouteWithTraffic, getRouteMatrix } from '../external/routes-api.js';
import { venuesLog } from '../../logger/workflow.js';
import { parseGoogleWeekdayText, getOpenStatus } from './hours/index.js';
import { parseAddressComponents } from './venue-utils.js';
import { normalizeCoordinates } from '../../../shared/coordinates.js';

const PLACES_URL = 'https://places.googleapis.com/v1/places';
const PLACE_FIELDS = 'id,displayName,businessStatus,formattedAddress,addressComponents,currentOpeningHours,regularOpeningHours,location,timeZone';
const inFlightPlaces = new Map();

async function requestPlace(url, body, signal) {
  if (!process.env.GOOGLE_MAPS_API_KEY) throw new Error('Places provider is not configured');
  const controller = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new Error('Places provider timed out')), 15000);
  try {
    requestSignal.throwIfAborted();
    const response = await fetch(url, { method: body ? 'POST' : 'GET', signal: requestSignal,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': body ? PLACE_FIELDS.split(',').map(field => `places.${field}`).join(',') : PLACE_FIELDS },
      ...(body && { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error(`Places API failed: HTTP ${response.status}`);
    const data = await response.json();
    requestSignal.throwIfAborted();
    return data;
  } finally { clearTimeout(timer); controller.abort(); }
}
function normalizedPlace(place, matchMethod) {
  let timezone = place?.timeZone?.id || null;
  try { if (timezone) new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch { timezone = null; }
  const coordinates = normalizeCoordinates(place?.location?.latitude, place?.location?.longitude);
  if (!place?.id || !place.displayName?.text || !coordinates || !place.formattedAddress) return null;
  const hours = place.currentOpeningHours || place.regularOpeningHours;
  const allHours = hours?.weekdayDescriptions || [];
  return { place_id: place.id, google_name: place.displayName.text, google_lat: coordinates.lat,
    google_lng: coordinates.lng, formatted_address: place.formattedAddress,
    business_status: place.businessStatus || 'UNKNOWN', timezone, ...parseAddressComponents(place.addressComponents),
    isOpen: typeof hours?.openNow === 'boolean' ? hours.openNow : calculateIsOpenFromGoogleWeekdayText(allHours, timezone),
    businessHours: condenseWeeklyHours(allHours), allHours,
    regularOpeningHours: place.regularOpeningHours || null, matchMethod };
}
function usablePlace(place) {
  return !!(place?.place_id && place.formatted_address && normalizeCoordinates(place.google_lat, place.google_lng)) &&
    !['CLOSED_PERMANENTLY', 'CLOSED_TEMPORARILY'].includes(place.business_status);
}
function withinRadius(place, origin, maxMiles = 15) {
  const point = normalizeCoordinates(place.google_lat, place.google_lng);
  if (!point || !origin) return false;
  const radians = n => n * Math.PI / 180;
  const dlat = radians(point.lat - origin.lat), dlng = radians(point.lng - origin.lng);
  const a = Math.sin(dlat / 2) ** 2 + Math.cos(radians(origin.lat)) * Math.cos(radians(point.lat)) * Math.sin(dlng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))) <= maxMiles;
}
async function knownPlace(placeId) {
  // Share only concurrent exact-ID reads; volatile open/closed status is not cached for hours.
  if (!inFlightPlaces.has(placeId)) {
    const pending = requestPlace(`${PLACES_URL}/${encodeURIComponent(placeId)}`);
    inFlightPlaces.set(placeId, pending);
  }
  const pending = inFlightPlaces.get(placeId);
  try {
    const place = await pending;
    if (place.id !== placeId) throw new Error('Places returned a different identity');
    return normalizedPlace(place, 'place_details');
  } finally { if (inFlightPlaces.get(placeId) === pending) inFlightPlaces.delete(placeId); }
}

export async function enrichVenues(venues, driverLocation, snapshot = null) {
  if (!venues?.length) return [];
  const origin = normalizeCoordinates(driverLocation?.lat, driverLocation?.lng);
  if (!origin) throw new Error('Venue enrichment requires valid driver coordinates');
  // Resolve identity/address/hours BEFORE routing. Text-search results from this
  // planner run already include these fields; catalog hits refresh by exact ID.
  const seen = new Set();
  const unique = venues.filter(venue => {
    if (!venue.place_id || seen.has(venue.place_id)) return false;
    seen.add(venue.place_id); return true;
  });
  const resolved = (await Promise.all(unique.map(async venue => {
    try {
      const supplied = venue.resolved_place;
      const place = supplied?.place_id === venue.place_id && supplied.matchMethod === 'text_search'
        ? supplied : await knownPlace(venue.place_id);
      if (!usablePlace(place) || !withinRadius(place, origin) ||
          (snapshot?.country && place.country && snapshot.country !== place.country)) return null;
      return { ...venue, name: place.google_name || venue.name, lat: place.google_lat, lng: place.google_lng,
        address: place.formatted_address, city: place.city || null, state: place.state || null, country: place.country || null, timezone: place.timezone || null,
        placeId: place.place_id, businessStatus: place.business_status || 'UNKNOWN', isOpen: place.isOpen ?? null,
        businessHours: place.businessHours ?? null, hoursFullWeek: place.regularOpeningHours || null,
        placeVerified: true, streetViewUrl: null };
    } catch (error) {
      venuesLog.warn(3, `Venue identity unavailable for "${venue.name}": ${error.message}`);
      return null;
    }
  }))).filter(Boolean);
  if (!resolved.length) return [];
  const routes = new Map();
  try {
    const results = await getRouteMatrix([origin], resolved.map(({ lat, lng }) => ({ lat, lng })));
    for (const result of results) routes.set(result.destinationIndex, result);
  } catch (error) { venuesLog.warn(2, `Route matrix unavailable: ${error.message}`); }
  const enriched = await Promise.all(resolved.map(async (venue, index) => {
    try {
      let route = routes.get(index);
      let distanceSource = 'google_route_matrix';
      // A known impossible/failed route is not another paid fallback opportunity.
      if (route && route.routeAvailable !== true) return null;
      if (!route) {
        route = await getRouteWithTraffic(origin, { lat: venue.lat, lng: venue.lng });
        distanceSource = 'google_routes';
      }
      if (!Number.isFinite(route.distanceMeters) || route.distanceMeters < 0 ||
          !Number.isFinite(route.durationSeconds) || route.durationSeconds < 0) return null;
      return { ...venue, distanceMeters: route.distanceMeters, distanceMiles: (route.distanceMeters / 1609.344).toFixed(1),
        driveTimeMinutes: Math.ceil(route.durationSeconds / 60),
        trafficDelayMinutes: Number.isFinite(route.trafficDelaySeconds) ? Math.ceil(route.trafficDelaySeconds / 60) : null,
        distanceSource };
    } catch (error) {
      venuesLog.warn(2, `Route unavailable for "${venue.name}": ${error.message}`);
      return null;
    }
  }));
  return enriched.filter(Boolean).map((venue, index) => ({ ...venue, rank: index + 1 }));
}

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
    console.warn(`[VENUE] Parse failed: ${parseResult.error}`);
    return null;
  }

  const status = getOpenStatus(parseResult.schedule, timezone);

  // 2026-04-27 (Commit 3 of CLEAR_CONSOLE_WORKFLOW spec): demoted from info to
  // debug — fires for every venue's hours computation, was significant noise.
  if (status.is_open !== null) {
    venuesLog.debug(
      `calculateIsOpenFromGoogleWeekdayText: ${status.reason} -> ${status.is_open ? "OPEN" : "CLOSED"}`
    );
  }

  return status.is_open;
}

function calculateNameSimilarity(first, second) {
  const words = value => String(value || '').toLocaleLowerCase().normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const a = words(first), b = words(second);
  if (!a.length || !b.length) return 0;
  return 2 * a.filter(word => b.includes(word)).length / (a.length + b.length);
}

/** Text resolution is bounded to the driver's area; it never accepts unrelated results. */
export async function searchPlaceByText(venueName, district, city, state, timezone = null, options = {}) {
  const textQuery = [venueName, district, city, state, options.country].filter(Boolean).join(' ');
  const origin = normalizeCoordinates(options.origin?.lat, options.origin?.lng);
  const body = { textQuery, maxResultCount: 3,
    ...(origin && { locationBias: { circle: { center: { latitude: origin.lat, longitude: origin.lng }, radius: 24140.16 } } }) };
  try {
    const data = await requestPlace(`${PLACES_URL}:searchText`, body, options.signal);
    const candidates = (data.places || []).map(place => ({
      ...normalizedPlace(place, 'text_search'), similarity: calculateNameSimilarity(venueName, place.displayName?.text)
    })).filter(place => usablePlace(place) && place.similarity >= 0.4 &&
      (!origin || withinRadius(place, origin)) && (!options.country || !place.country || options.country === place.country));
    candidates.sort((a, b) => b.similarity - a.similarity);
    return candidates[0] || null;
  } catch (error) {
    options.signal?.throwIfAborted();
    venuesLog.warn(3, `Places text resolution unavailable: ${error.message}`);
    return null;
  }
}
