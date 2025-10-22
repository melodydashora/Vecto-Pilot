// Unified AI configuration for Agent, Eidolon, and Assistant
// All services use near-zero randomness and extended reasoning

export const AGENT_AI_CONFIG = {
  model: 'extended-thinking',
  temperature: 0.0,
  top_p: 0.9,
  max_tokens: 4096,
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

// Log configuration once on import
console.log('[ai-config] Loaded unified AI parameters:', {
  temperature: AGENT_AI_CONFIG.temperature,
  reasoning: AGENT_AI_CONFIG.reasoning_depth,
  mode: AGENT_AI_CONFIG.execution_mode
});
