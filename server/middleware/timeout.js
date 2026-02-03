
// server/middleware/timeout.js
// Global timeout middleware to prevent hanging requests

const DEFAULT_TIMEOUT_MS = 180000; // 3 minutes
const API_TIMEOUT_MS = 120000; // 2 minutes for API routes
const LLM_TIMEOUT_MS = 180000; // 3 minutes for LLM routes

export function timeoutMiddleware(req, res, next) {
  const path = req.path;
  
  // Determine timeout based on route
  let timeout = DEFAULT_TIMEOUT_MS;
  
  if (path.includes('/api/blocks') || path.includes('/api/research')) {
    timeout = LLM_TIMEOUT_MS; // Longer for LLM calls
  } else if (path.startsWith('/api/')) {
    timeout = API_TIMEOUT_MS;
  }
  
  // Set request timeout
  req.setTimeout(timeout, () => {
    console.error(`[timeout] Request timeout after ${timeout}ms: ${req.method} ${req.path}`);
    
    if (!res.headersSent) {
      res.status(504).json({
        ok: false,
        error: 'GATEWAY_TIMEOUT',
        message: `Request exceeded ${timeout}ms timeout`,
        path: req.path
      });
    }
  });
  
  // Set response timeout
  res.setTimeout(timeout, () => {
    console.error(`[timeout] Response timeout after ${timeout}ms: ${req.method} ${req.path}`);
    
    if (!res.headersSent) {
      res.status(504).json({
        ok: false,
        error: 'GATEWAY_TIMEOUT',
        message: 'Response generation timeout'
      });
    }
  });
  
  next();
}

export default timeoutMiddleware;
