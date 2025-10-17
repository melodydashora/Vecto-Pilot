// server/lib/adapters/openai-unified.js
// Unified OpenAI adapter for GPT-5 triad (strategist, planner, validator)
// Uses OpenAI Responses API with reasoning effort control
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  organization: process.env.OPENAI_ORG_ID,
  project: process.env.OPENAI_PROJECT_ID,
});

const effort = (mode) => {
  const m = String(mode || "medium").toLowerCase();
  if (["extended","deep","high"].includes(m)) return "high";
  if (["low","fast","brief"].includes(m)) return "low";
  return "medium";
};

export async function runOpenAI(rolePrefix, input, options = {}) {
  const prefix = rolePrefix.toUpperCase(); // TRIAD_STRATEGIST / PLANNER / VALIDATOR / EIDOLON / AGENT / ASSISTANT
  const model = process.env[`${prefix}_MODEL`] || process.env.EIDOLON_MODEL || "gpt-5";
  const temperature = Number(process.env[`${prefix}_TEMPERATURE`] ?? process.env.EIDOLON_TEMPERATURE ?? 1.0);
  const max_output_tokens = Number(process.env[`${prefix}_MAX_OUTPUT_TOKENS`] ?? process.env.EIDOLON_MAX_OUTPUT_TOKENS ?? 2048);
  const reasoning = { effort: effort(process.env[`${prefix}_REASONING_MODE`] || process.env.EIDOLON_REASONING_MODE) };

  // Timeout enforcement via AbortController (if provided)
  const timeoutMs = options.timeoutMs || Number(process.env[`${prefix}_TIMEOUT_MS`] || 0);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const killer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const resp = await openai.responses.create({
      model,
      input,
      temperature,
      max_output_tokens,
      reasoning,
    }, {
      signal: controller?.signal
    });

    return resp.output_text;
  } catch (err) {
    // Optional fallback to cheaper model
    const fallbackModel = process.env[`${prefix}_MODEL_FALLBACK`];
    if (fallbackModel && !options.skipFallback) {
      console.warn(`[runOpenAI] ${prefix} failed with ${model}, trying fallback ${fallbackModel}:`, err.message);
      const fallbackResp = await openai.responses.create({
        model: fallbackModel,
        input,
        temperature,
        max_output_tokens,
        reasoning,
      });
      return fallbackResp.output_text;
    }
    throw err;
  } finally {
    if (killer) clearTimeout(killer);
  }
}
