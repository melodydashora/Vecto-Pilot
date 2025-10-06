// Google Gemini 2.5 Pro — v1beta generateContent
// Model ID from env: GEMINI_MODEL (default: gemini-2.5-pro)
// Temperature from env: GEMINI_TEMPERATURE (default: 0.2)
export async function callGeminiGenerateContent({
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || "gemini-2.5-pro",
  systemInstruction,
  userText,
  maxOutputTokens = parseInt(process.env.GEMINI_MAX_TOKENS || "2048"),
  temperature = parseFloat(process.env.GEMINI_TEMPERATURE || "0.2"),
  abortSignal
}) {
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
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
