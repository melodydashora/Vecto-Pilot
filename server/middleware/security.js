// server/middleware/security.js
// Basic security middleware

export function securityMiddleware(req, res, next) {
  // Set basic security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  next();
}
