// server/lib/adapters/index.js
// Model-agnostic role dispatcher

import { callOpenAI } from "./openai-adapter.js";
import { callAnthropic } from "./anthropic-adapter.js";
import { callGemini } from "./gemini-adapter.js";
import { callPerplexity } from "./perplexity-adapter.js";

/**
 * Call a model by role name (strategist, briefer, consolidator, venue_generator)
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

  // Provider dispatch by model prefix
  if (model.startsWith("gpt-") || model.startsWith("o1-")) {
    const reasoningEffort = process.env[`${key}_REASONING_EFFORT`] || undefined;
    // CRITICAL: GPT-5.1 and o1 models don't support temperature - pass undefined
    const isGPT51OrO1 = model.includes('gpt-5.1') || model.startsWith('o1-');
    const tempToPass = isGPT51OrO1 ? undefined : temperature;
    return callOpenAI({ model, system, user, maxTokens, temperature: tempToPass, reasoningEffort });
  }
  
  if (model.startsWith("claude-")) {
    return callAnthropic({ model, system, user, maxTokens, temperature });
  }
  
  if (model.startsWith("gemini-")) {
    const topP = process.env[`${key}_TOP_P`] ? Number(process.env[`${key}_TOP_P`]) : undefined;
    const topK = process.env[`${key}_TOP_K`] ? Number(process.env[`${key}_TOP_K`]) : undefined;
    // Enable Google Search for roles that need real-time data
    const searchRoles = ['consolidator', 'briefer'];
    const useSearch = searchRoles.includes(role.toLowerCase());
    return callGemini({ model, system, user, maxTokens, temperature, topP, topK, useSearch });
  }
  
  // Perplexity disabled - briefing system uses Gemini 3.0 Pro directly
  if (model.startsWith("sonar-")) {
    throw new Error(`Perplexity (sonar-pro) disabled for briefing pipeline. Use Gemini 3.0 Pro instead for role: ${role}`);
  }

  throw new Error(`Unsupported model for role ${role}: ${model}`);
}
