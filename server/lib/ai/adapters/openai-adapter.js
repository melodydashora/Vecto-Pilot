// server/lib/adapters/openai-adapter.js
// Generic OpenAI adapter - returns { ok, output } shape
//
// 2026-01-05: Added callOpenAIWithWebSearch for GPT-5.2 web search capability.
// 2026-05-06: BRIEFING_NEWS_GPT (the original consumer) was deprecated in the
//   2026-01-14 dual-news cleanup. The web-search adapter is retained — any role
//   can opt in via the model registry.
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
  if (role === 'OFFER_ANALYZER' || role === 'OFFER_ANALYZER_DEEP') {
    return { parent: 'HOOKS', sub: role };
  }
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
  // A cached live client must never turn an unrelated dummy-key fixture into a
  // network request. Offer Analyzer rejects dummy credentials before this call.
  if (!client || process.env.OPENAI_API_KEY?.startsWith('sk-dummy')) {
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

export async function callOpenAI({ model, system, user, messages, maxTokens, temperature, reasoningEffort, jsonMode, signal, role }) {
  const isOfferAnalyzer = role === 'OFFER_ANALYZER' || role === 'OFFER_ANALYZER_DEEP';
  try {
    signal?.throwIfAborted();
    if (isOfferAnalyzer && (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('sk-dummy'))) {
      const error = 'OpenAI provider not configured for Offer Analyzer';
      logAiError(role, 'OpenAI error', new Error(error));
      return { ok: false, output: '', error };
    }
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

    // GPT-5/GPT-6 and o1 use completion-token budgets and reasoning controls.
    const isReasoningGPTFamily = /^gpt-[56](?:[.-]|$)/.test(model);
    const isO1Family = model.startsWith("o1-");
    const useCompletionTokens = isReasoningGPTFamily || isO1Family;

    if (useCompletionTokens) {
      body.max_completion_tokens = maxTokens;
    } else {
      body['max_tokens'] = maxTokens;
    }

    if (reasoningEffort && useCompletionTokens) {
      body.reasoning_effort = reasoningEffort;
    }

    // Preserve the existing temperature omission for reasoning-model requests.
    if (temperature !== undefined && !useCompletionTokens) {
      body.temperature = temperature;
    }
    if (jsonMode) body.response_format = { type: 'json_object' };
    if (isOfferAnalyzer) body.store = false;

    logAiRequest(role, `request (${maxTokens} tokens)`);

    const requestOptions = {};
    if (signal) requestOptions.signal = signal;
    // The Offer Analyzer router owns the shared deadline and fallback attempt.
    if (isOfferAnalyzer) requestOptions.maxRetries = 0;
    const res = Object.keys(requestOptions).length
      ? await openai.chat.completions.create(body, requestOptions)
      : await openai.chat.completions.create(body);
    // Some transports may resolve after cancellation; never publish that answer.
    signal?.throwIfAborted();

    const choice = res?.choices?.[0];
    const output = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
    const finishReason = choice?.finish_reason || null;

    // 2026-08-06: finish_reason=length is a contract violation, not a response.
    // On reasoning models, reasoning tokens count against max_completion_tokens — a
    // budget consumed entirely by reasoning yields EMPTY content with
    // finish_reason=length, which previously misreported as "Empty response".
    if (finishReason === 'length') {
      logAiError(role, `truncated at max_tokens=${maxTokens}`, new Error('finish_reason=length'));
      return { ok: false, output, truncated: true, error: `truncated at max_tokens=${maxTokens} (finish_reason=length)` };
    }

    if (isOfferAnalyzer && (
      finishReason !== 'stop' || choice?.message?.refusal ||
      choice?.message?.tool_calls?.length || choice?.message?.function_call
    )) {
      const error = 'OpenAI did not return a complete analysis';
      logAiError(role, 'OpenAI error', new Error(error));
      return { ok: false, output: '', error };
    }

    logAiDone(role, `response (${output?.length ?? 0} chars)`);

    return output
      ? { ok: true, output, model: res?.model || model }
      : { ok: false, output: "", error: `Empty response from OpenAI${finishReason ? ` (finish_reason=${finishReason})` : ''}` };
  } catch (err) {
    if (isOfferAnalyzer) {
      // Provider exceptions can contain OCR, addresses, or request credentials.
      const error = signal?.aborted
        ? 'OpenAI request cancelled'
        : Number.isInteger(err?.status) && err.status >= 400 && err.status <= 599
          ? `OpenAI provider returned HTTP ${err.status}`
          : 'OpenAI provider request failed';
      logAiError(role, 'OpenAI error', new Error(error));
      return { ok: false, output: '', error };
    }
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

    logAiRequest(role, `web-search request (${maxTokens} tokens)`);

    const openai = getClient();
    const res = await openai.chat.completions.create(body);

    // Extract content and any citations/sources from web search
    const choice = res?.choices?.[0];
    const output = choice?.message?.content?.trim() || "";
    const finishReason = choice?.finish_reason || null;

    // 2026-08-06: same truncation gate as callOpenAI.
    if (finishReason === 'length') {
      logAiError(role, `web-search truncated at max_tokens=${maxTokens}`, new Error('finish_reason=length'));
      return { ok: false, output, truncated: true, error: `truncated at max_tokens=${maxTokens} (finish_reason=length)` };
    }

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

    logAiDone(role, `web-search response (${output?.length ?? 0} chars, ${citations.length} citations)`);

    return output
      ? { ok: true, output, citations }
      : { ok: false, output: "", error: `Empty response from OpenAI web search${finishReason ? ` (finish_reason=${finishReason})` : ''}` };
  } catch (err) {
    logAiError(role, `OpenAI web-search error`, err);
    return { ok: false, output: "", error: err?.message || String(err) };
  }
}
