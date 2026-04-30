// server/api/translate/translation-prompt.js
// Shared constants and utilities for translation endpoints
//
// 2026-03-17: Extracted from index.js and hooks/translate.js to eliminate
// duplicate system prompt and JSON parsing logic (CLAUDE.md Rule 9).

// Supported languages with display names for UI language selector.
// Priority: FIFA World Cup 2026 demographics (DFW market).
export const SUPPORTED_LANGUAGES = {
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
export const TRANSLATION_SYSTEM_PROMPT = `You are a real-time translator for a rideshare driver communicating with passengers.
Translate the given text between the specified languages. Output ONLY valid JSON, no markdown, no backticks.

Rules:
1. If sourceLang is "auto", detect the source language from the text.
2. Translate naturally — use conversational tone appropriate for a car ride, not formal/literary.
3. Keep translations concise and clear.
4. Preserve the meaning and tone of the original.

Output format:
{"translatedText":"...","detectedLang":"ISO 639-1 code","targetLang":"ISO 639-1 code","confidence":0-100}`;

/**
 * Parse a translation JSON response from the AI model.
 * Handles markdown-wrapped JSON and prose-embedded JSON gracefully.
 *
 * @param {string} responseText - Raw text from callModel()
 * @returns {{ translatedText: string, detectedLang: string, targetLang: string, confidence: number }}
 * @throws {Error} If JSON cannot be extracted
 */
export function parseTranslationResponse(responseText) {
  // 2026-04-09: Enhanced parser with 3-attempt fallback chain.
  // Gemini Flash sometimes returns markdown fences, prose preamble, or truncated JSON.

  // Attempt 1: Direct parse after stripping markdown fences
  try {
    const cleaned = responseText
      .replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch { /* fall through */ }

  // Attempt 2: Extract first JSON object from prose
  try {
    const firstBrace = responseText.indexOf('{');
    const lastBrace = responseText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(responseText.slice(firstBrace, lastBrace + 1));
    }
  } catch { /* fall through */ }

  // Attempt 3: Aggressive cleanup — strip markdown links, control chars, then retry
  try {
    let aggressive = responseText
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // [text](url) → text
      .replace(/\([^)]*\.(com|org|net|io)[^)]*\)/g, '') // (domain.com) fragments
      .replace(/```json/g, '').replace(/```/g, '')
      .replace(/[\x00-\x1f]/g, ' ')  // control chars → space
      .trim();
    const firstBrace = aggressive.indexOf('{');
    const lastBrace = aggressive.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(aggressive.slice(firstBrace, lastBrace + 1));
    }
  } catch { /* fall through */ }

  // Log the raw response for debugging before throwing
  console.error('[translate] All parse attempts failed. Raw response (first 300 chars):', responseText.substring(0, 300));
  throw new Error('Failed to parse translation response');
}
