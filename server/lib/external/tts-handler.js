// server/lib/tts-handler.js
// Natural voice synthesis using OpenAI Text-to-Speech API

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 2026-04-05: Expanded nova voice coverage (audit fix 1E).
// OpenAI TTS auto-detects language from input text. "nova" produces clearer
// pronunciation across most non-English languages — not just CJK/tonal.
// "alloy" is only used for English where it sounds most natural.
// Languages mapped to nova: all supported non-English languages.
const NOVA_LANGUAGES = new Set([
  'ja', 'ko', 'zh', 'th', 'vi',    // CJK + tonal (original)
  'ar', 'hi', 'ru',                  // Arabic, Hindi, Russian
  'de', 'fr', 'es', 'pt', 'it',     // European Romance + Germanic
  'tr', 'pl', 'uk', 'sv', 'sq',     // Turkish, Polish, Ukrainian, Swedish, Albanian
  'tl', 'id', 'ms',                  // Filipino, Indonesian, Malay
]);

function selectVoice(language) {
  if (language && NOVA_LANGUAGES.has(language)) return 'nova';
  return 'alloy'; // English and unknown languages
}

/**
 * Generate natural voice audio from text using OpenAI TTS
 * @param {string} text - Text to convert to speech
 * @param {string} [language] - Optional ISO 639-1 language code — used for voice selection
 * @returns {Promise<Buffer>} - MP3 audio buffer
 */
export async function synthesizeSpeech(text, language) {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid text for TTS');
  }

  const voice = selectVoice(language);

  try {
    console.log(`[TTS] Generating speech for ${text.length} characters (voice: ${voice}${language ? `, lang: ${language}` : ''})...`);

    const response = await client.audio.speech.create({
      model: "tts-1-hd",
      voice,
      input: text,
      response_format: "mp3",
      speed: 1.0
    });

    // Convert response to buffer
    const buffer = Buffer.from(await response.arrayBuffer());
    console.log(`[TTS] ✅ Generated ${buffer.length} bytes of audio`);
    
    return buffer;
  } catch (err) {
    console.error('[TTS] ❌ Speech synthesis failed:', err.message);
    throw new Error(`TTS failed: ${err.message}`);
  }
}
