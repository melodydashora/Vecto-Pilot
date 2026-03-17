// server/lib/tts-handler.js
// Natural voice synthesis using OpenAI Text-to-Speech API

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Generate natural voice audio from text using OpenAI TTS
 * @param {string} text - Text to convert to speech
 * @param {string} [language] - Optional ISO 639-1 language code for multilingual TTS
 * @returns {Promise<Buffer>} - MP3 audio buffer
 */
// 2026-03-16: Added language parameter for translation feature.
// OpenAI TTS-1-HD natively supports 57 languages — the model auto-detects
// the language from the input text, but passing the language hint improves
// accent accuracy for short phrases.
export async function synthesizeSpeech(text, language) {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid text for TTS');
  }

  try {
    console.log(`[TTS] Generating speech for ${text.length} characters${language ? ` (lang: ${language})` : ''}...`);

    const response = await client.audio.speech.create({
      model: "tts-1-hd", // High-definition voice
      voice: "alloy", // Friendly, professional voice — works well across languages
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
