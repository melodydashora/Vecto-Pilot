// server/lib/adapters/index.js
// Model-agnostic role dispatcher

import { callOpenAI } from "./openai-adapter.js";
import { callAnthropic } from "./anthropic-adapter.js";
import { callGemini } from "./gemini-adapter.js";

/**
 * Call a model by role name (strategist, briefer, consolidator)
 * @param {string} role - Role name (lowercase)
 * @param {Object} params - { system, user }
 * @returns {Promise<{ok: boolean, output: string}>}
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
    return callOpenAI({ model, system, user, maxTokens, temperature, reasoningEffort });
  }
  
  if (model.startsWith("claude-")) {
    return callAnthropic({ model, system, user, maxTokens, temperature });
  }
  
  if (model.startsWith("gemini-")) {
    const topP = process.env[`${key}_TOP_P`] ? Number(process.env[`${key}_TOP_P`]) : undefined;
    const topK = process.env[`${key}_TOP_K`] ? Number(process.env[`${key}_TOP_K`]) : undefined;
    return callGemini({ model, system, user, maxTokens, temperature, topP, topK });
  }

  throw new Error(`Unsupported model for role ${role}: ${model}`);
}
