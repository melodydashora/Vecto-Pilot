
// server/lib/adapters/gemini-adapter.js
// Generic Gemini adapter - returns { ok, output } shape

import { GoogleGenerativeAI } from "@google/generative-ai";

export async function callGemini({ 
  model, 
  system, 
  user, 
  maxTokens, 
  temperature, 
  topP, 
  topK, 
  useSearch = false,
  thinkingLevel = "HIGH" // Default to HIGH for Gemini 3
}) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[model/gemini] ❌ GEMINI_API_KEY not configured');
      return { ok: false, error: 'GEMINI_API_KEY not configured' };
    }
    
    const genAI = new GoogleGenerativeAI(apiKey);
    console.log(`[model/gemini] calling ${model} with max_tokens=${maxTokens}`);

    // Use lower temperature for JSON responses
    const expectsJson = user.toLowerCase().includes('json') || 
                        (system && system.toLowerCase().includes('json'));
    const finalTemperature = expectsJson ? 0.2 : (temperature || 0.7);
    
    // Construct generation config
    const generationConfig = {
      maxOutputTokens: maxTokens,
      temperature: finalTemperature,
      ...(topP !== undefined && { topP }),
      ...(topK !== undefined && { topK }),
    };

    // ADDED: Support for Gemini 3.0 Thinking (Only for gemini-3-* models)
    if (model.includes('gemini-3')) {
      generationConfig.thinkingConfig = {
        thinkingLevel: thinkingLevel // "HIGH" or "LOW"
      };
    }

    const generativeModel = genAI.getGenerativeModel({
      model,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig,
      // ISSUE #16 FIX: Disable safety filters to prevent blocking traffic/event data
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    });

    const result = await generativeModel.generateContent({
      contents: [{ role: "user", parts: [{ text: user }] }],
      // CORRECT: Use 'googleSearch' (camelCase) for the JS SDK
      ...(useSearch && { tools: [{ googleSearch: {} }] })
    });

    let output = result?.response?.text()?.trim() || "";

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
