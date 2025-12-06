// server/lib/adapters/gemini-adapter.js
// Generic Gemini adapter - returns { ok, output } shape

import { GoogleGenerativeAI } from "@google/generative-ai";
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_MAPS_API_KEY);

export async function callGemini({ model, system, user, maxTokens, temperature, topP, topK }) {
  try {
    console.log(`[model/gemini] calling ${model} with max_tokens=${maxTokens}`);

    // Detect if JSON response is expected (prompt contains "JSON" or "json")
    const expectsJson = user.toLowerCase().includes('json') || 
                        (system && system.toLowerCase().includes('json'));
    
    // ISSUE #16 FIX: Set temperature to 0.2 for structured data (JSON)
    const finalTemperature = expectsJson ? 0.2 : (temperature || 0.7);
    
    const generativeModel = genAI.getGenerativeModel({
      model,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: finalTemperature,
        ...(topP !== undefined && { topP }),
        ...(topK !== undefined && { topK }),
        // ISSUE #16 FIX: Force JSON format for structured responses
        responseMimeType: expectsJson ? "application/json" : "text/plain"
      },
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
      // ISSUE #16 FIX: Enable Google Search tool for real-time data
      tools: [{ googleSearch: {} }]
    });

    let output = result?.response?.text()?.trim() || "";

    // GEMINI CLEANUP: Remove markdown code blocks and wrapper text
    if (output) {
      const rawLength = output.length;
      
      // Strategy 1: Remove markdown code blocks (```json ... ``` or ``` ... ```)
      const codeBlockMatch = output.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        output = codeBlockMatch[1].trim();
        console.log(`[model/gemini] 🧹 Removed markdown code block (${rawLength} → ${output.length} chars)`);
      }
      
      // Strategy 2: If prompt asks for JSON, extract {...} objects or [...] arrays
      if (user.toLowerCase().includes('json')) {
        let jsonStart = -1;
        let jsonEnd = -1;
        let isArray = false;
        
        // Look for array first [...], then object {...}
        const arrayStart = output.indexOf('[');
        const objectStart = output.indexOf('{');
        
        if (arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)) {
          // Array comes first
          jsonStart = arrayStart;
          jsonEnd = output.lastIndexOf(']');
          isArray = true;
        } else if (objectStart !== -1) {
          // Object comes first (or only option)
          jsonStart = objectStart;
          jsonEnd = output.lastIndexOf('}');
          isArray = false;
        }
        
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          // Only extract if there's wrapper text (not already pure JSON)
          if (jsonStart > 0 || jsonEnd < output.length - 1) {
            const extracted = output.slice(jsonStart, jsonEnd + 1);
            // Validate it's actually JSON before replacing
            try {
              JSON.parse(extracted);
              output = extracted;
              console.log(`[model/gemini] 🧹 Extracted JSON (${rawLength} → ${output.length} chars, ${isArray ? 'array' : 'object'})`);
            } catch (e) {
              // Not valid JSON, keep original
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
