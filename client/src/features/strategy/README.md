> **Last Verified:** 2026-01-15

# Strategy Feature (`client/src/features/strategy/`)

## Purpose

Strategy display and generation UI components.

## Status

Components are currently staged in `../../components/strategy/_future/`:
- `StrategyCoach.tsx` - Strategy coach UI
- `ConsolidatedStrategyComp.tsx` - Strategy display

## Hooks Used

- `useCoPilot` - Strategy state (replaces deprecated useStrategyPolling)
- `useEnrichmentProgress` - Tracks generation progress
- `useTTS` - Text-to-speech for strategy

> **Note:** `useStrategyPolling` is deprecated as of 2026-01-15. Use `useCoPilot()` instead.

## To Activate

1. Move components from `_future/` to this folder
2. Update imports in `../../pages/co-pilot.tsx`
3. Update this README

## Data Flow

```
1. Location change triggers snapshot save (vecto-snapshot-saved event)
2. CoPilotContext receives event, triggers POST /api/blocks-fast (deduped)
3. CoPilotContext polls for strategy via useQuery (3s interval until ready)
4. SSE events (strategy_ready, blocks_ready) trigger refetchQueries
5. Strategy displayed in UI via useCoPilot()
```

## Types

```typescript
interface StrategyData {
  status: 'pending' | 'ok' | 'pending_blocks' | 'error';
  strategy: {
    consolidated: string;      // 8-12hr overview
    strategyForNow: string;    // 1hr tactical (camelCase, 2026-01-14 fix)
    holiday?: string;
  };
  phase?: string;              // Current pipeline phase
  timeElapsedMs: number;
}
```

## Connections

- **Fetches:** `/api/blocks/strategy/:snapshotId`
- **SSE:** `/api/events` (strategy_ready, blocks_ready, phase_change)
- **Uses:** `../../contexts/co-pilot-context.tsx` (strategy polling + SSE subscriptions)
- **Deprecated:** `../../hooks/useStrategyPolling.ts` (do not use)
