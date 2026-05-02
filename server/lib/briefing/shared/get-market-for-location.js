// 2026-05-02: Workstream 6 Step 1 — extracted from briefing-service.js (commit 2/11).
// Resolves a city/state to its rideshare market name (e.g., Plano, TX → Dallas).
// Used by ≥2 pipelines (events, news) to scope LLM searches at the market level
// rather than the narrower city level — markets correlate with where drivers actually
// work, while cities undercount cross-suburb demand.

import { db } from '../../../db/drizzle.js';
import { market_cities } from '../../../../shared/schema.js';
import { eq, and, ilike } from 'drizzle-orm';
import { briefingLog, OP } from '../../../logger/workflow.js';

/**
 * Get market name for a city/state location.
 *
 * 2026-04-16: FIX — returns null instead of city on miss. City-as-market substitution
 * produced narrower search results (e.g., "Plano" instead of "Dallas") and violated
 * the BRIEFING-DATA-MODEL.md contract that market is a distinct concept from city.
 *
 * @param {string} city - City name (e.g., "Frisco")
 * @param {string} state - State abbreviation (e.g., "TX")
 * @returns {Promise<string|null>} - Market name (e.g., "Dallas") or null if no DB match
 */
export async function getMarketForLocation(city, state) {
  try {
    // 2026-02-01: FIX - Use state_abbr (not state) since snapshot has "TX" not "Texas"
    const [marketResult] = await db
      .select({ market_name: market_cities.market_name })
      .from(market_cities)
      .where(and(
        ilike(market_cities.city, city),
        eq(market_cities.state_abbr, state)
      ))
      .limit(1);

    if (marketResult?.market_name) {
      briefingLog.info(`Market resolved: ${city}, ${state} → ${marketResult.market_name}`, OP.DB);
      return marketResult.market_name;
    }

    // 2026-04-16: No silent city substitution — callers handle null explicitly
    briefingLog.warn(2, `No market found for ${city}, ${state} — market_cities table has no match`, OP.DB);
    return null;
  } catch (dbErr) {
    briefingLog.warn(2, `Market lookup failed (non-fatal): ${dbErr.message}`, OP.DB);
    return null;
  }
}
