// server/lib/adapters/anthropic-adapter.js
// Generic Anthropic adapter - returns { ok, output } shape

import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function callAnthropic({ model, system, user, maxTokens, temperature }) {
  try {
    console.log(`[model/anthropic] calling ${model} with max_tokens=${maxTokens}`);

    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: "user", content: user }]
    });

    const output = res?.content?.[0]?.text?.trim() || "";

    console.log("[model/anthropic] resp:", {
      model,
      content: !!res?.content,
      len: output?.length ?? 0
    });

    return output
      ? { ok: true, output }
      : { ok: false, output: "", error: "Empty response from Anthropic" };
  } catch (err) {
    console.error("[model/anthropic] error:", err?.message || err);
    return { ok: false, output: "", error: err?.message || String(err) };
  }
}
