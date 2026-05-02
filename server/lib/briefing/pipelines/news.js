// 2026-05-02: Workstream 6 Step 1 — extracted from briefing-service.js (commit 6/11).
// Owns: news section of the briefings row + briefing_news_ready pg_notify channel.
//
// Live path: callModel('BRIEFING_NEWS') (Gemini 3 Pro with Google Search grounding).
// Returns rideshare-relevant news items (airport, traffic, platform updates, etc.) for
// the snapshot's market.
//
// 2026-05-02: Two dead code paths deleted in this commit (Option A precedent — see
// commit 4 / claude_memory #294):
//   - fetchNewsWithClaudeWebSearch (Claude WebSearch fallback) — zero callers
//   - consolidateNewsItems (multi-provider deduplication helper) — zero callers
// Both were never wired into the live fetchRideshareNews path; they were orphan
// "fallback" paths that no caller invoked.
//
// Section shape: news = { items: Array, reason: string|null } (the news section in
// the briefings row IS this object, not just an array). The wider pipeline contract
// adds an outer `reason` for orchestrator-level failure messaging.
//
// Logging tag: [BRIEFING][NEWS] (per the 9-stage taxonomy enforcement principle —
// the file location IS the taxonomy declaration).

import { briefingLog, OP, matrixLog } from '../../../logger/workflow.js';
import { callModel } from '../../ai/adapters/index.js';
import { safeJsonParse } from '../shared/safe-json-parse.js';
import { getMarketForLocation } from '../shared/get-market-for-location.js';
import { writeSectionAndNotify, CHANNELS, errorMarker } from '../briefing-notify.js';

/**
 * Filter news items to only include articles from the last 2 days.
 * 2026-01-31: Tightened from 7 days to 2 days - since we fetch fresh on every
 * login/refresh, we only want TODAY's news (with 1 day buffer for timezone edge cases).
 *
 * Safety net in case AI returns outdated articles despite prompt instructions.
 *
 * @param {Array} newsItems - Array of news items with optional published_date field
 * @param {string} todayDate - Today's date in YYYY-MM-DD format
 * @returns {Array} Filtered news items
 */
function filterRecentNews(newsItems, todayDate) {
  if (!Array.isArray(newsItems) || newsItems.length === 0) {
    return newsItems;
  }

  const today = new Date(todayDate);
  // 2026-01-31: Tightened from 7 days to 2 days (today + yesterday buffer)
  const twoDaysAgo = new Date(today);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

  const filtered = newsItems.filter(item => {
    // If no published_date, include with warning (can't verify freshness)
    if (!item.published_date) {
      briefingLog.warn(2, `News item missing date: "${item.title?.slice(0, 40)}..."`, OP.AI);
      return true; // Include but log warning
    }

    try {
      const pubDate = new Date(item.published_date);
      if (isNaN(pubDate.getTime())) {
        briefingLog.warn(2, `Invalid date format: ${item.published_date}`, OP.AI);
        return true; // Include but log warning
      }

      const isRecent = pubDate >= twoDaysAgo;
      if (!isRecent) {
        briefingLog.warn(2, `Filtered stale news (${item.published_date}): "${item.title?.slice(0, 40)}..."`, OP.AI);
      }
      return isRecent;
    } catch (err) {
      return true; // Include on error
    }
  });

  if (filtered.length < newsItems.length) {
    briefingLog.info(`Filtered ${newsItems.length - filtered.length} stale news items`, OP.AI);
  }

  return filtered;
}

/**
 * Build the enhanced news prompt with Market, City, Airport, Headlines.
 * 2026-01-05: Expanded scope for rideshare drivers.
 * 2026-01-10: GEMINI-ONLY - Updated to strip source citations for cleaner UI.
 */
function buildNewsPrompt({ city, state, market, date }) {
  return `Search for news relevant to RIDESHARE DRIVERS (Uber, Lyft, ridehail, taxi, private car service).

LOCATION CONTEXT:
- City: ${city}, ${state}
- Market: ${market} (search the entire ${market} metro area)
- Date: ${date}

SEARCH SCOPE - Include ALL of these:
1. AIRPORT NEWS: Delays, TSA changes, pickup/dropoff rules, terminal construction, airline schedules affecting ${market} airports
2. MAJOR HEADLINES: Big local news that creates ride demand (sports events, concerts, conventions, protests, emergencies)
3. TRAFFIC & ROAD: Road closures, construction, accidents, new toll roads, bridge closures in ${market} area
4. UBER/LYFT UPDATES: Platform policy changes, earnings bonuses, promotions, rate changes, deactivation news
5. GIG ECONOMY: Regulations, lawsuits, union activity, insurance changes affecting rideshare drivers
6. WEATHER IMPACTS: Severe weather that affects driving conditions or creates surge opportunities
7. GAS & COSTS: Fuel prices, EV charging news, vehicle costs that impact driver earnings

SEARCH THE ENTIRE ${market.toUpperCase()} MARKET - not just ${city}. News from nearby cities in the metro is highly relevant.

PUBLICATION DATE REQUIREMENT:
- ONLY include news published TODAY (${date}) or yesterday
- Do NOT include older news even if "still relevant" - we fetch fresh data daily
- Each item MUST have a published_date - if you can't determine the date, EXCLUDE it
- Stale news (older than yesterday) will be rejected

Return JSON (NO source citations, NO URLs in summary text, CLEAN display-ready content):
{
  "items": [
    {
      "title": "News Title (clean, no source attribution)",
      "summary": "HOW this affects rideshare drivers - be specific about impact on earnings or strategy. NO [Source: ...] or URL references.",
      "published_date": "YYYY-MM-DD",
      "impact": "high" | "medium" | "low",
      "category": "airport" | "traffic" | "event" | "platform" | "regulation" | "weather" | "cost"
    }
  ],
  "reason": null
}

REQUIREMENTS:
1. published_date is REQUIRED - extract from each article
2. summary MUST explain the DRIVER IMPACT (not just what happened)
3. Return 3-8 items maximum, sorted by impact (high first)
4. NO source citations, NO URLs, NO "[Source: ...]" text - keep summaries CLEAN for mobile display
5. If no news found: {"items": [], "reason": "No rideshare-relevant news for ${market} market"}`;
}

/**
 * Fetch rideshare news using Gemini 3.0 Pro with Google Search tools.
 * 2026-01-10: CONSOLIDATED to Gemini-only (removed GPT-5.2 parallel fetch).
 * Single-model approach for simpler pipeline, lower cost, cleaner data.
 *
 * @param {Object} params
 * @param {Object} params.snapshot - Snapshot with city, state, timezone
 * @returns {Promise<{items: Array, reason: string|null, provider?: string}>}
 */
export async function fetchRideshareNews({ snapshot }) {
  // 2026-01-09: Require ALL location data - no fallbacks for global app
  if (!snapshot?.city || !snapshot?.state || !snapshot?.timezone) {
    briefingLog.warn(2, 'Missing location data (city/state/timezone) - cannot fetch news', OP.AI);
    return { items: [], reason: 'Location data not available (missing timezone)' };
  }
  const city = snapshot.city;
  const state = snapshot.state;
  const timezone = snapshot.timezone;  // NO FALLBACK - timezone is required

  // Get current date in user's timezone
  let date;
  if (snapshot?.local_iso) {
    date = new Date(snapshot.local_iso).toISOString().split('T')[0];
  } else {
    date = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  }

  // 2026-04-16: Resolve market — snapshot.market is authoritative, DB lookup is fallback.
  // Null means genuinely unknown; buildNewsPrompt handles the placeholder.
  const market = snapshot.market || await getMarketForLocation(city, state);
  if (!market) {
    briefingLog.warn(2, `No market resolved for ${city}, ${state} — news search will use [unknown-market] placeholder`, OP.AI);
  }

  // Build the enhanced prompt with Market, City, Airport, Headlines
  // 2026-01-10: Updated prompt to strip source citations for cleaner UI
  const newsPrompt = buildNewsPrompt({ city, state, market: market || '[unknown-market]', date });
  const system = `You are a rideshare news research assistant for drivers on platforms like Uber, Lyft, ridehail, taxis, and private car services. Search for recent news and return structured JSON with publication dates. Focus on news that IMPACTS driver earnings, strategy, and working conditions. DO NOT include source citations, URLs, or "[Source: ...]" text in your summaries - return CLEAN text suitable for display.`;

  // 2026-01-10: Consolidated to single Briefer model (configured via BRIEFING_NEWS_MODEL)
  // Single-model approach: simpler pipeline, lower cost, cleaner data
  matrixLog.info({
    category: 'BRIEFING',
    connection: 'AI',
    action: 'DISPATCH',
    roleName: 'BRIEFER',
    secondaryCat: 'NEWS',
    location: 'pipelines/news.js:fetchRideshareNews',
  }, 'Calling Briefer for news');

  if (!process.env.GEMINI_API_KEY) {
    matrixLog.warn({
      category: 'BRIEFING',
      connection: 'AI',
      action: 'COMPLETE',
      roleName: 'BRIEFER',
      secondaryCat: 'NEWS',
      location: 'pipelines/news.js:fetchRideshareNews',
    }, `BRIEFING_NEWS model not configured (requires GEMINI_API_KEY)`);
    return { items: [], reason: 'Briefer model not configured' };
  }

  try {
    const result = await callModel('BRIEFING_NEWS', { system, user: newsPrompt });

    if (!result.ok) {
      // 2026-04-24: SECURITY — client-facing `reason` is a sentinel string so raw
      // upstream errors (which may echo API keys) cannot reach the HTTP response.
      // Full error stays in the server log only.
      matrixLog.warn({
        category: 'BRIEFING',
        connection: 'AI',
        action: 'COMPLETE',
        roleName: 'BRIEFER',
        secondaryCat: 'NEWS',
        location: 'pipelines/news.js:fetchRideshareNews',
      }, 'News fetch failed', result.error);
      return { items: [], reason: 'news-fetch-failed', provider: 'briefer' };
    }

    const parsed = safeJsonParse(result.output);
    const newsArray = Array.isArray(parsed) ? parsed : (parsed?.items || []);

    if (newsArray.length === 0) {
      briefingLog.info(`No news items found for ${market}`, OP.AI);
      return { items: [], reason: `No rideshare news found for ${market} market`, provider: 'briefer' };
    }

    // Filter recent news + sort by impact
    const filtered = filterRecentNews(newsArray, date);
    const sorted = filtered.sort((a, b) => {
      const impactOrder = { high: 0, medium: 1, low: 2 };
      return (impactOrder[a.impact] ?? 2) - (impactOrder[b.impact] ?? 2);
    });

    briefingLog.done(2, `News: ${sorted.length} items for ${market}`, OP.AI);

    return {
      items: sorted,
      reason: null,
      provider: 'briefer'
    };
  } catch (err) {
    briefingLog.error(2, `News fetch error: ${err.message}`, err, OP.AI);
    return { items: [], reason: `News fetch error: ${err.message}`, provider: 'briefer' };
  }
}

/**
 * Pipeline contract: discover rideshare news for a snapshot.
 *
 * Calls Gemini (via fetchRideshareNews), wraps the {items, reason} result into
 * the section shape, writes the news section to the briefings row, fires
 * CHANNELS.NEWS pg_notify, returns { news, reason }.
 *
 * Special case: news section content is itself { items, reason } (inner shape).
 * The pipeline contract's outer `reason` is for orchestrator-level failure
 * messaging (matches err.message on throw, otherwise mirrors the inner reason
 * for the "no items" path).
 *
 * fetchRideshareNews's internal try/catch handles AI provider failures and
 * returns {items: [], reason: '...'} on the graceful path — so the catch block
 * here is defensive against unexpected sync/import errors.
 *
 * @param {object} args
 * @param {object} args.snapshot - snapshot row (city/state/timezone required)
 * @param {string} args.snapshotId - snapshot UUID
 * @returns {Promise<{ news: { items: Array, reason: string|null } | object, reason: string|null }>}
 */
export async function discoverNews({ snapshot, snapshotId }) {
  let news;
  let reason = null;

  try {
    const r = await fetchRideshareNews({ snapshot });
    const items = Array.isArray(r?.items) ? r.items : [];
    news = {
      items,
      reason: r?.reason || (items.length === 0 ? 'No rideshare news found for this area' : null)
    };
    reason = items.length > 0 ? null : (r?.reason || 'No rideshare news found for this area');
    await writeSectionAndNotify(snapshotId, { news }, CHANNELS.NEWS);
  } catch (err) {
    news = errorMarker(err);
    reason = err.message;
    await writeSectionAndNotify(snapshotId, { news }, CHANNELS.NEWS);
    throw err;
  }

  return { news, reason };
}
