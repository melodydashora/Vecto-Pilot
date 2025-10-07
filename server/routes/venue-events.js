// server/routes/venue-events.js
// Check for events at a venue using Perplexity API

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

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that finds current events at venues. Return concise information about events including name, time, and crowd expectations.'
          },
          {
            role: 'user',
            content: query
          }
        ],
        temperature: 0.0,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      throw new Error(`Perplexity API failed: ${response.status}`);
    }

    const data = await response.json();
    const eventInfo = data.choices[0]?.message?.content || 'No events found';

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
