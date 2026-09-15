import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { verifySnapshotOwnership } from '../../middleware/require-snapshot-ownership.js';
import { voiceTurnsLimiter } from '../../middleware/rate-limit.js';
import { getRoleConfig } from '../../lib/ai/model-registry.js';
import { COACH_LIVE_INSTRUCTIONS, DEFAULT_COACH_LIVE_VOICE, isCoachLiveVoice } from '../../../shared/coach-live.js';

export function buildCoachLiveSession({ sdp, voice, history = [] }, model) {
  if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length > 65536) throw new Error('A valid SDP offer is required');
  if (voice !== undefined && !isCoachLiveVoice(voice)) throw new Error('Unsupported Coach voice');
  if (!Array.isArray(history) || history.length > 20 || history.some(turn =>
    !turn || !['user', 'assistant'].includes(turn.role) || typeof turn.content !== 'string' || turn.content.length > 4000
  ) || history.reduce((n, turn) => n + turn.content.length, 0) > 16000) throw new Error('Invalid voice history');
  return {
    session: {
      model,
      instructions: COACH_LIVE_INSTRUCTIONS,
      delegation: { type: 'client' },
      store: false,
      audio: { output: { voice: voice ?? DEFAULT_COACH_LIVE_VOICE } },
      input: history.filter(turn => turn.content.trim()).map(turn => ({
        type: 'message', role: turn.role,
        content: [{ type: turn.role === 'assistant' ? 'output_text' : 'input_text', text: turn.content }],
      })),
    },
    transport: { type: 'webrtc', sdp },
  };
}

// Auth and snapshot ownership precede paid session creation. The browser receives
// only the SDP answer and opaque session ID, never an API key or client secret.
export function createCoachLiveRouter({
  auth = requireAuth, limiter = voiceTurnsLimiter, ownership = verifySnapshotOwnership,
  roleConfig = getRoleConfig, fetchImpl = fetch, apiKey = () => process.env.OPENAI_API_KEY,
} = {}) {
  const router = Router();
  router.post('/session', auth, limiter, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let request;
    let config;
    try {
      config = roleConfig('COACH_VOICE_OPENAI_LIVE');
      request = buildCoachLiveSession(req.body ?? {}, config.model);
    } catch (error) {
      return res.status(config ? 400 : 503).json({ ok: false, error: config ? error.message : 'Coach voice is not configured correctly' });
    }
    const snapshotId = req.body?.snapshotId;
    if (snapshotId !== undefined && snapshotId !== null) {
      const owned = await ownership(snapshotId, req.auth.userId);
      if (!owned.ok) return res.status(owned.status).json(owned.body);
    }
    const key = apiKey();
    if (!key) return res.status(503).json({ ok: false, error: 'Coach voice is not configured' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', abort);
    try {
      const upstream = await fetchImpl('https://api.openai.com/v1/live/sessions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request), signal: controller.signal,
      });
      if (!upstream.ok) {
        console.warn('[COACH LIVE] Session provider rejected request', { status: upstream.status, model: config.model });
        return res.status(502).json({ ok: false, error: 'Live voice could not connect. Please try again.' });
      }
      const data = await upstream.json();
      if (typeof data.session?.id !== 'string' || data.transport?.type !== 'webrtc' || typeof data.transport.sdp !== 'string') {
        throw new Error('Invalid provider session response');
      }
      return res.status(201).json({ ok: true, model: config.model, session: { id: data.session.id }, transport: { type: 'webrtc', sdp: data.transport.sdp } });
    } catch {
      if (!res.destroyed) return res.status(502).json({ ok: false, error: 'Live voice could not connect. Please try again.' });
    } finally {
      clearTimeout(timeout);
      res.removeListener('close', abort);
    }
  });
  return router;
}
export default createCoachLiveRouter();
