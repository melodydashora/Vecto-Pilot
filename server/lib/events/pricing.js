// server/lib/events/pricing.js
// 2026-04-25: POC event pricing — sliding cost-share by confirmed-attendee count.
// Pure function. Plan: docs/plans/PLAN_event-signup-page-2026-04-25.md

/**
 * Pick the per-person price (in cents) from a tiered cost-share schedule.
 *
 * Tier shape: { min_count: int, price_cents: int }
 * Tiers describe "if at least N have confirmed, charge each person $X."
 * The largest tier whose min_count <= confirmedCount wins.
 *
 * @param {Array<{min_count:number, price_cents:number}>} tiers
 * @param {number} confirmedCount  number of currently-confirmed signups (waitlist excluded)
 * @returns {number|null}  price in cents, or null if tiers are missing
 */
export function computePrice(tiers, confirmedCount) {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  const sorted = [...tiers].sort((a, b) => a.min_count - b.min_count);
  let chosen = sorted[0].price_cents;
  for (const t of sorted) {
    if (confirmedCount >= t.min_count) chosen = t.price_cents;
    else break;
  }
  return chosen;
}

/**
 * Format cents → "$NN.NN" for UI/email rendering.
 * @param {number|null} cents
 * @returns {string}
 */
export function formatUSD(cents) {
  if (cents == null || Number.isNaN(cents)) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}
