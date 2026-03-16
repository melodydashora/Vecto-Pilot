// server/api/hooks/translate.js
// Siri Shortcut translation endpoint for driver-rider communication
//
// 2026-03-16: Created for FIFA World Cup rider translation feature.
// Auth: Device-based (device_id header) — Siri Shortcuts cannot send JWT tokens.
// Same auth pattern as analyze-offer.js.
//
// Siri Shortcut flow:
//   Driver says "Vecto Translate" →
//   Siri listens to rider via dictation →
//   POST /api/hooks/translate { text, device_id, target_lang } →
//   Gemini Flash translates →
//   Response: { voice: "They said: Can you take the highway?" } →
//   Siri speaks English translation aloud

import { Router } from 'express';
import { callModel } from '../../lib/ai/adapters/index.js';

const router = Router();

const TRANSLATION_SYSTEM_PROMPT = `You are a real-time translator for a rideshare driver communicating with passengers.
Translate the given text between the specified languages. Output ONLY valid JSON, no markdown, no backticks.

Rules:
1. If sourceLang is "auto", detect the source language from the text.
2. Translate naturally — use conversational tone appropriate for a car ride.
3. Keep translations concise and clear.

Output format:
{"translatedText":"...","detectedLang":"ISO 639-1 code","targetLang":"ISO 639-1 code","confidence":0-100}`;

/**
 * POST /api/hooks/translate
 * Translate text for Siri Shortcuts (device_id auth, no JWT)
 *
 * Request:  { text: string, device_id: string, target_lang?: string, source_lang?: string }
 * Response: { success, voice, translatedText, detectedLang, targetLang }
 */
router.post('/translate', async (req, res) => {
  const startTime = Date.now();

  try {
    const {
      text,
      device_id,
      target_lang = 'en',
      source_lang = 'auto',
    } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Missing text payload' });
    }

    if (!device_id) {
      return res.status(400).json({ error: 'Missing device_id' });
    }

    console.log(`[hooks/translate] 🌐 From ${device_id}: "${text.substring(0, 60)}..." (${source_lang} → ${target_lang})`);

    const userMessage = `Translate the following text.
Source language: ${source_lang === 'auto' ? 'detect automatically' : source_lang}
Target language: ${target_lang}

Text: "${text}"`;

    const response = await callModel('UTIL_TRANSLATION', {
      system: TRANSLATION_SYSTEM_PROMPT,
      user: userMessage,
    });

    if (!response.success) {
      throw new Error(`Translation failed: ${response.error}`);
    }

    // Parse JSON response
    let result;
    try {
      const cleaned = response.text
        .replace(/```json/g, '').replace(/```/g, '').trim();
      result = JSON.parse(cleaned);
    } catch {
      const firstBrace = response.text.indexOf('{');
      const lastBrace = response.text.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        result = JSON.parse(response.text.slice(firstBrace, lastBrace + 1));
      } else {
        throw new Error('Failed to parse translation response');
      }
    }

    const responseTimeMs = Date.now() - startTime;

    // 2026-03-16: Voice field formatted for Siri "Speak Text" action.
    // Siri extracts this field and reads it aloud to the driver.
    const voice = `They said: ${result.translatedText}`;

    console.log(`[hooks/translate] ✅ ${result.detectedLang} → ${result.targetLang} in ${responseTimeMs}ms`);

    res.json({
      success: true,
      voice,
      translatedText: result.translatedText,
      detectedLang: result.detectedLang,
      targetLang: result.targetLang,
      confidence: result.confidence || 95,
      response_time_ms: responseTimeMs,
    });

  } catch (error) {
    const responseTimeMs = Date.now() - startTime;
    console.error(`[hooks/translate] ❌ Error (${responseTimeMs}ms):`, error.message);
    res.status(500).json({
      success: false,
      voice: 'Translation failed. Please try again.',
      error: error.message,
      response_time_ms: responseTimeMs,
    });
  }
});

export default router;
