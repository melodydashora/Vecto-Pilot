// client/src/hooks/useStrategyPolling.ts
// Strategy polling hook - fetches and caches strategy data

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getAuthHeader, subscribeStrategyReady } from '@/utils/co-pilot-helpers';
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
 * Hook for polling strategy data from the backend
 * Handles SSE subscriptions and localStorage persistence
 */
export function useStrategyPolling({ snapshotId }: UseStrategyPollingOptions): UseStrategyPollingReturn {
  const queryClient = useQueryClient();

  // Strategy persistence state
  const [persistentStrategy, setPersistentStrategy] = useState<string | null>(null);
  const [immediateStrategy, setImmediateStrategy] = useState<string | null>(null);
  const [strategySnapshotId, setStrategySnapshotId] = useState<string | null>(null);

  // Clear persistent strategy on mount for fresh generation
  useEffect(() => {
    console.log('[strategy-polling] Clearing persistent strategy on mount');
    localStorage.removeItem('vecto_persistent_strategy');
    localStorage.removeItem('vecto_strategy_snapshot_id');
    setPersistentStrategy(null);
    setImmediateStrategy(null);
    setStrategySnapshotId(null);
  }, []);

  // Clear strategy if snapshot ID changes
  useEffect(() => {
    if (snapshotId && snapshotId !== 'live-snapshot' && strategySnapshotId && snapshotId !== strategySnapshotId) {
      console.log(`[strategy-polling] New snapshot (${snapshotId}), clearing old strategy from ${strategySnapshotId}`);
      localStorage.removeItem('vecto_persistent_strategy');
      localStorage.removeItem('vecto_strategy_snapshot_id');
      setPersistentStrategy(null);
      setImmediateStrategy(null);
      setStrategySnapshotId(null);
      queryClient.resetQueries({ queryKey: ['/api/blocks/strategy'] });
    }
  }, [snapshotId, strategySnapshotId, queryClient]);

  // Subscribe to SSE strategy_ready events
  useEffect(() => {
    if (!snapshotId || snapshotId === 'live-snapshot') return;

    console.log('[strategy-polling] Subscribing to SSE events for:', snapshotId);
    const unsubscribe = subscribeStrategyReady((readySnapshotId) => {
      if (readySnapshotId === snapshotId) {
        console.log('[strategy-polling] Strategy ready, refetching');
        queryClient.invalidateQueries({ queryKey: ['/api/blocks/strategy', snapshotId] });
      }
    });

    return unsubscribe;
  }, [snapshotId, queryClient]);

  // Fetch strategy from database
  const { data: strategyData, isFetching: isStrategyFetching } = useQuery({
    queryKey: ['/api/blocks/strategy', snapshotId],
    queryFn: async () => {
      if (!snapshotId || snapshotId === 'live-snapshot') return null;

      const response = await fetch(`/api/blocks/strategy/${snapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) return null;

      const data = await response.json();
      console.log(`[strategy-polling] Status: ${data.status}, Time: ${data.timeElapsedMs}ms`);
      return { ...data, _snapshotId: snapshotId } as StrategyData;
    },
    enabled: !!snapshotId && snapshotId !== 'live-snapshot',
    // Reduced polling - SSE is primary mechanism, this is just a safety fallback
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'pending' ? 15000 : false;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Update persistent strategy when new data arrives
  useEffect(() => {
    const consolidatedStrategy = strategyData?.strategy?.consolidated;
    const strategyForNow = strategyData?.strategy?.strategy_for_now;

    if (consolidatedStrategy && consolidatedStrategy !== persistentStrategy) {
      console.log('[strategy-polling] New consolidated strategy received');
      localStorage.setItem('vecto_persistent_strategy', consolidatedStrategy);
      localStorage.setItem('vecto_strategy_snapshot_id', snapshotId || '');
      setPersistentStrategy(consolidatedStrategy);
      setStrategySnapshotId(snapshotId);
    }

    if (strategyForNow && strategyForNow !== immediateStrategy) {
      console.log('[strategy-polling] New immediate strategy received');
      setImmediateStrategy(strategyForNow);
    }
  }, [strategyData, snapshotId, persistentStrategy, immediateStrategy]);

  const clearStrategy = () => {
    localStorage.removeItem('vecto_persistent_strategy');
    localStorage.removeItem('vecto_strategy_snapshot_id');
    setPersistentStrategy(null);
    setImmediateStrategy(null);
    setStrategySnapshotId(null);
  };

  return {
    strategyData: strategyData || null,
    isStrategyFetching,
    persistentStrategy,
    immediateStrategy,
    strategySnapshotId,
    clearStrategy,
  };
}
