// server/lib/adapters/openai-gpt4.js
// OpenAI GPT-4o/GPT-4-turbo — Fast completions with temperature support
// Much faster than GPT-5 reasoning models (3-10s vs 30-120s)
export async function callGPT4({ 
  apiKey = process.env.OPENAI_API_KEY, 
  model = "gpt-4o", // Default to fastest model
  system, 
  user, 
  messages,
  temperature = 0.7,
  max_tokens = 4000,
  response_format = null,
  abortSignal 
}) {
  const url = "https://api.openai.com/v1/chat/completions";
  
  // Build messages array if not provided
  let messageArray = messages;
  if (!messageArray) {
    messageArray = [];
    if (system) {
      messageArray.push({ role: "system", content: system });
    }
    if (user) {
      messageArray.push({ role: "user", content: user });
    }
  }
  
  const body = {
    model,
    messages: messageArray,
    temperature,
    max_tokens
  };
  
  // Add response format if specified (for JSON mode)
  if (response_format) {
    body.response_format = response_format;
  }
  
  console.log(`[GPT-4] Calling ${model} with temperature=${temperature}, max_tokens=${max_tokens}`);
  
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
  
  // Log usage for metrics
  if (j.usage) {
    console.log(`[GPT-4] Model: ${j.model} | Tokens: ${j.usage.prompt_tokens} input + ${j.usage.completion_tokens} output = ${j.usage.total_tokens} total`);
  }
  
  const msg = j.choices?.[0]?.message || {};
  
  // Extract content from response
  if (typeof msg.content === "string" && msg.content.trim()) {
    return msg.content;
  }
  
  // Refusal (safety filters)
  if (msg.refusal) {
    throw new Error(`GPT-4 refused: ${msg.refusal}`);
  }
  
  console.error('❌ No content in GPT-4 response:', JSON.stringify(j, null, 2));
  throw new Error("No content in completion response");
}
