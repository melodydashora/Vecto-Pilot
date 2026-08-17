// server/lib/offers/offer-address.js
// ============================================================================
// OFFER CARD ADDRESS → TRUSTED POINT
// ============================================================================
// 2026-08-17 (Melody: "resolve the timezone from the offer's address — the first
// address on the screen"; "we may have to get details like we do for venues").
//
// The Phase-2 deep model returns `parsed_data.pickup` / `.dropoff` "exactly as
// shown". Those strings are the offer's own location evidence — the canonical
// shortcuts send no GPS — so the pickup now sources the offer's TIMEZONE, and both
// source pickup/dropoff coords + the geo audit. Everything here is deterministic
// and calibrated on live prod strings (2026-08-17); the rules are written down in
// docs/architecture/OFFER_ANALYZER.md §10.6. Pure except resolveTrustedPoint, whose
// I/O (Places search, distance) is injected so it is unit-tested with fakes
// (tests/offers/offer-address.test.js).
//
// Adversarial review 2026-08-17 (verified live) shaped v2:
//   - an UNBIASED exact geocode of a city-less string can land in another state
//     ("Shadywood Ct & Shadywood Ln" → Sylvania, OH) → exact is trusted without a
//     bias point ONLY when the card names a city;
//   - Places is fuzzy: "Unknown location" → "Parts Unknown, Fort Worth" (37 mi),
//     "Main St & 1st Ave" near Dallas → "One Main Place" office tower → placeholder
//     phrases are filtered, and a street-looking string must get an address-type
//     place, not an establishment;
//   - "Main St, Las Vegas NV" vs Las Vegas, NM → a state on the card must agree.
// Second pass (same day, verified live) shaped v3 — "card names a city" is not
// corroboration by itself: with a Frisco anchor Google still returned "Terminal E,
// Arrivals" → Boston (exact), "Main St, Gainesville" → Florida, "Main St, Reno" →
// Nevada; unbiased "Main St, Lancaster" → England. So:
//   - with an ANCHOR (GPS, or snapshot ≤12 h old) EVERY point must be physically
//     plausible: within 60 mi + 75 mph × anchor age (a driver seen in Frisco an hour
//     ago cannot be offered a Boston pickup; an 11-h anchor still admits Denver);
//   - with NO anchor a pickup is trusted only when the DROPOFF independently
//     resolves to a city-confirmed point within a ride-length of it (the two card
//     addresses corroborate each other); no Places without an anchor;
//   - a whole-string match that CONTRADICTS the card's city ("Main St, Allen" →
//     Frisco) is refused, not accepted; a placeholder with a digit ("Not visible in
//     image 1") is still a placeholder; a locality centroid may source the timezone
//     but never coordinates (`precise`).
// ============================================================================

// ---------------------------------------------------------------------------
// 1. Placeholder / usability
// ---------------------------------------------------------------------------

// Narrow street-suffix vocabulary: "does this string name a street or corner?"
const STREET_SUFFIX_RE = /\b(?:rd|road|st|street|ave|avenue|blvd|boulevard|dr|drive|ln|lane|way|pkwy|parkway|hwy|highway|ct|court|cir|circle|pl|place|ter|terrace|trl|trail|loop|fwy|freeway|expy|expressway|tollway|tpke|turnpike|row|xing|crossing|bridge|aly|alley|sq|square|plz|plaza|path|walk|run|pass|bnd|bend|cv|cove|pt|point|holw|hollow|vw|view|hts|heights|mnr|manor|est|estates)\b\.?/i;
// Broad place vocabulary (superset): anything that names a real place, used only to
// KEEP a string that starts with a placeholder word ("Unknown Rd, Plano" is a road).
const PLACE_WORD_RE = new RegExp(STREET_SUFFIX_RE.source.replace(/\)\\b\\\.\?$/, '|terminal|airport|station|mall|center|centre|park|market|hall|tower|building|bldg|hotel|hospital|school|university|college|stadium|arena|church|library|depot|dock|pier|gate|zone|lot|garage)\\b\\.?'), 'i');
// Whole-string tokens the models emit for an unreadable field.
const PLACEHOLDER_EXACT_RE = /^(?:unknown|n\s*[/.]?\s*a\.?|none|null|undefined|nil|tbd|-+|\?+|\.+|unavailable)$/i; // n/a, N.A., n / a, NA
// Phrases anywhere in the string that mean "there is no address here".
const PLACEHOLDER_PHRASE_RE = /\b(?:not\s+(?:visible|shown|available|legible|provided|readable|displayed|detected|specified|clear|found|applicable|present|listed|given)|unavailable|illegible|unreadable|unknown|n\s*\/\s*a|no\s+(?:address|pickup|dropoff|destination|location)\b|none\s+(?:visible|shown|given)|(?:cut|cropped)\s*off|obscured|off[\s-]*screen)\b/i;
// Lead words for a placeholder sentence ("Not clear", "Missing", "Blank", "Hidden").
const PLACEHOLDER_LEAD_RE = /^(?:unknown|unavailable|unreadable|illegible|unclear|obscured|cropped|hidden|missing|blank|empty|tbd|none|nil|null|undefined|not|no)\b/i;

/**
 * Normalize an extracted card address for geocoding, or return null when the
 * string is empty / a placeholder / too short to name a place.
 *
 * @param {unknown} value - raw model-extracted address
 * @returns {string|null} trimmed address, or null when unusable
 */
export function usableOfferAddress(value) {
  if (typeof value !== 'string') return null;
  let s = value
    .replace(/[\u200B-\u200D\uFEFF]/g, '')          // zero-width characters
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s"'“”‘’(\[{<]+|[\s"'“”‘’)\]}>.,;:!?]+$/g, '') // wrapping quotes/brackets/punct
    .trim();
  if (s.length < 4) return null;
  if ((s.match(/\p{L}/gu) || []).length < 2) return null; // "14", "--" name nothing
  const hasDigit = /\d/.test(s);
  const namesPlace = PLACE_WORD_RE.test(s);
  if (PLACEHOLDER_EXACT_RE.test(s)) return null;
  // "Not visible in screenshot", "Unknown location", "N/A (not visible)", "No pickup shown",
  // "Not visible in image 1" — a placeholder phrase is a placeholder with or without a digit
  // unless the string names an actual place ("Unknown Rd, Plano", "1500 Unknown St").
  if (!namesPlace && PLACEHOLDER_PHRASE_RE.test(s)) return null;
  // Lead-word sentences ("Not clear", "Missing", "Hidden") — but a real POI that happens to
  // start with such a word and names a city survives ("Hidden Hills Country Club, Frisco").
  if (!hasDigit && !namesPlace && PLACEHOLDER_LEAD_RE.test(s) && !cardCityAndState(s)) return null;
  return s;
}

/** True when the string reads like a street address or corner rather than a POI name. */
export function looksLikeStreet(address) {
  if (typeof address !== 'string') return false;
  return /\s(?:&|\/|and|@|at)\s/i.test(address) || STREET_SUFFIX_RE.test(address) || /^\d+\s/.test(address);
}

// ---------------------------------------------------------------------------
// 2. What city (and state) does the card name?
// ---------------------------------------------------------------------------

const US_STATES = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut',
  de: 'delaware', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa',
  ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan',
  mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire',
  nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma',
  or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee',
  tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin',
  wy: 'wyoming', dc: 'district of columbia', pr: 'puerto rico',
};
const CA_PROVINCES = {
  ab: 'alberta', bc: 'british columbia', mb: 'manitoba', nb: 'new brunswick', nl: 'newfoundland and labrador',
  ns: 'nova scotia', nt: 'northwest territories', nu: 'nunavut', on: 'ontario', pe: 'prince edward island',
  qc: 'quebec', sk: 'saskatchewan', yt: 'yukon',
};
const REGIONS = { ...US_STATES, ...CA_PROVINCES };
const REGION_NAME_TO_ABBR = Object.fromEntries(Object.entries(REGIONS).map(([a, n]) => [n, a]));
const COUNTRY_RE = /^(?:usa|u\.s\.a\.?|us|u\.s\.|united states(?: of america)?|canada|mexico|méxico|puerto rico)$/i;
// Trailing card segments that are venue/wayfinding words, not cities ("Terminal E, Arrivals",
// "DFW Airport, Terminal D", "Toyota Stadium, Gate A", "Main St, Downtown").
const NON_CITY_TAIL_RE = /^(?:arrivals?|departures?|pick-?ups?|drop-?offs?|downtown|uptown|midtown|entrance|exit|lobby|curbside|valet|rideshare(?: (?:pickup|zone|lot))?|baggage claim|(?:north|south|east|west|upper|lower|main)(?: (?:entrance|exit|level|lot|deck|garage|side))?|(?:gate|terminal|level|lot|zone|door|pier|dock|platform|floor|deck|garage|parking|concourse|hall|building|bldg|tower|suite|ste|unit|apt)(?: [a-z0-9-]+)?)$/i;
const ZIP_RE = /^(?:\d{5}(?:-\d{4})?|[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d)$/; // US ZIP / Canadian postal code

/** lower-case, diacritics folded, punctuation → space, collapsed. */
export const normalizeName = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036F]/g, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** "tx" | "texas" | "ON" | "ontario" → "tx" / "on"; anything else → null */
function stateAbbr(token) {
  const t = normalizeName(token);
  if (REGIONS[t]) return t;
  if (REGION_NAME_TO_ABBR[t]) return REGION_NAME_TO_ABBR[t];
  return null;
}

/**
 * The city (and, when present, US state) a rideshare card names:
 *   "Ohio Dr, Plano"                → { city: "Plano", state: null }
 *   "Allen Dr & Sherman Dr, The Colony" → { city: "The Colony", state: null }
 *   "1500 Main St, Dallas, TX"      → { city: "Dallas", state: "tx" }
 *   "Main St, Frisco TX 75034"      → { city: "Frisco", state: "tx" }
 *   "Main St, Dallas, Texas, USA"   → { city: "Dallas", state: "tx" }
 * null when the card names none ("Crockett St & Flora St", "Terminal B, Departures:
 * Zone 14" — a trailing segment with digits is not a place name).
 *
 * @param {string} address
 * @returns {{city: string, state: string|null}|null}
 */
export function cardCityAndState(address) {
  if (typeof address !== 'string' || !address.includes(',')) return null;
  const segs = address.split(',').map((x) => x.trim().replace(/[.\s]+$/, '')).filter(Boolean);
  if (segs.length < 2) return null;
  let state = null;
  // Walk from the end: drop country / postal / ONE state segment (remembering the state).
  // At most one state is consumed, so ", New York, NY" keeps "New York" as the city; a bare
  // full state name with nothing but the street before it ("Main St, Washington") is a city.
  while (segs.length > 1) {
    const last = segs[segs.length - 1].replace(/\.(?=\s|$)/g, ''); // "TX. USA" → "TX USA"
    if (COUNTRY_RE.test(last)) { segs.pop(); continue; }
    if (ZIP_RE.test(last)) { segs.pop(); continue; }
    if (state) break;
    let words = last.split(/\s+/);
    if (words.length > 1 && COUNTRY_RE.test(words[words.length - 1])) words = words.slice(0, -1); // "TX USA"
    if (words.length > 1 && COUNTRY_RE.test(words.slice(-2).join(' '))) words = words.slice(0, -2); // "TX United States"
    const lastNoCountry = words.join(' ');
    if (COUNTRY_RE.test(lastNoCountry)) { segs.pop(); continue; }
    // "TX", "Texas", "TX 75034", "ON M5B 2H1"
    let noZip = lastNoCountry;
    if (words.length > 1 && ZIP_RE.test(words[words.length - 1])) noZip = words.slice(0, -1).join(' ');
    else if (words.length > 2 && ZIP_RE.test(words.slice(-2).join(' '))) noZip = words.slice(0, -2).join(' ');
    const st = stateAbbr(noZip);
    const isAbbr = /^[A-Za-z]{2}$/.test(noZip.trim());
    if (st && (isAbbr || segs.length >= 3)) { state = st; segs.pop(); continue; }
    break;
  }
  if (segs.length < 2) return null; // only the street part remains → no city named
  let city = segs[segs.length - 1];
  // "Frisco TX" / "Frisco TX 75034" — a 2-letter region abbreviation (and postal code) glued to
  // the city. Full names are NOT split here: "Port Washington" is a city, not Port + WA.
  let words = city.split(/\s+/);
  if (words.length > 1 && ZIP_RE.test(words[words.length - 1])) words = words.slice(0, -1);
  else if (words.length > 2 && ZIP_RE.test(words.slice(-2).join(' '))) words = words.slice(0, -2);
  if (!state && words.length > 1 && /^[A-Za-z]{2}$/.test(words[words.length - 1]) && stateAbbr(words[words.length - 1])) {
    state = stateAbbr(words[words.length - 1]);
    words = words.slice(0, -1);
  }
  city = words.join(' ');
  if (!city || /\d/.test(city) || (city.match(/\p{L}/gu) || []).length < 2) return null;
  if (NON_CITY_TAIL_RE.test(city)) return null; // "Arrivals", "Gate A", "Downtown" name no city
  return { city, state };
}

// ---------------------------------------------------------------------------
// 3. Trust verdict for a Geocoding result
// ---------------------------------------------------------------------------

// Google address_component types that name the place a card's ", City" could refer to.
const CITY_COMPONENT_TYPES = new Set([
  'locality', 'sublocality', 'sublocality_level_1', 'neighborhood', 'postal_town',
  'administrative_area_level_3', 'administrative_area_level_2',
]);

function componentNames(geo, typeSet) {
  const out = [];
  for (const c of geo?.address_components || []) {
    if (!c || !Array.isArray(c.types) || !c.types.some((t) => typeSet.has(t))) continue;
    for (const n of [c.long_name, c.short_name]) { const v = normalizeName(n); if (v) out.push(v); }
  }
  return out;
}

/** Does the geocode's state agree with the state the card named (when it named one)? */
function stateAgrees(card, geo) {
  if (!card?.state) return true;
  const names = componentNames(geo, new Set(['administrative_area_level_1', 'country'])); // PR: Google models it as a country
  if (!names.length) return true; // result carries no region — nothing to contradict
  return names.some((n) => n === card.state || n === REGIONS[card.state]);
}

// Geocoding location_type / result types that denote a real point rather than an area
// centroid. An APPROXIMATE locality centroid can source the TIMEZONE but must not become
// pickup_lat/lng or a geo-audit input.
const PRECISE_LOCATION_TYPES = new Set(['ROOFTOP', 'RANGE_INTERPOLATED', 'GEOMETRIC_CENTER']);
const POINTISH_RESULT_TYPES = new Set(['intersection', 'route', 'street_address', 'premise', 'subpremise', 'street_number', 'establishment', 'point_of_interest', 'transit_station', 'airport', 'bus_station', 'train_station']);
function geoIsPrecise(geo) {
  if (PRECISE_LOCATION_TYPES.has(geo?.location_type)) return true;
  return (geo?.types || []).some((t) => POINTISH_RESULT_TYPES.has(t));
}

/**
 * Classify a Geocoding result for a card string. Deterministic; calibrated 2026-08-17.
 *
 *   'exact'     — whole-string match AND the card names a city that appears in the
 *                 result's city components (state/province on the card, if any, agrees).
 *   'card_city' — PARTIAL match whose result lies in the card-named city ("The Star Blvd &
 *                 Winning Dr, Frisco" → "Winning Dr, Frisco, TX": the corner was inexact,
 *                 the city — and so the timezone — is not).
 *   'whole'     — whole-string match of a string that names NO city ("Shadywood Ct &
 *                 Shadywood Ln"). Nothing on the card corroborates WHICH one Google chose;
 *                 only anchor proximity can (→ 'exact_near').
 *   null        — partial match of a city-less string; a result that CONTRADICTS the card
 *                 ("Main St, Allen" → Frisco; "Main St, Las Vegas NV" → NM); no result.
 *
 * NOTE: none of these classes is trusted by itself — resolveCardPoints adds the physical
 * corroboration (anchor plausibility, or the other card address).
 *
 * @param {string} cardAddress
 * @param {{partial_match?: boolean, address_components?: Array}|null} geo
 * @returns {'exact'|'card_city'|'whole'|null}
 */
export function classifyGeocode(cardAddress, geo) {
  if (!geo) return null;
  const card = cardCityAndState(cardAddress);
  if (!card) return geo.partial_match !== true ? 'whole' : null;
  if (!stateAgrees(card, geo)) return null;
  const want = normalizeName(card.city);
  const cityMatches = componentNames(geo, CITY_COMPONENT_TYPES).some((have) => have === want);
  if (!cityMatches) return null; // Google substituted another city — contradiction, not evidence
  return geo.partial_match !== true ? 'exact' : 'card_city';
}

// ---------------------------------------------------------------------------
// 4. Places fallback relevance
// ---------------------------------------------------------------------------

// Place types that denote an ADDRESS (as opposed to a business at some address).
const ADDRESS_PLACE_TYPES = new Set(['intersection', 'route', 'street_address', 'premise', 'subpremise', 'street_number', 'geocode', 'plus_code']);

// Tokens that carry no identity on their own (never count as query↔hit overlap).
const OVERLAP_STOPWORDS = new Set(['and', 'the', 'of', 'at', 'in', 'on', 'to', 'for', 'near', 'by', 'with', 'from',
  'north', 'south', 'east', 'west', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'st', 'ave', 'rd', 'dr', 'ln', 'blvd', 'ct', 'pl',
  'street', 'avenue', 'road', 'drive', 'lane', 'boulevard', 'court', 'place', 'way', 'pkwy', 'parkway', 'hwy', 'highway',
  'usa', 'us', 'tx', 'zone', 'gate', 'level', 'floor', 'suite', 'ste', 'unit', 'apt', 'bldg', 'building',
  // placeholder vocabulary must never count as identity ("Not visible in image 1" vs "Rye Not Corned Beef")
  'not', 'unknown', 'visible', 'image', 'screenshot', 'location', 'address', 'shown', 'pickup', 'dropoff', 'destination', 'none', 'null',
  // rideshare pickup-note vocabulary is not identity either ("Front entrance", "Door 3", "Curbside")
  // ("terminal", "arrivals", "gate" stay identifying — they are what names an airport pickup)
  'entrance', 'exit', 'door', 'doors', 'lobby', 'side', 'front', 'back', 'rear', 'curb', 'curbside', 'valet', 'area', 'spot', 'meet', 'here', 'there']);
const significantTokens = (s) => normalizeName(s).split(' ').filter((t) => t.length >= 3 && !OVERLAP_STOPWORDS.has(t));

/**
 * A Places Text Search hit is relevant only when (a) its kind matches the card string —
 * a street/corner string must get an address-type place ("Main St & 1st Ave" must not
 * become the "One Main Place" office tower); a POI-style string ("Terminal B,
 * Departures: Zone 14") may be any place (→ DFW Airport Terminal B) — AND (b) it shares
 * at least one significant token with the card string (review 2026-08-17: Places is
 * fuzzy enough to answer "Not visible in image" with "Not open yet, Frisco"; a hit that
 * shares no identifying word with the query is not the query).
 */
export function placeMatchesCard(cardAddress, place) {
  if (!place) return false;
  if (looksLikeStreet(cardAddress)) {
    const types = Array.isArray(place.types) ? place.types : [];
    if (!types.some((t) => ADDRESS_PLACE_TYPES.has(t))) return false;
  }
  const want = significantTokens(cardAddress);
  if (!want.length) return false; // nothing identifying in the query ("St & Ave") → cannot corroborate
  const have = new Set(significantTokens(`${place.displayName || ''} ${place.formattedAddress || ''}`));
  return want.some((t) => have.has(t));
}

// ---------------------------------------------------------------------------
// 5. The resolver (I/O injected)
// ---------------------------------------------------------------------------

/** How far a driver can plausibly be from an anchor seen `ageHours` ago (miles). */
export function plausibleRadiusMi(ageHours, nearMi = 60, mph = 75) {
  const h = Number.isFinite(ageHours) ? Math.max(0, ageHours) : 0;
  return nearMi + mph * h;
}

/**
 * Resolve BOTH card addresses to at most one trusted point each, the way venues are
 * resolved. Trust is never a class alone — it is a class PLUS physical corroboration:
 *
 *   ANCHOR present (driver GPS, or a snapshot ≤ 12 h old — the caller decides freshness):
 *     - a classified geocode ('exact' | 'card_city' | 'whole') is trusted only within
 *       plausibleRadiusMi(anchor.ageHours) of the anchor (60 mi + 75 mph × age): "Terminal E,
 *       Arrivals" → Boston is 1,559 mi from a fresh Frisco anchor → refused even though Google
 *       called it exact; an 11-h anchor still admits a Denver pickup. 'whole' is labelled
 *       'exact_near'.
 *     - else Places Text Search around the anchor (injected), accepted within `nearMi` AND of a
 *       kind that matches the string AND sharing an identifying token ('places_near').
 *   NO anchor (untokened + no GPS, or stale snapshot):
 *     - a pickup/dropoff is trusted only when BOTH classify as 'exact' | 'card_city' AND lie
 *       within `nearMi` of EACH OTHER (a ride length) — the two card addresses corroborate each
 *       other. One city-confirmed address alone ("Main St, Lancaster" → England) is not enough;
 *       'whole' is never trusted without an anchor; Places is never called without an anchor.
 *   Otherwise the address stays text-only.
 *
 * Every point carries `precise` (false for an area centroid): the caller uses any trusted
 * pickup for the TIMEZONE but only precise points for coordinates and the geo audit.
 *
 * @param {object} args
 * @param {{address: string|null, geo: object|null}} args.pickup
 * @param {{address: string|null, geo: object|null}} args.dropoff
 * @param {{lat:number, lng:number, ageHours?: number}|null} args.anchor
 * @param {(lat:number,lng:number,text:string)=>Promise<object|null>} args.searchPlaces
 * @param {(lat1:number,lng1:number,lat2:number,lng2:number)=>number} args.distanceMi
 * @param {number} [args.nearMi=60]
 * @param {{log:Function,warn:Function}} [args.logger=console]
 * @returns {Promise<{pickup: object|null, dropoff: object|null}>} points: { lat, lng, place_id, formatted_address, via, trust, corroboration, precise, distance_mi }
 */
export async function resolveCardPoints({ pickup, dropoff, anchor, searchPlaces, distanceMi, nearMi = 60, logger = console }) {
  const mk = (label, geo, cls, corroboration, dist) => ({
    label, lat: geo.lat, lng: geo.lng, place_id: geo.place_id ?? null, formatted_address: geo.formatted_address ?? null,
    via: 'geocode', trust: cls === 'whole' ? 'exact_near' : cls, corroboration, precise: geoIsPrecise(geo),
    distance_mi: dist == null ? null : Math.round(dist),
  });
  const cands = {};
  for (const [label, slot] of [['Pickup', pickup], ['Dropoff', dropoff]]) {
    const addr = slot?.address || null;
    const geo = slot?.geo || null;
    const cls = addr ? classifyGeocode(addr, geo) : null;
    if (addr && geo && !cls) {
      logger.warn(`[HOOKS] ${label} geocode UNTRUSTED ("${addr}" → ${geo.formatted_address}; ${geo.partial_match ? 'partial match outside the card-named city' : 'whole match that contradicts the card-named city'})`);
    }
    cands[label] = { addr, geo, cls };
  }
  const out = { Pickup: null, Dropoff: null };

  if (anchor) {
    const maxMi = plausibleRadiusMi(anchor.ageHours, nearMi);
    for (const label of ['Pickup', 'Dropoff']) {
      const { addr, geo, cls } = cands[label];
      if (!addr) continue;
      if (geo && cls) {
        const d = distanceMi(anchor.lat, anchor.lng, geo.lat, geo.lng);
        if (d <= maxMi) { out[label] = mk(label, geo, cls, 'anchor', d); continue; }
        logger.warn(`[HOOKS] ${label} geocode UNTRUSTED ("${addr}" → ${geo.formatted_address}; ${cls} but ${Math.round(d)} mi from the driver's last known position, > ${Math.round(maxMi)} mi plausible) — trying Places`);
      }
      // Places around the anchor
      let place = null;
      try { place = await searchPlaces(anchor.lat, anchor.lng, addr); } catch (err) {
        logger.warn(`[HOOKS] ${label} Places search failed (${err.message}) — unresolved`); continue;
      }
      if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) { logger.warn(`[HOOKS] ${label} unresolved: Places found nothing ("${addr}")`); continue; }
      const d = distanceMi(anchor.lat, anchor.lng, place.lat, place.lng);
      if (d > nearMi) { logger.warn(`[HOOKS] ${label} Places match UNTRUSTED ("${addr}" → ${place.displayName}, ${place.formattedAddress}: ${Math.round(d)} mi from the driver's last known position) — unresolved`); continue; }
      if (!placeMatchesCard(addr, place)) { logger.warn(`[HOOKS] ${label} Places match UNTRUSTED ("${addr}" → ${place.displayName} [${(place.types || []).slice(0, 3).join(',')}]: kind/name does not match the card string) — unresolved`); continue; }
      logger.log(`[HOOKS] ${label} resolved via Places ("${addr}" → ${place.displayName}, ${place.formattedAddress}, ${Math.round(d)} mi from anchor)`);
      out[label] = { label, lat: place.lat, lng: place.lng, place_id: place.placeId ?? null, formatted_address: place.formattedAddress ?? null, via: 'places', trust: 'places_near', corroboration: 'anchor', precise: true, distance_mi: Math.round(d) };
    }
    return { pickup: out.Pickup, dropoff: out.Dropoff };
  }

  // No anchor: mutual corroboration only.
  const pu = cands.Pickup; const dr = cands.Dropoff;
  const cityOk = (c) => c.geo && (c.cls === 'exact' || c.cls === 'card_city');
  if (cityOk(pu) && cityOk(dr)) {
    const d = distanceMi(pu.geo.lat, pu.geo.lng, dr.geo.lat, dr.geo.lng);
    if (d <= nearMi) {
      out.Pickup = mk('Pickup', pu.geo, pu.cls, 'other_address', d);
      out.Dropoff = mk('Dropoff', dr.geo, dr.cls, 'other_address', d);
      logger.log(`[HOOKS] Card addresses corroborate each other (${Math.round(d)} mi apart, no anchor): "${pu.addr}" → ${pu.geo.formatted_address}; "${dr.addr}" → ${dr.geo.formatted_address}`);
    } else {
      logger.warn(`[HOOKS] Card addresses do NOT corroborate (no anchor): "${pu.addr}" → ${pu.geo.formatted_address} vs "${dr.addr}" → ${dr.geo.formatted_address} are ${Math.round(d)} mi apart — both unresolved`);
    }
  } else if (pu.addr || dr.addr) {
    logger.warn(`[HOOKS] No anchor and no mutual corroboration (pickup: ${pu.addr ? (pu.cls || 'unclassified') : 'absent'}, dropoff: ${dr.addr ? (dr.cls || 'unclassified') : 'absent'}) — addresses stay text-only`);
  }
  return { pickup: out.Pickup, dropoff: out.Dropoff };
}
