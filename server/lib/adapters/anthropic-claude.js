// server/lib/adapters/anthropic-claude.js
export async function callClaude({ 
  apiKey = process.env.ANTHROPIC_API_KEY, 
  model = process.env.CLAUDE_MODEL === "claude-opus-4-1" ? "claude-opus-4-20250514" : (process.env.CLAUDE_MODEL || "claude-opus-4-20250514"), 
  system, 
  user, 
  max_tokens = 1200, 
  temperature = 0.3,
  thinking = null,  // "low", "medium", "high" for extended thinking
  abortSignal 
}) {
  const url = "https://api.anthropic.com/v1/messages";
  const body = {
    model, max_tokens, temperature,
    system, messages: [{ role: "user", content: user }]
  };
  
  // Add extended thinking if requested (requires Opus 4.1 and temperature must be 1.0)
  if (thinking && model.includes("opus-4-1")) {
    body.thinking = {
      type: "enabled",
      budget_tokens: thinking === "low" ? 1000 : thinking === "medium" ? 5000 : 10000
    };
    // Extended thinking requires temperature = 1.0
    body.temperature = 1.0;
  }
  
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": process.env.ANTHROPIC_API_VERSION || "2023-06-01",
      "x-api-key": apiKey
    },
    body: JSON.stringify(body),
    signal: abortSignal
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${errText}`);
  }
  const j = await res.json();
  
  // Model assertion: Ensure we got exactly what we requested (prevent silent swaps)
  if (j.model && j.model !== model) {
    console.error(`❌ Model mismatch: requested ${model}, got ${j.model}`);
    throw new Error(`Model mismatch: wanted ${model}, got ${j.model || 'none'}`);
  }
  
  const parts = j.content?.map(p => (p.text || "")).join("");
  return parts || "";
}
