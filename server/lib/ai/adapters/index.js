// server/lib/adapters/index.js
// Model-agnostic role dispatcher with fallback support

import { callOpenAI } from "./openai-adapter.js";
import { callAnthropic, callAnthropicWithWebSearch } from "./anthropic-adapter.js";
import { callGemini } from "./gemini-adapter.js";

// Roles that support Claude Opus fallback when primary model fails
const FALLBACK_ENABLED_ROLES = ['consolidator', 'briefer'];

// Claude Opus fallback configuration
const FALLBACK_MODEL = 'claude-opus-4-5-20251101';
const FALLBACK_MAX_TOKENS = 16000;
const FALLBACK_TEMPERATURE = 0.3;

/**
 * Call a model by role name (strategist, briefer, consolidator, venue_generator)
 * Supports automatic fallback to Claude Opus for critical roles when primary fails
 * @param {string} role - Role name (lowercase)
 * @param {Object} params - { system, user }
 * @returns {Promise<{ok: boolean, output: string, citations?: array}>}
 */
export async function callModel(role, { system, user }) {
  const key = `STRATEGY_${role.toUpperCase()}`;
  const model = process.env[key];

  if (!model) {
    throw new Error(`No model configured for role: ${role} (expected env var: ${key})`);
  }

  console.log(`[model-dispatch] role=${role} model=${model}`);

  // Common parameters
  const maxTokens = Number(process.env[`${key}_MAX_TOKENS`] || 1024);
  const temperature = process.env[`${key}_TEMPERATURE`] !== undefined
    ? Number(process.env[`${key}_TEMPERATURE`])
    : 0.7;

  let result;

  // Provider dispatch by model prefix
  if (model.startsWith("gpt-") || model.startsWith("o1-")) {
    const reasoningEffort = process.env[`${key}_REASONING_EFFORT`] || undefined;
    // CRITICAL: GPT-5.1 and o1 models don't support temperature - pass undefined
    const isGPT51OrO1 = model.includes('gpt-5.1') || model.startsWith('o1-');
    const tempToPass = isGPT51OrO1 ? undefined : temperature;
    result = await callOpenAI({ model, system, user, maxTokens, temperature: tempToPass, reasoningEffort });
  } else if (model.startsWith("claude-")) {
    // Roles that need web search capability
    const webSearchRoles = ['event_validator'];
    const useWebSearch = webSearchRoles.includes(role.toLowerCase());

    if (useWebSearch) {
      result = await callAnthropicWithWebSearch({ model, system, user, maxTokens, temperature });
    } else {
      result = await callAnthropic({ model, system, user, maxTokens, temperature });
    }
  } else if (model.startsWith("gemini-")) {
    const topP = process.env[`${key}_TOP_P`] ? Number(process.env[`${key}_TOP_P`]) : undefined;
    const topK = process.env[`${key}_TOP_K`] ? Number(process.env[`${key}_TOP_K`]) : undefined;
    // Enable Google Search for roles that need real-time data
    const searchRoles = ['consolidator', 'briefer'];
    const useSearch = searchRoles.includes(role.toLowerCase());
    result = await callGemini({ model, system, user, maxTokens, temperature, topP, topK, useSearch });
  } else {
    throw new Error(`Unsupported model for role ${role}: ${model}`);
  }

  // If primary failed and this role has fallback enabled, try Claude Opus
  if (!result.ok && FALLBACK_ENABLED_ROLES.includes(role.toLowerCase())) {
    console.warn(`[model-dispatch] ⚠️ Primary model (${model}) failed for ${role}: ${result.error}`);
    console.log(`[model-dispatch] 🔄 Trying Claude Opus fallback...`);

    const fallbackResult = await callAnthropic({
      model: FALLBACK_MODEL,
      system,
      user,
      maxTokens: FALLBACK_MAX_TOKENS,
      temperature: FALLBACK_TEMPERATURE
    });

    if (fallbackResult.ok) {
      console.log(`[model-dispatch] ✅ Claude Opus fallback succeeded for ${role}`);
      return { ...fallbackResult, usedFallback: true, primaryModel: model, primaryError: result.error };
    } else {
      console.error(`[model-dispatch] ❌ Fallback also failed for ${role}: ${fallbackResult.error}`);
      // Return original error with fallback error info
      return { ...result, fallbackAttempted: true, fallbackError: fallbackResult.error };
    }
  }

  return result;
}
