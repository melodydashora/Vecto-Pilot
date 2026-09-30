import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';

const priorKey = process.env.GOOGLE_MAPS_API_KEY;
process.env.GOOGLE_MAPS_API_KEY = 'synthetic-provider-key';
const { pickBestGeocodeResult, resolveFreshGpsLocation, getTimezoneDataForCoords } = await import('../../server/lib/location/geocode.js');
if (priorKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
else process.env.GOOGLE_MAPS_API_KEY = priorKey;
let output, fetchImpl;
const street = () => ({ formatted_address: '123 Synthetic Street, Fixture City', place_id: 'sensitive-fixture-place',
  types: ['street_address'], address_components: [
    { types: ['locality'], long_name: 'Fixture City' },
    { types: ['administrative_area_level_1'], short_name: 'NY' },
    { types: ['country'], short_name: 'US' },
  ] });
beforeEach(() => {
  output = [];
  for (const name of ['log', 'warn', 'error']) jest.spyOn(console, name).mockImplementation((...args) => output.push(args));
  fetchImpl = jest.fn(async url => ({ ok: true, status: 200, json: async () => String(url).includes('/timezone/')
    ? { status: 'OK', timeZoneId: 'America/New_York', rawOffset: -18000, dstOffset: 3600 }
    : { status: 'OK', results: [street()] } }));
});
afterEach(() => jest.restoreAllMocks());

test('selection keeps the owned evidence and excludes Plus Code, street and place identifiers from logs', () => {
  const precise = street();
  const selected = pickBestGeocodeResult([{ formatted_address: 'ABCD+EF Private Block', place_id: 'private-plus-place', types: ['plus_code'] }, precise]);
  expect(selected).toBe(precise);
  const logs = JSON.stringify(output);
  for (const sensitive of ['ABCD+EF', 'Private Block', 'private-plus-place', precise.formatted_address, precise.place_id]) expect(logs).not.toContain(sensitive);
});

test('each fresh attempt fetches geocode and timezone at full precision, with no completed response reuse', async () => {
  const location = await resolveFreshGpsLocation(1.123456789, -2.123456789, { fetchImpl });
  expect(location).toMatchObject({ city: 'Fixture City', country: 'US', timeZone: 'America/New_York', formattedAddress: street().formatted_address });
  await resolveFreshGpsLocation(1.123456789, -2.123456789, { fetchImpl });
  expect(fetchImpl).toHaveBeenCalledTimes(4);
  expect(fetchImpl.mock.calls[0][0].searchParams.get('latlng')).toBe('1.123456789,-2.123456789');
  expect(fetchImpl.mock.calls[1][0].searchParams.get('location')).toBe('1.123456789,-2.123456789');
  fetchImpl.mockResolvedValueOnce({ ok: false, status: 503 });
  await expect(resolveFreshGpsLocation(1.123456789, -2.123456789, { fetchImpl })).rejects.toThrow('HTTP 503');
  expect(JSON.stringify(output)).not.toContain('123 Synthetic');
});

test.each(['city', 'timezone'])('missing provider %s fails without a home or device fallback', async field => {
  fetchImpl.mockImplementation(async url => ({ ok: true, json: async () => String(url).includes('/timezone/')
    ? { status: 'OK', timeZoneId: field === 'timezone' ? undefined : 'America/New_York' }
    : { status: 'OK', results: [{ ...street(), address_components: field === 'city' ? [] : street().address_components }] } }));
  await expect(resolveFreshGpsLocation(1, 2, { fetchImpl })).rejects.toThrow(/incomplete|missing/);
});

test('timezone cancellation blocks both an expired dispatch and a transport that returns after cancellation', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(getTimezoneDataForCoords(0, 0, { fetchImpl, signal: controller.signal })).rejects.toThrow();
  expect(fetchImpl).not.toHaveBeenCalled();
  const during = new AbortController();
  fetchImpl.mockImplementation(async () => {
    during.abort();
    return { ok: true, json: async () => ({ status: 'OK', timeZoneId: 'UTC' }) };
  });
  await expect(getTimezoneDataForCoords(0, 0, { fetchImpl, signal: during.signal })).rejects.toThrow();
});
