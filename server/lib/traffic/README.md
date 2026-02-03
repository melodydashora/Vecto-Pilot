# Traffic Module

Real-time traffic data integration for rideshare driver intelligence.

## Overview

This module provides traffic data from TomTom API for use in briefings and route planning.

## Files

| File | Purpose |
|------|---------|
| `tomtom.js` | TomTom Traffic API integration |

## Functions

### `fetchRawTraffic(lat, lng, radiusMiles)`

**New in 2026-01-14** - Returns raw TomTom API data for AI processing.

```javascript
import { fetchRawTraffic } from '../traffic/tomtom.js';

const rawTraffic = await fetchRawTraffic(33.0198, -96.6989, 10);
// Returns: { flowSegmentData, incidents, bbox, driverLocation, fetchedAt }
```

Use this when you want to send traffic data to an AI model (like Gemini) for analysis.

### `getTomTomTraffic({ lat, lon, city, state, radiusMiles })`

Returns pre-processed and prioritized traffic data ready for display.

```javascript
import { getTomTomTraffic } from '../traffic/tomtom.js';

const { traffic } = await getTomTomTraffic({
  lat: 33.0198,
  lon: -96.6989,
  city: 'Frisco',
  state: 'TX',
  radiusMiles: 10
});
// Returns: { summary, incidents, congestionLevel, stats, ... }
```

### `getTomTomTrafficForCity({ city, state, lat, lon })`

Convenience wrapper for city-level traffic queries.

## Architecture

```
Driver Request
     │
     ▼
fetchRawTraffic()  ──────► Raw TomTom Data ──────► Gemini 3 Pro
     │                                                   │
     │                                                   ▼
     │                                          Traffic Briefing
     │                                                   │
     ▼                                                   │
getTomTomTraffic() ──────► Processed Data ◄──────────────┘
     │
     ▼
  Briefing UI
```

## Data Flow

1. **Raw Fetch** (`fetchRawTraffic`): Gets incidents and flow data from TomTom
2. **AI Processing**: Gemini analyzes raw data for strategic insights
3. **Display Processing** (`getTomTomTraffic`): Prioritizes, deduplicates, filters by distance

## TomTom API Details

- **Endpoint**: Traffic Incident Details API v5
- **Rate Limit**: 2,500 requests/day (free tier)
- **Update Frequency**: Every minute
- **Docs**: https://developer.tomtom.com/traffic-api

## Environment Variables

```bash
TOMTOM_API_KEY=...  # Required for traffic data
```

## Incident Categories

| Code | Label |
|------|-------|
| 1 | Accident |
| 6 | Jam |
| 7 | Lane Closed |
| 8 | Road Closed |
| 9 | Road Works |
| 11 | Flooding |

## Road Priority

Incidents are prioritized by road importance:
- **100**: Interstates (I-35), Motorways (M25)
- **90**: US Highways (US-75), European A-roads
- **80**: State Highways (TX-114, CA-1)
- **70**: Generic Highways
- **50**: Boulevards
- **25**: Streets, Drives

## Related Files

- `server/lib/briefing/briefing-service.js` - Uses traffic data for briefings
- `server/lib/ai/providers/` - AI analysis of traffic data
