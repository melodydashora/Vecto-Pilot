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
const { progress, phase } = useEnrichmentProgress({ coords, strategyData, snapshotId, hasBlocks });
```
Tracks strategy and briefing generation progress with phase detection.

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

## Connections

- **Used by:** `../pages/co-pilot.tsx`, components
- **Fetches from:** `/api/*` endpoints (briefing, strategy, tts)
