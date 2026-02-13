// server/lib/ai/adapters/index.js
// Model-agnostic role dispatcher with Hedged Router support
//
// NAMING CONVENTION: {TABLE}_{FUNCTION}
// See model-registry.js for all available roles
//
// Last updated: 2026-02-10 (Hedged Router Integration)

import { callOpenAI, callOpenAIWithWebSearch } from "./openai-adapter.js";
import { callAnthropic, callAnthropicWithWebSearch } from "./anthropic-adapter.js";
import { callGemini, callGeminiStream } from "./gemini-adapter.js";
import { callVertexAI, callVertexAIStream, isVertexAIAvailable, getVertexAIStatus } from "./vertex-adapter.js";
import {
  getRoleConfig,
  roleUsesGoogleSearch,
  roleUsesWebSearch,
  roleUsesOpenAIWebSearch,
  isFallbackEnabled,
  FALLBACK_CONFIG,
  getProviderForModel
} from "../model-registry.js";
import { OP } from "../../../logger/workflow.js";
import HedgedRouter from "../router/hedged-router.js";

// Initialize Hedged Router with adapters
const router = new HedgedRouter({
  adapters: new Map([
    ['openai', async (req, { signal }) => {
      console.log(`📡 [HedgedRouter] Calling OpenAI...`);
      const config = req.configs['openai'];
      if (!config) throw new Error('No config for openai');
      
      const { system, user, messages } = req.params;
      const { model, maxTokens, temperature, reasoningEffort, useWebSearch } = config;

      let result;
      if (useWebSearch) {
        result = await callOpenAIWithWebSearch({ model, system, user, maxTokens, reasoningEffort });
      } else {
        result = await callOpenAI({ model, system, user, messages, maxTokens, temperature, reasoningEffort });
      }
      if (!result.ok) throw new Error(result.error);
      return result;
    }],
    ['anthropic', async (req, { signal }) => {
      console.log(`📡 [HedgedRouter] Calling Anthropic...`);
      const config = req.configs['anthropic'];
      if (!config) throw new Error('No config for anthropic');

      const { system, user, messages } = req.params;
      const { model, maxTokens, temperature, useWebSearch } = config;

      let result;
      if (useWebSearch) {
        result = await callAnthropicWithWebSearch({ model, system, user, maxTokens, temperature });
      } else {
        result = await callAnthropic({ model, system, user, messages, maxTokens, temperature });
      }
      if (!result.ok) throw new Error(result.error);
      return result;
    }],
    ['google', async (req, { signal }) => {
      console.log(`📡 [HedgedRouter] Calling Gemini...`);
      const config = req.configs['google'];
      if (!config) throw new Error('No config for google');

      const { system, user } = req.params;
      const { model, maxTokens, temperature, useSearch, thinkingLevel, skipJsonExtraction } = config;

      const result = await callGemini({
        model, system, user, maxTokens, temperature, useSearch, thinkingLevel, skipJsonExtraction
      });
      if (!result.ok) throw new Error(result.error);
      return result;
    }],
    ['vertex', async (req, { signal }) => {
      console.log(`📡 [HedgedRouter] Calling Vertex AI...`);
      const config = req.configs['vertex'];
      if (!config) throw new Error('No config for vertex');

      const { system, user } = req.params;
      const { model, maxTokens, temperature, useSearch, thinkingLevel } = config;

      const result = await callVertexAI({
        model, system, user, maxTokens, temperature, useSearch, thinkingLevel
      });
      if (!result.ok) throw new Error(result.error);
      return result;
    }]
  ])
});

/**
 * Call a model by its registry ROLE name.
 * Uses Hedged Router for reliability/fallback if enabled.
 *
 * @param {string} role - Role key from model-registry
 * @param {Object} params - { system, user, messages }
 * @returns {Promise<{ok: boolean, output: string, citations?: array}>}
 */
export async function callModel(role, params) {
  const callStart = Date.now();

  // 1. Get primary configuration
  let primaryConfig;
  try {
    primaryConfig = getRoleConfig(role);
  } catch (err) {
    throw new Error(`Model Role '${role}' not found in registry: ${err.message}`);
  }

  // Enrich config with feature flags
  primaryConfig.useWebSearch = roleUsesWebSearch(role);
  primaryConfig.useOpenAIWebSearch = roleUsesOpenAIWebSearch(role);
  primaryConfig.useSearch = roleUsesGoogleSearch(role);

  // 2. Prepare Hedged Request
  const providers = [primaryConfig.provider];
  const configs = {
    [primaryConfig.provider]: primaryConfig
  };

  // Determine fallback
  if (isFallbackEnabled(role)) {
    const fallbackProvider = getProviderForModel(FALLBACK_CONFIG.model);
    if (fallbackProvider !== 'unknown' && fallbackProvider !== primaryConfig.provider) {
      providers.push(fallbackProvider);
      configs[fallbackProvider] = {
        ...FALLBACK_CONFIG,
        provider: fallbackProvider,
        // Fallback features? Assume minimal or derived from role
        useSearch: roleUsesGoogleSearch(role) || FALLBACK_CONFIG.features?.includes('google_search'),
      };
    }
  }

  // 2026-01-06: SECURITY - Log only metadata
  console.log(`🤖 [AI CALL] Role=${primaryConfig.role} Primary=${primaryConfig.model} Hedged=${providers.length > 1}`);

  try {
    // 3. Execute via Router
    const result = await router.execute({
      role,
      params,
      configs
    }, {
      providers, // Explicitly pass ordered list (primary first)
      timeout: 0 // DISABLE TIMEOUT (User Request: "remove time out for models to respond")
    });

    const response = result.response;
    
    // Safety check - result.response should exist if successful
    if (!response) {
       throw new Error("Router returned undefined response");
    }

    if (!response.ok) {
        throw new Error(response.error || "Unknown error from adapter");
    }

    const durationMs = Date.now() - callStart;
    console.log(`🤖 [AI DONE] ✅ ${primaryConfig.role} completed by ${result.provider} in ${durationMs}ms`);

    // Standardize the response format
    return {
      success: true, // Legacy compatibility
      ok: true,
      text: response.output, // Ensure 'text' property is available for legacy code
      output: response.output,
      provider: result.provider,
      latencyMs: result.latencyMs,
      citations: response.citations
    };

  } catch (err) {
    const durationMs = Date.now() - callStart;
    console.error(`🤖 [AI FAIL] ❌ ${primaryConfig.role} failed after ${durationMs}ms: ${err.message}`);
    // Return a structured error object instead of throwing
    return { 
      success: false, 
      ok: false, 
      error: err.message,
      text: null
    };
  }
}

/**
 * Streaming version of callModel for SSE/chat use cases.
 * Currently bypasses HedgedRouter (streaming is complex to hedge).
 *
 * @param {string} role - Role key from model-registry (e.g., 'COACH_CHAT')
 * @param {Object} params - { system, messageHistory }
 * @returns {Promise<Response>} - Fetch Response with readable stream body
 */
export async function callModelStream(role, { system, messageHistory }) {
  // 1. Get configuration from registry
  let config;
  try {
    config = getRoleConfig(role);
  } catch (err) {
    throw new Error(`Model Role '${role}' not found in registry: ${err.message}`);
  }

  const { model, provider, maxTokens, temperature, thinkingLevel, role: canonicalRole } = config;
  const useSearch = roleUsesGoogleSearch(role);

  console.log(`🤖 [AI STREAM] Role=${canonicalRole} Model=${model} Provider=${provider}`);

  // 2. Currently only Gemini supports streaming via this adapter
  if (!model.startsWith('gemini-')) {
    throw new Error(`Streaming not supported for provider: ${provider}. Only Gemini models support streaming via callModelStream()`);
  }

  // 3. Call the streaming adapter
  // 2026-02-11: Pass thinkingLevel from registry for Gemini 3 Pro support
  const response = await callGeminiStream({
    model,
    system,
    messageHistory,
    maxTokens,
    temperature,
    useSearch,
    thinkingLevel,
    timeoutMs: 90000 // 90 seconds for streaming responses
  });

  return response;
}

// Re-export Vertex AI helpers for external use
export { isVertexAIAvailable, getVertexAIStatus } from "./vertex-adapter.js";
