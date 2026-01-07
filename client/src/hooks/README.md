> **Last Verified:** 2026-01-07

# Hooks (`client/src/hooks/`)

## Purpose

Custom React hooks for data fetching and UI state.

## Files

| File | Purpose |
|------|---------|
| `useBarsQuery.ts` | Fetches bar/venue data for the Bar Tab |
| `useBriefingQueries.ts` | Fetches weather, traffic, news, events |
| `useEnrichmentProgress.ts` | Tracks briefing enrichment progress |
| `useMarketIntelligence.ts` | Market intel data (demand patterns, zone analysis) |
| `useMemory.ts` | Cross-session memory management |
| `useMobile.tsx` | Mobile device detection |
| `usePlatformData.ts` | Rideshare platform data (Uber/Lyft coverage) |
| `useStrategyPolling.ts` | Strategy data fetching with SSE and caching |
| `useStrategy.ts` | Strategy hook for strategy state management |
| `useStrategyLoadingMessages.ts` | Rotating loading messages during strategy generation |
| `useVenueLoadingMessages.ts` | Rotating loading messages during venue enrichment |
| `useTTS.ts` | Text-to-speech with OpenAI |
| `useToast.ts` | Toast notifications (shadcn/ui toast integration) |

## Active Hooks

### useBriefingQueries
```typescript
const { weatherData, trafficData, newsData, eventsData, isLoading } = useBriefingQueries({ snapshotId });
```
Fetches all briefing data from `/api/briefing/*` endpoints.

**Ownership Error Handling (2026-01-06):**
- If a 404 ownership error occurs (snapshot belongs to different user), enters 60-second cooling off
- During cooling off, all queries are disabled to prevent infinite refresh loops
- Listens for `vecto-snapshot-saved` events to exit cooling off early when new snapshot arrives
- This prevents blank briefing data for 60 seconds after session changes

### useEnrichmentProgress
```typescript
const { progress, strategyProgress, phase, pipelinePhase, timeRemainingText, timeRemainingMs } = useEnrichmentProgress({
  coords,
  strategyData,
  lastSnapshotId,
  hasBlocks
});
```
Tracks strategy and briefing generation progress with:
- **Dynamic progress calculation** based on actual phase timing (not hardcoded percentages)
- **Time remaining estimates** (e.g., "~30 seconds")
- **Real-time updates** every 500ms using backend `timing` metadata

The hook uses expected phase durations from the backend to calculate progress:
- `starting`: 500ms
- `resolving`: 1500ms
- `analyzing`: 12000ms (briefing)
- `immediate`: 8000ms (GPT-5.2 strategy)
- `venues`: 3000ms
- `enriching`: 15000ms (Google APIs)

### useStrategyPolling
```typescript
const { strategyData, persistentStrategy, immediateStrategy } = useStrategyPolling({ snapshotId });
```
Fetches strategy data with SSE subscriptions and localStorage persistence.

**Manual Refresh Support (2026-01-07):**
- Listens for `vecto-strategy-cleared` event (dispatched by location-context on refresh button click)
- Clears React state AND resets react-query cache
- This ensures strategy regenerates when user manually refreshes location

### useTTS
```typescript
const { isSpeaking, speak, stop } = useTTS();
await speak("Text to read aloud");
```
Text-to-speech using OpenAI TTS API.

### useToast
```typescript
const { toast } = useToast();
toast({ title: "Success", description: "..." });
```
Shows toast notifications.

### useMobile
```typescript
const isMobile = useMobile();
```
Detects mobile viewport.

### useStrategyLoadingMessages
```typescript
// New API with time remaining support
const { icon, text, title, step, badge, timeRemaining } = useStrategyLoadingMessages({
  pipelinePhase,
  timeRemainingText  // Optional: from useEnrichmentProgress
});

// Legacy API still supported
const { icon, text, step, badge } = useStrategyLoadingMessages(pipelinePhase);
```
Returns rotating loading messages during strategy generation with:
- **Phase-specific messages** (e.g., "Checking real-time traffic conditions...")
- **Step indicators** (e.g., "Step 3/7: Research")
- **Time remaining** when provided by useEnrichmentProgress

### useVenueLoadingMessages
```typescript
const { message } = useVenueLoadingMessages({ isLoading: true });
```
Returns rotating loading messages during venue enrichment (e.g., "Finding optimal venues...").

### useMemory
```typescript
const { memories, storeMemory, retrieveMemory, searchMemories } = useMemory();
```
Manages cross-session persistent memory via the Eidolon memory system.

### usePlatformData
```typescript
const { markets, stats, searchCities, isLoading } = usePlatformData();
```
Fetches rideshare platform coverage data (Uber/Lyft markets, cities).

### useBarsQuery
```typescript
const { bars, isLoading, error } = useBarsQuery({ snapshotId, enabled });
```
Fetches premium bar/venue data for the Bar Tab sidebar.

### useMarketIntelligence
```typescript
const {
  city,
  state,
  marketSlug,
  isLocationResolved,
  archetype,           // 'sprawl' | 'dense' | 'party'
  archetypeInfo,       // Market archetype details
  intelligence,        // Full intelligence response
  isLoading,
  error,
  // Market structure
  marketAnchor,        // Resolved market name (e.g., "Dallas")
  regionType,          // 'Core' | 'Satellite' | 'Rural'
  marketStats,         // { total_cities, core_count, satellite_count }
  marketCities,        // Array of cities in the market
  // Intelligence by type
  zones,               // Zone intelligence items
  strategies,          // Strategy items
  regulatory,          // Regulatory items
  safety,              // Safety items
  timing,              // Timing items
  airport,             // Airport items
  // Zone subtypes
  honeyHoles,          // High-demand areas
  dangerZones,         // Safety risk areas
  deadZones,           // Low-demand areas
  // Raw response
  forLocationData,     // Full /api/intelligence/for-location response
} = useMarketIntelligence();
```

**2026-01-05 Update:** Now uses `/api/intelligence/for-location` endpoint which:
- Maps **723 cities** to their markets via `us_market_cities` table
- Properly resolves suburbs (Frisco, TX → Dallas market)
- Returns market info + intelligence in a single API call

Fetches market intelligence data including:
- **Zone analysis**: Honey holes, danger zones, dead zones, safe corridors
- **Strategy items**: Time-based strategies, positioning advice
- **Regulatory context**: Prop 22, TLC rules, local regulations
- **Safety information**: High-risk areas, warnings
- **Market structure**: Core cities, satellite cities, region types

## Connections

- **Used by:** `../pages/co-pilot/*`, components
- **Fetches from:** `/api/*` endpoints (briefing, strategy, tts, platform)
