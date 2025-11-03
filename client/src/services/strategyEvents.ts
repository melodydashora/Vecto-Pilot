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
    console.log('[SSE] Closing connection');
    es.close();
  };
}
