// server/lib/tts-handler.js
// Natural voice synthesis using OpenAI Text-to-Speech API

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 2026-03-17: Voice selection by language family. OpenAI TTS auto-detects
// language from input text, so the language param controls voice choice
// rather than language detection. "nova" produces clearer tonal pronunciation
// for CJK/Thai languages; "alloy" is the default for everything else.
const ASIAN_TONAL_LANGUAGES = new Set(['ja', 'ko', 'zh', 'th', 'vi']);

function selectVoice(language) {
  if (language && ASIAN_TONAL_LANGUAGES.has(language)) return 'nova';
  return 'alloy';
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
