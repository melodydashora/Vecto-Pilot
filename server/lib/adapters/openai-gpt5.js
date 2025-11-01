// server/lib/adapters/openai-gpt5.js
// OpenAI GPT-5 — Chat Completions API with reasoning effort
// Model from env: OPENAI_MODEL (required)
// Reasoning effort from env: OPENAI_REASONING_EFFORT (default: medium)
export async function callGPT5({ 
  apiKey = process.env.OPENAI_API_KEY, 
  model = process.env.OPENAI_MODEL, 
  system, 
  user, 
  messages,
  developer, // GPT-5 supports 'developer' role (stronger than 'system')
  reasoning_effort,
  temperature,
  max_completion_tokens = 16000,
  abortSignal 
}) {
  if (!model) throw new Error("Missing OPENAI_MODEL environment variable");
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

  // Effort fallback: param > env > "medium"
  const effort = reasoning_effort || process.env.OPENAI_REASONING_EFFORT || "medium";

  // Token floor: ensure minimum 16 tokens
  const envMax = Number(process.env.OPENAI_MAX_COMPLETION_TOKENS || 0);
  const requested = Number(max_completion_tokens || envMax || 512);
  const tokens = Math.max(16, requested);

  const body = {
    model,
    messages: messageArray,
    max_completion_tokens: tokens,
  };

  // GPT-5 only supports default temperature (1.0) - skip temperature/top_p for gpt-5 models
  // Use either temperature or reasoning_effort, not both
  if (temperature !== undefined && !model.startsWith("gpt-5")) {
    body.temperature = temperature;
  } else if (reasoning_effort !== undefined) {
    body.reasoning_effort = reasoning_effort;
  }

  // Log what sampling strategy is being used
  let samplingStrategy;
  if (model.startsWith("gpt-5")) {
    samplingStrategy = "default temperature (1.0)";
  } else if (temperature !== undefined) {
    samplingStrategy = `temperature=${temperature}`;
  } else {
    samplingStrategy = `reasoning_effort=${effort}`;
  }
  
  console.log(`[GPT-5] Calling ${model} with ${samplingStrategy}, max_completion_tokens=${tokens}`);

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

    // Classify error types for better handling
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      // Gateway/proxy errors (Cloudflare, load balancer) - transient provider issue
      const errorType = err.includes('cloudflare') ? 'Cloudflare Gateway' : 'Provider Gateway';
      throw new Error(`OpenAI ${errorType} Error (${res.status}): Temporary provider issue - retry may succeed`);
    } else if (res.status === 429) {
      throw new Error(`OpenAI Rate Limit (429): Too many requests - back off and retry`);
    } else if (res.status >= 500) {
      throw new Error(`OpenAI Server Error (${res.status}): Provider internal error - ${err.substring(0, 200)}`);
    } else if (res.status === 401 || res.status === 403) {
      throw new Error(`OpenAI Auth Error (${res.status}): Check API key configuration`);
    } else {
      throw new Error(`OpenAI ${res.status}: ${err}`);
    }
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
  const tokenMetadata = {
    total_tokens: j.usage?.total_tokens || 0,
    prompt_tokens: j.usage?.prompt_tokens || 0,
    completion_tokens: j.usage?.completion_tokens || 0,
    reasoning_tokens: j.usage?.completion_tokens_details?.reasoning_tokens || 0
  };
  
  if (j.usage) {
    const outputTokens = tokenMetadata.completion_tokens - tokenMetadata.reasoning_tokens;
    console.log(`[GPT-5] Model: ${j.model} | Tokens: ${tokenMetadata.prompt_tokens} input + ${tokenMetadata.reasoning_tokens} reasoning + ${outputTokens} output = ${tokenMetadata.total_tokens} total`);
  }

  const msg = j.choices?.[0]?.message || {};

  // Extract content from response
  // 1) Standard content field (string)
  if (typeof msg.content === "string" && msg.content.trim()) {
    return {
      text: msg.content,
      ...tokenMetadata
    };
  }

  // 2) Structured output path (if using beta.chat.completions.parse)
  if (msg.parsed) {
    return {
      text: JSON.stringify(msg.parsed),
      ...tokenMetadata
    };
  }

  // 3) Array content (some responses)
  if (Array.isArray(msg.content)) {
    const text = msg.content.map(p => p?.text || "").join("");
    if (text.trim()) {
      return {
        text,
        ...tokenMetadata
      };
    }
  }

  // 4) Refusal (safety filters)
  if (msg.refusal) {
    throw new Error(`GPT-5 refused: ${msg.refusal}`);
  }

  console.error('❌ No content in GPT-5 response:', JSON.stringify(j, null, 2));
  throw new Error("No content in completion response");
}