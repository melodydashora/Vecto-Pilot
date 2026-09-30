# Snapshot lifecycle: admitted capture and saved evidence

> Source reconciled 2026-09-29. This replaces April descriptions of sessionStorage
> restoration, city/TTL reuse, fallback client UUIDs and mutable client enrichment.

A snapshot is the driver's saved point-in-time location and measured current
environment for **one explicit MAIN admission**. It is deterministic source
material for downstream work, not a model-generated summary or a browser
cache. Guidance must not mix an old session, a new GPS callback and another
run's weather or preferences.

The detailed provider/input contract is in [Location](LOCATION.md). The
end-to-end consumers are traced in [MAIN pipeline](ai-pipeline.md).

## Source ownership

| Source | Responsibility |
|---|---|
| [`run-setup-context.tsx`](../../client/src/contexts/run-setup-context.tsx) | Review/Continue lifecycle and admitted run identity. Saving valid unchanged setup does not require edits. |
| [`main-run-admission.js`](../../server/lib/main-run-admission.js) | Pin and revalidate owner, authenticated session, settings revision, rule version/hash, configuration and run identity. |
| [`location-context-clean.tsx`](../../client/src/contexts/location-context-clean.tsx) | Fresh GPS acquisition and publication scoped to the current token, owner and admitted run. |
| [`main-run-snapshot.js`](../../server/lib/location/main-run-snapshot.js) | All portal write routes → collection → complete row → atomic admission bind → authoritative response. |
| [`snapshot-environment.js`](../../server/lib/location/snapshot-environment.js) | Measured Weather/Air source receipts with bounded age and transport. |
| [`snapshot-readiness.js`](../../server/lib/location/snapshot-readiness.js) | Canonical required-field and cross-field/source consistency gate. |
| [`enrich-snapshot.js`](../../server/lib/location/enrich-snapshot.js) | Owned, admitted server enrichment/confirmation; a completed source remains immutable. |
| [`shared/schema.js`](../../shared/schema.js) | Database column definitions; this document does not maintain another schema copy. |

## Creation and binding

1. The driver chooses Continue with valid saved setup. The admission pins that
   configuration and authenticated session. Auth hydration, browser focus,
   route navigation, old snapshot storage, refresh icons and GPS overrides do
   not independently admit another MAIN run.
2. LocationProvider captures a fresh precise GPS receipt and calls
   `GET /api/location/resolve` with `runId`, coordinates, reported accuracy,
   observation timestamp and permission. Compatibility writers
   `POST /api/location/snapshot` and `POST /api/snapshot` call the same
   `portalSnapshotHandler`/`captureMainRunSnapshot` functions.
3. The collector rechecks admission, validates GPS, then gathers fresh Google
   address/timezone and current Weather/Air evidence. It resolves scoped
   market identity, derives local calendar/day-part data and computes the
   coordinate key/H3 cell. Airport and holiday are later Briefing work.
4. `assertSnapshotReady` verifies the constructed row before persistence.
   A provider failure, unknown market, inconsistent calendar field, missing
   provenance or incomplete measured environment prevents success.
5. `withDriverSettingsLock` and `bindMainRunSnapshot` revalidate current
   admission/session/settings inside a transaction. Snapshot INSERT,
   `main_run_admissions.snapshot_id/status`, and the matching authenticated
   user's `current_snapshot_id` pointer commit together. The location route
   does not invent or replace `users.session_id`.
6. If another request already bound this run, its stored row wins. Every
   successful caller receives that row. An already-bound admission reads its
   existing owned complete snapshot rather than collecting a new one.

The process shares current provider work only for the same admission,
configuration and full-precision coordinates. A settled unbound attempt does
not become a reusable provider cache. Across processes the transaction protects
binding; duplicate provider work before the bind remains possible without a
distributed lease.

## Saved identity and timestamps

`snapshot_id` identifies the saved row; `runId` identifies the admission that
owns it. These are not interchangeable. `coord_key` is a six-decimal lookup
format, not the snapshot's uniqueness key and not the sensor's accuracy.
Identical coordinates in a new admission still require fresh collection.

The collector stores raw numeric `lat/lng`, Google-resolved address and IANA
timezone, country/state-scoped market, and actual provider measurements.
`created_at` is the captured UTC instant. `local_iso` is a naive wall-clock
column: its digits represent driver-local time, not another UTC instant.
[`shared/dayparts.js`](../../shared/dayparts.js) derives these values and their
weekday/hour/day-part consistently. Snapshot API `local_iso` has no UTC suffix.

`permissions.observed_at` is the original GPS observation timestamp and
`permissions.accuracy_m` its measured accuracy. `snapshotResponse` returns
`gps_timestamp` as epoch milliseconds and `accuracy` as a number, or null when
historical source evidence is absent. It never substitutes `created_at` or
another caller's GPS receipt. The client uses the saved `lat/lng` and saved
observation timestamp, including when it lost a concurrent bind.

Weather/Air sections carry actual provider observation time, fetch time,
provider name and coordinate key. The readiness gate checks these receipts
against the snapshot and checks finite measurements, identifiers, H3/key,
IANA zone, local date/time, permissions and status. Read the canonical
`SNAPSHOT_REQUIRED_FIELDS` and `getSnapshotReadiness` implementation instead of
copying a drifting list into another document.

## Confirmation, immutability and reads

The client calls `PATCH /api/location/snapshot/:snapshotId/enrich` with the
current run after capture. Despite the historical endpoint name, current
capture already collects required Weather/Air. `enrichSnapshot` immediately
returns an already-ready saved row, avoiding another provider round trip.

For an eligible incomplete row, enrichment uses only its saved coordinates,
server providers and the current admission. A short locked write rechecks the
row, precise coordinates, owner and run after network work. If another writer
already completed it, that completed row wins. An `ok` row lacking trustworthy
source is rejected; client-supplied weather or labels cannot repair provenance.

`GET /api/snapshot/:snapshotId` is an authenticated owned read. It reports
actual `missing_fields` and readiness; an `ok` database label alone cannot make
an invalid row usable. Historical rows remain available as owned evidence, but
reading one does not admit a new run or restart MAIN. Snapshot readiness and
Briefing completeness are separate gates.

Release/drop compatibility endpoints return `409 explicit_continue_required`.
Refresh/override controls return to setup, and another Continue creates a new
admission. They do not delete snapshot history or silently reuse a 60-minute
same-city row. There is no active 15-minute sessionStorage snapshot restore or
client-generated fallback snapshot UUID in LocationProvider.

## Client publication and downstream lineage

LocationProvider publishes only while its exact owner/token/run scope is still
current and its abort signal remains active. Auth/run changes hide old state
immediately and abort in-flight work. GPS permission revocation returns to
setup. A late callback or response cannot repopulate the previous scope.

The saved response must confirm coordinates and observation time. After owned
server confirmation, the provider updates UI context and emits
`vecto-snapshot-saved` with `{ snapshotId, runId, reason: 'continue' }`.
[`co-pilot-context.tsx`](../../client/src/contexts/co-pilot-context.tsx) and the
MAIN routes enforce this admission lineage before orchestration. Snapshot
identity flows into saved queries, Briefing, Strategist, rankings and scoped
SSE. Profile/configuration data comes from the pinned run; a snapshot does not
implicitly import live Offer Analyzer decisions into MAIN.

The old April “zombie snapshot” incident remains the reason for both immediate
scope-based hiding and effect cleanup: queued React updates alone cannot stop
an old session from publishing in the same render cycle. The current
implementation uses explicit ownership checks, not the removed restore flow.

## Verification and limits

`tests/location/legacy-snapshot-route.test.js` covers common compatibility
writers, invalid/pre-admission GPS, complete source, concurrent bind winners,
authoritative response receipts and fresh retry behavior. Other location
suites cover provider shape/time bounds and immutable enrichment. Client
location/run-setup tests cover setup admission, stale responses and saved
winner coordinates. These are bounded source/test claims, not a live browser,
Google or deployment acceptance result.

The MAIN admission migration must exist in the selected database before this
runtime can operate. Source tests do not prove it has been applied. See
[database environments](DATABASE_ENVIRONMENTS.md), the
[review register](audits/PIPELINE_REVIEW_2026-09-29.md) and
[removal ledger](removals/2026-09-29-pipeline-review.md) for verification and
recovery provenance. No new snapshot retention/deletion policy is introduced
by this review.
