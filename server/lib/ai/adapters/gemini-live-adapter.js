// server/lib/ai/adapters/gemini-live-adapter.js
// Gemini Live API concern: ephemeral auth-token minting for browser voice sessions.
//
// 2026-08-11 (todo #33): the Live API (bidiGenerateContent over WSS) is the
// Gemini arm of the Coach voice switcher. Browsers must NEVER hold the real
// GEMINI_API_KEY — Google's documented client-to-server pattern is a backend-
// minted ephemeral auth token (ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens):
// default 1 minute to START a session, 30 minutes of messages once connected,
// single use. The token is locked to the registry-resolved model so a leaked
// token cannot be repurposed against a different (pricier) model.
//
// API-version note (live-verified 2026-08-11): auth tokens graduated
// v1alpha → v1beta recently; docs and SDK versions disagree. @google/genai
// ^1.52.0 is installed; the version is pinned explicitly below and
// GEMINI_LIVE_API_VERSION overrides it if Google moves again — fail-loud
// either way, never a silent fallback.

import { GoogleGenAI } from '@google/genai';

/**
 * Mint a single-use ephemeral Gemini Live auth token, locked to `model`.
 *
 * @param {Object} params
 * @param {string} params.model - Live-class model id (registry-resolved, e.g.
 *   COACH_VOICE_LIVE's pinned default). Chat-class models are rejected upstream
 *   by the registry's requiresLive guard.
 * @returns {Promise<{token: string, expires_at: string, new_session_expires_at: string}>}
 * @throws {Error} descriptive failure — missing key, mint rejection. No fallback.
 */
export async function mintGeminiLiveToken({ model }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured — cannot mint Gemini Live token');
  }
  if (!model) {
    throw new Error('mintGeminiLiveToken: model is required (registry-resolved, never hardcoded)');
  }

  // Same workaround as gemini-adapter.js: the SDK prioritizes GOOGLE_API_KEY
  // from env over the constructor apiKey. Hide it for the constructor call,
  // restore immediately for other services (Maps etc).
  const conflictingKey = process.env.GOOGLE_API_KEY;
  if (conflictingKey) {
    delete process.env.GOOGLE_API_KEY;
  }
  const apiVersion = process.env.GEMINI_LIVE_API_VERSION || 'v1alpha';
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion } });
  if (conflictingKey) {
    process.env.GOOGLE_API_KEY = conflictingKey;
  }

  const now = Date.now();
  const expireTime = new Date(now + 30 * 60 * 1000).toISOString(); // session lifetime
  const newSessionExpireTime = new Date(now + 60 * 1000).toISOString(); // window to CONNECT

  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime,
      newSessionExpireTime,
      // Lock the token to the registry-resolved model. Session config (system
      // prompt, tools incl. ask_coach_backend, voice) is assembled client-side
      // at connect time; the model is the billing-relevant field to pin.
      liveConnectConstraints: { model },
      lockAdditionalFields: [],
    },
  });

  if (!token?.name) {
    throw new Error(`Gemini authTokens.create returned no token name (apiVersion=${apiVersion})`);
  }

  return {
    token: token.name,
    expires_at: expireTime,
    new_session_expires_at: newSessionExpireTime,
  };
}
