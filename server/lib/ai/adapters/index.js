// server/lib/ai/adapters/index.js
// Model-agnostic role dispatcher with fallback support
//
// NAMING CONVENTION: {TABLE}_{FUNCTION}
// See model-registry.js for all available roles
//
// Last updated: 2026-01-05

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
} from "../model-registry.js";
import { OP } from "../../../logger/workflow.js";

/**
 * Call a model by its registry ROLE name.
 *
 * ROLE NAMING CONVENTION: {TABLE}_{FUNCTION}
 * - BRIEFING_*: Roles that populate the 'briefings' table
 * - STRATEGY_*: Roles that populate the 'strategies' table
 * - VENUE_*: Roles that populate 'ranking_candidates' (Smart Blocks)
 * - COACH_*: Roles that populate 'coach_conversations'
 * - UTIL_*: Utility roles for validation/parsing (no direct DB write)
 *
 * Available roles:
 *   BRIEFING_WEATHER         - Weather intelligence with web search
 *   BRIEFING_TRAFFIC         - Traffic conditions analysis
 *   BRIEFING_NEWS            - Local news research
 *   BRIEFING_EVENTS_DISCOVERY - Event discovery (parallel category search)
 *   BRIEFING_EVENTS_VALIDATOR - Event schedule verification
 *   BRIEFING_FALLBACK        - General fallback for failed briefing calls
 *   STRATEGY_CORE            - Core strategic plan generation
 *   STRATEGY_CONTEXT         - Real-time context gathering
 *   STRATEGY_TACTICAL        - Immediate 1-hour tactical strategy
 *   STRATEGY_DAILY           - Long-term 8-12hr daily strategy
 *   VENUE_SCORER             - Smart Blocks venue scoring
 *   VENUE_FILTER             - Fast low-cost venue filtering
 *   VENUE_TRAFFIC            - Venue-specific traffic intelligence
 *   COACH_CHAT               - AI Strategy Coach conversation
 *   UTIL_WEATHER_VALIDATOR   - Validate weather data structure
 *   UTIL_TRAFFIC_VALIDATOR   - Validate traffic data structure
 *   UTIL_MARKET_PARSER       - Parsing unstructured market research
 *
 * Legacy role names (mapped automatically):
 *   strategist     → STRATEGY_CORE
 *   briefer        → STRATEGY_CONTEXT
 *   consolidator   → STRATEGY_TACTICAL
 *   event_validator → BRIEFING_EVENTS_VALIDATOR
 *   venue_planner  → VENUE_SCORER
 *   venue_filter   → VENUE_FILTER
 *   coach          → COACH_CHAT
 *
 * @param {string} role - Role key from model-registry (e.g., 'STRATEGY_CORE' or legacy 'strategist')
 * @param {Object} params - { system, user }
 * @returns {Promise<{ok: boolean, output: string, citations?: array}>}
 */
export async function callModel(role, { system, user, messages }) {
  const callStart = Date.now();

  // 1. Get configuration from registry (handles legacy name resolution)
  let config;
  try {
    config = getRoleConfig(role);
  } catch (err) {
    throw new Error(`Model Role '${role}' not found in registry: ${err.message}`);
  }

  const { model, provider, maxTokens, temperature, reasoningEffort, role: canonicalRole } = config;

  // 2026-01-06: SECURITY - Log only metadata, not message content
  console.log(`🤖 [AI CALL] Role=${canonicalRole} Model=${model} Provider=${provider} SystemLen=${system?.length || 0} UserLen=${user?.length || 0} MsgCount=${messages?.length || 0}`);

  let result;

  // 2. Dispatch based on provider
  try {
    if (model.startsWith("gpt-") || model.startsWith("o1-")) {
      // GPT-5.x/o1: No temperature support, use reasoning_effort
      const isReasoningModel = model.includes('gpt-5') || model.startsWith('o1-');
      const tempToPass = isReasoningModel ? undefined : temperature;

      // 2026-01-05: Check for OpenAI web search feature
      const useOpenAIWebSearch = roleUsesOpenAIWebSearch(role);

      if (useOpenAIWebSearch) {
        result = await callOpenAIWithWebSearch({
          model,
          system,
          user,
          maxTokens,
          reasoningEffort,
        });
      } else {
        result = await callOpenAI({
          model,
          system,
          user,
          messages,
          maxTokens,
          temperature: tempToPass,
          reasoningEffort,
        });
      }

    } else if (model.startsWith("claude-")) {
      // Check registry for web search feature flag
      const useWebSearch = roleUsesWebSearch(role);

      if (useWebSearch) {
        result = await callAnthropicWithWebSearch({ model, system, user, maxTokens, temperature });
      } else {
        result = await callAnthropic({ model, system, user, messages, maxTokens, temperature });
      }

    } else if (model.startsWith("gemini-")) {
      // Check registry for google search feature flag
      const useSearch = roleUsesGoogleSearch(role);

      // 2026-01-08: Check if Vertex AI should be used instead of Gemini Developer API
      // Vertex AI provides enterprise features and Google Cloud integration
      if (isVertexAIAvailable() && config.useVertexAI) {
        result = await callVertexAI({
          model,
          system,
          user,
          maxTokens,
          temperature,
          useSearch,
          thinkingLevel: config.thinkingLevel || null,
        });
      } else {
        result = await callGemini({
          model,
          system,
          user,
          maxTokens,
          temperature,
          useSearch,
          // Pass thinkingLevel if defined in registry (null = disabled by default)
          thinkingLevel: config.thinkingLevel || null,
        });
      }

    } else if (model.startsWith("vertex-")) {
      // 2026-01-08: Direct Vertex AI model call (model name prefix indicates Vertex)
      const useSearch = roleUsesGoogleSearch(role);
      // Strip "vertex-" prefix to get actual model name
      const vertexModel = model.replace("vertex-", "");
      result = await callVertexAI({
        model: vertexModel,
        system,
        user,
        maxTokens,
        temperature,
        useSearch,
        thinkingLevel: config.thinkingLevel || null,
      });

    } else {
      throw new Error(`Unsupported model provider for: ${model}`);
    }

    // Log success with timing
    const durationMs = Date.now() - callStart;
    const outputPreview = result.output?.substring(0, 100) || '';
    console.log(`🤖 [AI DONE] ✅ ${canonicalRole} completed in ${durationMs}ms`);
    console.log(`🤖 [AI DONE] Output: ${outputPreview}${result.output?.length > 100 ? '...' : ''}`);
    console.log(`🤖 [AI DONE] ─────────────────────────────────────────────────`);

  } catch (err) {
    const durationMs = Date.now() - callStart;
    console.log(`🤖 [AI FAIL] ❌ ${canonicalRole} failed after ${durationMs}ms: ${err.message}`);
    result = { ok: false, error: err.message };
  }

  // 3. Fallback logic (if enabled for this role)
  if (!result.ok && isFallbackEnabled(role)) {
    const fallbackStart = Date.now();
    console.log(`🔄 [FALLBACK] ═══════════════════════════════════════════`);
    console.log(`🔄 [FALLBACK] Role:     ${canonicalRole}`);
    console.log(`🔄 [FALLBACK] Reason:   Primary model failed: ${result.error}`);
    console.log(`🔄 [FALLBACK] Model:    ${FALLBACK_CONFIG.model}`);
    console.log(`🔄 [FALLBACK] ═══════════════════════════════════════════`);

    // 2026-01-14: FIX - Dynamically route fallback to correct provider based on model prefix
    // Previously hardcoded to callAnthropic, causing gemini-3-flash-preview to fail
    const fallbackModel = FALLBACK_CONFIG.model;
    let fallbackResult;

    if (fallbackModel.startsWith('gemini-')) {
      // Route to Gemini adapter for gemini-* models
      fallbackResult = await callGemini({
        model: fallbackModel,
        system,
        user,
        maxTokens: FALLBACK_CONFIG.maxTokens,
        temperature: FALLBACK_CONFIG.temperature,
        useSearch: FALLBACK_CONFIG.features?.includes('google_search') || false,
      });
    } else if (fallbackModel.startsWith('gpt-') || fallbackModel.startsWith('o1-')) {
      // Route to OpenAI adapter for gpt-* and o1-* models
      fallbackResult = await callOpenAI({
        model: fallbackModel,
        system,
        user,
        maxTokens: FALLBACK_CONFIG.maxTokens,
        temperature: fallbackModel.includes('gpt-5') ? undefined : FALLBACK_CONFIG.temperature,
      });
    } else {
      // Default to Anthropic for claude-* models
      fallbackResult = await callAnthropic({
        model: fallbackModel,
        system,
        user,
        maxTokens: FALLBACK_CONFIG.maxTokens,
        temperature: FALLBACK_CONFIG.temperature,
      });
    }

    const fallbackDuration = Date.now() - fallbackStart;

    if (fallbackResult.ok) {
      console.log(`🔄 [FALLBACK] ✅ Succeeded in ${fallbackDuration}ms`);
      console.log(`🔄 [FALLBACK] ─────────────────────────────────────────────`);
      return {
        ...fallbackResult,
        usedFallback: true,
        primaryModel: model,
        primaryError: result.error,
      };
    } else {
      console.log(`🔄 [FALLBACK] ❌ Also failed in ${fallbackDuration}ms: ${fallbackResult.error}`);
      console.log(`🔄 [FALLBACK] ─────────────────────────────────────────────`);
      return {
        ...result,
        fallbackAttempted: true,
        fallbackError: fallbackResult.error,
      };
    }
  }

  return result;
}

/**
 * Streaming version of callModel for SSE/chat use cases.
 * 2026-01-06: Added to support adapter pattern for coach chat
 *
 * Currently only supports Gemini models (COACH_CHAT role uses gemini-3-pro-preview).
 *
 * @param {string} role - Role key from model-registry (e.g., 'COACH_CHAT')
 * @param {Object} params - { system, messageHistory }
 * @param {string} params.system - System prompt
 * @param {Array} params.messageHistory - Array of { role: 'user'|'model', parts: [{ text }] }
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

  const { model, provider, maxTokens, temperature, role: canonicalRole } = config;
  const useSearch = roleUsesGoogleSearch(role);

  // 2026-01-06: SECURITY - Log only metadata, not message content
  console.log(`🤖 [AI STREAM] Role=${canonicalRole} Model=${model} Provider=${provider} MsgCount=${messageHistory?.length || 0}`);

  // 2. Currently only Gemini supports streaming via this adapter
  if (!model.startsWith('gemini-')) {
    throw new Error(`Streaming not supported for provider: ${provider}. Only Gemini models support streaming via callModelStream()`);
  }

  // 3. Call the streaming adapter
  const response = await callGeminiStream({
    model,
    system,
    messageHistory,
    maxTokens,
    temperature,
    useSearch,
    timeoutMs: 90000 // 90 seconds for streaming responses
  });

  return response;
}

// Re-export Vertex AI helpers for external use
export { isVertexAIAvailable, getVertexAIStatus };
