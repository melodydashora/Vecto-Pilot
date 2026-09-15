import { db } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';
import { briefingLog, OP } from '../../logger/workflow.js';
// 2026-06-11: reuse the discovery-pipeline title matcher so span-collapse uses the same
// "Broadway Dallas presents Wicked" ⊃ "Wicked" logic as deduplicateEventsSemantic.
import { titlesMatch } from '../events/pipeline/deduplicateEventsSemantic.js';

/**
 * Soft-deactivate events two hours after their venue-local end time.
 * 2026-09-13: The previous global UPDATE interpreted every event in the
 * requesting driver's timezone. Resolve each row through its existing
 * venue_id -> venue_catalog.timezone instead. No geography or UTC fallback.
 * Missing/invalid timezone or timing is preserved and reported for repair.
 * Compare absolute instants for the two-hour buffer. PostgreSQL resolves an
 * ambiguous fall-back clock to the later (standard-time) occurrence, preserving
 * either possible event until both are old enough; stored clocks lack offsets.
 *
 * @returns {Promise<number>} Number of events deactivated
 */
export async function deactivatePastEvents() {
  try {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const result = await db.execute(sql`
      WITH event_context AS MATERIALIZED (
        SELECT de.id, de.event_end_date, de.event_end_time,
          tz.name AS resolved_timezone,
          CASE
            WHEN de.event_end_date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
            THEN CASE WHEN substring(de.event_end_date, 1, 4)::integer = 0 THEN false
              ELSE substring(de.event_end_date, 9, 2)::integer <= extract(day FROM (
                make_date(substring(de.event_end_date, 1, 4)::integer,
                          substring(de.event_end_date, 6, 2)::integer, 1)
                + interval '1 month - 1 day'
              )) END
            ELSE false
          END AS valid_date,
          COALESCE(de.event_end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false) AS valid_time
        FROM discovered_events de
        LEFT JOIN venue_catalog vc ON vc.venue_id = de.venue_id
        LEFT JOIN pg_timezone_names tz ON tz.name = vc.timezone
        WHERE de.is_active = true
      ), end_instants AS MATERIALIZED (
        SELECT id, CASE
          WHEN resolved_timezone IS NOT NULL AND valid_date AND valid_time
          THEN (event_end_date || ' ' || event_end_time)::timestamp AT TIME ZONE resolved_timezone
          ELSE NULL
        END AS end_at
        FROM event_context
      ), expired AS (
        UPDATE discovered_events de
        SET is_active = false, deactivated_at = NOW(), updated_at = NOW()
        FROM end_instants ei
        WHERE de.id = ei.id AND de.is_active = true
          AND ei.end_at < ${cutoff}::timestamptz
        RETURNING de.id
      )
      SELECT (SELECT count(*)::integer FROM expired) AS deactivated_count,
        (SELECT count(*)::integer FROM event_context WHERE resolved_timezone IS NULL) AS unresolved_timezone_count,
        (SELECT count(*)::integer FROM event_context WHERE NOT valid_date OR NOT valid_time) AS invalid_timing_count
    `);

    const counts = result.rows?.[0];
    const deactivatedCount = counts?.deactivated_count || 0;
    if (counts?.unresolved_timezone_count || counts?.invalid_timing_count) {
      briefingLog.warn(1,
        `Event cleanup preserved unresolved records: timezone=${counts.unresolved_timezone_count}, timing=${counts.invalid_timing_count}`,
        OP.DB);
    }
    if (deactivatedCount > 0) {
      briefingLog.phase(1, `Deactivated ${deactivatedCount} past events using venue timezones`, OP.DB);
    }
    return deactivatedCount;
  } catch (error) {
    // Cleanup failure preserves data and does not block fresh discovery.
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

/**
 * Write-time guard against duplicate multi-day spans — the root-cause complement to
 * collapseDuplicateEventSpans (which is the after-the-fact safety net).
 *
 * 2026-06-11: Before INSERTing a newly-discovered multi-day event, check for an existing
 * ACTIVE row at the same venue whose title matches (titlesMatch) and whose date range
 * overlaps. If found, extend that row to the union span (keeping its event_hash and
 * is_active=true) and return its id so the caller SKIPS inserting a new hash row. Without
 * this, the same run re-discovered on later days (slightly different start → different
 * `start_end` hash) accumulates "Wicked May 1 / May 5 / …" duplicate rows.
 *
 * Single-day events (start == end) are skipped — they already dedupe via the exact
 * event_hash, and merging same-venue single-day shows on different dates would be wrong.
 *
 * @param {{ venueId: string, title: string, startDate: string, endDate: string }} ev
 * @returns {Promise<string|null>} surviving row id if merged, else null (caller inserts)
 */
export async function mergeIntoOverlappingActiveSpan({ venueId, title, startDate, endDate }) {
  if (!venueId || !title || !startDate || !endDate || endDate === startDate) return null;
  try {
    // Date columns are TEXT 'YYYY-MM-DD' → lexical compare == chronological.
    const res = await db.execute(sql`
      SELECT id, title, event_start_date, event_end_date
      FROM discovered_events
      WHERE venue_id = ${venueId} AND is_active = true
        AND event_start_date <= ${endDate} AND event_end_date >= ${startDate}
    `);
    const rows = res.rows || res;
    const match = Array.isArray(rows) ? rows.find((r) => titlesMatch(r.title, title)) : null;
    if (!match) return null;

    const unionStart = match.event_start_date < startDate ? match.event_start_date : startDate;
    const unionEnd = match.event_end_date > endDate ? match.event_end_date : endDate;
    if (unionStart !== match.event_start_date || unionEnd !== match.event_end_date) {
      await db.execute(sql`
        UPDATE discovered_events
        SET event_start_date = ${unionStart}, event_end_date = ${unionEnd}, updated_at = NOW()
        WHERE id = ${match.id}
      `);
    }
    return match.id;
  } catch (error) {
    // Non-fatal — on any error, return null so the caller falls back to a normal insert.
    briefingLog.error(1, `mergeIntoOverlappingActiveSpan failed (non-fatal, inserting normally): ${error.message}`, error, OP.DB);
    return null;
  }
}
