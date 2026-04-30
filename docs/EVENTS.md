# Events Discovery Pipeline — Authoritative Reference

> **This is the single source of truth** for event discovery, venue matching, deduplication, freshness, and driver-relevant event logic. Supersedes: `EVENT_FRESHNESS_AND_TTL.md`, `VENUELOGIC.md` (event sections), `BRIEFING_AND_EVENTS_ISSUES.md`.

**Last Updated:** 2026-04-11
**Schema Version:** `VALIDATION_SCHEMA_VERSION = 4` (validateEvent.js)

---

## 1. Event Discovery Pipeline (End-to-End Flow)

### Data Flow Principle

```
Gemini discovers event NAMES and CATEGORIES
         │
         ▼
Google Places API (New) resolves VENUE ADDRESSES and COORDINATES
         │
         ▼
Address quality VALIDATOR rejects or re-resolves garbage results
         │
         ▼
Two-phase DEDUP (hash → semantic) removes duplicates
         │
         ▼
DB store with venue_catalog truth (city/address/coords from Places API, not Gemini)
```

**Invariant:** Gemini is treated as untrusted input for anything location-shaped. Gemini's
role is naming ("what event is happening") and classification ("what category"). Google
Places API is the *only* source of truth for venue address, city, state, zip, coordinates,
and `place_id`.

### Full Pipeline Diagram

```
Driver Snapshot (city, state, lat, lng, timezone, market)
          │
          ▼
 ┌────────────────────┐
 │ Gemini 3 Pro       │  ← 2 parallel category searches (high_impact + local_entertainment)
 │ google_search      │    90s timeout each, via callModel('BRIEFING_EVENTS_DISCOVERY')
 │ grounding          │    Returns: title, venue_name, place_id (maybe), category, dates/times
 │                    │    Does NOT return trustworthy city/state/address
 └────────────────────┘
          │
          ▼
 ┌────────────────────┐
 │ 1. NORMALIZE       │  normalizeEvent.js: RawEvent → NormalizedEvent
 │    (ETL Phase 1)   │  • Canonical field names (event_start_date, event_start_time, …)
 │                    │  • city/state default to snapshot context (Gemini values untrusted)
 │                    │  • place_id kept only if it starts with "ChIJ"
 │                    │  • Category mapped via normalizeCategory() fuzzy rules
 │                    │  • Attendance mapped to high/medium/low
 │                    │  • "All Day" events → 08:00–22:00 window
 │                    │  • Missing start times → category-based defaults
 │                    │  • Missing end times → start + category-based duration
 └────────────────────┘
          │
          ▼
 ┌────────────────────┐
 │ 2. VALIDATE        │  validateEvent.js: 13 hard filter rules
 │    (ETL Phase 2)   │  • Title / venue / address / all 4 date+time fields required
 │                    │  • Reject TBD/Unknown/various patterns
 │                    │  • Reject events outside [yesterday, today]
 │                    │  • Rule 12 fuzzy rescue: unmapped categories re-run through
 │                    │    normalizeCategory() before rejection (self-healing)
 └────────────────────┘
          │
          ▼
 ┌────────────────────┐
 │ 3. HASH (Phase 3a) │  hashEvent.js v2: MD5(title | venue_name | city | date)
 │                    │  • stripVenueSuffix() removes " at Venue", " @ Venue", " - Venue"
 │                    │  • city INCLUDED → prevents "Fair Park, Dallas" vs "Fair Park, Houston"
 │                    │  • time EXCLUDED → time corrections UPDATE, not duplicate
 └────────────────────┘
          │
          ▼
 ┌────────────────────┐
 │ 3b. HASH DEDUP     │  Phase 3b: exact-title hash dedup at merge point
 │    (write-time)    │  • Runs across merged category search results
 │                    │  • Case-insensitive title key
 └────────────────────┘
          │
          ▼
 ┌────────────────────┐
 │ 3c. SEMANTIC DEDUP │  deduplicateEventsSemantic.js: title-similarity + venue plausibility
 │    (write-time)    │  • Catches "Jon Wolfe" / "Jon Wolfe Concert" / "Jon Wolfe Live"
 │                    │  • Catches wrong stadium assignments (comedy at Globe Life Field)
 │                    │  • Scoring prefers specific venues over stadiums, longer titles
 └────────────────────┘
          │
          ▼
 ╔════════════════════════╗
 ║ 4. VENUE RESOLUTION    ║  THE CRITICAL STEP — Google Places API (New) is source of truth
 ║    (ETL Phase 4)       ║
 ║                        ║  THREE-STEP PRIORITY CHAIN (briefing-service.js):
 ║                        ║
 ║                        ║  (a) Place-ID CACHE HIT
 ║                        ║      lookupVenue({ placeId: "ChIJ…" })
 ║                        ║      If cached venue has formatted_address + lat + lng → USE
 ║                        ║
 ║                        ║  (b) PLACES API TEXT SEARCH  ← authoritative
 ║                        ║      searchPlaceWithTextSearch(snapshot.lat, snapshot.lng,
 ║                        ║                                 venue_name, { radius: 50000 })
 ║                        ║      Returns: placeId, formattedAddress, lat, lng, parsed.city
 ║                        ║      → findOrCreateVenue() with Places API data
 ║                        ║
 ║                        ║  (c) GEOCODE FALLBACK
 ║                        ║      geocodeEventAddress(venue_name, city, state)
 ║                        ║      Only if Places API returned nothing
 ║                        ║
 ║  ┌──────────────────────────────────────────────────────────────────┐
 ║  │ VALIDATION GATE (venue-cache.js: maybeReResolveAddress)          │
 ║  │ After EVERY findOrCreateVenue() return, validate address quality │
 ║  │ via venue-address-validator.js. If bad → Places API re-resolve   │
 ║  │ (50km radius) → re-validate new result → update venue_catalog    │
 ║  │ in place. Refuses to replace bad with bad.                       │
 ║  └──────────────────────────────────────────────────────────────────┘
 ╚════════════════════════╝
          │
          ▼
 ┌────────────────────┐
 │ 5. STORE           │  discovered_events table (ON CONFLICT event_hash DO UPDATE)
 │    (ETL Phase 5)   │  • city/address/state from venue_catalog (Places API), not Gemini
 │                    │  • venue_name kept as-is from Gemini for display
 │                    │  • venue_id FK to venue_catalog for coordinates
 │                    │  • onConflict updates ALL content fields including resolved
 │                    │    address/city/state (was a bug pre-2026-04-11: conflict branch
 │                    │    used raw event.address, reverting corrections)
 │                    │  • Post-resolution: validateVenueAddress() warning-only monitoring
 └────────────────────┘
          │
          ▼
 ┌────────────────────┐
 │ 6. FRESHNESS       │  strategy-utils.js: filterFreshEvents()
 │    FILTER          │  • Applied server-side, API-side, AND client-side (defense in depth)
 │                    │  • Timezone-aware using snapshot.timezone
 │                    │  • POST_EVENT_SURGE_MS = 1 hour extension past end time
 │                    │  • Inferred end = start + 3h + 1h surge if no end_time
 └────────────────────┘
          │
          ▼
 ┌────────────────────┐
 │ 7. READ-TIME       │  Read-level normalization dedup + semantic dedup safety net
 │    DEDUP (read)    │  • deduplicateEvents() — legacy normalization (strip "Live Music:",
 │                    │    "The ", parentheticals, match on normalized name+addr+time)
 │                    │  • deduplicateEventsSemantic() — title-similarity safety net for
 │                    │    any duplicates that survived write-time dedup
 └────────────────────┘
```

### Trigger

Events are discovered **per-snapshot** as Phase 1 of the `blocks-fast` waterfall in
`briefing-service.js`. There is **NO background event sync job** (Rule 11 in CLAUDE.md).

### Key Files

| File | Purpose |
|------|---------|
| `server/lib/events/pipeline/normalizeEvent.js` | RawEvent → NormalizedEvent, category/time defaults |
| `server/lib/events/pipeline/validateEvent.js` | 13 hard filter rules + fuzzy category rescue |
| `server/lib/events/pipeline/hashEvent.js` | MD5 hash (title\|venue_name\|city\|date) for storage dedup |
| `server/lib/events/pipeline/deduplicateEventsSemantic.js` | **Title-similarity dedup + venue plausibility scoring** |
| `server/lib/events/pipeline/geocodeEvent.js` | Google Geocoding API (fallback only) |
| `server/lib/events/pipeline/types.js` | JSDoc type definitions |
| `server/lib/venue/venue-address-resolver.js` | **Google Places API (New)** — authoritative venue resolution (`searchPlaceWithTextSearch`) |
| `server/lib/venue/venue-address-validator.js` | **Address quality validation** (string-only, no API calls) |
| `server/lib/venue/venue-cache.js` | `findOrCreateVenue()`, `maybeReResolveAddress()` validation gate |
| `server/lib/briefing/briefing-service.js` | Orchestrator: Gemini prompt, three-step venue chain, DB storage |
| `server/api/briefing/briefing.js` | API routes, read-time dedup safety net, zombie recovery |
| `server/lib/strategy/strategy-utils.js` | `filterFreshEvents()`, `isEventFresh()` — freshness + post-event surge |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Client-side freshness fallback |
| `scripts/backfill-venue-addresses.js` | One-time backfill script (opt-in) for existing bad venue addresses |

---

## 2. Venue Verification & Matching Rules

**This is the critical correctness area.** Events MUST be matched to their correct venues with correct addresses and cities. All venue data comes from Google Places API (New), never from Gemini.

### Core Principle

**Google Places API (New) is the ONLY source of truth for venue data.** Gemini hallucinates city, address, and sometimes place_id. The snapshot provides metro-area context; Places API resolves authoritative venue information.

### The Bugs This Fixes

1. **Wrong venue coordinates** — geocoding `"Dickies Arena, Dallas, TX"` returns wrong lat/lng
2. **No authoritative address source** — venues stored with whatever Gemini guessed
3. **Stale venue_catalog lat/lng** — causing navigation to wrong places (e.g., `"Globe Life Field"` → `"Hair salon in Frisco"`)
4. **Garbage Places API results leaking through** — `"Theatre, Frisco, TX 75034"` (venue name fragment in address) or `"Frisco, TX, USA"` (city-only, no street)
5. **onConflict reverting corrections** — insert branch wrote resolved address, conflict branch wrote raw Gemini address, so every re-discovery wiped fixes

### Three-Step Venue Resolution Priority Chain

Implemented in `briefing-service.js :: fetchEventsForBriefing()`. Every event discovered by Gemini flows through this chain:

```
Event from Gemini: { venue_name, place_id (maybe), title, category, date, time }
                                    │
                                    ▼
        ┌────────────────────────────────────────────────────┐
        │ STEP (a): PLACE-ID CACHE HIT                       │
        │ lookupVenue({ placeId: event.place_id })           │
        │                                                    │
        │ If place_id starts with "ChIJ" AND cached venue    │
        │ has formatted_address + lat + lng → use directly   │
        │                                                    │
        │ Cached but incomplete? → fall through to step (b)  │
        └────────────────────────────────────────────────────┘
                                    │
                       (no cache hit or incomplete)
                                    │
                                    ▼
        ┌────────────────────────────────────────────────────┐
        │ STEP (b): GOOGLE PLACES API TEXT SEARCH            │
        │ searchPlaceWithTextSearch(                         │
        │   snapshot.lat, snapshot.lng,                      │
        │   event.venue_name,                                │
        │   { radius: 50000 }  // 50km metro-wide            │
        │ )                                                  │
        │                                                    │
        │ Returns authoritative:                             │
        │   • placeId (ChIJ…)                                │
        │   • formattedAddress                               │
        │   • lat, lng (6-decimal rounded, ~11cm precision)  │
        │   • parsed.{city, state, zip, country, address_1}  │
        │                                                    │
        │ Then: findOrCreateVenue() with Places API data     │
        └────────────────────────────────────────────────────┘
                                    │
                          (Places API returned nothing)
                                    │
                                    ▼
        ┌────────────────────────────────────────────────────┐
        │ STEP (c): GEOCODE FALLBACK                         │
        │ geocodeEventAddress(venue_name, city, state)       │
        │                                                    │
        │ Uses snapshot city/state as context hint.          │
        │ Last resort — only if Places API failed.           │
        └────────────────────────────────────────────────────┘
                                    │
                                    ▼
              ┌─────────────────────────────────────┐
              │ VALIDATION GATE (venue-cache.js)    │
              │ maybeReResolveAddress(venue, …)     │
              │ — see next subsection —             │
              └─────────────────────────────────────┘
                                    │
                                    ▼
                       Store with resolvedAddress,
                       resolvedCity, resolvedState
                       (same values on both INSERT
                       and onConflictDoUpdate.set)
```

**Radius parameter contract:** `searchPlaceWithTextSearch(lat, lng, textQuery, options)` accepts `options.radius` in meters. Default `50` (50 m) for precise venue-coordinate lookups where you already have the venue's true location. Pass `50000` (50 km) for metro-wide event discovery where the bias point is the driver's snapshot location. Never pass values > 50,000 — Google Places API rejects with a 400 error.

### Validation Gate: `maybeReResolveAddress` (venue-cache.js)

Every `findOrCreateVenue()` return path now flows through an address quality gate before the caller sees the venue record. This prevents bad cached data (e.g., a venue stored with `"Frisco, TX, USA"` instead of `"1000 Ballpark Way, Arlington, TX 76011"`) from silently propagating.

**Gated return paths in `findOrCreateVenue`:**

1. Place-ID cache hit path
2. Coord-key cache hit path
3. Fuzzy-name cache hit path
4. Newly-created venue path

**Gate logic:**

```
validateVenueAddress(venue.formatted_address)
         │
         ▼
    valid? ──── YES ──► return null (caller uses original)
         │
         NO (hard fail or 2+ soft fails)
         │
         ▼
searchPlaceWithTextSearch(venue.lat, venue.lng, venue_name, { radius: 50000 })
         │
         ▼
    got result?  ──── NO ──► return null (log warning)
         │
         YES
         │
         ▼
validateVenueAddress(newResult.formattedAddress)
         │
         ▼
    valid? ──── NO ──► return null (refuse to replace bad with bad)
         │
         YES
         │
         ▼
UPDATE venue_catalog
  SET formatted_address, address, address_1, city, state, zip,
      lat, lng (6-decimal rounded), coord_key, place_id, updated_at
  WHERE venue_id = venue.venue_id
  RETURNING *
         │
         ▼
    return updated venue record
```

**Non-throwing:** Any error in the gate (API failure, DB error) falls through to `return null`, which the caller treats as "use the original venue record." The gate never rejects the event — it's a quality-improvement step, not a filter.

**No-op on good data:** `validateVenueAddress` is string-only (no API calls), so the common case of a good cached address costs only a regex/string-comparison pass. Places API is only hit when validation fails.

### Address Quality Validator (`venue-address-validator.js`)

Lightweight string-parsing validator. No API calls. Exported functions:

- `validateVenueAddress({ formattedAddress, venueName, lat, lng, city })` → `{ valid: boolean, issues: string[] }`
- `isAddressValid(formattedAddress, venueName)` → `boolean` (convenience wrapper)

**Four checks:**

| Check | Type | What It Catches |
|-------|------|-----------------|
| `ADDRESS_HAS_STREET_NUMBER` | Soft signal | Addresses with no digits at all (e.g., `"Frisco, TX, USA"`). Soft because international addresses legitimately lack numbers. |
| `ADDRESS_NOT_GENERIC` | **Hard fail** | (1) Address starts with a generic venue type word (`theatre`, `arena`, `stadium`, `hall`, `club`, `bar`, `restaurant`, `church`, `park`, `hotel`, `cinema`, `coliseum`, `auditorium`, `field`, `gym`, `convention`, `expo`, … ~40 total). (2) Address is pure `"city, state"` or `"city, state, country"` with no street component. |
| `ADDRESS_HAS_STREET_NAME` | Soft signal | No recognized street type pattern. Regex includes US/UK/Canada/AU (St, Ave, Blvd, Way, Mews, Crescent, …), German (Straße, Weg, Platz, Allee), French (Rue, Chemin, Allée), Spanish (Calle, Avenida, Paseo, Camino). |
| `COORD_SANITY` | Soft signal (**placeholder — no-op**) | Reserved for a future metro-bounding-box lookup. Currently returns no issues. TODO in source. |

**Scoring rules:**
- Any **hard fail** → `valid: false`
- **2 or more** soft-signal failures → `valid: false`
- **1** soft-signal failure → `valid: true` (warning logged but allowed)
- 0 failures → `valid: true`

Failed validations log `[VENUE-VALIDATE] Address quality FAILED for "<name>": "<address>" — <issues>`.

### Hard Rules

- **Google Places API is the venue authority** — city, address, state, zip, coordinates all come from Places API
- **Gemini provides venue NAME and event identity ONLY** — do NOT trust Gemini for city, address, coordinates, or place_id accuracy
- **ALWAYS store venue_catalog city** in `discovered_events.city` (from Places API, not snapshot, not Gemini)
- **ALWAYS store venue_catalog formatted_address** in `discovered_events.address`
- **New venues get** `is_event_venue = true`, `record_status = 'enriched'`, `venue_types = ['event_host']`
- **`onConflictDoUpdate` MUST use resolved address/city/state**, not raw Gemini event fields — otherwise corrections are reverted on every re-discovery
- **This is a GLOBAL pattern** — Google Places API handles Tokyo, London, Dallas identically; the validator's street regex supports German, French, Spanish, and UK patterns

---

## 3. Deduplication Strategy

Three dedup layers run in sequence. Each catches different failure modes.

### Layer 1: Hash-Based Dedup (Storage Level)

**File:** `hashEvent.js` (v2, 2026-04-10)
**Hash input:** `normalize(title) | normalize(venue_name) | normalize(city) | event_start_date`
**Algorithm:** MD5, 32-char hex, stored in `discovered_events.event_hash` (UNIQUE constraint).

| Component | Why |
|-----------|-----|
| `title` | Core event identity. Stripped of `" at Venue"`, `" @ Venue"`, `" - Venue"` suffixes by `stripVenueSuffix()`. Lowercased, non-alphanumerics removed. |
| `venue_name` | Stable across discovery runs (unlike `address`, which varies). `"American Airlines Center"` stays consistent. |
| `city` | Prevents collisions: `"Fair Park, Dallas"` != `"Fair Park, Houston"`. City comes from `venue_catalog` (Places API) or snapshot context. |
| `event_start_date` | Same event on different dates = different events. |
| ~~`time`~~ | **Excluded.** Time corrections should UPDATE the existing row, not create a duplicate. `"Bruno Mars 7:00 PM"` and `"Bruno Mars 7:30 PM"` at same venue/date → same hash → UPDATE path. |

**On conflict:** `ON CONFLICT (event_hash) DO UPDATE` — all content fields (`title`, `venue_name`, `address`, `city`, `state`, `event_start_date`, `event_start_time`, `event_end_time`, `category`, `venue_id`, `updated_at`) are updated with fresher data. **The conflict branch uses resolved venue data** (from Places API), not raw Gemini event fields — this was a bug pre-2026-04-11.

### Layer 2: Semantic Title-Similarity Dedup (Write Level)

**File:** `deduplicateEventsSemantic.js` (new, 2026-04-11)
**When:** At the Gemini merge point in `fetchEventsWithGemini3ProPreview()`, immediately after exact-title hash dedup, before venue resolution.

**Why it exists:** Gemini's two parallel category searches often return the same event with slightly different titles (different enough to survive the exact-hash pass). Also, Gemini sometimes assigns the same event to both a small venue (correct) and a nearby stadium (wrong).

**Two-phase approach inside the module:**

1. **Grouping phase (O(n²) union-find):** For each pair of events, check if they belong to the same group.
   - **Title match:** `titlesMatch(a, b)` — normalized equality OR substring containment OR primary-artist match. Normalization strips parentheticals, `"at Venue"` / `"- Venue"` suffixes, `"Live music:"` prefixes, non-alphanumerics, then pops trailing suffix words (`concert`, `live`, `show`, `tour`, `performance`, `experience`, `night`, `standup`, `comedy`, `acoustic`, `unplugged`, `in concert`, …).
   - **Time-slot match:** `sameTimeSlot(a, b, 120)` — same `event_start_date` required; if both have start times, within 120 minutes; if one or both lack times, same date is sufficient (conservative: prefer false positive over false negative).
   - **Primary-artist extraction:** For titles like `"Fatboy Slim, Coco & Breezy, Jay Pryor"`, extracts `"fatboy slim"` (first segment before comma or `&`). Guards against splitting legitimate two-word artist names like `"Tito & Tarantula"` by requiring both sides of the `&` to be at least one/two words.
   - **Acceptable n:** O(n²) is fine because n is typically 20–60 events per discovery run.

2. **Selection phase:** From each group, keep the event with the highest `scoreEventPreference` score.

**`scoreEventPreference(event)` weights:**

| Criterion | Points |
|-----------|--------|
| Has `venue_name` | +5 |
| **Non-stadium venue** (fails `LARGE_VENUE_PATTERNS` regex) | **+10** |
| Has `address` | +3 |
| Has `place_id` | +2 |
| Has `event_start_time` | +1 |
| Title length > 20 | +2 |
| Title length > 40 | +1 more |

`LARGE_VENUE_PATTERNS` catches: `stadium`, `\bfield\b`, `ballpark`, `coliseum`, `colosseum`, `\barena\b`, `speedway`, `raceway`, `racetrack`, `motor\s*speedway`, `fairground`, `fair\s*park`, `convention\s*center`, `expo\s*center`.

**Example resolutions:**
- `"Jon Wolfe"` / `"Jon Wolfe Concert"` / `"Jon Wolfe Live"` at Billy Bob's Texas → one event kept (longest title + non-stadium venue wins).
- `"Jon Wolfe"` at Billy Bob's Texas vs. `"Jon Wolfe"` at Globe Life Field → Billy Bob's version kept (+10 non-stadium bonus).
- `"Fatboy Slim"` vs. `"Fatboy Slim, Coco & Breezy, Jay Pryor"` at SILO Dallas → longer-title version kept (+2 for >20 char title).

### Layer 3: Read-Level Normalization Dedup + Semantic Safety Net

**Files:** `briefing-service.js :: deduplicateEvents()` (legacy) + `briefing.js` read endpoints.

Applied after DB read, before response:

1. **`deduplicateEvents()` (legacy normalization):** Strips `"Live Music:"`, `"The "`, parenthetical suffixes, then groups by `normalized(name + address + time)`. Catches cases like `"Bruno Mars Romantic Tour"` vs. `"Bruno Mars - The Romantic Tour"`.

2. **`deduplicateEventsSemantic()` (safety net):** Re-runs the title-similarity dedup at read time. Catches any duplicates that somehow survived the write-time dedup (e.g., older rows written before the semantic deduper existed).

Both `GET /events/:snapshotId` and the market-proxy event set run through both layers. Logs appear as `[BriefingRoute] Dedup: N → M events` and `[BriefingRoute] Semantic dedup: N → M events`.

### Title Normalization Reference

```javascript
// hashEvent.js (for storage hash)
stripVenueSuffix("Cirque du Soleil at Cosm")    → "Cirque du Soleil"
stripVenueSuffix("DJ Night @ The Club")         → "DJ Night"
stripVenueSuffix("Festival - City Park")        → "Festival"
normalizeForHash("Bruno Mars!!!")               → "bruno mars"

// deduplicateEventsSemantic.js (for title-similarity grouping)
normalizeTitleForComparison("Jon Wolfe Concert")                     → "jon wolfe"
normalizeTitleForComparison("Jon Wolfe Live")                        → "jon wolfe"
normalizeTitleForComparison("Fatboy Slim, Coco & Breezy, Jay Pryor") → "fatboy slim coco breezy jay pryor"
normalizeTitleForComparison("Kathy Griffin Live")                    → "kathy griffin"
```

---

## 4. Event Freshness & TTL

### Freshness Rules (Driver-Relevant Timeframes)

Implemented in `strategy-utils.js :: isEventFresh()` and `filterFreshEvents()`.

| Scenario | Behavior |
|----------|----------|
| Event in progress | Show (now is between start and end time) |
| Event ended < 1 hour ago | Show (post-event pickup surge still relevant for drivers) |
| Event ended > 1 hour ago | Remove (surge has dissipated) |
| Event has no end time | Infer: start + 3 hours + 1 hour surge window |
| Event has no date info at all | Remove (no way to determine relevance) |
| Multi-day event | Keep showing until LAST day's end time + 1 hour |

**Constants:**
- `POST_EVENT_SURGE_MS = 60 * 60 * 1000` — 1 hour post-event extension
- Default inferred duration: 3 hours (from `isEventFresh` when no `end_time`)

### Timezone Handling

**ALL freshness checks are timezone-aware.** The server runs in UTC, but events store local times like `"7:00 PM"` without a timezone, so the snapshot's IANA timezone must be passed explicitly.

```javascript
// CORRECT: Pass snapshot timezone for proper local time comparison
filterFreshEvents(events, new Date(), snapshot.timezone);

// WRONG: Comparing UTC server time against "7:00 PM" local time
filterFreshEvents(events, new Date()); // DO NOT DO THIS
```

The internal `createDateInTimezone(year, month, day, hours, minutes, timezone)` utility converts local event times + IANA timezone to UTC `Date` objects for comparison.

### Defense-in-Depth (3 Filter Layers)

1. **Server-side** (`briefing-service.js`): `filterFreshEvents(events, now, snapshot.timezone)`
2. **API-side** (`briefing.js`): `filterFreshEvents()` before response
3. **Client-side** (`BriefingPage.tsx`): `useMemo()` with local `filterFreshEvents()` fallback

### Soft Deactivation

Past events are soft-deactivated (`is_active = false`, `deactivated_at = NOW()`) per-snapshot via `deactivatePastEvents()` before each discovery cycle. This is the canonical cleanup mechanism — there is **NO hourly cleanup job** and **NO background event sync job** (Rule 11 in CLAUDE.md).

---

## 5. Venue Catalog Integration

### When to Add New Venues

A new `venue_catalog` entry is created when:
- An event's venue doesn't match any existing venue by `place_id`, `coord_key`, or fuzzy name
- Google Places API returned authoritative data (lat/lng required for new venue creation)

New event-discovered venues get:
- `is_event_venue = true`
- `record_status = 'enriched'` (Places API address + coords, not full bar details)
- `venue_types = ['event_host']`
- Non-blocking enrichment from Google Places API (phone, hours, rating, business status)

### Validation Gate on Venue Creation

**Every new and returned venue passes through `maybeReResolveAddress` before reaching the caller** (see section 2 for full gate logic). This means even brand-new venues are validated for address quality, and if the Places API result that created them is garbage, the gate will re-resolve via a second Places API call with a wider radius.

### When to Flag Existing Venues

An existing venue's `is_event_venue` flag is set to `true` when it's linked to a discovered event for the first time. This enables filtering for "venues that host events" in the Market Map.

### Progressive Enrichment

Venue data quality follows the "Best Write Wins" pattern:
- Boolean flags (`is_bar`, `is_event_venue`): OR logic — once true, stays true
- `record_status`: MAX logic — `stub` < `enriched` < `verified`
- `place_id`: Backfilled on any match if existing venue doesn't have one
- `formatted_address`: Overwritten by validation gate if quality check fails

### Coordinate Precision

All latitude/longitude values stored in `venue_catalog` are rounded to **6 decimal places** (~11 cm precision). This matches `coord_key` precision and eliminates floating-point noise from Google Places API, which returns arbitrary precision values like `32.782698100000005`. Rounding happens in:
- `searchPlaceWithTextSearch()` (return value)
- `maybeReResolveAddress()` (update values)
- `scripts/backfill-venue-addresses.js` (update values)

### One-Time Backfill Script

`scripts/backfill-venue-addresses.js` fixes existing bad venue data using a two-pass Places API search:

- **Pass 1:** Unbiased search by venue name alone (handles well-known venues where stored coords may be wrong)
- **Pass 2:** Metro-biased fallback (50 km radius) for ambiguous venue names
- **Distance sanity check:** Rejects Places results > 100 km from bias center
- **Cascade:** Updates `discovered_events.city`/`state`/`address` for rows referencing each fixed venue
- **Rate limit:** 5 venues per batch, 200 ms delay between batches
- **CLI flags:** `--dry-run`, `--all`, `--limit N`, `--venue "name filter"`

The script is **opt-in and not wired into any boot path, cron, or route**. Run manually.

---

## 6. Nearby/Market Events Logic

### Metro-Wide Discovery

Events are discovered for the **entire metro market**, not just the driver's city:
- Market resolved from `snapshot.market` (set at signup) or `getMarketForLocation(city, state)`
- Gemini searches `"Dallas-Fort Worth metro"` not just `"Dallas"`
- DB read queries filter by **state only** (not city) — now that venues store their actual Places-API-resolved city (e.g., `"Arlington"`, `"Fort Worth"`, `"Frisco"` for a Dallas driver), filtering by the driver's snapshot city would mask legitimate metro events

**Affected queries (all state-scoped, no city filter):**
- `briefing-service.js :: fetchEventsForBriefing` post-discovery read
- `briefing.js :: GET /events/:snapshotId`
- `briefing.js :: GET /discovered-events/:snapshotId`

### Event Categories

| Category | Search Focus | Max Events |
|----------|-------------|------------|
| `high_impact` | Stadiums, arenas, concert halls, convention centers | 8 |
| `local_entertainment` | Comedy, nightlife, bars, community events | 8 |

### Distance Relevance

Events carry `venue_lat`/`venue_lng` from the linked `venue_catalog` entry. The strategy LLM can calculate distance from the driver's position to prioritize nearby events.

---

## 7. Rideshare Pro Tips Integration

Events are enriched with driver-relevant intelligence in the strategy/consolidation phase.

### What Drivers Need from Events

| Data Point | Source | Why Drivers Care |
|------------|--------|-----------------|
| Event end time | `event_end_time` | Predict pickup surge timing |
| Venue coordinates | `venue_catalog.lat/lng` (6-decimal) | GPS to staging area |
| Expected attendance | `expected_attendance` | Gauge surge intensity |
| Category | `category` | Sports = different surge pattern than concert |
| Venue address | `venue_catalog.formatted_address` | Navigate to pickup zone |

### Strategy LLM Context

The consolidator (`consolidator.js`) enriches events with venue status:
- Venue open/closed status from `hours_full_week`
- Business hours in 12h format
- 6-decimal coordinates for precise navigation

### Event-Driven Strategy Tips

The strategy LLM generates tips like:
- "Mavericks game at AAC ends ~10:30 PM — position near Olive St exit by 10:15"
- "Breakaway Festival at Fair Park — staging on Fitzhugh Ave, expect 20-min surge"
- "Multiple nightlife events in Deep Ellum — stay in area until 2:30 AM"

---

## 8. LLM Request Requirements

### Snapshot-First Context Rule

**The user's snapshot MUST be the first context sent to any LLM involved in event processing.**

```javascript
// REQUIRED: Snapshot data for event discovery
const snapshot = {
  city: 'Dallas',                        // Driver's current city (hint only)
  state: 'TX',                           // Driver's state (used for DB filter)
  lat: 32.7767,                          // Driver's latitude (used for Places API bias)
  lng: -96.7970,                         // Driver's longitude (used for Places API bias)
  timezone: 'America/Chicago',           // IANA timezone (REQUIRED, no fallback)
  market: 'Dallas-Fort Worth',           // Metro market name
  local_iso: '2026-04-11T14:30:00-05:00', // Local ISO timestamp
  hour: 14                               // Local hour (0-23)
};
```

### Non-Negotiable Requirements

1. **Timezone is REQUIRED** — `fetchEventsWithGemini3ProPreview()` rejects if missing
2. **Date computed from snapshot timezone** — not server UTC
3. **Market determines search area** — broader than just the driver's city
4. **No cross-provider fallback** — Gemini-only, to avoid format incompatibility
5. **Gemini returns names/categories/times; Places API returns everything else** — do not trust Gemini's `address`, `city`, `state`, or `lat/lng` fields

### Gemini Prompt Structure

```
System: Strict categorization rules + allowed category list
User:   "Find [category] happening TODAY ({date}) in the {market} metro area..."
        - Requires: title, venue_name, place_id (best effort), category,
          event_start_date, event_start_time, event_end_time
        - Does NOT rely on: address, city (these come from Places API)
        - Market-agnostic search terms (no hardcoded league names)
```

---

## 9. Global App Considerations

### Timezone Handling

| Operation | Timezone Source | Notes |
|-----------|---------------|-------|
| Event discovery date | `snapshot.timezone` via `toLocaleDateString('en-CA', { timeZone })` | Local date, not UTC |
| Freshness filtering | `snapshot.timezone` passed to `filterFreshEvents()` | All 3 filter layers |
| Date validation (today check) | `new Date().toISOString()` in validateEvent.js | Server UTC — may need timezone fix for global |
| Venue timezone | Resolved from market via `resolveTimezoneFromMarket()` | Stored on `venue_catalog.timezone` |

### Locale Considerations

- Event times stored as text strings (`"7:00 PM"`) — locale-agnostic
- Addresses from Google Places API respect the locale of the API key region
- Category names are English-only (`concert`, `sports`, etc.) — for internal use, not display
- Address validator supports international street patterns (German, French, Spanish, UK)

### International Venues

- `venue_catalog.country` defaults to `'US'` (ISO-2 code)
- `coord_key` is locale-independent (pure lat/lng math)
- Market names support international metros (not hardcoded to US)
- Search terms in Gemini prompt are market-agnostic (no US-specific league names)
- Address validator's `GENERIC_VENUE_WORDS` list uses English venue-type words — may need localization for non-English regions
- `searchPlaceWithTextSearch` passes Google Places API standard params, so Tokyo/London/Berlin work identically to Dallas

### Known Gaps

1. **validateEvent.js date check** uses server UTC for "today" — may reject valid events in far-east timezones
2. **Event times as text** — no ISO 8601 storage means parsing is always needed
3. **Country not in event discovery prompt** — assumes Gemini infers from metro area name
4. **No multi-language event title support** — normalization assumes Latin characters
5. **`COORD_SANITY` check in address validator is a no-op placeholder** — reserved for a future metro-bounding-box lookup

---

## 10. Smart Blocks ↔ Event Venue Coordination (2026-04-11)

### Design principle

Smart Blocks must recommend the **closest high-impact venues first**. The 15-mile rule — "all venue recommendations must be within 15 miles of the driver's GPS coordinates" — is the supreme constraint and is never relaxed, not even for events. Event data enriches Smart Blocks in two distinct ways based on the event's distance from the driver, without weakening the 15-mile rule.

This section describes the current post-2026-04-11-revert behavior. A full history of the three waves of work that led here (initial alignment, first followup, second revert) lives in `server/lib/venue/SMART_BLOCKS_EVENT_ALIGNMENT_PLAN.md`.

### NEAR / FAR bucket model

```
Driver location
    │
    ├──── 15 mi radius (candidate zone) ────┐
    │                                        │
    │   NEAR EVENTS                          │      FAR EVENTS (15–60 mi)
    │   (candidate venues — recommend        │      (surge flow intelligence —
    │    directly with event-specific        │       NOT destinations; used to
    │    pro_tips: pre-show drop-off,        │       reason about where demand
    │    time window, post-show staging)     │       will ORIGINATE)
    │                                        │
    └────────────────────────────────────────┘
```

**NEAR EVENTS (≤ 15 mi):** Event venues in the driver's candidate radius. If a near event is high-impact and starting/ending within the next 2 hours, `VENUE_SCORER` recommends the event venue directly with event-specific `pro_tips` (time window, pickup surge prediction, pre-show drop-off window, post-show staging advice).

**FAR EVENTS (> 15 mi):** Event venues beyond the candidate radius. They are NOT destinations — they violate the 15-mile rule and cannot be recommended. Instead, `VENUE_SCORER` uses them to reason about demand **origination**: event attendees travel FROM hotels, residential areas, and dining clusters NEAR the driver TO the far venue. That outflow creates pickup demand within the driver's 15-mile radius at the departure end — not at the event itself. `VENUE_SCORER` recommends the closest high-impact venues in the driver's radius that will benefit from the outflow (hotels near freeway on-ramps heading toward the far event, dining hubs, residential / entertainment centers where attendees pre-load before evening events).

### Pipeline flow (post-revert, current state)

```
generateEnhancedSmartBlocks({ snapshotId, immediateStrategy, briefing, snapshot })
    │
    ├─ fetchTodayDiscoveredEventsWithVenue(state, today, driverLat, driverLng, 60)
    │     → state-scoped SELECT + LEFT JOIN venue_catalog
    │     → distance-annotated via haversine and sorted closest-first
    │     → events beyond 60 mi dropped as out-of-metro noise
    │     → returns todayEvents array with `_distanceMiles` on each row
    │
    ├─ filterBriefingForPlanner(briefing, snapshot, todayEvents)
    │     → uses pre-fetched events directly (no further filtering)
    │     → formatBriefingForPrompt buckets events by `_distanceMiles`:
    │         • NEAR EVENTS block — candidate venues (≤ 15 mi)
    │         • FAR EVENTS block — surge flow intelligence (> 15 mi)
    │
    ├─ generateTacticalPlan({ strategy, snapshot, briefingContext })
    │     → VENUE_SCORER system prompt contains "EVENT INTELLIGENCE" block
    │       framing events as intel, not a venue list
    │     → 15-mile hard rule is the supreme constraint; all 4–6 recommendations
    │       are within 15 mi of the driver
    │     → when NEAR events exist, they are candidate venues
    │     → when FAR events exist, they inform demand-origination reasoning
    │
    ├─ enrichVenues(picked, driver, snapshot)
    │     → adds placeId, business hours, drive time
    │
    ├─ matchVenuesToEvents(enrichedVenues, todayEvents)
    │     → place_id / venue_id / name match, no DB query, no distance filter
    │     → in practice only near-bucket events get matched because
    │       VENUE_SCORER only picked ≤ 15-mile venues
    │
    ├─ verifyVenueEventsBatch + catalog promotion
    │
    └─ Insert ranking_candidates with venue_events[] populated for matched venues
```

### Why far events stay in the prompt instead of being discarded

Discarding far events would lose the surge-flow signal they carry. A driver with a distant event in range earns not at the event but at the **departure end** of the surge flow — a hotel, dining hub, or residential/entertainment center in the driver's 15-mile radius where attendees will be requesting rides. Without far events in the prompt, `VENUE_SCORER` has no way to know that those near-driver venues will see event-driven demand tonight. With them in the prompt (but explicitly framed as intelligence, not candidates), `VENUE_SCORER` can reason about which of the close high-impact venues will benefit from the outflow and prioritize them accordingly.

This reframes event data as **a signal about which close-in venues will see demand** rather than **a list of distant venues to drive to**. The signal is valuable; the distant venue as a destination is not.

### Metro context radius (default 60 mi)

`fetchTodayDiscoveredEventsWithVenue` takes a `maxDistanceMiles` parameter (default 60) that caps the events reaching the prompt. This is a **data-layer choice** — it controls what events are worth reasoning over — and is NOT a `VENUE_SCORER` rule. 60 miles covers a typical large metro (the farthest point of a metropolitan area from a reasonable snapshot location) with headroom while excluding events from unrelated neighboring metros hundreds of miles away. Markets with tighter or broader geography can tune this without code changes by passing a different value.

The **15-mile rule is separate** — it's the tactical-layer constraint on what the driver should actually drive to, enforced by the `VENUE_SCORER` prompt. Data-layer and tactical-layer constraints are deliberately decoupled: a 60-mile metro context radius is a choice about *what's worth reasoning over*; the 15-mile rule is a choice about *what to recommend as a destination*. They shouldn't be the same number.

### Global applicability

The NEAR / FAR bucket model is **distance-based only** and culture-neutral. A driver in any city with any metro layout sees the same mechanism: events within the candidate radius are candidates, events beyond are intelligence. The 15-mile candidate radius is the operational reality of rideshare earnings degradation with drive time, which is universal across markets. The 60-mile metro context radius is a default that works for a typical large metro; smaller markets or denser geographies can tune it down.

### Files affected

| File | Role |
|------|------|
| `server/lib/venue/enhanced-smart-blocks.js` | `fetchTodayDiscoveredEventsWithVenue` helper — state-scoped DB query with `LEFT JOIN venue_catalog`, distance annotation, closest-first sort. Wired to call once and pass the result to both the briefing filter and the event matcher. |
| `server/lib/briefing/filter-for-planner.js` | `filterBriefingForPlanner` accepts pre-fetched events as a 3rd arg; `formatBriefingForPrompt` emits two bucketed blocks (NEAR ≤15 mi, FAR >15 mi) based on the `_distanceMiles` annotation. `NEAR_EVENT_RADIUS_MILES = 15` is the single source of truth for the split. |
| `server/lib/strategy/tactical-planner.js` | `VENUE_SCORER` prompt contains the EVENT INTELLIGENCE block framing events as surge-flow intel. 15-mile rule is the single supreme distance constraint. Debug log reports NEAR/FAR split counts on every call. |
| `server/lib/venue/event-matcher.js` | Matches via `place_id` / `venue_id` / name fallback against the pre-fetched events. Synchronous, no DB query. Distance plays no role in the matching itself (the matcher never sees far events that `VENUE_SCORER` didn't pick). |
| `server/lib/venue/SMART_BLOCKS_EVENT_ALIGNMENT_PLAN.md` | Canonical history log of this work: initial design and alignment fix (sections 1–11), first followup fix that introduced the split 15/40 mi rule (section 12), second revert restoring the 15-mile rule and introducing the NEAR/FAR bucket model (section 13). |

### History (at a glance)

This coordination model is the result of three waves of work on 2026-04-11:

1. **Initial Smart Blocks ↔ Event alignment fix** — Wired event data into the `VENUE_SCORER` prompt and rewrote the matcher to use strong identity keys. `VENUE_SCORER` output did not change on the first test run because of a 15-mile hard rule conflict with the CRITICAL event-priority instruction.

2. **First followup fix** — Split the 15-mile rule into "general ≤ 15 mi, event ≤ 40 mi" so distant event venues would become eligible as recommendations. This made event venues appear in the output but **broke the closest-first invariant** — `VENUE_SCORER` started reaching for distant event arenas instead of closer high-impact venues that would have benefited from the same events' surge flow.

3. **Second revert** (current state) — Restored the 15-mile rule as the single absolute distance constraint and reframed events as surge-flow intelligence via the NEAR / FAR bucket model documented above. Closest-first invariant restored. Event data still fully utilized, just differently.

### Load-bearing lesson for future work

> The 15-mile rule is not a bug. It encodes the driver's operational reality: rideshare earnings degrade rapidly with drive time, and the closest high-impact venue nearly always beats a distant one — even if the distant one has a confirmed event. When event data seems to conflict with the 15-mile rule, the resolution is **not** to weaken the rule — it is to find the near-driver venue that benefits from the far event's surge flow.

### Strategist-layer NEAR/FAR annotation (2026-04-11)

Event distance annotation and NEAR/FAR bucketing now happen at **two** layers of the pipeline, both using the same 15-mile threshold to keep the mental model consistent across the system:

1. **Strategist layer** — `server/lib/ai/providers/consolidator.js` annotates events with `distance_mi` + `estimated_attendance` and tags them `[NEAR X.Xmi]` / `[FAR X.Xmi]` before the STRATEGY_TACTICAL / STRATEGY_DAILY prompt is built. The strategist uses this to phase advice hour by hour, recommend NEAR event venues directly, and reason about surge flow from FAR events.
2. **Smart Blocks / VENUE_SCORER layer** — `server/lib/briefing/filter-for-planner.js` + `server/lib/venue/enhanced-smart-blocks.js` annotate events the same way before the VENUE_SCORER prompt is built. VENUE_SCORER enforces the 15-mile rule as the supreme venue-eligibility constraint.

Both layers share `NEAR_EVENT_RADIUS_MILES = 15` as the single source of truth. They both read `venue_lat` / `venue_lng` from the same source — `briefings.events` for the strategist, `discovered_events` JOIN `venue_catalog` for VENUE_SCORER — so distance computations agree. This gives the strategist and VENUE_SCORER the same event data and the same mental model: if the strategist says "recommend The Downtown Theater (NEAR, 3.2mi)," VENUE_SCORER will see the same event with the same distance and make the same call.

**See also:** `server/lib/ai/providers/STRATEGIST_ENRICHMENT_PLAN.md` for the strategist enrichment design, and `server/lib/venue/SMART_BLOCKS_EVENT_ALIGNMENT_PLAN.md` for the VENUE_SCORER 15-mile rule history.

### See also

- `server/lib/venue/SMART_BLOCKS_EVENT_ALIGNMENT_PLAN.md` — full plan with root cause analysis, rejected alternatives, and the history of all three waves of work
- `server/lib/venue/README.md` § "Smart Blocks ↔ Event Venue Coordination" — venue module perspective on the NEAR/FAR model
- `server/lib/briefing/README.md` § "Event Bucketing in `formatBriefingForPrompt`" — briefing module perspective
- `docs/architecture/VENUES.md` — Smart Blocks pipeline reference
- `CHANGELOG.md` — entries under `[Unreleased] — 2026-04-11` documenting all three waves

---

## Canonical Field Names

| Field | Format | Required | Description |
|-------|--------|----------|-------------|
| `event_start_date` | `YYYY-MM-DD` | Yes | Event start date |
| `event_start_time` | `HH:MM` (24h) or `h:mm AM/PM` | Yes | Event start time |
| `event_end_date` | `YYYY-MM-DD` | No | Defaults to `event_start_date` for single-day |
| `event_end_time` | `HH:MM` (24h) or `h:mm AM/PM` | Yes | Required since schema v3 |
| `city` | Text | Yes | **Venue's actual city (from Google Places API, NOT Gemini)** |
| `state` | 2-letter code | Yes | State code (from Places API, NOT Gemini) |
| `venue_name` | Text | Yes | Actual venue name (kept from Gemini for display) |
| `address` | Text | Yes | **Venue's street address (from Google Places API, NOT Gemini)** |
| `place_id` | `ChIJ…` or null | No | Google Places ID |
| `category` | Enum | Yes | `concert` / `sports` / `comedy` / `theater` / `festival` / `nightlife` / `convention` / `community` / `other` |
| `expected_attendance` | Enum | No | `high` / `medium` / `low` (default: `medium`) |
| `event_hash` | MD5 hex (32 chars) | Yes | Deduplication hash (title\|venue_name\|city\|date) |

---

## Validation Rules (13 Hard Filters)

Implemented in `validateEvent.js :: validateEvent()`. `VALIDATION_SCHEMA_VERSION = 4`.

| # | Rule | Field | Rejection Reason |
|---|------|-------|-----------------|
| 1 | Title must exist | `title` | `missing_title` |
| 2 | Title not TBD/Unknown | `title` | `tbd_in_title` |
| 3 | Must have venue OR address | `venue_name/address` | `missing_location` |
| 4 | Venue not TBD/Unknown | `venue_name` | `tbd_in_venue` |
| 5 | Address not TBD/Unknown | `address` | `tbd_in_address` |
| 6 | Start time required | `event_start_time` | `missing_start_time` |
| 7 | Start time not TBD | `event_start_time` | `tbd_in_start_time` |
| 8 | End time required | `event_end_time` | `missing_end_time` |
| 9 | End time not TBD | `event_end_time` | `tbd_in_end_time` |
| 10 | Start date required | `event_start_date` | `missing_start_date` |
| 11 | Date format `YYYY-MM-DD` | `event_start_date` | `invalid_date_format` |
| 12 | Category from allowed list (with fuzzy rescue) | `category` | `missing_or_invalid_category` |
| 13 | Date is today or yesterday | `event_start_date` | `not_today` |

**Invalid patterns matched** (case-insensitive): `\btbd\b`, `\bunknown\b`, `venue\s*tbd`, `location\s*tbd`, `time\s*tbd`, `\(tbd\)`, `to\s*be\s*determined`, `not\s*yet\s*announced`, `coming\s*soon`, `various\s*(locations?|venues?)`.

**Rule 12 fuzzy rescue (2026-04-05, self-healing):** If `event.category` is missing or not in the allowed list, `validateEvent` calls `normalizeCategory(event.category, event.subtype)` as a last-ditch remap before rejecting. This handles cases where Gemini returns unmapped values like `"live_music"`, `"game"`, `"hockey"`, `"concert_live"`. If the remap produces an allowed category, `event.category` is mutated in place and validation continues. Only unrecoverable values fall through to `missing_or_invalid_category`.

**Rule 13 window:** `today` OR `yesterday` (UTC). Yesterday is allowed to cover late-night events discovered before midnight that cross into the next day.

---

## Database Schema

### `discovered_events`

```sql
id                  UUID PRIMARY KEY
title               TEXT NOT NULL
venue_name          TEXT                 -- From Gemini (display name)
address             TEXT                 -- From Google Places API via venue_catalog
city                TEXT NOT NULL        -- From Google Places API, NOT Gemini, NOT snapshot
state               TEXT NOT NULL        -- From Google Places API, NOT Gemini
venue_id            UUID FK -> venue_catalog  -- Enables map pins, coordinates
event_start_date    TEXT NOT NULL        -- YYYY-MM-DD
event_start_time    TEXT                 -- "7:00 PM" or "19:00"
event_end_date      TEXT                 -- Defaults to event_start_date
event_end_time      TEXT NOT NULL        -- Required since schema v3
category            TEXT NOT NULL DEFAULT 'other'
expected_attendance TEXT DEFAULT 'medium'
event_hash          TEXT NOT NULL UNIQUE -- MD5(title|venue_name|city|date) for dedup
is_active           BOOLEAN DEFAULT true
deactivated_at      TIMESTAMP
deactivation_reason TEXT
deactivated_by      TEXT               -- 'ai_coach' or user_id
discovered_at       TIMESTAMP
updated_at          TIMESTAMP
```

### `venue_catalog` (Event-Relevant Fields)

```sql
venue_id            UUID PRIMARY KEY
place_id            TEXT UNIQUE         -- Google Places ID (ChIJ...)
venue_name          VARCHAR(500) NOT NULL
normalized_name     TEXT                -- Lowercase alphanumeric for fuzzy matching
address             VARCHAR(500) NOT NULL
address_1           TEXT                -- Street line only
formatted_address   TEXT                -- Google-formatted full address (validated)
city                TEXT                -- From Google Places API
state               TEXT
zip                 TEXT
country             TEXT DEFAULT 'US'
lat                 DOUBLE PRECISION    -- 6-decimal rounded
lng                 DOUBLE PRECISION    -- 6-decimal rounded
coord_key           TEXT UNIQUE         -- "lat6d_lng6d" format
is_event_venue      BOOLEAN DEFAULT false  -- Set when linked to discovered event
record_status       TEXT DEFAULT 'stub'    -- stub | enriched | verified
timezone            TEXT                   -- IANA timezone
market_slug         TEXT                   -- Metro market identifier
```

---

## Dead Code / Deprecated

These files are referenced in older docs but are NOT active in the pipeline:

| File | Status | Notes |
|------|--------|-------|
| `server/jobs/event-cleanup.js` | Dead code | Never imported in gateway-server.js |
| `server/lib/subagents/event-verifier.js` | Dead code | Never called; replaced by rule-based validation |
| `EVENT_FRESHNESS_AND_TTL.md` sections 4-5 | Inaccurate | TTL automation, cleanup loop, `expires_at` column never implemented |
| Background event sync job | Forbidden (Rule 11) | Events sync per-snapshot only; no cron, no worker |

---

## Change Log

| Date | Change | Files |
|------|--------|-------|
| 2026-04-11 | **Address quality validation layer**: `venue-address-validator.js` (4 checks, hard fail + soft signals, international patterns). `maybeReResolveAddress()` gate on all 4 `findOrCreateVenue` return paths — re-resolves bad addresses via Places API 50km search, re-validates to refuse replacing bad with bad. | venue-address-validator.js, venue-cache.js |
| 2026-04-11 | **Semantic title-similarity dedup**: `deduplicateEventsSemantic.js` with `titlesMatch`, `scoreEventPreference` (+10 for non-stadium venue), `LARGE_VENUE_PATTERNS` regex. Integrated at write time in `fetchEventsWithGemini3ProPreview` and read time in `briefing.js`. Two-phase with hash dedup. | deduplicateEventsSemantic.js, briefing-service.js, briefing.js |
| 2026-04-11 | **`onConflictDoUpdate` fix**: conflict branch now uses resolved address/city/state (was silently reverting corrections to raw Gemini data on every re-discovery). | briefing-service.js |
| 2026-04-11 | **Coordinate precision**: 6-decimal rounding (~11cm) in `searchPlaceWithTextSearch`, `maybeReResolveAddress`, and backfill script to match `coord_key` precision and eliminate FP noise. | venue-address-resolver.js, venue-cache.js, backfill-venue-addresses.js |
| 2026-04-11 | **One-time backfill script**: `scripts/backfill-venue-addresses.js` with two-pass search (unbiased → metro-biased), distance sanity check, cascade to `discovered_events`. Opt-in, not wired into boot. | backfill-venue-addresses.js |
| 2026-04-10 | **Venue resolution via Google Places API (New)**: three-step priority chain (place-ID cache → `searchPlaceWithTextSearch` 50km radius → geocode fallback). City, address, coordinates all come from Places API, not Gemini. DB queries by state (metro-wide). `searchPlaceWithTextSearch` exported with configurable radius. | briefing-service.js, venue-address-resolver.js, briefing.js |
| 2026-04-10 | **Freshness: 1hr post-surge window** for driver relevance; default duration 3h (was 4h) | strategy-utils.js |
| 2026-04-10 | **Hash v2**: `title\|venue_name\|city\|date` (removed time, added city, venue_name instead of venue_address) | hashEvent.js |
| 2026-04-05 | `ALLOWED_CATEGORIES` aligned in Gemini prompt and `validateEvent.js`; Rule 12 gains fuzzy rescue via `normalizeCategory` | briefing-service.js, validateEvent.js |
| 2026-04-04 | `ON CONFLICT` now updates all content fields (was only `updated_at`) | briefing-service.js |
| 2026-03-28 | ALWAYS geocode even when Gemini provides `place_id` | briefing-service.js |
| 2026-02-26 | Gemini-only discovery (no cross-provider fallback); category + today-only rules added (schema v4) | briefing-service.js, validateEvent.js |
| 2026-02-17 | Venue creation gap fixed: geocode + `findOrCreateVenue` | briefing-service.js |
| 2026-02-17 | All-day events get 08:00-22:00 window; category-based default times | normalizeEvent.js |
| 2026-01-14 | Progressive enrichment: `is_event_venue`, `record_status` | venue-cache.js |
| 2026-01-10 | Symmetric field naming (`event_start_date`, etc.) | All pipeline files |
