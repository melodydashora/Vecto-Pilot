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
