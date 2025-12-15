// client/src/hooks/useEnrichmentProgress.ts
// Progress tracking for strategy/blocks generation pipeline
// Uses real backend pipeline phases with dynamic time-based calculation

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  timeRemainingMs: number | null;  // Estimated time remaining in milliseconds
  timeRemainingText: string | null; // Human-readable time remaining
}

// Default expected durations (fallback if not provided by backend)
// SmartBlocks phases: venues → routing → places → verifying → complete
const DEFAULT_EXPECTED_DURATIONS: Record<string, number> = {
  starting: 500,
  resolving: 1500,
  analyzing: 12000,
  immediate: 8000,
  venues: 4000,       // GPT-5.2 venue planner
  routing: 5000,      // Google Routes API
  places: 6000,       // Google Places API
  verifying: 4000,    // Gemini event verification
  enriching: 15000,   // Legacy fallback
  complete: 0
};

// Phase order for progress calculation
const PHASE_ORDER: PipelinePhase[] = ['starting', 'resolving', 'analyzing', 'immediate', 'venues', 'routing', 'places', 'verifying', 'complete'];

// Map backend phase to frontend phase category
const PHASE_TO_FRONTEND: Record<PipelinePhase, EnrichmentPhase> = {
  starting: 'strategy',
  resolving: 'strategy',
  analyzing: 'strategy',
  immediate: 'strategy',
  venues: 'blocks',
  routing: 'blocks',
  places: 'blocks',
  verifying: 'blocks',
  enriching: 'blocks',  // Legacy fallback
  complete: 'idle'
};

// Strategy card progress caps (strategy is "done" once immediate phase completes)
const STRATEGY_CARD_CAPS: Record<PipelinePhase, number> = {
  starting: 100,      // Can go up to 100% during this phase
  resolving: 100,
  analyzing: 100,
  immediate: 100,
  venues: 100,        // Strategy complete, cap at 100
  routing: 100,
  places: 100,
  verifying: 100,
  enriching: 100,
  complete: 100
};

/**
 * Calculate dynamic progress based on:
 * 1. Which phases are complete (sum their durations)
 * 2. Progress within current phase (elapsed / expected)
 */
function calculateDynamicProgress(
  currentPhase: PipelinePhase,
  phaseElapsedMs: number,
  expectedDurations: Record<string, number>
): { progress: number; strategyProgress: number; timeRemainingMs: number } {
  const durations = { ...DEFAULT_EXPECTED_DURATIONS, ...expectedDurations };
  const totalDuration = PHASE_ORDER.reduce((sum, p) => sum + (durations[p] || 0), 0);

  if (totalDuration === 0) {
    return { progress: 0, strategyProgress: 0, timeRemainingMs: 0 };
  }

  // Find index of current phase
  const currentIndex = PHASE_ORDER.indexOf(currentPhase);
  if (currentIndex === -1) {
    return { progress: 0, strategyProgress: 0, timeRemainingMs: totalDuration };
  }

  // Sum duration of completed phases
  let completedDuration = 0;
  for (let i = 0; i < currentIndex; i++) {
    completedDuration += durations[PHASE_ORDER[i]] || 0;
  }

  // Calculate progress within current phase (capped at 95% to show we're still working)
  const currentPhaseDuration = durations[currentPhase] || 5000;
  const phaseProgress = Math.min(0.95, phaseElapsedMs / currentPhaseDuration);
  const currentPhaseContribution = currentPhaseDuration * phaseProgress;

  // Total progress as percentage
  const totalCompleted = completedDuration + currentPhaseContribution;
  const progress = Math.min(99, Math.round((totalCompleted / totalDuration) * 100));

  // Strategy progress (only counts phases up to 'immediate')
  const strategyPhases: PipelinePhase[] = ['starting', 'resolving', 'analyzing', 'immediate'];
  const strategyTotalDuration = strategyPhases.reduce((sum, p) => sum + (durations[p] || 0), 0);

  let strategyCompleted = 0;
  for (const phase of strategyPhases) {
    const phaseIdx = PHASE_ORDER.indexOf(phase);
    if (phaseIdx < currentIndex) {
      strategyCompleted += durations[phase] || 0;
    } else if (phaseIdx === currentIndex) {
      strategyCompleted += (durations[phase] || 0) * phaseProgress;
      break;
    }
  }

  const strategyProgress = strategyTotalDuration > 0
    ? Math.min(100, Math.round((strategyCompleted / strategyTotalDuration) * 100))
    : 0;

  // Time remaining calculation
  const remainingInCurrentPhase = Math.max(0, currentPhaseDuration - phaseElapsedMs);
  let remainingInFuturePhases = 0;
  for (let i = currentIndex + 1; i < PHASE_ORDER.length; i++) {
    remainingInFuturePhases += durations[PHASE_ORDER[i]] || 0;
  }
  const timeRemainingMs = remainingInCurrentPhase + remainingInFuturePhases;

  return { progress, strategyProgress, timeRemainingMs };
}

/**
 * Format milliseconds to human-readable text
 */
function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return 'Almost done';
  if (ms < 1000) return 'Less than a second';

  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) {
    return `~${seconds} second${seconds !== 1 ? 's' : ''}`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `~${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
  return `~${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function useEnrichmentProgress({
  coords,
  strategyData,
  lastSnapshotId,
  hasBlocks
}: UseEnrichmentProgressOptions): EnrichmentProgressState {
  const [startTime, setStartTime] = useState<number | null>(null);
  const [animatedProgress, setAnimatedProgress] = useState(0);
  const [animatedStrategyProgress, setAnimatedStrategyProgress] = useState(0);
  const [localPhaseElapsed, setLocalPhaseElapsed] = useState(0);
  const prevPhaseRef = useRef<PipelinePhase | null>(null);

  // Get backend data
  const backendPhase = (strategyData?.phase as PipelinePhase) || 'starting';
  const snapshotMatches = strategyData?._snapshotId === lastSnapshotId;
  const timing = strategyData?.timing as {
    phase_started_at?: string;
    phase_elapsed_ms?: number;
    expected_duration_ms?: number;
    expected_durations?: Record<string, number>;
  } | undefined;

  // Use backend elapsed time or calculate locally
  const phaseElapsedMs = timing?.phase_elapsed_ms ?? localPhaseElapsed;
  const expectedDurations = timing?.expected_durations ?? DEFAULT_EXPECTED_DURATIONS;

  // Calculate dynamic progress
  const { progress: targetProgress, strategyProgress: targetStrategyProgress, timeRemainingMs } = useMemo(() => {
    if (hasBlocks) return { progress: 100, strategyProgress: 100, timeRemainingMs: 0 };
    if (!coords) return { progress: 0, strategyProgress: 0, timeRemainingMs: 0 };
    if (!snapshotMatches) return { progress: 5, strategyProgress: 5, timeRemainingMs: 40000 };

    return calculateDynamicProgress(backendPhase, phaseElapsedMs, expectedDurations);
  }, [hasBlocks, coords, snapshotMatches, backendPhase, phaseElapsedMs, expectedDurations]);

  // Format time remaining
  const timeRemainingText = useMemo(() => {
    if (hasBlocks || !coords || timeRemainingMs <= 0) return null;
    return formatTimeRemaining(timeRemainingMs);
  }, [hasBlocks, coords, timeRemainingMs]);

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

  // Update local phase elapsed time every 500ms for smooth progress
  useEffect(() => {
    if (!timing?.phase_started_at || hasBlocks) {
      setLocalPhaseElapsed(0);
      return;
    }

    const phaseStartTime = new Date(timing.phase_started_at).getTime();

    const updateElapsed = () => {
      setLocalPhaseElapsed(Date.now() - phaseStartTime);
    };

    updateElapsed(); // Initial update
    const interval = setInterval(updateElapsed, 500);

    return () => clearInterval(interval);
  }, [timing?.phase_started_at, hasBlocks]);

  // Animate bottom bar progress smoothly toward target (250ms for smoother UX with fewer re-renders)
  useEffect(() => {
    if (animatedProgress >= targetProgress) return;

    const interval = setInterval(() => {
      setAnimatedProgress(prev => {
        const diff = targetProgress - prev;
        const step = Math.max(1, diff * 0.3); // Larger steps to compensate for slower interval
        return Math.min(targetProgress, prev + step);
      });
    }, 250);

    return () => clearInterval(interval);
  }, [targetProgress, animatedProgress]);

  // Animate strategy card progress smoothly toward target (250ms for smoother UX with fewer re-renders)
  useEffect(() => {
    if (animatedStrategyProgress >= targetStrategyProgress) return;

    const interval = setInterval(() => {
      setAnimatedStrategyProgress(prev => {
        const diff = targetStrategyProgress - prev;
        const step = Math.max(1, diff * 0.3); // Larger steps to compensate for slower interval
        return Math.min(targetStrategyProgress, prev + step);
      });
    }, 250);

    return () => clearInterval(interval);
  }, [targetStrategyProgress, animatedStrategyProgress]);

  // Reset when snapshot changes
  useEffect(() => {
    if (!snapshotMatches && coords) {
      setAnimatedProgress(5);
      setAnimatedStrategyProgress(5);
      setStartTime(Date.now());
      setLocalPhaseElapsed(0);
    }
  }, [snapshotMatches, coords]);

  // Log phase changes for debugging (only on actual phase transitions)
  useEffect(() => {
    if (coords && !hasBlocks && backendPhase !== prevPhaseRef.current) {
      console.log(`[enrichment] Phase: ${backendPhase} | Progress: ${Math.round(animatedProgress)}%`);
      prevPhaseRef.current = backendPhase;
    }
  }, [backendPhase, coords, hasBlocks, animatedProgress]);

  return {
    progress: Math.round(animatedProgress),
    strategyProgress: Math.round(animatedStrategyProgress),
    phase,
    pipelinePhase: backendPhase,
    startTime,
    timeRemainingMs,
    timeRemainingText
  };
}
