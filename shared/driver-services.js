// A driver's explicit service selection is distinct from vehicle eligibility and
// from the existing economic rule tiers. Keep identity and displayed rule groups
// together so hiding a control cannot leave an unrelated service active.
export const DRIVER_SERVICES = Object.freeze([
  { id: 'economy', label: 'Economy' },
  { id: 'comfort', label: 'Comfort' },
  { id: 'xl', label: 'XL' },
  { id: 'xxl', label: 'XXL' },
  { id: 'luxury_sedan', label: 'Luxury sedan' },
  { id: 'luxury_suv', label: 'Luxury SUV' },
  { id: 'delivery', label: 'Delivery' },
].map(Object.freeze));

const serviceIds = new Set(DRIVER_SERVICES.map(service => service.id));

/** Null means legacy/unconfigured, not all selected and not eligibility-derived. */
export function normalizeSelectedServices(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || new Set(value).size !== value.length ||
      !value.every(service => typeof service === 'string' && serviceIds.has(service))) {
    throw new TypeError('Saved service selection is invalid. Review your preferences.');
  }
  return DRIVER_SERVICES.filter(service => value.includes(service.id)).map(service => service.id);
}

// Canonical capture labels retain provider identity. Existing financial routing
// is preserved, including the legacy XL split's Black/Lux products. A clearer
// service identity alone must not silently replace a driver's saved thresholds.
const products = [
  ['UberX', 'economy', 'standard', null, ['Uber X']],
  ['UberX Exclusive', 'economy', 'standard', null, ['Uber X Exclusive']],
  ['UberX Priority', 'economy', 'standard', null, ['Uber X Priority']],
  ['Lyft', 'economy', 'standard', null, []],
  ['Lyft Priority', 'economy', 'standard', null, []],
  ['Share', 'economy', 'share', null, ['UberX Share', 'Uber X Share']],
  ['Lyft Shared', 'economy', 'share', null, []],
  ['Comfort', 'comfort', 'premium', 'comfort', ['Uber Comfort']],
  ['UberXL', 'xl', 'premium', 'xl', ['Uber XL']],
  ['UberXL Exclusive', 'xl', 'premium', 'xl', ['Uber XL Exclusive']],
  ['Lyft XL', 'xl', 'premium', 'xl', []],
  // Previously parsed as UberX. Retain its existing standard economics until an
  // explicit, separately reviewed rate-tier change provides different rules.
  ['UberXXL', 'xxl', 'standard', null, ['Uber XXL']],
  ['UberXXL Exclusive', 'xxl', 'standard', null, ['Uber XXL Exclusive']],
  ['Black', 'luxury_sedan', 'premium', 'xl', ['Uber Black', 'UberBlack']],
  ['Lyft Black', 'luxury_sedan', 'premium', 'xl', ['Lyft Lux Black']],
  ['Lyft Lux', 'luxury_sedan', 'premium', 'xl', []],
  // SUV identity used to collapse to Black; retain the same economic rules.
  ['Black SUV', 'luxury_suv', 'premium', 'xl', ['Uber Black SUV', 'UberBlack SUV']],
  ['Lyft Black SUV', 'luxury_suv', 'premium', 'xl', ['Lyft Black XL', 'Lyft Lux Black XL', 'Lyft Lux Black SUV']],
  // These labels identify a platform/modifier, not a defensible vehicle service.
  ['Uber', null, 'standard', null, []],
  ['VIP', null, 'premium', 'xl', []],
].map(([name, service, tier, split, aliases]) => ({ name, service, tier, split, aliases }));

const keyFor = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
const byAlias = new Map();
for (const product of products) {
  for (const name of [product.name, ...product.aliases]) byAlias.set(keyFor(name), product);
}

/** Accepts an extracted product label, never arbitrary OCR paragraphs. */
export function canonicalOfferProduct(value) {
  const key = keyFor(value);
  if (key === 'delivery' || key === 'delivery exclusive') return key === 'delivery' ? 'Delivery' : 'Delivery Exclusive';
  return byAlias.get(key)?.name ?? null;
}

export function offerServiceForProduct(value, offerKind) {
  const product = canonicalOfferProduct(value);
  const delivery = product === 'Delivery' || product === 'Delivery Exclusive';
  if (offerKind === 'delivery') return !product || delivery ? 'delivery' : null;
  if (delivery) return offerKind === 'ride' ? null : 'delivery';
  return byAlias.get(keyFor(product))?.service ?? null;
}

export const DEFAULT_COMFORT_PRODUCTS = Object.freeze(products.filter(product => product.split === 'comfort').map(product => product.name));
export const DEFAULT_XL_PRODUCTS = Object.freeze(products.filter(product => product.split === 'xl').map(product => product.name));
export const PREMIUM_OFFER_PRODUCTS = Object.freeze(products.filter(product => product.tier === 'premium').map(product => product.name));

/** Existing economic routing, shared by adjudication and the applicable controls. */
export function offerRateTier(value, ruleset) {
  const canonical = canonicalOfferProduct(value);
  if (canonical === 'Delivery' || canonical === 'Delivery Exclusive') return 'delivery';
  const product = byAlias.get(keyFor(canonical));
  const tier = product?.tier ?? 'standard';
  if (tier !== 'premium') return tier;
  const custom = ruleset?.tier_products;
  // Before service identity was separated, these capture labels were parsed as
  // Black/Lyft Black. Their existing custom split must keep applying as well.
  const legacyProduct = ({ 'Black SUV': 'Black', 'Lyft Black SUV': 'Lyft Black' })[canonical];
  const belongsTo = (names, split) => custom
    ? (Array.isArray(names) ? names : []).some(name => {
        const configured = canonicalOfferProduct(name) ?? name;
        return configured === canonical || (legacyProduct && configured === legacyProduct);
      })
    : product.split === split;
  if (ruleset?.tiers?.xl && belongsTo(custom?.xl, 'xl')) return 'xl';
  if (ruleset?.tiers?.comfort && belongsTo(custom?.comfort, 'comfort')) return 'comfort';
  return 'premium';
}

/** Project selections without modifying, enabling or deleting any saved rule. */
export function selectedServiceRateGroups(selectedServices, ruleset) {
  const selected = normalizeSelectedServices(selectedServices);
  if (selected === null) return ['standard', 'premium', 'comfort', 'xl']
    .filter(tier => ruleset?.tiers?.[tier])
    .map(tier => ({ tier, services: [], products: [], label: ({ standard: 'Standard rides', premium: 'Premium rides', comfort: 'Comfort', xl: 'XL rides' })[tier] }));
  const groups = new Map();
  for (const service of DRIVER_SERVICES) {
    if (!selected.includes(service.id) || service.id === 'delivery') continue;
    for (const product of products.filter(product => product.service === service.id)) {
      const routed = offerRateTier(product.name, ruleset);
      const tier = routed === 'share' ? 'standard' : routed;
      if (!groups.has(tier)) groups.set(tier, { tier, services: [], products: [] });
      const group = groups.get(tier);
      if (!group.services.includes(service.id)) group.services.push(service.id);
      group.products.push(product.name);
    }
  }
  return [...groups.values()].map(group => ({ ...group,
    label: DRIVER_SERVICES.filter(service => group.services.includes(service.id)).map(service => service.label).join(' / '),
  }));
}
