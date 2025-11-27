// server/routes/realtime.js - OpenAI Realtime API ephemeral token endpoint
// Enables voice-to-voice conversation with full snapshot context

import { Router } from 'express';
import OpenAI from 'openai';
import { coachDAL } from '../lib/coach-dal.js';

const router = Router();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * POST /api/realtime/token
 * Generate ephemeral session token for OpenAI Realtime API
 * Returns token + context for voice chat with snapshot access
 * 
 * Request: { snapshotId, userId, strategyId }
 * Response: { token, expires_at, model, context }
 */
router.post('/token', async (req, res) => {
  try {
    const { snapshotId, userId, strategyId } = req.body;

    if (!snapshotId && !userId) {
      return res.status(400).json({ error: 'snapshotId or userId required' });
    }

    console.log('[realtime] Generating token for snapshot:', snapshotId, '| user:', userId);

    // Generate ephemeral token (1 hour expiry)
    const response = await client.beta.realtimeTokens.create({
      model: 'gpt-4o-realtime-preview-2024-12-17',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });

    // Fetch snapshot context for system prompt
    let context = {
      snapshot_id: snapshotId,
      user_id: userId,
      city: 'your location',
      dayPart: 'current time',
    };

    if (snapshotId) {
      try {
        const fullContext = await coachDAL.getCompleteContext(snapshotId);
        if (fullContext?.snapshot) {
          context = {
            snapshot_id: snapshotId,
            city: fullContext.snapshot.city || 'your location',
            state: fullContext.snapshot.state,
            weather: fullContext.snapshot.weather,
            air: fullContext.snapshot.air,
            dayPart: fullContext.snapshot.day_part_key,
            hour: fullContext.snapshot.hour,
            address: fullContext.snapshot.formatted_address,
            timezone: fullContext.snapshot.timezone,
            strategy: fullContext.strategy?.consolidated_strategy?.substring(0, 500),
          };
        }
      } catch (err) {
        console.warn('[realtime] Could not fetch snapshot context:', err.message);
      }
    }

    console.log('[realtime] ✅ Token generated, expires:', response.expires_at, '| Context:', context);

    res.json({
      ok: true,
      token: response.token,
      expires_at: response.expires_at,
      model: 'gpt-4o-realtime-preview-2024-12-17',
      context,
    });
  } catch (err) {
    console.error('[realtime] Token generation failed:', err.message);
    res.status(500).json({ 
      ok: false, 
      error: err.message || 'Token generation failed',
    });
  }
});

export default router;
