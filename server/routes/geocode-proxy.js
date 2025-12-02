
// server/routes/geocode-proxy.js
// Secure proxy for geocoding API calls - prevents API key exposure
import express from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Rate limiting per IP
const geocodeRateLimit = new Map();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;

function checkRateLimit(ip) {
  const now = Date.now();
  const userRequests = geocodeRateLimit.get(ip) || [];
  
  // Clean old requests
  const recentRequests = userRequests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);
  
  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  
  recentRequests.push(now);
  geocodeRateLimit.set(ip, recentRequests);
  return true;
}

// Geocode endpoint - proxy to Google Maps API
// SECURITY: Requires authentication to prevent abuse
router.post('/geocode', requireAuth, async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  
  // Rate limiting
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({
      ok: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many geocoding requests. Please try again later.'
    });
  }
  
  const { address } = req.body;
  
  if (!address || typeof address !== 'string') {
    return res.status(400).json({
      ok: false,
      error: 'INVALID_INPUT',
      message: 'Address is required'
    });
  }
  
  try {
    // Server-side API call with secure key
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    
    if (!GOOGLE_MAPS_API_KEY) {
      console.error('[geocode-proxy] GOOGLE_MAPS_API_KEY not configured');
      return res.status(500).json({
        ok: false,
        error: 'SERVICE_UNAVAILABLE',
        message: 'Geocoding service not configured'
      });
    }
    
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', address);
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY);
    
    const response = await fetch(url.toString());
    const data = await response.json();
    
    if (data.status !== 'OK') {
      return res.status(400).json({
        ok: false,
        error: 'GEOCODING_FAILED',
        message: data.error_message || 'Geocoding failed',
        status: data.status
      });
    }
    
    // Return sanitized response
    res.json({
      ok: true,
      results: data.results.map(result => ({
        formatted_address: result.formatted_address,
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        place_id: result.place_id
      }))
    });
    
  } catch (error) {
    console.error('[geocode-proxy] Error:', error);
    res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: 'Geocoding request failed'
    });
  }
});

export default router;
