# Venue Module (`server/lib/venue/`)

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
| `enhanced-smart-blocks.js` | VENUES pipeline orchestrator | `generateEnhancedSmartBlocks(snapshotId)` |
| `venue-intelligence.js` | Bar Tab discovery (GPT-5.1) | `discoverNearbyVenues()` |
| `venue-enrichment.js` | Google Places/Routes data | `enrichVenue()`, `getBatchDriveTimes()` |
| `venue-address-resolver.js` | Batch geocoding | `resolveAddresses()` |
| `venue-event-verifier.js` | Event verification | `verifyVenueEvents()` |
| `event-proximity-boost.js` | Airport proximity scoring | `calculateProximityBoost()` |

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

**Model Configuration (GPT-5.1):**
```javascript
// CORRECT - GPT-5.1 parameters
{
  model: 'gpt-5.1',
  reasoning_effort: 'low',      // Fast discovery
  max_completion_tokens: 8000,  // NOT max_tokens!
  response_format: { type: 'json_object' }
}

// WRONG - causes 400 error
{
  temperature: 0.1,     // Not supported by GPT-5.1
  max_tokens: 8000      // Use max_completion_tokens instead
}
```

## External APIs Used

| API | Purpose | File |
|-----|---------|------|
| OpenAI GPT-5.1 | Bar Tab discovery | `venue-intelligence.js` |
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
