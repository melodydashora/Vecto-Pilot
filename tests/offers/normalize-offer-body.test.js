// tests/offers/normalize-offer-body.test.js
// 2026-08-14: deterministic field-name alias layer for the analyze-offer hook
// (Melody: "I don't want you to have to tell end users to spell latitude
// correctly"). Pure module — no db imports (ruleset-hash jest policy).

import { normalizeOfferBody, BODY_FIELD_ALIASES } from '../../server/lib/offers/normalize-offer-body.js';

describe('normalizeOfferBody', () => {
  test('canonical keys pass through untouched', () => {
    const body = { text: 'ocr', device_id: 'phone', latitude: '33.1', longitude: '-96.8', source: 'siri_vision' };
    const { body: out, remapped } = normalizeOfferBody(body);
    expect(out).toEqual(body);
    expect(remapped).toEqual([]);
  });

  test('the famous lattitude typo maps to latitude', () => {
    const { body: out, remapped } = normalizeOfferBody({ lattitude: '33.128400' });
    expect(out.latitude).toBe('33.128400');
    expect(out.lattitude).toBeUndefined();
    expect(remapped).toEqual(['lattitude→latitude']);
  });

  test('case variants of canonical keys are re-cased (Latitude, TEXT)', () => {
    const { body: out, remapped } = normalizeOfferBody({ Latitude: '33.1', TEXT: 'hi' });
    expect(out.latitude).toBe('33.1');
    expect(out.text).toBe('hi');
    expect(remapped).toEqual(expect.arrayContaining(['Latitude→latitude', 'TEXT→text']));
  });

  test('common abbreviations: lat/lng/lon map to coordinates', () => {
    const { body: out } = normalizeOfferBody({ lat: '1', lng: '2' });
    expect(out.latitude).toBe('1');
    expect(out.longitude).toBe('2');
  });

  test('exact canonical key wins over an alias for the same target', () => {
    const { body: out, remapped } = normalizeOfferBody({ latitude: 'exact', lattitude: 'typo' });
    expect(out.latitude).toBe('exact');
    expect(remapped).toEqual([]); // alias skipped: slot already claimed
  });

  test('token alias maps to shortcut_token', () => {
    const { body: out } = normalizeOfferBody({ token: 'vp_abc' });
    expect(out.shortcut_token).toBe('vp_abc');
  });

  test('unknown keys are preserved untouched', () => {
    const { body: out } = normalizeOfferBody({ latitude: '1', custom_field: 'kept' });
    expect(out.custom_field).toBe('kept');
  });

  test('non-object bodies normalize to empty (never throw)', () => {
    expect(normalizeOfferBody(null)).toEqual({ body: {}, remapped: [] });
    expect(normalizeOfferBody(undefined)).toEqual({ body: {}, remapped: [] });
    expect(normalizeOfferBody('string')).toEqual({ body: {}, remapped: [] });
    expect(normalizeOfferBody([1, 2])).toEqual({ body: {}, remapped: [] });
  });

  test('alias table stays deterministic: no variant maps to two canonicals', () => {
    const seen = new Map();
    for (const [canon, aliases] of Object.entries(BODY_FIELD_ALIASES)) {
      for (const v of [canon, ...aliases]) {
        const key = v.toLowerCase();
        expect(seen.has(key) && seen.get(key) !== canon).toBe(false);
        seen.set(key, canon);
      }
    }
  });
});
