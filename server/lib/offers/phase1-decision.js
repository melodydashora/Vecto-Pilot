// Phase-1 boundary: extraction is model/ OCR evidence; arithmetic and verdict
// authority are server-owned. Every modality uses this same adjudication path.
import { canonicalOfferProduct, offerServiceForProduct } from '../../../shared/driver-services.js';
import { checkSanity, classifyTier, deriveEffectiveMetrics, evaluateDeterministic } from './rules-engine.js';

const DECISIONS = new Set(['ACCEPT', 'REJECT', 'NO DATA']);
const NUMBERS = ['price', 'total_miles', 'total_minutes', 'pickup_miles', 'pickup_minutes',
  'ride_miles', 'ride_minutes', 'rating'];
const round2 = value => Math.round(value * 100) / 100;
export const offerNumber = value => {
  if (value == null || value === '') return null;
  const cleaned = typeof value === 'string' ? value.replace(/[$\s,]/g, '') : value;
  if (typeof cleaned === 'string' && !/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const number = typeof cleaned === 'string' ? Number(cleaned) : cleaned;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

/** JSON syntax alone is insufficient: reject arrays, primitives and invented verdicts. */
export function normalizePhase1Model(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !DECISIONS.has(value.decision)) return null;
  const normalized = {};
  for (const key of NUMBERS) normalized[key] = offerNumber(value[key] ?? (key === 'rating' ? value.rider_rating : null));
  normalized.rating = normalized.rating > 0 && normalized.rating <= 5 ? normalized.rating : null;
  normalized.product_type = typeof (value.product_type ?? value.product) === 'string'
    ? (value.product_type ?? value.product).trim() : null;
  normalized.decision = value.decision;
  normalized.reason = typeof (value.reason ?? value.reasoning) === 'string' ? (value.reason ?? value.reasoning) : '';
  normalized.judgment_reject = typeof value.judgment_reject === 'string' ? value.judgment_reject.trim() : '';
  normalized.judgment_reported = typeof value.judgment_reject === 'string';
  normalized.tip_included = value.tip_included === true;
  normalized.notices = Array.isArray(value.notices) ? value.notices.filter(item => typeof item === 'string') : [];
  normalized.confidence = offerNumber(value.confidence) ?? 0;
  return normalized;
}

/**
 * Complete OCR legs can correct model aggregate arithmetic, but conflicting
 * primitive extractions are recorded for manual adjudication. A partial OCR
 * "total" is just the one observed leg and must never be promoted to a full trip.
 * Persisted per_mile/per_minute always describe pickup + trip, regardless of the
 * configured decision basis; decision_* fields below describe that separate basis.
 */
export function mergePhase1Extraction(preParsed, model) {
  const fullText = preParsed?.parse_confidence === 'full';
  const raw = {};
  for (const key of NUMBERS) raw[key] = offerNumber(model?.[key]);
  raw.extraction_conflicts = [];
  // Compare observed inputs only. Different model totals/rates may be arithmetic
  // mistakes and are recomputed below; different fares or legs have no known winner.
  for (const field of ['price', ...(fullText ? ['pickup_miles', 'pickup_minutes', 'ride_miles', 'ride_minutes'] : [])]) {
    const ocr = offerNumber(preParsed?.[field]);
    const extracted = offerNumber(model?.[field]);
    if (ocr != null && extracted != null && ocr !== extracted) {
      raw.extraction_conflicts.push({ field, ocr, model: extracted });
    }
  }
  if (preParsed?.price != null) raw.price = offerNumber(preParsed.price);
  raw.price_format = preParsed?.price_format ?? model?.price_format ?? null;
  raw.product_type = offerServiceForProduct(preParsed?.product_type)
    ? preParsed.product_type : (model?.product_type || preParsed?.product_type || null);
  const textProduct = canonicalOfferProduct(preParsed?.product_type);
  const modelProduct = canonicalOfferProduct(model?.product_type);
  const textService = offerServiceForProduct(textProduct);
  const modelService = offerServiceForProduct(modelProduct);
  const shared = product => product === 'Share' || product === 'Lyft Shared';
  raw.product_conflict = Boolean(textService && modelService
    && (textService !== modelService || shared(textProduct) !== shared(modelProduct)));
  raw.tip_included = preParsed?.tip_included === true || model?.tip_included === true;
  if (fullText) {
    for (const key of ['total_miles', 'total_minutes', 'pickup_miles', 'pickup_minutes', 'ride_miles', 'ride_minutes']) {
      raw[key] = offerNumber(preParsed[key]);
    }
  }
  if (raw.pickup_miles != null && raw.ride_miles != null) raw.total_miles = round2(raw.pickup_miles + raw.ride_miles);
  if (raw.pickup_minutes != null && raw.ride_minutes != null) raw.total_minutes = raw.pickup_minutes + raw.ride_minutes;
  raw.per_mile = raw.price > 0 && raw.total_miles > 0 ? round2(raw.price / raw.total_miles) : null;
  raw.per_minute = raw.price > 0 && raw.total_minutes > 0 ? round2(raw.price / raw.total_minutes) : null;
  return raw;
}

const noData = (raw, reasonKind = 'no_data') => ({ ...raw, decision: 'NO DATA', reason: 'no data', reason_kind: reasonKind, confidence: 0 });

export function selectedServiceVerdict(product, selectedServices, offerKind) {
  if (selectedServices == null) return null; // Legacy: unknown is never inferred from eligibility.
  const service = offerServiceForProduct(product, offerKind);
  if (!service) return { decision: 'NO DATA', reason_kind: 'service_unknown', reason: 'service not identified' };
  if (!selectedServices.includes(service)) return { decision: 'REJECT', reason_kind: 'service_disabled', reason: 'service not selected' };
  return null;
}

/**
 * No successful model means no completed ride judgment checks. A proved numeric
 * rejection remains usable; a ride acceptance must wait for those checks. Delivery
 * has a complete deterministic contract and therefore does not require judgment.
 */
export function adjudicatePhase1({ preParsed = null, model = null, ruleset, selectedServices = null }) {
  const raw = mergePhase1Extraction(preParsed, model);
  const tier = classifyTier(raw.product_type, ruleset);
  if (raw.product_conflict) return { ...noData(raw, 'product_conflict'), tier };
  if (raw.extraction_conflicts.length) return { ...noData(raw, 'extraction_conflict'), tier };
  const service = selectedServiceVerdict(raw.product_type, selectedServices, tier === 'delivery' ? 'delivery' : 'ride');
  if (service) return { ...raw, ...service, confidence: service.decision === 'REJECT' ? 100 : 0, tier };
  if (tier === 'share' && ruleset.share?.auto_reject !== false) {
    return { ...raw, tier, decision: 'REJECT', reason: 'share', reason_kind: 'share', confidence: 100 };
  }

  const sane = checkSanity(raw, ruleset);
  if (!sane.ok) return { ...noData(raw, 'implausible_parse'), tier, reason: 'implausible — decide manually',
    implausible: true, implausible_problems: sane.problems };
  if (tier === 'delivery' && ruleset.delivery?.enabled === false) {
    return { ...noData(raw, 'delivery_off'), tier, reason: 'delivery off' };
  }
  if (model?.decision === 'NO DATA') return { ...noData(raw), tier };
  if (model?.decision === 'ACCEPT' && model.judgment_reject) return { ...noData(raw, 'judgment_conflict'), tier };
  // A model's explicit non-offer answer cannot be resurrected by stray OCR dollars.
  if (model && !(model.price > 0) && !(model.total_miles > 0) && !(model.ride_miles > 0)) {
    return { ...noData(raw), tier };
  }
  const basis = tier === 'delivery' ? 'full_ride' : ruleset.basis;
  const metrics = deriveEffectiveMetrics(raw, basis);
  if (!(raw.price > 0) || !(raw.total_miles > 0) || metrics.perMile == null) return { ...noData(raw), tier };

  const engine = evaluateDeterministic(tier, raw, ruleset);
  const result = { ...raw, tier, decision: engine.decision, reason_kind: engine.reasonKind,
    decision_basis: basis, decision_per_mile: metrics.perMile, decision_miles: metrics.miles,
    decision_minutes: metrics.totalMin, confidence: model?.confidence ?? 80,
    notices: model?.notices || [],
    ...(engine.fallback ? { fallback: true } : {}),
    ...(engine.delivery ? { per_hour: engine.perHour, tip_thin: engine.tipThin === true, offer_kind: 'delivery' } : {}),
  };
  if (engine.decision === 'NO DATA') return { ...result, ...noData(raw, engine.reasonKind), tier };
  if (engine.decision === 'REJECT') return result;

  // An accepted ride needs every configured numeric gate to be evaluable. The
  // pure engine retains historical missing-field semantics for other callers;
  // the live acceptance boundary cannot silently skip required offer fields.
  if (tier !== 'delivery') {
    const pickup = ruleset.global?.pickup_limits;
    if (!(metrics.totalMin > 0)
      || (ruleset.global?.rating_floor > 0 && raw.rating == null)
      || (pickup?.max_miles != null && raw.pickup_miles == null)
      || (pickup?.max_minutes != null && raw.pickup_minutes == null)) return { ...noData(raw), tier };
    if (!model?.judgment_reported) return { ...noData(raw, 'judgment_unavailable'), tier };
    if (model.decision === 'REJECT' && model.judgment_reject) {
      return { ...result, decision: 'REJECT', reason_kind: 'judgment', reason: model.reason || model.judgment_reject,
        judgment_reject: model.judgment_reject, fallback: false };
    }
  }
  return result;
}
