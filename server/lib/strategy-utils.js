// server/lib/strategy-utils.js
// Strategy-first gating utilities

import { db } from '../db/drizzle.js';
import { strategies } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

/**
 * DEPRECATED: Strategy rows are now ONLY created by strategy-generator-parallel.js
 * This function is kept for backwards compatibility but does NOT create placeholders
 * @param {string} snapshotId - UUID of snapshot
 * @returns {Promise<void>}
 */
export async function ensureStrategyRow(snapshotId) {
  // REMOVED: No longer creates placeholder strategy rows
  // Strategy generator creates the single authoritative row with model_name
  return;
}

/**
 * Check if consolidated strategy is ready for a snapshot
 * Used by blocks-fast to gate rendering until strategy exists
 * 
 * @param {string} snapshotId - UUID of snapshot
 * @returns {Promise<{ready: boolean, strategy?: string}>}
 */
export async function isStrategyReady(snapshotId) {
  if (!snapshotId) {
    return { ready: false };
  }

  try {
    const [strategyRow] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId))
      .limit(1);

    if (!strategyRow) {
      return { ready: false };
    }

    // Ready when consolidated_strategy exists (GPT-5 consolidated output)
    const ready = Boolean(strategyRow.consolidated_strategy);
    
    return {
      ready,
      strategy: strategyRow.consolidated_strategy,
      status: strategyRow.status
    };
  } catch (error) {
    console.error('[isStrategyReady] Error:', error);
    return { ready: false, error: error.message };
  }
}

/**
 * Get strategy context for venue/event planners
 * Returns all fields needed by planners
 * 
 * @param {string} snapshotId - UUID of snapshot
 * @returns {Promise<{snapshot, strategy, ready: boolean}>}
 */
export async function getStrategyContext(snapshotId) {
  const { ready, strategy, status } = await isStrategyReady(snapshotId);
  
  if (!ready) {
    return { ready: false, strategy: null, snapshot: null };
  }

  // Fetch snapshot with full context
  const { snapshots } = await import('../../shared/schema.js');
  const [snapshot] = await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.snapshot_id, snapshotId))
    .limit(1);

  return {
    ready: true,
    strategy,
    status,
    snapshot,
    // Planner inputs
    inputs: {
      snapshot_id: snapshotId,
      user_address: snapshot?.formatted_address,
      city: snapshot?.city,
      state: snapshot?.state,
      lat: snapshot?.lat,
      lng: snapshot?.lng,
      timezone: snapshot?.timezone,
      strategy_text: strategy
    }
  };
}

/**
 * Synthesize a fallback strategy from minstrategy and briefing when consolidation fails
 * @param {string} minstrategy - Claude's tactical analysis
 * @param {Object} briefing - Gemini's city intelligence {events, holidays, traffic, news}
 * @returns {string} - Synthesized strategy text
 */
export function synthesizeFallback(minstrategy, briefing) {
  const lines = [];
  
  // Extract plan from minstrategy (assume it's plain text)
  if (minstrategy && typeof minstrategy === 'string') {
    const summary = minstrategy.slice(0, 200).trim();
    lines.push(`📍 **Strategic Position:** ${summary}${minstrategy.length > 200 ? '...' : ''}`);
  }
  
  // Add event intelligence
  if (briefing?.events && Array.isArray(briefing.events) && briefing.events.length > 0) {
    const topEvents = briefing.events.slice(0, 3).join(', ');
    lines.push(`\n🎯 **Active Events:** ${topEvents}`);
  }
  
  // Add holiday information
  if (briefing?.holidays && Array.isArray(briefing.holidays) && briefing.holidays.length > 0) {
    const holidays = briefing.holidays.join(', ');
    lines.push(`\n🎉 **Holidays:** ${holidays} - Expect increased demand patterns`);
  }
  
  // Add traffic intelligence
  if (briefing?.traffic && Array.isArray(briefing.traffic) && briefing.traffic.length > 0) {
    const trafficSummary = briefing.traffic.slice(0, 2).join('; ');
    lines.push(`\n🚦 **Traffic:** ${trafficSummary}`);
  }
  
  // Add news intelligence
  if (briefing?.news && Array.isArray(briefing.news) && briefing.news.length > 0) {
    const newsSummary = briefing.news.slice(0, 2).join('; ');
    lines.push(`\n📰 **News:** ${newsSummary}`);
  }
  
  // Add fallback notice
  lines.push('\n\n_Note: Strategy synthesized from tactical analysis and market intelligence due to consolidation timeout. All intelligence data is current._');
  
  return lines.join('');
}

/**
 * Compress text to fit within token limits
 * @param {string} text - Text to compress
 * @param {number} maxLength - Maximum character length
 * @returns {string} - Compressed text
 */
export function compressText(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}

/**
 * Check if briefing has renderable content (not just an empty object)
 * @param {Object} briefing - Gemini briefing {events, holidays, traffic, news}
 * @returns {boolean} - True if briefing has at least one populated field
 */
export function hasRenderableBriefing(briefing) {
  if (!briefing || typeof briefing !== 'object') return false;
  
  // Support NEW briefing table structure (text fields)
  const {
    global_travel,
    domestic_travel,
    local_traffic,
    weather_impacts,
    events_nearby,
    holidays,
    rideshare_intel
  } = briefing;
  
  // Check if any text field has meaningful content (> 10 chars to avoid trivial/empty content)
  const hasContent = [
    global_travel,
    domestic_travel,
    local_traffic,
    weather_impacts,
    events_nearby,
    holidays,
    rideshare_intel
  ].some(field => typeof field === 'string' && field.trim().length > 10);
  
  // Also support OLD structure (events/holidays/traffic/news arrays) for backward compatibility
  const { events, traffic, news } = briefing;
  const hasOldFormat = (
    (Array.isArray(events) && events.length > 0) ||
    (Array.isArray(holidays) && holidays.length > 0) ||
    (Array.isArray(news) && news.length > 0) ||
    (Array.isArray(traffic) && traffic.length > 0) ||
    (traffic && typeof traffic === 'object' && Object.keys(traffic).length > 0)
  );
  
  return hasContent || hasOldFormat;
}

/**
 * Normalize briefing to ensure consistent shape
 * Guarantees all fields are arrays/objects even if input is malformed
 * @param {any} briefing - Raw briefing data
 * @returns {Object} - Normalized briefing with guaranteed shape
 */
export function normalizeBriefingShape(briefing) {
  return {
    events: Array.isArray(briefing?.events) ? briefing.events : [],
    holidays: Array.isArray(briefing?.holidays) ? briefing.holidays : [],
    news: Array.isArray(briefing?.news) ? briefing.news : [],
    traffic: Array.isArray(briefing?.traffic) ? briefing.traffic : []
  };
}
