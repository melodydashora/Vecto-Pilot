import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

const AGENT_OVERRIDE_ORDER = (process.env.AGENT_OVERRIDE_ORDER || "anthropic,openai,google").split(",");

const CLAUDE_KEY = process.env.AGENT_OVERRIDE_API_KEYC || process.env.ANTHROPIC_API_KEY;
const GPT5_KEY = process.env.AGENT_OVERRIDE_API_KEY5 || process.env.OPENAI_API_KEY;
const GEMINI_KEY = process.env.AGENT_OVERRIDE_API_KEYG || process.env.GOOGLEAQ_API_KEY;

// MAXIMUM CONTEXT MODELS - Claude Sonnet 4.5 Focused Mode
// Updated to match Replit Agent's Claude version (20250514)
const CLAUDE_MODEL = process.env.AGENT_OVERRIDE_CLAUDE_MODEL || process.env.AGENT_MODEL || "claude-sonnet-4-5-20250514";
const GPT5_MODEL = process.env.AGENT_OVERRIDE_GPT5_MODEL || "gpt-5";
const GEMINI_MODEL = process.env.AGENT_OVERRIDE_GEMINI_MODEL || "gemini-2.5-pro";

// ULTRA-ENHANCED parameters - Maximum performance for all providers
const CLAUDE_MAX_TOKENS = parseInt(process.env.AGENT_MAX_TOKENS || "200000"); // MAXIMUM
const CLAUDE_TEMPERATURE = parseFloat(process.env.AGENT_TEMPERATURE || "1.0");
const CLAUDE_TOP_P = parseFloat(process.env.AGENT_TOP_P || "0.95");
const GPT5_REASONING_EFFORT = process.env.GPT5_REASONING_EFFORT || "high"; // Maximum reasoning
const GPT5_MAX_TOKENS = parseInt(process.env.GPT5_MAX_TOKENS || "128000"); // Maximum output
const GEMINI_TEMPERATURE = parseFloat(process.env.GEMINI_TEMPERATURE || "1.0"); // Increased for better reasoning
const GEMINI_MAX_TOKENS = parseInt(process.env.GEMINI_MAX_TOKENS || "32768"); // Maximum Gemini output

async function callClaude({ system, user, json }) {
  if (!CLAUDE_KEY) throw new Error("AGENT_OVERRIDE_API_KEYC not configured");
  
  const anthropic = new Anthropic({ apiKey: CLAUDE_KEY });
  const start = Date.now();
  
  const params = {
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    temperature: CLAUDE_TEMPERATURE, // Use temperature only (Claude doesn't allow both temp & top_p)
    system,
    messages: [{ role: "user", content: user }],
  };

  console.log(`[Atlas/Claude] Using ${CLAUDE_MODEL} with ${CLAUDE_MAX_TOKENS} max tokens, temp=${CLAUDE_TEMPERATURE}`);
  
  const completion = await anthropic.messages.create(params);
  
  return {
    provider: "anthropic",
    model: CLAUDE_MODEL,
    text: completion.content[0].text,
    elapsed_ms: Date.now() - start,
    usage: completion.usage,
  };
}

async function callGPT5({ system, user, json }) {
  if (!GPT5_KEY) throw new Error("AGENT_OVERRIDE_API_KEY5 not configured");
  
  const openai = new OpenAI({ apiKey: GPT5_KEY });
  const start = Date.now();
  
  const params = {
    model: GPT5_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    reasoning_effort: GPT5_REASONING_EFFORT,
    max_completion_tokens: GPT5_MAX_TOKENS,
  };

  if (json) {
    params.response_format = { type: "json_object" };
  }

  console.log(`[Atlas/GPT-5] Using ${GPT5_MODEL} with reasoning_effort=${GPT5_REASONING_EFFORT}`);
  
  const completion = await openai.chat.completions.create(params);
  
  return {
    provider: "openai",
    model: GPT5_MODEL,
    text: completion.choices[0].message.content,
    elapsed_ms: Date.now() - start,
    usage: completion.usage,
  };
}

async function callGemini({ system, user, json }) {
  if (!GEMINI_KEY) throw new Error("AGENT_OVERRIDE_API_KEYG not configured");
  
  const genAI = new GoogleGenerativeAI(GEMINI_KEY);
  const model = genAI.getGenerativeModel({ 
    model: GEMINI_MODEL,
    systemInstruction: system,
  });
  
  const start = Date.now();
  
  const generationConfig = {
    temperature: GEMINI_TEMPERATURE,
    maxOutputTokens: GEMINI_MAX_TOKENS,
  };
  
  if (json) {
    generationConfig.responseMimeType = "application/json";
  }
  
  console.log(`[Atlas/Gemini] Using ${GEMINI_MODEL} with temp=${GEMINI_TEMPERATURE}`);
  
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig,
  });
  
  return {
    provider: "google",
    model: GEMINI_MODEL,
    text: result.response.text(),
    elapsed_ms: Date.now() - start,
    usage: result.response.usageMetadata,
  };
}

const PROVIDERS = {
  anthropic: callClaude,
  openai: callGPT5,
  google: callGemini,
};

export async function agentAsk({ system, user, json = false }) {
  const errors = [];
  
  for (const providerName of AGENT_OVERRIDE_ORDER) {
    const fn = PROVIDERS[providerName];
    if (!fn) {
      console.warn(`[Atlas] Unknown provider in AGENT_OVERRIDE_ORDER: ${providerName}`);
      continue;
    }
    
    try {
      console.log(`[Atlas] Attempting ${providerName}...`);
      const result = await fn({ system, user, json });
      console.log(`✅ [Atlas] ${providerName} succeeded in ${result.elapsed_ms}ms`);
      return result;
    } catch (err) {
      const errorMsg = err.message || String(err);
      console.warn(`⚠️ [Atlas] ${providerName} failed:`, errorMsg);
      errors.push({ provider: providerName, error: errorMsg });
    }
  }
  
  const error = new Error("All Agent Override providers failed");
  error.code = "agent_override_exhausted";
  error.details = errors;
  throw error;
}
