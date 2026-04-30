// server/lib/adapters/openai-adapter.js
// Generic OpenAI adapter - returns { ok, output } shape
//
// 2026-01-05: Added callOpenAIWithWebSearch for GPT-5.2 web search capability
// Used by BRIEFING_NEWS_GPT role for parallel news fetching
// 2026-04-28 (Phase A of log format merge plan): MOCK-client diagnostics gated
//   behind LOG_LEVEL=debug. The aiLog.phase/done emits below remain at info for
//   now — Phase B will address model-name leakage in those callsites.

import OpenAI from "openai";
import { aiLog, chainLog, OP } from "../../../logger/workflow.js";

// 2026-04-30: chain-aware logging — derive {parent, sub} from the role passed
// down from callModel(role, ...) so adapter logs match the workflow chain on
// the LEFT (e.g. [BRIEFING] [TRAFFIC] [AI] gpt-5-search-api request) instead
// of orphan [AI] lines. Non-canonical roles (or direct adapter calls outside
// the role-routed path) fall back to plain aiLog.
function chainFromRole(role) {
  if (!role || typeof role !== 'string') return null;
  // Special case: AI_COACH should chain as [COACH], not [AI] [COACH]
  if (role === 'AI_COACH') return { parent: 'COACH' };
  const idx = role.indexOf('_');
  if (idx === -1) return { parent: role };
  return { parent: role.slice(0, idx), sub: role.slice(idx + 1) };
}

function logAiRequest(role, message) {
  const chain = chainFromRole(role);
  if (chain) {
    chainLog({ ...chain, callTypes: ['AI'] }, message);
  } else {
    aiLog.phase(1, message, OP.AI);
  }
}

function logAiDone(role, message) {
  const chain = chainFromRole(role);
  if (chain) {
    chainLog({ ...chain, callTypes: ['AI'] }, message);
  } else {
    aiLog.done(1, message, OP.AI);
  }
}

function logAiError(role, message, err) {
  const chain = chainFromRole(role);
  if (chain) {
    chainLog({ ...chain, callTypes: ['AI'] }, `${message}: ${err?.message || err}`, { level: 'error' });
  } else {
    aiLog.error(1, message, err, OP.AI);
  }
}

function _aiDebug(...args) {
  if (String(process.env.LOG_LEVEL || 'info').toLowerCase() === 'debug') console.log(...args);
}

let client;

function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("Missing OPENAI_API_KEY in environment variables");
    }
    
    // MOCK FOR DEVELOPMENT/TESTING
    if (process.env.OPENAI_API_KEY.startsWith('sk-dummy')) {
        _aiDebug('[AI] Using MOCK client for dummy key');
        return {
            chat: {
                completions: {
                    create: async (body) => {
                        _aiDebug('[AI] Received request:', JSON.stringify(body, null, 2));
                        return {
                            choices: [{
                                message: {
                                    content: JSON.stringify({
                                        parsed_data: {
                                            price: 12.50,
                                            miles: 4.2,
                                            time_minutes: 15,
                                            pickup: "123 Main St",
                                            dropoff: "456 Elm St",
                                            platform: "uber"
                                        },
                                        decision: "ACCEPT",
                                        reasoning: "Price per mile is ~$3.00 which is excellent. Short pickup.",
                                        confidence: 95
                                    })
                                }
                            }]
                        };
                    }
                }
            }
        };
    }

    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export async function callOpenAI({ model, system, user, messages, maxTokens, temperature, reasoningEffort, role }) {
  try {
    const openai = getClient();
    // Allow passing full messages array OR build from system/user
    let finalMessages = messages;
    if (!finalMessages) {
      finalMessages = [];
      if (system) finalMessages.push({ role: "system", content: system });
      if (user) finalMessages.push({ role: "user", content: user });
    }

    const body = {
      model,
      messages: finalMessages
    };

    // o1 models and gpt-5 family use max_completion_tokens, other models use max_tokens
    const isGPT5Family = model.startsWith("gpt-5");
    const isO1Family = model.startsWith("o1-");
    const useCompletionTokens = isGPT5Family || isO1Family;

    if (useCompletionTokens) {
      body.max_completion_tokens = maxTokens;
    } else {
      body['max_tokens'] = maxTokens;
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
    logAiRequest(role, `${shortModel} request (${maxTokens} tokens)`);

    const res = await openai.chat.completions.create(body);

    const output = res?.choices?.[0]?.message?.content?.trim() || "";

    logAiDone(role, `${shortModel} response (${output?.length ?? 0} chars)`);

    return output
      ? { ok: true, output }
      : { ok: false, output: "", error: "Empty response from OpenAI" };
  } catch (err) {
    logAiError(role, `OpenAI error`, err);
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
export async function callOpenAIWithWebSearch({ model, system, user, maxTokens, reasoningEffort = 'medium', role }) {
  try {
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    if (user) messages.push({ role: "user", content: user });

    // Use gpt-5-search-api for web search (dedicated search model)
    // Regular GPT-5 family models don't support web_search tool in Chat Completions
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
    // Unlike regular GPT-5 family models, the search model only accepts web_search_options
    // Removed: body.reasoning_effort = reasoningEffort;

    logAiRequest(role, `${searchModel} web-search request (${maxTokens} tokens)`);

    const openai = getClient();
    const res = await openai.chat.completions.create(body);

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

    logAiDone(role, `${searchModel} web-search response (${output?.length ?? 0} chars, ${citations.length} citations)`);

    return output
      ? { ok: true, output, citations }
      : { ok: false, output: "", error: "Empty response from OpenAI web search" };
  } catch (err) {
    logAiError(role, `OpenAI web-search error`, err);
    return { ok: false, output: "", error: err?.message || String(err) };
  }
}