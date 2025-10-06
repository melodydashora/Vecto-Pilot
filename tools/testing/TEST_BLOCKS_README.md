# Test-Blocks Testing Infrastructure

**Complete testing setup for isolated LLM model performance testing**

---

## Overview

`test-blocks.js` is a **simplified, no-fallback** version of the production `blocks.js` route. It allows you to test individual LLM models with custom parameters in isolation—no hedging, no fallback logic, just pure single-model calls.

### Key Features
- **Single-model testing**: Test Gemini, GPT-5, or Claude independently
- **Custom parameters**: Temperature (Gemini/Claude) or reasoning_effort (GPT-5)
- **Full context snapshots**: Same context as production (weather, location, time, etc.)
- **Drive time calculations**: Real Google Maps API integration for accurate drive times
- **Availability checking**: Google Places API for open/closed status
- **ML instrumentation**: Full ranking and candidate tracking

---

## Files Included

```
tools/testing/
├── TEST_BLOCKS_README.md          ← You are here
├── test-blocks-examples.txt       ← Sample API calls
└── test-blocks-analysis.md        ← Performance comparison data

server/routes/
└── test-blocks.js                 ← Main testing route (already registered)
```

---

## How to Use

### 1. API Endpoint

```
GET /api/test-blocks
```

### 2. Required Parameters

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `lat` | float | Driver latitude | `32.7767` |
| `lng` | float | Driver longitude | `-96.7970` |
| `llmModel` | string | Model to test | `gemini`, `gpt-5`, `claude`, `anthropic`, `openai`, `google` |
| `llmParam` | string/float | Model-specific parameter | `0.0` (temp) or `medium` (reasoning) |

### 3. Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `userId` | string | `'default'` | User ID for personalization |
| `minDistance` | int | `8` | Minimum drive time (minutes) |
| `maxDistance` | int | `10` | Maximum drive time (minutes) |

### 4. Headers (Optional)

```
X-Snapshot-Id: <snapshot_id>
```
Bind to a specific context snapshot for reproducible testing.

---

## Testing Examples

### Test Gemini 2.5 Pro (Temperature 0.0)
```bash
curl "http://localhost:5000/api/test-blocks?lat=32.7767&lng=-96.7970&llmModel=gemini&llmParam=0.0"
```

### Test GPT-5 (Medium Reasoning)
```bash
curl "http://localhost:5000/api/test-blocks?lat=32.7767&lng=-96.7970&llmModel=gpt-5&llmParam=medium"
```

### Test Claude Sonnet 4.5 (Temperature 0.2)
```bash
curl "http://localhost:5000/api/test-blocks?lat=32.7767&lng=-96.7970&llmModel=claude&llmParam=0.2"
```

### Test with Custom Range
```bash
curl "http://localhost:5000/api/test-blocks?lat=32.7767&lng=-96.7970&llmModel=gemini&llmParam=0.0&minDistance=5&maxDistance=15"
```

---

## Model-Specific Parameters

### Gemini / Claude (Temperature)
- **Parameter**: `llmParam=<float>`
- **Range**: 0.0 - 1.0
- **Recommendation**: `0.0` for consistency, `0.2` for slight creativity

```bash
# Gemini with temperature 0.0 (most deterministic)
curl "...&llmModel=gemini&llmParam=0.0"

# Claude with temperature 0.2 (slightly creative)
curl "...&llmModel=claude&llmParam=0.2"
```

### GPT-5 (Reasoning Effort)
- **Parameter**: `llmParam=<string>`
- **Values**: `minimal`, `low`, `medium`, `high`
- **Recommendation**: `medium` for balanced speed/quality

```bash
# GPT-5 with minimal reasoning (fastest)
curl "...&llmModel=gpt-5&llmParam=minimal"

# GPT-5 with high reasoning (deepest analysis)
curl "...&llmModel=gpt-5&llmParam=high"
```

---

## Response Format

```json
{
  "strategy": "Strategic overview for current conditions",
  "blocks": [
    {
      "name": "Dallas/Fort Worth International Airport - Terminal C",
      "description": "Strategic analysis of this location",
      "address": "2400 Aviation Dr, DFW Airport, TX 75261",
      "coordinates": {"lat": 32.8998, "lng": -97.0403},
      "estimatedWaitTime": 15,
      "estimatedEarningsPerRide": 24,
      "demandLevel": "high",
      "category": "airport",
      "businessHours": "24/7",
      "isOpen": true,
      "businessStatus": "OPERATIONAL",
      "driveDistanceMiles": "12.3",
      "driveTimeSource": "maps",
      "earningsPerMileApproach": 1.95,
      "stagingArea": {
        "type": "Premium",
        "name": "Cell Phone Lot",
        "address": "Terminal C Level 1",
        "walkTime": "2 min",
        "parkingTip": "Free lot, follow signs"
      },
      "proTips": [
        "Peak arrivals 5-7pm weekdays",
        "International flights = higher fares"
      ],
      "events": null
    }
  ],
  "meta": {
    "llmProvider": "google",
    "llmModel": "gemini-2.5-pro",
    "responseTimeMs": 22400,
    "blocksReturned": 6,
    "blocksFiltered": 5,
    "cityContext": "Dallas",
    "dayPart": "afternoon",
    "weather": "90°F, Clear",
    "timestamp": "2025-10-03T22:13:45.123Z"
  }
}
```

---

## What Gets Tested

### ✅ Context Resolution
- GPS coordinates → City/State
- Timezone detection
- Live weather data
- Air quality data
- Day part calculation (morning/afternoon/evening/etc.)

### ✅ LLM Response Quality
- JSON structure validity
- City hallucination detection
- Business hours accuracy
- Strategic relevance
- Recommendation variety

### ✅ Availability Checking
- Google Places API integration
- Open/closed status verification
- Business status tracking

### ✅ Drive Time Calculation
- Google Directions API (live traffic)
- Fallback predictive model
- Distance calculation
- Traffic-aware routing

### ✅ ML Instrumentation
- Ranking ID generation
- Candidate tracking
- Exposure logging
- Timestamp correlation

---

## Performance Comparison (October 2025)

| Model | Avg Latency | Reliability | JSON Quality | Cost/1K Req |
|-------|-------------|-------------|--------------|-------------|
| **Gemini 2.5 Pro** | 22.4s | 100% | Excellent | ~$15 |
| **GPT-5** | 45-60s | 98% | Excellent | ~$50 |
| **Claude Sonnet 4.5** | 35-40s | 95% | Good | ~$30 |

**Winner**: Gemini 2.5 Pro (fastest, cheapest, 100% reliable)

---

## Debugging Tips

### 1. Check Console Logs
```bash
# Look for test-blocks specific logs
grep "🧪 TEST MODE" /tmp/logs/Eidolon_Main_*.log
```

### 2. Verify API Keys
```bash
# Test endpoint should log API key presence
curl "...&llmModel=gemini&llmParam=0.0" | grep "API Key present"
```

### 3. JSON Parse Failures
If you see JSON parse errors, check the raw LLM response in logs:
```
❌ GEMINI JSON parse failed: Unexpected token
📝 Response length: 8234 chars
📄 First 1000 chars: {...}
📄 Last 500 chars: {...}
```

The route includes **recovery logic** that attempts to extract valid JSON from malformed responses.

### 4. City Hallucination Detection
```
⚠️ CITY MISMATCH: Strategy doesn't mention "Dallas"
   Strategy text: Peak dinner rush in Houston - stay close...
```

---

## Integration with Production

### Key Differences from `blocks.js`

| Feature | test-blocks.js | blocks.js (Production) |
|---------|----------------|------------------------|
| **Fallback Logic** | ❌ None | ✅ 3-model hedging |
| **Error Recovery** | ❌ Throws errors | ✅ Graceful degradation |
| **Model Selection** | Manual via param | Automatic router |
| **Timeout Handling** | Default fetch | Circuit breakers |
| **Caching** | ❌ None | ✅ Smart caching |
| **Purpose** | Testing/benchmarking | Production reliability |

### When to Use Each

**Use `test-blocks.js` for**:
- Model performance benchmarking
- Temperature/parameter tuning
- JSON schema validation
- New model evaluation
- Cost analysis

**Use `blocks.js` for**:
- Production traffic
- End-user requests
- High availability needs
- Automatic failover

---

## Environment Variables Required

```bash
# Required for testing
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AI...

# Optional (for model configuration)
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
OPENAI_MODEL=gpt-5
GEMINI_MODEL=gemini-2.5-pro

# Required for enrichment
GOOGLE_MAPS_API_KEY=AIza...
GOOGLEAQ_API_KEY=AIza...  # Air quality
PERPLEXITY_API_KEY=pplx-...

# Database
DATABASE_URL=postgresql://...
```

---

## Known Issues & Fixes

### ✅ Fixed: Geocoding Failures
**Problem**: City showing as "Unknown"
**Fix**: Added live geocoding fallback when snapshot missing

### ✅ Fixed: JSON Parse Errors
**Problem**: LLM returning markdown code blocks
**Fix**: Added robust cleanup and recovery logic

### ✅ Fixed: City Hallucination
**Problem**: LLM recommending wrong metro area
**Fix**: Added city validation + warning logs

### ✅ Fixed: Drive Time Accuracy
**Problem**: Using straight-line distance
**Fix**: Google Directions API with live traffic

---

## Unpacking & Running

### 1. Copy Files
```bash
# Already in your codebase at:
# - server/routes/test-blocks.js (registered in gateway-server.js)
# - tools/testing/* (documentation)
```

### 2. Verify Route Registration
```bash
grep "test-blocks" gateway-server.js
# Should see: app.use('/api/test-blocks', testBlocksRoute);
```

### 3. Test Endpoint
```bash
# Health check
curl "http://localhost:5000/api/test-blocks"
# Should return 400 with "Testing parameters required" message

# Full test
curl "http://localhost:5000/api/test-blocks?lat=32.7767&lng=-96.7970&llmModel=gemini&llmParam=0.0"
```

---

## Future Enhancements

### Planned
- [ ] Batch testing script (test all models with one command)
- [ ] Performance comparison dashboard
- [ ] A/B testing framework
- [ ] Cost tracking per model
- [ ] Hallucination detection scoring

### Proposed
- [ ] Frontend test UI with dropdowns
- [ ] CSV export for analysis
- [ ] Automated benchmark suite
- [ ] Model warmup logic

---

## Support

Questions? Check:
1. Console logs: `/tmp/logs/Eidolon_Main_*.log`
2. Browser console: Network tab for API responses
3. Database: `snapshots`, `rankings`, `ranking_candidates` tables

---

**Last Updated**: October 3, 2025
**Maintained By**: Atlas (Vecto Pilot AI Assistant)
**License**: Internal Use Only
