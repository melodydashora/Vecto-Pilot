// server/routes/closed-venue-reasoning.js
// Parallel enrichment: GPT-5 explains why closed venues are still worth visiting
import express from 'express';
import { OpenAI } from 'openai';
import { requireAuth } from '../middleware/auth.ts';

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

    // Build a concise prompt for GPT-5
    const messages = [
      {
        role: 'system',
        content: 
          'You are a rideshare strategy expert. Explain in 1-2 sentences why a closed venue is still worth staging near. ' +
          'Focus on: spillover demand, nearby venues, post-hours pickups, or strategic positioning. Be concrete and tactical.'
      },
      {
        role: 'user',
        content: 
          `Venue: ${venueName}\n` +
          `Category: ${category || 'unknown'}\n` +
          `Address: ${address || 'unknown'}\n` +
          `Business Hours: ${businessHours || 'unknown'}\n` +
          `Strategy Context: ${strategyContext || 'none'}\n\n` +
          `Why should I stage near this closed venue?`
      }
    ];

    // Call GPT-5 (model-agnostic in architecture, using GPT-5 for now)
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-5',
      max_completion_tokens: 200,
      messages,
    });

    const reasoning = completion.choices?.[0]?.message?.content?.trim() || '';

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
