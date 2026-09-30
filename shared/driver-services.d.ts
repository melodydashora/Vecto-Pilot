export type DriverService = 'economy' | 'comfort' | 'xl' | 'xxl' | 'luxury_sedan' | 'luxury_suv' | 'delivery';
export type OfferRateTier = 'standard' | 'premium' | 'comfort' | 'xl' | 'share' | 'delivery';
export interface ServiceRateRules {
  tiers?: Partial<Record<OfferRateTier, unknown>>;
  tier_products?: { comfort?: readonly string[]; xl?: readonly string[] } | null;
}
export const DRIVER_SERVICES: readonly Readonly<{ id: DriverService; label: string }>[];
export function normalizeSelectedServices(value: unknown): DriverService[] | null;
export function canonicalOfferProduct(value: unknown): string | null;
export function offerServiceForProduct(value: unknown, offerKind?: string | null): DriverService | null;
export const DEFAULT_COMFORT_PRODUCTS: readonly string[];
export const DEFAULT_XL_PRODUCTS: readonly string[];
export const PREMIUM_OFFER_PRODUCTS: readonly string[];
export function offerRateTier(value: unknown, ruleset?: ServiceRateRules): OfferRateTier;
export function selectedServiceRateGroups(selectedServices: unknown, ruleset: ServiceRateRules): {
  tier: 'standard' | 'premium' | 'comfort' | 'xl'; services: DriverService[]; products: string[]; label: string;
}[];
