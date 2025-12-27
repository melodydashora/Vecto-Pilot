# Strategy Feature (`client/src/features/strategy/`)

## Purpose

Strategy display and generation UI components.

## Status

Components are currently staged in `../../components/strategy/_future/`:
- `StrategyCoach.tsx` - Strategy coach UI
- `ConsolidatedStrategyComp.tsx` - Strategy display

## Hooks Used

- `useStrategyPolling` - Fetches strategy with SSE and caching
- `useEnrichmentProgress` - Tracks generation progress
- `useTTS` - Text-to-speech for strategy

## To Activate

1. Move components from `_future/` to this folder
2. Update imports in `../../pages/co-pilot.tsx`
3. Update this README

## Data Flow

```
1. Location change triggers snapshot save
2. POST /api/blocks-fast starts waterfall
3. useStrategyPolling polls for strategy
4. SSE events notify when ready
5. Strategy displayed in UI
```

## Types

```typescript
interface StrategyData {
  status: 'pending' | 'ok' | 'complete' | 'failed';
  strategy: {
    consolidated: string;      // 8-12hr overview
    strategy_for_now: string;  // 1hr tactical
    holiday?: string;
  };
  timeElapsedMs: number;
}
```

## Connections

- **Fetches:** `/api/blocks/strategy/:snapshotId`
- **SSE:** `/api/events` (strategy_ready)
- **Uses:** `../../hooks/useStrategyPolling.ts`
