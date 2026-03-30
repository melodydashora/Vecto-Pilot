// Anthropic Claude Sonnet 4.5 (2025-09-29) — Raw HTTP Messages API
// Model from env: ANTHROPIC_MODEL (required)
// Temperature from env: ANTHROPIC_TEMPERATURE (default: 0.2)
export async function callClaude45Raw({
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = process.env.ANTHROPIC_MODEL,
  system,
  user,
  max_tokens = parseInt(process.env.ANTHROPIC_MAX_TOKENS || "64000"),
  temperature = parseFloat(process.env.ANTHROPIC_TEMPERATURE || "0.2"),
  abortSignal
}) {
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  if (!model) throw new Error("Missing ANTHROPIC_MODEL environment variable");
  const body = {
    model,
    max_tokens,
    temperature,
    system,
    messages: [{ role: "user", content: user }]
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey
    },
    body: JSON.stringify(body),
    signal: abortSignal
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text().catch(()=> "")}`);
  const j = await res.json();
  const txt = (j?.content || []).map(p => p?.text || "").join("").trim();
  return txt.replace(/```json\s*([\s\S]*?)```/gi, "$1").trim();
}
