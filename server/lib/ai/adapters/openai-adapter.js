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

    // GPT-5.1 does NOT support temperature - use reasoning_effort only
    // o1 models also use reasoning_effort, not temperature
    const isGPT51 = model.includes('gpt-5.1');
    if (reasoningEffort && (isGPT5Family || isO1Family)) {
      body.reasoning_effort = reasoningEffort;
      // CRITICAL: Don't set temperature for GPT-5.1 or o1 models (API will reject it)
    } else if (!isGPT51 && temperature !== undefined) {
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
