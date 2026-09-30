// tests/venue/text-identity.test.js
// 2026-09-29 (Claude): a provider text-search result used to become a venue identity with
// no name or address comparison. These tests pin the acceptance rule and the difference
// between "provider failed" and "nothing found". All names and places are synthetic; the
// rejected pairs copy the token shapes of the pairs an earlier probe saw accepted.
import { jest, beforeEach, afterAll, describe, test, expect } from '@jest/globals';

const log = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: {} }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ createWorkflowLogger: () => log }));
process.env.GOOGLE_MAPS_API_KEY = 'fixture-only';
const { verifyPlaceIdentity, searchPlaceWithTextSearch, resolvePlaceByTextSearch } =
  await import('../../server/lib/venue/venue-address-resolver.js');
const originalFetch = global.fetch;
afterAll(() => { global.fetch = originalFetch; });
beforeEach(() => { jest.clearAllMocks(); global.fetch = jest.fn(async () => { throw new Error('Unexpected provider request'); }); });

const components = [
  { types: ['street_number'], longText: '123', shortText: '123' },
  { types: ['route'], longText: 'Fixture Street', shortText: 'Fixture St' },
  { types: ['locality', 'political'], longText: 'Sample City', shortText: 'Sample City' },
  { types: ['administrative_area_level_1', 'political'], longText: 'Exampleland', shortText: 'XX' },
  { types: ['country', 'political'], longText: 'Fixture Country', shortText: 'CA' },
];
const candidate = (displayName, extra = {}) => ({ displayName, formattedAddress: '123 Fixture Street, Sample City, XX 00000',
  addressComponents: components, ...extra });
const providerPlace = (name, extra = {}) => ({ id: 'provider-one', displayName: { text: name },
  formattedAddress: '123 Fixture Street, Sample City, XX 00000', addressComponents: components,
  location: { latitude: 1.123456, longitude: 2.123456 }, types: ['point_of_interest'], ...extra });
const answers = (...places) => jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ places }) }));
const warned = () => log.warn.mock.calls.map(call => call.filter(part => typeof part === 'string').join(' ')).join('\n');

describe('verifyPlaceIdentity', () => {
  test.each([
    ['The Fixture', 'The Sample'],
    ['Bar at the Comet', 'Cafe at the Park'],
    ['Fixture Hall', 'Fixture West'],
    ['House of Widgets', 'House of Gadgets'],
    ['Fixture Bar', 'Fixture Hall'],
    ['Fixture Field', 'Fixture Park'],
    ['Studio 54', 'Studio 45'],
    ['The Bar', 'The Cafe'],
  ])('%j is not %j', (asked, returned) => {
    const verdict = verifyPlaceIdentity({ name: asked }, candidate(returned, { formattedAddress: '9 Other Road, Sample City, XX', addressComponents: [] }));
    expect(verdict.accepted).toBe(false);
    expect(verdict.evidence).toBeNull();
    expect(verdict.reason).toEqual(expect.stringMatching(/\S/));
  });

  test.each([
    ['Fixture Hall', 'Fixture Hall'],
    ['fixture hall', 'The Fixture Hall'],
    ["Fixture's Hall", 'Fixtures Hall'],
    ['Fixture & Sample Hall', 'Fixture and Sample Hall'],
    ['Café Fixture', 'Cafe Fixture'],
    ['Fixture Theatre', 'Fixture Theater'],
    ['House of Widgets', 'House of Widgets Sample City'],
    ['Fixture Hall', 'Fixture Hall Exampleland'],
    ['Fixture', 'Fixture Hall'],
    ['The Bar', 'Bar'],
  ])('%j is %j', (asked, returned) => {
    expect(verifyPlaceIdentity({ name: asked }, candidate(returned, { formattedAddress: '9 Other Road, Sample City, XX' })))
      .toMatchObject({ accepted: true, evidence: 'name' });
  });

  test('generic venue words and function words alone never establish agreement', () => {
    expect(verifyPlaceIdentity({ name: 'The Hall at the Park' }, candidate('The Bar at the Park')).accepted).toBe(false);
    expect(verifyPlaceIdentity({ name: 'Fixture Hall' }, candidate('Hall')).accepted).toBe(false);
  });

  test('a matching street address is accepted when the names disagree, and the evidence says so', () => {
    expect(verifyPlaceIdentity({ name: 'Fixture Bar', address: '123 Fixture St, Sample City, XX' }, candidate('Fixture Hall')))
      .toMatchObject({ accepted: true, evidence: 'address' });
  });

  test.each([
    { name: 'Other Hall', address: '123 Other Street, Fixture City, XX' },
    { query: 'Other Hall, 123 Other Street, Fixture City, XX' },
    { query: '123 Other Street, Fixture City, XX' },
  ])('locality words cannot become street identity evidence: %j', expected => {
    expect(verifyPlaceIdentity(expected, candidate('Fixture Hall', { addressComponents: [] })).accepted).toBe(false);
  });

  test('a street segment within a query remains usable address evidence', () => {
    expect(verifyPlaceIdentity({ query: 'Other Hall, 123 Fixture St, Sample City, XX' }, candidate('Fixture Hall')))
      .toMatchObject({ accepted: true, evidence: 'address' });
  });

  test.each([
    '123 Fixture Avenue', '123 Fixture Road', '123 North Fixture Street', '123 South Fixture Street',
  ])('a different numbered street cannot establish identity: %s', address => {
    expect(verifyPlaceIdentity({ name: 'Other Hall', address }, candidate('Fixture Hall')).accepted).toBe(false);
  });

  test.each([
    { name: 'Fixture Hall', address: '123 Other Street, Sample City, XX' },
    { name: 'Fixture Hall', address: '124 Fixture Street, Sample City, XX' },
    { query: 'Fixture Hall, 123 Fixture Avenue, Sample City, XX' },
  ])('matching names cannot override a contradictory known street address: %j', expected => {
    expect(verifyPlaceIdentity(expected, candidate('Fixture Hall')).accepted).toBe(false);
  });

  test('equivalent street abbreviations and direction spellings still establish address identity', () => {
    const atNorth = candidate('Fixture Hall', { addressComponents: [], formattedAddress: '123 North Fixture Street, Sample City, XX' });
    expect(verifyPlaceIdentity({ name: 'Other Hall', address: '123 N Fixture St, Sample City, XX' }, atNorth))
      .toMatchObject({ accepted: true, evidence: 'address' });
  });

  test.each([
    { addressComponents: [{ types: ['street_number'], longText: '123' }], parsed: { address_1: '123' } },
    { addressComponents: [{ types: ['route'], longText: 'Fixture Street' }], parsed: { address_1: 'Fixture Street' } },
  ])('partial provider address components cannot hide the complete formatted street: %j', partialAddress => {
    const place = candidate('Fixture Hall', partialAddress);
    expect(verifyPlaceIdentity({ name: 'Fixture Hall', address: '124 Fixture Street' }, place).accepted).toBe(false);
    expect(verifyPlaceIdentity({ name: 'Other Hall', address: '123 Fixture St' }, place))
      .toMatchObject({ accepted: true, evidence: 'address' });
  });

  test('a number in a partial route cannot replace the street number in the complete formatted address', () => {
    const place = candidate('Fixture Hall', { addressComponents: [{ types: ['route'], longText: 'Highway 75' }],
      parsed: { address_1: 'Highway 75' }, formattedAddress: '123 Highway 75, Sample City, XX' });
    expect(verifyPlaceIdentity({ name: 'Other Hall', address: '123 Highway 75' }, place))
      .toMatchObject({ accepted: true, evidence: 'address' });
    expect(verifyPlaceIdentity({ name: 'Fixture Hall', address: '124 Highway 75' }, place).accepted).toBe(false);
  });

  test('complete provider components retain precedence over a conflicting formatted street', () => {
    const place = candidate('Fixture Hall', { formattedAddress: '124 Fixture Street, Sample City, XX' });
    expect(verifyPlaceIdentity({ name: 'Other Hall', address: '123 Fixture St' }, place))
      .toMatchObject({ accepted: true, evidence: 'address' });
    expect(verifyPlaceIdentity({ name: 'Fixture Hall', address: '124 Fixture Street' }, place).accepted).toBe(false);
  });

  test.each([
    { query: '13 Celsius Wine, Sample City, XX' },
    { name: '13 Celsius Wine', query: '13 Celsius Wine' },
    { name: '13 Celsius Wine', query: '13 Celsius Wine, Sample City, XX' },
  ])('a numbered venue name is name evidence, never a contradictory street segment: %j', expected => {
    expect(verifyPlaceIdentity(expected, candidate('13 Celsius Wine'))).toMatchObject({ accepted: true, evidence: 'name' });
  });

  test('a numbered venue name still cannot override a separate contradictory street', () => {
    expect(verifyPlaceIdentity({ query: '13 Celsius Wine, 124 Fixture Street, Sample City, XX' }, candidate('13 Celsius Wine')).accepted).toBe(false);
  });

  test.each([
    ['124 Fixture Street, Sample City, XX'],
    ['123 Sample Street, Sample City, XX'],
    ['Fixture Street, Sample City, XX'],
    ['Sample City, XX'],
  ])('address %j does not match 123 Fixture Street', address => {
    expect(verifyPlaceIdentity({ name: 'Fixture Bar', address }, candidate('Fixture Hall')).accepted).toBe(false);
  });

  test('nothing to compare is a rejection, never an acceptance', () => {
    expect(verifyPlaceIdentity({}, candidate('Fixture Hall')).accepted).toBe(false);
    expect(verifyPlaceIdentity({ name: 'Fixture Hall' }, candidate(undefined)).accepted).toBe(false);
    expect(verifyPlaceIdentity({ name: '   ' }, candidate('Fixture Hall')).accepted).toBe(false);
  });
});

describe('searchPlaceWithTextSearch identity acceptance', () => {
  test('the first provider result is refused when it agrees with nothing that was asked for, and the refusal is logged with a reason', async () => {
    global.fetch = answers(providerPlace('The Sample', { formattedAddress: '9 Other Road, Sample City, XX', addressComponents: [] }));
    expect(await searchPlaceWithTextSearch(1, 2, 'The Fixture, 50 Requested Avenue, Sample City, XX, CA', { radius: 50000 })).toBeNull();
    expect(warned()).toMatch(/VENUE_TEXT_IDENTITY/);
    expect(warned()).toMatch(/The Sample/);
    const outcome = await resolvePlaceByTextSearch(1, 2, 'The Fixture, 50 Requested Avenue, Sample City, XX, CA', { radius: 50000 });
    expect(outcome).toMatchObject({ outcome: 'rejected', place: null });
    expect(outcome.reason).toEqual(expect.stringMatching(/\S/));
  });

  test('an agreeing result keeps both the requested name and the provider name', async () => {
    global.fetch = answers(providerPlace('Fixture Hall Sample City'));
    const place = await searchPlaceWithTextSearch(1, 2, 'Fixture Hall, Sample City, XX, CA', { radius: 50000 });
    expect(place).toMatchObject({ placeId: 'provider-one', displayName: 'Fixture Hall Sample City', requestedName: 'Fixture Hall',
      identityEvidence: 'name', lat: 1.123456, lng: 2.123456, parsed: { country: 'CA', state: 'XX', city: 'Sample City' } });
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('explicit expectations are compared instead of the search text', async () => {
    global.fetch = answers(providerPlace('Fixture West', { formattedAddress: '9 Other Road, Sample City, XX', addressComponents: [] }));
    expect(await searchPlaceWithTextSearch(1, 2, 'Fixture Hall Fixture West Sample City', { expectedName: 'Fixture Hall' })).toBeNull();
    global.fetch = answers(providerPlace('Fixture West'));
    expect(await searchPlaceWithTextSearch(1, 2, 'anything', { expectedName: 'Fixture Hall', expectedAddress: '123 Fixture St' }))
      .toMatchObject({ displayName: 'Fixture West', requestedName: 'Fixture Hall', identityEvidence: 'address' });
  });

  test('a same-name provider result at a conflicting requested street is refused by the real search gate', async () => {
    global.fetch = answers(providerPlace('Fixture Hall'));
    expect(await resolvePlaceByTextSearch(1, 2, 'Fixture Hall, 123 Fixture Avenue, Sample City, XX'))
      .toMatchObject({ outcome: 'rejected', place: null });
    expect(warned()).toMatch(/VENUE_TEXT_IDENTITY/);
  });

  test('search compares a complete formatted street when provider components omit the street number', async () => {
    global.fetch = answers(providerPlace('Fixture Hall', { addressComponents: components.filter(part => !part.types.includes('street_number')) }));
    expect(await resolvePlaceByTextSearch(1, 2, 'Fixture Hall, 124 Fixture Street, Sample City, XX'))
      .toMatchObject({ outcome: 'rejected', place: null });
    expect(await resolvePlaceByTextSearch(1, 2, 'Other Hall, 123 Fixture St, Sample City, XX'))
      .toMatchObject({ outcome: 'found', place: { placeId: 'provider-one', identityEvidence: 'address' } });
  });

  test('a caller that runs its own relevance gate receives the provider result unjudged', async () => {
    global.fetch = answers(providerPlace('The Sample', { addressComponents: [] }));
    const place = await searchPlaceWithTextSearch(1, 2, 'The Fixture', { callerVerifiesIdentity: true });
    expect(place).toMatchObject({ displayName: 'The Sample', identityEvidence: 'caller' });
  });
});

describe('provider failure is not absence', () => {
  test('an HTTP error is reported as a provider failure with its cause', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, text: async () => 'fixture outage', json: async () => ({}) }));
    const outcome = await resolvePlaceByTextSearch(1, 2, 'Fixture Hall', {});
    expect(outcome).toMatchObject({ outcome: 'provider_failure', place: null });
    expect(outcome.reason).toMatch(/503/);
    expect(warned()).toMatch(/VENUE_TEXT_SEARCH/);
    expect(warned()).toMatch(/503/);
  });

  test('a transport error is reported as a provider failure with its cause', async () => {
    global.fetch = jest.fn(async () => { throw new Error('fixture network failure'); });
    const outcome = await resolvePlaceByTextSearch(1, 2, 'Fixture Hall', {});
    expect(outcome).toMatchObject({ outcome: 'provider_failure', place: null });
    expect(outcome.reason).toMatch(/fixture network failure/);
    expect(warned()).toMatch(/fixture network failure/);
  });

  test('an empty provider answer is absence, with no failure logged', async () => {
    global.fetch = answers();
    expect(await resolvePlaceByTextSearch(1, 2, 'Fixture Hall', {})).toMatchObject({ outcome: 'absent', place: null });
    expect(warned()).not.toMatch(/VENUE_TEXT_SEARCH/);
  });

  test('caller cancellation is neither absence nor a provider failure', async () => {
    const controller = new AbortController();
    global.fetch = jest.fn(async (_url, options) => { controller.abort(new Error('fixture cancelled')); options.signal.throwIfAborted(); });
    expect(await resolvePlaceByTextSearch(1, 2, 'Fixture Hall', { signal: controller.signal })).toMatchObject({ outcome: 'aborted', place: null });
  });

  test('the existing function keeps its contract: a place or null, never a thrown provider error', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, text: async () => 'fixture outage', json: async () => ({}) }));
    expect(await searchPlaceWithTextSearch(1, 2, 'Fixture Hall')).toBeNull();
    expect(warned()).toMatch(/503/);
  });

  test('provider failure logs never contain the search text', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, text: async () => 'fixture outage', json: async () => ({}) }));
    await resolvePlaceByTextSearch(1, 2, '77 Private Lane, Sample City', {});
    expect(warned()).not.toMatch(/Private Lane/);
  });
});
