// Unified AI configuration for Agent, Eidolon, and Assistant
// All services use Claude Opus 4.6 with extended thinking

export const AGENT_AI_CONFIG = {
  model: 'gemini-3-pro-preview',
  temperature: 0.7,
  top_p: 0.95,
  max_tokens: 65536,
  thinking: {
    enabled: true,
    level: 'high' // Gemini 3 uses thinkingLevel: "low"|"high"
  },
  reasoning_depth: 'deep'
};

export const EIDOLON_CONFIG = {
  ...AGENT_AI_CONFIG,
  role: 'eidolon',
  autonomy: 'bounded',
  service: 'eidolon'
};

export const ASSISTANT_CONFIG = {
  ...AGENT_AI_CONFIG,
  role: 'assistant',
  tone: 'plain_humble_precise',
  service: 'assistant'
};

export const GATEWAY_CONFIG = {
  ...AGENT_AI_CONFIG,
  role: 'gateway',
  service: 'gateway'
};

// Log configuration once on import (skip in autoscale deployment)
if (process.env.REPLIT_DEPLOYMENT !== "1") {
  console.log('[ai-config] Loaded unified AI parameters:', {
    model: AGENT_AI_CONFIG.model,
    thinking: AGENT_AI_CONFIG.thinking.enabled,
    reasoning: AGENT_AI_CONFIG.reasoning_depth,
    mode: AGENT_AI_CONFIG.execution_mode
  });
}
