# Location services: current source trace

> Source reconciled 2026-09-30 by Codex/Astra against the current location-first
> workflow. This replaces the April cached-location and
> market-first timezone flow. Source and tests below define current behavior;
> their results do not claim a deployment or live Google verification.

Drivers make decisions under time pressure. A wrong location, local date, or
unmeasured environmental value can send guidance toward the wrong market or
make an incomplete run appear ready. New location collection therefore requires
an authenticated live session, a fresh precise GPS observation, and verified
provider results. Location and Briefing prepare before preference confirmation;
explicit admission is required when the driver starts Strategy. Saved context
can be restored for the same live session without another capture.

## MAIN entry and inputs

[LocationProvider](../../client/src/contexts/location-context-clean.tsx) begins
first-session collection after the authenticated canonical setup read confirms
there is no saved or pending context. Required preference setup may still be
incomplete. Browser geolocation requests
`enableHighAccuracy: true`, `maximumAge: 0` and a 15-second acquisition timeout;
the wrapper also bounds acquisition and responds to cancellation.
[Shared coordinate validation](../../shared/coordinates.js) checks:

- Finite numeric coordinates within latitude ±90 and longitude ±180, including
  valid zero coordinates; complete decimal URL representations are accepted.
- Positive reported accuracy no greater than 100 meters.
- A GPS observation no older than 30 seconds and no more than five seconds in
  the future at initial capture validation.

Full sensor precision is retained. [coords-key.js](../../server/lib/location/coords-key.js)
formats six-decimal lookup keys; key precision is not GPS measurement accuracy
and does not authorize rounding the sensor values.

The client sends `lat`, `lng`, `accuracy`, `gps_timestamp`, `permission=granted`
and a UUID `captureId` to `POST /api/location/snapshot`, with authenticated
headers. It then posts `{snapshotId}` to `/api/location/news-briefing` and
re-reads `/api/main-runs/setup`. The prepared context is usable for Strategy
only after that read confirms matching owner/session/source and complete
snapshot/Briefing evidence. No device ID or client-provided city, timezone,
weather or market can replace the server checks.

[Run setup](../../client/src/contexts/run-setup-context.tsx) separates saving and
confirming preferences from starting Strategy. Strategy Continue/Refresh calls
`POST /api/main-runs/continue` with `expectedSnapshotId`, the canonical saved
settings/rules revisions and one request identity.
[Main-run admission](../../server/lib/main-run-admission.js) pins that
configuration and atomically copies the prepared snapshot and complete Briefing
into a new downstream context, retaining original observation timestamps and
the source generation token. It does not collect new GPS or Briefing.

[GlobalHeader](../../client/src/components/GlobalHeader.tsx) Refresh explicitly
prepares fresh location and Briefing, then starts Strategy and venues only when
preferences remain confirmed and canonical. Focus, navigation and same-session
remount restore or reconcile saved context through reads. An unfinished prior
capture stays held for manual Refresh; unchanged reads do not clear a local
permission/ownership hold. Previous displayed context remains during refresh.

Compatibility callers may still supply `runId` for the older admitted capture
path. That path retains its current admission/settings checks and requires the
GPS observation to follow admission, with one second of clock tolerance.
It is not the current browser capture contract; requests cannot combine
`captureId` and `runId`.

## Provider and identity trace

All three portal writers delegate to
[`portalSnapshotHandler`](../../server/lib/location/main-run-snapshot.js),
which selects `captureUpstreamSnapshot` for `captureId` or the legacy
`captureMainRunSnapshot` for `runId`. Both share the provider/readiness checks:

| Stage | Source/function | Result and requirement |
|---|---|---|
| Capture claim | `captureUpstreamSnapshot`, `withDriverSettingsLock` | Validate the live owner/session and capture identity, then claim `users.current_snapshot_id` before provider work. Preference readiness and Strategy admission are independent. |
| Address + timezone | [`resolveFreshGpsLocation`](../../server/lib/location/geocode.js) | Fresh Google reverse geocoding followed by Google Time Zone at the exact GPS coordinates. Complete address/city/state/ISO2 country and valid IANA timezone are required. |
| Current environment | [`snapshotEnvironment.both`](../../server/lib/location/snapshot-environment.js) | Concurrent Google Weather current conditions and Google Air Quality universal AQI; both are required for MAIN. |
| Market identity | [`resolveTimezoneFromMarket`](../../server/lib/location/resolveTimezone.js) | Country/state-scoped active market lookup, including explicit `market_cities` cross-state mappings and supported aliases. Ambiguous/unmapped identity remains unavailable. |
| Time and spatial identity | [`shared/dayparts.js`](../../shared/dayparts.js), coords key and H3 | Derive date, wall-clock time, hour, weekday and day part from the captured instant and Google timezone; compute the lookup key and H3 cell from the saved coordinates. |
| Readiness and commit | [`snapshot-readiness.js`](../../server/lib/location/snapshot-readiness.js), `captureUpstreamSnapshot` | Validate complete measured source, then recheck the live session/current capture under the lock before saving. An identical capture replay returns its saved owner/session/coordinate-matching observation; a superseded capture cannot publish. Legacy `runId` uses `bindMainRunSnapshot`. |

Despite its historical name, `resolveTimezoneFromMarket` supplies **market
identity**, not MAIN's timezone. Its legacy return includes market timezone
metadata, but the snapshot uses the Google coordinate-derived IANA timezone.
Known country is propagated into market/venue callers. Missing country never
invents US; legacy incomplete lookups can resolve only an unambiguous identity.
An unresolved MAIN market fails readiness instead of using the profile's home
market.

`getTimezoneDataForCoords` is the strict shared Google transport/validation
boundary. `getTimezoneForCoords` keeps the older soft `zone|null` contract for
its callers. Fresh geocoding and timezone requests have bounded eight-second
signals; there is no market/cache timezone shortcut in MAIN capture.

## Environmental evidence and concurrency

Snapshot Weather requires actual temperature, condition text and provider
`currentTime`. Air Quality requires the `uaqi` index, measured nonnegative AQI,
category and provider `dateTime`. Missing data never becomes a measured zero
or a fabricated current timestamp. Temperatures normalize to Fahrenheit;
Google wind speed remains a typed `{value, unit}` value.

Each saved section carries provider, coordinate key, fetch timestamp and
observation timestamp. Weather observations may be at most 30 minutes old;
air observations at most two hours old, relative to fetch time, with five
seconds of future tolerance. Readiness also verifies that fetch evidence
belongs to the new snapshot capture. This is a point-in-time receipt, not a
claim that a saved historical snapshot contains live conditions forever.

Current identical-coordinate work shares only an in-flight promise for the
same owner/session/capture identity, or legacy admission/settings/rules scope.
Settled work is removed; another capture identity collects fresh evidence.
Different precise coordinates and different captures do not share a completed
result. A replay or concurrent loser receives the stored observation's
coordinates, GPS time and accuracy together. Database publication prevents
duplicate rows for one capture; it does not provide a distributed lease for
provider calls before publication. Starting a new capture cancels superseded
preparatory Briefing work while retaining the separately admitted Strategy
until explicit replacement.

[`makeCircuit`](../../server/util/circuit.js) resets consecutive failures on
success, permits one half-open recovery probe, ignores obsolete completions,
and enforces a deadline even if a transport ignores abort. Snapshot Weather
uses a five-second circuit deadline and Air Quality three seconds; each opens
after three failures for 30 seconds. Public Concierge uses a separate circuit
instance so public optional-source failures do not trip MAIN collection.

## Routes and independent consumers

All routes in [`location.js`](../../server/api/location/location.js) require
authentication. The companion [`snapshot.js`](../../server/api/location/snapshot.js)
protects its writer/reader explicitly.

| Route | Current behavior |
|---|---|
| `POST /api/location/snapshot` | Current browser writer: authenticated `captureId` plus fresh GPS prepares upstream context before preference confirmation. The shared handler also retains legacy `runId` capture. |
| `GET /api/location/resolve`, `POST /api/snapshot` | Compatibility writers using the same shared handler and identity-specific checks. GET still writes; it is not a saved-context reader. Client snapshot fields cannot establish provenance. |
| `GET /api/location/weather`, `/airquality` | Require a current run. Before binding, collect the section for precise requested coordinates; after binding, read the saved section only when coordinates match. They do not fetch a forecast. |
| `PATCH /api/location/snapshot/:snapshotId/enrich` | Owned current-context confirmation/enrichment using saved coordinates and server evidence; supports current upstream context without `runId`, or strict admitted context with it. An already-ready snapshot is returned unchanged. |
| `GET /api/snapshot/:snapshotId` | Owned saved snapshot reader, including actual readiness and missing fields. |
| `GET /api/location/geocode/reverse`, `/geocode/forward`, `/timezone` | Authenticated coordinate/address utilities; not additional MAIN writers. Invalid coordinates, missing provider identity or failed timezone resolution cannot fabricate output. |
| `GET /api/location/pollen` | Independent Google Pollen utility, validated coordinates and integer days 1–5, five-second timeout. Missing measured indexes are unavailable, not zero. Not a required snapshot field. |
| `POST /api/location/news-briefing` | Current browser preparation entry: `{snapshotId}` validates owned current upstream context and runs the shared Briefing aggregator, requiring complete output. Explicit legacy `runId` retains strict admission checks. |
| `GET /api/location/ip` | Retired: `410 gps_required`. No current client used the former IP fallback. |
| `POST /api/location/release-snapshot`, `POST /api/snapshot/drop` | `409 explicit_continue_required`; preserve history and route the user through setup. |

The old `/api/location/users/me` route was removed; it is not a current header
location source. Geocode utility routes retain their process-local per-IP rate
limiter, which is not a distributed quota guarantee.

[Concierge](../../server/api/concierge/concierge.js) has anonymous guest-owned GPS
and a bounded precise-coordinate timezone cache; it is not a driver snapshot
source. [Offer Analyzer](OFFER_ANALYZER.md) and [Coach](RIDESHARE_COACH.md) are
independent pipelines sharing selected helpers/saved evidence, not alternate
permission to admit MAIN. Airport and holiday discovery belong to Briefing,
after the snapshot; location collection does not invoke a model for them.

## Verification and related traces

[Snapshot lifecycle](SNAPSHOT.md) covers atomic publication and client ownership.
[MAIN pipeline](ai-pipeline.md) continues through Briefing, Strategist and venue
recommendations. [Database runtime](../../server/db/README.md) covers TLS,
LISTEN lifecycle and query replay behavior.

`tests/location/` and `tests/strategy/upstream-strategy-refresh.test.js` exercise
upstream/legacy capture, immutable admission, simultaneous provider calls,
fresh retries, saved winner receipts, source freshness, circuit recovery,
strict provider routes and market identity. Market fixtures execute actual
queries in isolated in-memory PGlite. Client location/run-setup tests exercise
stale callbacks, returned stored coordinates, read-only same-session restoration,
manual retries and the explicit header waterfall. Provider tests use mocks;
no live Google results, billing totals or latency SLA are asserted here.

The [review removal ledger](removals/2026-09-29-pipeline-review.md) records the
superseded April cache/TTL/market-timezone, client enrichment, IP, profile
backfill and copied-schema descriptions. Their original rationale—avoid
incorrect local time, duplicate spend and stale-session publication—is
preserved by the explicit current contracts above, not by retaining obsolete
runtime instructions.
