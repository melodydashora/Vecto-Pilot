> **Last Verified:** 2026-01-06

# External Module (`server/lib/external/`)

## Purpose

Third-party API integrations that don't fit into other domain modules.

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `tomtom-traffic.js` | TomTom real-time traffic | `getTomTomTraffic()` |
| `faa-asws.js` | FAA airport status | `fetchFAAStatus(airportCode)` |
| `routes-api.js` | Google Routes API | `getRouteMatrix()`, `getDriveTime()` |
| `semantic-search.js` | Vector/semantic search | `indexFeedback()`, `searchSimilar()` |
| `tts-handler.js` | Text-to-speech | `synthesizeSpeech(text)` |
| `perplexity-api.js` | Perplexity AI API | `queryPerplexity()` |
| `serper-api.js` | SerpAPI web search | `searchSerper()` |
| `streetview-api.js` | Google Street View API | `getStreetViewImage()` |
| `index.js` | Module barrel exports | All external exports |

## Usage

### TomTom Traffic (Primary Traffic Provider)
```javascript
import { getTomTomTraffic } from './tomtom-traffic.js';

const result = await getTomTomTraffic({
  lat: 40.7128,
  lon: -74.0060,
  radiusMiles: 15,
  city: 'New York',
  state: 'NY'
});

// Returns prioritized incidents sorted by:
// 1. Road type (Interstate/Motorway > US/A-road > State > local)
// 2. Incident severity (Major > Moderate > Minor)
// 3. Category (closures > construction > accidents > jams)
//
// Works globally: US interstates, UK motorways, European routes
//
// result.traffic.incidents      - Top 15 prioritized incidents
// result.traffic.stats          - { highways, construction, closures, jams }
// result.traffic.congestionLevel - 'light' | 'moderate' | 'heavy'
```

### FAA Airport Status
```javascript
import { fetchFAAStatus } from './faa-asws.js';

const status = await fetchFAAStatus('DFW');
// Returns: { delays: [...], closures: [...], status: 'normal' }
```

### Google Routes API
```javascript
import { getDriveTime } from './routes-api.js';

const route = await getDriveTime(origin, destination);
// Returns: { distance_mi: 5.2, duration_min: 12, traffic_delay: 3 }
```

### Text-to-Speech
```javascript
import { synthesizeSpeech } from './tts-handler.js';

const audioBuffer = await synthesizeSpeech("Your strategy is ready");
// Returns: Buffer (MP3 audio)
```

### Semantic Search
```javascript
import { searchSimilar } from './semantic-search.js';

const results = await searchSimilar("airport pickup strategy");
// Returns: [{ content: "...", score: 0.95 }, ...]
```

## External APIs

| API | Provider | Purpose |
|-----|----------|---------|
| TomTom Traffic | TomTom | Real-time traffic incidents (primary) |
| FAA ASWS | FAA | Airport delays, closures |
| Routes API | Google | Traffic-aware routing |
| Text-to-Speech | OpenAI | Voice synthesis |

## Connections

- **Imports from:** None (standalone integrations)
- **Exported to:** `../venue/`, `../briefing/`, `../../routes/tts.js`

## Error Handling

All external APIs include retry logic and graceful degradation:
- FAA: Returns empty status if unavailable
- Routes: Falls back to straight-line distance
- TTS: Returns error message audio

## Import Paths

```javascript
// From server/api/*/
import { fetchFAAStatus } from '../../lib/external/faa-asws.js';
import { getDriveTime, getRouteMatrix } from '../../lib/external/routes-api.js';
import { synthesizeSpeech } from '../../lib/external/tts-handler.js';
import { searchSimilar, indexFeedback } from '../../lib/external/semantic-search.js';

// From server/lib/*/
import { getDriveTime } from '../external/routes-api.js';
import { fetchFAAStatus } from '../external/faa-asws.js';
```
