# COMPLETED WORKSTREAM - News Flow Refactor

**Last Updated:** 2026-01-05
**Status:** ✅ COMPLETE - Dual-model news fetch working

---

## Objective

Refactor news retrieval to use **BOTH**:
1. **Gemini 3 Pro + Google Search tool** - fetches news
2. **GPT-5-search-api + OpenAI web search** - fetches news in parallel
3. **Consolidate results** - merge, dedupe, filter for rideshare driver relevance

## Implementation Summary

### Files Modified

| File | Change |
|------|--------|
| `server/lib/ai/adapters/openai-adapter.js` | Added `callOpenAIWithWebSearch()` function (uses gpt-5-search-api) |
| `server/lib/ai/model-registry.js` | Added `BRIEFING_NEWS_GPT` role + `roleUsesOpenAIWebSearch()` helper |
| `server/lib/ai/adapters/index.js` | Updated dispatch to route GPT web search calls |
| `server/lib/briefing/briefing-service.js` | Rewrote `fetchRideshareNews()` for dual-model parallel fetch |
| `scripts/test-news-fetch.js` | Created test script for direct testing |

### Architecture

```
DUAL-MODEL PARALLEL FETCH:
┌─────────────────────────────────────┐
│     fetchRideshareNews(snapshot)    │
└─────────────────┬───────────────────┘
                  │
    ┌─────────────┴─────────────┐
    ▼                           ▼
┌───────────────────┐   ┌───────────────────┐
│ BRIEFING_NEWS     │   │ BRIEFING_NEWS_GPT │
│ Gemini 3 Pro      │   │ gpt-5-search-api  │
│ + Google Search   │   │ + OpenAI WebSearch│
│ (~40s)            │   │ (~10s)            │
└─────────┬─────────┘   └─────────┬─────────┘
          │                       │
          └───────────┬───────────┘
                      ▼
          ┌───────────────────────┐
          │ consolidateNewsItems()│
          │ - Dedupe by title     │
          │ - Filter stale (>48h) │
          │ - Sort by impact      │
          └───────────────────────┘
```

### Test Results (2026-01-05)

```
📰 NEWS FETCH RESULT
════════════════════════════════════════════════════════════
Provider(s): gemini+gpt
Items: 8
Raw count (before dedup): 12
Duration: 44.01s

Results included:
- MAJOR TRAFFIC ALERT: I-30 Westbound Closed (high impact, traffic)
- MAJOR TRAFFIC ALERT: DNT Southbound Blocked (high impact, traffic)
- High Demand Alert: SEEK Conference Ending (high impact, event)
- DART Convention Center Station Closed (traffic)
- ... and more driver-relevant news
```

### Key Technical Decisions

1. **gpt-5-search-api vs gpt-5.2**: OpenAI's web search requires the dedicated `gpt-5-search-api` model, not regular `gpt-5.2`. The search model does NOT support `reasoning_effort` parameter.

2. **Parallel fetch**: Both models are called via `Promise.allSettled()` so one failure doesn't block the other.

3. **Stale filtering**: Items older than 48 hours are filtered unless still relevant to ongoing situations.

4. **Market resolution**: Looks up user's `{Market}` from `us_market_cities` table to expand search scope beyond just the city.

### Enhanced Prompt Coverage

1. **AIRPORT NEWS** - Delays, TSA changes, pickup rules
2. **MAJOR HEADLINES** - Events creating ride demand
3. **TRAFFIC & ROAD** - Closures, construction
4. **UBER/LYFT UPDATES** - Platform policy changes
5. **GIG ECONOMY** - Regulations, lawsuits
6. **WEATHER IMPACTS** - Severe weather, surge opportunities
7. **GAS & COSTS** - Fuel prices, EV charging

---

## How to Test

```bash
# Direct test (no server needed):
node scripts/test-news-fetch.js "Dallas" "TX"

# Or via API (requires server):
npm run dev
curl "http://localhost:5000/api/briefing?snapshotId=YOUR_SNAPSHOT_ID" | jq '.news'
```

---

**Workstream completed: 2026-01-05**
