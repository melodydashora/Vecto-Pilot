> **Last Verified:** 2026-02-17

# Venue API (`server/api/venue/`)

## Purpose

Venue intelligence and recommendations for rideshare drivers.

## Files

| File | Route | Purpose |
|------|-------|---------|
| `venue-intelligence.js` | `/api/venues/*` | Venue recommendations |
| `index.js` | — | Barrel exports |

### Removed Files (2026-02-17)

| File | Reason |
|------|--------|
| `venue-events.js` | Fully duplicated by `event-matcher.js` + `venue-event-verifier.js` in SmartBlocks pipeline |
| `closed-venue-reasoning.js` | Fully duplicated by `tactical-planner.js` (`strategic_timing` field in `ranking_candidates`) |

## Endpoints

### Venue Intelligence
```
GET  /api/venues/:placeId         - Get venue details
POST /api/venues/enrich           - Enrich venue with hours, events
GET  /api/venues/nearby           - Get nearby venues
GET  /api/venues/traffic          - Venue traffic/busyness data
GET  /api/venues/smart-blocks     - Get smart blocks for venues
GET  /api/venues/last-call        - Venues near closing time
```

## Data Enrichment

Venues are enriched with:
- Business hours (Google Places API)
- Events (SmartBlocks event-matcher.js + venue-event-verifier.js)
- Drive time (Google Routes API)
- Address verification
- Timezone (resolved from markets table via `resolveTimezoneFromMarket`)

## Connections

- **Uses:** `../../lib/venue/venue-enrichment.js`
- **Uses:** `../../lib/venue/venue-intelligence.js`
- **Uses:** `../../lib/location/resolveTimezone.js` (timezone on venue creation)
- **Uses:** Google Places API, Routes API
- **Called by:** Strategy pipeline, venue cards

## Import Paths

```javascript
// Database
import { db } from '../../db/drizzle.js';
import { rankings, ranking_candidates } from '../../../shared/schema.js';

// Venue lib
import { searchNearbyVenues, getVenueDetails } from '../../lib/venue/venue-intelligence.js';
import { enrichVenue, getBatchDriveTimes } from '../../lib/venue/venue-enrichment.js';

// AI
import { callModel } from '../../lib/ai/adapters/index.js';
```
