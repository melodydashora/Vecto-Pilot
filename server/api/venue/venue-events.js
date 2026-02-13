// server/api/venue/venue-events.js
// Check for events at a venue using registered VENUE_EVENTS_SEARCH role
// 2026-02-13: Migrated from direct callGemini to callModel adapter (hedged router + fallback)

import express from 'express';
import { callModel } from '../../lib/ai/adapters/index.js';

const router = express.Router();

// In-memory lock to prevent duplicate venue event research for same venue
const venueResearchLocks = new Map(); // venue_id/key → Promise

/**
 * Check for events at a specific venue
 * POST /api/venue/events
 * Body: { venueName, venueAddress, date }
 */
router.post('/events', async (req, res) => {
  try {
    const { venueName, venueAddress, date } = req.body;

    if (!venueName) {
      return res.status(400).json({ error: 'Venue name required' });
    }

    // DEDUPLICATION: Use venue name as key to prevent duplicate research
    const venueKey = (venueName + venueAddress).toLowerCase();
    if (venueResearchLocks.has(venueKey)) {
      console.log(`[Venue Events] ⏳ Research already in-flight for ${venueName}, waiting for result...`);
      try {
        const cachedResult = await venueResearchLocks.get(venueKey);
        return res.json(cachedResult);
      } catch (err) {
        // If cached request failed, continue with new request
      }
    }

    const searchDate = date || 'today';
    const query = `What events are happening at ${venueName} (${venueAddress}) ${searchDate}? Include event name, time, and expected crowd size.`;

    // Create promise for this research task
    const researchPromise = (async () => {
      // 2026-02-13: Uses VENUE_EVENTS_SEARCH role via adapter (hedged router + fallback)
      const response = await callModel('VENUE_EVENTS_SEARCH', {
        user: query
      });

      if (!response.ok) {
        throw new Error(response.error);
      }

      const eventInfo = response.output || 'No events found';

      // Parse eventInfo (simple extraction - unchanged logic)
      const hasEvents = !eventInfo.toLowerCase().includes('no events') &&
                       !eventInfo.toLowerCase().includes('no scheduled');

      return {
        venue: venueName,
        hasEvents,
        eventInfo,
        sources: []
      };
    })();

    // Cache the promise
    venueResearchLocks.set(venueKey, researchPromise);

    // Clean up cache when done
    researchPromise.finally(() => {
      venueResearchLocks.delete(venueKey);
    });

    const result = await researchPromise;
    res.json(result);

  } catch (error) {
    console.error('[Venue Events] Error:', error.message);
    res.status(500).json({
      error: 'Failed to check events',
      hasEvents: false,
      eventInfo: null
    });
  }
});

export default router;
