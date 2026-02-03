// server/lib/adapters/openai-adapter.js
// Generic OpenAI adapter - returns { ok, output } shape
//
// 2026-01-05: Added callOpenAIWithWebSearch for GPT-5.2 web search capability
// Used by BRIEFING_NEWS_GPT role for parallel news fetching

import OpenAI from "openai";
import { aiLog, OP } from "../../../logger/workflow.js";

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

    // GPT-5 family model behavior:
    // - GPT-5.2: reasoning_effort only, NO temperature support
    // - GPT-5.2: reasoning_effort only, NO temperature support (only default=1 allowed)
    // - o1 models: reasoning_effort only, NO temperature support

    // Add reasoning_effort for models that support it
    if (reasoningEffort && (isGPT5Family || isO1Family)) {
      body.reasoning_effort = reasoningEffort;
    }

    // GPT-5 family and o1 models do NOT support custom temperature
    // Only add temperature for older GPT-4 models
    if (temperature !== undefined && !isGPT5Family && !isO1Family) {
      body.temperature = temperature;
    }

    const shortModel = model.split('-').slice(0, 2).join('-');
    aiLog.phase(1, `${shortModel} request (${maxTokens} tokens)`, OP.AI);

    const res = await client.chat.completions.create(body);

    const output = res?.choices?.[0]?.message?.content?.trim() || "";

    aiLog.done(1, `${shortModel} response (${output?.length ?? 0} chars)`, OP.AI);

    return output
      ? { ok: true, output }
      : { ok: false, output: "", error: "Empty response from OpenAI" };
  } catch (err) {
    aiLog.error(1, `OpenAI error`, err, OP.AI);
    return { ok: false, output: "", error: err?.message || String(err) };
  }
}

/**
 * Call OpenAI with web search using gpt-5-search-api model
 * 2026-01-05: Added for dual-model news fetching
 *
 * OpenAI web search uses dedicated search models (gpt-5-search-api)
 * rather than a tool in the tools array.
 * @see https://platform.openai.com/docs/guides/tools-web-search
 *
 * @param {Object} params
 * @param {string} params.model - Ignored, always uses gpt-5-search-api
 * @param {string} params.system - System prompt
 * @param {string} params.user - User prompt
 * @param {number} params.maxTokens - Max completion tokens
 * @param {string} [params.reasoningEffort='medium'] - Reasoning effort
 * @returns {Promise<{ok: boolean, output: string, error?: string, citations?: Array}>}
 */
export async function callOpenAIWithWebSearch({ model, system, user, maxTokens, reasoningEffort = 'medium' }) {
  try {
    const messages = [
      { role: "system", content: system },
      { role: "user", content: user }
    ];

    // Use gpt-5-search-api for web search (dedicated search model)
    // Regular gpt-5.2 doesn't support web_search tool in Chat Completions
    const searchModel = 'gpt-5-search-api';

    const body = {
      model: searchModel,
      messages,
      max_completion_tokens: maxTokens,
      // Configure web search behavior
      web_search_options: {
        search_context_size: "medium", // low, medium, high
        user_location: {
          type: "approximate",
          approximate: {
            country: "US"
          }
        }
      }
    };

    // NOTE: gpt-5-search-api does NOT support reasoning_effort parameter
    // Unlike regular gpt-5.2, the search model only accepts web_search_options
    // Removed: body.reasoning_effort = reasoningEffort;

    aiLog.phase(1, `${searchModel} web-search request (${maxTokens} tokens)`, OP.AI);

    const res = await client.chat.completions.create(body);

    // Extract content and any citations/sources from web search
    const choice = res?.choices?.[0];
    const output = choice?.message?.content?.trim() || "";

    // Extract web search annotations/citations if present
    const annotations = choice?.message?.annotations || [];
    const citations = annotations
      .filter(a => a.type === 'url_citation')
      .map(a => ({
        url: a.url,
        title: a.title || a.url,
        startIndex: a.start_index,
        endIndex: a.end_index
      }));

    aiLog.done(1, `${searchModel} web-search response (${output?.length ?? 0} chars, ${citations.length} citations)`, OP.AI);

    return output
      ? { ok: true, output, citations }
      : { ok: false, output: "", error: "Empty response from OpenAI web search" };
  } catch (err) {
    aiLog.error(1, `OpenAI web-search error`, err, OP.AI);
    return { ok: false, output: "", error: err?.message || String(err) };
  }
}
