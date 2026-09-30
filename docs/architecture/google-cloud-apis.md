# Google APIs: source-backed inventory

Reviewed September 29, 2026 against application source and current official Google documentation. This replaces the earlier speculative API catalog. Melody's console list is evidence of reported enablement/usage, not proof that every listed service accepts the same key, has the necessary IAM permissions, or is called by this application. This review made no live provider requests and changed no credentials, service enablement, or model pins.

## Calls present in the application

| API | Actual source and purpose | Credential selection in source |
|---|---|---|
| Places API (New) | [Strategy venue enrichment](../../server/lib/venue/venue-enrichment.js): Text Search for missing identities, exact-ID Details for catalog hits. [Bars discovery](../../server/lib/venue/venue-intelligence.js): Nearby Search. [Shared address resolver](../../server/lib/venue/venue-address-resolver.js): event/Concierge venue identity. [Analyzer](../../server/api/offer-analyzer/index.js): separate Places request. | `GOOGLE_MAPS_API_KEY` |
| Routes API | [routes-api.js](../../server/lib/external/routes-api.js): `computeRouteMatrix` and singleton `computeRoutes`; traffic-aware driving measurements for Strategy venues. Route Matrix is a Routes API method, not a second legacy Distance Matrix integration. | `GOOGLE_MAPS_API_KEY` |
| Geocoding API | [geocode.js](../../server/lib/location/geocode.js), [location routes](../../server/api/location/location.js), and [event geocoding](../../server/lib/events/pipeline/geocodeEvent.js): address/GPS resolution. | `GOOGLE_MAPS_API_KEY` |
| Time Zone API | [geocode.js](../../server/lib/location/geocode.js) and [resolveTimezone.js](../../server/lib/location/resolveTimezone.js): location and venue IANA zones. Strategy Places results additionally request the place's own `timeZone.id`. | `GOOGLE_MAPS_API_KEY` |
| Weather API | [snapshot-environment.js](../../server/lib/location/snapshot-environment.js): current conditions for an admitted snapshot. [Briefing weather](../../server/lib/briefing/pipelines/weather.js): current conditions plus hourly forecast, written by the Briefing owner. | `GOOGLE_MAPS_API_KEY` |
| Air Quality API | [snapshot-environment.js](../../server/lib/location/snapshot-environment.js): current universal AQI and provider timestamp. | `GOOGLEAQ_API_KEY` |
| Maps JavaScript API | [google-maps-loader.ts](../../client/src/lib/maps/google-maps-loader.ts) → [StrategyMap.tsx](../../client/src/components/strategy/StrategyMap.tsx): browser map, venue/event/bar markers. This API is already used. | `VITE_GOOGLE_MAPS_API_KEY`; optional `VITE_GOOGLE_MAPS_MAP_ID` |
| Gemini API | [Gemini adapter](../../server/lib/ai/adapters/gemini-adapter.js), [Live adapter](../../server/lib/ai/adapters/gemini-live-adapter.js), and [model registry](../../server/lib/ai/model-registry.js): role-based model dispatch, configured search grounding, and voice-session support. | `GEMINI_API_KEY`; exact role/model/tool contract is owned by the registry/adapters |
| Address Validation API | [address-validation.js](../../server/lib/location/address-validation.js), called by [registration](../../server/api/auth/auth.js). Present in code despite no requests shown in the supplied console excerpt. A `skipped` result is not successful address verification. | `GOOGLE_MAPS_API_KEY` |
| Pollen API | Mounted `/api/location/pollen` in [location.js](../../server/api/location/location.js); not part of the MAIN waterfall. A mounted route does not establish current UI usage or successful provider access. | `GOOGLE_MAPS_API_KEY` |

No direct Map Tiles REST call was found in this application. Browser Maps can load map resources, but source inspection cannot attribute the reported Map Tiles billing/usage to this app. The old [Street View helper](../../server/lib/external/streetview-api.js) has no active venue caller; server-key-bearing image URLs were removed, and venue responses deliberately return `streetViewUrl: null`. The unrendered `TacticalStagingMap` is not evidence that two map loaders run together.

The reported Agent Platform, Compute Engine, cloud administration, storage, analytics, fleet, and other services are not automatically application integrations. Their presence in the console does not justify adding SDKs, credentials, or paid calls.

## Contracts enforced by the repaired paths

- **One venue identity throughout.** Resolve names through Google/catalog; reuse the current Text Search result or refresh the exact saved place ID. Address, coordinates, country, hours, timezone, route destination and event linkage belong to that same identity. Place Details supports `location`; the former claim that Details cannot return coordinates was incorrect. [Place Details reference](https://developers.google.com/maps/documentation/places/web-service/place-details).
- **Explicit field masks.** Strategy and Bars Places requests select identity, address components, status, hours, location and `timeZone`. The place's validated IANA zone supplies local hours evaluation and catalog promotion; an absent zone remains unknown. Fresh `openNow` is a provider observation, including current opening hours. [Place and opening-hours schema](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places).
- **Place IDs are opaque.** No `ChIJ` prefix requirement governs Strategy/event identity lookup. Different explicit IDs cannot silently merge by name or shared coordinates. Google documents varying ID formats and possible changes over time; a changed identity must be resolved explicitly. [Place IDs](https://developers.google.com/maps/documentation/places/web-service/place-id).
- **A failed route has no distance/time.** Route Matrix checks both `status` and `condition`, validates indices, and requires usable metrics for successful cells. `ROUTE_NOT_FOUND` does not mean zero miles. Missing cells/provider failures may use singleton Routes; explicitly failed cells are excluded. [Route Matrix response](https://developers.google.com/maps/documentation/routes/understand-rm-response), [method reference](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRouteMatrix).
- **Route options belong to the cache key.** Singleton route cache includes exact coordinates, travel mode, routing preference and optional departure time. Identical concurrent uncancelled calls share work; provider reads have deadlines. Omitted departure means now. The existing internal option named `trafficModel` supplies `routingPreference`; it is not Google's distinct `BEST_GUESS` traffic-model enum. [Traffic model documentation](https://developers.google.com/maps/documentation/routes/traffic-model).
- **Weather is measured, not reconstructed.** Typed temperature and `wind.speed.value/unit` are normalized; `currentTime` and hourly `interval.startTime` come from Google. Missing fields are not zero, timestamps are not runtime plus an array index, and provider failure cannot become “clear weather.” [Current conditions](https://developers.google.com/maps/documentation/weather/reference/rest/v1/currentConditions/lookup), [hourly forecast](https://developers.google.com/maps/documentation/weather/reference/rest/v1/forecast.hours/lookup), [wind](https://developers.google.com/maps/documentation/weather/reference/rest/v1/Wind).
- **Nearby discovery retains observation truth.** Bars uses provider-local hours/current open observations, validates classification and never derives a live crowd count from ratings. Concurrent identical discovery requests share work; catalog hours freshness has its own receipt instead of borrowing any row update. Provider failure remains unavailable. [Nearby Search](https://developers.google.com/maps/documentation/places/web-service/nearby-search).
- **Reads do not restart owned generation.** The saved Briefing weather endpoint reads the current/forecast pair and reports pending/error truth. Saved venue mapping uses persisted canonical addresses. Raw `fetch*` functions and write-owning `discover*` functions are intentional layers, not duplicate pipelines merely because their names overlap.

## Useful capabilities to assess after contract verification

| Capability | Concrete driver benefit | Current boundary |
|---|---|---|
| [Weather public alerts](https://developers.google.com/maps/documentation/weather/weather-alerts) | Authoritative severe-weather alerts could supplement the spoken coach and route caution. | Not implemented here; must preserve provider severity, area and validity period rather than infer them from a forecast. |
| [Places routing summaries](https://developers.google.com/maps/documentation/places/web-service/routing-summary) | Text/Nearby searches can return origin-relative route summaries, potentially reducing a later route request when the same candidates are selected. | Not wired. Summary order corresponds to Places results; empty summaries are unavailable, not zero. Assess field-mask/billing and traffic equivalence before replacing current Routes measurements. |
| [Google Maps grounding for Gemini](https://ai.google.dev/gemini-api/docs/maps-grounding) | Grounded local facts/citations may support venue discovery or Coach answers. | Current Search grounding is not Maps grounding. Model/tool compatibility and entitlement must be verified for the exact registry role; enabling another service alone does not establish support. |

There is no reason to add legacy Directions/Distance Matrix alongside the working Routes adapter. Solar is not a general daylight API, and a routing or imagery API is not evidence of safe road surfaces. No service here establishes ride earnings, a safe pickup location, or future surge on its own.

Do not copy old flat per-request prices or monthly estimates: selected fields, request mode, units/elements, region and current billing rules matter. Review the [current Google Maps pricing list](https://developers.google.com/maps/billing-and-pricing/pricing) for a concrete proposed request. This document records source usage, not a billing audit.

See [VENUES.md](VENUES.md) for the canonical venue trace and [the ordered review](audits/PIPELINE_REVIEW_2026-09-29.md) for current verification and independent-pipeline findings.

### Map marker interaction contract (September 29 follow-through)

[Google's Advanced Markers reference](https://developers.google.com/maps/documentation/javascript/reference/advanced-markers)
requires DOM `addEventListener` for `gmp-click` and `gmpClickable: true` for
interactive markers. StrategyMap's old Maps `addListener('gmp-click')` pairing
was unsupported. The corrected surface uses the documented DOM event contract;
synthetic map tests distinguish it from the legacy Maps event method. This is a
client contract check, not a claim of a live map-tile or billing test.
