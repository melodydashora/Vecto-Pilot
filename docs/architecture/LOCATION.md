# LOCATION.md — Location Services BRD + FRD

> **Canonical reference** for GPS resolution, geocoding, weather / air-quality / pollen enrichment, snapshot creation, and the coords-cache layer.
> Last updated: 2026-04-21
> Source of truth: `server/api/location/location.js` (+ shared helpers in `server/lib/location/`)

This document combines the **Business Requirements Document (BRD)** and the **Functional Requirements Document (FRD)** for the Location Services subsystem. The BRD states *why* each rule exists; the FRD specifies *how* the code implements it. Every rule is traceable to the source file cited at the top.

---

## Table of Contents

- [Part A — Business Requirements Document (BRD)](#part-a--business-requirements-document-brd)
  - [A1. Purpose & Business Context](#a1-purpose--business-context)
  - [A2. Stakeholders](#a2-stakeholders)
  - [A3. Business Objectives](#a3-business-objectives)
  - [A4. Success Metrics / KPIs](#a4-success-metrics--kpis)
  - [A5. Business Rules (the "why")](#a5-business-rules-the-why)
  - [A6. Compliance, Privacy & Security Posture](#a6-compliance-privacy--security-posture)
  - [A7. Out of Scope](#a7-out-of-scope)
- [Part B — Functional Requirements Document (FRD)](#part-b--functional-requirements-document-frd)
  - [B1. System Overview](#b1-system-overview)
  - [B2. External Dependencies](#b2-external-dependencies)
  - [B3. Authentication Contract](#b3-authentication-contract)
  - [B4. Data Model](#b4-data-model)
  - [B5. Endpoint Specifications](#b5-endpoint-specifications)
  - [B6. Cache Layer (`coords_cache`)](#b6-cache-layer-coords_cache)
  - [B7. Snapshot Lifecycle](#b7-snapshot-lifecycle)
  - [B8. Timezone Resolution Waterfall](#b8-timezone-resolution-waterfall)
  - [B9. Address Extraction Rules](#b9-address-extraction-rules)
  - [B10. Circuit Breakers & Fail-Fast Policy](#b10-circuit-breakers--fail-fast-policy)
  - [B11. Rate Limiting](#b11-rate-limiting)
  - [B12. Error Taxonomy](#b12-error-taxonomy)
  - [B13. Integration Points](#b13-integration-points)
- [Part C — Non-Functional Requirements (NFR)](#part-c--non-functional-requirements-nfr)
- [Part D — Known Gaps & TODO](#part-d--known-gaps--todo)
- [Appendix: Dated Change Log](#appendix-dated-change-log)

---

# Part A — Business Requirements Document (BRD)

## A1. Purpose & Business Context

Vecto-Pilot is a rideshare coaching product that tells drivers *where and when* to position themselves. Every recommendation is grounded in a **location snapshot**: the driver's precise GPS coordinates, resolved street address, timezone-aware local time, and ambient context (weather, air quality, pollen, airport disruptions, holidays). Without a complete and trustworthy snapshot, the briefing pipeline, strategy generator, and block ranker all produce wrong or poisoned output.

Location Services is the subsystem that owns this snapshot. It is the single source of truth for *"where is the driver right now, and what does that mean?"* Everything downstream (`/api/blocks-fast`, briefings, strategies, event discovery, venue intel) reads from the `snapshots`, `users`, and `coords_cache` tables that this subsystem populates.

## A2. Stakeholders

| Stakeholder | Interest |
|---|---|
| **Rideshare drivers** (end users) | Need fast, accurate local recommendations; cannot tolerate "undefined, undefined" displays or 5-minute delays while APIs retry |
| **Rideshare Coach (Gemini)** | Reads `snapshots`, `users`, `coords_cache`, `markets` to give live in-session advice; writes venue/zone intel back based on driver feedback |
| **Briefing pipeline** (`server/lib/briefing/briefing-service.js`) | Consumer of `snapshot_id`; requires `city`, `state`, `timezone`, `lat`, `lng`, `local_iso` all populated |
| **Strategy generator** (`server/lib/strategy/strategy-generator.js`) | Consumer of enriched snapshot; requires `weather`, `air`, `holiday`, `day_part_key`, `h3_r8` |
| **Melody (product owner)** | Operates a live Replit deployment; cannot afford silent location failures poisoning paying users' sessions |
| **Google Maps Platform** | Paid dependency — geocoding, timezone, weather, air quality, pollen are metered APIs with quota limits |

## A3. Business Objectives

1. **Deliver a complete snapshot in < 2 seconds** from GPS acquisition (cache hit) or < 5 seconds (cold API lookup).
2. **Zero tolerance for fabricated or guessed location/time data.** Every field is either resolved from a canonical source (Google API, `markets` table, `coords_cache`) or the request fails loudly.
3. **Minimize paid Google API calls** through the 6-decimal-precision `coords_cache` hit-counter and the 102-market timezone fast path.
4. **One snapshot per authenticated session.** Drift, re-renders, and tab focus events must NOT create duplicate snapshots; only explicit user refresh or city change should.
5. **Auth-gate every route.** No anonymous geocoding / snapshot creation — this subsystem is a spend lever and a PII sink.
6. **Preserve driver local time** for everything the driver sees (never UTC, never server time).

## A4. Success Metrics / KPIs

| Metric | Target | How Measured |
|---|---|---|
| `coords_cache` hit rate | > 70% steady-state | `hit_count` sum / total `/resolve` calls |
| Timezone fast-path hit rate | > 85% in US markets | `resolveTimezoneFromMarket` success vs. Google Timezone API calls |
| Snapshot reuse rate per session | > 90% after first resolve | `snapshot_reused: true` in `/resolve` responses |
| Median latency `/resolve` (cache hit) | < 200 ms | server logs |
| Median latency `/resolve` (cold) | < 1500 ms | server logs |
| Fail-hard rate on incomplete snapshots | 100% (no partial writes) | absence of NULL required fields in `snapshots` |
| Google API error bubbling | 100% (never swallowed) | 502 responses emit `code` + `apiStatus` |

## A5. Business Rules (the "why")

These are the non-negotiable invariants encoded in `location.js`. Each has a reason-for-existence rooted in a past incident or a downstream consumer constraint.

### BR-1 — NO FALLBACKS on timezone, address, or coordinates
Server timezone, server-inferred city, and fabricated coordinates are **forbidden**. Every field must come from Google's authoritative APIs, the `markets` table, or the `coords_cache`. **Why:** server timezone drift silently poisons the strategy generator — what looks like a Dallas driver is calculated against UTC day-parts, producing "3 AM recommendations at 10 PM local." Incident referenced at `location.js:387–405, 475–488` (2026-01-06, 2026-01-09 P0-1).

### BR-2 — All routes require authentication
`router.use(requireAuth)` at the top of `location.js` (line ~30, 2026-02-12 security fix). **Why:** geocoding is a paid API (cost lever) *and* location data is PII. Anonymous callers could both drain budget and exfiltrate driver paths. Additionally, the prior `?user_id=X` query-param bypass (removed 2026-01-09, P0-2) allowed impersonation — signature-verified bearer token is now the only authentication channel.

### BR-3 — One snapshot per authenticated session
A snapshot is reused across GPS drift, re-renders, and tab focus events. New snapshots are created only on:
- Explicit `force=true` refresh
- City-boundary crossing (Frisco → Dallas)
- 60-minute TTL expiration
- Logout / login cycle

**Why:** every snapshot fans out through `blocks-fast`, triggering briefing generation, strategy calls, and event discovery. Duplicate snapshots = duplicate spend + duplicate SSE streams + stale UI.

### BR-4 — Snapshot city change invalidates reuse
When `existingSnapshot.city.toLowerCase() !== city.toLowerCase()`, the snapshot is regenerated even if age < TTL (location.js:1048–1052, 2026-01-31 fix). **Why:** a driver commuting Frisco→Dallas must receive Dallas venue recommendations immediately; stale briefings from the previous market mislead the strategy generator.

### BR-5 — Driver local time, not UTC
`local_iso` stores the driver's wall-clock time by creating a `Date` whose *UTC value* equals the local time string. See `toLocalTimestamp()` at `location.js:45` (2026-02-17 fix). **Why:** Drizzle serializes `Date` via `.toISOString()` into `timestamp without timezone` columns; storing UTC there mis-reports "11 PM local" as "4 AM next-day UTC" — every day-part heuristic breaks.

### BR-6 — No session_id writes from location API
Location API is **forbidden** from touching `users.session_id`. Only `/api/auth/login`, `/api/auth/logout`, and auth middleware own that column (`location.js:828–833`, 2026-01-07). **Why:** a prior bug overwrote `session_id` with NULL from an absent query param, invalidating users' sessions the moment they accepted GPS. Documented in `LESSONS_LEARNED.md` as "Auth Loop on Login."

### BR-7 — Market-before-Google timezone resolution
When `city + state + country` match a row in `markets` (or a city alias), use the stored IANA zone; otherwise call Google Timezone API (`location.js:690–728`, 2026-02-17). **Why:** ~5 ms DB lookup vs. ~250 ms Google round-trip and ~$0.005 per call, with >85% hit rate in supported markets.

### BR-8 — Google OAuth market backfill on first GPS use
If a user has `driver_profiles.market = NULL` (Google OAuth users before profile completion) AND the current GPS resolves to a known market, backfill `market` + `home_timezone` on the profile (`location.js:1130–1147`, 2026-02-17). **Why:** OAuth skips the registration market-picker form, so the first usable GPS snapshot is the correct moment to populate the missing profile fields.

### BR-9 — Fail hard on incomplete geocode results
If Google returns `OK` but no `formatted_address`, `city`, or `state`, the request **must** 502-fail, not continue with `undefined` values (`location.js:601–650`, 2026-02-01). **Why:** `snapshots` has NOT NULL constraints on those columns; a silently-incomplete geocode propagates as `"undefined, undefined"` in the UI or a Postgres insert error at the *end* of the pipeline after expensive downstream calls.

### BR-10 — Six-decimal coordinate precision
`coord_key` rounds to 6 decimals (~11 cm). See `server/lib/location/coords-key.js` used by `makeCoordsKey()`. **Why:** 6 decimals is precise enough to distinguish "exact parking spot at DFW terminal B2 gate" from "spot one row over" for density analysis, but coarse enough to let a driver returning to the same pickup point re-hit cache.

### BR-11 — ISO alpha-2 country codes
`pickAddressParts()` reads `c.short_name` for country — "US", "CA", "GB" — not "United States" (`location.js:83`, 2026-01-10 D-011 fix). **Why:** downstream holiday detection, market lookup, and FAA disruption queries all key on ISO codes.

### BR-12 — Plus Code filtering prefers street addresses
Reverse geocode may return Plus Codes like `"35WJ+64 Dallas, TX"` as the first result; `pickBestGeocodeResult()` skips them and prefers `street_address`, `premise`, `route`, or `establishment` (`location.js:124–145`). **Why:** venue names and driver-visible "current location" strings read better with street addresses, and ML pattern matching against `venue_catalog` works against addresses not grid codes.

### BR-13 — Private IPs never return hardcoded coordinates
`/api/location/ip` returns `{ok: false, source: 'none'}` for localhost/10.x/192.168.x/172.x — never a hardcoded US fallback (`location.js:1806–1820`, 2026-04-05 global-app fix). **Why:** embedded previews and iframes often serve private IPs; returning "somewhere in Kansas" would silently place a London user in the wrong country.

### BR-14 — All findings are high priority
Per CLAUDE.md Rule 9: this repo is a "how to code with AI" reference implementation. Every audit finding from Claude, Gemini, or human review is resolved or tracked in `docs/DOC_DISCREPANCIES.md`. Duplicate logic (e.g., four copies of `makeCoordsKey`, consolidated 2026-01-10) is treated as a bug, not tech debt.

## A6. Compliance, Privacy & Security Posture

- **PII scope:** latitude, longitude, IP, formatted street address, device_id, session_id, user_id.
- **At-rest encryption:** PostgreSQL is Replit Helium with TLS in production (Rule 13, `DATABASE_URL`-only).
- **In-transit:** HTTPS only; HMAC-signed bearer token (`userId.signature`, *not* a standard JWT — see AUTH.md §2).
- **Secrets:** `GOOGLE_MAPS_API_KEY`, `GOOGLEAQ_API_KEY`, `JWT_SECRET` (or `REPLIT_DEVSERVER_INTERNAL_ID` fallback). No hardcoded dev secrets as of the 2026-03-17 F-10 fix.
- **SSRF defense:** `sanitizeIp()` and `sanitizeString()` from `server/lib/utils/sanitize.js` sanitize every query-param used in an outbound URL (2026-04-05 CodeQL fixes).
- **Bot blocking:** `server/middleware/bot-blocker.js` 403s requests with non-browser User-Agents. Testing requires passing a realistic `User-Agent` header (documented in CLAUDE.md § Workflow Control).
- **Rate limiting:** 10 geocoding requests / minute / IP (see B11).
- **No session_id leakage:** location routes never read or write `users.session_id`.

## A7. Out of Scope

- **Background event syncing** — *forbidden* per CLAUDE.md Rule 11. Events sync per-snapshot through the briefing pipeline, not from this router.
- **Strategy generation** — triggered by `/api/blocks-fast`, not from `/resolve` or `/snapshot`.
- **Session lifecycle** — `session_id`, `last_active_at` beyond `/snapshot` updates, login, logout — all owned by `server/api/auth/auth.js`.
- **Briefing generation** — owned by `server/lib/briefing/briefing-service.js`; this router only forwards `snapshot_id`.
- **Venue intelligence** — owned by `server/lib/venue/*` and the Rideshare Coach write path.

---

# Part B — Functional Requirements Document (FRD)

## B1. System Overview

```
                                   ┌───────────────────────────────┐
                                   │     Client (React SPA)        │
                                   │  - auth-context.tsx           │
                                   │  - CoPilotContext             │
                                   └──────────────┬────────────────┘
                                                  │  HTTPS + Bearer token
                                                  ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │              server/api/location/location.js  (this router)         │
   │                                                                      │
   │   requireAuth  →  validateBody/validateQuery  →  handler            │
   │                                                                      │
   │   /geocode/reverse  /geocode/forward  /timezone                      │
   │   /resolve  /weather  /airquality  /pollen                          │
   │   /snapshot (POST)  /snapshot/:id/enrich (PATCH)                    │
   │   /release-snapshot  /ip  /users/me  /snapshots/:id                 │
   │   /news-briefing                                                     │
   └──────────┬────────────────────┬─────────────────┬──────────────────┘
              │                    │                 │
              ▼                    ▼                 ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │ Google Maps      │  │ Shared helpers    │  │ Drizzle ORM       │
   │ - Geocoding      │  │ coords-key.js     │  │ tables:           │
   │ - Timezone       │  │ daypart.js        │  │  users            │
   │ - Weather        │  │ resolveTimezone.js│  │  snapshots        │
   │ Google Air Quality│  │ validation-gates  │  │  coords_cache     │
   │ Google Pollen    │  │ holiday-detector  │  │  markets          │
   │ FAA ASWS         │  │ faa-asws          │  │  driver_profiles  │
   │ ip-api.com       │  │                   │  │  travel_disruptions│
   └──────────────────┘  └──────────────────┘  └──────────────────┘
```

**Key architectural decisions:**
- Single Replit Helium `DATABASE_URL` (CLAUDE.md Rule 13) — no manual env swapping.
- Model-agnostic adapters (Rule 14) — not directly used by this router.
- Circuit-breaker-wrapped external calls (`makeCircuit`); no internal fetch without breaker.
- All routes protected by `requireAuth` middleware.

## B2. External Dependencies

| Dependency | Purpose | Key/Config | Circuit | Timeout |
|---|---|---|---|---|
| Google Geocoding API | Forward & reverse geocode | `GOOGLE_MAPS_API_KEY` | `googleMapsCircuit` | 5 s |
| Google Timezone API | IANA zone for lat/lng | `GOOGLE_MAPS_API_KEY` | `googleMapsCircuit` | 5 s |
| Google Weather API | Current + 6-hour forecast | `GOOGLE_MAPS_API_KEY` | (direct `fetch`) | — |
| Google Air Quality API | Current AQI + pollutants | `GOOGLEAQ_API_KEY` | `googleAQCircuit` | 3 s |
| Google Pollen API | Daily forecast, severity 1–5 | `GOOGLE_MAPS_API_KEY` | (direct `fetch`) | — |
| FAA ASWS | Airport delay / closure | *internal helper* | `server/lib/external/faa-asws.js` | — |
| ip-api.com | IP-based fallback geolocation | (no key required) | direct `fetch`, 5 s timeout | 5 s |
| h3-js | Geohash resolution 8 | npm package | n/a | n/a |

**Circuit breaker config** (`makeCircuit`, `server/util/circuit.js`):
- Google Maps: 3 failures → open for 30 s; 5 s per-call timeout.
- Google Air Quality: 3 failures → open for 30 s; 3 s per-call timeout.

## B3. Authentication Contract

| Rule | Detail |
|---|---|
| All routes require auth | `router.use(requireAuth)` at top of `location.js` |
| Token format | `{userId}.{hmacSignature}` (HMAC-SHA256, *not* JWT) |
| Secret source | `process.env.JWT_SECRET || process.env.REPLIT_DEVSERVER_INTERNAL_ID` |
| Header | `Authorization: Bearer <token>` |
| Query-param auth | **Removed** as of 2026-01-09 P0-2 — formerly `?user_id=X` allowed impersonation |
| Invalid token behavior | 401 `INVALID_TOKEN` — never silently fall through to anonymous |
| Absent token behavior | 401 `AUTHENTICATION_REQUIRED` on `/resolve` |
| `session_id` management | **Forbidden from this router** — owned exclusively by `auth.js` |

The `/resolve` handler duplicates a local verification block (lines ~314–360) because it must return specific JSON shapes; the shared `requireAuth` middleware is still the canonical gate.

## B4. Data Model

### B4.1 `snapshots` — required (NOT NULL) fields
Enforced by `validateSnapshotFields()` and by schema constraints. A snapshot must have all of:

- `snapshot_id` (UUID)
- `created_at` (timestamp)
- `date` (YYYY-MM-DD in driver timezone)
- `user_id` (UUID, from `req.auth.userId`)
- `device_id`, `session_id` (UUIDs)
- `lat`, `lng` (number; validated `-90..90`, `-180..180`)
- `coord_key` (FK → `coords_cache.coord_key`)
- `city`, `state`, `formatted_address`, `timezone`
- `local_iso`, `dow`, `hour`, `day_part_key`
- `h3_r8` (geohash resolution 8)

**Readiness gate:** `PATCH /snapshot/:id/enrich` checks the required list at `location.js:1942–1950` (Memory #110, 2026-04-14) and flips `status: 'pending' → 'ok'` when all fields populate. Missing any field keeps the row pending.

### B4.2 `coords_cache` — composite identity
Key is `coord_key` (6-decimal lat_lng string). Every row must contain:

- `coord_key`, `lat`, `lng`
- `city`, `state`, `country`, `formatted_address`, `timezone`
- `hit_count` (incremented on read)

**Partial rows are rejected.** If a cache read returns a row missing any of `timezone`, `city`, `state`, or `formatted_address`, the handler discards it and forces a fresh API lookup (`location.js:526–545`).

### B4.3 `users` — mutations from this router
- `current_snapshot_id` — set by `/resolve` and `/snapshot` on create; nulled by `/release-snapshot` and `?force=true`.
- `device_id`, coordinates (`new_lat`, `new_lng`, `accuracy_m`), `coord_key`, resolved address fields, timezone, `local_iso`, `dow`, `hour`, `day_part_key`, `updated_at`.
- **Never written:** `session_id`, `last_login_at`, `last_login_ip`, `session_start_at`.
- `last_active_at` — updated only by `/snapshot` (not `/resolve`).

### B4.4 `driver_profiles` — Google OAuth backfill
`/resolve` may write `market` and `home_timezone` exactly once per user, when `driver_profiles.market IS NULL` and the current resolve produced a market match. Other columns are untouched.

### B4.5 `travel_disruptions` — FAA integration
`/snapshot` inserts a row when airport delays > 0 or closures detected. Columns: `id`, `country_code`, `airport_code`, `airport_name`, `delay_minutes`, `ground_stops`, `ground_delay_programs`, `closure_status`, `delay_reason`, `ai_summary`, `impact_level`, `data_source='FAA'`, `last_updated`.

## B5. Endpoint Specifications

All paths are prefixed `/api/location` unless noted.

### B5.1 `POST /release-snapshot`
Null the caller's `users.current_snapshot_id` before fetching fresh GPS. Called by the refresh spindle; matches logout semantics but leaves `session_id` intact (2026-02-17).

- **Request:** body ignored; identity from bearer token.
- **Success:** `200 { ok: true, message: 'Snapshot released' }`
- **Error:** `500 RELEASE_FAILED` with message.

### B5.2 `GET /geocode/reverse`
Reverse-geocode lat/lng to city/state/country + `place_id`, with Plus Code filtering.

- **Query:** `lat` (number, required), `lng` (number, required).
- **Rate limit:** 10 req/min/IP (B11).
- **Success:** `{ city, state, country, place_id, formattedAddress, lat, lng }` — lat/lng may be slightly adjusted by Google to snap to feature.
- **Errors:**
  - `400 lat/lng required` — parse failure.
  - `429 RATE_LIMIT_EXCEEDED` — over cap; includes `resetIn` seconds.
  - `500` with `error`, `details` — Google API non-OK status.

### B5.3 `GET /geocode/forward`
Forward-geocode city name to lat/lng + `place_id`.

- **Query:** `city` (string, required), e.g. `"Dallas,TX"`.
- **Success:** `{ city, state, country, place_id, coordinates: {lat, lng}, formattedAddress }`.
- **Errors:** `400 city query parameter required`, `404 City not found`, `500 Google Maps API key not configured`, `429 RATE_LIMIT_EXCEEDED`.

### B5.4 `GET /timezone`
Resolve IANA zone for coordinates (pure Google; no `markets` fast path in this endpoint).

- **Query:** `lat`, `lng`.
- **Success:** `{ timeZone, timeZoneName }`.
- **Errors (per BR-1, NO FALLBACK):**
  - `503 TIMEZONE_UNAVAILABLE code=missing_api_key` — no key configured.
  - `502 TIMEZONE_LOOKUP_FAILED code=api_error` — Google returned non-OK.
  - `502 TIMEZONE_LOOKUP_FAILED code=lookup_error` — network/timeout.

### B5.5 `GET /resolve` — the main entry point
Performs the full waterfall: cache lookup → Google Geocode → market timezone / Google Timezone → cache write → users upsert → snapshot create-or-reuse.

- **Query:**
  - `lat`, `lng` (required, number).
  - `device_id` (optional; in dev, synthesized from coords as `dev-admin-<lat>_<lng>`).
  - `accuracy` (optional, meters).
  - `session_id` (optional UUID).
  - `coord_source` (optional; default `"gps"` or `"dev-coords"` for dev devices).
  - `force` (optional, `"true"` to force a fresh snapshot — releases the old one first).
- **Request auth:** bearer token required. Invalid token → `401 INVALID_TOKEN`; no token → `401 AUTHENTICATION_REQUIRED`.
- **Success:**
  ```json
  {
    "city": "Frisco",
    "state": "TX",
    "country": "US",
    "timeZone": "America/Chicago",
    "formattedAddress": "...",
    "user_id": "<uuid>",
    "snapshot_id": "<uuid>",
    "snapshot_reused": true        // omitted when a fresh snapshot is created
  }
  ```
- **Errors:**
  - `400 lat/lng required` / `COORDINATES_OUT_OF_RANGE`.
  - `401` — auth failure (token invalid or absent).
  - `502 GEOCODE_NO_RESULTS / NO_ADDRESS / NO_CITY / NO_STATE / INCOMPLETE / API_FAILED` — Google issue.
  - `502 TIMEZONE_RESOLUTION_FAILED` — no zone from fast path OR Google.
  - `502 location_persistence_failed` — DB write did not commit.
  - `503 LOCATION_SERVICE_UNAVAILABLE` — missing API key.

### B5.6 `GET /weather`
Google Weather current conditions + 6-hour forecast. Returns Fahrenheit (°C→°F converted server-side).

- **Query:** `lat`, `lng`.
- **Success:** `{ available: true, tempF, feelsLike, conditions, description, humidity, windSpeed, windDirection, uvIndex, precipitation, visibility, isDaytime, forecast: [...] }`.
- **No data:** `{ available: false, forecast: [], reason: 'current_conditions_unavailable' }` — critical 2026-04-05 fix so clients can distinguish "no data" from "API failed" and still trigger snapshot enrichment.
- **API-key missing:** `{ available: false, error: 'API key not configured' }`.
- **Fetch failure:** `{ available: false, forecast: [], error: 'weather-fetch-failed' }`.

### B5.7 `GET /airquality`
Google Air Quality current conditions (POST `currentConditions:lookup`).

- **Query:** `lat`, `lng`.
- **Success:** `{ available: true, aqi, category, dominantPollutant, healthRecommendations, dateTime, regionCode }`.
- **Errors:** `{ available: false, error }` on API key missing / API failure / circuit open.

### B5.8 `GET /pollen`
Google Pollen forecast; `days` capped at 5.

- **Query:** `lat`, `lng`, `days` (optional, default 1, max 5).
- **Success:** `{ available: true, date, overallSeverity, overallCategory, dominantPollen, alerts, forecast, driverAlert }`.
  - `driverAlert` is a pre-formatted string for severity ≥ 3 ("⚠️ High oak levels today. Consider keeping windows closed."); null otherwise.
- **Errors:** `{ available: false, error }`.

### B5.9 `POST /snapshot`
Create a full `SnapshotV1` with parallel enrichment (airport + holiday). Two modes:

- **Minimal mode** — body has only `{ lat, lng, userId? }`. Server resolves city/state/timezone directly via Google APIs (no internal HTTP hop — would deadlock under middleware pressure).
- **Full mode** — body is a validated `SnapshotV1` object per `snapshotMinimalSchema`. Server fills in H3, airport, holiday, and writes.

- **Success:** `{ success: true, snapshot_id, h3_r8, status: 'snapshot_created', req_id }`.
- **Errors:**
  - `400 missing_lat_lng`, `invalid_coordinates`, `resolve_incomplete`, `incomplete_snapshot` (with missing-fields list).
  - `502 resolve_failed`, `timezone_resolution_failed`.
  - `503 degraded` (Retry-After header) — PostgreSQL connection manager reports degraded.
  - `500 snapshot_failed`.

**Side effects:**
- Inserts `snapshots` row.
- Updates `users.current_snapshot_id` and `last_active_at` (if user_id resolvable).
- Inserts `travel_disruptions` row if airport delays present.
- Emits a correlation ID (`req.cid` or `x-correlation-id` header) on every response.

### B5.10 `POST /news-briefing`
Generate a location-specific news briefing (delegates to `generateAndStoreBriefing`).

- **Body:** `{ latitude, longitude, address, city?, state?, country?, radius? }`.
- **Success:** `{ ok: true, briefing, generated_at, location }`.
- **Errors:** `400 missing_params`, `500 briefing_failed`.

### B5.11 `GET /ip`
IP-based geolocation fallback for iframes/embedded previews without GPS.

- **Source:** ip-api.com (no API key, 45 req/min limit); 5-second timeout.
- **IP extraction priority:** `cf-connecting-ip` → `x-real-ip` → first entry of `x-forwarded-for` → `req.ip` → `req.connection.remoteAddress`; sanitized via `sanitizeIp()` (2026-04-05 SSRF fix).
- **Private IP (127.0.0.1, ::1, 10/8, 192.168/16, 172.16/12):** returns `{ ok: false, source: 'none', reason: 'private_ip' }` — *never* hardcoded US coords (BR-13).
- **Success:** `{ latitude, longitude, city, state, country, timezone, accuracy: 5000, source: 'ip-api' }`.
- **Failure:** `{ ok: false, source: 'none', reason: 'ip_api_failed' | 'ip_lookup_error' }`.

### B5.12 `GET /users/me`
Current user's latest location straight from `users` (header calls this to bypass cached context).

- **Query:** `device_id` (required, sanitized).
- **Success:** `{ ok: true, user_id, device_id, formattedAddress, city, state, country, timeZone, lat, lng, accuracy_m, dow, hour, day_part_key, updated_at }`.
- **Fallback:** if `users` row is missing city/formatted_address, backfill from `coords_cache` via `coord_key` and fire-and-forget update `users`.
- **Errors:** `400 device_id_required`, `404 user_not_found`, `500 fetch_failed`.

### B5.13 `PATCH /snapshot/:snapshotId/enrich`
Attach weather/air to an existing snapshot; flip `status` to `ok` when complete.

- **Body:** `{ weather?, air? }` — at least one field required.
- **Success:** `{ ok: true, enriched: [...], status: 'ok' | 'pending', missingFields: [...] }`.
- **Readiness rule** (Memory #110): all of `lat, lng, city, state, timezone, local_iso, date, dow, hour, day_part_key, weather, air, market, user_id` must be non-null/non-empty.
- **Errors:** `400 snapshot_id_required / no_fields_to_update`, `404 snapshot_not_found`, `500 enrich_failed`.

### B5.14 `GET /snapshots/:snapshotId`
Fetch raw snapshot row.

- **Success:** full snapshot object.
- **Errors:** `400 snapshot_id_required`, `404 snapshot_not_found`, `500 fetch_failed`.

## B6. Cache Layer (`coords_cache`)

### B6.1 Key format
`makeCoordsKey(lat, lng)` produces a 6-decimal string from `server/lib/location/coords-key.js` (consolidated from 4 duplicates 2026-01-10). ~11 cm geographic precision.

### B6.2 Read semantics (`/resolve`)
1. Query row by `coord_key`.
2. If row missing *any* of `timezone, city, state, formatted_address`, discard it and force fresh lookup (BR-9 fail-hard → API).
3. Otherwise, use cached values and fire-and-forget `hit_count = hit_count + 1` (no-await).

### B6.3 Write semantics (`/resolve`)
After a successful API waterfall, insert with `.onConflictDoNothing()` (idempotent; first writer wins). Only inserted if *all five* of `city, state, country, formatted_address, timezone` are non-null.

### B6.4 Consistency validation
On cache hit, `/resolve` compares every field against values it would have otherwise resolved; on mismatch, it **trusts the cache** and overwrites the locally-resolved values before returning (`location.js:863–891`). This makes repeated calls for the same `coord_key` stable.

## B7. Snapshot Lifecycle

### B7.1 Create-or-reuse decision tree (`/resolve`)
```
force=true?
├── yes → NULL users.current_snapshot_id → create new
└── no → existing current_snapshot_id?
         ├── null → create new
         └── exists → fetch snapshot → compare city/state (case-insensitive)
                      ├── mismatch → create new
                      └── match → age < 60 min?
                                  ├── yes → reuse (return snapshot_reused: true)
                                  └── no → create new (stale)
```

### B7.2 Reuse TTL
`SNAPSHOT_TTL_MS = 60 * 60 * 1000` (60 min). Introduced 2026-01-14 after a 6-day-old snapshot was being reused across sessions.

### B7.3 Force-refresh sequence
`force=true` triggers:
1. `users.current_snapshot_id = null` (releases the old snapshot).
2. Fresh waterfall: coords → geocode → timezone → new snapshot.

This ensures a clean SSE reset: `null → new → briefing_ready`.

### B7.4 Parallel writes on create
Snapshot INSERT and `users.current_snapshot_id` UPDATE run via `Promise.all` — independent writes with no foreign-key ordering dependency.

### B7.5 Snapshot creation parameters (all required)
On create, the snapshot record includes: `snapshot_id`, `created_at`, `date` (local TZ), `user_id`, `device_id`, `session_id`, `lat`, `lng`, `coord_key`, `city`, `state`, `country`, `formatted_address`, `timezone`, `market` (from `driver_profiles`, may backfill), `local_iso`, `dow`, `hour`, `day_part_key`, `h3_r8`, `device: {platform: 'web'}`, `permissions: {geolocation: 'granted'}`. Validated by `validateSnapshotFields()` before INSERT.

## B8. Timezone Resolution Waterfall

Implemented in `server/lib/location/resolveTimezone.js`; called from `/resolve` at `location.js:690–728`.

1. **Fast path — `resolveTimezoneFromMarket(city, state, country)`**
   - Queries `markets` table (102 rows + ~3,300 city aliases in `market_aliases`).
   - ~5 ms; returns `{ market_name, timezone }` on hit.
2. **Slow path — Google Timezone API**
   - Called via `googleMapsCircuit`; ~200–300 ms.
   - Used for rural/international locations outside the market table.
3. **No further fallback.** If both fail, 502 `TIMEZONE_RESOLUTION_FAILED` — **never** server timezone (BR-1).

Timezone is also persisted in `coords_cache`; subsequent hits skip both paths entirely.

## B9. Address Extraction Rules

### B9.1 Plus Code filtering (`pickBestGeocodeResult`)
- Skip results matching `/^[A-Z0-9]{4}\+[A-Z0-9]{2,}/` (e.g. "35WJ+64").
- Prefer results whose `types[]` intersects `['street_address', 'premise', 'route', 'establishment', 'point_of_interest']`.
- Fall back to the first result if no street address found.

### B9.2 Component extraction (`pickAddressParts`)
Iterates `address_components`, picking:
- `locality.long_name` → `city`
- `administrative_area_level_1.short_name` → `state` (e.g., "TX")
- `country.short_name` → `country` (e.g., "US") — **short_name** per BR-11.
- Fallback sources for `city` when no `locality`: `sublocality` → `sublocality_level_1` → `neighborhood` → `administrative_area_level_2` (county). Prevents "undefined, undefined" in rural areas (2026-02-01 fix).

## B10. Circuit Breakers & Fail-Fast Policy

`makeCircuit({name, failureThreshold, resetAfterMs, timeoutMs})` returns a callable wrapping an async function with:
- Consecutive-failure counting; breaks open at threshold.
- `resetAfterMs` elapsed → half-open (single probe allowed).
- Each call gets an `AbortSignal`; if the signal fires, the underlying `fetch` rejects.

Two breakers in this router:
| Breaker | Threshold | Reset | Timeout | Used by |
|---|---|---|---|---|
| `googleMapsCircuit` | 3 | 30 s | 5 s | geocode (both directions), timezone, all `/resolve` and `/snapshot` geocode calls |
| `googleAQCircuit` | 3 | 30 s | 3 s | `/airquality` |

Weather and Pollen are *not* wrapped — they're treated as best-effort enrichments that gracefully degrade to `available: false`.

**Fail-fast policy:** when a breaker is open, no fallback data is fabricated. The handler bubbles the error up as a structured 502 with `code`/`apiStatus` fields the client can render.

## B11. Rate Limiting

Implemented locally in-router (not middleware) for `/geocode/reverse` and `/geocode/forward`.

- **Window:** 60 s sliding.
- **Cap:** 10 requests per IP per window.
- **Key:** `req.ip || req.connection.remoteAddress || 'unknown'`.
- **Storage:** in-memory `Map`; not shared across processes (acceptable because single-process Replit workflow).
- **Response on cap:** `429 { error: 'RATE_LIMIT_EXCEEDED', resetIn: <seconds> }`.

Other endpoints rely on auth + upstream Google quotas for rate protection.

## B12. Error Taxonomy

### B12.1 4xx (client errors)
| Code | When |
|---|---|
| `400 lat/lng required` / `COORDINATES_OUT_OF_RANGE` | parse or range failure |
| `400 missing_lat_lng` / `invalid_coordinates` | `/snapshot` minimal mode |
| `400 device_id_required` | `/users/me` |
| `400 timezone_required` | internal snapshot creation when tz undefined |
| `400 incomplete_snapshot` | `/snapshot` validation gate failure |
| `400 refresh_required` | `/snapshot` full-mode SnapshotV1 fields missing |
| `400 snapshot_incomplete` | `validateSnapshotFields` threw |
| `400 no_fields_to_update` | enrich with empty body |
| `401 INVALID_TOKEN` | `/resolve` bearer signature mismatch |
| `401 AUTHENTICATION_REQUIRED` | no bearer on `/resolve` |
| `404 user_not_found` | `/users/me` |
| `404 snapshot_not_found` | `/snapshots/:id` or `/enrich` |
| `404 City not found` | `/geocode/forward` ZERO_RESULTS |
| `429 RATE_LIMIT_EXCEEDED` | geocoding endpoints over cap |

### B12.2 5xx (server errors, all fail-loud)
| Code | When |
|---|---|
| `500 reverse-geocode-failed` / `forward-geocode-failed` | unexpected server error in geocode |
| `500 snapshot_creation_failed` / `snapshot_failed` | snapshot INSERT path |
| `500 user_location_save_failed` | `users` upsert in `/resolve` |
| `500 location-resolve-failed` | generic `/resolve` catch |
| `500 briefing_failed` | `/news-briefing` |
| `500 fetch_failed` | `/users/me`, `/snapshots/:id` |
| `500 enrich_failed` | `/snapshot/:id/enrich` |
| `502 GEOCODE_*` | Google Geocoding non-OK, no results, missing fields |
| `502 TIMEZONE_LOOKUP_FAILED` / `TIMEZONE_RESOLUTION_FAILED` | both market fast-path and Google failed |
| `502 location_persistence_failed` | DB write reported 0 rows affected |
| `502 resolve_failed` | `/snapshot` minimal mode geocode/timezone failure |
| `503 LOCATION_SERVICE_UNAVAILABLE` | `GOOGLE_MAPS_API_KEY` missing |
| `503 TIMEZONE_UNAVAILABLE` | same for `/timezone` |
| `503 degraded` | `getAgentState().degraded` true; includes `Retry-After` |

## B13. Integration Points

- **`/api/blocks-fast`** — downstream consumer of `snapshot_id`. `/snapshot` does *not* trigger it; the client dispatches `vecto-snapshot-saved` and `CoPilotContext` posts `blocks-fast` with the new ID.
- **Briefing service** (`server/lib/briefing/briefing-service.js`) — `/news-briefing` delegates to `generateAndStoreBriefing`.
- **Strategy generator** — never called directly from this router. Strategy is triggered by `/api/blocks-fast` after briefing completes.
- **FAA delay service** (`server/lib/external/faa-asws.js`) — `/snapshot` calls `getNearestMajorAirport(25)` and `fetchFAADelayData()`; logs `travel_disruptions` rows.
- **Holiday detector** (`server/lib/location/holiday-detector.js`) — parallel with airport lookup in `/snapshot`.
- **Coords-key module** (`server/lib/location/coords-key.js`) — consolidates the 6-decimal rounding previously duplicated in 4 places.
- **Daypart module** (`server/lib/location/daypart.js`) — `getDayPartKey(hour)` shared with offer-intelligence (2026-02-17 extraction).
- **`resolveTimezone` module** (`server/lib/location/resolveTimezone.js`) — market fast-path extracted 2026-02-17.
- **Validation gates** (`server/lib/location/validation-gates.js`) — `validateLocationFreshness`.
- **Validation middleware** (`server/middleware/validate.js`) + schemas (`server/validation/schemas.js`) — `snapshotMinimalSchema`, `locationResolveSchema`, `newsBriefingSchema`.
- **Sanitizers** (`server/lib/utils/sanitize.js`) — `sanitizeString`, `sanitizeIp` (2026-04-05 CodeQL fixes).
- **Workflow logger** (`server/logger/workflow.js`) — `locationLog`, `snapshotLog`, `OP.API`/`OP.CACHE`/`OP.DB`.

---

# Part C — Non-Functional Requirements (NFR)

| NFR | Requirement |
|---|---|
| **Latency (cache hit)** | p50 < 200 ms, p95 < 500 ms for `/resolve` |
| **Latency (cold)** | p50 < 1500 ms, p95 < 3000 ms for `/resolve` |
| **Availability** | 99.5% — bounded by Google Maps upstream; circuit breaker prevents cascade |
| **Data integrity** | 100% — no partial writes; all required fields or 4xx/5xx fail-loud |
| **Rate limit fairness** | Per-IP only (no per-user) for geocoding; UA-based bot filtering at `bot-blocker` middleware |
| **Throughput** | Bounded by Google API quotas + 10 geocode/min/IP; no in-router batching |
| **Observability** | `locationLog` + `snapshotLog` + `ndjson` correlation IDs; `req_id`/`cid` propagated on every response |
| **Idempotency** | `/resolve` is idempotent within TTL via snapshot-reuse path; `coords_cache` uses `.onConflictDoNothing()` |
| **Backward compatibility** | Snapshot body accepts both minimal `{lat, lng}` and full `SnapshotV1` — route handles both without version negotiation |
| **Portability** | No hardcoded "United States"; country derived from geocoding (2026-04-05 globalization fixes) |

---

# Part D — Known Gaps & TODO

## D1. Known Gaps

- **In-memory rate limiter** — the `geocodeRateLimit` Map is per-process; horizontal scaling would allow bypass by distributing requests across workers. Acceptable for single-process Replit workflow.
- **Minimal-mode snapshot lacks `market` backfill** — only the `/resolve` path runs the Google OAuth backfill; `POST /snapshot` minimal mode does not.
- **Weather and Pollen lack circuit breakers** — they rely on raw `fetch` with a 5-second default; if Google Weather is slow, requests can queue.
- **Snapshot enrichment `status: 'ok'` transition** — relies on `PATCH /enrich` being called. If the client skips enrichment, the snapshot remains `status: 'pending'` indefinitely (see Memory #110 / BRIEFING-DATA-MODEL.md §9).
- **FAA delay logging non-atomic** — airport insert into `travel_disruptions` is not in the same transaction as the snapshot insert; a crash between them leaves the snapshot without its disruption row.
- **`/users/me` requires `device_id` query param** — despite the route being auth-protected, identity lookup is by `device_id` not `userId`. Consider allowing token-only identification.

## D2. TODO — Hardening Work

- [ ] Move rate-limit state to Redis or a signed cookie window counter for multi-process safety.
- [ ] Add circuit breaker for Google Weather and Pollen (`googleWeatherCircuit`, 3 failures / 30 s / 3 s).
- [ ] Extend `/snapshot` minimal mode with OAuth market backfill (parity with `/resolve`).
- [ ] Wrap snapshot + travel_disruption inserts in a single transaction.
- [ ] Add `/users/me` variant that identifies by authenticated userId, deprecate device_id variant.
- [ ] Surface cache staleness metrics (`coords_cache.created_at` vs. resolution age) to detect Google data drift.
- [ ] End-to-end test of the force-refresh waterfall (release → resolve → briefing_ready SSE event) per CLAUDE.md § F2, 2026-04-18.

---

# Appendix: Dated Change Log

Chronological list of invariants encoded in inline `//` comments. Dates are absolute (YYYY-MM-DD); preserving these is BR-14's institutional memory commitment.

| Date | Change | Location |
|---|---|---|
| 2026-01-05 | Users table no longer stores location data (simplified session architecture) | `/snapshot` minimal-mode header |
| 2026-01-05 | Added Google Pollen API endpoint | `/pollen` |
| 2026-01-06 | NO FALLBACKS — cannot guess timezone from server | `/timezone`, `/resolve` |
| 2026-01-07 | CRITICAL FIX — never write `session_id` from location API | `/resolve` users upsert |
| 2026-01-09 P0-1 | NO FALLBACKS — return error instead of server timezone | `/timezone` catch |
| 2026-01-09 P0-2 | Removed `?user_id=X` query-param auth bypass (security) | `/resolve` auth |
| 2026-01-10 D-011 | Use `short_name` for country → ISO alpha-2 codes | `pickAddressParts` |
| 2026-01-10 | Consolidated `makeCoordsKey` from 4 duplicates | imports |
| 2026-01-14 | Snapshot reuse TTL — previously reused 6-day-old snapshots! | `/resolve` snapshot logic |
| 2026-01-14 | `validateSnapshotFields` moved to shared util | imports |
| 2026-01-14 | `airport_context` moved from snapshots to `briefings.airport_conditions` | `/snapshot` |
| 2026-01-14 | FAIL HARD — snapshot is NOT optional | `/resolve` catch |
| 2026-01-15 | FAIL HARD — user location save is NOT optional | `/resolve` catch |
| 2026-01-31 | City change invalidates snapshot reuse | `/resolve` TTL check |
| 2026-02-01 | Fallback chain for `city` (locality → sublocality → neighborhood → county) | `pickAddressParts` |
| 2026-02-01 | Validate coordinate ranges | `/resolve` |
| 2026-02-01 | FAIL HARD on incomplete geocode results | `/resolve` |
| 2026-02-01 | STRICT VALIDATION — no partial cache entries | cache read |
| 2026-02-01 | User market from `driver_profiles` for event discovery | snapshot create |
| 2026-02-12 | SECURITY FIX — all routes now require authentication | `router.use(requireAuth)` |
| 2026-02-17 | `getDayPartKey` extracted to shared module | imports |
| 2026-02-17 | `resolveTimezone` extracted to shared module (fast path) | imports |
| 2026-02-17 | `local_iso` must store driver's wall-clock time, NOT UTC | `toLocalTimestamp` |
| 2026-02-17 | `/release-snapshot` endpoint added for refresh spindle | `POST /release-snapshot` |
| 2026-02-17 | Force-refresh releases old snapshot FIRST for clean waterfall | `/resolve` force logic |
| 2026-02-17 | Google OAuth backfill — set market + timezone on first GPS use | snapshot create |
| 2026-03-17 F-10 | Removed hardcoded dev secret fallback | `/resolve` HMAC verify |
| 2026-04-05 | Global app fix — do NOT hardcode US in private IP / fallbacks | `/ip`, holiday |
| 2026-04-05 | SECURITY — `sanitizeString`/`sanitizeIp` to prevent type confusion / SSRF | `/resolve`, `/ip`, `/users/me` |
| 2026-04-05 | Always include `available` field in `/weather` so client can distinguish "no data" vs "API failed" | `/weather` |
| 2026-04-14 (#108) | Multi-source user_id resolution + FAIL-LOUD fallback in `/snapshot` | `/snapshot` session update |
| 2026-04-14 (#110) | Enrichment readiness gate — flip `status: 'pending' → 'ok'` | `/snapshot/:id/enrich` |
| 2026-04-18 | SSE handshake improvements (F2) — initial-state payload on subscribe | (external to this file) |

---

## Cross-references

- `docs/architecture/AUTH.md` — token lifecycle, `session_id` semantics (do not duplicate here)
- `docs/architecture/BRIEFING.md` — consumer of `snapshot_id`; `/api/blocks-fast` trigger chain
- `docs/architecture/DATABASE_ENVIRONMENTS.md` — single `DATABASE_URL` rule (Rule 13)
- `docs/EVENT_FRESHNESS_AND_TTL.md` — downstream event staleness rules
- `docs/architecture/DB_SCHEMA.md` — canonical table definitions (`users`, `snapshots`, `coords_cache`, `markets`, `driver_profiles`, `travel_disruptions`)
- `LESSONS_LEARNED.md` — "Auth Loop on Login" (BR-6), past incidents
- `docs/review-queue/pending.md` — doc updates pending Melody approval
