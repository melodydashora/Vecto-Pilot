// server/lib/adapters/google-gemini.js
export async function callGemini({ apiKey = process.env.GOOGLE_MAPS_API_KEY, model = process.env.GEMINI_MODEL || "gemini-3-pro-preview", systemInstruction, user, max_output_tokens = 1024, temperature = 1.0, responseMimeType, abortSignal }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const generationConfig = { temperature, maxOutputTokens: max_output_tokens };
  
  // Add responseMimeType if provided (forces structured output)
  if (responseMimeType) {
    generationConfig.responseMimeType = responseMimeType;
  }
  
  const body = {
    systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: user }]}],
    generationConfig
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: abortSignal
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const j = await res.json();
  return j.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ?? "";
}
