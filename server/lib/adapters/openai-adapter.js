// server/lib/adapters/openai-adapter.js
// Generic OpenAI adapter - returns { ok, output } shape

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function callOpenAI({ model, system, user, maxTokens, temperature, reasoningEffort }) {
  try {
    const messages = [
      { role: "system", content: system },
      { role: "user", content: user }
    ];

    const body = {
      model,
      messages
    };

    // o1 models and gpt-5 family use max_completion_tokens, other models use max_tokens
    const isGPT5Family = model.startsWith("gpt-5");
    const isO1Family = model.startsWith("o1-");
    const useCompletionTokens = isGPT5Family || isO1Family;
    
    if (useCompletionTokens) {
      body.max_completion_tokens = maxTokens;
    } else {
      body.max_tokens = maxTokens;
    }

    // GPT-5.1 does NOT support temperature - use reasoning_effort only
    // o1 models also use reasoning_effort, not temperature
    const isGPT51 = model.includes('gpt-5.1');
    if (reasoningEffort && (isGPT5Family || isO1Family)) {
      body.reasoning_effort = reasoningEffort;
      // CRITICAL: Don't set temperature for GPT-5.1 or o1 models (API will reject it)
    } else if (!isGPT51 && temperature !== undefined) {
      body.temperature = temperature;
    }

    const tokenParam = useCompletionTokens ? 'max_completion_tokens' : 'max_tokens';
    console.log(`[model/openai] calling ${model} with ${tokenParam}=${maxTokens} (gpt-5-family=${isGPT5Family}, o1-family=${isO1Family})`);

    const res = await client.chat.completions.create(body);

    const output = res?.choices?.[0]?.message?.content?.trim() || "";

    console.log("[model/openai] resp:", {
      model,
      choices: !!res?.choices,
      len: output?.length ?? 0
    });

    return output
      ? { ok: true, output }
      : { ok: false, output: "", error: "Empty response from OpenAI" };
  } catch (err) {
    console.error("[model/openai] error:", err?.message || err);
    return { ok: false, output: "", error: err?.message || String(err) };
  }
}
