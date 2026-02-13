// server/lib/adapters/gemini-adapter.js
// Generic Gemini adapter - returns { ok, output } shape
// Updated 2026-01-05: Migrated to @google/genai SDK for Gemini 3 thinkingLevel support
// Updated 2026-01-06: Added streaming support via callGeminiStream()

import { GoogleGenAI } from "@google/genai";

export async function callGemini({
  model,
  system,
  user,
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

    // Gemini 3 Thinking support - ONLY if explicitly requested
    // thinkingLevel: "low", "medium" (Flash only), "high"
    // Note: Applying thinkingConfig to models that don't support it causes 400 errors
    if (thinkingLevel && model.includes('gemini-3')) {
      config.thinkingConfig = {
        thinkingLevel: thinkingLevel.toLowerCase() // SDK expects lowercase
      };
      console.log(`[model/gemini] 🧠 Thinking enabled: ${thinkingLevel}`);
    }

    // Add Google Search if requested
    if (useSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    // Build contents with system instruction
    const contents = system
      ? [
          { role: "user", parts: [{ text: `${system}\n\n${user}` }] }
        ]
      : [
          { role: "user", parts: [{ text: user }] }
        ];

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

  // 2026-02-11: Gemini 3 Thinking support for streaming (matches callGemini non-streaming)
  if (thinkingLevel && model.includes('gemini-3')) {
    generationConfig.thinkingConfig = {
      thinkingLevel: thinkingLevel.toUpperCase() // REST API expects uppercase (LOW, HIGH)
    };
    console.log(`[model/gemini-stream] 🧠 Thinking enabled: ${thinkingLevel}`);
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