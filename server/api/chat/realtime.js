// server/api/chat/realtime.js — OpenAI Realtime ephemeral token endpoint
//
// 2026-04-25: Migrated to the GA /v1/realtime/client_secrets endpoint and
// reordered to verify snapshot ownership BEFORE any OpenAI call.
//
// Pipeline (closes audit §1.5 token-before-ownership gap):
//   requireAuth → validate body → ownership check → fetch context → mint → return
//
// Token expiry is controlled by OpenAI and returned in the response — this
// file does NOT carry a hardcoded TTL constant.

import { Router } from 'express';
import { rideshareCoachDAL } from '../../lib/ai/rideshare-coach-dal.js';
import { requireAuth } from '../../middleware/auth.js';
import { db } from '../../db/drizzle.js';
import { snapshots } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
// Node.js 18+ has built-in fetch — no import needed

const router = Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// COACH_VOICE role: real-time voice chat with snapshot context.
// 2026-04-25: 'gpt-realtime' is the realtime-class default. The Realtime API
// (/v1/realtime/client_secrets) only accepts realtime-class models; chat
// models like gpt-5.x will fail. Text/reasoning paths use
// OPENAI_MODEL=gpt-5.5-2026-04-23, which is intentionally distinct.
const VOICE_MODEL = process.env.VOICE_MODEL || 'gpt-realtime';

/**
 * POST /api/realtime/token
 * Mint an ephemeral OpenAI Realtime client_secret for the authenticated user.
 *
 * SECURITY: requires auth (mints OpenAI tokens using server API key, has
 * API cost). If snapshotId is supplied, the snapshot's owner MUST match the
 * authenticated user before any OpenAI call is made.
 *
 * Request:  { snapshotId?, userId?, strategyId? }
 * Response: { ok, token, expires_at, model, context }
 */
router.post('/token', requireAuth, async (req, res) => {
  try {
    const { snapshotId, userId, strategyId } = req.body;

    if (!snapshotId && !userId) {
      return res.status(400).json({ error: 'snapshotId or userId required' });
    }

    // 2026-01-07: Truncate user ID to avoid PII in logs (first 8 chars only)
    console.log(
      '[realtime] token request',
      'snapshot:', snapshotId?.substring(0, 8) || 'none',
      '| user:', userId?.substring(0, 8) || 'none',
      '| model:', VOICE_MODEL
    );

    // 2026-04-25 (audit §1.5): Ownership check moved BEFORE the OpenAI mint.
    // Previously the order was auth → mint → ownership, which meant a billed
    // OpenAI token could be issued for a snapshot the caller did not own —
    // even if the response was withheld, the cost had already been incurred.
    // If snapshotId is omitted (some flows allow user-only context), skip the
    // ownership check and proceed to fetch context with the user identity.
    if (snapshotId) {
      try {
        const [snap] = await db
          .select({ user_id: snapshots.user_id })
          .from(snapshots)
          .where(eq(snapshots.snapshot_id, snapshotId))
          .limit(1);

        if (!snap || snap.user_id !== req.auth.userId) {
          return res.status(403).json({
            error: 'snapshot_not_owned',
            message: 'Snapshot does not belong to this user',
          });
        }
      } catch (ownerErr) {
        console.warn('[realtime] ownership check failed:', ownerErr.message);
        return res.status(500).json({ error: 'ownership_check_failed' });
      }
    }

    // Fetch snapshot context for the session prompt (after ownership clears).
    let context = {
      snapshot_id: snapshotId,
      user_id: userId,
      city: 'your location',
      dayPart: 'current time',
    };

    if (snapshotId) {
      try {
        const fullContext = await rideshareCoachDAL.getCompleteContext(snapshotId);
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
            strategy: fullContext.strategy?.strategy_for_now?.substring(0, 500),
          };
        }
      } catch (err) {
        console.warn('[realtime] could not fetch snapshot context:', err.message);
      }
    }

    // Mint the ephemeral client_secret via the GA endpoint.
    // (Voice choice can be parameterized later; 'alloy' is a safe default.)
    const tokenResponse = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: VOICE_MODEL,
          audio: {
            input: {
              transcription: { model: 'whisper-1' },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                silence_duration_ms: 700,
              },
              noise_reduction: { type: 'near_field' },
            },
            output: {
              voice: 'alloy',
            },
          },
        },
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}));
      console.error('[realtime] OpenAI client_secrets error:', errorData);
      throw new Error(errorData.error?.message || 'Failed to mint client_secret');
    }

    const response = await tokenResponse.json();
    // GA shape returns the ephemeral token at `value` (top-level). The prior
    // beta sessions endpoint nested it under `client_secret.value`; fall
    // back to that shape defensively in case the endpoint is rolled back.
    const token = response.value ?? response.client_secret?.value;
    console.log('[realtime] ✅ client_secret minted', {
      id: response.id,
      has_token: !!token,
      expires_at: response.expires_at,
    });

    res.json({
      ok: true,
      token,
      expires_at: response.expires_at, // OpenAI-controlled, not hardcoded
      model: VOICE_MODEL,
      context,
    });
  } catch (err) {
    console.error('[realtime] token generation failed:', err.message);
    res.status(500).json({
      ok: false,
      error: err.message || 'Token generation failed',
    });
  }
});

export default router;
