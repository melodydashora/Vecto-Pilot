# Pipeline correctness review — September 29, 2026

**Ordered source review and verified fixes complete for the coverage below; rollout and architectural limits remain explicit.** Melody authorized source-based checks and root-cause fixes for the
main waterfall and independent pipelines, including duplicated logic, races, Google
API contracts and stale documentation. Base: `main` at
`6e98390697dfd3d677702bc64fe206b2383f5279`, with existing P1/Analyzer work preserved.
This record tracks source observations and test proof; it is not a deployment or exhaustive bug-free certification.

## September 30 continuation

### Focused admission, settings and time follow-through

Melody authorized a further bounded 30-minute pass. Four reproduced defects were
corrected without changing UI colors, the established preparation/admission
sequence, saved selections or the ownership of existing work:

- A lost Continue response followed by canonical readback could allocate another
  intent. The client now retains the original request body across source/clone
  readback, consumes it on success and abandons it on edits or configuration/source
  changes. A superseded replay explicitly returns to held review. Four previously
  failing cases and the new-intent controls pass.
- Rules PUT migrated missing or malformed core input into defaults before
  validation. It now requires the original global core fields before migration.
  Twelve malformed-core cases preserve saved config/hash/version and the current
  admission. Full and minimal valid legacy configs remain supported; existing
  optional-field migration normalization is unchanged.
- Coach history used the server timezone and could shift the driver's calendar
  day or conflate DST repeats. Its owned history query now supplies the stored
  zone, and the prompt retains local time, GMT offset and the UTC instant. Missing
  zones or invalid timestamps remain explicit without dropping valid history.
- Weather/air observation parsing accepted zoneless clocks, date-only values and
  calendar rollover as fresh evidence. These now fail before publication. Valid
  offsets, leap days and original fractional precision remain intact.

The full client replay passed **44 suites / 386 tests** and the full backend
passed **131 suites / 2,346 tests**, with all 991 recorded fingerprints unchanged
during each run. This adds 50 regression cases to the previous endpoint. Full
ESLint, canonical client/server and nested-client TypeScript checks, and the
workspace frontend build passed. The served index and all five assets match the
new build; its CSS matches the preceding build. The existing backend process
predates these source edits, so its loaded revision is not certified here. No live
provider, application data/schema change, gateway restart or deployment is part
of this pass. These checks do not establish authenticated browser acceptance.

### Earlier verified venue endpoint

Codex/Astra resumed the preserved fixes on the same base and verified the later
frontend and venue changes against their actual source fingerprints. The GPS
retry ownership, explicit Strategy setup-read retry, retained historical map,
street type/direction identity, and concurrent address repair fixes have landed.
Their original failing evidence remains in the existing private coordination
receipts; the older in-progress checkpoint is superseded.

A further reproduced venue defect allowed partial Google address components to
hide a complete formatted address. A same-name result could then bypass a known
street conflict. [The resolver](../../../server/lib/venue/venue-address-resolver.js)
now uses complete street components, then the formatted street, then parsed
address evidence. Five additional [regressions](../../../tests/venue/text-identity.test.js)
cover partial components, numeric highway routes, matching-address positive
controls, component precedence and the actual text-search gate. The location
preflight, [location trace](../LOCATION.md) and [MAIN entry trace](../ai-pipeline.md)
were reconciled with location-first preparation and explicit Strategy admission.

Final review also found that newly created venues skipped identity repair after
Places corrected their address and coordinates. The old timezone was correctly
cleared, but the new point's timezone remained missing until another lookup.
The creation branch now repairs the validated row immediately. Two additional
[SQL regressions](../../../tests/venue/catalog-colocation-sql.test.js) verify
the corrected point's timezone and preserve the existing behavior after an
initial timezone failure for an unchanged valid address. The new regression
failed against the preceding source; all 206 venue tests now pass.

The final backend run passed **131 suites / 2,304 tests**, with all 905 source
fingerprints unchanged during execution. The latest client replay passed
**44 suites / 378 tests**; its client inputs still match this endpoint. A fresh
run of the four UI harnesses passed **11 suites / 133 tests**, with Airport
coverage overlapping the client suite. Full lint and final resolver lint passed;
canonical client/server and nested-client TypeScript checks passed. A fresh
`npm run build` completed successfully at 01:15 UTC with all 905 source
fingerprints unchanged, updating normal `client/dist`.

The final documentation check also corrected the Places field list and the
reverse-geocoding/Time Zone request sequence, and documented explicit Strategy
retry after a canonical setup-read failure.

These are synthetic/offline checks. No gateway startup, application data/schema
mutation, live provider campaign, authenticated device acceptance or deployment
was performed by this continuation. Broader runtime validation remains open.

## Review order and coverage

1. Preferences, authentication, session and explicit MAIN admission.
2. Location, snapshot, shared environmental and time/market resolution.
3. Briefing, including progressive writes, refresh paths and independent reads.
4. Strategist and publication of results for the admitted source generation.
5. Venue planner, routing/enrichment, events, and feedback/replacement behavior.
6. Coach, current saved context, conversation/voice lifecycle and actions.
7. Independent Analyzer/translation/Concierge/background pipelines and shared resources.

Disjoint investigations and regression work may run concurrently. Each producer and
consumer handoff must be checked before its stage is considered verified. Similar
function names alone do not establish duplicate work: raw fetchers and full
fetch/write/notify phases can be intentional layers (continuity memory 361).

## Findings register

| ID | Root cause / observed issue | State and proof |
|---|---|---|
| P1-01 | Home address changes retained old coordinates/timezone after failed geocoding and could overwrite the chosen market. | Fixed; address regressions in Stage1 backend 10 suites/135 tests. |
| P1-02 | Duplicated login/Google/profile projections omitted session, revision, selected services and admitted inactive primary vehicles. | Shared response projection; Stage1 backend pass. |
| P1-03 | Canceled Continue retained its occupied client request slot. | Abort/release plus late-response guard; focused client 5 suites/48 tests. |
| P1-04 | A password reset could race a previously started password verification and still permit the old credential. | Locked credential recheck and transactional session creation; Stage1 backend pass. |
| P1-05 | A token changed by another tab left the previous account's identity/cache mounted. | Storage synchronization clears identity/cache/SSE before new-owner hydration; client regressions pass. |
| P1-06 | Malformed session clocks, backward activity writes, and expiry cleanup racing renewal. | Shared validity policy, GREATEST activity, captured-clock cleanup CAS; actual generated SQL in disposable PGlite. |
| P2-01 | Duplicate same-run captures repeated Google work; losing response could mix its GPS with the stored winner. | Exact-source in-flight sharing and saved observation receipt; Stage2 12 suites/215 tests plus client winner tests. Cross-instance billing dedup remains a stated limit. |
| P2-02 | Market matching could discard country/state; cache country defaulted to US. | Explicit country/state mappings and bounded aliases; country propagated, unknown remains null. Stage2 pass. |
| P2-03 | Circuit failures accumulated through successes; half-open admitted concurrent probes and stale results. | Consecutive failure reset, single probe, generation/deadline guards; Stage2 pass. |
| P2-04 | Legacy IP lookup bypassed the intended GPS provenance boundary. | No current source consumers found; IP-provider implementation retired, endpoint returns 410 gps_required. |
| P2-05 | Timezone/reverse/pollen boundaries accepted malformed coordinates or unverified provider fields. | Shared validated bounded timezone transport; strict coordinates, IANA zone and pollen observations; Stage2 pass. |
| P3-01 | Google weather wind/temperature units and forecast timestamps were misread; zeros disappeared and missing values became guessed UI values. | Contract normalization, deadlines and truthful WeatherCard; Stage3 backend 3 suites/40 tests and client 3 suites/16 tests. |
| P3-02 | Saved weather GET started extra work; other saved readers declared missing sections successful empty coverage and tried zombie generation. | Saved reads now use section contracts with pending/failure states; old zombie trigger removed. Root 2 suites/32 tests. |
| P3-03 | Empty seeded airport lookup claimed verified geographic absence without a coverage receipt. | Unknown coverage preserved; no verified-empty claim; regression passes. Establishing positive geographic coverage remains separate work. |
| P3-04 | Briefing trusted a supplied snapshot copy instead of validating the persisted admitted observation. | Every provider now receives the validated stored snapshot; 2 RED regressions then 50-test dependency suite pass. |
| P3-05 | News/event readers used host-time fallbacks, future news, or duplicate event interval logic. | Canonical timezone-aware helpers and local-day news cutoff; 9 new cases plus Stage4 integrated pass. Briefing active-event reader reuses them. |
| P3-06 | Legacy event reads can turn DB failures into empty success; market reader/moderation scopes omit country/state. | Shared country/metro reader with venue-timezone absolute overlap, truthful failure/partial coverage and ownership-scoped moderation. Actual PGlite reader regressions pass; MAIN collection and planner consumers now use the same reader; saved Briefing→Strategist and planner→candidate actual-SQL integration pass (9 suites/112 tests). |
| P3-07 | Automatic global diagnostic dump selects another run's latest row and races one output filename. | Snapshot-scoped private atomic diagnostic, serialized in-process with unique temporary files and cleanup. Three diagnostic tests pass; artifact no longer claims exact prompt provenance. |
| P4-01 | Worker singleton guard only logged; duplicate starts/notifications could repeat callbacks. | Startup promise and per-snapshot in-flight set; regression pass. |
| P4-02 | Cached/polled rankings bypassed source validation; absent generated ranking left a live run stuck pending. | Source revalidation and terminal failure; regression pass. |
| P4-03 | blocks_ready depended on worker-only publication; tracked baseline has no matching DB trigger. | One notification from committed atomic completion; rollback and duplicate-completion tests. Live schema not inspected. |
| P4-04 | Strategy creation failures were swallowed; empty model text became success; a second date filter removed valid multi-day events. | Propagated failure, trimmed nonempty output and canonical event filter. Stage4 + time helpers: 13 suites/636 tests. |
| P5-01 | Failed Routes cells and failed enrichment became zero-distance/time venues. | Failed/missing/duplicate route cells remain unusable, unknown UI metrics remain unknown. Stage5 11 suites/118 tests; UI regressions pass. |
| P5-02 | Enrichment re-resolved an already identified place; catalog matching could overwrite a different place ID. | One verified identity through planner/enrichment/routing. Colocated provider IDs use separate rows; nonunique-coordinate lookup migration authored and verified in isolated SQL; provider-ID uniqueness retained. The current workspace ledger records the migration; production rollout remains unverified. |
| P5-03 | Planner timeout signal unused; invalid/closed/unidentified/out-of-radius candidates could publish. | Timeout signal and deterministic candidate gates enforced; Stage5 pass. |
| P5-04 | Event matching dropped dates; an unpopulated verification pass never ran. | Date-bearing matched evidence survives saved output; ineffective verifier removed. Stage5 pass. |
| P6-01 | Coach misread wind shapes/units and accepted caller timezone over stored location. | Stored-zone priority, normalized measurements/zeros and malformed request checks. Coach backend 11 suites/195 tests plus Gemini token 3 tests pass. |
| P6-02 | Voice capture could flush old-session text using a newer account token/snapshot; canceled turns could continue into actions/learning. | Captured identity fences voice, mic, TTS and actions/learning cancellation; Coach client 8 suites/51 tests pass. |
| H-01 | Public Concierge duplicated environment parsing and had token/GPS/chat late-response races. | Shared validated measurements, separate public circuit and lifecycle fences; backend 3 suites/34 tests, client 2 suites/5 tests. |
| H-02 | Concierge saved model events with invented times/dates, no canonical validation, and model coordinates. | Google-confirmed identity plus canonical event validation and awaited shared writes; 13 service regressions pass. |
| H-03 | Feedback retry cache crossed owners, lost durability and accepted foreign rankings/venues; counters could diverge from actions. | Owner-scoped durable primary-key receipt plus atomic counter, strict ranking/candidate ownership; 8 tests pass in both PGlite and disposable actual PostgreSQL, including six simultaneous retries. |
| H-04 | SSE handshakes ran before LISTEN registration; partial setup leaked listeners; phase stream broadcast foreign snapshots. | Unified lifecycle verifies owner, subscribes before read, releases partial setup, revalidates session, recovers state on DB-only reconnect and wakes after an overlapping failed read. Server 11 tests pass in integrated baseline. |
| H-05 | Client stream cleanup could close a new session's subscription; changed tokens reused old streams; one callback error blocked other subscribers. | Token-bound instances and individually releasable callback wrappers; client 5 tests pass. |
| H-06 | DB LISTEN/UNLISTEN, failed setup, reconnect and shutdown races; initial/reconnect TLS settings diverge. | Connection generation and serialized subscription reconciliation, shutdown fences, shared checked TLS configuration. Controlled lifecycle/TLS tests pass; final idle teardown + SSE follow-through 36 tests pass (todo28). No remote TLS handshake claimed. |
| H-07 | Mounted legacy tactical-plan endpoint reads model .text instead of .output and fabricates fallback coordinate zones. | Unused generator retired; authenticated endpoint returns explicit 410. Regression passes; no model calls or fabricated coordinates. |
| C-01 | Continuity definitions 7/13 and location/model preflight retain obsolete provider, pinned-prompt and precision claims. | Canonical source trace, location/snapshot/SSE/venue/Coach/auth/preferences/independent docs and preflight cards rewritten; obsolete catalogs consolidated/deleted with removal ledgers. Live definitions #7 and #13 corrected through the existing SDK MCP surface; successful results inspected. |
| H-08 | Worker error+exit schedules duplicate restart; delayed timer can spawn after shutdown. | One per-worker lifecycle, bounded restart and stale-child/shutdown guards; supervisor regressions pass. |
| H-09 | Bars cache timestamp can be refreshed by unrelated MAIN writes, stale provider hours treated as fresh; zero countdown/unknown price/crowd misrepresented. | Timestamped provider observations, explicit failures, shared query/cancellation, one discovery writer and truthful UI. Backend 34 + client 6 tests pass. |
| H-10 | Address validation treats provider failure as validated; translation/welcome accept blank or malformed success and late canceled responses. | Real verdict/measurement validation, explicit skipped/failure and cancellation; horizontal 6 suites/76 tests, Welcome client 3 tests pass. |
| H-11 | Coach memo export can duplicate across workers or lose a retry after filesystem/DB partial completion. | Per-row export receipts and transactional lock; 5 mocked regressions pass. No private memo export executed. |
| H-12 | Dormant event-sync implementation can initialize a second unverified event writer if manually launched. | No runtime caller found; module/CLI now fail explicitly before DB/provider/timer initialization. Retirement 11 tests pass. |
| E-01 | Shared event overlap SELECT/INSERT can race; union update can shrink a concurrent extension; same-day distinct shows collide. | Per-venue transaction lock, atomic union and conservative exact schedule matching; source variants survive pre-storage dedup and hashing. Event-writer 8 suites/127 tests pass. |
| E-02 | Automatic rediscovery revives driver removals; cleanup can expire concurrently extended events or clear venue tagging after insert. | Explicit moderation preserved, observed-row cleanup CAS, shared per-venue lock and insert/tag transaction. Same event-writer receipt. |
| E-03 | Coach inserts invent an end time/date and stamp validation without validating; public writer has inconsistent event identity. | Canonical normalization/validation and verified venue/timezone, unknown attendance/time preserved and shared writer. Same event-writer receipt. |
| UI-01 | Completed Briefing cards remain hidden while an unrelated required section is pending. | Per-section loading flags; regression through real provider/page/cards passes. Holiday still participates in completion polling. |
| UI-02 | Browser/map re-filters venue-local dates using snapshot day; map excludes zero coordinates, retains stale popup schedule and removes markers on GPS updates. | Shared absolute-time projection, full valid coordinate check, schedule-aware marker update and mount-scoped map initialization; actual page→map propagation, disputed end-time handling and Google DOM marker contract verified; map/client 4 suites/23 tests pass. |
| H-14 | Event category timeout abandoned an already-started model request; verified venue resolution omitted cancellation. | Promise-factory deadline, model/Places/geocode signals, late-result/persistence guards and truthful driver-day prompt. Affected 3 suites/37 tests pass. |
| H-15 | Optional venue Details backfills rejected valid non-ChIJ IDs and duplicated unbounded detached calls. | Opaque verified identities, per-identity in-flight sharing through persistence, bounded fetch/body parsing and retry-safe cleanup. Catalog 20 suites/194 plus expanded lifecycle7 pass (overlap). |
| H-13 | Active-events hook can dispatch an old 401 against a new login; MAIN news collector admits invalid/future dates and uses an older snapshot date for a fresh search. | Captured token/signal fences at both awaits; shared strict news freshness at collection and actual Strategist prompt, current snapshot-zone search day. Backend 6 suites/102 and hook 2 suites/14 tests pass. |

Counts above are bounded lane receipts and overlap; do not add them as a distinct
suite/test total. Integrated verification is recorded below. Tests use mocked
providers; no new Google feature has been activated by this review.

## Evidence boundaries

The supplied Google API console list is a useful inventory of reported services and
traffic. It does not by itself prove runtime credentials, enabled methods, field
contracts, quota or current availability. API contract decisions use official Google
documentation and the actual request/response code. No model pins or cloud resources
are changed merely because they appear in that list.

Current verification uses synthetic inputs, mocked network/provider boundaries and
isolated database fixtures. No application gateway, migration or deployment is implied.
Real-device, live-provider and production observations will be explicitly distinguished.

## Integrated verification checkpoints

The first full default unit pass found stale test doubles and test timing assumptions
alongside newly added RED regressions; these were corrected against actual source
contracts. A later run completed 120 suites / 2,069 tests: 118 suites and 2,068 tests
passed. The remaining failures were the catalog repair race test loaded before its
fix and an outdated Coach validator mock. This is an intermediate receipt, not a
claim that the final tree is green. Final checks follow source freeze.

Rollout limits remain explicit: the new admission and colocated-venue migrations
have not been applied to the application database during this review; live Google
responses, remote TLS and real-device driving/voice have not been tested here.
The existing gateway/worker processes were observed but not started or deployed by
this review. A source test pass does not change the running application's state.

### Combined source pass

- Default backend suite: **123 suites / 2,112 tests passed** (73 seconds).
- Client suite: **41 suites / 310 tests passed**.
- Additional client harnesses: **11 suites / 132 tests passed**. This includes the Airport harness also present in the client suite; totals must not be added as distinct tests.
- Full ESLint, `tsc -b`, and `git diff --check` passed.
- Client production build passed into an isolated `/tmp` directory; the existing large-chunk warning remains. No served build was replaced.
- Built browser smoke: public sign-in form rendered and accepted synthetic input, no uncaught page errors. API/provider requests were blocked; no login was submitted. This is not authenticated pipeline or real-device coverage.
- Durable feedback: **8 actual PostgreSQL tests passed** earlier in this review.
- Shared event writer: **5 actual PostgreSQL tests passed**, using pooled connections and real advisory locks for simultaneous variants/span extensions, rollback and moderation. Temporary schemas were removed and the disposable local server stopped. Default suite continues using PGlite, which serializes its connection.

Test outputs are preserved in the existing private coordination area with a source
fingerprint at finalization. No credentials or private driver records belong in
this public audit. Final category cancellation, precise/country-scoped prompt and shared driver-day follow-through: **3 affected suites / 37 tests passed** after the combined run. Final idle LISTEN teardown and recovery: **2 suites / 36 tests passed**, also covered by the combined run.

## Remaining operational and architectural limits

- The colocated-venue migration must roll out with the matching new writers; old `ON CONFLICT(coord_key)` writers are incompatible with its nonunique coordinate index. The September 30 read-only workspace ledger check records all 54 migrations with no pending files or checksum drift. This review did not apply them and does not certify production schema parity.
- Cross-instance provider-cost deduplication remains separate from database publication correctness. Snapshot binding and Analyzer storage prevent duplicate authoritative rows; two processes can still pay for work before that arbitration. Existing todo56 remains open. Analyzer Phase2 is in-process and is not a durable restartable queue.
- Airport catalog expansion remains open (todo30). The false verified-empty claim is fixed; lack of coverage now remains unknown and cannot satisfy a required section.
- This review does not rewrite historical offer/event/venue rows into newly verified evidence. Distinct catalog identities at one physical site and duplicate reports across distinct/null identities need evidence-based reconciliation; different businesses must not be merged just because coordinates match.
- Live provider availability, remote TLS, production schema state and phone microphone/shortcut behavior need their own deployment/device receipts. Existing integration/E2E commands that start or seed a gateway were not run against the workspace database.
