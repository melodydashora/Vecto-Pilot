# Venue Module (`server/lib/venue/`)

## Purpose

Venue discovery, enrichment, and Smart Blocks generation. Produces the ranked venue recommendations shown in the app.

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `enhanced-smart-blocks.js` | Main orchestrator | `generateEnhancedSmartBlocks(snapshotId)` |
| `venue-intelligence.js` | Venue discovery | `searchNearbyVenues()`, `getVenueDetails()` |
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

## External APIs Used

| API | Purpose | File |
|-----|---------|------|
| Google Places (searchNearby) | Find venues near location | `venue-intelligence.js` |
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
