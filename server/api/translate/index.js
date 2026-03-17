// server/api/translate/index.js
// Real-time translation endpoint for driver-rider communication
//
// 2026-03-16: Created for FIFA World Cup rider translation feature.
// Uses UTIL_TRANSLATION role (Gemini 3 Flash) for sub-200ms translations.
// Authenticated — requires JWT (in-app use only; Siri uses /api/hooks/translate).

import { Router } from 'express';
import { callModel } from '../../lib/ai/adapters/index.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

// Supported languages with display names for the UI language selector
const SUPPORTED_LANGUAGES = {
  en: 'English',
  es: 'Spanish',
  pl: 'Polish',
  uk: 'Ukrainian',
  sv: 'Swedish',
  sq: 'Albanian',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
  ko: 'Korean',
  ar: 'Arabic',
  hi: 'Hindi',
  zh: 'Mandarin Chinese',
  it: 'Italian',
  ru: 'Russian',
  tr: 'Turkish',
  vi: 'Vietnamese',
  th: 'Thai',
  tl: 'Filipino/Tagalog',
};

// 2026-03-16: System prompt optimized for translation speed.
// Single-purpose: detect language, translate, return JSON. No reasoning needed.
const TRANSLATION_SYSTEM_PROMPT = `You are a real-time translator for a rideshare driver communicating with passengers.
Translate the given text between the specified languages. Output ONLY valid JSON, no markdown, no backticks.

Rules:
1. If sourceLang is "auto", detect the source language from the text.
2. Translate naturally — use conversational tone appropriate for a car ride, not formal/literary.
3. Keep translations concise and clear.
4. Preserve the meaning and tone of the original.

Output format:
{"translatedText":"...","detectedLang":"ISO 639-1 code","targetLang":"ISO 639-1 code","confidence":0-100}`;

/**
 * POST /api/translate
 * Translate text between languages for driver-rider communication
 *
 * Request:  { text: string, sourceLang?: string, targetLang?: string }
 * Response: { translatedText, detectedLang, targetLang, confidence }
 */
router.post('/', requireAuth, async (req, res) => {
  const startTime = Date.now();

  try {
    const { text, sourceLang = 'auto', targetLang = 'en' } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required' });
    }

    if (text.length > 2000) {
      return res.status(400).json({ error: 'Text too long (max 2000 characters)' });
    }

    console.log(`[translate] 🌐 Translating ${text.length} chars: ${sourceLang} → ${targetLang}`);

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

    // Parse JSON response from AI
    let result;
    try {
      const cleaned = response.text
        .replace(/```json/g, '').replace(/```/g, '').trim();
      result = JSON.parse(cleaned);
    } catch {
      // Fallback: extract JSON from prose
      const firstBrace = response.text.indexOf('{');
      const lastBrace = response.text.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        result = JSON.parse(response.text.slice(firstBrace, lastBrace + 1));
      } else {
        throw new Error('Failed to parse translation response');
      }
    }

    const responseTimeMs = Date.now() - startTime;
    console.log(`[translate] ✅ ${result.detectedLang} → ${result.targetLang} in ${responseTimeMs}ms`);

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
    console.error(`[translate] ❌ Error (${responseTimeMs}ms):`, error.message);
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
