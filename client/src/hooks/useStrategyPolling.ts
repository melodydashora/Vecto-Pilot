// client/src/hooks/useStrategyPolling.ts
// ============================================================================
// DEPRECATED - 2026-01-15
// GUTTED - 2026-01-15 (Audit fix: removed duplicate SSE subscription)
// ============================================================================
// This hook is NOT USED. Strategy polling is handled by co-pilot-context.tsx.
//
// WHY GUTTED (not just deprecated):
// - Had SSE subscription using invalidateQueries (causes UI flash)
// - CoPilotContext also subscribes to SSE with refetchQueries (correct)
// - Running both = duplicate SSE subscriptions + cache invalidation churn
// - Keeping active code risks accidental future imports causing bugs
//
// DO NOT USE THIS HOOK. Use the CoPilotContext instead:
//   const { strategyData, isStrategyFetching, persistentStrategy } = useCoPilot();
//
// This file will be deleted in a future cleanup.
// ============================================================================

import type { StrategyData } from '@/types/co-pilot';

interface UseStrategyPollingOptions {
  snapshotId: string | null;
}

interface UseStrategyPollingReturn {
  strategyData: StrategyData | null;
  isStrategyFetching: boolean;
  persistentStrategy: string | null;
  immediateStrategy: string | null;
  strategySnapshotId: string | null;
  clearStrategy: () => void;
}

/**
 * @deprecated Use useCoPilot() from co-pilot-context.tsx instead
 * @throws Error if called - this hook should not be used
 */
export function useStrategyPolling(_options: UseStrategyPollingOptions): UseStrategyPollingReturn {
  // 2026-01-15: Throw immediately to catch any accidental imports
  throw new Error(
    '[useStrategyPolling] DEPRECATED: This hook has been removed. ' +
    'Use useCoPilot() from @/contexts/co-pilot-context instead. ' +
    'Example: const { strategyData, isStrategyFetching, persistentStrategy } = useCoPilot();'
  );
}
