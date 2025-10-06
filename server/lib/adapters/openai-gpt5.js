// server/lib/adapters/openai-gpt5.js
// OpenAI GPT-5 — Chat Completions API with reasoning effort
// Model from env: OPENAI_MODEL (default: gpt-5)
// Reasoning effort from env: GPT5_REASONING_EFFORT (default: high)
export async function callGPT5({ 
  apiKey = process.env.OPENAI_API_KEY, 
  model = process.env.OPENAI_MODEL || "gpt-5", 
  system, 
  user, 
  developer, // GPT-5 supports 'developer' role (stronger than 'system')
  reasoning_effort = process.env.GPT5_REASONING_EFFORT || "high", // "minimal", "low", "medium", "high"
  max_completion_tokens = parseInt(process.env.OPENAI_MAX_TOKENS || "32000"), 
  abortSignal 
}) {
  const url = "https://api.openai.com/v1/chat/completions";
  
  // Build messages array - use developer role if provided, otherwise system
  const messages = [];
  if (developer) {
    messages.push({ role: "developer", content: developer });
  } else if (system) {
    messages.push({ role: "system", content: system });
  }
  messages.push({ role: "user", content: user });
  
  const body = {
    model,
    messages,
    max_completion_tokens,
    reasoning_effort
    // Note: GPT-5 reasoning models do NOT support: temperature, top_p, response_format, 
    // presence_penalty, frequency_penalty, logprobs, logit_bias
  };
  
  console.log(`[GPT-5] Calling ${model} with reasoning_effort=${reasoning_effort}, max_completion_tokens=${max_completion_tokens}`);
  
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body),
    signal: abortSignal
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenAI ${res.status}: ${errorText}`);
  }
  
  const j = await res.json();
  
  // Log token usage including reasoning tokens
  if (j.usage) {
    const reasoningTokens = j.usage.completion_tokens_details?.reasoning_tokens || 0;
    const outputTokens = (j.usage.completion_tokens || 0) - reasoningTokens;
    console.log(`[GPT-5] Tokens: ${j.usage.prompt_tokens} input + ${reasoningTokens} reasoning + ${outputTokens} output = ${j.usage.total_tokens} total`);
  }
  
  const msg = j.choices?.[0]?.message || {};
  
  // Extract content from response
  // 1) Standard content field (string)
  if (typeof msg.content === "string" && msg.content.trim()) {
    return msg.content;
  }
  
  // 2) Structured output path (if using beta.chat.completions.parse)
  if (msg.parsed) {
    return JSON.stringify(msg.parsed);
  }
  
  // 3) Array content (some responses)
  if (Array.isArray(msg.content)) {
    const text = msg.content.map(p => p?.text || "").join("");
    if (text.trim()) {
      return text;
    }
  }
  
  // 4) Refusal (safety filters)
  if (msg.refusal) {
    throw new Error(`GPT-5 refused: ${msg.refusal}`);
  }
  
  console.error('❌ No content in GPT-5 response:', JSON.stringify(j, null, 2));
  throw new Error("No content in completion response");
}
