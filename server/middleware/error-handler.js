import { ndjson } from '../logger/ndjson.js';

export function errorTo503(err, _req, res, next) {
  if (err?.message === 'db_degraded' || err?.status === 503) {
    ndjson('http.503', { reason: 'db_degraded', error: String(err.message || err) });
    return res.status(503).json({ 
      error: 'Service temporarily degraded. Please retry.',
      retry_after: 5
    });
  }
  
  if (res.headersSent) {
    return next(err);
  }
  
  console.error('[error-handler] Unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error' });
}
