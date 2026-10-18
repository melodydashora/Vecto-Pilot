# VectoPilot lexicon

Updated October 12, 2026 (UTC) by Codex/Astra. Melody explicitly requested one lexicon
after correcting the feature name to **Offer Analyzer**. That naming decision
governs current product labels, documentation and agent communication. The
remaining definitions below describe the reviewed source; they do not assert
deployment or completion of proposed features.

This retains the existing root `LEXICON.md` entry point. Its older definitions
are recoverable from the reviewed base commit and the external cleanup archive.
Contradictory MAIN stage order, model-environment overrides, invented GPS accuracy
and a Coach-as-MAIN definition have been retired.

Use this document for meanings and the linked implementation for exact contracts.
Keep one definition here and link to it from guides. When behavior or an accepted
term changes, update its definition and consumers in the same change. Preserve
historical evidence as dated history rather than rewriting past receipts.

## Feature names and pipeline roles

| Term | Meaning and use | Implementation or current guide |
|---|---|---|
| **Offer Analyzer** | The feature that reads a captured offer, applies the driver's rules, returns a decision and supports tracking offers and outcomes. Use the full name for the feature; retire `Offer`, `Offers`, `Analyzer`, and `Offer Intelligence` as standalone feature names. | [Feature contract](docs/architecture/OFFER_ANALYZER.md), [page](client/src/pages/co-pilot/OfferAnalyzerPage.tsx), `/api/offer-analyzer` |
| **offer / offers** | One observed work opportunity / the opportunities being analyzed and tracked. Appropriate in record labels such as “Today's offers,” counts, filters and identifiers. These nouns do not name the whole feature. | `offer_intelligence` records; [schema](shared/schema.js) |
| **recent offers** | The driver's automatically recorded quick/deep Offer Analyzer evidence, including the most recent observed offers and separately reported outcomes. Coach reads a bounded owner-scoped window; this is not a Saved Offers selection. Valid capture request time determines observation order; legacy row-time fallback is explicit. | [Coach evidence](docs/architecture/RIDESHARE_COACH.md#recent-offer-analyzer-evidence-boundary), [reader](server/lib/ai/rideshare-coach-dal.js) |
| **Saved Offers** | Melody's separately named offer-saving feature. Do not use this name for automatically recorded recent offers or quick/deep analysis history. Its current storage/UI mapping is not verified in this checkout; this distinction does not introduce a bookmark table or authorize an unimplemented save action. | Melody's October 12, 2026 correction; [Coach boundary](docs/architecture/RIDESHARE_COACH.md#recent-offer-analyzer-evidence-boundary) |
| **MAIN** | The prepared-context and explicitly admitted Strategy pipeline. GPS/snapshot and Briefing preparation precede Strategy admission. | [Ordered trace](docs/architecture/ai-pipeline.md) |
| **snapshot** | The saved `snapshots` table row with owned GPS evidence and environmental observations. Retain original times, accuracy and source identity. Pipeline handoffs use this row; Briefing, Strategy, preferences and prior model responses remain separate inputs rather than attached snapshot fields. | [Snapshot contract](docs/architecture/SNAPSHOT.md), [writer](server/lib/location/main-run-snapshot.js), [Briefing boundary](server/lib/briefing/briefing-aggregator.js) |
| **Briefing** | Saved contextual intelligence required by MAIN. Required sections must be complete and tied to the current generation before Strategy can use them. | [MAIN trace](docs/architecture/ai-pipeline.md), [Briefing aggregator](server/lib/briefing/briefing-aggregator.js) |
| **Events** | Briefing's verified event context. Completed search categories enter venue/time verification and generation-fenced progressive saves; verified cards may appear while collection continues and survive later failure. Nearby high/medium-impact events within 15 straight-line miles take priority; broader-market context requires high impact. The selection preserves canonical event records and does not infer attendance from venue capacity. | [Events pipeline](server/lib/briefing/pipelines/events.js), [priority](server/lib/events/briefing-event-priority.js), [display](client/src/components/BriefingTab.tsx) |
| **Schools / School Closures** | Briefing's school breaks and first student return days affecting today's travel, evaluated against the current date in the snapshot's timezone. Check individual districts across connected communities, using the supplied market when known. A verified break covers its continuous school-free interval, including adjoining non-class weekends; an ordinary weekend alone is not a break. `closureStart` includes the first non-class date; `reopeningDate` is the first date students return and is not a closed day. `getSchoolClosureStatusOnDate` returns `closed`, `reopening_today`, or `null`. While closed, the card leads with the inclusive **Closed** range and shows an explicit **Students return** date as secondary context. On the explicit return day, **Students return today** is primary and the closed period is historical; the item drops the next day. Legacy last-closed dates remain inclusive and cannot establish a return day. Research failure differs from a verified empty result. The existing institution-point distance filter does not establish district service boundaries. | [Schools pipeline](server/lib/briefing/pipelines/schools.js), [shared date rule](shared/school-closures.js), [Schools card](client/src/components/briefing/SchoolClosuresCard.tsx) |
| **Airport** | Briefing's airport section. The catalog selects airport identities; usable FAA conditions resolve first, missing conditions alone trigger `BRIEFING_AIRPORT` research, and a separate terminal pass consumes those fixed conditions. Missing observations remain unknown. | [Airport pipeline](server/lib/briefing/pipelines/airport.js), [FAA source](server/lib/external/README.md) |
| **Strategy** | The saved guidance/result for an explicitly admitted MAIN run, distinct from the role generating it. | [Strategy guide](docs/architecture/ai-pipeline.md), `strategies` |
| **Strategist** | The role that generates Strategy from the admitted context and complete Briefing. The active role key is `STRATEGY_TACTICAL`; a provider model name is not the role name. | [Role registry](server/lib/ai/model-registry.js), [MAIN trace](docs/architecture/ai-pipeline.md) |
| **VenuePlanner** | The planning stage using Strategy and verified context to produce candidate venues; role key `VENUE_SCORER`. Verified Places identities and measured Routes remain distinct from model suggestions. | [Venue contract](docs/architecture/VENUES.md) |
| **ranking / ranking candidate** | A persisted recommendation set / an individual venue candidate within it. A completed notification refers readers to saved state. | `rankings`, `ranking_candidates`; [venue contract](docs/architecture/VENUES.md) |
| **Smart Blocks** | The Strategy page's venue recommendations. Candidates need verified identity and measured route evidence before publication; a suggested venue name or model coordinate alone is insufficient. | [Venue contract](docs/architecture/VENUES.md), [generation](server/lib/venue/enhanced-smart-blocks.js) |
| **Coach** | The independent assistant using its own GPS/Google observation, separately attributed saved context, conversation and longitudinal evidence. Activating Coach attempts a fresh capture; later location-dependent questions can request another capture followed by one read-only answer continuation. It can explain scenarios and tune existing Offer Analyzer controls when the driver asks, using recent quick/deep offer evidence and canonical validated, versioned rules writes. Confirmed changes require a durable receipt; advice alone does not authorize a write. It preserves earlier decisions and outcomes, does not issue a fresh live Offer Analyzer decision, and does not start Strategy automatically. | [Coach contract](docs/architecture/RIDESHARE_COACH.md) |
| **Coach snapshot** | An immutable owned `snapshots` row with `permissions.context_kind = 'coach'`, captured for the current driver session independently of MAIN. `coachSnapshotId` selects current Coach location/time/weather/air; the separate saved-source `snapshotId` keeps conversation and older Briefing/Strategy lineage. Refresh changes neither MAIN pointers nor prior source records. A refresh request is not a successful capture receipt. | [Capture](server/lib/location/coach-snapshot.js), [context contract](docs/architecture/RIDESHARE_COACH.md#independent-coach-snapshot) |
| **Bars/Lounges** | Independent nearby venue discovery, sharing verified venue data with other consumers. | [Venue contract](docs/architecture/VENUES.md), [query](client/src/hooks/useBarsQuery.ts) |
| **Public Concierge** | Public token/GPS-driven venue and event assistance with its own request lifecycle. | [Independent pipelines](docs/architecture/INDEPENDENT_PIPELINES.md), [route](server/api/concierge/concierge.js) |
| **Translation / Welcome** | Separate assistance entry points with their own contracts and provider results. | [Independent pipelines](docs/architecture/INDEPENDENT_PIPELINES.md) |

## Offer Analyzer decisions and evidence

| Term | Exact meaning | Existing representation |
|---|---|---|
| **Offer Analyzer decision** | The original Phase 1 decision returned to the driver. | `offer_intelligence.decision`: `ACCEPT`, `REJECT`, `NO DATA`; historical `UNKNOWN` rows can exist. |
| **Phase 1** | Synchronous normalization, extraction, rules/adjudication and spoken response. | [Hook](server/api/hooks/analyze-offer.js), [adjudication](server/lib/offers/phase1-decision.js) |
| **Phase 2** | Later enrichment and storage. It preserves the original Phase 1 decision while recording deep-model dissent separately. Current execution is process-local after the response. | `offer_intelligence.parsed_data_json.deep_decision` and original decision provenance; [feature contract](docs/architecture/OFFER_ANALYZER.md) |
| **quick / deep analysis** | Phase 1 / Phase 2 Offer Analyzer evidence. In the current source both are retained on `offer_intelligence`, with quick `phase1_result`, deep parsed/raw evidence and `deep_decision`; they are not separate verified table names. The existing pipeline may not persist a quick result until asynchronous deep processing ends. | [Ingestion](server/api/hooks/analyze-offer.js), [Coach reader](server/lib/ai/rideshare-coach-dal.js) |
| **driver override** | Immediate driver disagreement with the Offer Analyzer decision. It does not prove a completed trip. | `offer_intelligence.user_override`: `ACCEPT` / `REJECT`. |
| **driver outcome** | The separately reported driver action and optional earnings, saved with revision checks. | `offer_outcomes.driver_decision`: `Accepted`, `Rejected`, `Cancelled`, `Completed`, `Other` or unknown/null. |
| **offered pay** | Pay displayed for the observed offer. | Existing `price` field, stored in dollars; not realized income. |
| **reported earnings** | Explicitly entered outcome money components. A generated zero with every component null is still unreported. | `actual_pay`, `reimbursements`, `extras`, `other`; database-generated `total_earned`. |
| **platform** | The observed provider identity. | Current normalized analysis: `uber`, `lyft`, `unknown`. Preserve missing evidence. |
| **product** | A provider's displayed work/service label. | `product_type`; canonicalization in [driver services](shared/driver-services.js). |
| **selected service** | Work the driver explicitly chose to receive/evaluate. | `selected_services`; the shared service IDs differ from provider product labels. |
| **vehicle eligibility** | Work the vehicle can support. It does not establish the driver's selections. | [Preferences](docs/architecture/USER_PREFERENCES.md), [driver services](shared/driver-services.js). |
| **ruleset / rule tier** | Saved analysis policy / an economic evaluation group within that policy. Product identity, selected service and rule tier are related but separate. | [Ruleset store](server/lib/offers/ruleset-store.js), [rules engine](server/lib/offers/rules-engine.js). |
| **pickup leg / ride leg** | Travel to pickup / travel for the offered trip. Their estimates remain separate; complete totals include both. | `pickup_miles`, `pickup_minutes`, `ride_miles`, `ride_minutes`; current totals use miles/minutes. |
| **driver location / pickup / dropoff** | Where the driver was observed / offered pickup location / offered destination. | Distinct driver/pickup/dropoff fields in [schema](shared/schema.js). |
| **stay-in zone** | The driver's one Places-picked city the Offer Analyzer treats as home turf: a radius approximates it, a pickup buffer allows pickups just outside it, and a dropoff outside it must clear the tier $/mi floor over pickup + trip + the return leg. Distinct from avoid places and from the inert `home`/`geo` keys. | `zone` in the [rules engine](server/lib/offers/rules-engine.js); [Geography card](client/src/components/offer-analyzer/GeographyCard.tsx); roadmap D8–D11 |
| **return leg / loop rate** | Estimated road miles from an out-of-zone dropoff back to the zone edge / the fare divided by pickup + trip + return miles. Model-estimated in Phase 1, geometry-estimated (×1.25 road factor) in Phase 2; an estimate, never a stored sensor fact. | `return_miles`, `zone_loop_per_mile`, `zone_audit` in `offer_intelligence.parsed_data_json` |
| **capture / analysis / outcome** | The source observation / the feature's interpretation / the driver's separately recorded action. | Capture input, `offer_intelligence`, `offer_outcomes`; neither disappearance nor notification removal establishes an outcome. |

`ACCEPT (FALLBACK)` is display wording, not a fourth decision enum. “Accepted” in
a driver outcome and `ACCEPT` in an Offer Analyzer decision are different facts. An
analysis error or missing data must remain distinguishable from a rejection.

## Identity, lifecycle and verification

| Term | Meaning |
|---|---|
| **account owner** | The user established by authentication or resolved shortcut token. A self-reported device ID does not authenticate a user. |
| **driver session** | One authenticated session per account, with a 60-minute inactivity window and existing two-hour absolute limit. Tabs on the same origin reuse the saved token. A verified login warns when another session is live; the driver can explicitly close that session and sign in here. Replacement rechecks credentials and the exact session identified by the warning, invalidating tokens bound to the replaced session. Recovery of a lost login response returns that attempt's original session without extending its lifetime. Verified Google adoption of an unverified registration retains its existing identity-protection exception. See [authentication](docs/architecture/AUTH.md), including the legacy unbound-token limitation. |
| **capture ID** | The GPS observation request identity used to control capture publication. |
| **MAIN admission / run ID** | The explicit Strategy intent and its pinned settings/source receipt, stored in `main_run_admissions`. |
| **generation** | A particular Briefing/source version. Matching a snapshot alone does not establish a matching generation. |
| **progressive Briefing / terminal Briefing** | Saved, verified sections or Events items arriving during the current generation / the owner's final complete or failed result. Progress is visible evidence, not Strategy readiness; final complete matching context is still required. Received data survives a later failure. Pending UI and join waits have a three-minute inactivity bound extended by saved progress; Events category calls have their own three-minute deadline. Neither promises that the whole Briefing finishes within three minutes. |
| **revision** | A record version used for optimistic edits or removal checks. It is not interchangeable with an observation timestamp. |
| **idempotency / duplicate delivery** | Replaying the same operation without a second effect. This differs from deciding whether similar observations represent one real-world offer. |
| **SSE / notification** | A signal telling a consumer to read current saved state. Receipt of the signal does not itself prove pipeline completion. |
| **schema mirror** | `shared/schema.js`, the declared ORM shape. Applied SQL, the actual catalog and the mirror must be compared; one alone does not prove all environments match. |
| **migration ledger** | Recorded migration filenames/checksums. A `baseline=true` row means recorded without execution; it does not prove reference-data effects. |
| **implemented / tested / deployed** | A source change exists / specified checks actually passed / the identified running release contains it. Record these as separate statuses. |
| **unknown / zero / empty** | Missing evidence / a measured or explicitly reported numeric zero / a collection with no returned records. Do not substitute one for another. |

## Shared infrastructure terms

| Term | Meaning and source |
|---|---|
| **venue catalog** | Shared persisted place identity/evidence used by multiple pipelines; not an exclusive synonym for Bars/Lounges. See [venue contracts](docs/architecture/VENUES.md). |
| **place ID / venue ID / coordinate key** | Provider place identity / internal database identity / a coordinate lookup key. These serve different purposes; six-decimal formatting does not measure GPS accuracy. See [location](docs/architecture/LOCATION.md) and [venues](docs/architecture/VENUES.md). |
| **discovered event** | An observed event with venue/date/time/source evidence. It differs from a work offer and from an internal message/event callback. See [event pipeline](server/lib/events/pipeline/README.md). |
| **role / model / adapter** | A task responsibility / a configured provider model / the code implementing its call contract. See [registry](server/lib/ai/model-registry.js) and [adapters](server/lib/ai/adapters/index.js). |
| **thoughtSignature** | Gemini's opaque encoded thinking metadata, attached to a response part. This is the large “thinking ID” Melody identified on October 11; it is separate from readable answer text, requested venue/staging descriptions, and `responseId`. One-shot text requests can omit it with a response field mask while keeping HIGH thinking. Preserve signatures when returning model history for continued function calls. See [Google's signature contract](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures) and the [Gemini adapter](server/lib/ai/adapters/gemini-adapter.js). |
| **responseId** | Google's identifier for a generated response. It is separate from `thoughtSignature`, a venue/place ID, and application run or generation IDs. |
| **thinkingLevel** | A model-specific control for reasoning effort, such as LOW, MEDIUM or HIGH. Omitting response metadata does not change this setting or remove the model's thinking time. `includeThoughts` controls readable thought summaries; it is not a signature-omission switch. See [Google's thinking guide](https://ai.google.dev/gemini-api/docs/generate-content/thinking). |
| **Gateway** | The application HTTP entry and startup lifecycle in [gateway-server.js](gateway-server.js). Startup includes database migrations. |
| **Agent / Eidolon** | Existing development/workspace integration names. These do not name Coach, Offer Analyzer or a phone permission level. Consult their actual entry points and access checks before using capabilities. |
| **MCP** | The tool protocol used by [mcp-server.js](mcp-server.js), including project continuity tools. A successful tool read retrieves particular saved records; it does not transfer another chat's entire memory. |
| **JWT / RLS** | An authentication token format / PostgreSQL row-level security. These are different layers. Their definitions do not establish that every current route or table is protected; consult [authentication](docs/architecture/AUTH.md) and [security](docs/architecture/SECURITY.md). |
| **Google Places / Routes / FAA NAS** | Place evidence / measured route information / aviation disruption observations. Airport uses the FAA NAS national airport-events JSON feed; the existing client filename retains `asws` for compatibility. A successful response from one source does not substitute for missing evidence from another. See [venues](docs/architecture/VENUES.md) and [FAA client](server/lib/external/faa-asws.js). |

## Names by surface

| Surface | Convention and boundary |
|---|---|
| UI feature labels, current prose, agent reports | `Offer Analyzer` in full. `offers` remains valid for tracked records. |
| Database | Preserve existing table and column identifiers such as `offer_intelligence`, `offer_outcomes`, `driver_decision`. Renaming a feature label does not migrate stored data. |
| Routes and hooks | `/api/offer-analyzer` names the feature API; `/api/hooks/analyze-offer` names the action; child `/offers` routes name record collections. Keep deployed contracts compatible. |
| Modules and functions | `OfferAnalyzerPage` names the feature page; `parseOfferText`, `offer-patterns` and record-oriented `offers/` paths describe their data/action. Semantic use determines correctness. |
| Model calls | Role keys such as `OFFER_ANALYZER`, `STRATEGY_TACTICAL`, `VENUE_SCORER` identify responsibilities. Resolve provider/model settings through the registry. |
| Legacy names | Retain exact historical identifiers where compatibility or evidence requires them; explain their meaning rather than silently assigning them a new one. |

The proposed automatic collection event contract uses integer minor currency
units, meters and seconds. Those proposed units are **not** the current stored
Offer Analyzer dollar/mile/minute fields. Its durable outbox, notification
adapter and area-coverage metrics remain separate implementation work; naming
them here does not mean they are running.

For actual checks and open acceptance work, use the
[current readiness map](docs/architecture/audits/PIPELINE_READINESS_2026-10-04.md). Older naming and
standards documents may describe historical intent or unverified enforcement;
the current user correction and verified source take precedence.
