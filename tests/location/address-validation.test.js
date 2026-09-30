import { beforeEach, afterAll, expect, jest, test } from '@jest/globals';
import process from 'node:process';
const originalKey = process.env.GOOGLE_MAPS_API_KEY;
process.env.GOOGLE_MAPS_API_KEY = 'synthetic-key';
const { validateAddress, isAddressDeliverable } = await import('../../server/lib/location/address-validation.js');
const address = { address1: 'Synthetic road', city: 'Synthetic city', state: 'ST', country: 'US' };
let payload;
beforeEach(() => {
  process.env.GOOGLE_MAPS_API_KEY = 'synthetic-key';
  payload = { result: { verdict: { addressComplete: true, geocodeGranularity: 'PREMISE' }, address: { formattedAddress: 'Synthetic road' }, geocode: { location: { latitude: 0, longitude: 2 } } } };
  globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => payload }));
});
afterAll(() => { if (originalKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = originalKey; });
test.each(['missing-key', 'HTTP', 'missing-result', 'exception'])('unavailable address validation is not confirmed: %s', async scenario => {
  if (scenario === 'missing-key') delete process.env.GOOGLE_MAPS_API_KEY;
  if (scenario === 'HTTP') globalThis.fetch.mockResolvedValue({ ok: false, status: 503, text: async () => '' });
  if (scenario === 'missing-result') payload = {};
  if (scenario === 'exception') globalThis.fetch.mockRejectedValue(new Error('synthetic failure'));
  expect(await validateAddress(address)).toMatchObject({ valid: false, skipped: true });
  expect(await isAddressDeliverable(address)).toBe(false);
});
test('inferred pieces alone cannot make an incomplete address valid', async () => {
  payload.result.verdict = { addressComplete: false, hasInferredComponents: true };
  expect(await validateAddress(address)).toMatchObject({ valid: false, validationStatus: 'UNCONFIRMED_ADDRESS' });
});
test('unconfirmed components do not acquire CONFIRMED status', async () => {
  payload.result.verdict.hasUnconfirmedComponents = true;
  payload.result.address.addressComponents = [{ componentType: 'street_number', confirmationLevel: 'UNCONFIRMED_AND_SUSPICIOUS' }];
  expect(await validateAddress(address)).toMatchObject({ valid: false, validationStatus: 'UNCONFIRMED_COMPONENTS' });
});
test('valid zero coordinates and documented geocode precision survive', async () => {
  expect(await validateAddress(address)).toMatchObject({ valid: true, lat: 0, lng: 2, geocodePrecision: 'PREMISE' });
});
test('malformed provider coordinates never become home coordinates', async () => {
  payload.result.geocode.location = { latitude: 91, longitude: 2 };
  expect(await validateAddress(address)).toMatchObject({ lat: null, lng: null });
});
