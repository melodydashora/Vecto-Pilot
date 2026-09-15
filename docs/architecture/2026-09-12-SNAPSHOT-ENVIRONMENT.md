# Snapshot environment authority, September 12, 2026

Provenance: Desktop Astra implementation of Melody's explicit GPS-first,
complete-quality-data and schema-preservation requirements. Existing columns
and tables are unchanged. This document describes the isolated review candidate.

## Source boundary

The previous full V1 route accepted browser-resolved labels and browser weather
and air objects. The enrichment PATCH also trusted those objects. The air GET
could turn an absent index into AQI zero and label missing categories Unknown.
These paths could satisfy a structural completeness check without measurements.

Full V1 creation now reads location labels/timezone from the exact six-decimal
`coords_cache` key. A missing row requires resolution first. Minimal creation
still resolves through Google, using normalized coordinates. Both V1 and legacy
creation use server creation time; supplied browser time cannot make data fresh.
V1 saves pending weather/air for subsequent enrichment. Legacy creation obtains
its environment directly from the same server provider service.

`snapshot-environment.js` provides current Google Weather and Universal AQI
measurements. Header GETs and persistence share that service. A one-minute cache
with at most 256 entries uses exact six-decimal keys, shares concurrent requests,
returns independent copies, and never serves expired values after failure.
Missing values, descriptions, provider timestamps, credentials or HTTP success
are explicit failures. Numeric zero is preserved. Fahrenheit is not converted
twice. No measurement, category or observation time is fabricated.

The existing weather and air JSON objects each carry a `source` object:
`provider`, `coord_key`, `fetched_at` (actual server retrieval time) and
`observed_at` (the provider's measurement time). Creation and readiness require
these receipts. Receipt labels alone are not a cryptographic attestation; the
HTTP boundary supplies them server-side and ignores browser enrichment objects.

Observation limits chosen for this implementation are 30 minutes for current
weather and two hours for hourly air quality. Future observations beyond five
seconds are rejected. Cache retrieval can precede snapshot creation by at most
one minute. These are application quality limits, not claimed provider SLAs.
Historical records retain their original times; reading one never retimestamps
it as a new measurement.

## Immutability and client behavior

`enrichSnapshot` receives the owned saved row and authenticated user identity.
Provider work runs outside its transaction. A short `FOR UPDATE` transaction
rechecks owner and coordinate identity, writes both sections and computed status
together, and returns the persisted row. A delayed request reuses the first
complete snapshot; it cannot change conditions beneath Briefing or Strategy.
A formerly complete legacy row without valid receipts requires a new snapshot
and stays intact as historical data. No bulk data repair or migration occurs.
The unused legacy Strategy retry endpoint also returns `409`,
`fresh_location_required`, `retry: new_snapshot`; it no longer copies old GPS,
weather and air into a row with a new creation timestamp. Ownership checks remain.

The browser PATCH sends an empty object. A ready result must include the saved
measurements. The header then adopts those values before publishing
`vecto-snapshot-saved`. Provisional GET results cannot unlock the waterfall.
Failed preliminary GETs may recover through the server enrichment attempt.
All generation guards remain in place for GPS refreshes and late responses.

The current-weather GET no longer fetches an unused forecast. Current callers
use that GET for the header; the independent Briefing weather pipeline remains
the owner of the forecast and its quality gate. No forecast UI is removed.

## Verification and limits

Tests exercise the actual HTTP routes, actual Drizzle SQL through PGlite,
overlapping provider completions, foreign coordinate receipts, legacy rows,
missing/zero observations, cache expiry/failure and the client readiness event.
Provider responses and GPS in these tests are synthetic. No driver records or
real phone sensors are used. The private candidate integration receipt records
which build and runtime checks actually ran; this document is not itself proof.

Six decimal places preserve coordinate representation and identity; they do not
make a phone sensor accurate to eleven centimeters. The existing measured GPS
accuracy/freshness checks remain separate. Physical phone/voice/shortcut
verification and integration into main remain separate work.

Provider contracts checked September 12:
[Google Weather current conditions](https://developers.google.com/maps/documentation/weather/current-conditions)
documents `currentTime` and temperature units;
[Google Air Quality current conditions](https://developers.google.com/maps/documentation/air-quality/current-conditions)
documents hourly observations, `dateTime` and the Universal AQI index.
