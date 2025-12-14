# Hooks (`client/src/hooks/`)

## Purpose

Custom React hooks for data fetching and UI state.

## Files

| File | Purpose |
|------|---------|
| `useBriefingQueries.ts` | Fetches weather, traffic, news, events |
| `useEnrichmentProgress.ts` | Tracks briefing enrichment progress |
| `useStrategyPolling.ts` | Strategy data fetching with SSE and caching |
| `useStrategy.ts` | Strategy hook for strategy state management |
| `useStrategyLoadingMessages.ts` | Rotating loading messages during strategy generation |
| `useVenueLoadingMessages.ts` | Rotating loading messages during venue enrichment |
| `useTTS.ts` | Text-to-speech with OpenAI |
| `use-toast.ts` | Toast notifications |
| `use-mobile.tsx` | Mobile device detection |

## Active Hooks

### useBriefingQueries
```typescript
const { weatherData, trafficData, newsData, eventsData, isLoading } = useBriefingQueries({ snapshotId });
```
Fetches all briefing data from `/api/briefing/*` endpoints.

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

### useTTS
```typescript
const { isSpeaking, speak, stop } = useTTS();
await speak("Text to read aloud");
```
Text-to-speech using OpenAI TTS API.

### use-toast
```typescript
const { toast } = useToast();
toast({ title: "Success", description: "..." });
```
Shows toast notifications.

### use-mobile
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

## Connections

- **Used by:** `../pages/co-pilot.tsx`, components
- **Fetches from:** `/api/*` endpoints (briefing, strategy, tts)
