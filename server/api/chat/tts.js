// server/api/chat/tts.js
// Text-to-Speech endpoint using OpenAI's natural voice synthesis

import { Router } from 'express';
import { synthesizeSpeech } from '../../lib/external/tts-handler.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

/**
 * POST /api/tts
 * Generate natural voice audio from text
 * SECURITY: Requires auth (uses server-side OpenAI API key, has API cost)
 * Request: { text: string }
 * Response: MP3 audio file
 */
router.post('/', requireAuth, async (req, res) => {
  const controller = new AbortController();
  const onClose = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', onClose);
  try {
    // 2026-03-16: Added optional language parameter for translation feature TTS
    const { text, language } = req.body || {};

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'Text is required' });
    }

    console.log(`[TTS] Processing request: ${text.length} characters${language ? ` (lang: ${language})` : ''}`);

    // Generate audio — language param improves accent for short multilingual phrases
    const audioBuffer = await synthesizeSpeech(text, language, { signal: controller.signal });
    controller.signal.throwIfAborted();
    
    // Set response headers for audio file
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.setHeader('Cache-Control', 'no-cache');
    
    // Send audio as binary
    res.send(audioBuffer);
    
  } catch (err) {
    if (res.destroyed) return;
    if (controller.signal.aborted) return res.status(499).json({ ok: false, error: 'Speech request canceled' });
    console.error('[TTS] Error:', err.message);
    res.status(500).json({ 
      ok: false, 
      error: err.message || 'Failed to generate speech' 
    });
  } finally {
    res.off('close', onClose);
  }
});

export default router;
