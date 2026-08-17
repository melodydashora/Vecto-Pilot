// tests/offers/parse-offer-text.test.js — regex pre-parser pins (2026-08-17).
import { extractPrice, parseOfferText } from '../../server/lib/offers/parse-offer-text.js';

describe('extractPrice', () => {
  test('ignores our own previous verdict banner in the OCR (live prod case, 2026-08-14)', () => {
    // Real OCR shape (addresses trimmed): notification shade first, then the card.
    const ocr = 'OfferTe:\nACCEPT\n$0.5/minute...\nYesterday\n+/mile,\nUberX\nExclusive\n$6.07\n$17.34/active hr (est.)\n* 4.93\nVerified\n6 min (1.4 mi)\nSome Dr & Other Trl, Frisco Avg. wait time at pickup: 1 min 14 mins (6.3 mi)\nPreston Rd, Frisco';
    expect(extractPrice(ocr)).toBe(6.07);
    const parsed = parseOfferText(ocr);
    expect(parsed.price).toBe(6.07);
    expect(parsed.total_miles).toBeCloseTo(7.7, 1);
    expect(parsed.per_mile).toBe(0.79);
    expect(parsed.parse_confidence).toBe('full');
  });

  test('ignores the new-format banner "ACCEPT: $1.40 6.1mi | Verified Rider" and rate figures', () => {
    expect(extractPrice('ACCEPT: $1.40 6.1mi | Verified Rider\nUberX\n$8.54\n$23.58/active hr (est.)')).toBe(8.54);
    expect(extractPrice('REJECT (FALLBACK): $0.78 14.0mi low\nUberX Priority\n$14.20')).toBe(14.2);
    expect(extractPrice('$1.40 per mile\n$12.30')).toBe(12.3);
  });

  test('still finds ordinary prices and hourly is not the price', () => {
    expect(extractPrice('UberX\n$9.43\n$23.58/active hr (est.)')).toBe(9.43);
    expect(extractPrice('$ 12.50 • 4.2 mi')).toBe(12.5);
    expect(extractPrice('no dollars here')).toBeNull();
  });

  test('prefers a 2-decimal price over a 1-decimal OCR fragment, but falls back', () => {
    expect(extractPrice('$0.5\n$6.07')).toBe(6.07);
    expect(extractPrice('$7')).toBe(7); // fallback when nothing has cents
  });
});
