// tests/offers/offer-patterns.test.js — Coach offer-pattern block renderer (2026-08-17).
import { formatOfferPatterns } from '../../server/lib/offers/offer-patterns.js';

const rows = [
  { dim: 'day_part', key: 'evening', n: 12, accept_pct: 58, avg_pm: 1.62, taken: 5, avg_earned: 14.2 },
  { dim: 'day_part', key: 'morning', n: 7, accept_pct: 29, avg_pm: 1.05, taken: 1, avg_earned: 9.5 },
  { dim: 'day_part', key: 'overnight', n: 1, accept_pct: 100, avg_pm: 3.1, taken: 0, avg_earned: null },
  { dim: 'dow', key: 5, n: 9, accept_pct: 67, avg_pm: 1.7, taken: 4, avg_earned: 16 },
  { dim: 'city', key: 'Frisco', n: 11, accept_pct: 55, avg_pm: 1.5, taken: 4, avg_earned: 12 },
  { dim: 'city', key: 'Plano', n: 4, accept_pct: 25, avg_pm: 0.98, taken: 0, avg_earned: null },
  { dim: 'product', key: 'UberX', n: 15, accept_pct: 40, avg_pm: 1.3, taken: 5, avg_earned: 12 },
  { dim: 'month', key: '2026-08', n: 20, accept_pct: 45, avg_pm: 1.4, taken: 6, avg_earned: 13 },
];

describe('formatOfferPatterns', () => {
  test('renders headline best/worst by time and area, and per-dimension rows', () => {
    const out = formatOfferPatterns(rows, { total: 20, windowDays: 180 });
    expect(out).toContain('=== OFFER PATTERNS (your last 20 analyzed offers, 180 days) ===');
    expect(out).toContain('Best time for pay: evening ($1.62/mi over 12); weakest: morning ($1.05/mi over 7)');
    expect(out).not.toContain('overnight ($3.10'); // n=1 excluded from the headline
    expect(out).toContain('Best pickup area for pay: Frisco');
    expect(out).toContain('- Fri: 9 offers, analyzer accepted 67%, avg $1.70/mi, you took 4 (avg $16.00 earned)');
    expect(out).toContain('By month (seasonality)');
    expect(out).toContain("Never analyze a live offer here");
  });

  test('says nothing with too little data', () => {
    expect(formatOfferPatterns([], { total: 0 })).toBe('');
    expect(formatOfferPatterns([{ dim: 'day_part', key: 'evening', n: 2, accept_pct: 50, avg_pm: 1.2, taken: 0, avg_earned: null }], { total: 2 })).toBe('');
  });
});
