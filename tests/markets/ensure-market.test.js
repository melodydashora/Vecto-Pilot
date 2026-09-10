// tests/markets/ensure-market.test.js
// 2026-09-10: pure parts of the shared market helper (Astra product finding #16).
// ensureMarket() itself needs a database and the Google Timezone API; it is exercised by
// the live smoke, not here.

import { describe, it, expect } from '@jest/globals';
import { marketSlug } from '../../server/lib/markets/ensure-market.js';

describe('marketSlug', () => {
  it('matches the slug shape add-market always produced ("Dallas-Fort Worth" + "TX" → "dallas-fort-worth-tx")', () => {
    expect(marketSlug('Dallas-Fort Worth', 'TX')).toBe('dallas-fort-worth-tx');
    expect(marketSlug('  Timbuktu  ', null)).toBe('timbuktu');
    expect(marketSlug('St. Louis', 'mo')).toBe('st-louis-mo');
    expect(marketSlug('São Paulo', null)).toBe('s-o-paulo');
  });
});
