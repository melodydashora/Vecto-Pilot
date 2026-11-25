# MAIN and independent pipeline trace

Source review updated November 24, 2026 against [`main` at `22210fa52`](https://github.com/melodydashora/Vecto-Pilot/tree/22210fa52e25335de2b7fefb70e6ef8424dbbae9). The [September 29 review](audits/PIPELINE_REVIEW_2026-09-29.md) records the original trace. The [October workspace acceptance record](audits/PIPELINE_READINESS_2026-10-04.md#october-5-live-workspace-acceptance-and-remaining-findings) identifies the paths exercised with a browser, database and providers. The November review follows the committed source.

| Driver task | Starting point | Result |
|---|---|---|
| Review conditions before a shift (Market Briefing) | MAIN prepares a location snapshot and runs Briefing for that observation. | The driver can read sections as they arrive. Strategy requires all seven to finish successfully. |
| Decide where to stage (Shift Strategy Planner) | The driver starts Strategy with prepared context and saved settings. | The Strategist produces guidance. VenuePlanner proposes candidates for place and route verification. |
| Evaluate an incoming offer (Offer Analyzer) | The driver supplies a capture through the browser or a configured phone shortcut. | The driver gets a quick verdict or a **NO DATA** response under the applicable rules. Eligible captures continue to history. [Offer Analyzer](OFFER_ANALYZER.md) |
| Review a shift or adjust a rule (Coach) | The driver opens Coach or asks a typed or spoken question. | Coach can discuss recent offers and recorded outcomes and can update supported Offer Analyzer settings on request. [Coach](RIDESHARE_COACH.md) |

## Ordered waterfall

### Prepare market context

```mermaid
flowchart TD
  A["Read signed-in session and saved setup"] --> B{"State of this session's context?"}
  B -->|Saved| R["Read saved snapshot and Briefing"]
  B -->|Pending| W["Follow saved progress"]
  B -->|Missing| D["Capture precise GPS"]
  B -->|Failed or interrupted| X["Show cause and available sections"]
  D --> E["Resolve address, timezone, market, weather and air"]
  E --> F["Save snapshot and collect seven Briefing sections"]
  F --> H{"Briefing status?"}
  R --> H
  W --> H
  H -->|Pending| W
  H -->|Failed| X
  H -->|Complete| Q["Read back the prepared context"]
```

### Start Strategy and rank venues

| Driver action | What the app does |
|---|---|
| Open the app or return to the page | Restores current context, follows pending work, or prepares the first snapshot and Briefing. Once ready, the context is available for an explicit Strategy start. |
| Choose **Continue** or **Refresh** on the Strategy page | Uses the prepared context. The same action confirms valid saved settings and requests admission. Outstanding edits, saves, or incomplete context hold the request. [Strategy page](../../client/src/pages/co-pilot/StrategyPage.tsx) |
| Choose **Refresh** in the global header | Requests fresh GPS and Briefing. After a successful refresh, previously confirmed settings allow the same click to request Strategy for the returned snapshot. Otherwise it stops with the refreshed context. [Header](../../client/src/components/GlobalHeader.tsx) |

```mermaid
flowchart TD
  A["Explicit Strategy request"] --> B{"Source, Briefing and settings current?"}
  B -->|No| X["Hold request for setup or context"]
  B -->|Yes| C["Pin settings and copy the source snapshot and Briefing"]
  C --> P["Start generation for the admitted run"]
  P --> D["Strategist produces Strategy"]
  D --> E["VenuePlanner proposes candidates"]
  E --> F["Verify Places identities and measure Routes"]
  F --> G["Save ranking and candidates together"]
  G --> H["Display eligible recommendations"]
```

Server-sent events prompt the client to read saved state. While work is pending, saved progress extends the five-minute inactivity window. The [role registry](../../server/lib/ai/model-registry.js) and [adapter guide](AI_MODEL_ADAPTERS.md) identify the active model roles and provider settings.

<a id="1-session-and-preferences--admitted-run"></a>

### 1. Session and saved settings

- [auth-context.tsx](../../client/src/contexts/auth-context.tsx) owns authenticated identity and cross-tab token changes. New identity clears account caches and subscriptions before loading the profile. [session-policy.js](../../server/lib/auth/session-policy.js), [auth middleware](../../server/middleware/auth.js), and [auth routes](../../server/api/auth/auth.js) enforce stored session lifetime and credential changes.
- [run-setup-context.tsx](../../client/src/contexts/run-setup-context.tsx) loads canonical setup and saved same-session context. An explicit Strategy start uses valid saved preferences and rules without another routine confirmation. [SettingsPage.tsx](../../client/src/pages/co-pilot/SettingsPage.tsx) and user-directed Coach changes save through canonical writers. A committed change retires the prior admission before readback, preserves unsaved drafts and holds admission if readback fails. [RunSetupSummary.tsx](../../client/src/components/co-pilot/RunSetupSummary.tsx) remains available for explicit review or resolving missing/dirty setup. Saving settings does not itself start Strategy.
- [main-runs.js](../../server/api/strategy/main-runs.js) exposes setup and explicit Continue. When Strategy starts, [main-run-admission.js](../../server/lib/main-run-admission.js) locks the current driver/session, reads canonical profile, one active primary vehicle and a valid ruleset, and verifies expected settings revision, rules version/hash, current run, prepared snapshot and request identity.
- The admitted row pins relevant profile/service/vehicle fields and effective rules into `main_run_admissions.configuration`, plus the prepared snapshot/Briefing source receipt; `users.current_main_run_id` selects the active intent. Repeated request identities replay their original receipt; changed settings, source identity or a different current run conflict. A canceled client request cannot make a late response the current client run.
- If an admission response is lost, its retry keeps the original request ID and complete expected-revision/run/snapshot body, even when canonical readback reveals the admitted snapshot clone. An edit or changed configuration/source abandons that retry; success consumes it so a later explicit Refresh creates a new intent. A replay with `current:false` reopens the held review instead of installing the old run.
- The pinned rules establish setup identity. [driver-preferences.js](../../server/lib/driver-preferences.js) projects only the authorized MAIN profile/vehicle context to Strategist/planner. It does not expose Offer Analyzer offer history, live verdicts, or introduce home-radius policy. Null selected services remain service-neutral; eligibility is not selection.

The additive [MAIN admission migration](../../migrations/20260929_main_run_admissions.sql) is required by these sources. A source/test pass does not mean it has been applied to the supplied database.

<a id="2-admitted-run--gps--snapshot"></a>

### 2. GPS preparation and explicit Strategy admission

[location-context-clean.tsx](../../client/src/contexts/location-context-clean.tsx) captures browser GPS after canonical setup confirms there is no saved or pending context, including while required preference setup remains incomplete. Same-session saved context is restored through reads; active Briefing continues through saved progress without creating another capture. Interrupted capture or failed context displays its cause and preserves received data. A fresh GPS observation uses the separate explicit existing header action. [coordinates.js](../../shared/coordinates.js) validates full coordinate values, observation age and reported accuracy. Six-decimal cache keys are lookup formats, not a measurement of GPS accuracy.

[main-run-snapshot.js](../../server/lib/location/main-run-snapshot.js) is the shared portal writer. The current browser posts fresh GPS and a UUID `captureId` to `/api/location/snapshot`. `captureUpstreamSnapshot` claims the live owner's current capture before providers, collects fresh Google address/timezone and environmental evidence, resolves a country/state-scoped market, validates the complete snapshot, then rechecks session/capture ownership under the driver settings lock before publication. Concurrent losers receive the saved winner's coordinates, GPS time and accuracy together. Compatibility `runId` callers retain the older strict admitted capture path; it does not gate current browser preparation.

[geocode.js](../../server/lib/location/geocode.js) and [resolveTimezone.js](../../server/lib/location/resolveTimezone.js) separate coordinate-derived IANA timezone from market identity. [snapshot-environment.js](../../server/lib/location/snapshot-environment.js) supplies validated current weather/air evidence. [snapshot-readiness.js](../../server/lib/location/snapshot-readiness.js) checks the actual saved observation before downstream generation. Browser consumers use the returned snapshot receipt.

Environmental observation times must identify real instants with an explicit timezone offset. Date-only values, zoneless wall times and impossible calendar dates cannot satisfy freshness. Valid supplied offsets and fractional precision remain in the saved evidence; fetch time does not replace observation time. Google's [Air Quality response contract](https://developers.google.com/maps/documentation/air-quality/reference/rest/v1/currentConditions/lookup) specifies a timestamp with up to nine fractional digits.

The client next posts `{snapshotId}` to `/api/location/news-briefing`, which validates owned current upstream context and runs the shared Briefing aggregator. A final setup GET must confirm ready snapshot/Briefing and matching source/session before the context is eligible for Strategy. Strategy Continue/Refresh sends `expectedSnapshotId` to `/api/main-runs/continue`; admission copies the complete snapshot and Briefing into a new downstream context while preserving original observation timestamps and generation token. It does not re-run GPS or Briefing.

During a pending or failed replacement, the driver can still view earlier guidance. Opening the page again restores the same session's saved context when available.

After a completed setup-read failure, explicit Strategy Continue/Refresh retries canonical setup before admission. Pending saves, unsaved edits and incomplete context remain held.

Exact same-source requests in one process share in-flight work. Across processes the database prevents duplicate rows for one capture (or one legacy admission); a distributed provider-call lease has not been implemented, so duplicate billing before publication remains possible. Old IP location is retired with `410 gps_required`.

### 3. Snapshot → complete Briefing

The current browser prepares upstream Briefing through `POST /api/location/news-briefing` in [location.js](../../server/api/location/location.js). [blocks-fast.js](../../server/api/strategy/blocks-fast.js) and the bounded [triad worker](../../server/jobs/triad-worker.js) retain guarded orchestration for admitted runs. [providers/briefing.js](../../server/lib/ai/providers/briefing.js) is a compatibility wrapper; [briefing-aggregator.js](../../server/lib/briefing/briefing-aggregator.js) owns generation.

The aggregator validates the persisted snapshot, claims one generation token under a transactional lock, and starts all seven sections concurrently. Existing pending work is joined with a bounded wait; an ordinary saved read cannot claim replacement generation. Each `discover*` wrapper adds generation-scoped persistence and notification to its raw fetcher. These are intentional layers, not duplicate calls.

| Section | Source and transformation | Saved field(s) |
|---|---|---|
| [Weather](../../server/lib/briefing/pipelines/weather.js) | Google current conditions + hourly forecast; typed units, actual timestamps, bounded transport | `weather_current`, `weather_forecast` |
| [Traffic](../../server/lib/briefing/pipelines/traffic.js) | TomTom incidents/flow and BRIEFING_TRAFFIC analysis; incident persistence where supported | `traffic_conditions` |
| [Events](../../server/lib/briefing/pipelines/events.js) | BRIEFING_EVENTS_DISCOVERY, Google venue resolution, canonical normalize/validate/hash/store/read pipeline | `events`; linked `venue_catalog`, `discovered_events` |
| [Airport](../../server/lib/briefing/pipelines/airport.js) | Seeded Google-derived identities within 50 miles; FAA conditions, conditional BRIEFING_AIRPORT conditions fallback, then terminal research using fixed conditions | `airport_conditions` |
| [News](../../server/lib/briefing/pipelines/news.js) | BRIEFING_NEWS discovery and source parsing | `news` |
| [Schools](../../server/lib/briefing/pipelines/schools.js) | District breaks and first student return days, evaluated on the snapshot’s local date using the [shared interval rules](../../shared/school-closures.js) | `school_closures` |
| [Holiday](../../server/lib/briefing/pipelines/holiday.js) | Holiday role returns a named result plus boolean, including an explicit none result | `holiday` |

[briefing-generation.js](../../server/lib/briefing/briefing-generation.js) fences writes to the current generation/admission. [briefing-readiness.js](../../server/lib/briefing/briefing-readiness.js) checks every required field plus final status and generation timestamp. Progressive notifications are useful to the UI, but Strategy waits until the whole row is saved `complete`. A malformed result, provider fallback marked failed, unexplained emptiness, failed save, or bounded wait expiry prevents Strategy.

Events now publishes verified progress within a section. Each complete category response enters the shared normalization, deduplication, venue resolution and schedule validation path. Its verified in-market results can be saved to Briefing as `{items, _pending: true}` before the other category finishes. Canonical event writes wait for both searches and the full combined deduplication pass; verification is reused instead of repeating provider lookups. Raw model fragments and unverified venue suggestions are never progressive cards. Later category failure retains those verified items with a failure marker; final assembly preserves that marked envelope. Catastrophic finalization preserves already saved sections rather than overwriting them with empty failure payloads. The owner waits for sibling sections to settle before declaring final failure; a failed required section still prevents Strategy throughout.

The Events role retains its pinned model, high reasoning, search grounding and complete-response validation with a 32,768-token output allowance. Each category has a 300-second deadline, supported by the role-specific router allowance. Airport shares one 300-second deadline across catalog, FAA and both research phases, with the same cancellation signal passed to both model calls; other roles keep their own budgets. Existing-generation joins and client polling use a 300-second inactivity bound extended by saved progress. Venue verification has a separate bounded per-candidate budget, so these settings are not a five-minute total Briefing deadline. Successful pending reads do not spend the client's transport-error budget. Same-source read interruptions retain received data; another token or snapshot cannot inherit that retained payload.

[briefing-event-priority.js](../../server/lib/events/briefing-event-priority.js) selects high- or medium-impact events within the established 15-mile straight-line nearby area first, then high-impact wider-market events. Missing impact evidence is not upgraded to medium, and venue capacity does not establish attendance or demand. This selection shapes Briefing context without deleting canonical events. The aggregate reader separates nearby items from major market items; the UI retains genre groups within each and shows nearby groups first. Verified cards remain visible alongside pending or failure notices, including through View Briefing in the inline status notice. The UI adds no Refresh Briefing function and partial visibility never admits Strategy.

Under Melody's October 12 direction, Briefing failure no longer replaces the app with a blocking screen. [BriefingStatusNotice](../../client/src/components/briefing/BriefingStatusNotice.tsx) appears below the header: confirmed pending work gets a slow-work notice after 45 seconds, terminal failure shows its recorded cause without claiming continued research, and exhausted reads report that updates could not be confirmed. View Briefing, Open Coach, preferences, navigation and the existing sign-out control remain available. Only authentication failure retains the blocking session screen. Strategy still requires complete canonical context; these controls do not restart MAIN capture or generation. Opening Coach retains its separate observation lifecycle.

An empty seeded airport query establishes unknown coverage, not proof that no airport exists. It therefore cannot masquerade as a successful airport section. Positive catalog coverage outside the seeded areas remains an explicit limit.

On October 5, Melody clarified the Airport sequence: one source supplies each airport's operating conditions, then terminal research consumes that result. The existing `BRIEFING_AIRPORT` role remains pinned in the registry. The FAA adapter reads the current NAS website's `/api/airport-events` feed and shares one in-flight national request across US-airport lookups. FAA conditions are used when available; only airports without usable observations enter a Gemini conditions-search fallback. Absence from the disruption feed is not proof of normal operations. A separate Gemini pass researches terminals, TSA, arrivals activity and pickup guidance using fixed conditions. Its returned status/advisory fields are ignored, preventing the second pass from replacing the chosen source. `conditionsSource` records `faa` or `gemini-search`; raw FAA observations and source/fetch times remain distinct. Failed or incomplete conditions fallback or terminal research still blocks Strategy. This change does not activate Strategy or bypass whole-Briefing readiness.

[briefing routes](../../server/api/briefing/briefing.js) are saved readers except explicitly named realtime utilities. `/snapshot/:snapshotId` exposes progressive pending/failed/usable states. Section readers do not restart stalled generation. Legacy `/current` and POST `/generate` read existing complete data; the latter's historical name does not make it a generator. [useBriefingQueries.ts](../../client/src/hooks/useBriefingQueries.ts) polls all seven sections and rejects old-session/old-snapshot responses before cache or logout/reset effects.

[market-event-reader.js](../../server/lib/events/market-event-reader.js) is the shared country/market-scoped database reader for MAIN collection, aggregate augmentation, compatibility events and moderation. It retains ongoing multi-day events, cross-state metro mappings and verified venue-local instants, then compares absolute intervals against the snapshot display days. Unresolved timing and failed market reads remain visible as partial/unavailable coverage. The UI projects those instants into its selected timezone for both cards and map popups. [event-read-reconciliation.js](../../server/lib/events/event-read-reconciliation.js) groups equivalent reports without discarding conflicting end-time evidence.

The ignored `sent-to-strategist.txt` artifact is a snapshot-scoped saved-row diagnostic, **not an exact provider prompt**. [dump-last-briefing.js](../../server/lib/briefing/dump-last-briefing.js) writes a private temporary file and atomically replaces the artifact. Its content declares separately read rows and may show a still-pending Strategy.

### 4. Complete Briefing → Strategist

The browser makes two requests. `POST /api/main-runs/continue` admits the run and returns its identifiers. When `vecto-strategy-started` matches the active run and snapshot, the client sends `POST /api/blocks-fast` to start generation. Polling and server-sent events use `GET /api/blocks/strategy/:snapshotId` to read saved progress. [Admission route](../../server/api/strategy/main-runs.js) · [Client orchestration](../../client/src/contexts/co-pilot-context.tsx)

[consolidator.js](../../server/lib/ai/providers/consolidator.js), `runImmediateStrategy`, re-reads the saved snapshot and complete Briefing, verifies the current admission, and claims the Briefing source generation before dispatching `STRATEGY_TACTICAL`. It formats fresh events/news, environmental/traffic/airport/school/holiday context and the pinned driver profile/vehicle context. News/event timing uses explicit calendar and timezone rules; malformed times do not become all-day events.

[strategy-source-store.js](../../server/lib/strategy/strategy-source-store.js) fences claim/publication by snapshot and Briefing generation. Empty model text is failure. A late result cannot replace a newer source. `strategies.strategy_for_now` and its source receipt must agree with the currently complete Briefing before venue planning or cached reuse.

### 5. Strategy + preferences → venue recommendations

The [venue trace](VENUES.md) covers [tactical-planner.js](../../server/lib/strategy/tactical-planner.js), [enhanced-smart-blocks.js](../../server/lib/venue/enhanced-smart-blocks.js), Places resolution, Routes, event evidence, persistence and display in detail.

The planner receives saved Strategy, filtered Briefing and admitted driver context. An already verified Google place keeps that identity during enrichment; saved recommendations do not run another paid address lookup. Unknown/closed/unidentified/out-of-radius candidates and failed route cells cannot become zero-minute recommendations. The established recommendation radius remains 15 miles; no Offer Analyzer-driven home radius or avoidance policy was added here.

Rankings and candidates publish only under the current source/admission checks. [strategy-utils.js](../../server/lib/strategy/strategy-utils.js) sends one `blocks_ready` notification from the atomic completion transaction. The saved Strategy reader rechecks source identity. A separate `GET /api/blocks-fast?snapshotId=…` can generate missing venues once its prerequisites pass. [Blocks route](../../server/api/strategy/blocks-fast.js) Missing ranking after a purported generation completes is a terminal failure, not perpetual pending.

The initial Strategy shortlist shows up to three eligible Grade A/B venues and prefers one-mile spacing. A completed ranking containing only Grade C venues therefore displays zero shortlist cards. When the driver has confirmed changes to the shortlist, the page uses the saved feedback order. [Strategy page](../../client/src/pages/co-pilot/StrategyPage.tsx) · [Shortlist filter](../../client/src/utils/co-pilot-helpers.ts)

The unrendered legacy `/api/strategy/tactical-plan` generator is retired with 410. It accepted model coordinates and fabricated geometric fallback zones; it is not the venue planner described above.

## Independent pipelines and shared infrastructure

<a id="6-saved-context--coach"></a>

### Coach observations, history and settings

Opening Coach attempts a fresh GPS observation for the signed-in driver. `coachSnapshotId` identifies Coach’s own session-scoped location, time, weather and air data. A separate `snapshotId` identifies the original source of saved Briefing and Strategy guidance. Coach can discuss available sections before Strategy starts or after a Briefing failure. Refreshing Coach’s observation leaves the MAIN run and its source intact. [Coach page](../../client/src/pages/co-pilot/CoachPage.tsx) · [Observation storage](../../server/lib/location/coach-snapshot.js)

Typed and spoken questions can use the driver’s recent Offer Analyzer records and separately reported outcomes. A driver-directed settings change checks the driver’s current rules version and hash before writing. A successful write returns a receipt. Prior verdicts and outcomes retain their original values. Offer Analyzer handles the next live offer. [Coach contract](RIDESHARE_COACH.md) · [Chat handler](../../server/api/chat/chat.js)

Recent session history uses each saved snapshot’s own timezone and observation instant. The offset and UTC timestamp distinguish repeated wall times when daylight saving time ends. Missing or invalid zones remain unknown.

### Independent entry points

| Path | Active entry and relationship to MAIN |
|---|---|
| Offer Analyzer | The [capture hook](../../server/api/hooks/analyze-offer.js) accepts an image or text, applies the applicable rules and returns the Phase 1 decision and wording for speech. Eligible Phase 2 enrichment runs in the same process after the response, so a restart can prevent the history row from being saved. The [outcome API](../../server/api/offer-analyzer/index.js) separately records what the driver actually did. MAIN uses the rules revision for setup and does not consume live verdicts. [Full trace](OFFER_ANALYZER.md) |
| Coach | [Coach’s own observation, saved context and settings actions](#coach-observations-history-and-settings) are available independently of Strategy admission. |
| Bars/Lounges | [nearby venues](../../server/api/venue/venue-intelligence.js) and [venue intelligence](../../server/lib/venue/venue-intelligence.js), consumed through [useBarsQuery.ts](../../client/src/hooks/useBarsQuery.ts). Independent discovery, shared verified place catalog; no MAIN completion claim. See [venues](VENUES.md). |
| Public Concierge | [public route](../../server/api/concierge/concierge.js), [service](../../server/lib/concierge/concierge-service.js), [page](../../client/src/pages/concierge/PublicConciergePage.tsx). Anonymous token/GPS lifecycle; separate circuit and canonical verified shared venue/event writes. [Guide](MOBILE_CONCIERGE_2026-09-11.md). |
| Translation | [shortcut translation](../../server/api/hooks/translate.js) and [translation prompt](../../server/api/translate/translation-prompt.js); independent provider result, no Briefing generation. |
| Welcome | [welcome-ai route](../../server/api/welcome-ai/welcome-ai.js), mounted separately from authenticated MAIN. |
| Feedback | [actions.js](../../server/api/feedback/actions.js) verifies ranking/candidate ownership and stores one owner-scoped durable receipt. Action insert and venue counters commit together; repeated key/different payload conflicts. |
| Background worker | [workers.js](../../server/bootstrap/workers.js) requires explicit capability enablement, respects autoscale exclusion, and has one bounded process/restart/shutdown lifecycle. [triad-worker.js](../../server/jobs/triad-worker.js) shares MAIN generation guards. |
| Manual maintenance | Airport seed/maintenance commands and [Coach memo export](../../scripts/pull-coach-memos.mjs) are explicit commands, not automatic MAIN stages. Dormant event-sync entrypoints now fail explicitly before starting any work. Never start the gateway just to inspect them: startup can run migrations. |

[SSE architecture](SSE.md) links server registration/recovery, shared LISTEN lifetime and client ownership. [strategy-events.js](../../server/api/strategy/strategy-events.js) verifies ownership, subscribes before reading initial state, and releases partial or closed setup. Phase events are snapshot-scoped. Client cleanup is tied to the subscription instance and auth token.

[DB runtime guide](../../server/db/README.md) documents one `DATABASE_URL`, checked TLS options, LISTEN reconnect/subscription restoration and shutdown. A lost connection cannot prove that a write rolled back; generic pool operations do not transparently replay queries.

[Google API inventory](google-cloud-apis.md) distinguishes actual call sites from enabled/reported console services and potential future uses. This review corrected existing API contracts; it did not enable unrelated cloud products or add paid calls solely because an API appeared in the console list.

## Verification and recovery

The September [review register](audits/PIPELINE_REVIEW_2026-09-29.md) and [removal ledger](removals/2026-09-29-pipeline-review.md) preserve original checks and recovery references. In one October workspace run, all seven Briefing sections completed and six route-measured candidates were saved. All six received Grade C, so the driver saw “Recommendations ready” with zero shortlist cards. Physical-phone capture and production acceptance remained open in that record. [October workspace results](audits/PIPELINE_READINESS_2026-10-04.md#october-5-live-workspace-acceptance-and-remaining-findings)

The November 24 review checked source paths, entry points and handoffs. Live provider availability, production state and device behavior require their own acceptance results.
