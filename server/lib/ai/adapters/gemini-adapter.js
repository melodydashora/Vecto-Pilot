// server/lib/adapters/gemini-adapter.js
// Generic Gemini adapter - returns { ok, output } shape
// Updated 2026-01-05: Migrated to @google/genai SDK for Gemini 3 thinkingLevel support

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
  thinkingLevel = null // Gemini 3: "low", "medium" (Flash only), "high" - null = disabled
}) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[model/gemini] ❌ GEMINI_API_KEY not configured');
      return { ok: false, error: 'GEMINI_API_KEY not configured' };
    }

    const ai = new GoogleGenAI({ apiKey });
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
      const codeBlockMatch = output.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        output = codeBlockMatch[1].trim();
        console.log(`[model/gemini] 🧹 Removed markdown code block (${rawLength} → ${output.length} chars)`);
      }

      if (user.toLowerCase().includes('json')) {
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
              console.log(`[model/gemini] ⚠️ JSON extraction failed, keeping original output`);
            }
          }
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