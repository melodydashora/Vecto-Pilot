// marketSlug is a pure transformation. The enclosing ensureMarket module also
// imports storage and location providers; refuse those boundaries in this suite.

import { describe, it, expect, jest, afterEach } from '@jest/globals';

const unexpectedExternalAccess = jest.fn(() => { throw new Error('Storage/provider access forbidden in marketSlug fixtures'); });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({
  db: new Proxy({}, { get: unexpectedExternalAccess }),
}));
jest.unstable_mockModule('../../server/lib/location/geocode.js', () => ({ geocodeAddress: unexpectedExternalAccess }));
jest.unstable_mockModule('../../server/lib/location/resolveTimezone.js', () => ({ resolveTimezoneFromCoords: unexpectedExternalAccess }));
const { marketSlug } = await import('../../server/lib/markets/ensure-market.js');
afterEach(() => { expect(unexpectedExternalAccess).not.toHaveBeenCalled(); });

describe('marketSlug', () => {
  it('matches the slug shape add-market always produced ("Dallas-Fort Worth" + "TX" → "dallas-fort-worth-tx")', () => {
    expect(marketSlug('Dallas-Fort Worth', 'TX')).toBe('dallas-fort-worth-tx');
    expect(marketSlug('  Timbuktu  ', null)).toBe('timbuktu');
    expect(marketSlug('St. Louis', 'mo')).toBe('st-louis-mo');
    expect(marketSlug('São Paulo', null)).toBe('s-o-paulo');
  });
});
