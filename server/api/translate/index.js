// server/api/translate/index.js
// Real-time translation endpoint for driver-rider communication
//
// 2026-03-16: Created for FIFA World Cup rider translation feature.
// Uses UTIL_TRANSLATION role (Gemini 3 Flash) for sub-200ms translations.
// Authenticated — requires JWT (in-app use only; Siri uses /api/hooks/translate).

import { Router } from 'express';
import { callModel } from '../../lib/ai/adapters/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { translationLimiter } from '../../middleware/rate-limit.js';
// 2026-03-17: Shared constants extracted to eliminate duplication (Rule 9)
import {
  SUPPORTED_LANGUAGES,
  TRANSLATION_SYSTEM_PROMPT,
  parseTranslationResponse,
} from './translation-prompt.js';

const router = Router();

/**
 * POST /api/translate
 * Translate text between languages for driver-rider communication
 *
 * Request:  { text: string, sourceLang?: string, targetLang?: string }
 * Response: { translatedText, detectedLang, targetLang, confidence }
 */
router.post('/', translationLimiter, requireAuth, async (req, res) => {
  const startTime = Date.now();

  try {
    const { text, sourceLang = 'auto', targetLang = 'en' } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required' });
    }

    if (text.length > 2000) {
      return res.status(400).json({ error: 'Text too long (max 2000 characters)' });
    }

    console.log(`[TRANSLATION] 🌐 Translating ${text.length} chars: ${sourceLang} → ${targetLang}`);

    const userMessage = `Translate the following text.
Source language: ${sourceLang === 'auto' ? 'detect automatically' : sourceLang}
Target language: ${targetLang}

Text: "${text}"`;

    const response = await callModel('UTIL_TRANSLATION', {
      system: TRANSLATION_SYSTEM_PROMPT,
      user: userMessage,
    });

    if (!response.success) {
      throw new Error(`Translation failed: ${response.error}`);
    }

    const result = parseTranslationResponse(response.text);

    const responseTimeMs = Date.now() - startTime;
    console.log(`[TRANSLATION] ${result.detectedLang} → ${result.targetLang} in ${responseTimeMs}ms`);

    res.json({
      success: true,
      translatedText: result.translatedText,
      detectedLang: result.detectedLang,
      targetLang: result.targetLang,
      confidence: result.confidence || 95,
      response_time_ms: responseTimeMs,
    });

  } catch (error) {
    const responseTimeMs = Date.now() - startTime;
    console.error(`[TRANSLATION] Error (${responseTimeMs}ms):`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      response_time_ms: responseTimeMs,
    });
  }
});

/**
 * GET /api/translate/languages
 * Returns supported languages for the UI language selector
 */
router.get('/languages', requireAuth, (req, res) => {
  res.json({
    success: true,
    languages: SUPPORTED_LANGUAGES,
  });
});

export default router;
