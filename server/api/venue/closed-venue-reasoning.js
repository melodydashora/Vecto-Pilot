// server/api/venue/closed-venue-reasoning.js
// Parallel enrichment: VENUE_REASONING role explains why closed venues are still worth visiting
// 2026-02-13: Refactored to use callModel adapter (was direct OpenAI instantiation)
import express from 'express';
import { callModel } from '../../lib/ai/adapters/index.js';
import { requireAuth } from '../../middleware/auth.js';

const router = express.Router();

// SECURITY: Require authentication
// POST /api/closed-venue-reasoning
// Body: { venueName, category, address, lat, lng, businessHours, strategyContext }
router.post('/', requireAuth, async (req, res) => {
  try {
    const { venueName, category, address, businessHours, strategyContext } = req.body;

    if (!venueName) {
      return res.status(400).json({ error: 'venueName required' });
    }

    console.log(`[Closed Venue Reasoning] Generating reasoning for: ${venueName}`);

    const system =
      'You are a rideshare strategy expert. Explain in 1-2 sentences why a closed venue is still worth staging near. ' +
      'Focus on: spillover demand, nearby venues, post-hours pickups, or strategic positioning. Be concrete and tactical.';

    const user =
      `Venue: ${venueName}\n` +
      `Category: ${category || 'unknown'}\n` +
      `Address: ${address || 'unknown'}\n` +
      `Business Hours: ${businessHours || 'unknown'}\n` +
      `Strategy Context: ${strategyContext || 'none'}\n\n` +
      `Why should I stage near this closed venue?`;

    // 2026-02-13: Uses registered VENUE_REASONING role via adapter (hedged router + fallback)
    const result = await callModel('VENUE_REASONING', { system, user });

    if (!result.ok) {
      throw new Error(result.error || 'Empty response from model');
    }

    const reasoning = result.output;

    console.log(`[Closed Venue Reasoning] ✅ Generated: "${reasoning.slice(0, 80)}..."`);

    res.json({
      ok: true,
      venueName,
      reasoning,
      model_used: 'AI' // model-agnostic label
    });

  } catch (err) {
    console.error('[Closed Venue Reasoning] Error:', err);
    res.status(500).json({
      error: 'Failed to generate reasoning',
      message: err.message
    });
  }
});

export default router;
