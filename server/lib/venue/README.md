> **Last Verified:** 2026-01-10

# Venue Module (`server/lib/venue/`)

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
| `enhanced-smart-blocks.js` | VENUES pipeline orchestrator | `generateEnhancedSmartBlocks(snapshotId)` |
| `venue-intelligence.js` | Bar Tab discovery (GPT-5.2) | `discoverNearbyVenues()` |
| `venue-enrichment.js` | Google Places/Routes data | `enrichVenue()`, `getBatchDriveTimes()` |
| `venue-address-resolver.js` | Batch geocoding | `resolveAddresses()` |
| `venue-event-verifier.js` | Event verification | `verifyVenueEvents()` |
| `event-proximity-boost.js` | Airport proximity scoring | `calculateProximityBoost()` |
| `venue-cache.js` | Venue deduplication cache | `findOrCreateVenue()`, `lookupVenue()` |
| `venue-utils.js` | Venue consolidation utilities | `parseAddressComponents()`, `generateCoordKey()`, `calculateIsOpenFromHoursTextMap()` |
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
5. event-proximity-boost.js
   └── Apply airport proximity scores
    ↓
6. Write to rankings + ranking_candidates tables
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
