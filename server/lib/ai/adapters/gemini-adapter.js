// server/lib/adapters/gemini-adapter.js
// Generic Gemini adapter - returns { ok, output } shape
// Updated 2026-01-05: Migrated to @google/genai SDK for Gemini 3 thinkingLevel support
// Updated 2026-01-06: Added streaming support via callGeminiStream()
// Updated 2026-02-15: F-002 fix — Enforce MODEL_QUIRKS thinkingLevel validation

import { GoogleGenAI } from "@google/genai";

/**
 * 2026-02-15: F-002 fix — Validate and normalize thinkingLevel for Gemini 3 models.
 * Gemini 3 Pro only supports LOW and HIGH (MEDIUM causes 400 errors).
 * Gemini 3 Flash supports LOW, MEDIUM, and HIGH.
 * Returns the validated level in UPPERCASE for consistency; callers
 * convert to lowercase for the SDK or keep uppercase for REST API.
 *
 * @param {string} model - The Gemini model name (e.g. "gemini-3-pro-preview")
 * @param {string|null} thinkingLevel - Requested thinking level
 * @returns {string|null} Validated thinking level (UPPERCASE) or null if disabled
 */
function validateThinkingLevel(model, thinkingLevel) {
  if (!thinkingLevel || !model.includes('gemini-3')) return null;

  const normalized = thinkingLevel.toUpperCase();

  // Flash models support all three levels
  if (model.includes('flash')) {
    const flashLevels = ['LOW', 'MEDIUM', 'HIGH'];
    if (!flashLevels.includes(normalized)) {
      console.warn(`[model/gemini] ⚠️ Invalid thinkingLevel "${thinkingLevel}" for ${model}. Valid: ${flashLevels.join(', ')}. Defaulting to LOW.`);
      return 'LOW';
    }
    return normalized;
  }

  // Pro models only support LOW and HIGH — MEDIUM is not valid
  const proLevels = ['LOW', 'HIGH'];
  if (!proLevels.includes(normalized)) {
    console.warn(`[model/gemini] ⚠️ thinkingLevel "${thinkingLevel}" is NOT supported on ${model} (Pro only supports LOW, HIGH). Auto-correcting to HIGH.`);
    return 'HIGH';
  }

  return normalized;
}

export async function callGemini({
  model,
  system,
  user,
  images = [],  // 2026-02-16: Optional multimodal images [{mimeType: "image/jpeg", data: "base64..."}]
  maxTokens,
  temperature,
  topP,
  topK,
  useSearch = false,
  thinkingLevel = null, // Gemini 3: "low", "medium" (Flash only), "high" - null = disabled
  skipJsonExtraction = false
}) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[model/gemini] ❌ GEMINI_API_KEY not configured');
      return { ok: false, error: 'GEMINI_API_KEY not configured' };
    }

    // WORKAROUND: The @google/genai SDK prioritizes GOOGLE_API_KEY from env over the apiKey passed in constructor
    // or emits a warning/error if both exist. We temporarily hide GOOGLE_API_KEY if it exists.
    const conflictingKey = process.env.GOOGLE_API_KEY;
    if (conflictingKey) {
      delete process.env.GOOGLE_API_KEY;
    }

    const ai = new GoogleGenAI({ apiKey });
    
    // Restore the key immediately for other services (Maps etc)
    if (conflictingKey) {
      process.env.GOOGLE_API_KEY = conflictingKey;
    }

    console.log(`[model/gemini] calling ${model} with max_tokens=${maxTokens}`);

    // Use lower temperature for JSON responses
    const expectsJson = user.toLowerCase().includes('json') ||
                        (system && system.toLowerCase().includes('json'));
    const finalTemperature = expectsJson ? 0.2 : (temperature || 0.7);

    // Build config object for new SDK
    const config = {
      maxOutputTokens: maxTokens,
      temperature: finalTemperature,
      ...(topP !== undefined && { topP }),
      ...(topK !== undefined && { topK }),
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
      ]
    };

    // 2026-02-15: F-002 fix — Validate thinkingLevel before applying.
    // Pro models only support LOW/HIGH; MEDIUM is Flash-only.
    const validatedLevel = validateThinkingLevel(model, thinkingLevel);
    if (validatedLevel) {
      config.thinkingConfig = {
        thinkingLevel: validatedLevel.toLowerCase() // SDK expects lowercase
      };
      console.log(`[model/gemini] 🧠 Thinking enabled: ${validatedLevel}`);
    }

    // Add Google Search if requested
    if (useSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    // Build contents with system instruction + optional images
    // 2026-02-16: Support multimodal vision via inlineData parts (Siri Vision shortcut)
    const parts = [];
    const textContent = system ? `${system}\n\n${user}` : user;
    parts.push({ text: textContent });

    if (images && images.length > 0) {
      for (const img of images) {
        parts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.data,
          }
        });
      }
      console.log(`[model/gemini] 🖼️ Attached ${images.length} image(s) for vision analysis`);
    }

    const contents = [{ role: "user", parts }];

    const result = await ai.models.generateContent({
      model,
      contents,
      config
    });

    // New SDK response: result.text or result.response.text()
    let output = (result?.text || result?.response?.text?.() || "").trim();

    // GEMINI CLEANUP: Remove markdown code blocks and wrapper text
    if (output) {
      const rawLength = output.length;
      
      // 2026-02-09: FIX - Only strip code blocks if they wrap the ENTIRE response
      // Prevents data loss when code blocks are embedded in documentation
      // Matches: start, optional whitespace, ```tag, content, ```, optional whitespace, end
      const codeBlockMatch = output.match(/^\s*```(?:\w+)?\s*([\s\S]*?)\s*```\s*$/);
      if (codeBlockMatch) {
        output = codeBlockMatch[1].trim();
        console.log(`[model/gemini] 🧹 Removed wrapping markdown code block (${rawLength} → ${output.length} chars)`);
      }

      if (user.toLowerCase().includes('json') && !skipJsonExtraction) {
        // 2026-02-09: FIX - Don't extract JSON if output looks like a Markdown doc
        // Prevents data loss for DOCS_GENERATOR requests that mention "json"
        const isMarkdown = output.trim().startsWith('#');
        
        if (!isMarkdown) {
          let jsonStart = -1;
          let jsonEnd = -1;
          let isArray = false;

          const arrayStart = output.indexOf('[');
          const objectStart = output.indexOf('{');

          if (arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)) {
            jsonStart = arrayStart;
            jsonEnd = output.lastIndexOf(']');
            isArray = true;
          } else if (objectStart !== -1) {
            jsonStart = objectStart;
            jsonEnd = output.lastIndexOf('}');
            isArray = false;
          }

          if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
            if (jsonStart > 0 || jsonEnd < output.length - 1) {
              const extracted = output.slice(jsonStart, jsonEnd + 1);
              try {
                JSON.parse(extracted);
                output = extracted;
                console.log(`[model/gemini] 🧹 Extracted JSON (${rawLength} → ${output.length} chars, ${isArray ? 'array' : 'object'})`);
              } catch (e) {
                console.warn(`[model/gemini] ⚠️ JSON extraction failed, keeping original output`);
              }
            }
          }
        } else {
           console.log(`[model/gemini] ℹ️ Output looks like Markdown, skipping JSON extraction`);
        }
      }
    }

    console.log("[model/gemini] resp:", {
      model,
      response: !!result?.response,
      len: output?.length ?? 0
    });

    return output
      ? { ok: true, output }
      : { ok: false, output: "", error: "Empty response from Gemini" };
  } catch (err) {
    console.error("[model/gemini] error:", err?.message || err);
    return { ok: false, output: "", error: err?.message || String(err) };
  }
}

/**
 * Streaming version of callGemini for chat/SSE use cases
 * 2026-01-06: Added to support adapter pattern for coach chat
 *
 * @param {Object} params - Same as callGemini plus messageHistory
 * @returns {Promise<Response>} - Fetch Response object with readable stream body
 */
// 2026-02-11: Added thinkingLevel parameter for Gemini 3 Pro streaming support
export async function callGeminiStream({
  model,
  system,
  messageHistory = [], // Array of { role: 'user'|'model', parts: [{ text }] }
  maxTokens,
  temperature,
  useSearch = false,
  thinkingLevel = null, // Gemini 3: "low", "high" - null = disabled
  timeoutMs = 90000
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  console.log(`[model/gemini-stream] Calling ${model} with ${messageHistory.length} messages, maxTokens=${maxTokens}`);

  // Build the request body
  const generationConfig = {
    temperature: temperature || 0.7,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: maxTokens || 8192,
  };

  // 2026-02-15: F-002 fix — Validate thinkingLevel before applying (matches callGemini).
  // Pro models only support LOW/HIGH; MEDIUM is Flash-only.
  const validatedStreamLevel = validateThinkingLevel(model, thinkingLevel);
  if (validatedStreamLevel) {
    generationConfig.thinkingConfig = {
      thinkingLevel: validatedStreamLevel // Already uppercase from validator; REST API expects uppercase
    };
    console.log(`[model/gemini-stream] 🧠 Thinking enabled: ${validatedStreamLevel}`);
  }

  const requestBody = {
    contents: messageHistory,
    generationConfig,
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
    ]
  };

  // Add system instruction if provided
  if (system) {
    requestBody.systemInstruction = {
      parts: [{ text: system }]
    };
  }

  // Add Google Search tool if requested
  if (useSearch) {
    requestBody.tools = [{ google_search: {} }];
  }

  // Create abort controller with timeout
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify(requestBody)
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[model/gemini-stream] API error ${response.status}: ${errText.substring(0, 200)}`);
      throw new Error(`Gemini API error ${response.status}: ${errText.substring(0, 100)}`);
    }

    console.log(`[model/gemini-stream] ✅ Stream started for ${model}`);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error(`[model/gemini-stream] Error: ${err.message}`);
    throw err;
  }
}