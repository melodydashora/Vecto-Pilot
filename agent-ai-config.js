// Unified AI configuration for Agent, Eidolon, and Assistant
// All services use Claude Opus 4.5 with extended thinking

export const AGENT_AI_CONFIG = {
  model: 'claude-opus-4-5-20251101',
  temperature: 0.7,
  top_p: 1.0,
  max_tokens: 16000,
  thinking: {
    enabled: true,
    budget_tokens: 10000
  },
  reasoning_depth: 'deep',
  chain_of_thought: 'structured',
  hallucination_guard: 'strict',
  execution_mode: 'evidence_first'
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
