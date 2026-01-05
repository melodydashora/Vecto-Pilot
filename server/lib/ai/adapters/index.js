// server/lib/ai/adapters/index.js
// Model-agnostic role dispatcher with fallback support
//
// NAMING CONVENTION: {TABLE}_{FUNCTION}
// See model-registry.js for all available roles
//
// Last updated: 2026-01-05

import { callOpenAI } from "./openai-adapter.js";
import { callAnthropic, callAnthropicWithWebSearch } from "./anthropic-adapter.js";
import { callGemini } from "./gemini-adapter.js";
import {
  getRoleConfig,
  roleUsesGoogleSearch,
  roleUsesWebSearch,
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
export async function callModel(role, { system, user }) {
  const callStart = Date.now();

  // 1. Get configuration from registry (handles legacy name resolution)
  let config;
  try {
    config = getRoleConfig(role);
  } catch (err) {
    throw new Error(`Model Role '${role}' not found in registry: ${err.message}`);
  }

  const { model, provider, maxTokens, temperature, reasoningEffort, role: canonicalRole } = config;

  // Log the API call
  console.log(`🤖 [AI CALL] ═══════════════════════════════════════════════`);
  console.log(`🤖 [AI CALL] Role:     ${canonicalRole}`);
  console.log(`🤖 [AI CALL] Model:    ${model}`);
  console.log(`🤖 [AI CALL] Provider: ${provider}`);
  console.log(`🤖 [AI CALL] System:   ${system?.substring(0, 80)}${system?.length > 80 ? '...' : ''}`);
  console.log(`🤖 [AI CALL] User:     ${user?.substring(0, 80)}${user?.length > 80 ? '...' : ''}`);
  console.log(`🤖 [AI CALL] ═══════════════════════════════════════════════`);

  let result;

  // 2. Dispatch based on provider
  try {
    if (model.startsWith("gpt-") || model.startsWith("o1-")) {
      // GPT-5.x/o1: No temperature support, use reasoning_effort
      const isReasoningModel = model.includes('gpt-5') || model.startsWith('o1-');
      const tempToPass = isReasoningModel ? undefined : temperature;

      result = await callOpenAI({
        model,
        system,
        user,
        maxTokens,
        temperature: tempToPass,
        reasoningEffort,
      });

    } else if (model.startsWith("claude-")) {
      // Check registry for web search feature flag
      const useWebSearch = roleUsesWebSearch(role);

      if (useWebSearch) {
        result = await callAnthropicWithWebSearch({ model, system, user, maxTokens, temperature });
      } else {
        result = await callAnthropic({ model, system, user, maxTokens, temperature });
      }

    } else if (model.startsWith("gemini-")) {
      // Check registry for google search feature flag
      const useSearch = roleUsesGoogleSearch(role);

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

    const fallbackResult = await callAnthropic({
      model: FALLBACK_CONFIG.model,
      system,
      user,
      maxTokens: FALLBACK_CONFIG.maxTokens,
      temperature: FALLBACK_CONFIG.temperature,
    });

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
