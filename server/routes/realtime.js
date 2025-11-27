// server/routes/realtime.js - OpenAI Realtime API ephemeral token endpoint
// Enables voice-to-voice conversation with full snapshot context

import { Router } from 'express';
import fetch from 'node-fetch';
import { coachDAL } from '../lib/coach-dal.js';

const router = Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Voice model configuration
// GPT-4o Realtime: 232-320ms latency (proven, production-ready)
// Future upgrade: GPT-5 Pro (<150ms) or GPT-5.1 when voice API available
const VOICE_MODEL = process.env.VOICE_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
const TOKEN_EXPIRY_SECONDS = 3600; // 1 hour

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

    console.log('[realtime] Generating token for snapshot:', snapshotId, '| user:', userId, '| model:', VOICE_MODEL);

    // Generate ephemeral token using OpenAI REST API
    const tokenResponse = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: VOICE_MODEL,
        expires_in: TOKEN_EXPIRY_SECONDS,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error('[realtime] OpenAI API error:', errorData);
      throw new Error(errorData.error?.message || 'Failed to generate token');
    }

    const response = await tokenResponse.json();

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

    console.log('[realtime] ✅ Token generated, id:', response.id, '| Context:', context);

    res.json({
      ok: true,
      token: response.client_secret?.value || response.token,
      expires_at: response.expires_at || Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS,
      model: VOICE_MODEL,
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
