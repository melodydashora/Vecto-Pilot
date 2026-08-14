// server/api/chat/gemini-live.js — Gemini Live ephemeral token endpoint
//
// 2026-08-11 (todo #33): Gemini arm of the Coach voice switcher. Mirrors
// realtime.js's hardened pipeline exactly:
//   requireAuth → validate body → ownership check → fetch context → mint → return
// Ownership runs BEFORE the mint — a billed token is never issued for a
// snapshot the caller does not own (same policy as the OpenAI minter).
//
// Model comes from the registry (COACH_VOICE_LIVE role) — never from a raw
// env read here. Token expiry values are returned by the adapter.

import { Router } from 'express';
import { rideshareCoachDAL } from '../../lib/ai/rideshare-coach-dal.js';
import { dayPartLabel } from '../../lib/location/daypart.js';
import { requireAuth } from '../../middleware/auth.js';
import { verifySnapshotOwnership } from '../../middleware/require-snapshot-ownership.js';
import { getRoleConfig } from '../../lib/ai/model-registry.js';
import { mintGeminiLiveToken } from '../../lib/ai/adapters/gemini-live-adapter.js';
import { buildLearnedDigest } from '../../lib/ai/mouth-digest.js';

const router = Router();

/**
 * POST /api/gemini-live/token
 * Mint a single-use ephemeral Gemini Live auth token for the authenticated user.
 *
 * SECURITY: requires auth (mints against the server's Gemini key, has API
 * cost). If snapshotId is supplied, the snapshot's owner MUST match the
 * authenticated user before any Google call is made.
 *
 * Request:  { snapshotId?, userId? }
 * Response: { ok, token, expires_at, new_session_expires_at, model, context }
 */
router.post('/token', requireAuth, async (req, res) => {
  try {
    const { snapshotId, userId } = req.body;

    if (!snapshotId && !userId) {
      return res.status(400).json({ error: 'snapshotId or userId required' });
    }

    const roleConfig = getRoleConfig('COACH_VOICE_LIVE');

    // Truncate IDs to avoid PII in logs (first 8 chars only) — realtime.js pattern.
    console.log(
      '[COACH] [GEMINI-LIVE] token request',
      'snapshot:', snapshotId?.substring(0, 8) || 'none',
      '| user:', userId?.substring(0, 8) || 'none',
      '| model:', roleConfig.model
    );

    // Ownership BEFORE the mint. Mismatch is 404 (anti-enumeration policy,
    // shared guard). If snapshotId is omitted (user-only flows), skip.
    if (snapshotId) {
      const owned = await verifySnapshotOwnership(snapshotId, req.auth?.userId);
      if (!owned.ok) return res.status(owned.status).json(owned.body);
    }

    // Snapshot context for the client-assembled session prompt (after
    // ownership clears). Same shape as realtime.js so the client's session
    // bootstrap is provider-agnostic.
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
            dayPart: dayPartLabel(fullContext.snapshot.day_part_key) || 'current time',
            hour: fullContext.snapshot.hour,
            address: fullContext.snapshot.formatted_address,
            timezone: fullContext.snapshot.timezone,
            // 2026-08-14: 500 → 1500. The mouth now answers "where should I
            // go right now" directly from this summary (Melody: "it should be
            // able to give where to go now based off of the snapshot") — 500
            // chars starved it into generic answers.
            strategy: fullContext.strategy?.strategy_for_now?.substring(0, 1500),
          };
        }
      } catch (err) {
        console.warn('[COACH] [GEMINI-LIVE] could not fetch snapshot context:', err.message);
      }
    }

    // 2026-08-14 (feed-the-mouth): what the brain has learned about this
    // driver — top memos + notes, assembled and capped in mouth-digest.js.
    // AUTHENTICATED id only (never the body's userId — that would let a caller
    // mint another driver's learned digest). Optional data: buildLearnedDigest
    // never throws (→ null), so the mint never fails because the digest did.
    const learned = await buildLearnedDigest(req.auth?.userId);
    if (learned) context.learned = learned;

    const minted = await mintGeminiLiveToken({ model: roleConfig.model });
    console.log('[COACH] [GEMINI-LIVE] ephemeral token minted', {
      has_token: !!minted.token,
      expires_at: minted.expires_at,
    });

    // Optional mouth thinking (registry-declared env knob; see COACH_VOICE_LIVE).
    // Absent env → field omitted → client connects without thinkingConfig.
    const thinkingRaw = roleConfig.thinkingBudgetEnvKey
      ? process.env[roleConfig.thinkingBudgetEnvKey]
      : undefined;
    const thinkingBudget =
      thinkingRaw !== undefined && thinkingRaw !== '' && Number.isInteger(Number(thinkingRaw))
        ? Number(thinkingRaw)
        : undefined;

    res.json({
      ok: true,
      token: minted.token,
      expires_at: minted.expires_at,
      new_session_expires_at: minted.new_session_expires_at,
      model: roleConfig.model,
      ...(thinkingBudget !== undefined && { thinkingBudget }),
      context,
    });
  } catch (err) {
    console.error('[COACH] [GEMINI-LIVE] token generation failed:', err.message);
    res.status(500).json({
      ok: false,
      error: err.message || 'Token generation failed',
    });
  }
});

export default router;
