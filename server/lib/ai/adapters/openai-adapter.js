// server/lib/adapters/openai-adapter.js
// Generic OpenAI adapter - returns { ok, output } shape

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
    // - GPT-5.1: reasoning_effort only, NO temperature support
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
