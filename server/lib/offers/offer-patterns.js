// server/lib/offers/offer-patterns.js — pure renderer for the Coach's offer-pattern block.
//
// 2026-08-17 (Melody: the Coach "can analyze the offer table for location/daypart/dow/
// time/seasonality awareness and patterns for better steering towards better offers").
// The DAL aggregates offer_intelligence ⟕ offer_outcomes per user (rideshare-coach-dal.js
// getOfferPatterns); this module turns those rows into a compact prompt block. PURE
// (no db imports) — jest-safe. The Coach never decides offers (app_rules
// coach-never-analyzes-offers); this is longitudinal pattern context only.

const DIM_LABELS = {
  day_part: 'By time of day',
  dow: 'By day of week',
  city: 'By pickup area',
  product: 'By product',
  month: 'By month (seasonality)',
};
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MIN_N_FOR_HEADLINE = 3;

function fmtRow(r) {
  const parts = [`${r.n} offer${r.n === 1 ? '' : 's'}`];
  if (r.accept_pct != null) parts.push(`analyzer accepted ${r.accept_pct}%`);
  if (r.avg_pm != null) parts.push(`avg $${Number(r.avg_pm).toFixed(2)}/mi`);
  if (r.taken > 0) parts.push(`you took ${r.taken}${r.avg_earned != null ? ` (avg $${Number(r.avg_earned).toFixed(2)} earned)` : ''}`);
  return parts.join(', ');
}

function keyLabel(dim, key) {
  if (dim === 'dow') { const i = Number(key); return Number.isInteger(i) && DOW[i] ? DOW[i] : String(key); }
  return String(key);
}

/**
 * @param {Array<{dim:string,key:string|number,n:number,accept_pct:number|null,avg_pm:number|null,taken:number,avg_earned:number|null}>} rows
 * @param {{ windowDays?: number, total?: number }} meta
 * @returns {string} '' when there is nothing worth saying (< 3 offers)
 */
export function formatOfferPatterns(rows, meta = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const total = meta.total ?? Math.max(...rows.filter((r) => r.dim === 'day_part').map((r) => r.n), 0);
  if ((meta.total ?? total) < MIN_N_FOR_HEADLINE) return '';

  const byDim = {};
  for (const r of rows) (byDim[r.dim] ||= []).push(r);

  let out = `\n\n=== OFFER PATTERNS (your last ${meta.total ?? '~'} analyzed offers${meta.windowDays ? `, ${meta.windowDays} days` : ''}) ===`;

  // Headline: best / worst time of day by avg $/mi (only cells with enough data)
  const dp = (byDim.day_part || []).filter((r) => r.n >= MIN_N_FOR_HEADLINE && r.avg_pm != null);
  if (dp.length >= 2) {
    const sorted = [...dp].sort((a, b) => Number(b.avg_pm) - Number(a.avg_pm));
    out += `\n   Best time for pay: ${sorted[0].key} ($${Number(sorted[0].avg_pm).toFixed(2)}/mi over ${sorted[0].n}); weakest: ${sorted[sorted.length - 1].key} ($${Number(sorted[sorted.length - 1].avg_pm).toFixed(2)}/mi over ${sorted[sorted.length - 1].n})`;
  }
  const cities = (byDim.city || []).filter((r) => r.n >= MIN_N_FOR_HEADLINE && r.avg_pm != null);
  if (cities.length >= 2) {
    const sorted = [...cities].sort((a, b) => Number(b.avg_pm) - Number(a.avg_pm));
    out += `\n   Best pickup area for pay: ${sorted[0].key} ($${Number(sorted[0].avg_pm).toFixed(2)}/mi over ${sorted[0].n}); weakest: ${sorted[sorted.length - 1].key} ($${Number(sorted[sorted.length - 1].avg_pm).toFixed(2)}/mi over ${sorted[sorted.length - 1].n})`;
  }

  for (const dim of ['day_part', 'dow', 'city', 'product', 'month']) {
    const list = (byDim[dim] || []).slice().sort((a, b) => b.n - a.n).slice(0, 6);
    if (!list.length) continue;
    out += `\n   ${DIM_LABELS[dim]}:`;
    for (const r of list) out += `\n     - ${keyLabel(dim, r.key)}: ${fmtRow(r)}`;
  }

  out += `\n   Use these to steer positioning and timing toward better-paying offers. Never analyze a live offer here — that is the Offer Analyzer's lane.`;
  return out;
}
