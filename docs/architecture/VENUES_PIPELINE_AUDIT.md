# Venue Pipeline: Line-Numbered E2E Audit

## 0. Canonical architecture

| File | Lines | Function / area | Status | Audit note |
|---|---:|---|---|---|
| `docs/architecture/VENUES.md` | `L1-L24` | canonical venue architecture doc | canonical doc | Names this doc as the canonical reference for venue discovery, scoring, ranking, Google Places integration, UI behavior, current gaps, and hardening work. |
| `server/lib/venue/README.md` | `L1-L54` | venue architecture source-of-truth design | canonical doctrine | States `venue_catalog` is the single source of truth for venue data; `discovered_events` carries event metadata and links by FK, but does not own coordinates. |
| `server/lib/venue/README.md` | `L188-L235` | two venue systems | important separation | Distinguishes the Strategy-tab VENUES pipeline from Bar Tab discovery. Do not merge these mentally unless product explicitly decides to unify them. |
| `docs/architecture/VENUES.md` | `L28-L68` | Smart Blocks pipeline diagram | canonical flow | Defines the e2e flow: `generateEnhancedSmartBlocks` → `VENUE_SCORER` → `enrichVenues` → `matchVenuesToEvents` → `verifyVenueEventsBatch` → `promoteToVenueCatalog` → rankings/candidates. |

## 1. Route trigger / waterfall entrypoint

| File | Lines | Function / call | Status | Audit note |
|---|---:|---|---|---|
| `server/api/strategy/blocks-fast.js` | `L1-L31` | file header / pipeline | active | Declares `/api/blocks-fast` as the fast tactical path and lists the waterfall: briefing → strategy → VENUE_SCORER → Google APIs → VENUE_EVENT_VERIFIER. |
| `blocks-fast.js` | `L42-L50` | imports `runBriefing`, `runImmediateStrategy`, `generateEnhancedSmartBlocks` | active | This is the orchestration bridge from briefing/strategy into venue generation. |
| `blocks-fast.js` | `L139-L248` | `ensureSmartBlocksExist()` | active | Single helper replacing duplicate generation call sites; checks existing rankings, locks/claims generation, fetches strategy/briefing/snapshot. |
| `blocks-fast.js` | `L249-L282` | call `generateEnhancedSmartBlocks(...)` | active | Calls venue generation outside the short advisory-lock transaction. Passes `strategy_for_now`, briefing row, snapshot, `user_id`, and phase emitter. |
| `blocks-fast.js` | `L302-L359` | `mapCandidatesToBlocks()` | active | Converts `ranking_candidates` rows to API blocks through the canonical transformer after resolving addresses. |
| `blocks-fast.js` | `L365-L386` | `filterAndSortBlocks()` | active | Final API-side venue filtering: max 25 miles, sort by `valuePerMin DESC`, then distance ascending. |

## 2. Smart Blocks orchestrator

| File | Lines | Function / call | Status | Audit note |
|---|---:|---|---|---|
| `server/lib/venue/enhanced-smart-blocks.js` | `L1-L20` | file header / pipeline | active | Declares the main VENUES pipeline: input strategy/briefing/snapshot, VENUE_SCORER, Routes, Places, catalog promotion, rankings/candidates. |
| `enhanced-smart-blocks.js` | `L22-L31` | imports `rankings`, `ranking_candidates`, `discovered_events`, `venue_catalog`, `strategies` | active | Pulls all persistence tables required by Smart Blocks, event context, catalog promotion, and cache metrics. |
| `enhanced-smart-blocks.js` | `L33-L72` | `isEventTimeRelevant()` | active event badge filter | Filters matched venue events for badge display: starts within next 2h or started within last 4h. |
| `enhanced-smart-blocks.js` | `L75-L88` | imports planner/enrichment/verifier/matcher/cache | active | Pulls `generateTacticalPlan`, `enrichVenues`, `verifyVenueEventsBatch`, `matchVenuesToEvents`, `upsertVenue`, and `isPlannerGradeVenue`. |
| `enhanced-smart-blocks.js` | `L91-L121` | `haversineMiles()` | active helper | Distance annotator used for event context / NEAR-FAR bucketing. |
| `enhanced-smart-blocks.js` | `L128-L293` | `fetchTodayDiscoveredEventsWithVenue()` | active event-context source | Fetches today’s active `discovered_events`, joins `venue_catalog`, gates planner-grade venues, annotates distance, sorts closest-first. This is event-context input to the venue pipeline, not a separate venue generator. |
| `enhanced-smart-blocks.js` | `L305-L361` | `promoteToVenueCatalog()` | active catalog bridge | Promotes Google-verified Smart Blocks venues into `venue_catalog`; only promotes if `placeVerified`, `placeId`, and usable address exist. |
| `enhanced-smart-blocks.js` | `L379-L600` | `generateEnhancedSmartBlocks()` | active orchestrator | Main execution path: fetch events, filter briefing, call planner, enrich venues, match events, verify events, write ranking/candidates. |

## 3. Event-context intake inside VENUES

| File | Lines | Function / call | Status | Audit note |
|---|---:|---|---|---|
| `enhanced-smart-blocks.js` | `L128-L180` | function comments for `fetchTodayDiscoveredEventsWithVenue()` | active contract | States the helper replaces the old matcher DB query, fixes city-scoped event loss, and joins `venue_catalog` so prompt/matcher use canonical venue identity. |
| `enhanced-smart-blocks.js` | `L188-L236` | DB select and `discovered_events` ⋈ `venue_catalog` join | active | Selects event fields plus `vc_*` catalog fields, including `vc_place_id`, canonical address/city/state/coords/timezone. |
| `enhanced-smart-blocks.js` | `L237-L244` | active-today predicate | active | Uses multi-day inclusive predicate: `start <= today`, `end >= today`, and `is_active = true`. |
| `enhanced-smart-blocks.js` | `L257-L275` | planner-grade classification | active hardening | Buckets rows into `planner-ready`, `re-resolve-needed`, or `orphan` using `isPlannerGradeVenue()`. |
| `enhanced-smart-blocks.js` | `L277-L291` | distance annotation / metro-context filter | active | Keeps planner-ready events within 60-mile metro context, counts near ≤15mi vs far surge-intel events, and sorts closest-first. |

## 4. VENUE_SCORER tactical planner

| File | Lines | Function / call | Status | Audit note |
|---|---:|---|---|---|
| `server/lib/strategy/tactical-planner.js` | `L1-L31` | file header | active | States VENUE_SCORER now emits venue names/district/staging/tips; coordinates are resolved post-LLM via Google Places, not trusted from AI. |
| `tactical-planner.js` | `L34-L51` | imports `searchPlaceByText`, `lookupVenue`, driver preference helpers | active | Pulls post-LLM Places resolver and catalog cache; imports driver preferences. |
| `tactical-planner.js` | `L55-L78` | `VenueRecommendationSchema`, `GPT5ResponseSchema` | active schema | LLM response schema excludes lat/lng and requires venue name, staging name, district, category, tips, timing. |
| `tactical-planner.js` | `L83-L169` | `resolveVenueWithCache()` | active catalog-first resolver | Checks `venue_catalog` before paid Places API; only calls Places on cache miss or closed/stale-like status. |
| `tactical-planner.js` | `L181-L213` | `generateTacticalPlan()` setup | active | Requires strategy and snapshot; initializes cache metrics; loads driver preferences. |
| `tactical-planner.js` | `L236-L335` | developer prompt | active prompt contract | Hard-codes the 15-mile rule, no AI coordinates, venue names only, events as NEAR candidate or FAR surge-flow intelligence. |
| `tactical-planner.js` | `L337-L393` | user prompt / event-intel instructions | active prompt contract | Tells model events are intelligence, not a venue list; all recommendations must be within 15 miles; near events may be direct candidates; far events are not destinations. |
| `tactical-planner.js` | `L395-L433` | event debug logging | active telemetry | Logs near/far/unbucketed event counts and samples reaching VENUE_SCORER. |
| `tactical-planner.js` | `L435-L482` | `callModel('VENUE_SCORER')`, parse, validate | active AI call | Dispatches VENUE_SCORER, parses JSON, validates schema. |
| `tactical-planner.js` | `L484-L560` | post-LLM venue resolution loop | active resolution chain | Resolves each LLM venue name through catalog-first cache / Places text search / fallback chain; attaches Google lat/lng/place identity. |

## 5. Google enrichment: Places, Routes, hours, closure

| File | Lines | Function / call | Status | Audit note |
|---|---:|---|---|---|
| `server/lib/venue/venue-enrichment.js` | `L1-L15` | file header | active | Separates AI reasoning from factual lookup: Places API, Routes API, address/business status. |
| `venue-enrichment.js` | `L45-L244` | `enrichVenues()` | active | Enriches planner venues with batch Route Matrix, address resolution, Places details, hours/open status, route distance, and filters permanently closed venues. |
| `venue-enrichment.js` | `L74-L112` | batch Routes Matrix | active | Uses `getRouteMatrix()` for all candidate destinations, then falls back to individual route calls if batch fails. |
| `venue-enrichment.js` | `L115-L126` | `resolveVenueAddressesBatch()` | active | Batch address resolver reduces per-venue geocoding calls. |
| `venue-enrichment.js` | `L144-L158` | `getPlaceDetailsWithFallback(...)` | active | Uses coordinate search with district/text fallback to verify venue identity. |
| `venue-enrichment.js` | `L170-L173` | permanently closed filter | active safety | Drops `CLOSED_PERMANENTLY` venues before recommendation persistence. |
| `venue-enrichment.js` | `L184-L215` | enriched venue object | active output shape | Adds `placeId`, `businessStatus`, `isOpen`, `businessHours`, route metrics, Street View URL, verification flag. |
| `venue-enrichment.js` | `L333-L466` | `getPlaceDetails()` | active Places Nearby/cache path | Uses memory cache, DB cache, Places SearchNearby, canonical hours parsing, retries, and `places_cache`. |
| `venue-enrichment.js` | `L541-L632` | `searchPlaceByText()` | active fallback | Text-search fallback using `venue name + district + city + state`, returns place ID, address, hours, Google coords. |
| `venue-enrichment.js` | `L642-L686` | `getPlaceDetailsWithFallback()` | active | Coordinate search first; if name similarity is low, try text search; mark unverified if both fail. |

## 6. Venue address resolver

| File | Lines | Function / call | Status | Audit note |
|---|---:|---|---|---|
| `server/lib/venue/venue-address-resolver.js` | `L1-L55` | module setup / API config | active | Batch geocoding and address resolution layer for venue addresses. |
| `venue-address-resolver.js` | `L80-L145` | `resolveVenueAddress()` | active | Resolves a venue coordinate/name into address and optionally upserts stub `venue_catalog` rows. |
| `venue-address-resolver.js` | `L154-L184` | `resolveVenueAddressesBatch()` | active | Resolves multiple venue addresses in chunks of 5. |
| `venue-address-resolver.js` | `L194-L257` | `searchPlaceWithTextSearch()` | active shared Places text search | Used by event venue resolution and cached venue re-resolution; supports 50m precise lookup or 50km event-discovery bias. |

## 7. Venue catalog/cache

| File | Lines | Function / call | Status | Audit note |
|---|---:|---|---|---|
| `server/lib/venue/venue-cache.js` | `L1-L28` | imports/schema/logger/validators | active | Venue cache owns CRUD against `venue_catalog`; imports `discovered_events` for FK linking and address validation/re-resolution. |
| `venue-cache.js` | `L35-L59` | `isPlannerGradeVenue()` | active gate | Requires `place_id`, `formatted_address`, `city`, `state`, `lat`, `lng`, `timezone`. |
| `venue-cache.js` | `L72-L123` | `lookupVenue()` | active | Lookup order: exact `place_id`, normalized name + city/state, then coord key. |
| `venue-cache.js` | `L132-L172` | `lookupVenueFuzzy()` | fallback / duplicate-risk | State-only fuzzy match. Useful as fallback, but should not become primary truth because false-positive venue links are dangerous. |
| `venue-cache.js` | `L205-L338` | `insertVenue()` | active | Inserts into `venue_catalog`; uses `coord_key` conflict update and place-id collision fallback. |
| `venue-cache.js` | `L352-L430` | `upsertVenue()` | active | Best-write-wins merge: venue types merge, `is_bar` / `is_event_venue` OR logic, record status max logic. |
| `venue-cache.js` | `L454-L461` | `linkEventToVenue()` | active event bridge | Updates `discovered_events.venue_id` to link event metadata to canonical venue. |
| `venue-cache.js` | `L473-L492` | `getEventsForVenue()` | duplicate-read risk | Uses event start-date range only; should not replace Smart Blocks’ active-today joined event source without lifecycle alignment. |
| `venue-cache.js` | `L511-L632` | `findOrCreateVenue()` | active event-ingestion bridge | Used when events discover venues. Place-id first, coord key, fuzzy fallback, then insert; creates event venues in catalog. |
| `venue-cache.js` | `L650-L737` | `maybeReResolveAddress()` | active quality gate | Re-resolves bad cached venue addresses through Places (NEW) API and updates catalog if a better address is found. |

## 8. Event matching into venue candidates

| File | Lines | Function / call | Status | Audit note |
|---|---:|---|---|---|
| `server/lib/venue/event-matcher.js` | `L1-L37` | module header | active / already deduped | Header says the old internal DB query was removed; caller passes pre-fetched `todayEvents`. |
| `event-matcher.js` | `L65-L90` | `normalizeName()`, `venueNamesMatch()` | fallback helper | Name fallback only after strong identity keys. |
| `event-matcher.js` | `L104-L113` | `toEventMatch()` | active output shape | Converts event row to `venue_events[]` shape for ranking candidates. |
| `event-matcher.js` | `L138-L201` | `matchVenuesToEvents()` | active | Match order: `place_id` → `venue_id` → substantial name fallback. |
| `enhanced-smart-blocks.js` | `L480-L485` | call `matchVenuesToEvents(enrichedVenues, todayEvents)` | active | Same event set from `fetchTodayDiscoveredEventsWithVenue()` feeds matcher; no duplicate DB query. |

## 9. Venue event verifier

| File | Lines | Function / call | Status | Audit note |
|---|---:|---|---|---|
| `server/lib/venue/venue-event-verifier.js` | `L1-L9` | module header/imports | active | Uses `callModel` with `VENUE_EVENT_VERIFIER`; per-event logs demoted to debug. |
| `venue-event-verifier.js` | `L20-L66` | `verifyVenueEvent()` | active AI verifier | Verifies a venue event and assesses rideshare demand impact. |
| `venue-event-verifier.js` | `L78-L121` | `verifyVenueEventsBatch()` | active | Verifies event-bearing venues in chunks of 3. |
| `venue-event-verifier.js` | `L130-L154` | `extractVerifiedEvents()` | active | Keeps verified events with confidence ≥70 and high/medium impact. |

## 10. Rankings and candidate persistence

| File | Lines | Function / call | Status | Audit note |
|---|---:|---|---|---|
| `enhanced-smart-blocks.js` | `L502-L521` | insert `rankings` | active | Creates ranking session metadata; records model role and degraded-events path. |
| `enhanced-smart-blocks.js` | `L524-L527` | call `promoteToVenueCatalog()` | active | Catalog promotion occurs before candidate insert so candidate rows can carry `venue_id`. |
| `enhanced-smart-blocks.js` | `L530-L599` | build `ranking_candidates` values | active | Computes distance/value metrics, time-relevant matched events, event badges, candidate features, place/venue IDs. |
| `enhanced-smart-blocks.js` | `L601-L615` | insert candidates/update ranking total | active | Persists candidate rows and total timing. |
| `shared/schema.js` | `~L1100-L1165` | `ranking_candidates` schema | active DB schema | Candidate table has `venue_id`, `place_id`, distance/value metrics, tactical tips, staging data, `business_hours`, and `venue_events`. |

## 11. API transform / response surface

| File | Lines | Function / call | Status | Audit note |
|---|---:|---|---|---|
| `server/validation/transformers.js` | `L1-L18` | transformer module header | canonical output layer | Defines DB snake_case → API camelCase → client shape as the single source of truth. |
| `transformers.js` | `L70-L105` | `toApiVenue()` | active Bar Tab transform | Converts bar/venue discovery objects to API venue format. |
| `transformers.js` | `L160-L236` | `toApiBlock()` event fields | active Smart Blocks transform | Resolves `hasEvent`, `eventBadge`, `eventSummary`, `businessHours`, `closedReasoning`, distance/value fields, and venue IDs for client. |
| `blocks-fast.js` | `L302-L359` | `mapCandidatesToBlocks()` | active API bridge | Batch resolves candidate addresses, filters Plus Codes, and calls `toApiBlock()`. |
| `blocks-fast.js` | `L447-L492` | GET `/api/blocks-fast` result path | active read path | Ensures blocks exist, reads candidates, transforms/filter/sorts, returns `{ blocks, rankingId, briefing, audit }`. |

## 12. Bar Tab / nearby venue discovery pipeline

This is a **separate pipeline** from Smart Blocks. It shares `venue_catalog`, Google Places, and some hours logic, but it is not strategy-aware. The architecture requirements explicitly call this divergence out: Smart Blocks uses VENUE_SCORER + strategy context, while Bars/Lounges uses `venue-intelligence.js` with VENUE_FILTER and no strategy context. 

| File | Lines | Function / call | Status | Audit note |
|---|---:|---|---|---|
| `server/lib/venue/venue-intelligence.js` | `L42-L120` | `calculateOpenStatus()` | active but audit-sensitive | Calculates open/closed/closing-soon; architecture docs previously flagged duplicate weekday parsing concerns. |
| `venue-intelligence.js` | `L143-L170` | `EXCLUDED_VENUES`, `isExcludedVenue()` | active filter | Hardcoded exclusions for fast food, coffee, gas, grocery, etc. |
| `venue-intelligence.js` | `L182-L276` | `classifyAndFilterVenues()` | active AI filter | Calls `VENUE_FILTER` to classify P/S/X and drop X-tier venues. |
| `venue-intelligence.js` | `L348-L520` | `discoverNearbyVenues()` cache-first path | active Bar Tab utility | Checks `venue_catalog` by venue types, filters by radius and hours, backfills missing hours, then returns cached venues if enough have usable hours. |
| `venue-intelligence.js` | `L560-L690` | Google Places `searchNearby` fallback | active Bar Tab utility | Calls Places SearchNearby for bar/nightclub/wine bar types, maps price/rating/hours/location into venue objects. |
| `docs/architecture/ARCHITECTURE_REQUIREMENTS.md` | `L150-L185` | strategic venue selection contract | unresolved product decision | Says Bars tab is currently a nearby-venues utility, not the Smart Blocks strategic scoring pipeline. |

## 13. Duplicate / overlap audit targets

### A. Smart Blocks vs Bar Tab must remain separated unless intentionally unified
- Smart Blocks = strategy-aware VENUE_SCORER pipeline.
- Bar Tab = nearby bars/lounges utility unless product chooses unification.
- Do not let Bar Tab sorting rules override Smart Blocks tactical ranking.

### B. Coordinates must come from Google/catalog, not model output
- VENUE_SCORER emits venue names/district/tips, not coordinates.
- Coordinates are populated by Google Places / catalog resolver.
- Any numeric lat/lng from LLM should not be trusted as final location truth.

### C. Catalog-first cache must not become fuzzy-first
- Smart Blocks resolution uses exact `lookupVenue()` first.
- Fuzzy lookup remains fallback for event-discovery/legacy style use, not primary Smart Blocks location truth.

### D. Enrichment and catalog promotion are separate stages
- `enrichVenues()` verifies/fetches factual Google details and route metrics.
- `promoteToVenueCatalog()` persists only verified venues with placeId and address.
- Do not write unverified/failed enrichment directly as verified catalog identity.

### E. Event matching must not re-query the DB
- `todayEvents` is fetched once by Smart Blocks.
- Matcher receives the pre-fetched event set.
- No internal city-scoped matcher query should return.

### F. Candidate-to-client transform should remain single source of truth
- API shape should come through `toApiBlock()`.
- Do not duplicate field mapping in route handlers or client components.

## 14. Main red flags / hardening backlog

1. **Driver preference scoring is only partially integrated.**
   `tactical-planner.js` imports and injects driver preference text, but the architecture docs still warn that `user_id` must become a real scoring/filtering input, not just attribution. 
2. **Bar Tab and Smart Blocks are divergent.**
   This may be okay, but it must be product-labeled correctly: Bar Tab currently answers “nearby bars/lounges,” not “highest earning strategic venue.” 
3. **Venue value scoring is still heuristic.**
   Current value math is distance/drive-time based; `VENUES.md` flags no surge multiplier, airport queue premium, offer intelligence, venue popularity, or catalog cleanup. 
4. **Venue catalog cleanup / freshness is still TODO.**
   `VENUES.md` lists venue freshness TTL and catalog cleanup as hardening work. 
5. **Places/cache/hours logic crosses multiple files.**
   Hours are evaluated in both `venue-enrichment.js` and `venue-intelligence.js`; the canonical hours module should remain the source of truth and duplicate weekday parsing should not creep back in. The architecture requirements explicitly call out weekday parsing and hours-trust contracts. 

## 15. One-line canonical venue flow

POST /api/blocks-fast → ensureSmartBlocksExist → generateEnhancedSmartBlocks → fetch live event context from discovered_events + venue_catalog → filter briefing for planner → generateTacticalPlan via VENUE_SCORER → resolve venue names through venue_catalog/Places → enrichVenues via Routes + Places + hours → match venues to events by place_id/venue_id/name → verify venue events → promote verified venues to venue_catalog → insert rankings + ranking_candidates → transform candidates to API blocks.

## 16. Naming Conventions Doctrine

The following canonical nomenclature **must** be adhered to across all documentation, commits, and ReAct loops to prevent architectural drift between data storage and pipeline execution.

### Canonical naming correction

The Strategy Page venue recommendation flow shall be referred to as the **Strategy Venues Pipeline**.
The term **Venue Catalog Pipeline** shall not be used for Strategy Page venue generation.
`venue_catalog` is not the Strategy Page generator. It is the canonical venue identity and enrichment store that exists before, during, and after Strategy Page venue generation.

Correct separation:
- `venue_catalog` = canonical venue inventory / identity / enrichment layer
- Strategy Page `GET venues` / `blocks-fast` = recommendation pipeline
- Bar Tab venue discovery = separate nearby-bars utility pipeline
- `discovered_events` = event working set linked to canonical venues through `venue_id`

### 1. Venue Catalog
The persistent canonical table containing venue identity, coordinates, address, place ID, hours, quality fields, enrichment status, event-host flags, bar flags, and market metadata.

### 2. Strategy Venues Pipeline
The Strategy Page recommendation flow that uses snapshot, strategy, briefing, event context, `venue_catalog`, Google Places, Google Routes, and VENUE_SCORER to produce `rankings` and `ranking_candidates`.

### 3. Bar Tab Discovery Pipeline
The separate nearby-bars/lounges discovery surface powered by `venue-intelligence.js`. This may read/write `venue_catalog`, but it is not the Strategy Page recommendation pipeline.

### 4. Event Catalog Pipeline
The event workflow that discovers, validates, deduplicates, enriches, and stores events in `discovered_events`, linking event rows to canonical venues through `venue_id`.

### 5. Venue Enrichment Layer
The Google Places / Routes / hours / address resolution layer used by Strategy Venues and other venue flows to turn candidate venue names or coordinates into factual venue details.
