// server/middleware/logging.js
// Simple request logging middleware
import crypto from 'crypto';

export function loggingMiddleware(req, res, next) {
  const start = Date.now();
  const reqId = req.headers['x-request-id'] || req.headers['x-correlation-id'] || crypto.randomUUID();
  
  req.requestId = reqId;
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    
    console.log(`[${logLevel}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  
  next();
}
