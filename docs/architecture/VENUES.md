# Strategy Venues and shared venue identity

Canonical source trace, reconciled September 29, 2026. Source establishes behavior; the verification receipt in [VENUES_PIPELINE_AUDIT.md](VENUES_PIPELINE_AUDIT.md) distinguishes automated coverage from unperformed live-provider checks. Model choices come from the [registry](../../server/lib/ai/model-registry.js), not copied model names in this document.

## Terms and ownership

- **Venue Catalog** means `venue_catalog`, the persistent identity/enrichment store. It is not a generator.
- **Strategy Venues Pipeline** means admitted snapshot + completed Briefing + current Strategy → venue recommendations → `rankings` / `ranking_candidates`.
- **Bar Tab Discovery Pipeline** is the separate nearby bars/lounges utility. It shares catalog data and Google APIs but is not a second Strategy generator.
- **Event Catalog Pipeline** discovers, normalizes, validates, deduplicates and stores `discovered_events`, linked to catalog venues by `venue_id`. Event rows do not own geographic coordinates.
- **Venue Enrichment Layer** turns resolved provider identities into factual addresses, hours and routes. Names/tips from a model do not establish coordinates or business status.

The preserved history of the 15-mile venue rule versus the 60-mile event-context radius is in [the event alignment plan](../../server/lib/venue/SMART_BLOCKS_EVENT_ALIGNMENT_PLAN.md). That historical plan does not describe today's complete implementation.

## MAIN entry to saved response

| Stage | Actual file / function | Contract |
|---|---|---|
| Client request | [co-pilot-context.tsx](../../client/src/contexts/co-pilot-context.tsx), [StrategyPage.tsx](../../client/src/pages/co-pilot/StrategyPage.tsx) | Current admitted snapshot drives Strategy/venue reads. A previous saved result is not a fresh replacement result. |
| Entry and generation claim | [blocks-fast.js](../../server/api/strategy/blocks-fast.js), `ensureSmartBlocksExist` | Authenticated ownership, admitted run, snapshot readiness, complete Briefing and Strategy source receipt are checked. A short advisory-lock transaction claims work; external calls run outside the lock. |
| Source fence | [enhanced-smart-blocks.js](../../server/lib/venue/enhanced-smart-blocks.js), `generateEnhancedSmartBlocks` | Rechecks Strategy text and Briefing generation token; final publication uses the current-run transaction and repeats source checks. A stale worker cannot publish into a replacement run. |
| Event context | Same file, `fetchTodayDiscoveredEventsWithVenue` | The [shared market reader](../../server/lib/events/market-event-reader.js) scopes active events by country and canonical metro, then checks absolute venue-local overlap with the driver day. Planner-grade identity and legacy content validation gate the set. Driver-relative distance caps context at 60 miles and sorts closest first before prompt limits. Read/unresolved-timezone failure is recorded as degraded event context. |
| Planner | [tactical-planner.js](../../server/lib/strategy/tactical-planner.js), `generateTacticalPlan` | Registry role `VENUE_SCORER` receives immediate Strategy, filtered Briefing and admitted profile/vehicle preferences. Main and replacement responses use the venue schema; the deadline signal reaches both model calls and Places resolution. |
| Identity resolution | Same file, `resolveVenueWithCache`; [venue-enrichment.js](../../server/lib/venue/venue-enrichment.js), `searchPlaceByText` | Exact normalized catalog name/locality first, with district checks. Requires provider identity, valid coordinates, compatible known country and ≤15-mile straight-line distance from the current driver. Closed/invalid/remote catalog rows require new resolution. Text Search uses name/district/locality/country and driver location bias; weak unrelated matches are rejected. |
| Controlled replacement | `generateTacticalPlan` | A category fallback is city bounded, reads the real `venue_name` field, and receives the same identity/radius/closure checks. Model replacements are schema validated. Final venues deduplicate by place ID. Fewer valid venues is explicit degradation; missing venues are not invented. |
| Enrichment | `enrichVenues` | Reuses a Text Search result from this run; a catalog hit refreshes exact-ID Place Details. Canonical address/coordinates/country/timezone are established before routing. Both permanent and temporary business closure exclude a venue. Ordinary outside-opening-hours status can remain false with model timing advice. |
| Routes | [routes-api.js](../../server/lib/external/routes-api.js) | Batch Route Matrix to those exact coordinates. Successful cells require valid indices/status/condition and measured distance/duration. Missing cells or failed batch requests can use singleton Routes. Explicit failed cells are omitted. Zero is preserved; unknown never becomes zero. No usable venues means pipeline failure rather than an empty successful ranking. |
| Event badges/evidence | [event-matcher.js](../../server/lib/venue/event-matcher.js), `matchVenuesToEvents`; `isEventTimeRelevant` in orchestrator | Provider ID → catalog ID → legacy name fallback. Conflicting authoritative IDs never fall back to name. Event ID and full calendar dates survive matching. Canonical IANA-aware start/end helpers determine relevance. |
| Catalog promotion | `promoteToVenueCatalog` → [venue-cache.js](../../server/lib/venue/venue-cache.js), `upsertVenue` | Saves verified identity/address, provider locality/country/timezone and structured Google regular hours. Failed promotion leaves a null catalog FK, not a different venue's identity. |
| Atomic publication | `generateEnhancedSmartBlocks` | Current-run/source transaction writes ranking plus candidates together. `ranking_candidates.venue_events` contains the saved event IDs, calendar spans, venue timezone and absolute timestamps shown on cards; candidate `place_id`/`venue_id` establish identity. There is no second model's guessed confidence. |
| Saved read | `mapCandidatesToBlocks` → [toApiBlock](../../server/validation/transformers.js) | Reads canonical `features.address`; does not geocode, re-identify or write a venue merely to display it. Legacy missing route data remains null. API still applies its 25-mile driving-distance perimeter and value/distance sort. |
| Presentation | [StrategyPage](../../client/src/pages/co-pilot/StrategyPage.tsx), [StrategyMap](../../client/src/components/strategy/StrategyMap.tsx) | Cards/maps consume saved provider coordinates, route metrics, hours and matched events. Navigation uses provider identity/coordinates. A venue's predicted wait is not its driving time. |

GET can still initiate the authorized venue stage when `ensureSmartBlocksExist` finds no ranking; **mapping an existing ranking** is a saved read. These are distinct behaviors.

## Preferences and model boundaries

`VenueRecommendationSchema` accepts name, optional district/staging name, category, 1–3 tips and optional strategic timing. It does not accept model-generated latitude/longitude. The target is six recommendations; the initial schema permits up to eight, and failed resolution can yield fewer. Staging is descriptive text, not a verified parking coordinate.

The planner receives the strategy and admitted user preferences, including explicitly selected services and vehicle context. Capability does not activate an unselected service. `max_deadhead_mi` describes empty travel to a ride pickup; it is not a radius from home and is not reused to reject nearby venues. Optional home-distance annotations do not reorder/filter recommendations.

Offer Analyzer rules, offer tables and new surge/earnings inference remain held out of MAIN. The earlier instructions in this document to inject Analyzer data or reinterpret pickup limits as venue/home radii were stale and are removed.

## Identity, hours and Google contracts

`venue_catalog.place_id` is provider identity; `venue_id` is the local UUID. Explicit place-ID lookups do not silently fall through to another same-name branch. `findOrCreateVenue` accepts Google IDs without a `ChIJ` prefix assumption. Address repair cannot overwrite a known identity with a different search result.

`coord_key` is a nonunique, six-decimal location lookup index; coordinates used for routes retain provider precision. Distinct Google IDs at one point/address retain distinct catalog UUIDs. Exact IDs arbitrate inserts through the unique `place_id` constraint. Without an ID, reads combine supplied name, coordinate, city/state and known country and return only one unambiguous match; fuzzy reads cannot choose the first neighboring business or search the whole state. An unidentified upsert cannot rewrite a known provider's facts.

`insertVenue` is the shared writer for promotion and address caching. Concurrent updates merge role flags, venue types and enrichment status atomically. Repeated unidentified evidence uses an advisory-lock transaction over its exact name/location/address/locality identity; it never acquires a neighboring provider ID by proximity. Address repair conditionally promotes the observed identity; a competing distinct provider response gets its own canonical row instead of overwriting the first promotion. Unknown or ambiguous historical rows are preserved, not bulk merged or deleted.

**Required rollout, not applied in this review:** [20260929_venue_catalog_colocated_identity.sql](../../migrations/20260929_venue_catalog_colocated_identity.sql) removes only `venue_catalog_coord_key_unique` and adds `idx_venue_catalog_coord_key`. The venue `place_id` uniqueness and the separate `coords_cache.coord_key` uniqueness stay intact. Drain legacy catalog writers, apply this migration through the existing migration path, then start the matching new writers. Old `ON CONFLICT(coord_key)` writers cannot run against the migrated catalog. Source/schema agreement and isolated migration tests do not prove the deployed database has been migrated.

The shared address resolver uses those same identity reads/writes, records the actual provider point/name, preserves valid zero coordinates and leaves missing country null. Its exported batch helper has no current source caller; unique points retain `lat,lng` response keys and repeated points use `lat,lng#index` so colocated inputs are not overwritten.

Optional catalog Details backfill accepts any nonempty Google ID. Concurrent calls for the same catalog UUID and provider ID share one pending provider operation through its identity-bound write. The 15-second deadline includes fetch and response-body parsing; expired work cannot publish late data even if the transport ignores abort. Success/failure/timeout releases the pending entry, so later attempts remain fresh. This phone/rating/hours backfill has a different field contract from MAIN's current identity/open-status collector; they do not reuse mismatched provider responses.

Strategy Places reads request identity, address components, business status, current/regular opening hours, location and `timeZone`. ISO-2 country comes from Google's short country component; missing country remains null. A valid place-local `timeZone.id` supplies canonical weekday-hours evaluation and catalog timezone. Fresh Google `openNow` is used when present. Missing hours/open state remain unknown, not closed or open by assumption.

Catalog hits avoid Text Search; they do not avoid refreshing volatile current details. Concurrent exact-ID Details calls share work. The former six-hour coordinate-only Places cache, Nearby/name re-resolution and batch address lookup inside MAIN enrichment were removed because they could mix co-located identities and duplicate already-resolved work. Other pipelines retain their own documented cache purposes.

Route requests have deadlines; uncancelled identical in-flight requests share work. Singleton cache entries last ten minutes and include exact coordinates and semantic request options. Fractional provider durations survive parsing. Missing static duration means unknown traffic delay. See [Google API inventory](google-cloud-apis.md) for official contract links.

## Events and ranking fields

Event context and event destinations are different: ≤15-mile venues can be recommended; events out to 60 miles may inform nearby demand without becoming destinations. Both the MAIN [event collector](../../server/lib/briefing/pipelines/events.js) and the planner context reader reuse [market-event-reader.js](../../server/lib/events/market-event-reader.js). Country plus canonical metro membership includes cross-state markets without admitting every event in the state. Broad calendar SQL is followed by actual venue-local instant overlap with the driver's day. MAIN limits only after that truth filter; planner reads the scoped set before its distance sort and prompt limits.

Discovery validates required source content before venue resolution but defers calendar-only exclusions until the verified venue timezone is known. It uses an unambiguous name/locality/country catalog match or Google name/address resolution, requires provider country and the matching saved place ID, and stores canonical venue locality before hashing. Model place-ID strings remain untrusted hints; their spelling never certifies identity. Missing attendance stays null. Unresolved required identity/timezone or saved schedules become explicit failure, not verified absence. The saved Briefing includes venue timezone and `start_time_iso`/`end_time_iso` for Strategist; planner prompts include dates and the venue timezone. Category model requests carry a 90-second cancellation scope; each venue resolution uses a 15-second scope shared through Places/geocoding. Optional caller cancellation propagates through discovery, and late responses cannot start fallback or publish event evidence.

Badge relevance uses real dates/times in the supplied IANA timezone: next two hours, ongoing span, start within the last four hours, or end within the last hour. Invalid/unknown schedules do not become timed badges. True all-day/multi-day/overnight spans remain calendar spans. Legacy rows requiring read validation use the joined venue timezone.

Shared event writes use [cleanup-events.js](../../server/lib/briefing/cleanup-events.js) `withEventVenueLock` to keep overlap checks, INSERT and venue-tag refresh in one transaction. Briefing and Concierge use that venue lock; all three event writers, including Coach ADD_EVENT, also lock the base hash before choosing a stable timed variant. Legacy first-show hashes remain unchanged. A different explicit schedule is preserved as another source variant instead of overwriting a matinee/evening performance. Raw title dedup, normalized dedup and Concierge's per-request promise keys retain schedule distinctions before storage.

Automatic span merging requires one compatible active multi-day candidate with equal known clocks; overnight/single-day/ambiguous schedules are preserved. SQL `LEAST`/`GREATEST` cannot shrink an already extended span. Cleanup soft-deactivates contained compatible duplicates, never partially overlapping variants, and rechecks observed end/venue fields before expiring a row. Venue-tag cleanup uses the same venue lock. Discovery refresh preserves manual or unattributed deactivation; only explicitly recorded automatic expiry can be reactivated by discovery.

Coach ADD_EVENT normalizes and validates reported clocks/dates, preserves supplied multi-day end dates and infers only canonical overnight rollover. It does not invent an end clock, attendance, provider coordinates or catalog link. Future reported schedules remain unverified rather than receiving the current-discovery validation marker. The chat dispatcher supplies snapshot timezone and reports failed writes through the existing action acknowledgment.

The old `VENUE_EVENT_VERIFIER` pass received no `eventBadge`/`eventSummary` fields from the planner schema, so it never verified anything. Its unused module and call were removed. Saved canonical event evidence feeds candidate `venue_events`; there is no extra verification model spend. The obsolete `rankings.extras` property was also removed: no such field exists in the Drizzle rankings schema, so it had never been persisted. Actual SQL tests now verify the candidate evidence rather than trusting a mocked insert object.

Persistent fields are defined by [shared/schema.js](../../shared/schema.js):

| Store | Relevant contents |
|---|---|
| `venue_catalog` | `venue_id`, `place_id`, canonical name/address/locality/country, coordinates, timezone, structured hours, quality/status fields |
| `rankings` | Snapshot/user ownership, model/timing metadata and path status |
| `ranking_candidates` | `block_id`, `place_id`, nullable `venue_id`, `distance_miles`, `drive_minutes`, tips/staging text, hours, `venue_events`, `features.address/isOpen/hasEvent` |
| `strategies.venue_cache_metrics` | Catalog hit/miss metrics merged without erasing the Strategy source receipt |

The retained value calculation is a **heuristic**: routed distance × 1.50, divided by drive minutes when positive, then A/B/C thresholds. It is not measured fare, profit, expected ride distance, future surge, or Offer Analyzer economics. No new earnings source was introduced by these repairs. The API's value-first sort still uses this heuristic; product scoring changes are separate work.

## Independent venue surfaces

[useBarsQuery](../../client/src/hooks/useBarsQuery.ts) supplies both the layout prefetch and [BarsMainTab](../../client/src/components/BarsMainTab.tsx); one React Query key shares the result and cancellation signal. Five-minute stale / ten-minute retention settings remain. Provider/HTTP failure envelopes render errors, not successful empty venues. Unknown prices, crowd levels and ride demand remain null; ratings are not live crowd observations. A current provider open observation is usable without an optional localized hours string, and a zero-minute countdown remains zero.

Authenticated [venue routes](../../server/api/venue/venue-intelligence.js) validate coordinates, positive radius, city and IANA timezone, including `/last-call` and `/smart-blocks`. [The independent service](../../server/lib/venue/venue-intelligence.js) checks catalog recommendations before Places Nearby. Cache reuse requires at least five usable, classified nearby identities with explicit provider-hours receipts no older than 24 hours; generic catalog `updated_at` does not establish hours freshness. Cached `openNow` is not replayed: hours are reevaluated in the venue's own timezone. Legacy rows without that receipt refresh through Nearby. This cache is a bounded observation, not proof that a venue cannot change during the interval.

Nearby candidates require provider identity, valid coordinates, known $$+ price/rating threshold and usable open status. Temporary/permanent business closure excludes a candidate. Ordinary outside-opening-hours staging remains explicitly suggested rather than claimed demand. The `VENUE_FILTER` response must classify every supplied candidate as P/S/X; provider and classification failures stay errors. Concurrent identical area requests share lookup/discovery/classification/persistence; detached duplicate backfills and coordinate/name-specific duplicate persistence were removed. Persistence uses canonical exact-identity upsert and provider locality/country/timezone. An incompatible catalog ID is never used to update another business.

`/traffic`, `/smart-blocks` and `/last-call` are mounted independent routes, not MAIN aliases. Traffic model failure is unavailable, never fabricated medium congestion. Combined reads consume the actual camelCase traffic result. Compact Strategy cards in [BarsDataGrid](../../client/src/components/BarsDataGrid.tsx) display their saved heuristic grade, not a made-up dollar price, and do not evaluate a venue weekday in the browser's timezone.

[Concierge](../../server/lib/concierge/concierge-service.js) has a separate anonymous discovery/chat path and shared event/catalog writes. [Events discovery](../../server/lib/briefing/pipelines/events.js) uses the shared resolver and `findOrCreateVenue`. Those boundaries require their own tests; a green MAIN venue suite does not prove all Bars/Concierge behavior.

No active Strategy venue output includes Street View imagery. No raw Maps server key belongs in a venue response. Historical `TacticalStagingMap` and unmounted `venue-events` source are not evidence of active duplicate requests.

## Verification and remaining scope

Use [VENUES_PIPELINE_AUDIT.md](VENUES_PIPELINE_AUDIT.md) for the current test matrix and explicit limitations; use [the ordered review](audits/PIPELINE_REVIEW_2026-09-29.md) for independent pipeline work. Current changes have mock/provider-contract and in-memory SQL coverage. They have not been deployed or tested against live Google billing/credentials in this review.
