# Briefing generation

Reviewed against source September 29, 2026. The [MAIN pipeline trace](../../../docs/architecture/ai-pipeline.md#3-snapshot--complete-briefing) owns the full sequence and section table. [API readers](../../api/briefing/README.md) describe the saved-data routes.

[briefing-aggregator.js](briefing-aggregator.js) owns admission, short transactional generation claim, seven parallel `discover*` calls and final reconciliation. [briefing-generation.js](briefing-generation.js) fences writes by current run, snapshot, generation token and pending state. No provider operation holds the generation claim transaction open. Ordinary duplicates join existing pending work; another explicit Continue creates a fresh run/snapshot after failure. The old refresh-on-GET and partial-refresh descriptions no longer apply.

The [readiness contract](briefing-readiness.js) requires every section plus saved completion metadata. Weather has two columns, so seven sections occupy eight required fields. Explained successful empty lists are valid; failed providers, malformed fields and unknown airport coverage are not successful absence. Strategy re-reads this contract before dispatch. A 90-second join timeout fails rather than authorizing incomplete data.

Each [pipeline](pipelines/) owns its provider transformation. Raw `fetch*` functions and `discover*` persistence wrappers are deliberate layers (continuity memory 361). [briefing-notify.js](briefing-notify.js) uses [channel constants](briefing-channels.js) and generation-scoped writes; these progress events do not authorize Strategy. Schools run concurrently with the other six sections, with no cross-snapshot 24-hour success shortcut.

[Event normalization/validation/storage](../events/pipeline/) is separate from [read reconciliation](../events/event-read-reconciliation.js). Read-time event freshness retains the two-hour post-event surge window. [cleanup-events.js](cleanup-events.js) resolves each stored venue's timezone before deactivation; missing or invalid timing remains evidence for repair. Deduplication must preserve distinct performances and conflicting source times. See the [review register](../../../docs/architecture/audits/PIPELINE_REVIEW_2026-09-29.md) for ongoing verification and fixes.

[dump-last-briefing.js](dump-last-briefing.js) preserves the quiet diagnostic artifact requested in memory 218. The ignored file contains the caller's snapshot-scoped saved rows, written privately and atomically. It is explicitly not the exact Strategist request, and rows are read separately.

[tests/briefing](../../../tests/briefing/) covers completion, stored-source validation, provider failures, stale writers, progressive readers and retry behavior. Tests with mocked providers do not establish live API availability. The generation-token and MAIN-admission migrations must exist in the selected database before this code is deployed; this documentation does not claim they were run.

Historical extraction provenance: Workstream 6 (May 2026), memories 294–300. The old monolith was split into fetchers, orchestration and persistence; that reasoning remains valid. Obsolete facade names, copied model pins, route examples and line counts were consolidated into current source links; see the [removal ledger](../../../docs/architecture/removals/2026-09-29-pipeline-review.md).
