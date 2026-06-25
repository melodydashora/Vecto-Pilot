// server/lib/adapters/anthropic-adapter.js
// Generic Anthropic adapter - returns { ok, output } shape

import Anthropic from "@anthropic-ai/sdk";
import { hasQuirk } from "../model-registry.js";

// 2026-04-28 (Phase A of log format merge plan): gate per-call adapter logs
// behind LOG_LEVEL=debug. Adapter-level [AI] noise (model names, raw resp
// shapes) leaks into the primary stream and duplicates caller-side emits.
// Errors and warnings stay visible at all levels.
function _aiDebug(...args) {
  if (String(process.env.LOG_LEVEL || 'info').toLowerCase() === 'debug') console.log(...args);
}

let client;

function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("Missing ANTHROPIC_API_KEY in environment variables");
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function callAnthropic({ model, system, user, messages, maxTokens, temperature }) {
  try {
    const anthropic = getClient();
    _aiDebug(`[AI] calling ${model} with max_tokens=${maxTokens}`);

    // Allow passing full messages array (for chat history) OR simple user string
    const finalMessages = messages || [{ role: "user", content: user }];

    // 2026-05-29: Opus 4.8 deprecates the `temperature` parameter — sending it
    // returns HTTP 400 ("`temperature` is deprecated for this model"). Gate it
    // behind the noTemperature quirk (MODEL_QUIRKS in model-registry.js), mirroring
    // the GPT-5 / o-series handling in openai-adapter.js. Older Claude models
    // (opus 4.7, haiku 4.5) keep temperature.
    const createParams = {
      model,
      max_tokens: maxTokens,
      system,
      messages: finalMessages
    };
    if (temperature !== undefined && !hasQuirk(model, 'noTemperature')) {
      createParams.temperature = temperature;
    }

    const res = await anthropic.messages.create(createParams);

    const output = res?.content?.[0]?.text?.trim() || "";

    _aiDebug("[AI] resp:", {
      model,
      content: !!res?.content,
      len: output?.length ?? 0
    });

    return output
      ? { ok: true, output }
      : { ok: false, output: "", error: "Empty response from Anthropic" };
  } catch (err) {
    console.error("[AI] error:", err?.message || err);
    return { ok: false, output: "", error: err?.message || String(err) };
  }
}

/**
 * Call Anthropic with web search tool enabled
 * Uses the built-in web_search tool for grounded responses
 * @param {Object} params - { model, system, user, maxTokens, temperature, jsonMode }
 * @returns {Promise<{ok: boolean, output: string, citations?: array}>}
 *
 * Engineering note (web tools, captured Dec 2025 prior-assistant findings before
 * its 2025-12-30 deprecation; preserved here so the knowledge outlives the notes):
 *
 *   - If web_fetch is needed alongside web_search, the API request must include
 *     the beta header `anthropic-beta: web-fetch-2025-09-10` AND the additional
 *     tool `{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: N }`.
 *   - Web tools (web_search and web_fetch) empirically require Claude Opus
 *     (claude-opus-4-5-20251101 at the time of the finding), not Sonnet —
 *     Sonnet 4.5 returned errors when web tools were enabled in prior testing.
 *   - Current implementation below uses web_search only, without the web-fetch
 *     beta header. To enable web_fetch, route through the SDK's
 *     `beta.messages.create` or pass the beta header via `defaultHeaders`.
 */
// 2026-05-08: jsonMode default changed from true → false. Opus 4.6+ rejects
// assistant message prefill (the mechanism jsonMode used to force `[` start).
// Callers needing JSON output should use system-prompt instructions instead.
export async function callAnthropicWithWebSearch({ model, system, user, maxTokens, temperature, jsonMode = false }) {
  try {
    _aiDebug(`[AI] calling ${model} with web_search tool, max_tokens=${maxTokens}, jsonMode=${jsonMode}`);

    // Build messages - use assistant prefill to force JSON when jsonMode is enabled
    const messages = [{ role: "user", content: user }];

    // Assistant prefill forces Claude to continue with JSON array format
    if (jsonMode) {
      messages.push({ role: "assistant", content: "[" });
    }

    const anthropic = getClient();
    // 2026-05-29: gate `temperature` behind the noTemperature quirk (opus 4.8 rejects it).
    const createParams = {
      model,
      max_tokens: maxTokens,
      system,
      messages,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5
        }
      ]
    };
    if (temperature !== undefined && !hasQuirk(model, 'noTemperature')) {
      createParams.temperature = temperature;
    }
    const res = await anthropic.messages.create(createParams);

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

    // If we used assistant prefill, prepend the opening bracket
    if (jsonMode) {
      output = "[" + output;
    }

    _aiDebug("[AI] resp:", {
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
    console.error("[AI] error:", err?.message || err);
    return { ok: false, output: "", error: err?.message || String(err) };
  }
}
