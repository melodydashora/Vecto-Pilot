// server/api/chat/tts.js
// Text-to-Speech endpoint using OpenAI's natural voice synthesis

import { Router } from 'express';
import { synthesizeSpeech } from '../../lib/external/tts-handler.js';

const router = Router();

/**
 * POST /api/tts
 * Generate natural voice audio from text
 * Request: { text: string }
 * Response: MP3 audio file
 */
router.post('/', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'Text is required' });
    }
    
    console.log(`[TTS] Processing request: ${text.length} characters`);
    
    // Generate audio
    const audioBuffer = await synthesizeSpeech(text);
    
    // Set response headers for audio file
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.setHeader('Cache-Control', 'no-cache');
    
    // Send audio as binary
    res.send(audioBuffer);
    
  } catch (err) {
    console.error('[TTS] Error:', err.message);
    res.status(500).json({ 
      ok: false, 
      error: err.message || 'Failed to generate speech' 
    });
  }
});

export default router;
