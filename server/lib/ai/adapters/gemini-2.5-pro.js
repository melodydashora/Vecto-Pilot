// Google Gemini Adapter — v1beta generateContent
// Updated 2026-01-05: Now uses gemini-3-pro-preview by default
// Model ID from env: GEMINI_MODEL (default: gemini-3-pro-preview)
// Temperature from env: GEMINI_TEMPERATURE (default: 0.2)
//
// NOTE: File name kept as gemini-2.5-pro.js for backward compatibility
// with venue-event-verifier.js imports. Consider renaming in future cleanup.
export async function callGeminiGenerateContent({
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL,
  systemInstruction,
  userText,
  maxOutputTokens = parseInt(process.env.GEMINI_MAX_TOKENS || "2048"),
  temperature = parseFloat(process.env.GEMINI_TEMPERATURE || "0.2"),
  abortSignal
}) {
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  if (!model) throw new Error("Missing GEMINI_MODEL environment variable");
  // FIX: API key in URL as query parameter, no x-goog-api-key header needed
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    systemInstruction: systemInstruction ? { role: "system", parts: [{ text: systemInstruction }] } : undefined,
    contents: [{ role: "user", parts: [{ text: userText }]}],
    generationConfig: {
      maxOutputTokens,
      temperature,
      responseMimeType: "application/json"
    }
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: abortSignal
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text().catch(()=> "")}`);
  const j = await res.json();
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const txt = parts.map(p => p?.text || "").join("").trim();
  return txt.replace(/```json\s*([\s\S]*?)```/gi, "$1").trim();
}
