# Venue module

Source-checked September 29, 2026. The canonical [venue pipeline trace](../../../docs/architecture/VENUES.md)
covers MAIN planning, Google Places identity, Routes, opening hours, saved results
and the independent Bars/Lounges pipeline. [Verification findings](../../../docs/architecture/VENUES_PIPELINE_AUDIT.md)
record the corrected contracts and remaining rollout limits.

| Source | Responsibility |
|---|---|
| [enhanced-smart-blocks.js](enhanced-smart-blocks.js) | Orchestrates recommendations from saved Strategy through verification and publication. |
| [tactical-planner.js](../strategy/tactical-planner.js) | Model candidate planning; model text is not a coordinate or opening-hours authority. |
| [venue-address-resolver.js](venue-address-resolver.js) | Resolves a particular venue identity with verified Google data. |
| [venue-cache.js](venue-cache.js) | Shared catalog writes and identity lookup; colocated businesses must not overwrite each other. |
| [venue-enrichment.js](venue-enrichment.js) | Preserves verified identity while enriching candidates. |
| [venue-intelligence.js](venue-intelligence.js) | Independent nearby Bars/Lounges discovery, classification and saved provider observations. |
| [hours/](hours/) | Canonical schedule parsing and opening status in the venue's timezone. |
| [event-matcher.js](event-matcher.js) | Links verified saved event evidence to candidates. |

`venue_catalog` owns verified place identity and coordinates; `discovered_events`
links event reports to it. Coordinates or a street address alone do not uniquely
identify a business. Provider observations have freshness limits: finding a saved
row does not mean Places will never be called again. Missing hours/timezone,
route failures, unknown price and unknown demand remain unknown. The removed
`venue-event-verifier.js` did not produce evidence and is not a live stage.
