// client/src/hooks/useEnrichmentProgress.ts
// Progress tracking for strategy/blocks generation pipeline

import { useState, useEffect } from 'react';
import type { EnrichmentPhase, CoordData, StrategyData } from '@/types/co-pilot';

interface UseEnrichmentProgressOptions {
  coords: CoordData | null | undefined;
  strategyData: StrategyData | null | undefined;
  lastSnapshotId: string | null;
  hasBlocks: boolean;
}

interface EnrichmentProgressState {
  progress: number;
  phase: EnrichmentPhase;
  startTime: number | null;
}

export function useEnrichmentProgress({
  coords,
  strategyData,
  lastSnapshotId,
  hasBlocks
}: UseEnrichmentProgressOptions): EnrichmentProgressState {
  const [startTime, setStartTime] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<EnrichmentPhase>('idle');

  // Start enrichment timer when coords arrive
  useEffect(() => {
    if (coords && phase === 'idle') {
      console.log('[enrichment] Started - coords received');
      setStartTime(Date.now());
      setProgress(5);
      setPhase('strategy');
    }
  }, [coords, phase]);

  // Update phase when strategy becomes ready
  useEffect(() => {
    const strategyReady = strategyData?.status === 'ok' ||
                          strategyData?.status === 'complete' ||
                          strategyData?.status === 'pending_blocks';
    const snapshotMatches = strategyData?._snapshotId === lastSnapshotId;

    if (strategyReady && snapshotMatches && phase === 'strategy') {
      console.log('[enrichment] Strategy ready - moving to blocks phase');
      setPhase('blocks');
      setProgress(30);
    }
  }, [strategyData, lastSnapshotId, phase]);

  // Stop enrichment when blocks are loaded
  useEffect(() => {
    if (hasBlocks) {
      setPhase('idle');
      setProgress(100);
    }
  }, [hasBlocks]);

  // Update progress bar every 500ms for smooth animation
  useEffect(() => {
    if (!startTime || phase === 'idle') return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;

      if (phase === 'strategy') {
        // Phase 1: Strategy generation (0-30% over ~15 seconds)
        const strategyExpected = 15000;
        const strategyProgress = Math.min(30, (elapsed / strategyExpected) * 30);
        setProgress(strategyProgress);
      } else if (phase === 'blocks') {
        // Phase 2: Blocks generation (30-100% over ~75 seconds)
        const blocksExpected = 75000;
        const blocksMax = 120000;
        const strategyTime = 15000;
        const blocksElapsed = Math.max(0, elapsed - strategyTime);

        let newProgress;
        if (blocksElapsed < blocksExpected) {
          newProgress = 30 + (blocksElapsed / blocksExpected) * 65;
        } else if (blocksElapsed < blocksMax) {
          const remainingTime = blocksElapsed - blocksExpected;
          const remainingProgress = (remainingTime / (blocksMax - blocksExpected)) * 5;
          newProgress = 95 + remainingProgress;
        } else {
          newProgress = 100;
        }

        setProgress(Math.min(100, newProgress));
      }
    }, 500);

    return () => clearInterval(interval);
  }, [startTime, phase]);

  return { progress, phase, startTime };
}
