// server/lib/adapters/openai-gpt5.js
// OpenAI GPT-5 — Chat Completions API with reasoning effort
// Model from env: OPENAI_MODEL (default: gpt-5)
// Reasoning effort from env: GPT5_REASONING_EFFORT (default: high)
export async function callGPT5({ 
  apiKey = process.env.OPENAI_API_KEY, 
  model = process.env.OPENAI_MODEL || "gpt-5", 
  system, 
  user, 
  messages,
  developer, // GPT-5 supports 'developer' role (stronger than 'system')
  reasoning_effort,
  max_completion_tokens,
  abortSignal 
}) {
  const url = "https://api.openai.com/v1/chat/completions";
  
  // Build messages array if not provided
  let messageArray = messages;
  if (!messageArray) {
    messageArray = [];
    if (developer) {
      messageArray.push({ role: "developer", content: developer });
    } else if (system) {
      messageArray.push({ role: "system", content: system });
    }
    messageArray.push({ role: "user", content: user });
  }
  
  // Effort from params or environment only - no hardcoded defaults
  // If reasoning_effort is explicitly 'none', disable thinking by omitting the parameter
  const effort = reasoning_effort === 'none' ? null : (reasoning_effort || process.env.OPENAI_REASONING_EFFORT || process.env.GPT5_REASONING_EFFORT);
  
  // Token allocation from environment only - no hardcoded defaults
  const envMax = Number(process.env.OPENAI_MAX_COMPLETION_TOKENS || process.env.OPENAI_MAX_TOKENS || 0);
  const requested = Number(max_completion_tokens || envMax);
  const tokens = Math.max(16, requested || 512); // Minimum 16 tokens for safety
  
  // Build request body - conditionally include reasoning_effort only if specified
  const body = {
    model,
    messages: messageArray,
    max_completion_tokens: tokens,
    ...(effort ? { reasoning_effort: effort } : {}) // Only include if not null/undefined
    // Note: GPT-5 reasoning models do NOT support: temperature, top_p, response_format, 
    // presence_penalty, frequency_penalty, logprobs, logit_bias
  };
  
  console.log(`[GPT-5] Calling ${model} with reasoning_effort=${effort || 'DISABLED'}, max_completion_tokens=${tokens}`);
  
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
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${err}`);
  }
  
  const j = await res.json();
  
  // Model family check: ensure response model starts with requested family
  if (!j?.model || !String(j.model).startsWith(model)) {
    throw new Error(`OpenAI model mismatch: wanted family ${model}, got ${j?.model || "none"}`);
  }
  
  // Log snapshot and usage for ops/metrics
  try { 
    console.info("[openai]", { snapshot: j.model, usage: j.usage }); 
  } catch {}
  
  // Enhanced token logging including reasoning tokens
  if (j.usage) {
    const reasoningTokens = j.usage.completion_tokens_details?.reasoning_tokens || 0;
    const outputTokens = (j.usage.completion_tokens || 0) - reasoningTokens;
    console.log(`[GPT-5] Model: ${j.model} | Tokens: ${j.usage.prompt_tokens} input + ${reasoningTokens} reasoning + ${outputTokens} output = ${j.usage.total_tokens} total`);
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
