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

  // 2026-08-06: a client that aborted its own request mid-body (page nav,
  // superseded fetch) is NOT a server error — the socket is gone, nobody
  // receives a response, and counting it as http.500 pollutes the exact
  // 500-signal used to judge prod health (observed in Melody's 2026-08-06
  // dev console during normal briefing usage).
  if (err.type === 'request.aborted' || err.code === 'ECONNABORTED') {
    ndjson('http.client_abort', { cid, path: req.originalUrl });
    return res.end();
  }

  // 2026-02-17: Surface payload-too-large errors clearly instead of masking as 500.
  // 2026-08-17: multer's LIMIT_FILE_SIZE (multipart part > 5 MB) is the same condition and
  // used to fall through to a bare 500; and on the /api/hooks surface a phone shortcut only
  // speaks what we send — so both carry the voice/notification/decision shape there
  // (previously "oversize → 500 with no voice", OFFER_ANALYZER.md).
  if (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE') {
    console.warn(`[error-handler] Payload too large: ${err.message}`);
    ndjson('http.413', { cid, error: String(err.message || err) });
    const isHooks = String(req.originalUrl || req.url || '').startsWith('/api/hooks');
    return res.status(413).json({
      cid,
      error: 'Payload too large. Try reducing image size or removing attachments.',
      code: 'payload_too_large',
      ...(isHooks ? {
        success: false,
        voice: 'Image too large. Decide manually.',
        notification: 'Image too large (limit 5 MB) — decide manually',
        decision: 'NO DATA',
        reason: 'image too large',
      } : {}),
    });
  }

  console.error('[error-handler] Unhandled error:', err);
  ndjson('http.500', { cid, error: String(err.message || err), stack: err.stack });
  return res.status(500).json({
    cid,
    error: 'Internal server error'
  });
}
