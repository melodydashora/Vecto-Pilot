// server/lib/ai/model-registry.js
// Centralized model configuration registry
// Single source of truth for AI model settings
//
// NAMING CONVENTION: {TABLE}_{FUNCTION}
// - BRIEFING_*: Roles that populate the 'briefings' table
// - STRATEGY_*: Roles that populate the 'strategies' table
// - VENUE_*: Roles that populate 'ranking_candidates' (Smart Blocks)
// - COACH_*: Roles that populate 'coach_conversations'
// - UTIL_*: Utility roles for validation/parsing (no direct DB write)
//
// Last updated: 2026-01-05

/**
 * Model roles following {TABLE}_{FUNCTION} convention.
 * Each role maps to a specific output destination and purpose.
 */
export const MODEL_ROLES = {
  // ==========================
  // 1. BRIEFINGS TABLE
  // ==========================
  BRIEFING_WEATHER: {
    envKey: 'BRIEFING_WEATHER_MODEL',
    default: 'gemini-3-pro-preview',
    purpose: 'Weather intelligence with web search',
    maxTokens: 4096,
    temperature: 0.1,
    features: ['google_search'],
  },
  BRIEFING_TRAFFIC: {
    envKey: 'BRIEFING_TRAFFIC_MODEL',
    default: 'gemini-3-flash-preview',
    purpose: 'Traffic conditions analysis (structured output)',
    maxTokens: 2048,
    temperature: 0.2,
    features: ['google_search'],
  },
  BRIEFING_NEWS: {
    envKey: 'BRIEFING_NEWS_MODEL',
    default: 'gemini-3-pro-preview',
    purpose: 'Local news research (last 7 days) - Gemini + Google Search',
    maxTokens: 8192,
    temperature: 0.4,
    features: ['google_search'],
  },
  // 2026-01-05: Added for dual-model news fetching
  // GPT-5.2 runs in PARALLEL with Gemini, results are consolidated
  BRIEFING_NEWS_GPT: {
    envKey: 'BRIEFING_NEWS_GPT_MODEL',
    default: 'gpt-5.2',
    purpose: 'Local news research - GPT-5.2 + OpenAI web search (parallel with Gemini)',
    maxTokens: 8192,
    reasoningEffort: 'medium',
    features: ['openai_web_search'],
  },
  BRIEFING_EVENTS_DISCOVERY: {
    envKey: 'BRIEFING_EVENTS_MODEL',
    default: 'gemini-3-pro-preview',
    purpose: 'Event discovery (parallel category search)',
    maxTokens: 8192,
    temperature: 0.4,
    features: ['google_search'],
  },
  BRIEFING_EVENTS_VALIDATOR: {
    envKey: 'BRIEFING_VALIDATOR_MODEL',
    default: 'claude-opus-4-5-20251101',
    purpose: 'Event schedule verification',
    maxTokens: 4096,
    temperature: 0.3,
    features: ['web_search'], // Anthropic tool
  },
  BRIEFING_FALLBACK: {
    envKey: 'BRIEFING_FALLBACK_MODEL',
    default: 'claude-opus-4-5-20251101',
    purpose: 'General fallback for failed briefing calls',
    maxTokens: 8192,
    temperature: 0.3,
    features: ['web_search'],
  },
  BRIEFING_SCHOOLS: {
    envKey: 'BRIEFING_SCHOOLS_MODEL',
    default: 'gemini-3-pro-preview',
    purpose: 'School closures and calendar lookup',
    maxTokens: 8192,
    temperature: 0.2,
    features: ['google_search'],
  },
  BRIEFING_AIRPORT: {
    envKey: 'BRIEFING_AIRPORT_MODEL',
    default: 'gemini-3-pro-preview',
    purpose: 'Airport conditions and flight status',
    maxTokens: 4096,
    temperature: 0.1,
    features: ['google_search'],
  },

  // ==========================
  // 2. STRATEGIES TABLE
  // ==========================
  STRATEGY_CORE: {
    envKey: 'STRATEGY_CORE_MODEL',
    default: 'claude-opus-4-5-20251101',
    purpose: 'Core strategic plan generation (pure reasoning)',
    maxTokens: 4096,
    temperature: 0.7,
  },
  STRATEGY_CONTEXT: {
    envKey: 'STRATEGY_CONTEXT_MODEL',
    default: 'gemini-3-pro-preview',
    purpose: 'Real-time context gathering for strategy pipeline',
    maxTokens: 8192,
    temperature: 0.4,
    features: ['google_search'],
  },
  STRATEGY_TACTICAL: {
    envKey: 'STRATEGY_TACTICAL_MODEL',
    default: 'gpt-5.2',
    purpose: 'Immediate 1-hour tactical strategy consolidation',
    maxTokens: 32000,
    reasoningEffort: 'medium',
  },
  STRATEGY_DAILY: {
    envKey: 'STRATEGY_DAILY_MODEL',
    default: 'gemini-3-pro-preview',
    purpose: 'Long-term 8-12hr daily strategy generation',
    maxTokens: 16000,
    temperature: 0.5,
    features: ['google_search'],
  },

  // ==========================
  // 3. RANKING_CANDIDATES (VENUES)
  // ==========================
  VENUE_SCORER: {
    envKey: 'VENUE_SCORER_MODEL',
    default: 'gpt-5.2',
    purpose: 'Smart Blocks venue scoring and selection',
    maxTokens: 16000,
    reasoningEffort: 'medium',
  },
  VENUE_FILTER: {
    envKey: 'VENUE_FILTER_MODEL',
    // 2026-01-05: Updated from deprecated claude-3-5-haiku-20241022 to latest
    default: 'claude-3-5-haiku-latest',
    purpose: 'Fast low-cost venue filtering',
    maxTokens: 200,
    temperature: 0,
  },
  VENUE_TRAFFIC: {
    envKey: 'VENUE_TRAFFIC_MODEL',
    default: 'gemini-3-pro-preview',
    purpose: 'Venue-specific traffic intelligence',
    maxTokens: 4096,
    temperature: 0.1,
    features: ['google_search'],
  },
  VENUE_EVENT_VERIFIER: {
    envKey: 'VENUE_EVENT_VERIFIER_MODEL',
    default: 'gemini-3-pro-preview',
    purpose: 'Verify venue events during SmartBlocks enrichment',
    maxTokens: 256,
    temperature: 0.1,
    // No search needed - just validation of existing data
  },

  // ==========================
  // 4. COACH_CONVERSATIONS
  // ==========================
  COACH_CHAT: {
    envKey: 'COACH_CHAT_MODEL',
    default: 'gemini-3-pro-preview',
    purpose: 'AI Strategy Coach conversation (streaming)',
    maxTokens: 8192,
    temperature: 0.7,
    features: ['google_search'],
  },

  // ==========================
  // 5. UTILITIES (no direct DB write)
  // ==========================
  UTIL_WEATHER_VALIDATOR: {
    envKey: 'UTIL_WEATHER_VALIDATOR_MODEL',
    default: 'gemini-3-pro-preview',
    purpose: 'Validate weather data structure',
    maxTokens: 2048,
    temperature: 0.1,
  },
  UTIL_TRAFFIC_VALIDATOR: {
    envKey: 'UTIL_TRAFFIC_VALIDATOR_MODEL',
    default: 'gemini-3-pro-preview',
    purpose: 'Validate traffic data structure',
    maxTokens: 2048,
    temperature: 0.1,
  },
  UTIL_MARKET_PARSER: {
    envKey: 'UTIL_PARSER_MODEL',
    default: 'gpt-5.2',
    purpose: 'Parsing unstructured market research data',
    maxTokens: 16000,
    reasoningEffort: 'low',
  },
};

// ==========================
// LEGACY ROLE MAPPING
// ==========================
// Maps old role names to new {TABLE}_{FUNCTION} names
// Supports backward compatibility during migration
export const LEGACY_ROLE_MAP = {
  'strategist': 'STRATEGY_CORE',
  'briefer': 'STRATEGY_CONTEXT',
  'consolidator': 'STRATEGY_TACTICAL',
  'event_validator': 'BRIEFING_EVENTS_VALIDATOR',
  'venue_planner': 'VENUE_SCORER',
  'venue_filter': 'VENUE_FILTER',
  'haiku': 'VENUE_FILTER',  // Legacy name for fast venue filtering
  'coach': 'COACH_CHAT',
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
 * Roles that support fallback when primary model fails
 */
export const FALLBACK_ENABLED_ROLES = [
  'STRATEGY_TACTICAL',
  'STRATEGY_CONTEXT',
  'STRATEGY_DAILY',
  'BRIEFING_EVENTS_DISCOVERY',
  'BRIEFING_NEWS',
];

/**
 * Centralized fallback configuration
 */
export const FALLBACK_CONFIG = {
  model: 'claude-opus-4-5-20251101',
  maxTokens: 16000,
  temperature: 0.3,
};

/**
 * Get provider for a model name
 * @param {string} model - Model name (e.g., 'gpt-5.2', 'claude-opus-4-5-20251101')
 * @returns {string} Provider name ('openai', 'anthropic', 'google', 'unknown')
 */
export function getProviderForModel(model) {
  for (const [prefix, provider] of Object.entries(PROVIDERS)) {
    if (model.startsWith(prefix)) return provider;
  }
  return 'unknown';
}

/**
 * Resolve a role name (handles legacy names)
 * @param {string} role - Role name (legacy or new format)
 * @returns {string} Canonical role name
 */
export function resolveRoleName(role) {
  const upper = role.toUpperCase();
  // Check if it's already a valid new-style role
  if (MODEL_ROLES[upper]) {
    return upper;
  }
  // Check legacy mapping
  const lower = role.toLowerCase();
  if (LEGACY_ROLE_MAP[lower]) {
    const mapped = LEGACY_ROLE_MAP[lower];
    console.log(`📋 [REGISTRY] Legacy role "${role}" → "${mapped}"`);
    return mapped;
  }
  return upper; // Return as-is, will fail in getRoleConfig if invalid
}

/**
 * Get full configuration for a role
 * @param {string} role - Role key (e.g., 'BRIEFING_WEATHER' or legacy 'strategist')
 * @returns {Object} Full role configuration with resolved model
 */
export function getRoleConfig(role) {
  const canonicalRole = resolveRoleName(role);
  const roleConfig = MODEL_ROLES[canonicalRole];

  if (!roleConfig) {
    throw new Error(`Unknown model role: ${role} (resolved to: ${canonicalRole})`);
  }

  const envValue = process.env[roleConfig.envKey];
  const model = envValue || roleConfig.default;
  const provider = getProviderForModel(model);
  const isEnvOverride = !!envValue;

  // Log role configuration resolution
  const features = roleConfig.features?.join(', ') || 'none';
  const tablePrefix = canonicalRole.split('_')[0];
  const sourceInfo = isEnvOverride ? `env:${roleConfig.envKey}` : 'default';

  console.log(`📋 [REGISTRY] ┌─────────────────────────────────────────────`);
  console.log(`📋 [REGISTRY] │ Role:     ${canonicalRole}`);
  console.log(`📋 [REGISTRY] │ Purpose:  ${roleConfig.purpose}`);
  console.log(`📋 [REGISTRY] │ Model:    ${model} (${sourceInfo})`);
  console.log(`📋 [REGISTRY] │ Provider: ${provider}`);
  console.log(`📋 [REGISTRY] │ Table:    ${tablePrefix.toLowerCase()}s`);
  console.log(`📋 [REGISTRY] │ Features: ${features}`);
  if (roleConfig.maxTokens) console.log(`📋 [REGISTRY] │ Tokens:   ${roleConfig.maxTokens}`);
  if (roleConfig.reasoningEffort) console.log(`📋 [REGISTRY] │ Effort:   ${roleConfig.reasoningEffort}`);
  console.log(`📋 [REGISTRY] └─────────────────────────────────────────────`);

  return {
    ...roleConfig,
    role: canonicalRole,
    model,
    provider,
  };
}

/**
 * Check if a role uses Google Search (Gemini)
 * @param {string} role - Role name
 * @returns {boolean}
 */
export function roleUsesGoogleSearch(role) {
  const canonicalRole = resolveRoleName(role);
  const config = MODEL_ROLES[canonicalRole];
  return config?.features?.includes('google_search') || false;
}

/**
 * Check if a role uses Web Search (Anthropic)
 * @param {string} role - Role name
 * @returns {boolean}
 */
export function roleUsesWebSearch(role) {
  const canonicalRole = resolveRoleName(role);
  const config = MODEL_ROLES[canonicalRole];
  return config?.features?.includes('web_search') || false;
}

/**
 * Check if a role uses OpenAI Web Search (GPT-5.2)
 * 2026-01-05: Added for dual-model news fetching
 * @param {string} role - Role name
 * @returns {boolean}
 */
export function roleUsesOpenAIWebSearch(role) {
  const canonicalRole = resolveRoleName(role);
  const config = MODEL_ROLES[canonicalRole];
  return config?.features?.includes('openai_web_search') || false;
}

/**
 * Check if fallback is enabled for a role
 * @param {string} role - Role name
 * @returns {boolean}
 */
export function isFallbackEnabled(role) {
  const canonicalRole = resolveRoleName(role);
  return FALLBACK_ENABLED_ROLES.includes(canonicalRole);
}

/**
 * Get all roles grouped by table/destination
 * @returns {Object} Roles grouped by prefix
 */
export function getRolesByTable() {
  const groups = {
    BRIEFING: [],
    STRATEGY: [],
    VENUE: [],
    COACH: [],
    UTIL: [],
  };

  for (const role of Object.keys(MODEL_ROLES)) {
    const prefix = role.split('_')[0];
    if (groups[prefix]) {
      groups[prefix].push(role);
    }
  }

  return groups;
}

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

// ==========================
// LLM DIAGNOSTICS
// ==========================
// Replaces routerDiagnosticsV2 from deprecated llm-router-v2.js
// Updated 2026-01-05

/**
 * Get LLM diagnostics for health check endpoints
 * Reports which AI providers are configured based on API keys
 * @returns {{ providers: Array<{key: string, model: string}>, preferred: string, fallbacks: string }}
 */
export function getLLMDiagnostics() {
  const providers = [];

  // Check Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    const model = process.env.ANTHROPIC_MODEL || 'claude-opus-4-5-20251101';
    providers.push({ key: 'anthropic', model });
  }

  // Check OpenAI
  if (process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_MODEL || 'gpt-5.2';
    providers.push({ key: 'openai', model });
  }

  // Check Gemini
  if (process.env.GEMINI_API_KEY) {
    const model = process.env.GEMINI_MODEL || 'gemini-3-pro-preview';
    providers.push({ key: 'google', model });
  }

  return {
    providers,
    preferred: process.env.PREFERRED_MODEL || 'google:gemini-3-pro-preview',
    fallbacks: process.env.FALLBACK_MODELS || 'openai:gpt-5.2,anthropic:claude-opus-4-5-20251101',
  };
}

/**
 * Get simple LLM status for monitoring
 * @returns {{ configured: number, providers: string[] }}
 */
export function getLLMStatus() {
  const diag = getLLMDiagnostics();
  return {
    configured: diag.providers.length,
    providers: diag.providers.map(p => p.key),
  };
}
