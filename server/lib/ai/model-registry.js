// server/lib/ai/model-registry.js
// Centralized model configuration registry
// Single source of truth for AI model settings

/**
 * Model roles and their default configurations
 * Override via environment variables: STRATEGY_<ROLE>=<model>
 */
export const MODEL_ROLES = {
  // TRIAD Pipeline Roles
  STRATEGIST: {
    envKey: 'STRATEGY_STRATEGIST',
    default: 'claude-opus-4-5-20251101',
    purpose: 'Long-term strategy analysis (minstrategy)',
    maxTokens: 4096,
    temperature: 0.7,
  },
  BRIEFER: {
    envKey: 'STRATEGY_BRIEFER',
    default: 'gemini-3-pro-preview',
    purpose: 'Real-time events, traffic, news (with Google Search)',
    maxTokens: 8192,
    temperature: 0.4,
    features: ['google_search'],
  },
  CONSOLIDATOR: {
    envKey: 'STRATEGY_CONSOLIDATOR',
    default: 'gpt-5.2',
    purpose: 'Immediate tactical strategy (1hr)',
    maxTokens: 32000,
    reasoningEffort: 'medium',
  },
  EVENT_VALIDATOR: {
    envKey: 'STRATEGY_EVENT_VALIDATOR',
    default: 'claude-opus-4-5-20251101',
    purpose: 'Event schedule verification (with web search)',
    maxTokens: 4096,
    temperature: 0.3,
    features: ['web_search'],
  },

  // Venue Planning
  VENUE_PLANNER: {
    envKey: 'STRATEGY_VENUE_PLANNER',
    default: 'gpt-5.2',
    purpose: 'Smart Blocks venue selection',
    maxTokens: 16000,
    reasoningEffort: 'medium',
  },

  // Coach/Chat
  COACH: {
    envKey: 'STRATEGY_COACH',
    default: 'claude-opus-4-5-20251101',
    purpose: 'AI Strategy Coach conversation',
    maxTokens: 4096,
    temperature: 0.7,
  },
};

/**
 * Provider detection by model name prefix
 */
export const PROVIDERS = {
  'gpt-': 'openai',
  'o1-': 'openai',
  'claude-': 'anthropic',
  'gemini-': 'google',
};

/**
 * Get provider for a model name
 * @param {string} model - Model name (e.g., 'gpt-5.2', 'claude-opus-4-5-20251101')
 * @returns {string} Provider name ('openai', 'anthropic', 'google')
 */
export function getProviderForModel(model) {
  for (const [prefix, provider] of Object.entries(PROVIDERS)) {
    if (model.startsWith(prefix)) return provider;
  }
  throw new Error(`Unknown provider for model: ${model}`);
}

/**
 * Get configured model for a role
 * @param {string} role - Role name (e.g., 'strategist', 'briefer')
 * @returns {string} Model name from env or default
 */
export function getModelForRole(role) {
  const roleConfig = MODEL_ROLES[role.toUpperCase()];
  if (!roleConfig) {
    throw new Error(`Unknown role: ${role}`);
  }
  return process.env[roleConfig.envKey] || roleConfig.default;
}

/**
 * Get full configuration for a role
 * @param {string} role - Role name
 * @returns {Object} Full role configuration with resolved model
 */
export function getRoleConfig(role) {
  const roleConfig = MODEL_ROLES[role.toUpperCase()];
  if (!roleConfig) {
    throw new Error(`Unknown role: ${role}`);
  }

  const model = process.env[roleConfig.envKey] || roleConfig.default;
  const provider = getProviderForModel(model);

  return {
    ...roleConfig,
    model,
    provider,
  };
}

/**
 * Roles that support Claude Opus fallback
 */
export const FALLBACK_ENABLED_ROLES = ['consolidator', 'briefer'];

/**
 * Fallback model configuration
 */
export const FALLBACK_CONFIG = {
  model: 'claude-opus-4-5-20251101',
  maxTokens: 16000,
  temperature: 0.3,
};

/**
 * Roles that use Google Search grounding
 */
export const GOOGLE_SEARCH_ROLES = ['briefer', 'consolidator'];

/**
 * Roles that use Anthropic web search
 */
export const WEB_SEARCH_ROLES = ['event_validator'];

/**
 * Model-specific quirks and limitations
 */
export const MODEL_QUIRKS = {
  'gpt-5.2': {
    noTemperature: true,
    useReasoningEffort: true,
    useMaxCompletionTokens: true,
  },
  'o1-': {
    noTemperature: true,
    useReasoningEffort: true,
    useMaxCompletionTokens: true,
  },
  'gemini-': {
    useThinkingConfig: true,
    safetySettingsRequired: true,
  },
};

/**
 * Check if a model has a specific quirk
 * @param {string} model - Model name
 * @param {string} quirk - Quirk name
 * @returns {boolean}
 */
export function hasQuirk(model, quirk) {
  for (const [prefix, quirks] of Object.entries(MODEL_QUIRKS)) {
    if (model.startsWith(prefix) || model.includes(prefix)) {
      return !!quirks[quirk];
    }
  }
  return false;
}
