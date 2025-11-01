// server/lib/adapters/gemini-adapter.js
// Generic Gemini adapter - returns { ok, output } shape

import { GoogleGenerativeAI } from "@google/generative-ai";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function callGemini({ model, system, user, maxTokens, temperature, topP, topK }) {
  try {
    console.log(`[model/gemini] calling ${model} with max_tokens=${maxTokens}`);

    const generativeModel = genAI.getGenerativeModel({
      model,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
        ...(topP !== undefined && { topP }),
        ...(topK !== undefined && { topK }),
        responseMimeType: "text/plain"
      }
    });

    const result = await generativeModel.generateContent({
      contents: [{ role: "user", parts: [{ text: user }] }]
    });

    const output = result?.response?.text()?.trim() || "";

    console.log("[model/gemini] resp:", {
      model,
      response: !!result?.response,
      len: output?.length ?? 0
    });

    return output
      ? { ok: true, output }
      : { ok: false, output: "" };
  } catch (err) {
    console.error("[model/gemini] error:", err?.message || err);
    return { ok: false, output: "" };
  }
}
