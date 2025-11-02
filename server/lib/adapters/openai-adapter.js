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

    // o1 models use max_completion_tokens, other models use max_tokens
    if (model.startsWith("o1-") || model === "gpt-5") {
      body.max_completion_tokens = maxTokens;
    } else {
      body.max_tokens = maxTokens;
    }

    // Add temperature or reasoning_effort (not both for o1 models)
    if (reasoningEffort) {
      body.reasoning_effort = reasoningEffort;
    } else if (temperature !== undefined) {
      body.temperature = temperature;
    }

    console.log(`[model/openai] calling ${model} with max_tokens=${maxTokens}`);

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
