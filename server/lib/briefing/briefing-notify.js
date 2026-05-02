// 2026-05-02: Workstream 6 Step 1 — extracted from briefing-service.js (commit 1/11).
// Owns the progressive per-section write + pg_notify primitive that powers the
// streaming briefing-tab UX. The SSE forwarder at server/api/strategy/strategy-events.js
// subscribes to the channels defined here and re-broadcasts them as `briefing_ready`
// events for client-side progressive refetch.
//
// This module is the EMISSION side only — the SSE forwarder lives separately.
// Pipelines under ./pipelines/ import from here; the aggregator (extracted later
// in commit 9) also imports from here.

import { db } from '../../db/drizzle.js';
import { briefings } from '../../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { briefingLog, OP } from '../../logger/workflow.js';

/**
 * Canonical pg_notify channel names. The SSE forwarder
 * (server/api/strategy/strategy-events.js /events/briefing) LISTENs on each.
 *
 * Frozen so a typo at a call site fails loudly at write rather than silently
 * notifying a channel no one subscribes to.
 */
export const CHANNELS = Object.freeze({
  WEATHER: 'briefing_weather_ready',
  TRAFFIC: 'briefing_traffic_ready',
  EVENTS: 'briefing_events_ready',
  AIRPORT: 'briefing_airport_ready',
  NEWS: 'briefing_news_ready',
  SCHOOL_CLOSURES: 'briefing_school_closures_ready',
});

/**
 * Per-section error wrapper. Tags failed pipeline output with a structured
 * marker so downstream readers can distinguish "section never ran" (NULL)
 * from "section ran but failed" ({ _generationFailed: true, error, failedAt }).
 *
 * @param {Error} err
 * @returns {{ _generationFailed: true, error: string, failedAt: string }}
 */
export const errorMarker = (err) => ({
  _generationFailed: true,
  error: err.message,
  failedAt: new Date().toISOString(),
});

/**
 * Write a partial update to the briefings row for one subsystem and fire a
 * per-section pg_notify so the SSE layer can push a progress event to the
 * client. Enables the streaming briefing-tab UX (weather appears first,
 * then traffic, then events as each provider resolves) restored 2026-02-17
 * after the partial-NOTIFY trigger was dropped.
 *
 * Errors are swallowed — the authoritative write is the final atomic
 * reconciliation in the aggregator. Progress signals failing should never
 * fail the main pipeline.
 *
 * @param {string} snapshotId
 * @param {object} updates - partial briefings row columns to set
 * @param {string} notifyChannel - one of CHANNELS.* values
 */
export async function writeSectionAndNotify(snapshotId, updates, notifyChannel) {
  try {
    await db.update(briefings)
      .set({ ...updates, updated_at: new Date() })
      .where(eq(briefings.snapshot_id, snapshotId));
  } catch (err) {
    briefingLog.warn(1, `Progressive write failed for ${notifyChannel}: ${err.message}`, OP.DB);
    return;
  }
  try {
    const payload = JSON.stringify({ snapshot_id: snapshotId, section: notifyChannel });
    await db.execute(sql`SELECT pg_notify(${notifyChannel}, ${payload})`);
    // 2026-04-28: SEND-side NOTIFY emit demoted to debug — db-client.js dispatcher
    // already emits the canonical [BRIEFING] [<sub>] [DB] [LISTEN/NOTIFY] [<channel>]
    // line on the receive side. The two were a visible duplicate.
    if (String(process.env.LOG_LEVEL || 'info').toLowerCase() === 'debug') {
      briefingLog.info(`NOTIFY ${notifyChannel} for ${snapshotId.slice(0, 8)} (sent)`, OP.SSE);
    }
  } catch (notifyErr) {
    briefingLog.warn(1, `Failed to send ${notifyChannel}: ${notifyErr.message}`, OP.SSE);
  }
}
