// server/api/venue/venue-intelligence.js
// API routes for venue intelligence (bars/restaurants sorted by expense, traffic data)
// 2026-01-09: Added response transformation for consistent camelCase API responses

import { Router } from 'express';
import { discoverNearbyVenues, getTrafficIntelligence, getSmartBlocksIntelligence } from '../../lib/venue/venue-intelligence.js';
import { toApiVenueData } from '../../validation/transformers.js';

const router = Router();

/**
 * GET /api/venues/nearby
 * Discover nearby bars and restaurants sorted by expense level
 * Query params: lat, lng, city, state, radius (miles), timezone
 */
router.get('/nearby', async (req, res) => {
  try {
    const { lat, lng, city, state, radius, timezone } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        error: 'Missing required parameters: lat, lng'
      });
    }

    // CRITICAL: Use timezone for accurate time-based venue filtering
    // Without this, server uses UTC and late-night venues show as closed
    const venueData = await discoverNearbyVenues({
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      city: city || 'Unknown',
      state: state || '',
      radiusMiles: parseFloat(radius) || 25,  // Default 25 mile radius for upscale bars
      timezone: timezone || null  // Pass to use correct local time
    });

    // 2026-01-09: Transform to camelCase for consistent API response
    res.json({
      success: true,
      data: toApiVenueData(venueData)
    });
  } catch (error) {
    console.error('[VenueRoutes] Error fetching nearby venues:', error);
    res.status(500).json({
      error: 'Failed to fetch venue intelligence',
      message: error.message
    });
  }
});

/**
 * GET /api/venues/traffic
 * Get traffic intelligence for an area
 * Query params: lat, lng, city, state
 */
router.get('/traffic', async (req, res) => {
  try {
    const { lat, lng, city, state } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({ 
        error: 'Missing required parameters: lat, lng' 
      });
    }

    const trafficData = await getTrafficIntelligence({
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      city: city || 'Unknown',
      state: state || ''
    });

    res.json({
      success: true,
      data: trafficData
    });
  } catch (error) {
    console.error('[VenueRoutes] Error fetching traffic:', error);
    res.status(500).json({ 
      error: 'Failed to fetch traffic intelligence',
      message: error.message 
    });
  }
});

/**
 * GET /api/venues/smart-blocks
 * Combined venue + traffic intelligence for Smart Blocks UI
 * Query params: lat, lng, city, state, radius (miles), holiday (optional)
 */
router.get('/smart-blocks', async (req, res) => {
  try {
    const { lat, lng, city, state, radius, holiday } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({ 
        error: 'Missing required parameters: lat, lng' 
      });
    }

    const intelligence = await getSmartBlocksIntelligence({
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      city: city || 'Unknown',
      state: state || '',
      radiusMiles: parseFloat(radius) || 5,
      holiday: holiday || null
    });

    res.json({
      success: true,
      data: intelligence
    });
  } catch (error) {
    console.error('[VenueRoutes] Error fetching smart blocks:', error);
    res.status(500).json({ 
      error: 'Failed to fetch smart blocks intelligence',
      message: error.message 
    });
  }
});

/**
 * GET /api/venues/last-call
 * Get venues closing within the next hour (last-call opportunities)
 * Query params: lat, lng, city, state
 */
router.get('/last-call', async (req, res) => {
  try {
    const { lat, lng, city, state } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({ 
        error: 'Missing required parameters: lat, lng' 
      });
    }

    const venueData = await discoverNearbyVenues({
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      city: city || 'Unknown',
      state: state || '',
      radiusMiles: 5
    });

    // Filter to only last-call venues
    const lastCallVenues = venueData.last_call_venues || 
      (venueData.venues || []).filter(v => v.closing_soon);

    res.json({
      success: true,
      data: {
        query_time: venueData.query_time,
        location: venueData.location,
        last_call_count: lastCallVenues.length,
        venues: lastCallVenues
      }
    });
  } catch (error) {
    console.error('[VenueRoutes] Error fetching last-call venues:', error);
    res.status(500).json({ 
      error: 'Failed to fetch last-call venues',
      message: error.message 
    });
  }
});

export default router;
