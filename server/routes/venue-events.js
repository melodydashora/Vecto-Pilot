// server/routes/venue-events.js
// Check for events at a venue using Gemini 3 Pro Preview

import express from 'express';

const router = express.Router();

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

    const searchDate = date || 'today';
    const query = `What events are happening at ${venueName} (${venueAddress}) ${searchDate}? Include event name, time, and expected crowd size.`;

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: query
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.0,
          maxOutputTokens: 500
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API failed: ${response.status}`);
    }

    const data = await response.json();
    const eventInfo = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No events found';

    // Parse event info (simple extraction)
    const hasEvents = !eventInfo.toLowerCase().includes('no events') && 
                     !eventInfo.toLowerCase().includes('no scheduled');

    res.json({
      venue: venueName,
      hasEvents,
      eventInfo,
      sources: data.citations || []
    });

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
