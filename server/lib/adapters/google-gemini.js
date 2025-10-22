// server/lib/adapters/google-gemini.js
export async function callGemini({ apiKey = process.env.GEMINI_API_KEY, model = "gemini-2.5-pro", systemInstruction, user, max_output_tokens = 1024, temperature = 0.1, abortSignal }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: user }]}],
    generationConfig: { temperature, maxOutputTokens: max_output_tokens }
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
