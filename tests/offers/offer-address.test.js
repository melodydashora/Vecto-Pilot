// tests/offers/offer-address.test.js — card address → trusted point (2026-08-17).
// Calibration inputs are LIVE prod pickup strings and live Google answers observed that
// day (see docs/architecture/OFFER_ANALYZER.md §10.6); Google itself is never called here.
import {
  usableOfferAddress, looksLikeStreet, cardCityAndState, normalizeName,
  classifyGeocode, placeMatchesCard, plausibleRadiusMi, resolveCardPoints,
} from '../../server/lib/offers/offer-address.js';
import { viewportBounds } from '../../server/lib/events/pipeline/geocodeEvent.js';

const comps = (locality, state = ['Texas', 'TX'], extra = []) => [
  { long_name: '75034', short_name: '75034', types: ['postal_code'] },
  ...(locality ? [{ long_name: locality, short_name: locality, types: ['locality', 'political'] }] : []),
  { long_name: state[0], short_name: state[1], types: ['administrative_area_level_1', 'political'] },
  { long_name: 'United States', short_name: 'US', types: ['country', 'political'] },
  ...extra,
];
const geo = (formatted, locality, partial, state, extra = {}) => ({
  lat: 33.1, lng: -96.8, place_id: 'pid', formatted_address: formatted, partial_match: partial, address_components: comps(locality, state),
  location_type: 'GEOMETRIC_CENTER', types: ['route'], ...extra,
});

describe('usableOfferAddress — card address hygiene', () => {
  test('keeps real card addresses (trimmed, whitespace-collapsed, wrapping quotes stripped)', () => {
    expect(usableOfferAddress('Allen Dr & Sherman Dr, The Colony')).toBe('Allen Dr & Sherman Dr, The Colony');
    expect(usableOfferAddress('  Ohio Dr,   Plano ')).toBe('Ohio Dr, Plano');
    expect(usableOfferAddress('"Terminal B, Departures: Zone 14"')).toBe('Terminal B, Departures: Zone 14');
    expect(usableOfferAddress('Lebanon Rd / Legacy Dr')).toBe('Lebanon Rd / Legacy Dr');
    expect(usableOfferAddress('1234 Main St.')).toBe('1234 Main St');
    // placeholder LEAD words that actually name a place stay
    expect(usableOfferAddress('Unknown Rd, Plano')).toBe('Unknown Rd, Plano');
    expect(usableOfferAddress('None Rd')).toBe('None Rd');
    expect(usableOfferAddress('NA Blvd')).toBe('NA Blvd');
    expect(usableOfferAddress('TBD Ave')).toBe('TBD Ave');
    expect(usableOfferAddress('North Richland Hills Blvd')).toBe('North Richland Hills Blvd');
    expect(usableOfferAddress('Nottingham Dr')).toBe('Nottingham Dr');
    expect(usableOfferAddress('Straße 1, München')).toBe('Straße 1, München');
    expect(usableOfferAddress('東京都千代田区')).toBe('東京都千代田区');
  });

  test('rejects the placeholders the models emit (prod-observed "unknown"/"Unknown" and phrasings)', () => {
    for (const p of ['unknown', 'Unknown', 'UNKNOWN', 'N/A', 'n/a', 'NA', 'none', 'null', 'undefined',
      'not visible', 'Not shown', 'not legible', 'unavailable', 'No address', '-', '--', '???', '...',
      // review-found variants (2026-08-17): these reached Places and got "trusted" nearby businesses
      'Not visible in screenshot', 'Not visible in image', 'Not shown on screen', 'None visible',
      'Unknown location', 'unknown pickup', 'Unknown (cropped)', '(unknown)', '[unknown]', '"unknown"', 'Unknown.',
      'unknown/not shown', 'unknown / not shown', 'N/A (not visible)', 'N/A - not visible', 'N/A.', 'n / a',
      'Not clear', 'Not specified', 'not applicable', 'not detected', 'not found', 'No pickup shown',
      'Address unavailable', 'Pickup not visible', 'illegible', 'unreadable', 'unclear', 'obscured', 'cropped',
      'cut off', 'hidden', 'missing', 'blank', 'empty', 'Unknown​', 'off-screen',
      // second review: a digit does not make a placeholder an address
      'Not visible in image 1', 'Unknown location 1', 'N/A (2 addresses)']) {
      expect(usableOfferAddress(p)).toBeNull();
    }
  });
  test('a real POI that starts with a lead word survives when it names a city (second review)', () => {
    expect(usableOfferAddress('Hidden Hills Country Club, Frisco')).toBe('Hidden Hills Country Club, Frisco');
    expect(usableOfferAddress('No Frills Grocery, Toronto')).toBe('No Frills Grocery, Toronto');
    expect(usableOfferAddress('1500 Unknown St')).toBe('1500 Unknown St');
    // documented fail-safe: lead-word POI with no city and no place word is still dropped
    expect(usableOfferAddress('Hidden Valley')).toBeNull();
  });

  test('rejects non-strings, empties, and fragments that name nothing', () => {
    expect(usableOfferAddress(null)).toBeNull();
    expect(usableOfferAddress(undefined)).toBeNull();
    expect(usableOfferAddress(42)).toBeNull();
    expect(usableOfferAddress('')).toBeNull();
    expect(usableOfferAddress('   ')).toBeNull();
    expect(usableOfferAddress('14')).toBeNull();
    expect(usableOfferAddress('St')).toBeNull();
    expect(usableOfferAddress('1234 5')).toBeNull();
  });
});

describe('looksLikeStreet', () => {
  test('corners and streets vs POI names', () => {
    expect(looksLikeStreet('Main St & 1st Ave')).toBe(true);
    expect(looksLikeStreet('Lebanon Rd / Legacy Dr')).toBe(true);
    expect(looksLikeStreet('Ohio Dr, Plano')).toBe(true);
    expect(looksLikeStreet('1500 Main, Dallas')).toBe(true);
    expect(looksLikeStreet('Terminal B, Departures: Zone 14')).toBe(false);
    expect(looksLikeStreet('The Star in Frisco')).toBe(false);
    expect(looksLikeStreet('DFW Airport')).toBe(false);
  });
});

describe('cardCityAndState — the ", City[, ST]" a card names', () => {
  test('returns city (+state) for the shapes cards use', () => {
    expect(cardCityAndState('Ohio Dr, Plano')).toEqual({ city: 'Plano', state: null });
    expect(cardCityAndState('Allen Dr & Sherman Dr, The Colony')).toEqual({ city: 'The Colony', state: null });
    expect(cardCityAndState('Main St, Frisco TX')).toEqual({ city: 'Frisco', state: 'tx' });
    expect(cardCityAndState('Main St, Frisco TX 75034')).toEqual({ city: 'Frisco', state: 'tx' });
    expect(cardCityAndState('1500 Main St, Dallas, TX')).toEqual({ city: 'Dallas', state: 'tx' });
    expect(cardCityAndState('Main St, Dallas, Texas')).toEqual({ city: 'Dallas', state: 'tx' });
    expect(cardCityAndState('Main St, Dallas, TX 75201, USA')).toEqual({ city: 'Dallas', state: 'tx' });
    expect(cardCityAndState('Main St, Las Vegas NV')).toEqual({ city: 'Las Vegas', state: 'nv' });
    expect(cardCityAndState('Rue de Rivoli, Paris')).toEqual({ city: 'Paris', state: null });
    // second review: cities that are state names, one state only, provinces, postal codes
    expect(cardCityAndState('Broadway, New York, NY')).toEqual({ city: 'New York', state: 'ny' });
    expect(cardCityAndState('Main St, Washington, DC')).toEqual({ city: 'Washington', state: 'dc' });
    expect(cardCityAndState('Main St, Washington')).toEqual({ city: 'Washington', state: null });
    expect(cardCityAndState('Main St, Nevada, MO')).toEqual({ city: 'Nevada', state: 'mo' });
    expect(cardCityAndState('Main St, Port Washington')).toEqual({ city: 'Port Washington', state: null });
    expect(cardCityAndState('123 Yonge St, Toronto, ON')).toEqual({ city: 'Toronto', state: 'on' });
    expect(cardCityAndState('123 Yonge St, Toronto ON M5B 2H1')).toEqual({ city: 'Toronto', state: 'on' });
    expect(cardCityAndState('Calle Sol, San Juan, PR')).toEqual({ city: 'San Juan', state: 'pr' });
    expect(cardCityAndState('Main St, Dallas, TX. USA.')).toEqual({ city: 'Dallas', state: 'tx' });
  });
  test('returns null when the card names no city', () => {
    expect(cardCityAndState('Crockett St & Flora St')).toBeNull();
    expect(cardCityAndState('Terminal B, Departures: Zone 14')).toBeNull(); // digits → not a place
    expect(cardCityAndState('Terminal E, Arrivals')).toBeNull();            // wayfinding word, not a city
    expect(cardCityAndState('DFW Airport, Terminal D')).toBeNull();
    expect(cardCityAndState('Toyota Stadium, Gate A')).toBeNull();
    expect(cardCityAndState('Main St, Downtown')).toBeNull();
    expect(cardCityAndState('Main St & 1st Ave')).toBeNull();
    expect(cardCityAndState('Lebanon Rd / Legacy Dr,')).toBeNull();
    expect(cardCityAndState('Main St, TX')).toBeNull();          // only a state → no city
    expect(cardCityAndState('Frisco, TX 75034')).toBeNull();     // no street part → the "city" would be the street slot
    expect(cardCityAndState(null)).toBeNull();
  });
  test('normalizeName folds case, diacritics, punctuation', () => {
    expect(normalizeName('Ciudad Juárez')).toBe('ciudad juarez');
    expect(normalizeName('  The  Colony. ')).toBe('the colony');
  });
});

describe('classifyGeocode — class only (trust needs corroboration in resolveCardPoints)', () => {
  test('whole match with the card-named city present in components → exact', () => {
    expect(classifyGeocode('Ohio Dr, Plano', geo('Ohio Dr, Plano, TX, USA', 'Plano', false))).toBe('exact');
    expect(classifyGeocode('Colfax Ave & Broadway, Denver', geo('E Colfax Ave & Broadway, Denver, CO', 'Denver', false, ['Colorado', 'CO']))).toBe('exact');
    expect(classifyGeocode('Broadway, New York, NY', geo('Broadway, New York, NY', 'New York', false, ['New York', 'NY']))).toBe('exact');
  });
  test('whole match of a CITY-LESS string → whole (live: Sylvania OH / Flower Mound TX)', () => {
    expect(classifyGeocode('Shadywood Ct & Shadywood Ln', geo('Shadywood Ln & Shadywood Ct, Sylvania, OH', 'Sylvania', false, ['Ohio', 'OH']))).toBe('whole');
    expect(classifyGeocode('Crockett St & Flora St', geo('…, Dallas, TX', 'Dallas', false))).toBe('whole');
  });
  test('partial match inside the card-named city → card_city (live: Star Blvd → Winning Dr, Frisco)', () => {
    expect(classifyGeocode('The Star Blvd & Winning Dr, Frisco', geo('Winning Dr, Frisco, TX 75034, USA', 'Frisco', true))).toBe('card_city');
    expect(classifyGeocode('Internet & Warren, Frisco', geo('Frisco, TX, USA', 'Frisco', true, undefined, { location_type: 'APPROXIMATE', types: ['locality', 'political'] }))).toBe('card_city');
    expect(classifyGeocode('1500 Main St, Dallas, TX', geo('Main St, Dallas, TX 75201', 'Dallas', true))).toBe('card_city');
    expect(classifyGeocode('Av. Juárez 12, Ciudad Juarez', { partial_match: true, address_components: [
      { long_name: 'Ciudad Juárez', short_name: 'Cd Juárez', types: ['locality', 'political'] }] })).toBe('card_city');
  });
  test('a result that CONTRADICTS the card-named city → null, even if Google called it exact (second review: "Main St, Allen" → Frisco)', () => {
    expect(classifyGeocode('Main St, Allen', geo('Main St, Frisco, TX', 'Frisco', false))).toBeNull();
    expect(classifyGeocode('Main St, Frisco', geo('…', 'Plano', true))).toBeNull();
    // trailing "Arrivals" is not a city → the string is city-less; Boston is a whole match → 'whole' (anchor gate refuses it later)
    expect(classifyGeocode('Terminal E, Arrivals', geo('Terminal E. Arrivals, Boston, MA', 'Boston', false, ['Massachusetts', 'MA']))).toBe('whole');
  });
  test('partial match of a city-less string → null (live: "Main St & 1st Ave" → West Haven, CT)', () => {
    expect(classifyGeocode('Main St & 1st Ave', geo('Main St & 1st Ave, West Haven, CT', 'West Haven', true, ['Connecticut', 'CT']))).toBeNull();
  });
  test('a state/province on the card must agree (Las Vegas NV vs NM; Paris TX vs France; PR via country; ON)', () => {
    expect(classifyGeocode('Main St, Las Vegas NV', geo('…', 'Las Vegas', true, ['New Mexico', 'NM']))).toBeNull();
    expect(classifyGeocode('Main St, Las Vegas NV', geo('…', 'Las Vegas', false, ['New Mexico', 'NM']))).toBeNull();
    expect(classifyGeocode('Main St, Las Vegas NV', geo('…', 'Las Vegas', true, ['Nevada', 'NV']))).toBe('card_city');
    expect(classifyGeocode('Rue de Rivoli, Paris TX', { partial_match: true, address_components: [
      { long_name: 'Paris', short_name: 'Paris', types: ['locality', 'political'] },
      { long_name: 'Île-de-France', short_name: 'IDF', types: ['administrative_area_level_1', 'political'] }] })).toBeNull();
    expect(classifyGeocode('Calle Sol, San Juan, PR', { partial_match: false, address_components: [
      { long_name: 'San Juan', short_name: 'San Juan', types: ['locality', 'political'] },
      { long_name: 'San Juan', short_name: 'San Juan', types: ['administrative_area_level_1', 'political'] },
      { long_name: 'Puerto Rico', short_name: 'PR', types: ['country', 'political'] }] })).toBe('exact');
    expect(classifyGeocode('123 Yonge St, Toronto, ON', { partial_match: true, address_components: [
      { long_name: 'Toronto', short_name: 'Toronto', types: ['locality', 'political'] },
      { long_name: 'Ontario', short_name: 'ON', types: ['administrative_area_level_1', 'political'] }] })).toBe('card_city');
  });
  test('null geo → null; null component entries tolerated', () => {
    expect(classifyGeocode('Ohio Dr, Plano', null)).toBeNull();
    expect(classifyGeocode('Main St, Plano', { partial_match: true, address_components: [null, { long_name: 'Plano', short_name: 'Plano', types: ['locality'] }] })).toBe('card_city');
  });
});

describe('plausibleRadiusMi', () => {
  test('60 mi at age 0, +75 mi per hour, negative/unknown age = fresh', () => {
    expect(plausibleRadiusMi(0)).toBe(60);
    expect(plausibleRadiusMi(1)).toBe(135);
    expect(plausibleRadiusMi(11.9)).toBeCloseTo(952.5, 1);
    expect(plausibleRadiusMi(-0.02)).toBe(60);
    expect(plausibleRadiusMi(undefined)).toBe(60);
  });
});

describe('placeMatchesCard — Places relevance (kind + shared identifying token)', () => {
  test('a corner/street string needs an address-type place; a POI string accepts any place', () => {
    expect(placeMatchesCard('Main St & 1st Ave', { displayName: 'One Main Place', formattedAddress: '1201 Main St, Dallas, TX', types: ['establishment', 'point_of_interest'] })).toBe(false);
    expect(placeMatchesCard('Main St & 1st Ave', { displayName: 'Main St & 1st Ave', formattedAddress: 'Main St & 1st Ave, Garland, TX', types: ['intersection'] })).toBe(true);
    expect(placeMatchesCard('Elm St & Oak St', { displayName: 'W Oak St & N Elm St', formattedAddress: 'Denton, TX', types: ['intersection'] })).toBe(true);
    expect(placeMatchesCard('Terminal B, Departures: Zone 14', { displayName: 'DFW Airport Terminal B', formattedAddress: 'Grapevine, TX 76051, USA', types: ['transit_station', 'tram_stop'] })).toBe(true);
    expect(placeMatchesCard('The Star in Frisco', { displayName: 'The Star in Frisco', formattedAddress: '1 Cowboys Way, Frisco, TX', types: ['stadium'] })).toBe(true);
    expect(placeMatchesCard('Main St & 1st Ave', null)).toBe(false);
  });
  test('a hit that shares no identifying word with the query is not the query (review: "Not open yet" for "Not visible in image")', () => {
    expect(placeMatchesCard('Pickup not shown', { displayName: 'PICKUP', formattedAddress: '5068 W Plano Pkwy, Plano, TX', types: ['establishment'] })).toBe(false); // placeholder words are not identity (and usableOfferAddress stops this earlier anyway)
    expect(placeMatchesCard('Not visible in image 1', { displayName: 'Rye Not Corned Beef LLC', formattedAddress: 'Frisco, TX', types: ['establishment'] })).toBe(false);
    expect(placeMatchesCard('Some Random Words', { displayName: 'Not open yet', formattedAddress: '1121 Yuma Dr, Frisco, TX', types: ['establishment'] })).toBe(false);
    expect(placeMatchesCard('Terminal B, Departures: Zone 14', { displayName: 'Terminal C Arrivals', formattedAddress: 'Newark, NJ', types: ['route'] })).toBe(true); // shared "terminal" — the distance gate is what refuses Newark
    expect(placeMatchesCard('St & Ave', { displayName: 'Anything', formattedAddress: 'Frisco, TX', types: ['intersection'] })).toBe(false); // nothing identifying in the query
    expect(placeMatchesCard('Front entrance', { displayName: 'Front Entrance Salon', formattedAddress: 'Frisco, TX', types: ['establishment'] })).toBe(false); // pickup-note words are not identity
    expect(placeMatchesCard('Terminal B, Departures: Zone 14', { displayName: 'DFW Airport Terminal B', formattedAddress: 'Grapevine, TX', types: ['transit_station'] })).toBe(true); // 'terminal' is the identifying word
  });
});

describe('resolveCardPoints — resolver with injected I/O (anchor plausibility / mutual corroboration)', () => {
  const frisco = { lat: 33.1289, lng: -96.8758, ageHours: 0.5 };
  // rough great-circle-ish miles for tests (monotone, ~correct at DFW latitude)
  const dist = (a, b, c, d) => Math.hypot(a - c, (b - d) * 0.84) * 69;
  const quiet = { log: () => {}, warn: () => {} };
  const noPlaces = async () => { throw new Error('should not be called'); };
  const at = (lat, lng, extra = {}) => ({ ...geo('x', 'Plano', false), lat, lng, ...extra });
  const run = (args) => resolveCardPoints({ searchPlaces: noPlaces, distanceMi: dist, logger: quiet, dropoff: { address: null, geo: null }, ...args });

  test('anchored: a classified geocode within the plausible radius is trusted (exact / card_city / whole→exact_near)', async () => {
    const r1 = await run({ anchor: frisco, pickup: { address: 'Ohio Dr, Plano', geo: at(33.05, -96.75) } });
    expect(r1.pickup).toMatchObject({ via: 'geocode', trust: 'exact', corroboration: 'anchor', precise: true });
    const r2 = await run({ anchor: frisco, pickup: { address: 'Shadywood Ct & Shadywood Ln', geo: { ...at(33.0079, -97.05, { formatted_address: 'Flower Mound' }), address_components: comps('Flower Mound') } } });
    expect(r2.pickup).toMatchObject({ trust: 'exact_near', corroboration: 'anchor' });
    const r3 = await run({ anchor: frisco, pickup: { address: 'The Star Blvd & Winning Dr, Frisco', geo: { ...at(33.107, -96.828), partial_match: true, address_components: comps('Frisco') } } });
    expect(r3.pickup).toMatchObject({ trust: 'card_city' });
  });

  test('anchored: an implausibly far geocode is refused even when Google called it exact (second review: "Terminal E, Arrivals" → Boston, "Main St, Gainesville" → FL)', async () => {
    const boston = { ...at(42.3695, -71.0202, { formatted_address: 'Terminal E. Arrivals, Boston, MA' }), address_components: comps('Boston', ['Massachusetts', 'MA']) };
    let places = 0;
    const r = await resolveCardPoints({ anchor: frisco, pickup: { address: 'Terminal E, Arrivals', geo: boston }, dropoff: { address: null, geo: null },
      searchPlaces: async () => { places++; return null; }, distanceMi: dist, logger: quiet });
    expect(r.pickup).toBeNull(); expect(places).toBe(1); // fell through to Places (which found nothing)
    const fl = { ...at(29.65, -82.32, { formatted_address: 'Main St, Gainesville, FL' }), address_components: comps('Gainesville', ['Florida', 'FL']) };
    const r2 = await run({ anchor: frisco, pickup: { address: 'Main St, Gainesville', geo: fl }, searchPlaces: async () => null });
    expect(r2.pickup).toBeNull();
    // an 11-h anchor still admits a Denver road-trip pickup (~660 mi)
    const denver = { ...at(39.74, -104.99, { formatted_address: 'Denver, CO' }), address_components: comps('Denver', ['Colorado', 'CO']) };
    const r3 = await run({ anchor: { ...frisco, ageHours: 11 }, pickup: { address: 'Colfax Ave & Broadway, Denver', geo: denver } });
    expect(r3.pickup).toMatchObject({ trust: 'exact', corroboration: 'anchor' });
  });

  test('anchored: Places fallback — DFW Terminal B accepted (18 mi, POI, shares "terminal"); business-for-a-corner refused; far refused', async () => {
    const dfw = async () => ({ placeId: 'dfwB', displayName: 'DFW Airport Terminal B', formattedAddress: 'Grapevine, TX 76051, USA', lat: 32.90624, lng: -97.041279, types: ['transit_station', 'tram_stop'] });
    const r = await run({ anchor: frisco, pickup: { address: 'Terminal B, Departures: Zone 14', geo: null }, searchPlaces: dfw });
    expect(r.pickup).toMatchObject({ via: 'places', trust: 'places_near', corroboration: 'anchor', place_id: 'dfwB', precise: true });
    const west = { ...at(41.2758, -72.9393, { formatted_address: 'Main St & 1st Ave, West Haven, CT' }), partial_match: true, address_components: comps('West Haven', ['Connecticut', 'CT']) };
    const omp = async () => ({ placeId: 'omp', displayName: 'One Main Place', formattedAddress: '1201 Main St, Dallas, TX', lat: 33.1289, lng: -96.8758, types: ['establishment', 'point_of_interest'] });
    expect((await run({ anchor: frisco, pickup: { address: 'Main St & 1st Ave', geo: west }, searchPlaces: omp })).pickup).toBeNull();
    const far = async () => ({ placeId: 'x', displayName: 'Main St & 1st Ave', formattedAddress: 'West Haven, CT', lat: 41.275778, lng: -72.939335, types: ['intersection'] });
    expect((await run({ anchor: frisco, pickup: { address: 'Main St & 1st Ave', geo: west }, searchPlaces: far })).pickup).toBeNull();
    for (const sp of [async () => null, async () => ({ placeId: 'p', lat: null, lng: null }), async () => { throw new Error('quota'); }]) {
      expect((await run({ anchor: frisco, pickup: { address: 'Terminal B, Departures: Zone 14', geo: null }, searchPlaces: sp })).pickup).toBeNull();
    }
  });

  test('NO anchor: pickup + dropoff both city-confirmed and within a ride length corroborate each other; Places never called', async () => {
    const pu = { ...at(33.107, -96.828, { formatted_address: 'Winning Dr, Frisco, TX' }), partial_match: true, address_components: comps('Frisco') };
    const dr = { ...at(33.105, -96.83, { formatted_address: 'Basilica Ln, Frisco, TX' }), address_components: comps('Frisco') };
    const r = await run({ anchor: null, pickup: { address: 'The Star Blvd & Winning Dr, Frisco', geo: pu }, dropoff: { address: 'Basilica Ln & Santa Bella Dr, Frisco', geo: dr } });
    expect(r.pickup).toMatchObject({ trust: 'card_city', corroboration: 'other_address' });
    expect(r.dropoff).toMatchObject({ trust: 'exact', corroboration: 'other_address' });
  });

  test('NO anchor: one city-confirmed address alone is NOT enough (second review: "Main St, Lancaster" → England); city-less whole matches never trusted; far apart refused', async () => {
    const uk = { ...at(54.05, -2.80, { formatted_address: 'Main St, Lancaster, UK' }), address_components: [{ long_name: 'Lancaster', short_name: 'Lancaster', types: ['locality', 'political'] }] };
    expect((await run({ anchor: null, pickup: { address: 'Main St, Lancaster', geo: uk } })).pickup).toBeNull();
    const shady = { ...at(41.706, -83.726, { formatted_address: 'Sylvania, OH' }), address_components: comps('Sylvania', ['Ohio', 'OH']) };
    const plano = { ...at(33.05, -96.75, { formatted_address: 'Legacy Dr, Plano, TX' }), address_components: comps('Plano') };
    const r = await run({ anchor: null, pickup: { address: 'Shadywood Ct & Shadywood Ln', geo: shady }, dropoff: { address: 'Legacy Dr, Plano', geo: plano } });
    expect(r.pickup).toBeNull(); expect(r.dropoff).toBeNull(); // 'whole' pickup cannot corroborate; dropoff alone is not stored either
    const mans = { ...at(53.13, -1.30, { formatted_address: 'Sutton-in-Ashfield, UK' }), address_components: [{ long_name: 'Mansfield', short_name: 'Mansfield', types: ['locality'] }] };
    const r2 = await run({ anchor: null, pickup: { address: 'Main St, Lancaster', geo: uk }, dropoff: { address: 'Broad St, Mansfield', geo: mans } });
    expect(r2.pickup).toBeNull(); // ~100 mi apart in the UK → no corroboration
  });

  test('area-level (APPROXIMATE locality) points are trusted for tz but flagged imprecise; null addresses → nulls', async () => {
    const centroid = { ...at(33.15, -96.82, { formatted_address: 'Frisco, TX, USA', location_type: 'APPROXIMATE', types: ['locality', 'political'] }), partial_match: true, address_components: comps('Frisco') };
    const r = await run({ anchor: frisco, pickup: { address: 'Internet & Warren, Frisco', geo: centroid } });
    expect(r.pickup).toMatchObject({ trust: 'card_city', precise: false });
    const r2 = await run({ anchor: frisco, pickup: { address: null, geo: null } });
    expect(r2).toEqual({ pickup: null, dropoff: null });
  });
});

describe('viewportBounds — Geocoding `bounds` bias box', () => {
  test('builds a SW|NE box around the point (~60 mi at DFW latitude)', () => {
    const b = viewportBounds(33.1284, -96.8688, 60);
    expect(b).toMatch(/^-?\d+\.\d{6},-?\d+\.\d{6}\|-?\d+\.\d{6},-?\d+\.\d{6}$/);
    const [sw, ne] = b.split('|').map((p) => p.split(',').map(Number));
    expect(sw[0]).toBeLessThan(33.1284); expect(ne[0]).toBeGreaterThan(33.1284);
    expect(sw[1]).toBeLessThan(-96.8688); expect(ne[1]).toBeGreaterThan(-96.8688);
    expect(ne[0] - sw[0]).toBeCloseTo(120 / 69, 2);
    expect(ne[1] - sw[1]).toBeGreaterThan(ne[0] - sw[0]);
  });
  test('returns null for unusable inputs (incl. Infinity, out-of-range, polar, absurd radius)', () => {
    expect(viewportBounds(NaN, -96.8, 60)).toBeNull();
    expect(viewportBounds(33.1, undefined, 60)).toBeNull();
    expect(viewportBounds(33.1, -96.8, 0)).toBeNull();
    expect(viewportBounds(33.1, -96.8, -5)).toBeNull();
    expect(viewportBounds(33.1, -96.8, Infinity)).toBeNull();
    expect(viewportBounds(91, 0, 60)).toBeNull();
    expect(viewportBounds(0, 200, 60)).toBeNull();
    expect(viewportBounds(89.9, 10, 60)).toBeNull();
    expect(viewportBounds(33.1, -96.8, 7000)).toBeNull();
  });
  test('wraps longitude across the antimeridian (SW lng > NE lng is the eastward-crossing form)', () => {
    const [sw, ne] = viewportBounds(0, 179.9, 60).split('|').map((p) => p.split(',').map(Number));
    expect(sw[1]).toBeGreaterThan(178);
    expect(ne[1]).toBeLessThan(-179); expect(ne[1]).toBeGreaterThanOrEqual(-180);
  });
});
