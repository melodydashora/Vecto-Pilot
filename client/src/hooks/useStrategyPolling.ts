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

  // 2026-01-06: REMOVED mount-clearing per P3-A audit fix
  // Previous behavior cleared strategy on every mount, causing regeneration when:
  // - User switches apps (Uber/Lyft) and returns
  // - OS kills tab and user reopens
  // - Any component remount
  //
  // Strategy should ONLY be cleared on:
  // - Manual refresh (vecto-strategy-cleared event from location-context)
  // - Snapshot ID change (handled in next useEffect)
  // - Explicit logout (handled in auth-context.tsx)
  //
  // On mount, try to restore from localStorage if snapshot matches
  useEffect(() => {
    const storedStrategy = localStorage.getItem('vecto_persistent_strategy');
    const storedSnapshotId = localStorage.getItem('vecto_strategy_snapshot_id');

    // Only restore if we have stored data AND snapshot matches current
    if (storedStrategy && storedSnapshotId && storedSnapshotId === snapshotId) {
      console.log('[strategy-polling] Restoring strategy from localStorage for snapshot:', snapshotId?.slice(0, 8));
      setPersistentStrategy(storedStrategy);
      setStrategySnapshotId(storedSnapshotId);
    } else if (storedStrategy && storedSnapshotId && storedSnapshotId !== snapshotId) {
      // Stored strategy is for different snapshot - will be cleared by snapshot change effect
      console.log('[strategy-polling] Stored strategy is for different snapshot, will clear');
    }
  }, [snapshotId]);

  // 2026-01-07: Listen for manual refresh event to clear strategy state
  // Location context dispatches 'vecto-strategy-cleared' when user clicks refresh button
  // This resets React state (localStorage is already cleared by location context)
  useEffect(() => {
    const handleStrategyClear = () => {
      console.log('[strategy-polling] Manual refresh detected - clearing strategy state');
      setPersistentStrategy(null);
      setImmediateStrategy(null);
      setStrategySnapshotId(null);
      queryClient.resetQueries({ queryKey: ['/api/blocks/strategy'] });
    };

    window.addEventListener('vecto-strategy-cleared', handleStrategyClear);
    return () => window.removeEventListener('vecto-strategy-cleared', handleStrategyClear);
  }, [queryClient]);

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
      console.log(`[strategy-polling] Status: ${data.status}, Phase: ${data.phase || 'n/a'}, Time: ${data.timeElapsedMs}ms`);
      return { ...data, _snapshotId: snapshotId } as StrategyData;
    },
    enabled: !!snapshotId && snapshotId !== 'live-snapshot',
    // Dynamic polling based on status:
    // - undefined/pending/pending_blocks: Poll every 2s to track phase changes
    // - ok/error: Stop polling (done)
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Poll until we reach 'ok' or 'error' status
      if (!status || status === 'pending' || status === 'pending_blocks' || status === 'missing') {
        return 2000; // Fast polling during generation to show phase updates
      }
      return false; // Stop polling when done
    },
    // Don't consider data stale during generation - always use fresh data
    staleTime: 0,
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
