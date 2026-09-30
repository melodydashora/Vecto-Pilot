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
import { sql } from 'drizzle-orm';
import { briefingLog, OP } from '../../logger/workflow.js';
import { BRIEFING_FIELDS, briefingFailureReason } from './briefing-readiness.js';
import { writeBriefingGeneration } from './briefing-generation.js';

export { CHANNELS } from './briefing-channels.js';

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
  // Section errors are returned by the Briefing API as well as Strategy polling.
  // Keep the cause safe at the shared boundary, before either response is built.
  error: briefingFailureReason(err),
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
    if (Object.keys(updates).some(field => !BRIEFING_FIELDS.includes(field))) {
      throw new Error('Progressive Briefing writes may only update section fields');
    }
    const stored = await writeBriefingGeneration(snapshotId, { ...updates, updated_at: new Date() });
    // A replacement owns the row, or final reconciliation already completed.
    if (!stored) return;
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
