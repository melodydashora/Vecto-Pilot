// server/lib/venue/venue-address-resolver.js
//
// Resolve venue coordinates to addresses using:
// 1. venue_catalog cache (by coord_key)
// 2. Google Places (NEW) API (New) with 50m locationBias
// 3. Fallback to Google Geocoding API
//
// Updated 2026-01-05: Migrated to Google Places (NEW) API (New) and venue_catalog integration
// See: /home/runner/.claude/plans/noble-purring-yeti.md
//
// 2026-04-27 (Commit 3 of CLEAR_CONSOLE_WORKFLOW spec): plus-code rejection
// log demoted to debug. Set LOG_VERBOSE_COMPONENTS=VENUES to see it again.
import { createWorkflowLogger } from '../../logger/workflow.js';
const resolverLog = createWorkflowLogger('VENUES');

import { normalizeCoordinates } from '../../../shared/coordinates.js';
import { isPlusCode } from '../../api/utils/http-helpers.js';
import {
  generateCoordKey,
  parseAddressComponents
} from './venue-utils.js';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

// ─────────────────────────────────────────────────────────────────────────────
// 2026-09-29: TEXT-SEARCH IDENTITY ACCEPTANCE
// ─────────────────────────────────────────────────────────────────────────────
// A provider text search answers with its best guess, not with proof. Its first
// result used to become a venue's place_id with no comparison at all, and the
// planner accepted a 0.4 word overlap ("The <A>" matched "The <B>" on "the").
// A result now becomes an identity only with meaningful agreement:
//   - NAME: function words carry nothing; venue-kind words ("bar", "hall") never
//     establish agreement on their own; the two names must share a distinctive
//     word and must not BOTH hold a word the other lacks.
//   - or ADDRESS: the provider's street number and street name are both present
//     in what was asked for.
// Stage names used in logs: VENUE_TEXT_SEARCH (transport), VENUE_TEXT_IDENTITY
// (acceptance).
const SEARCH_STAGE = 'VENUE_TEXT_SEARCH';
const IDENTITY_STAGE = 'VENUE_TEXT_IDENTITY';

const IDENTITY_STOPWORDS = new Set(['the', 'a', 'an', 'and', 'at', 'of', 'in', 'on', 'by', 'for', 'to', 'with', 'from',
  'de', 'del', 'la', 'las', 'el', 'los', 'le', 'les']);
const GENERIC_VENUE_WORDS = new Set(['bar', 'pub', 'tavern', 'saloon', 'lounge', 'club', 'nightclub', 'grill', 'restaurant',
  'cafe', 'kitchen', 'bistro', 'cantina', 'diner', 'eatery', 'brewery', 'taproom', 'winery', 'distillery', 'hotel', 'inn',
  'resort', 'hall', 'center', 'theater', 'amphitheater', 'arena', 'stadium', 'field', 'park', 'pavilion', 'ballroom', 'plaza',
  'venue', 'room', 'house', 'garden', 'gardens', 'complex', 'coliseum', 'auditorium', 'mall', 'market', 'museum', 'gallery',
  'library', 'church', 'school', 'university', 'college', 'company']);
// One word, several spellings. Both sides are compared in the same spelling.
const TOKEN_SPELLINGS = new Map([['theatre', 'theater'], ['centre', 'center'], ['ctr', 'center'],
  ['amphitheatre', 'amphitheater'], ['grille', 'grill'], ['co', 'company']]);
// Normalize spelling without erasing the street type or direction: Main Avenue
// and Main Street, or North Main and South Main, can be different addresses.
const STREET_TOKEN_SPELLINGS = new Map([['st', 'street'], ['ave', 'avenue'], ['blvd', 'boulevard'], ['dr', 'drive'],
  ['rd', 'road'], ['ln', 'lane'], ['ct', 'court'], ['pl', 'place'], ['pkwy', 'parkway'], ['hwy', 'highway'],
  ['cir', 'circle'], ['trl', 'trail'], ['ter', 'terrace'], ['n', 'north'], ['s', 'south'], ['e', 'east'], ['w', 'west'],
  ['ne', 'northeast'], ['nw', 'northwest'], ['se', 'southeast'], ['sw', 'southwest'],
  ['ste', 'suite'], ['apt', 'apartment'], ['fl', 'floor']]);

const identityTokens = value => (typeof value === 'string' ? value : '')
  .normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/['’`]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
  .map(token => TOKEN_SPELLINGS.get(token) || token);
const componentText = component => [component?.longText, component?.shortText, component?.long_name, component?.short_name];
const LOCALITY_COMPONENT_TYPES = ['locality', 'postal_town', 'administrative_area_level_1', 'country'];

function localityTokens(expected, place) {
  const words = new Set();
  for (const component of Array.isArray(place?.addressComponents) ? place.addressComponents : []) {
    if (!LOCALITY_COMPONENT_TYPES.some(type => component?.types?.includes(type))) continue;
    for (const text of componentText(component)) for (const token of identityTokens(text)) words.add(token);
  }
  for (const text of [expected?.city, expected?.state]) for (const token of identityTokens(text)) words.add(token);
  return words;
}

/** Content words of a name: function words removed, a trailing city/state/country dropped. */
function nameWords(name, locality) {
  const words = identityTokens(name).filter(token => !IDENTITY_STOPWORDS.has(token));
  // "<Venue> <City>" and "<Venue>" are one place. Only a trailing locality is
  // dropped, and never the whole name.
  while (words.length > 1 && locality.has(words[words.length - 1])) words.pop();
  return [...new Set(words)];
}

function compareNames(asked, returned, locality) {
  const want = nameWords(asked, locality), have = nameWords(returned, locality);
  if (!want.length) return { ok: false, reason: 'the requested name holds no identifying word' };
  if (!have.length) return { ok: false, reason: 'the provider name holds no identifying word' };
  const wantOnly = want.filter(word => !have.includes(word)), haveOnly = have.filter(word => !want.includes(word));
  const shared = want.filter(word => have.includes(word));
  const distinctive = words => words.filter(word => !GENERIC_VENUE_WORDS.has(word));
  if (wantOnly.length && haveOnly.length) {
    return { ok: false, reason: `names disagree: requested has "${wantOnly.join(' ')}", provider has "${haveOnly.join(' ')}"` };
  }
  if (!distinctive(shared).length) {
    // Two names made only of venue-kind words agree only when they are the same words.
    if (!distinctive(want).length && !distinctive(have).length && !wantOnly.length && !haveOnly.length) return { ok: true, reason: null };
    return { ok: false, reason: shared.length
      ? `names share only the venue-kind word "${shared.join(' ')}"` : 'names share no word' };
  }
  return { ok: true, reason: null };
}

function providerStreet(place) {
  const components = Array.isArray(place?.addressComponents) ? place.addressComponents : [];
  const text = type => componentText(components.find(component => component?.types?.includes(type))).find(Boolean) || '';
  const streetNumber = text('street_number'), streetRoute = text('route');
  // Partial components (and their parsed address_1) must not hide a complete
  // provider formatted address: that would bypass a known branch conflict.
  const streets = [streetNumber && streetRoute ? `${streetNumber} ${streetRoute}` : null,
    typeof place?.formattedAddress === 'string' ? place.formattedAddress.split(',')[0] : null, place?.parsed?.address_1];
  for (const street of streets) {
    const words = identityTokens(street);
    const number = words.find(word => /^\d+[a-z]?$/.test(word));
    const route = words.filter(word => word !== number && !IDENTITY_STOPWORDS.has(word))
      .map(word => STREET_TOKEN_SPELLINGS.get(word) || word);
    if (number && route.length) return { number, route };
  }
  return null;
}

function compareStreetAddress(askedText, place) {
  const street = providerStreet(place);
  if (!street || typeof askedText !== 'string') return { matches: false, conflicts: false };
  // Compare one numbered street segment. Words in a venue name, another
  // address segment or the city cannot stand in for the requested street.
  const asked = askedText.split(',').filter(segment => /^\s*\d+[a-z]?(?:\s|$)/i.test(segment))
    .map(segment => providerStreet({ formattedAddress: segment })).filter(Boolean);
  const matches = asked.some(address => address.number === street.number && address.route.length === street.route.length &&
    street.route.every((word, index) => word === address.route[index]));
  return { matches, conflicts: asked.length > 0 && !matches };
}

/**
 * Decide whether a provider text-search result is the place that was asked for.
 * Pure: no provider, database or log access.
 *
 * @param {Object} expected
 * @param {string} [expected.name] - the requested venue name (model or catalog)
 * @param {string} [expected.address] - the requested street address
 * @param {string} [expected.query] - the search text, used when name and address are not given separately
 * @param {string} [expected.city] - requested city (a trailing city in a name is not identity)
 * @param {string} [expected.state] - requested state
 * @param {Object} place
 * @param {string} place.displayName - provider name
 * @param {string} [place.formattedAddress]
 * @param {Array} [place.addressComponents] - provider address components
 * @param {Object} [place.parsed] - parseAddressComponents() output
 * @returns {{accepted: boolean, evidence: 'name'|'address'|null, requestedName: string|null, reason: string|null}}
 */
export function verifyPlaceIdentity(expected = {}, place = {}) {
  const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
  const name = text(expected.name), address = text(expected.address), query = text(expected.query);
  // Without separate fields the leading segment of "name, address, city, ..." is the name.
  const requestedName = name || (query ? text(query.split(',')[0]) : null);
  const accept = evidence => ({ accepted: true, evidence, requestedName, reason: null });
  const reject = reason => ({ accepted: false, evidence: null, requestedName, reason });
  if (!requestedName && !address) return reject('nothing was supplied to compare the provider result with');
  const locality = localityTokens(expected, place);
  const providerName = text(place?.displayName);
  const nameVerdict = requestedName && providerName ? compareNames(requestedName, providerName, locality) : null;
  const queryParts = query?.split(',');
  // "13 Celsius Wine" is a venue name, not a street at number 13. Exclude
  // the name segment when the explicit name or provider comparison identifies
  // it as such; separately supplied or later street segments still constrain it.
  const leadingName = queryParts && (name ? compareNames(name, queryParts[0], locality).ok : nameVerdict?.ok);
  const askedAddress = address || (leadingName ? queryParts.slice(1).join(',') : query);
  const streetComparison = compareStreetAddress(askedAddress, place);
  // Chain businesses can share a name. A known contradictory street address
  // rules out that branch even when the names agree exactly.
  if (streetComparison.conflicts) return reject('the provider street address conflicts with the requested street address');
  const reasons = [];
  if (requestedName) {
    if (!providerName) reasons.push('the provider result has no name');
    else {
      if (nameVerdict.ok) return accept('name');
      reasons.push(nameVerdict.reason);
      // Address/locality words elsewhere in the query cannot repair a failed
      // venue-name comparison. Callers with separate fields pass explicit expectations.
    }
  }
  if (askedAddress) {
    if (streetComparison.matches) return accept('address');
    reasons.push(providerStreet(place) ? 'the provider street address is not in what was requested'
      : 'the provider result has no street number and street name to compare');
  }
  return reject(reasons.join('; '));
}

/**
 * Resolve venue coordinates to a formatted address
 *
 * Flow:
 * 1. Check venue_catalog cache by coord_key (6 decimal precision)
 * 2. If not cached, call Google Places (NEW) API (New) with 50m radius
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

  if (!normalizeCoordinates(lat, lng)) return null;

  const coordKey = generateCoordKey(lat, lng);

  try {
    // Step 1: Check venue_catalog cache by coord_key
    if (!skipCache && coordKey) {
      // Dynamic import avoids the cache's address-repair dependency cycle while
      // keeping all identity/ambiguity rules and access tracking in one place.
      const { lookupVenue } = await import('./venue-cache.js');
      const cached = await lookupVenue({ coordKey, venueName });
      if (cached) {
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

    // Step 2: Try Google Places (NEW) API (New) with 50m radius
    if (venueName && GOOGLE_MAPS_API_KEY) {
      const placeResult = await searchPlaceWithTextSearch(lat, lng, venueName, { expectedName: venueName });

      if (placeResult) {
        // Upsert into venue_catalog
        if (upsertCache) {
          await upsertVenueCatalog({
            venue_name: placeResult.displayName || venueName,
            place_id: placeResult.placeId,
            formatted_address: placeResult.formattedAddress,
            ...placeResult.parsed,
            lat: placeResult.lat,
            lng: placeResult.lng,
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
          lat: placeResult.lat,
          lng: placeResult.lng,
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
    throw new Error(`[VENUE] Failed to resolve address for coords (${lat}, ${lng}) with name "${venueName}" - all resolution methods exhausted`);
  } catch (err) {
    // Re-throw with context - don't mask the error
    console.error('[VENUE] Address resolution failed:', err.message);
    throw err;
  }
}

/**
 * Search for a place using Google Places (NEW) API (New) with configurable locationBias,
 * and say what happened: found, absent, rejected, provider failure or cancelled.
 *
 * 2026-09-29: a provider outage used to be indistinguishable from "no such venue"
 * (both were null), and the first result was accepted with no comparison.
 *
 * @param {number} lat - Latitude for location bias center
 * @param {number} lng - Longitude for location bias center
 * @param {string} textQuery - Search text
 * @param {Object} [options] - Search options
 * @param {number} [options.radius=50] - Location bias radius in meters.
 * @param {AbortSignal} [options.signal] - optional abort
 * @param {string} [options.expectedName] - requested venue name, compared with the provider name
 * @param {string} [options.expectedAddress] - requested street address, compared with the provider address
 * @param {boolean} [options.callerVerifiesIdentity] - true ONLY when the caller runs its own
 *   relevance gate on the returned place (the result is then returned unjudged)
 * @returns {Promise<{outcome: 'found'|'absent'|'rejected'|'provider_failure'|'aborted', place: Object|null, reason: string|null}>}
 */
export async function resolvePlaceByTextSearch(lat, lng, textQuery, options = {}) {
  const result = (outcome, place, reason) => ({ outcome, place, reason });
  if (typeof textQuery !== 'string' || !textQuery.trim()) return result('absent', null, 'no search text was supplied');
  const radius = options.radius ?? 50.0;
  // The search text can be a rider's address (Offer Analyzer), so transport logs
  // describe the request and the cause, never the text.
  const failure = reason => {
    resolverLog.warn(3, `[${SEARCH_STAGE}] Places provider failure (radius ${radius} m): ${reason}`);
    return result('provider_failure', null, reason);
  };
  if (!GOOGLE_MAPS_API_KEY) return failure('Places provider is not configured');

  let data;
  try {
    const response = await fetch(PLACES_TEXT_SEARCH_URL, {
      method: 'POST',
      ...(options.signal ? { signal: options.signal } : {}),
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
            radius
          }
        },
        maxResultCount: 1
      })
    });
    if (!response.ok) return failure(`HTTP ${response.status}`);
    data = await response.json();
  } catch (err) {
    if (options.signal?.aborted) {
      resolverLog.debug(`[${SEARCH_STAGE}] cancelled by the caller: ${err?.message || err}`);
      return result('aborted', null, `cancelled by the caller: ${err?.message || err}`);
    }
    return failure(err?.message || String(err));
  }

  const place = data?.places?.[0];
  if (!place) return result('absent', null, 'Places provider returned no result');

  // Parse address components into granular fields
  const parsed = parseAddressComponents(place.addressComponents || []);

  // Reject plus codes
  if (place.formattedAddress && isPlusCode(place.formattedAddress)) {
    resolverLog.debug(`[${IDENTITY_STAGE}] rejected: the provider address is a plus code (${place.formattedAddress})`);
    return result('rejected', null, 'the provider address is a plus code, not a street address');
  }

  // coord_key precision is a lookup convention, not permission to discard
  // provider coordinates used by navigation, routing and event linking.
  const point = normalizeCoordinates(place.location?.latitude, place.location?.longitude);
  if (!point) {
    resolverLog.warn(3, `[${IDENTITY_STAGE}] rejected provider place ${place.id || '(no id)'}: it has no usable coordinates`);
    return result('rejected', null, 'the provider result has no usable coordinates');
  }

  const displayName = place.displayName?.text;
  let verdict;
  if (options.callerVerifiesIdentity === true) {
    verdict = { accepted: true, evidence: 'caller', requestedName: null, reason: null };
  } else {
    verdict = verifyPlaceIdentity({ name: options.expectedName, address: options.expectedAddress, query: textQuery },
      { displayName, formattedAddress: place.formattedAddress, addressComponents: place.addressComponents, parsed });
    if (!verdict.accepted) {
      resolverLog.warn(3, `[${IDENTITY_STAGE}] rejected: asked for "${verdict.requestedName ?? ''}", ` +
        `Places provider returned "${displayName ?? ''}" (${place.id || 'no id'}): ${verdict.reason}`);
      return result('rejected', null, verdict.reason);
    }
  }

  return result('found', {
    placeId: place.id,
    displayName,
    formattedAddress: place.formattedAddress,
    lat: point.lat,
    lng: point.lng,
    types: place.types || [],
    parsed,
    // The name that was asked for stays next to the provider's name, so a
    // mismatch that was accepted on address evidence remains visible.
    requestedName: verdict.requestedName,
    identityEvidence: verdict.evidence
  }, null);
}

/**
 * Search for a place using Google Places (NEW) API (New) with configurable locationBias.
 *
 * Returns the place, or null for every other outcome. Callers that must tell a
 * provider outage from "not found" use resolvePlaceByTextSearch(), which returns
 * the outcome and its reason; every non-found outcome is logged there.
 *
 * @param {number} lat - Latitude for location bias center
 * @param {number} lng - Longitude for location bias center
 * @param {string} textQuery - Venue name to search
 * @param {Object} [options] - Search options (see resolvePlaceByTextSearch)
 * @param {number} [options.radius=50] - Location bias radius in meters.
 * @param {AbortSignal} [options.signal] - 2026-08-17: optional abort (e.g. AbortSignal.timeout) — the Offer Analyzer bounds this call.
 *   Use 50 (default) for precise venue-coordinate lookups where you already have the venue's location.
 *   Use 50000 (50km) for metro-wide event discovery where lat/lng is the driver's snapshot location.
 * @returns {Promise<Object|null>} - Place result: { placeId, displayName, formattedAddress, lat, lng, types, parsed: { city, state, zip, country }, requestedName, identityEvidence }
 */
// 2026-04-10: Exported for use in briefing-service.js event venue resolution pipeline.
// Added optional radius parameter for metro-wide event discovery (50km vs default 50m).
export async function searchPlaceWithTextSearch(lat, lng, textQuery, options = {}) {
  return (await resolvePlaceByTextSearch(lat, lng, textQuery, options)).place;
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
    console.warn('[VENUE] Geocoding failed:', err.message);
    return null;
  }
}

/** Cache provider results through the catalog's single identity writer. */
async function upsertVenueCatalog(venue) {
  try {
    const { insertVenue } = await import('./venue-cache.js');
    await insertVenue({
      venueName: venue.venue_name, placeId: venue.place_id,
      address: venue.formatted_address, formattedAddress: venue.formatted_address,
      address1: venue.address_1, city: venue.city, state: venue.state,
      zip: venue.zip, country: venue.country, lat: venue.lat, lng: venue.lng,
      source: venue.source, discoverySource: 'address_resolver', recordStatus: 'stub',
    });
  } catch (err) {
    // Cache writes are optional; keep the verified provider response on failure.
    console.warn('[VENUE] Upsert failed:', err.message);
  }
}

/**
 * Batch resolve addresses for multiple venues (optimized for performance)
 *
 * @param {Array} venues - Array of {lat, lng, name}
 * @returns {Promise<Object>} Map keyed by "lat,lng" for unique points; repeated
 * points use "lat,lng#index" (zero-based input index) so no input is overwritten.
 */
export async function resolveVenueAddressesBatch(venues) {
  const results = {};
  const counts = new Map();
  for (const venue of venues) {
    const point = `${venue.lat},${venue.lng}`;
    counts.set(point, (counts.get(point) || 0) + 1);
  }

  // Resolve in parallel with Promise.all but limit concurrency to 5 simultaneous requests
  const chunks = [];
  for (let i = 0; i < venues.length; i += 5) {
    chunks.push(venues.slice(i, i + 5).map((venue, offset) => ({ venue, index: i + offset })));
  }

  for (const chunk of chunks) {
    const promises = chunk.map(async ({ venue: v, index }) => {
      const point = `${v.lat},${v.lng}`;
      const key = counts.get(point) > 1 ? `${point}#${index}` : point;
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
