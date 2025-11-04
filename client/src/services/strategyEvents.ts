// client/src/services/strategyEvents.ts
export function subscribeStrategyReady(onReady: (snapshotId: string) => void) {
  const es = new EventSource('/events/strategy');
  
  es.addEventListener('strategy_ready', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      console.log('[SSE] Strategy ready event received:', data);
      onReady(data.snapshot_id);
    } catch (err) {
      console.error('[SSE] Failed to parse strategy_ready event:', err);
    }
  });
  
  es.addEventListener('open', () => {
    console.log('[SSE] Connected to strategy events');
  });
  
  es.addEventListener('error', (err) => {
    console.error('[SSE] EventSource error:', err);
  });
  
  return () => {
    console.log('[SSE] Closing strategy events connection');
    es.close();
  };
}

export function subscribeBlocksReady(onReady: (data: { ranking_id: string; snapshot_id: string }) => void) {
  const es = new EventSource('/events/blocks');
  
  es.addEventListener('blocks_ready', (e: MessageEvent) => {
    try {
      // Handle both JSON object and plain string formats for backward compatibility
      let data;
      try {
        data = JSON.parse(e.data);
      } catch {
        // If parsing fails, assume it's a plain snapshot ID string
        data = { snapshot_id: e.data, ranking_id: null };
      }
      
      // Ensure we have the expected format
      if (typeof data === 'string') {
        data = { snapshot_id: data, ranking_id: null };
      }
      
      console.log('[SSE] Blocks ready event received:', data);
      onReady(data);
    } catch (err) {
      console.error('[SSE] Failed to parse blocks_ready event:', err);
    }
  });
  
  es.addEventListener('open', () => {
    console.log('[SSE] Connected to blocks events');
  });
  
  es.addEventListener('error', (err) => {
    console.error('[SSE] EventSource error:', err);
  });
  
  return () => {
    console.log('[SSE] Closing blocks events connection');
    es.close();
  };
}

export interface StrategyStatus {
  progress: number;
  phase: string;
  statusText: string;
  message?: string;
}

// Production-ready polling function with smart progress tracking
export async function pollStrategyStatus(
  snapshotId: string,
  onStatusUpdate: (status: StrategyStatus) => void,
  signal?: AbortSignal
): Promise<{ status: string; briefing?: any; consolidated_strategy?: any }> {
  const maxAttempts = 120; // 2 minutes max
  let attempts = 0;
  let lastProgress = 0;
  let stuckCounter = 0;
  
  // Track actual strategy progress milestones
  const milestones = {
    created: false,
    analyzing: false,
    minstrategy: false,
    consolidated: false,
    briefing: false,
    complete: false
  };

  while (attempts < maxAttempts) {
    if (signal?.aborted) {
      throw new Error("Polling aborted");
    }

    try {
      const response = await fetch(`/api/blocks/strategy/${snapshotId}`, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      
      // Calculate actual progress based on real strategy state
      let progress = 5; // Base progress for created
      let phase = 'initializing';
      let statusText = 'Starting strategy generation...';
      
      // Track real milestones based on API response structure
      if (data.status === 'ok') {
        // Strategy is complete with data
        milestones.complete = true;
        progress = 100;
        phase = 'complete';
        statusText = 'Strategy ready!';
        
        // Check for specific strategy components
        if (data.strategy?.min) {
          milestones.minstrategy = true;
        }
        if (data.strategy?.consolidated) {
          milestones.consolidated = true;
        }
        if (data.strategy?.briefing) {
          milestones.briefing = true;
        }
      } else if (data.status === 'pending') {
        milestones.analyzing = true;
        phase = 'analyzing';
        statusText = 'Generating strategy insights...';
        
        // Progressive updates based on waitFor array
        if (data.waitFor?.includes('strategy')) {
          progress = Math.max(15, progress);
          statusText = 'Processing strategy data...';
          
          // Add time-based progress for pending state (up to 60%)
          if (attempts > 5) progress = Math.max(25, progress);
          if (attempts > 10) progress = Math.max(35, progress);
          if (attempts > 20) progress = Math.max(45, progress);
          if (attempts > 30) progress = Math.max(55, progress);
        } else {
          // If waitFor doesn't include strategy, we're closer to done
          progress = Math.max(75, progress);
          statusText = 'Finalizing strategy...';
        }
        
        // Add elapsed time indication
        if (data.timeElapsedMs > 10000) {
          statusText += ` (${Math.round(data.timeElapsedMs / 1000)}s)`;
        }
      } else if (data.status === 'missing') {
        phase = 'initializing';
        statusText = 'Waiting for strategy generation...';
        progress = 5;
      } else if (data.status === 'error' || data.status === 'failed') {
        phase = 'error';
        statusText = data.error || data.message || 'Strategy generation failed';
        progress = 0;
      }
      
      // Update UI if progress changed or stuck for too long
      if (progress > lastProgress || stuckCounter > 10) {
        lastProgress = progress;
        stuckCounter = 0;
        
        onStatusUpdate({
          progress,
          phase,
          statusText,
          message: data.message || ''
        });
      } else {
        stuckCounter++;
      }

      // Return when complete
      if (data.status === 'ok' || data.status === 'failed') {
        return data;
      }
      
    } catch (error) {
      if (signal?.aborted) throw error;
      console.error('[polling] Error fetching strategy:', error);
      
      // Don't fail immediately on network errors
      if (attempts > 30) {
        throw error;
      }
    }

    // Adaptive polling: faster initially, slower over time
    const delay = attempts < 5 ? 1000 :    // First 5 seconds: 1s intervals
                  attempts < 20 ? 2000 :   // Next 30 seconds: 2s intervals  
                  attempts < 50 ? 3000 :   // Next minute: 3s intervals
                  5000;                     // After that: 5s intervals
    
    await new Promise(resolve => setTimeout(resolve, delay));
    attempts++;
  }

  throw new Error("Strategy generation timeout - please try again");
}

// Polling function specifically for blocks
export async function pollBlocksStatus(
  snapshotId: string,
  onBlocksReady: () => void,
  signal?: AbortSignal
): Promise<void> {
  const maxAttempts = 30; // 30 seconds for blocks after strategy completes
  let attempts = 0;

  while (attempts < maxAttempts) {
    if (signal?.aborted) return;

    try {
      // Check if blocks exist
      const response = await fetch(`/api/smart-blocks?snapshot_id=${snapshotId}`, { signal });
      if (response.ok) {
        const data = await response.json();
        if (data.blocks && data.blocks.length > 0) {
          console.log('[polling] Blocks ready via polling!');
          onBlocksReady();
          return;
        }
      }
    } catch (error) {
      if (signal?.aborted) return;
      console.error('[polling] Error checking blocks:', error);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
  }
  
  console.log('[polling] Blocks polling timeout - may still be processing');
}
