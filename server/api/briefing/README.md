# Briefing API

Source: [briefing.js](briefing.js), reviewed September 29, 2026. Mounted at `/api/briefing`; all routes require authentication and snapshot-specific readers enforce ownership. Generation belongs to the [MAIN pipeline](../../../docs/architecture/ai-pipeline.md), not a saved-data GET.

| Endpoint | Current behavior |
|---|---|
| GET `/snapshot/:snapshotId` | Progressive saved Briefing with pending/failed/usable state on every section. |
| GET `/weather/:snapshotId`, `/traffic/:snapshotId`, `/rideshare-news/:snapshotId`, `/school-closures/:snapshotId`, `/airport/:snapshotId` | Read the saved section; 202 pending, 503 failed/malformed terminal result, 200 usable. No zombie regeneration. Weather requires both current and forecast data. |
| GET `/events/:snapshotId` | Requires usable saved events section, then reads country/market-scoped verified events for today's display. Active filtering uses actual event intervals. |
| GET `/discovered-events/:snapshotId` | Saved market events overlapping today through the next seven days, including ongoing multi-day spans. |
| GET `/current` | Latest owned snapshot's complete Briefing; pending/failure stays explicit. |
| POST `/generate` | Historical compatibility name: reads a complete saved Briefing for the supplied owned snapshot. It does not generate. |
| POST `/refresh` | Rejects bypassing explicit setup/Continue; starts no providers. |
| GET `/weather/realtime`, `/traffic/realtime` | Explicit independent provider utilities with validated coordinates. These are not saved-section reads. |
| POST `/filter-invalid-events` | Canonical read-time event filtering; timezone required. |
| PATCH `/event/:eventId/deactivate`, `/reactivate` | Event moderation with current user's country/market scope; operator exception explicit. |

[market-event-reader.js](../../lib/events/market-event-reader.js) centralizes saved geographic scope and venue-local instants. [event-read-reconciliation.js](../../lib/events/event-read-reconciliation.js) preserves source variants and time disagreements. The obsolete refresh-daily/discover-events/confirm-details routes and multi-model sync workflow formerly documented here are not current routes.

[SSE](../../../docs/architecture/SSE.md) is mounted separately under `/events/*`. Clients refetch saved state after notifications. A completion event alone does not prove readiness; [briefing-readiness.js](../../lib/briefing/briefing-readiness.js) owns that contract. [Coach actions](../../../docs/architecture/RIDESHARE_COACH.md) have their own parser/DAL path; do not infer direct route calls from an action tag.

[API contract tests](../../../tests/briefing/weather-route.test.js), [market SQL tests](../../../tests/events/market-event-reader.test.js) and the [review register](../../../docs/architecture/audits/PIPELINE_REVIEW_2026-09-29.md) provide bounded verification. Historical content is recoverable through the [removal ledger](../../../docs/architecture/removals/2026-09-29-pipeline-review.md).
