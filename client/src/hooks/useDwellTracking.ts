// client/src/hooks/useDwellTracking.ts
// Track how long users view each block for ML training data

import { useState, useEffect } from 'react';
import type { SmartBlock } from '@/types/co-pilot';
import { logAction, getBlockId } from '@/utils/co-pilot-helpers';

interface UseDwellTrackingOptions {
  blocks: SmartBlock[];
  rankingId: string | undefined;
}

export function useDwellTracking({ blocks, rankingId }: UseDwellTrackingOptions) {
  const [dwellTimers, setDwellTimers] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    if (!blocks.length) return;

    const observers = new Map<number, IntersectionObserver>();

    blocks.forEach((block, index) => {
      const blockElement = document.querySelector(`[data-block-index="${index}"]`);
      if (!blockElement) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              // Block entered viewport - start timer
              const startTime = Date.now();
              setDwellTimers(prev => new Map(prev).set(index, startTime));
            } else {
              // Block left viewport - log dwell time
              const startTime = dwellTimers.get(index);
              if (startTime) {
                const dwellMs = Date.now() - startTime;
                if (dwellMs > 500) {
                  const blockId = getBlockId(block);
                  logAction(rankingId, 'block_dwell', blockId, dwellMs, index + 1);
                  console.log(`[dwell] Logged: ${block.name} (${dwellMs}ms)`);
                }
                setDwellTimers(prev => {
                  const next = new Map(prev);
                  next.delete(index);
                  return next;
                });
              }
            }
          });
        },
        { threshold: 0.5 }
      );

      observer.observe(blockElement);
      observers.set(index, observer);
    });

    return () => {
      observers.forEach(observer => observer.disconnect());
    };
  }, [blocks, rankingId]);

  return { dwellTimers };
}
