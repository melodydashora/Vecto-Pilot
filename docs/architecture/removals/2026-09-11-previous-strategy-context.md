# Previous strategy context removal provenance — 2026-09-11

Codex/Astra, todo 34, based on `8d0d482233c7606bcfec5a75946c49d0e8676d6e`.

`client/src/contexts/co-pilot-context.tsx` previously declared an unused
`_strategySnapshotId` state with this comment:

> Track which snapshot the current strategy belongs to (for future refresh optimization)

That state and its setters were removed. Current text now comes directly from the
validated active response, with both returned/requested snapshot IDs and the
current authenticated session revision. Separate in-memory completed text serves
historical display; it never supplies current venues, requests, or action scope.

The previous blocks-query readiness closure included this dated observation:

> 2026-01-10: D-021 - Server sends 'ok' or 'pending_blocks', not 'complete' (removed deprecated check)

The shared current readiness expression retains both statuses, additionally
requiring complete persisted Briefing, exact snapshot, current session, and no
explicit stale marker. Only `ok` plus nonblank text can update the historical
record. `pending_blocks` remains valid for current immediate rendering.

The prior immediate-strategy effect copied any non-error, truthy
`strategyForNow` into local state. It was replaced because pending same-snapshot
responses can intentionally retain old server text; copying that text would
mislabel it as current. Existing dated logout, manual-clear, snapshot-change,
legacy-storage cleanup, and SSE comments remain in place. Their old hook
references describe historical implementations; the new response checks are the
current source of truth. No historical text is written to browser storage.
