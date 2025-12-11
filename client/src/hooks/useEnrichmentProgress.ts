// client/src/hooks/useEnrichmentProgress.ts
// Progress tracking for strategy/blocks generation pipeline
// Uses real backend pipeline phases instead of time estimates

import { useState, useEffect, useMemo } from 'react';
import type { EnrichmentPhase, CoordData, StrategyData, PipelinePhase } from '@/types/co-pilot';

interface UseEnrichmentProgressOptions {
  coords: CoordData | null | undefined;
  strategyData: StrategyData | null | undefined;
  lastSnapshotId: string | null;
  hasBlocks: boolean;
}

interface EnrichmentProgressState {
  progress: number;           // Bottom bar progress (0-100 full process)
  strategyProgress: number;   // Strategy card progress (0-100, done at consolidator)
  phase: EnrichmentPhase;
  pipelinePhase: PipelinePhase;
  startTime: number | null;
}

// Map backend pipeline phase to progress percentage for BOTTOM progress bar
// Full process from strategy to venues loaded
const PHASE_PROGRESS: Record<PipelinePhase, number> = {
  starting: 5,
  resolving: 15,
  analyzing: 30,
  consolidator: 50,
  venues: 70,
  enriching: 85,
  complete: 100
};

// Map backend phase to frontend phase category
// 'strategy' = strategy card visible, 'blocks' = venues loading, 'idle' = done
const PHASE_TO_FRONTEND: Record<PipelinePhase, EnrichmentPhase> = {
  starting: 'strategy',
  resolving: 'strategy',
  analyzing: 'strategy',
  consolidator: 'strategy',
  venues: 'blocks',
  enriching: 'blocks',
  complete: 'idle'
};

// Strategy card progress (only first 4 phases, tops out at 100% when consolidator done)
const STRATEGY_CARD_PROGRESS: Record<PipelinePhase, number> = {
  starting: 5,
  resolving: 25,
  analyzing: 50,
  consolidator: 100,
  venues: 100,
  enriching: 100,
  complete: 100
};

export function useEnrichmentProgress({
  coords,
  strategyData,
  lastSnapshotId,
  hasBlocks
}: UseEnrichmentProgressOptions): EnrichmentProgressState {
  const [startTime, setStartTime] = useState<number | null>(null);
  const [animatedProgress, setAnimatedProgress] = useState(0);
  const [animatedStrategyProgress, setAnimatedStrategyProgress] = useState(0);

  // Get backend phase directly from API response
  const backendPhase = strategyData?.phase as PipelinePhase || 'starting';
  const snapshotMatches = strategyData?._snapshotId === lastSnapshotId;

  // Target progress for bottom bar (full process)
  const targetProgress = useMemo(() => {
    if (hasBlocks) return 100;
    if (!coords) return 0;
    if (!snapshotMatches) return 5;
    return PHASE_PROGRESS[backendPhase] || 5;
  }, [hasBlocks, coords, snapshotMatches, backendPhase]);

  // Target progress for strategy card (only first 4 phases)
  const targetStrategyProgress = useMemo(() => {
    if (!coords) return 0;
    if (!snapshotMatches) return 5;
    return STRATEGY_CARD_PROGRESS[backendPhase] || 5;
  }, [coords, snapshotMatches, backendPhase]);

  // Determine frontend phase category
  const phase = useMemo((): EnrichmentPhase => {
    if (hasBlocks) return 'idle';
    if (!coords) return 'idle';
    return PHASE_TO_FRONTEND[backendPhase] || 'strategy';
  }, [hasBlocks, coords, backendPhase]);

  // Start timer when coords arrive
  useEffect(() => {
    if (coords && !startTime) {
      console.log('[enrichment] Started - coords received');
      setStartTime(Date.now());
    }
  }, [coords, startTime]);

  // Animate bottom bar progress smoothly toward target
  useEffect(() => {
    if (animatedProgress >= targetProgress) return;

    const interval = setInterval(() => {
      setAnimatedProgress(prev => {
        const diff = targetProgress - prev;
        const step = Math.max(1, diff * 0.15);
        return Math.min(targetProgress, prev + step);
      });
    }, 100);

    return () => clearInterval(interval);
  }, [targetProgress, animatedProgress]);

  // Animate strategy card progress smoothly toward target
  useEffect(() => {
    if (animatedStrategyProgress >= targetStrategyProgress) return;

    const interval = setInterval(() => {
      setAnimatedStrategyProgress(prev => {
        const diff = targetStrategyProgress - prev;
        const step = Math.max(1, diff * 0.15);
        return Math.min(targetStrategyProgress, prev + step);
      });
    }, 100);

    return () => clearInterval(interval);
  }, [targetStrategyProgress, animatedStrategyProgress]);

  // Reset when snapshot changes
  useEffect(() => {
    if (!snapshotMatches && coords) {
      setAnimatedProgress(5);
      setAnimatedStrategyProgress(5);
      setStartTime(Date.now());
    }
  }, [snapshotMatches, coords]);

  // Log phase changes for debugging
  useEffect(() => {
    if (coords) {
      console.log(`[enrichment] Phase: ${backendPhase} | Bottom: ${Math.round(animatedProgress)}% | Strategy: ${Math.round(animatedStrategyProgress)}%`);
    }
  }, [backendPhase, animatedProgress, animatedStrategyProgress, coords]);

  return {
    progress: Math.round(animatedProgress),
    strategyProgress: Math.round(animatedStrategyProgress),
    phase,
    pipelinePhase: backendPhase,
    startTime
  };
}
