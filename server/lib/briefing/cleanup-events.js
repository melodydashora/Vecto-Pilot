import { db } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';
import { briefingLog, OP } from '../../logger/workflow.js';
// 2026-06-11: reuse the discovery-pipeline title matcher so span-collapse uses the same
// "Broadway Dallas presents Wicked" ⊃ "Wicked" logic as deduplicateEventsSemantic.
import { titlesMatch } from '../events/pipeline/deduplicateEventsSemantic.js';

/**
 * Deactivate past events in discovered_events.
 * Soft-deactivates (is_active = false) events that have ended, preserving
 * historical data for audit/analysis while preventing stale events from
 * appearing in briefings and AI Coach queries.
 *
 * 2026-02-17: Rewritten from DELETE to soft-deactivate for data preservation.
 * 2026-02-17: Removed default timezone — NO FALLBACKS rule (CLAUDE.md).
 * 2026-02-17: Added deactivated_at timestamp for lifecycle tracking.
 *
 * Logic:
 * - Computes cutoff = now - 2h (matches POST_EVENT_SURGE_MS in strategy-utils.js so
 *   the deactivation window aligns with the read-side freshness window — events
 *   stay visible for ~2hr post-end to capture driver pickup surge).
 * - Deactivate if event_end_date < cutoffDate
 * - Deactivate if event_end_date == cutoffDate AND event_end_time < cutoffTime
 * - Only targets events where is_active = true (skip already-deactivated)
 *
 * @param {string} timezone - IANA timezone (e.g. 'America/Chicago') — REQUIRED
 * @returns {Promise<number>} Number of events deactivated
 */
export async function deactivatePastEvents(timezone) {
  if (!timezone) {
    throw new Error('deactivatePastEvents requires timezone parameter — NO FALLBACKS');
  }

  try {
    // 2026-05-02: Workstream 6 commit 8.5 — apply 2-hour post-event surge buffer so
    // deactivation aligns with the read-side freshness window in strategy-utils.js
    // (POST_EVENT_SURGE_MS). Events stay is_active=true for 2 hours after their
    // event_end_time, giving drivers ride opportunities from attendees leaving.
    const POST_EVENT_BUFFER_MS = 2 * 60 * 60 * 1000;
    const now = new Date();
    const cutoff = new Date(now.getTime() - POST_EVENT_BUFFER_MS); // 2 hours before now
    // Derive date/time strings from cutoff, not now. Format guarantees:
    //   en-CA → "YYYY-MM-DD" (sortable as string)
    //   en-GB → "HH:MM" 24-hour with leading zeros (sortable as string,
    //     assumes event_end_time is also stored in 24-hour HH:MM format —
    //     pre-existing assumption upstream of this commit)
    const cutoffDateStr = cutoff.toLocaleDateString('en-CA', { timeZone: timezone });
    const cutoffTimeStr = cutoff.toLocaleTimeString('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' });

    const result = await db.execute(sql`
      UPDATE discovered_events
      SET is_active = false,
          deactivated_at = NOW(),
          updated_at = NOW()
      WHERE is_active = true
        AND (
          event_end_date < ${cutoffDateStr}
          OR (event_end_date = ${cutoffDateStr} AND event_end_time < ${cutoffTimeStr})
        )
    `);

    const deactivatedCount = result.rowCount || result.count || 0;

    if (deactivatedCount > 0) {
      briefingLog.phase(1, `Deactivated ${deactivatedCount} past events (tz=${timezone})`, OP.DB);
    }

    return deactivatedCount;
  } catch (error) {
    // Non-fatal — cleanup failure shouldn't block event discovery
    briefingLog.error(1, `Failed to deactivate past events: ${error.message}`, error, OP.DB);
    return 0;
  }
}

/**
 * Clear the `is_event_venue` tag on venue_catalog rows that no longer have any
 * active discovered_events.
 *
 * 2026-06-11: Added because `is_event_venue` was monotonic ("once true, stays true" —
 * venue-cache.js) and only ever SET (events.js:701), never cleared. The tag had
 * accumulated to ~95% orphaned (533 tagged / 505 with no active event). This is the
 * "clear the event tag for events no longer valid" removal step.
 *
 * SAFETY: only flips the boolean tag — it NEVER deletes a venue_catalog row. Venues are
 * persistent; the event association is what's transient. (discovered_events.venue_id has
 * ON DELETE SET NULL, so even an unrelated venue delete elsewhere can't orphan events.)
 *
 * Coexists with the venue-cache OR-merge: that path only re-sets the tag true for venues
 * that receive a NEW event, so tag = true ⟺ venue currently anchors ≥1 active event.
 *
 * @returns {Promise<number>} Number of venue tags cleared
 */
export async function clearOrphanedEventVenueTags() {
  try {
    const result = await db.execute(sql`
      UPDATE venue_catalog
      SET is_event_venue = false,
          updated_at = NOW()
      WHERE is_event_venue = true
        AND NOT EXISTS (
          SELECT 1 FROM discovered_events de
          WHERE de.venue_id = venue_catalog.venue_id
            AND de.is_active = true
        )
    `);

    const cleared = result.rowCount || result.count || 0;
    if (cleared > 0) {
      briefingLog.phase(1, `Cleared is_event_venue tag on ${cleared} venues with no active events`, OP.DB);
    }
    return cleared;
  } catch (error) {
    // Non-fatal — tag hygiene must not block discovery.
    briefingLog.error(1, `Failed to clear orphaned event-venue tags: ${error.message}`, error, OP.DB);
    return 0;
  }
}

/**
 * Collapse duplicate multi-day event spans into one canonical row.
 *
 * 2026-06-11: A long-running show (e.g. "Wicked" at one venue, May 1 → Jun 14) is
 * re-discovered by Gemini on multiple days. Because the multi-day event_hash includes the
 * start date (`start_end`) and Gemini reports a slightly different run-start each time, each
 * re-discovery inserts a NEW row with the same end date — producing overlapping duplicate
 * spans (6 "Wicked" rows here). Per-batch deduplicateEventsSemantic can't catch this (the
 * duplicates arrive across different discovery days/batches), so it's handled here at
 * cleanup time across the whole active set.
 *
 * Grouping is conservative — a cluster requires ALL THREE: same venue_id, title match
 * (titlesMatch, the discovery matcher), AND overlapping date ranges. Two genuinely-distinct
 * concurrent shows at one venue (different titles) are never merged. The widest-span row
 * (longest [start,end], tie → earliest start) survives; the rest are soft-deactivated
 * (is_active=false, deactivation_reason='duplicate_span') — never deleted.
 *
 * @returns {Promise<number>} Number of duplicate spans deactivated
 */
export async function collapseDuplicateEventSpans() {
  try {
    const res = await db.execute(sql`
      SELECT id, venue_id, title, event_start_date, event_end_date
      FROM discovered_events
      WHERE is_active = true AND venue_id IS NOT NULL
    `);
    const rows = res.rows || res;
    if (!Array.isArray(rows) || rows.length === 0) return 0;

    // Date strings are 'YYYY-MM-DD' → lexical compare == chronological.
    const overlaps = (a, b) =>
      a.event_start_date <= b.event_end_date && b.event_start_date <= a.event_end_date;
    const spanDays = (r) =>
      (Date.parse(`${r.event_end_date}T00:00:00Z`) - Date.parse(`${r.event_start_date}T00:00:00Z`)) /
      86400000;

    // Group by venue, then cluster within a venue by title-match + date overlap.
    const byVenue = new Map();
    for (const r of rows) {
      if (!byVenue.has(r.venue_id)) byVenue.set(r.venue_id, []);
      byVenue.get(r.venue_id).push(r);
    }

    const loserIds = [];
    for (const group of byVenue.values()) {
      const assigned = new Set();
      for (let i = 0; i < group.length; i++) {
        if (assigned.has(i)) continue;
        const cluster = [group[i]];
        assigned.add(i);
        for (let j = i + 1; j < group.length; j++) {
          if (assigned.has(j)) continue;
          if (titlesMatch(group[i].title, group[j].title) && overlaps(group[i], group[j])) {
            cluster.push(group[j]);
            assigned.add(j);
          }
        }
        if (cluster.length < 2) continue;
        // Survivor = widest span; tiebreak earliest start.
        cluster.sort((a, b) =>
          spanDays(b) - spanDays(a) || a.event_start_date.localeCompare(b.event_start_date)
        );
        for (let k = 1; k < cluster.length; k++) loserIds.push(cluster[k].id);
      }
    }

    if (loserIds.length === 0) return 0;

    await db.execute(sql`
      UPDATE discovered_events
      SET is_active = false,
          deactivated_at = NOW(),
          deactivation_reason = 'duplicate_span',
          deactivated_by = 'cleanup',
          updated_at = NOW()
      WHERE id IN (${sql.join(loserIds.map((id) => sql`${id}`), sql`, `)})
    `);

    briefingLog.phase(1, `Collapsed ${loserIds.length} duplicate event spans (same venue + title + overlapping dates)`, OP.DB);
    return loserIds.length;
  } catch (error) {
    // Non-fatal — collapse failure must not block discovery.
    briefingLog.error(1, `Failed to collapse duplicate event spans: ${error.message}`, error, OP.DB);
    return 0;
  }
}
