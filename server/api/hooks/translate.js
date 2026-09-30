// server/api/hooks/translate.js
// Siri Shortcut translation endpoint for driver-rider communication
//
// 2026-03-16: Created for FIFA World Cup rider translation feature.
// Legacy public Siri hook. device_id is required metadata, not authentication.
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
import { translationLimiter } from '../../middleware/rate-limit.js';
// 2026-03-17: Shared constants extracted to eliminate duplication (Rule 9)
import {
  TRANSLATION_SYSTEM_PROMPT,
  parseTranslationResponse,
} from '../translate/translation-prompt.js';

// TODO(auth-hardening Item 7, deferred 2026-05-13): treatment (B), symmetric
// with analyze-offer.js — this router is intentionally left unauthenticated
// pending Siri Shortcut migration to user_id auth. Owner: Melody. The file
// deployed Shortcut does not currently attach a user token. Adding requireAuth here would break the
// live "Vecto Translate" Siri Shortcut Melody is actively demoing. The
// browser Translator and its dedicated API were retired at Melody's request
// on 2026-09-13. This independently used Siri hook remains; its identity migration
// remains a separate workstream. The follow-up workstream is tracked
// in claude_memory (session_id auth-hardening-pass-2026-05-13, tags
// auth-hardening + item-7 + deferred) on a parallel migration path to
// analyze-offer.js: migrate the Siri Shortcut to attach a per-user token,
// then layer requireAuth here in a separate commit.
const router = Router();

/**
 * POST /api/hooks/translate
 * Translate text for Siri Shortcuts (public legacy hook, no JWT)
 *
 * Request:  { text: string, device_id: string, target_lang?: string, source_lang?: string }
 * Response: { success, voice, translatedText, detectedLang, targetLang }
 */
router.post('/translate', translationLimiter, async (req, res) => {
  const startTime = Date.now();
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
  const onClose = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', onClose);

  try {
    const {
      text,
      device_id,
      target_lang = 'en',
      source_lang = 'auto',
    } = req.body || {};

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Missing text payload' });
    }

    if (typeof device_id !== 'string' || !device_id.trim()) {
      return res.status(400).json({ error: 'Missing device_id' });
    }

    const language = value => typeof value === 'string' && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value);
    if (text.length > 4000 || !language(target_lang) || (source_lang !== 'auto' && !language(source_lang))) {
      return res.status(400).json({ error: 'Invalid translation length or language' });
    }
    console.log(`[HOOKS] Translation request: ${text.length} characters (${source_lang} → ${target_lang})`);

    const userMessage = `Translate the following text.
Source language: ${source_lang === 'auto' ? 'detect automatically' : source_lang}
Target language: ${target_lang}

Text: "${text}"`;

    const response = await callModel('UTIL_TRANSLATION', {
      system: TRANSLATION_SYSTEM_PROMPT,
      user: userMessage,
      signal,
    });

    signal.throwIfAborted();
    if (!response.success) {
      throw new Error(`Translation failed: ${response.error}`);
    }

    const result = parseTranslationResponse(response.text);
    if (result.targetLang.toLowerCase() !== target_lang.toLowerCase()) {
      throw new Error('Translation returned a different target language');
    }

    const responseTimeMs = Date.now() - startTime;

    // 2026-03-16: Voice field formatted for Siri "Speak Text" action.
    // Siri extracts this field and reads it aloud to the driver.
    const voice = `They said: ${result.translatedText}`;

    console.log(`[HOOKS] ${result.detectedLang} → ${result.targetLang} in ${responseTimeMs}ms`);

    res.json({
      success: true,
      voice,
      translatedText: result.translatedText,
      detectedLang: result.detectedLang,
      targetLang: result.targetLang,
      confidence: result.confidence,
      response_time_ms: responseTimeMs,
    });

  } catch (error) {
    if (res.destroyed) return;
    if (signal.aborted) return res.status(controller.signal.aborted ? 499 : 504).json({ success: false, voice: 'Translation canceled.', error: 'Translation canceled or timed out' });
    const responseTimeMs = Date.now() - startTime;
    console.error(`[HOOKS] Error (${responseTimeMs}ms):`, error.message);
    res.status(500).json({
      success: false,
      voice: 'Translation failed. Please try again.',
      error: error.message,
      response_time_ms: responseTimeMs,
    });
  } finally {
    res.off('close', onClose);
  }
});

export default router;
