import { test, expect } from '@jest/globals';
import { toApiBlock } from '../../server/validation/transformers.js';
test.each([undefined, null, '', ' ', 'broken', false, -1, Infinity])('missing/invalid route %s remains unknown in the public block', value => {
  const block = toApiBlock({ name: 'Saved venue', distance_miles: value, drive_minutes: value });
  expect(block.estimatedDistanceMiles).toBeNull(); expect(block.driveTimeMinutes).toBeNull();
});
test('saved measured zero and canonical address survive without provider work', () => {
  expect(toApiBlock({ distance_miles: '0', drive_minutes: 0, features: { address: '1 Saved Street' } })).toMatchObject({ estimatedDistanceMiles: 0, driveTimeMinutes: 0, address: '1 Saved Street' });
});
