# Confirmed venue choices and Undo

Melody requested driver feedback that removes an unwanted recommendation and
offers an alternative. This September 11 sprint implements that bounded behavior
for the current owned snapshot/ranking. It does not complete todo58's broader
global scoring or learning policy. Base: `74fe5bf92db7f5ad0897f7072f40c1fee2691eb1`.

Previously the modal closed and thanked the driver before its background request
completed, and the request helper omitted bearer authentication. The card stayed
in place regardless of the vote. It now waits for a validated saved receipt;
errors retain the comment and card. A confirmed dismissal replaces the venue
with a distinct eligible saved candidate, or clearly reports no alternative.
Reload recovers the saved choice and its Undo control. Undo clears the display
dismissal and preserves the original vote.

## Contract and ownership

`POST /api/feedback/venue` accepts snapshot/ranking/place IDs, an action
(`dismiss`, `restore`, `upvote`), UUID `request_id`, up to three distinct
`visible_place_ids`, optional comment and restore's `undo_action_id`.
Legacy sentiment callers are mapped to the explicit action contract.

Authentication owns both the snapshot and ranking. The ranking must belong to
that snapshot; every supplied place must be a member. Eligible A/B candidates
retain the existing preferred spacing and 25-mile perimeter policy. A closed
venue with a valid staging reason is not silently made ineligible. Nothing
changes the catalog, another driver's list or another ranking.

The response includes the exact action/scope, feedback ID, monotonically
increasing `scope_revision`, canonical blocks, dismissal action IDs, replacement
and `replacement_status`. `GET /api/blocks-fast/saved` is a pure owned read of
that state and existing candidates. It performs no generation, business-hours
lookup or address resolution. Existing block response paths retain their
readiness fields while honoring saved exclusions.

The existing ranking row lock serializes writes. Votes use `venue_feedback`;
append-only `actions.raw` stores versioned receipts under a private action enum
that public instrumentation cannot supply. Identical UUID retries replay their
receipt; changed payloads conflict. Repeated dismissals retain the original
replacement association, and repeated Undo with stale visible IDs preserves the
current shortlist. The backend returns an explicit conflict for ambiguous
historical duplicate votes rather than deleting or selecting an arbitrary row.

Actual PostgreSQL testing found that this schema lacks the unique constraint
assumed by the old `ON CONFLICT` upsert. The implementation therefore selects
and updates an exact owned vote, or inserts, while holding the existing ranking
lock. No schema migration is required by this feature.

## Frontend behavior

The hook scopes all reads/writes to user, token, snapshot and ranking. Checks
after headers and response-body reads ignore late results even when transport
fixtures disregard aborts. Older saved reads cannot replace newer receipts.
Identical network retries retain the UUID. A conflict exposes a usable reload
inside the open modal, preserving the comment and using current visible IDs on
retry. Cache updates retain the surrounding strategy metadata.

Thumb controls have accessible names. Displayed place IDs, card/map identity and
dwell observers stay aligned after replacement. Labels describe the existing
A/B policy accurately; zero processing time no longer appears as stray text.
The narrow metric layout gives labels enough room and wraps the footer controls.

## Focused verification

Run the in-memory SQL suite with the pinned development dependency
`@electric-sql/pglite` 0.3.16:

```sh
NODE_OPTIONS=--experimental-vm-modules node node_modules/jest/bin/jest.js --config tests/feedback/jest.api.config.cjs --runInBand
node node_modules/jest/bin/jest.js --config tests/feedback/jest.ui.config.cjs --runInBand
```

Results: 17 schema-faithful SQL/router checks; 16 hook/modal and 9 actual
StrategyPage checks; 12 existing cached Briefing route checks. Client TypeScript,
targeted lint and build passed. The initial SQL fixture incorrectly supplied
the missing uniqueness constraint; it was corrected after real PG exposed the
assumption, and the final suite also preserves/rejects historical duplicates.

The opt-in actual PostgreSQL suite uses
`tests/feedback/jest.postgres.config.cjs`. Its guard rejects every target except
the explicitly allocated loopback55432/vecto_preview database before importing
the pool. Seven checks passed, including observed concurrent lock queues,
idempotent writes, both Undo edge cases, reload, exhaustion and ownership.
It injects synthetic authentication and stubs secondary indexing/learning;
production SQL and transactions remain real. Cleanup closes clients and timers.

A separate actual gateway/browser run used real password login, feedback POSTs
and saved-state GETs. It confirmed replacement, full reload, real409 recovery
with a retained draft and subsequent Undo. Final independent PG readback showed
revision6, six action receipts, two preserved downvotes, no dismissals and the
original shortlist. Only unrelated location/strategy initialization was synthetic;
provider routes stayed blocked. The used fixture was retained without reset.
Subsequent read-only browser checks preserve that canonical state while checking
320/390px layout and keyboard controls. Timestamped receipts preserve both the
earlier detected overflow and the final follow-up result.

Detailed receipts, source hashes, screenshots and private synthetic allocations
live under ignored `.config/astra-vecto-coordination/sprint-20260911/`. They are
not deployment or live-driver correctness evidence. No public push, production
migration, paid regeneration or global preference learning was performed.
