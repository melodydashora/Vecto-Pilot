> **Last Verified:** 2026-01-14

# External Module (`server/lib/external/`)

## Purpose

Third-party API integrations that don't fit into other domain modules.

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| ~~`tomtom-traffic.js`~~ | **Moved to `server/lib/traffic/tomtom.js`** | Re-exported for backwards compat |
| `faa-asws.js` | FAA airport status | `fetchFAADelayData(airportCode, { strict })` |
| `routes-api.js` | Google Routes API | `getRouteMatrix()`, `getDriveTime()` |
| `semantic-search.js` | Vector/semantic search | `indexFeedback()`, `searchSimilar()` |
| `tts-handler.js` | Text-to-speech | `synthesizeSpeech(text)` |
| `perplexity-api.js` | Perplexity AI API | `queryPerplexity()` |
| `serper-api.js` | SerpAPI web search | `searchSerper()` |
| `streetview-api.js` | Google Street View API | `getStreetViewImage()` |
| `index.js` | Module barrel exports | All external exports |

## Usage

### TomTom Traffic (Moved to `server/lib/traffic/`)

**2026-01-14:** TomTom module moved to `server/lib/traffic/tomtom.js` for architecture cleanup.

```javascript
// NEW LOCATION (preferred)
import { getTomTomTraffic, fetchRawTraffic } from '../traffic/tomtom.js';

// BACKWARDS COMPAT (still works via re-export)
import { getTomTomTraffic } from '../external/index.js';
```

See `server/lib/traffic/README.md` for full documentation.

### FAA Airport Status
```javascript
import { fetchFAADelayData } from './faa-asws.js';

const status = await fetchFAADelayData(airportCode, { strict: true });
// Returns reported disruption fields, unknown coverage/weather, and advisory/fetch times.
// Missing delay minutes remain null. A failed feed throws with its reason.
```

October 5, 2026: this adapter reads the same anonymous national
[JSON airport-events feed](https://nasstatus.faa.gov/api/airport-events) used by
[the FAA NAS website](https://nasstatus.faa.gov/). Concurrent airport lookups share
one in-flight request with a 15-second deadline; completed results are not retained
as a cache. It makes no ASWS or additional XML request and no database lookup.

Reported stops, delays and scoped restrictions retain their reasons. Missing
minutes, coverage and weather remain unknown. An airport absent from this advisory
feed is **not** verified normal or unsupported. `source_updated_at`/`last_updated`
mean the newest available advisory update, while `fetched_at` records transport
time; an empty feed cannot supply an invented source timestamp. National reads
with a null airport code return the listed rows only.

Strict callers receive malformed payload, identity, timestamp and transport errors;
legacy nullable callers receive null. Airport Briefing uses usable FAA conditions
first, then asks Gemini to research conditions only for airports lacking usable
FAA observations. A separate terminal research call consumes that fixed result.
The required Airport section still fails if either required research stage is missing or invalid.
See the [preserved prior contract](../../../docs/architecture/removals/2026-10-05-faa-national-json.md).

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
| FAA NAS | FAA | Reported airport delays, stops and restrictions |
| Routes API | Google | Traffic-aware routing |
| Text-to-Speech | OpenAI | Voice synthesis |

## Connections

- **Imports from:** None (standalone integrations)
- **Exported to:** `../venue/`, `../briefing/`, `../../routes/tts.js`

## Error Handling

All external APIs include retry logic and graceful degradation:
- FAA: Strict Briefing callers receive a failure reason; legacy nullable callers receive null
- Routes: Falls back to straight-line distance
- TTS: Returns error message audio

## Import Paths

```javascript
// From server/api/*/
import { fetchFAADelayData } from '../../lib/external/faa-asws.js';
import { getDriveTime, getRouteMatrix } from '../../lib/external/routes-api.js';
import { synthesizeSpeech } from '../../lib/external/tts-handler.js';
import { searchSimilar, indexFeedback } from '../../lib/external/semantic-search.js';

// From server/lib/*/
import { getDriveTime } from '../external/routes-api.js';
import { fetchFAADelayData } from '../external/faa-asws.js';
```
