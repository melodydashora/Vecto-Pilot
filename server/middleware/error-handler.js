import { ndjson } from '../logger/ndjson.js';
import { getAgentState } from '../db/connection-manager.js';

export function errorTo503(err, req, res, next) {
  const cid = req.cid || req.get('x-correlation-id') || 'unknown';
  const { currentBackoffDelay } = getAgentState();
  const retryAfter = Math.ceil((currentBackoffDelay || 2000) / 1000); // Convert to seconds
  
  if (err?.message === 'db_degraded' || err?.status === 503) {
    ndjson('http.503', { 
      cid,
      reason: 'db_degraded', 
      error: String(err.message || err),
      retry_after: retryAfter
    });
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(503).json({ 
      cid,
      state: 'degraded',
      error: 'Service temporarily degraded. Please retry.',
      retry_after: retryAfter
    });
  }
  
  if (res.headersSent) {
    return next(err);
  }
  
  console.error('[error-handler] Unhandled error:', err);
  ndjson('http.500', { cid, error: String(err.message || err), stack: err.stack });
  return res.status(500).json({ 
    cid,
    error: 'Internal server error' 
  });
}
