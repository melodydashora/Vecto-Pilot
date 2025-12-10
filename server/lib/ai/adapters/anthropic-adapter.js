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

/**
 * Call Anthropic with web search tool enabled
 * Uses the built-in web_search tool for grounded responses
 * @param {Object} params - { model, system, user, maxTokens, temperature }
 * @returns {Promise<{ok: boolean, output: string, citations?: array}>}
 */
export async function callAnthropicWithWebSearch({ model, system, user, maxTokens, temperature }) {
  try {
    console.log(`[model/anthropic-web] calling ${model} with web_search tool, max_tokens=${maxTokens}`);

    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: "user", content: user }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5
        }
      ]
    });

    // Extract text from response (may have tool_use blocks interspersed)
    let output = "";
    const citations = [];

    for (const block of res?.content || []) {
      if (block.type === "text") {
        output += block.text;
        // Extract citations if present
        if (block.citations) {
          citations.push(...block.citations);
        }
      }
    }

    output = output.trim();

    console.log("[model/anthropic-web] resp:", {
      model,
      content: !!res?.content,
      len: output?.length ?? 0,
      citations: citations.length,
      stop_reason: res?.stop_reason
    });

    return output
      ? { ok: true, output, citations }
      : { ok: false, output: "", error: "Empty response from Anthropic" };
  } catch (err) {
    console.error("[model/anthropic-web] error:", err?.message || err);
    return { ok: false, output: "", error: err?.message || String(err) };
  }
}
