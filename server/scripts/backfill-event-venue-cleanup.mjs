/**
 * server/scripts/backfill-event-venue-cleanup.mjs
 *
 * 2026-06-11: One-time backfill for the event-lifecycle hygiene added to
 * cleanup-events.js. Runs the SAME functions the opportunistic per-briefing cleanup
 * now calls, against whatever DATABASE_URL points to:
 *   1. collapseDuplicateEventSpans() — soft-deactivate cross-day duplicate run spans
 *      (e.g. the 6 overlapping "Wicked" rows) keeping the widest span.
 *   2. clearOrphanedEventVenueTags() — flip is_event_venue=false for venues left with
 *      no active discovered_events (the ~505 orphaned tags). NEVER deletes a venue.
 *
 * Both are soft / reversible (is_active=false, is_event_venue=false). Idempotent — safe
 * to re-run. Run once per environment (dev = Helium, prod = Neon) since the backlog is
 * per-database.
 *
 * Usage:  node server/scripts/backfill-event-venue-cleanup.mjs
 */
import { collapseDuplicateEventSpans, clearOrphanedEventVenueTags } from '../lib/briefing/cleanup-events.js';

const collapsed = await collapseDuplicateEventSpans();
const cleared = await clearOrphanedEventVenueTags();

console.log(`[backfill] collapsed ${collapsed} duplicate event spans; cleared ${cleared} orphaned is_event_venue tags`);
process.exit(0);
