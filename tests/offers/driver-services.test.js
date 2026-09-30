import { describe, expect, test } from '@jest/globals';
import { canonicalOfferProduct, offerServiceForProduct, offerRateTier, normalizeSelectedServices,
  selectedServiceRateGroups } from '../../shared/driver-services.js';

const rates = { tiers: { standard: { floor_per_mile: 1.05 }, premium: { floor_per_mile: 2.35 }, comfort: null, xl: null }, tier_products: null };

describe('explicit saved service identity', () => {
  test('unknown is distinct from an explicit empty selection, and eligibility is never a selection', () => {
    expect(normalizeSelectedServices(null)).toBeNull();
    expect(normalizeSelectedServices(undefined)).toBeNull();
    expect(normalizeSelectedServices([])).toEqual([]);
    expect(() => normalizeSelectedServices({ elig_economy: true })).toThrow(/invalid/);
    expect(() => normalizeSelectedServices(['economy', 'economy'])).toThrow(/invalid/);
    expect(() => normalizeSelectedServices(['premium'])).toThrow(/invalid/);
    expect(normalizeSelectedServices(['luxury_suv', 'economy'])).toEqual(['economy', 'luxury_suv']);
  });

  test.each([
    ['Uber X Exclusive', 'UberX Exclusive', 'economy'],
    ['UberX Share', 'Share', 'economy'],
    ['Lyft Shared', 'Lyft Shared', 'economy'],
    [' comfort ', 'Comfort', 'comfort'],
    ['uber xl', 'UberXL', 'xl'],
    ['Uber XXL Exclusive', 'UberXXL Exclusive', 'xxl'],
    ['Uber Black', 'Black', 'luxury_sedan'],
    ['Black SUV', 'Black SUV', 'luxury_suv'],
    ['Lyft Black XL', 'Lyft Black SUV', 'luxury_suv'],
    ['delivery exclusive', 'Delivery Exclusive', 'delivery'],
  ])('%s keeps its service identity independently of rate group', (input, canonical, service) => {
    expect(canonicalOfferProduct(input)).toBe(canonical);
    expect(offerServiceForProduct(input)).toBe(service);
  });

  test('ambiguous labels are not promoted to economy or luxury', () => {
    expect(offerServiceForProduct('Uber')).toBeNull();
    expect(offerServiceForProduct('VIP')).toBeNull();
    expect(offerServiceForProduct('Unrecognized product')).toBeNull();
    expect(offerServiceForProduct('UberX', 'delivery')).toBeNull();
    expect(offerServiceForProduct('Delivery', 'ride')).toBeNull();
    expect(offerServiceForProduct(null, 'delivery')).toBe('delivery');
  });
});

describe('selection and rate control projection', () => {
  test('hiding/re-enabling services changes only projection and preserves all stored rate values', () => {
    const before = JSON.stringify(rates);
    expect(selectedServiceRateGroups(['economy'], rates)).toMatchObject([{ tier: 'standard', services: ['economy'] }]);
    expect(selectedServiceRateGroups(['comfort'], rates)).toMatchObject([{ tier: 'premium', services: ['comfort'] }]);
    expect(selectedServiceRateGroups(['economy', 'comfort'], rates).map(group => group.tier)).toEqual(['standard', 'premium']);
    expect(selectedServiceRateGroups(['delivery'], rates)).toEqual([]);
    expect(selectedServiceRateGroups(null, rates).map(group => group.tier)).toEqual(['standard', 'premium']);
    expect(JSON.stringify(rates)).toBe(before);
  });

  test('XL and Black keep their existing shared economic routing even when only Black is selected', () => {
    const split = { ...rates, tiers: { ...rates.tiers, xl: { floor_per_mile: 3.25 } } };
    for (const product of ['UberXL', 'Lyft XL', 'Black', 'Lyft Black', 'Lyft Lux', 'VIP', 'Black SUV']) {
      expect(offerRateTier(product, split)).toBe('xl');
    }
    expect(selectedServiceRateGroups(['luxury_suv'], split)).toMatchObject([{ tier: 'xl', services: ['luxury_suv'], label: 'Luxury SUV' }]);
    // More precise XXL identity must not silently introduce a different rate.
    expect(offerRateTier('UberXXL', split)).toBe('standard');
  });

  test('custom product routing exposes exactly the same saved groups used for the selected service', () => {
    const split = { tiers: { ...rates.tiers, comfort: { floor_per_mile: 1.7 }, xl: { floor_per_mile: 3.2 } },
      tier_products: { comfort: ['Black'], xl: ['Lyft Black'] } };
    expect(offerRateTier('Black', split)).toBe('comfort');
    expect(offerRateTier('Lyft Black', split)).toBe('xl');
    expect(offerRateTier('Lyft Lux', split)).toBe('premium');
    expect(selectedServiceRateGroups(['luxury_sedan'], split).map(group => group.tier)).toEqual(['comfort', 'xl', 'premium']);
    expect(selectedServiceRateGroups(['economy'], split).map(group => group.tier)).toEqual(['standard']);
  });

  test('precise Black SUV identity retains the former Black product custom rates', () => {
    const split = { tiers: { ...rates.tiers, comfort: { floor_per_mile: 1.7 }, xl: { floor_per_mile: 3.2 } },
      tier_products: { comfort: ['Black'], xl: ['Lyft Black'] } };
    expect(offerRateTier('Black SUV', split)).toBe('comfort');
    expect(offerRateTier('Lyft Black SUV', split)).toBe('xl');
    expect(selectedServiceRateGroups(['luxury_suv'], split).map(group => group.tier)).toEqual(['comfort', 'xl']);
  });
});
