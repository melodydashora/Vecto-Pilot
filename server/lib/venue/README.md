> **Last Verified:** 2026-04-11 (address quality validation: venue-address-validator.js, findOrCreateVenue re-resolution gate, backfill script radius fix)

# Venue Module (`server/lib/venue/`)

## 🏛️ Venue Architecture (Source of Truth Design)

### Core Principle

**`venue_catalog` is the SINGLE SOURCE OF TRUTH for all venue data.** Every venue - bars, event venues, stadiums, arenas, restaurants - lives in this one table. Coordinates (lat/lng) come ONLY from venue_catalog, never from transient tables like `discovered_events`.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          VENUE ARCHITECTURE                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────────┐         ┌───────────────────────────────────────────────┐ │
│  │ discovered_events │         │              venue_catalog                    │ │
│  │  (TEMPORARY)      │  FK ──▶ │          (SOURCE OF TRUTH)                   │ │
│  │                   │         │                                               │ │
│  │ • Event metadata  │         │ • Coordinates (lat/lng)                      │ │
│  │ • title, date     │         │ • Google place_id                            │ │
│  │ • venue_name (text)│        │ • formatted_address (verified)               │ │
│  │ • venue_id (FK)  ◀│─────────│ • hours, expense_rank, crowd_level           │ │
│  │                   │         │ • venue_types: ['bar', 'event_venue', ...]   │ │
│  │ ✗ NO lat/lng     │         │ • is_bar, is_event_venue (boolean filters)   │ │
│  │ ✗ NO coordinates │         │                                               │ │
│  └──────────────────┘         └───────────────────────────────────────────────┘ │
│        ▲                                         ▲                               │
│        │ Constant                                │ Places API (New)             │
│        │ Dedup/Purge                             │ Resolution                   │
│        │                                         │                               │
│  ┌─────┴─────────────┐                    ┌──────┴─────────────────────────────┐ │
│  │ Event Discovery   │                    │      Venue Resolution Flow         │ │
│  │ (Gemini/Claude)   │                    │                                    │ │
│  │                   │                    │ 1. Check formatted_address match   │ │
│  │ Produces:         │                    │ 2. If no match → Places API (New)  │ │
│  │ • title           │                    │ 3. Geocode + get place_id          │ │
│  │ • venue_name      │                    │ 4. Insert to venue_catalog         │ │
│  │ • address         │                    │ 5. Return venue_id for FK          │ │
│  │ • date/time       │                    │                                    │ │
│  └───────────────────┘                    └────────────────────────────────────┘ │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Table Responsibilities

| Table | Purpose | Lifecycle | Contains Coordinates? |
|-------|---------|-----------|----------------------|
| **venue_catalog** | Source of truth for ALL venues | Persistent, grows over time | ✅ YES - authoritative |
| **ranking_candidates** | SmartBlocks venue recommendations | Per-snapshot, ephemeral | ✅ YES + venue_id FK to catalog |
| **discovered_events** | Temporary event metadata | Deduplicated/purged constantly | ❌ NO - FK to venue_catalog |

### Venue Type Tagging

The `venue_types` JSONB array allows venues to have **multiple roles**:

```javascript
// Stadium that hosts concerts and sports
{ venue_types: ['stadium', 'event_venue', 'sports'] }

// Bar that also hosts live music events
{ venue_types: ['bar', 'event_venue', 'nightlife'] }

// Restaurant with bar area
{ venue_types: ['restaurant', 'bar'] }
```

**Boolean convenience fields** (planned - see schema migration below):
- `is_bar` - TRUE if venue_types contains 'bar'
- `is_event_venue` - TRUE if venue was discovered via event discovery

These booleans prevent redundant API calls:
- If `is_bar = true`, Bar Tab discovery skips Places API call (already have hours, rating, etc.)
- If `is_event_venue = true`, SmartBlocks knows to check for upcoming events

### Venue Resolution Flow (When Event is Discovered)

When an event is discovered with a venue address:

```
1. EXTRACT: Event discovery yields { venue_name, address, city, state }
     ↓
2. MATCH: Check venue_catalog.formatted_address for exact match
     ↓
   ┌─────────────────────────────────────────────────────┐
   │ Match found?                                        │
   │ • YES → Return existing venue_id, link event FK    │
   │ • NO  → Continue to step 3                         │
   └─────────────────────────────────────────────────────┘
     ↓
3. RESOLVE: Call Google Places API (New)
   • Geocode the address → get lat, lng
   • Get place_id, formatted_address, hours
     ↓
4. INSERT: Create new venue_catalog row
   • Set is_event_venue = true
   • Set venue_types = ['event_venue', <inferred_type>]
     ↓
5. LINK: Update discovered_events.venue_id = new venue_id
```

### Why This Architecture?

1. **Single API Call per Venue**: Once a venue exists in venue_catalog, we never call Places API again for it
2. **No Coordinate Drift**: lat/lng live in ONE place - no risk of stale coords in events
3. **Bar Discovery Efficiency**: If we discover a venue via events and it's a bar, we skip it in Bar Tab discovery
4. **Event → Venue Join**: SmartBlocks can easily find "venues with events tonight" via the FK

### Schema Migration (Pending)

Add boolean convenience fields for faster queries:

```sql
ALTER TABLE venue_catalog
  ADD COLUMN IF NOT EXISTS is_bar BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_event_venue BOOLEAN DEFAULT FALSE;

-- Backfill from venue_types
UPDATE venue_catalog SET is_bar = TRUE
  WHERE venue_types ? 'bar';

UPDATE venue_catalog SET is_event_venue = TRUE
  WHERE venue_types ? 'event_venue' OR venue_types ? 'event_host';

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_venue_catalog_is_bar
  ON venue_catalog (is_bar) WHERE is_bar = TRUE;

CREATE INDEX IF NOT EXISTS idx_venue_catalog_is_event_venue
  ON venue_catalog (is_event_venue) WHERE is_event_venue = TRUE;
```

### Address Quality Validation (2026-04-11)

When venue resolution via Google Places API returns a result, **address quality is validated before the data is used.** This catches bad results like `"Theatre, Frisco, TX 75034"` (venue name fragment leaked into address) or `"Dallas, TX, USA"` (city-only, no street).

**Validation checks** (in `venue-address-validator.js`):

| Check | Type | What It Catches |
|-------|------|-----------------|
| `ADDRESS_HAS_STREET_NUMBER` | Soft signal | Addresses missing any digits (e.g., "Frisco, TX, USA") |
| `ADDRESS_NOT_GENERIC` | **Hard fail** | Venue type words as address (e.g., "Theatre, Frisco, TX") |
| `ADDRESS_HAS_STREET_NAME` | Soft signal | Missing street patterns like St, Ave, Blvd, Way |
| `COORD_SANITY` | Soft signal | Coords don't match the city in the address |

**Scoring:** Hard fail = always invalid. 2+ soft signal failures = invalid. 1 soft signal = valid with warning.

**Integration points:**

1. **`venue-cache.js` `findOrCreateVenue()`**: After lookup/creation, `maybeReResolveAddress()` validates the address. If invalid, triggers Places API re-resolution (50km radius) and updates venue_catalog.
2. **`briefing-service.js` event pipeline**: After venue resolution, validates the final address before inserting into `discovered_events`. Logs `[VENUE-VALIDATE]` warnings for monitoring.

**Global-aware:** Checks use international street patterns (German Straße, French Rue, Spanish Calle). Street number check is a soft signal because some international addresses don't have numbers.

### Venue Enrichment on Discovery (2026-02-26)

When a venue is created or matched during event discovery, `venue-cache.js` now triggers non-blocking enrichment to fill in missing data (phone, rating, hours, business status, types).

**Two enrichment paths:**

| Trigger | Function | When |
|---------|----------|------|
| New venue created | `enrichVenueFromPlaceId()` | After `findOrCreateVenue()` inserts a new row with a `place_id` |
| Existing venue matched | `maybeBackfillVenue()` | When lookup finds a venue missing `phone_number` or `google_rating` |

**How `enrichVenueFromPlaceId()` works:**
1. Calls Google Places API: `GET /v1/places/{placeId}` with field mask
2. Fields requested: `displayName`, `nationalPhoneNumber`, `regularOpeningHours`, `rating`, `priceLevel`, `businessStatus`, `types`, `primaryType`
3. Updates `venue_catalog` row with: `phone_number`, `google_rating`, `business_hours`, `hours_full_week`, `last_known_status`, `venue_types`, `record_status='verified'`
4. Only writes if at least one useful field (phone, rating, or hours) was returned

**How `maybeBackfillVenue()` works:**
- Checks if the venue has both `phone_number` AND `google_rating` (both require Places API)
- If either is missing and a valid `place_id` exists (`ChIJ...` prefix), triggers `enrichVenueFromPlaceId()` as fire-and-forget
- Called on all 3 match strategies in `findOrCreateVenue()`: place_id match, coord_key match, and fuzzy name match

**Key design decisions:**
- **Non-blocking:** Event processing continues immediately; enrichment runs as `.catch()` fire-and-forget
- **Cheaper than searchNearby:** Uses single-place lookup by known ID (basic detail tier pricing)
- **Idempotent:** Re-running enrichment on an already-enriched venue is a no-op (phone + rating check)

### Files Involved

| File | Role in Architecture |
|------|---------------------|
| `venue-cache.js` | CRUD operations for venue_catalog + enrichment on discovery |
| `venue-enrichment.js` | Places API (New) calls for geocoding + searchNearby |
| `venue-utils.js` | Address normalization, coord_key generation |
| `../briefing/briefing-service.js` | Event discovery → venue linking |
| `../events/pipeline/normalizeEvent.js` | Event normalization (no coords) |

## ⚠️ Important: No Timezone Fallbacks (2026-01-07)

**`isOpen` returns `null` if timezone is missing** - NOT a UTC fallback.

Per CLAUDE.md "NO FALLBACKS" rule: UTC would be wrong for non-UTC users (e.g., Tokyo user would see wrong open/closed status). If snapshot.timezone is null:
- `enrichVenues()` logs warning: "No timezone in snapshot - isOpen will be null"
- `getOpenStatus()` returns `{ is_open: null, reason: "Missing timezone" }` instead of guessing

## 🆕 Canonical Hours Module (D-014 - 2026-01-10)

**All `isOpen` calculations now use the canonical `hours/` module.**

```javascript
import { parseGoogleWeekdayText, getOpenStatus } from './hours/index.js';

// Parse Google Places weekday_text array
const parseResult = parseGoogleWeekdayText([
  "Monday: 4:00 PM – 2:00 AM",
  "Tuesday: 4:00 PM – 2:00 AM",
  "Wednesday: Closed"
]);

// Evaluate open status with timezone
if (parseResult.ok) {
  const status = getOpenStatus(parseResult.schedule, "America/Chicago");
  console.log(status.is_open);      // true/false/null
  console.log(status.closes_at);    // "02:00"
  console.log(status.closing_soon); // true if within 60 min
}
```

**Key Benefits:**
- Single source of truth for all open/closed logic
- Handles overnight hours correctly (4PM-2AM)
- Never trusts Google's `openNow` directly - always parses weekdayDescriptions
- Explicit error handling (no silent guessing)

See `hours/README.md` for full documentation.

## Purpose

Venue discovery, enrichment, and Smart Blocks generation. Produces the ranked venue recommendations shown in the app.

**Two Separate Venue Systems:**

| System | Purpose | Log Prefix | UI Location |
|--------|---------|------------|-------------|
| **VENUES Pipeline** | Strategy-driven recommendations | `🏢 [VENUES]` | Main strategy tab |
| **Bar Tab Discovery** | Premium bars sidebar | `🍸 [BAR TAB]` | Bar Tab sidebar |

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `hours/` | **Canonical hours evaluation** | `parseGoogleWeekdayText()`, `getOpenStatus()` |
| `enhanced-smart-blocks.js` | VENUES pipeline orchestrator + catalog promotion | `generateEnhancedSmartBlocks(snapshotId)` |
| `venue-intelligence.js` | Bar Tab discovery (GPT-5.2) | `discoverNearbyVenues()` |
| `venue-enrichment.js` | Google Places/Routes data | `enrichVenue()`, `getBatchDriveTimes()` |
| `venue-address-resolver.js` | Batch geocoding + Places API text search | `resolveAddresses()`, `searchPlaceWithTextSearch()` |
| `venue-address-validator.js` | Address quality validation (string-only, no API calls) | `validateVenueAddress()`, `isAddressValid()` |
| `venue-event-verifier.js` | Event verification | `verifyVenueEvents()` |
| `venue-cache.js` | Venue deduplication cache + timezone + enrichment | `findOrCreateVenue()`, `lookupVenue()`, `enrichVenueFromPlaceId()`, `maybeBackfillVenue()` |
| `venue-utils.js` | Venue consolidation utilities | `parseAddressComponents()`, `calculateIsOpenFromHoursTextMap()` (**Note:** `generateCoordKey` is now imported from `server/lib/location/coords-key.js`) |
| `district-detection.js` | Entertainment district identification | `detectDistrict()` |
| `event-matcher.js` | Event-to-venue matching | `matchEventsToVenues()` |
| `index.js` | Module barrel exports | All venue exports |

## Pipeline Flow

```
generateEnhancedSmartBlocks(snapshotId)
    ↓
1. Fetch strategy_for_now from strategies table
    ↓
2. venue-intelligence.js
   └── Google Places API: searchNearbyVenues()
    ↓
3. venue-enrichment.js
   ├── Google Places API: getVenueDetails() (hours, ratings)
   └── Google Routes API: getBatchDriveTimes() (distance, ETA)
    ↓
4. venue-event-verifier.js
   └── Verify events with Gemini (optional)
    ↓
5. Catalog promotion (2026-03-28)
   └── venue-cache.js: upsertVenue() for verified venues (placeVerified + placeId)
   └── Returns venue_id map for FK storage on ranking_candidates
    ↓
6. Write to rankings + ranking_candidates tables (with venue_id FK to venue_catalog)
```

## Usage

```javascript
import { generateEnhancedSmartBlocks } from './enhanced-smart-blocks.js';

const blocks = await generateEnhancedSmartBlocks(snapshotId);
// Returns: { ok: boolean, blocks: [...], ranking_id: string }
```

## Bar Tab Discovery (venue-intelligence.js)

Separate from main VENUES pipeline. Discovers premium bars for the Bar Tab sidebar.

```javascript
import { discoverNearbyVenues } from './venue-intelligence.js';

const venues = await discoverNearbyVenues(lat, lng, city, state, {
  radius_miles: 10,
  limit: 8
});
```

**Model Configuration (GPT-5.2):**
```javascript
// CORRECT - GPT-5.2 parameters
{
  model: 'gpt-5.1',
  reasoning_effort: 'low',      // Fast discovery
  max_completion_tokens: 8000,  // NOT max_tokens!
  response_format: { type: 'json_object' }
}

// WRONG - causes 400 error
{
  temperature: 0.1,     // Not supported by GPT-5.2
  max_tokens: 8000      // Use max_completion_tokens instead
}
```

## External APIs Used

| API | Purpose | File |
|-----|---------|------|
| OpenAI GPT-5.2 | Bar Tab discovery | `venue-intelligence.js` |
| Google Places (searchNearby) | Find venues near location | `venue-enrichment.js` |
| Google Places (getDetails) | Business hours, ratings | `venue-enrichment.js` |
| Google Places (GET by placeId) | Enrich venue on discovery (phone, rating, hours, types) | `venue-cache.js` |
| Google Routes API | Drive time, distance | `venue-enrichment.js` |
| Google Geocoding API | Address resolution | `venue-address-resolver.js` |

## Connections

- **Imports from:** `../ai/adapters/` (event verification), `../../db/`
- **Exported to:** `../../routes/blocks-fast.js`
- **Triggered by:** Strategy completion in `../strategy/`

## Database Writes

- `rankings` table: Ranking session metadata
- `ranking_candidates` table: Individual venue recommendations with enrichment data

## Venue Catalog (venue-cache.js)

**Updated 2026-01-05**: The venue system now uses a single `venue_catalog` table (consolidated from `venue_cache` + `nearby_venues`).

**Features:**
- **Deduplication**: Normalized venue names + `coord_key` (6 decimal precision ~11cm)
- **Multi-role tagging**: `venue_types` JSONB array (e.g., `['bar', 'event_host']`)
- **Bar Markers**: `expense_rank`, `hours_full_week` for is_open/closing_soon logic
- **Address parsing**: Granular fields (`address_1`, `city`, `state`, `zip`)
- **Event linking**: `discovered_events.venue_id` FK to `venue_catalog.venue_id`

**Usage:**
```javascript
import { findOrCreateVenue, lookupVenue, getEventsForVenue, getVenuesByType } from './venue-cache.js';

// Find or create a venue during event discovery
const venue = await findOrCreateVenue({
  venue: "AT&T Stadium",
  address: "1 AT&T Way, Arlington, TX",
  latitude: 32.7473,
  longitude: -97.0945,
  city: "Arlington",
  state: "TX"
}, 'sync_events_gpt52');

// Look up existing venue by name, coords, or place_id
const cached = await lookupVenue({
  venueName: "AT&T Stadium",
  city: "Arlington",
  state: "TX"
});

// Get all events at a venue (for SmartBlocks "event tonight" flag)
const events = await getEventsForVenue(venueId, {
  fromDate: "2026-01-01"
});

// Get bars/restaurants by type (for Bar Tab)
const bars = await getVenuesByType({
  venueTypes: ['bar', 'restaurant'],
  city: 'Dallas',
  state: 'TX',
  limit: 50
});
```

**Database Table:** `venue_catalog` with FK in `discovered_events.venue_id`

**Deprecated Tables:** `venue_cache` and `nearby_venues` are consolidated into `venue_catalog`

## Key Data Structures

```javascript
// Smart Block (venue recommendation)
{
  rank: 1,
  name: "Downtown Airport",
  category: "airport",
  address: "123 Terminal Way",
  distance_mi: 5.2,
  drive_time_min: 12,
  score: 95,
  reason: "High pickup volume expected",
  hours: "Open 24 hours",
  place_id: "ChIJ..."
}
```

## Import Paths

```javascript
// From server/api/*/
import { generateEnhancedSmartBlocks } from '../../lib/venue/enhanced-smart-blocks.js';
import { searchNearbyVenues } from '../../lib/venue/venue-intelligence.js';

// From server/lib/*/
import { generateEnhancedSmartBlocks } from '../venue/enhanced-smart-blocks.js';

// From server/jobs/
import { generateEnhancedSmartBlocks } from '../lib/venue/enhanced-smart-blocks.js';
```
