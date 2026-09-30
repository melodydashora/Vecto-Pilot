import { db } from '../../db/drizzle.js';
import { createHash } from 'node:crypto';
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
        SELECT de.id, de.venue_id, de.event_end_date, de.event_end_time,
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
        SELECT id, venue_id, event_end_date, event_end_time, CASE
          WHEN resolved_timezone IS NOT NULL AND valid_date AND valid_time
          THEN (event_end_date || ' ' || event_end_time)::timestamp AT TIME ZONE resolved_timezone
          ELSE NULL
        END AS end_at
        FROM event_context
      ), expired AS (
        UPDATE discovered_events de
        SET is_active = false, deactivated_at = NOW(), updated_at = NOW(),
            deactivated_by = 'cleanup', deactivation_reason = 'past_event'
        FROM end_instants ei
        WHERE de.id = ei.id AND de.is_active = true
          -- A concurrent discovery may extend this row after the CTE read.
          -- Never expire its replacement schedule using the older observation.
          AND de.venue_id IS NOT DISTINCT FROM ei.venue_id
          AND de.event_end_date = ei.event_end_date AND de.event_end_time = ei.event_end_time
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
    const selected = await db.execute(sql`SELECT venue_id FROM venue_catalog vc WHERE is_event_venue = true
      AND NOT EXISTS (SELECT 1 FROM discovered_events de WHERE de.venue_id = vc.venue_id AND de.is_active = true)`);
    let cleared = 0;
    for (const { venue_id } of selected.rows || selected) {
      cleared += await withEventVenueLock(venue_id, async tx => {
        const result = await tx.execute(sql`UPDATE venue_catalog vc SET is_event_venue = false, updated_at = NOW()
          WHERE venue_id = ${venue_id} AND is_event_venue = true
            AND NOT EXISTS (SELECT 1 FROM discovered_events de WHERE de.venue_id = vc.venue_id AND de.is_active = true)
          RETURNING venue_id`);
        return result.rows?.length ?? result.rowCount ?? 0;
      });
    }
    return cleared;
  } catch (error) {
    briefingLog.error(1, `Failed to clear orphaned event-venue tags: ${error.message}`, error, OP.DB);
    return 0;
  }
}

/**
 * Serialize shared event writers for one canonical venue, through check + insert.
 * The transaction-scoped lock works across requests/processes and is released on
 * rollback. Hash uniqueness still owns exact duplicates with unresolved venues.
 */
export async function withEventVenueLock(venueId, write, { refreshTag = false } = {}) {
  return db.transaction(async tx => {
    if (venueId) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'event-venue:' + venueId}))`);
    const result = await write(tx);
    if (refreshTag && venueId) await tx.execute(sql`UPDATE venue_catalog vc SET
      is_event_venue = EXISTS (SELECT 1 FROM discovered_events de WHERE de.venue_id = vc.venue_id AND de.is_active = true),
      updated_at = NOW() WHERE venue_id = ${venueId}`);
    return result;
  });
}

/** Discovery may refresh facts but cannot override manual or unattributed removal. */
export function discoveryReactivationFields() {
  const autoExpired = sql`(discovered_events.deactivated_by = 'cleanup' AND discovered_events.deactivation_reason = 'past_event')`;
  return {
    is_active: sql`CASE WHEN ${autoExpired} THEN true ELSE discovered_events.is_active END`,
    deactivated_at: sql`CASE WHEN ${autoExpired} THEN NULL ELSE discovered_events.deactivated_at END`,
    deactivated_by: sql`CASE WHEN ${autoExpired} THEN NULL ELSE discovered_events.deactivated_by END`,
    deactivation_reason: sql`CASE WHEN ${autoExpired} THEN NULL ELSE discovered_events.deactivation_reason END`,
  };
}

/** Preserve legacy first-show hashes while separating conflicting saved schedules. */
export async function resolveEventWriteHash(executor, event, baseHash) {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'event-hash:' + baseHash}))`);
  const result = await executor.execute(sql`SELECT venue_id, city, state, venue_name, address, event_start_date, event_end_date, event_start_time, event_end_time
    FROM discovered_events WHERE event_hash = ${baseHash} LIMIT 1`);
  const existing = (result.rows || result)[0];
  const identity = ['venue_id', 'event_start_date', 'event_end_date', 'event_start_time', 'event_end_time',
    ...(!event.venue_id ? ['city', 'state', 'venue_name', 'address'] : [])];
  if (!existing || identity.every(key => (existing[key] ?? null) === (event[key] ?? null))) return baseHash;
  // Existing clocks/identity might be a different performance or a correction;
  // without evidence, retain both source variants rather than overwrite either.
  return createHash('md5').update(JSON.stringify(['timed-event-v1', baseHash, ...identity.map(key => event[key] ?? null)])).digest('hex');
}

function isMultiDaySpan(row) {
  const start = Date.parse(`${row.event_start_date}T00:00:00Z`);
  const end = Date.parse(`${row.event_end_date}T00:00:00Z`);
  // A single overnight performance is not a repeating multi-day run.
  return Number.isFinite(start) && Number.isFinite(end) && end - start > 86400000 &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(row.event_start_time || '') &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(row.event_end_time || '');
}
function sameSpanSchedule(a, b) {
  return isMultiDaySpan(a) && isMultiDaySpan(b) && titlesMatch(a.title, b.title) &&
    a.event_start_time === b.event_start_time && a.event_end_time === b.event_end_time &&
    a.event_start_date <= b.event_end_date && b.event_start_date <= a.event_end_date;
}

/**
 * Soft-deactivate only contained duplicates with the same venue/title/clocks.
 * Single-day/overnight shows, unknown timing and partially overlapping source
 * variants remain intact. Re-read under the same venue lock as discovery writes.
 */
export async function collapseDuplicateEventSpans() {
  try {
    const res = await db.execute(sql`SELECT DISTINCT venue_id FROM discovered_events
      WHERE is_active = true AND venue_id IS NOT NULL AND event_end_date > event_start_date`);
    const venues = res.rows || res;
    if (!Array.isArray(venues)) return 0;
    let collapsed = 0;
    for (const { venue_id } of venues) {
      collapsed += await withEventVenueLock(venue_id, async tx => {
        const selected = await tx.execute(sql`SELECT id, venue_id, title, event_start_date, event_end_date,
          event_start_time, event_end_time FROM discovered_events
          WHERE venue_id = ${venue_id} AND is_active = true FOR UPDATE`);
        const rows = (selected.rows || selected).filter(isMultiDaySpan).sort((a, b) =>
          a.event_start_date.localeCompare(b.event_start_date) || b.event_end_date.localeCompare(a.event_end_date) || a.id.localeCompare(b.id));
        const losers = new Set();
        for (let i = 0; i < rows.length; i++) {
          if (losers.has(rows[i].id)) continue;
          for (let j = i + 1; j < rows.length; j++) {
            if (sameSpanSchedule(rows[i], rows[j]) && rows[i].event_start_date <= rows[j].event_start_date &&
                rows[i].event_end_date >= rows[j].event_end_date) losers.add(rows[j].id);
          }
        }
        if (!losers.size) return 0;
        const result = await tx.execute(sql`UPDATE discovered_events SET is_active = false,
          deactivated_at = NOW(), deactivation_reason = 'duplicate_span', deactivated_by = 'cleanup', updated_at = NOW()
          WHERE venue_id = ${venue_id} AND is_active = true
            AND id IN (${sql.join([...losers].map(id => sql`${id}`), sql`, `)}) RETURNING id`);
        return result.rows?.length ?? result.rowCount ?? 0;
      });
    }
    if (collapsed) briefingLog.phase(1, `Collapsed ${collapsed} contained duplicate event spans`, OP.DB);
    return collapsed;
  } catch (error) {
    briefingLog.error(1, `Failed to collapse duplicate event spans: ${error.message}`, error, OP.DB);
    return 0;
  }
}

/**
 * Write-time span guard. Call inside withEventVenueLock and keep that transaction
 * through the caller's INSERT. A failed check must abort the write, not imply a
 * cache miss. Multiple matching spans are ambiguous and remain source variants.
 * The SQL union is monotonic even if another legacy writer omits the lock.
 */
export async function mergeIntoOverlappingActiveSpan({ venueId, title, startDate, endDate, startTime, endTime }, executor = db, { returnRecord = false } = {}) {
  const incoming = { title, event_start_date: startDate, event_end_date: endDate, event_start_time: startTime, event_end_time: endTime };
  if (!venueId || !title || !isMultiDaySpan(incoming)) return null;
  const res = await executor.execute(sql`SELECT id, event_hash, title, event_start_date, event_end_date, event_start_time, event_end_time
    FROM discovered_events WHERE venue_id = ${venueId} AND is_active = true
      AND event_start_date <= ${endDate} AND event_end_date >= ${startDate} FOR UPDATE`);
  const rows = res.rows || res;
  const matches = Array.isArray(rows) ? rows.filter(row => sameSpanSchedule(row, incoming)) : [];
  if (matches.length !== 1) return null;
  const match = matches[0];
  await executor.execute(sql`UPDATE discovered_events
    SET event_start_date = LEAST(event_start_date, ${startDate}),
        event_end_date = GREATEST(event_end_date, ${endDate}), updated_at = NOW()
    WHERE id = ${match.id} AND is_active = true`);
  return returnRecord ? match : match.id;
}
