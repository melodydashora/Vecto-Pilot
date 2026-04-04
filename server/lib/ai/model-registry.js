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
// ============================================================================
// AVAILABLE MODELS — Verified via API 2026-03-28
// ============================================================================
//
// ANTHROPIC (9 models):
//   claude-opus-4-6                (Latest flagship, best reasoning + code)
//   claude-sonnet-4-6              (Fast + intelligent)
//   claude-opus-4-5-20251101       (Previous gen flagship)
//   claude-sonnet-4-5-20250929     (Previous gen fast)
//   claude-opus-4-1-20250805       (Legacy)
//   claude-opus-4-20250514         (Legacy)
//   claude-sonnet-4-20250514       (Legacy)
//   claude-haiku-4-5-20251001      (Fastest, cheapest — filtering/classification)
//   claude-3-haiku-20240307        (Legacy Haiku)
//
// OPENAI (chat/reasoning models — 128 total including image/audio/embedding):
//   gpt-5.4           (2026-03-05)  — Latest flagship
//   gpt-5.4-pro       (2026-03-04)  — Latest extended reasoning
//   gpt-5.4-mini      (2026-03-14)  — Latest fast/cheap
//   gpt-5.4-nano      (2026-03-14)  — Latest ultra-cheap
//   gpt-5.3-chat-latest             — Previous gen
//   gpt-5.4           (2026-03-05)  — Current default for venue/tactical roles
//   gpt-5.4-pro       (2026-03-04)  — Extended reasoning
//   gpt-5.2           (2025-12-09)  — Previous default
//   gpt-5.1 / gpt-5                 — Older generations
//   o3-pro / o3 / o4-mini           — Reasoning-specialized
//   gpt-5-search-api                — Web search grounded
//
// GOOGLE GEMINI (generation models — 48 total including image/video/audio):
//   gemini-3.1-pro-preview          (Latest Pro, 1M input, 65K output, thinking)
//   gemini-3.1-flash-lite-preview   (Latest ultra-cheap)
//   gemini-3-pro-preview            (Previous Pro)
//   gemini-3-flash-preview          (Fast/cheap, thinking supports LOW/MED/HIGH)
//   gemini-2.5-pro                  (Stable release, 1M input, 65K output)
//   gemini-2.5-flash                (Stable flash, 1M input)
//   gemini-2.0-flash                (Legacy fast)
//
// SPECIALTY MODELS (available but not assigned to roles):
//   gemini-2.5-flash-native-audio-*    (Realtime voice via bidiGenerateContent)
//   gemini-3-pro-image-preview         (Vision-optimized, "Nano Banana Pro")
//   gemini-3.1-flash-image-preview     (Image generation, "Nano Banana 2")
//   gemini-3.1-pro-preview-customtools (Custom tool use)
//   gpt-5.2-codex / gpt-5.4-pro       (Code-specialized)
//   o3-deep-research                   (Long-form research)
//
// ============================================================================
//
// Last updated: 2026-03-28 (verified via scripts/verify-models.mjs)

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
    default: 'gemini-3.1-pro-preview',
    purpose: 'Weather intelligence with web search',
    maxTokens: 4096,
    temperature: 0.1,
    features: ['google_search'],
  },
  // 2026-01-15: Upgraded from Flash to Pro per "Single Briefer Model" architecture
  // Rationale: Traffic requires complex synthesis of TomTom JSON (incidents, flow segments)
  // into actionable "Driver Advice". Pro's reasoning is needed for accurate spatial analysis.
  // 2026-02-11: Added thinkingLevel HIGH + bumped tokens 4096→8192 (thinking consumes output tokens)
  BRIEFING_TRAFFIC: {
    envKey: 'BRIEFING_TRAFFIC_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'Traffic conditions analysis (TomTom JSON → Driver Advice)',
    maxTokens: 8192,
    temperature: 0.2,
    thinkingLevel: 'HIGH',
    features: ['google_search'],
  },
  // 2026-01-10: Added thinkingLevel HIGH for news analysis
  BRIEFING_NEWS: {
    envKey: 'BRIEFING_NEWS_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'Local news research (last 7 days) - Gemini + Google Search',
    maxTokens: 8192,
    temperature: 0.4,
    thinkingLevel: 'HIGH',
    features: ['google_search'],
  },
  // 2026-01-14: DEPRECATED - Dual-model news fetch removed
  // News now uses single Briefer model (BRIEFING_NEWS = Gemini 3 Pro with Google Search)
  // This role is NO LONGER CALLED - kept for backwards compatibility only
  // Original: BRIEFING_NEWS_GPT used GPT-5.2 in parallel with Gemini for news
  // 2026-01-10: Added thinkingLevel HIGH for event discovery accuracy
  BRIEFING_EVENTS_DISCOVERY: {
    envKey: 'BRIEFING_EVENTS_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'Event discovery (parallel category search)',
    maxTokens: 8192,
    temperature: 0.4,
    thinkingLevel: 'HIGH',
    features: ['google_search'],
  },
  // 2026-02-26: BRIEFING_EVENTS_VALIDATOR removed — dead code, never called.
  // Validation happens via validateEventsHard() at store time in briefing-service.js.
  // 2026-02-11: Added thinkingLevel HIGH for consistent briefing quality
  BRIEFING_FALLBACK: {
    envKey: 'BRIEFING_FALLBACK_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'General fallback for failed briefing calls',
    maxTokens: 8192,
    temperature: 0.3,
    thinkingLevel: 'HIGH',
    features: ['google_search'],
  },
  // 2026-02-11: Added thinkingLevel HIGH for consistent briefing quality
  BRIEFING_SCHOOLS: {
    envKey: 'BRIEFING_SCHOOLS_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'School closures and calendar lookup',
    maxTokens: 8192,
    temperature: 0.2,
    thinkingLevel: 'HIGH',
    features: ['google_search'],
  },
  BRIEFING_AIRPORT: {
    envKey: 'BRIEFING_AIRPORT_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'Airport conditions and flight status',
    maxTokens: 4096,
    temperature: 0.1,
    features: ['google_search'],
  },
  // 2026-02-13: Registered — was previously a direct callGemini in holiday-detector.js
  BRIEFING_HOLIDAY: {
    envKey: 'BRIEFING_HOLIDAY_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'Holiday detection with real-time search verification',
    maxTokens: 1024,
    temperature: 0.1,
    thinkingLevel: 'HIGH',
    features: ['google_search'],
  },

  // ==========================
  // 2. STRATEGIES TABLE
  // ==========================
  // 2026-02-13: Claude Opus 4.6 — best reasoning model for core strategy generation
  STRATEGY_CORE: {
    envKey: 'STRATEGY_CORE_MODEL',
    default: 'claude-opus-4-6',
    purpose: 'Core strategic plan generation',
    maxTokens: 8192,
    temperature: 0.7,
  },
  // 2026-01-10: Added thinkingLevel HIGH for deeper analysis (token budget sufficient)
  STRATEGY_CONTEXT: {
    envKey: 'STRATEGY_CONTEXT_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'Real-time context gathering for strategy pipeline',
    maxTokens: 8192,
    temperature: 0.4,
    thinkingLevel: 'HIGH',
    features: ['google_search'],
  },
  // 2026-02-26: Switched GPT-5.2 → Claude Opus 4.6 — all strategy roles use Claude
  STRATEGY_TACTICAL: {
    envKey: 'STRATEGY_TACTICAL_MODEL',
    default: 'claude-opus-4-6',
    purpose: 'Immediate 1-hour tactical strategy consolidation',
    maxTokens: 16000,
    temperature: 0.5,
  },
  // 2026-02-26: Switched Gemini → Claude Opus 4.6 — all strategy roles use Claude
  STRATEGY_DAILY: {
    envKey: 'STRATEGY_DAILY_MODEL',
    default: 'claude-opus-4-6',
    purpose: 'Long-term 8-12hr daily strategy generation',
    maxTokens: 16000,
    temperature: 0.5,
  },

  // ==========================
  // 3. RANKING_CANDIDATES (VENUES)
  // ==========================
  // 2026-03-28: Upgraded gpt-5.2 → gpt-5.4 (verified via API, released 2026-03-05)
  VENUE_SCORER: {
    envKey: 'VENUE_SCORER_MODEL',
    default: 'gpt-5.4',
    purpose: 'SmartBlocks venue scoring and selection',
    maxTokens: 16000,
    reasoningEffort: 'medium',
  },
  VENUE_FILTER: {
    envKey: 'VENUE_FILTER_MODEL',
    // 2026-01-14: Claude Haiku primary, Gemini Flash fallback (see FALLBACK_CONFIG)
    default: 'claude-haiku-4-5-20251001',
    // 2026-02-18: Enhanced from binary keep/remove to quality classification (P/S/X)
    purpose: 'Fast low-cost venue classification (premium/standard/remove)',
    maxTokens: 300,
    temperature: 0,
  },
  VENUE_TRAFFIC: {
    envKey: 'VENUE_TRAFFIC_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'Venue-specific traffic intelligence',
    maxTokens: 4096,
    temperature: 0.1,
    features: ['google_search'],
  },
  VENUE_EVENT_VERIFIER: {
    envKey: 'VENUE_EVENT_VERIFIER_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'Verify venue events during SmartBlocks enrichment',
    maxTokens: 256,
    temperature: 0.1,
    // No search needed - just validation of existing data
  },
  // ==========================
  // 4. COACH_CONVERSATIONS
  // ==========================
  // 2026-02-13: Gemini 3 Pro Preview — vision, OCR, Google Search, multimodal
  // 2026-02-17: Renamed COACH_CHAT → AI_COACH to match user-facing "AI Coach" branding
  // 2026-02-26: Upgraded to Gemini 3.1 Pro — 2x reasoning over 3.0 Pro (ARC-AGI-2: 77.1%)
  AI_COACH: {
    envKey: 'AI_COACH_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'AI Coach conversation (streaming, multimodal)',
    maxTokens: 8192,
    temperature: 0.7,
    features: ['google_search', 'vision', 'ocr'],
    // 2026-02-17: AI_COACH uses callModelStream() which only supports Gemini.
    // Non-Gemini overrides are rejected by the streaming guard below.
    requiresStreaming: true,
  },

  // ==========================
  // 5. UTILITIES (no direct DB write)
  // ==========================
  UTIL_RESEARCH: {
    envKey: 'UTIL_RESEARCH_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'Internet-powered research via API',
    maxTokens: 2000,
    temperature: 0.3,
    features: ['google_search'],
  },
  UTIL_WEATHER_VALIDATOR: {
    envKey: 'UTIL_WEATHER_VALIDATOR_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'Validate weather data structure',
    maxTokens: 2048,
    temperature: 0.1,
  },
  UTIL_TRAFFIC_VALIDATOR: {
    envKey: 'UTIL_TRAFFIC_VALIDATOR_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'Validate traffic data structure',
    maxTokens: 2048,
    temperature: 0.1,
  },
  // 2026-03-28: Upgraded gpt-5.2 → gpt-5.4
  UTIL_MARKET_PARSER: {
    envKey: 'UTIL_PARSER_MODEL',
    default: 'gpt-5.4',
    purpose: 'Parsing unstructured market research data',
    maxTokens: 16000,
    reasoningEffort: 'low',
  },

  // ==========================
  // 7. CONCIERGE (public event/venue discovery)
  // ==========================
  // 2026-02-13: Public-facing event search for Concierge QR code page
  CONCIERGE_SEARCH: {
    envKey: 'CONCIERGE_SEARCH_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'Public concierge event/venue discovery (no auth required)',
    maxTokens: 4096,
    temperature: 0.3,
    thinkingLevel: 'LOW',
    features: ['google_search'],
  },
  // 2026-02-13: Public-facing AI Q&A for passenger concierge page
  CONCIERGE_CHAT: {
    envKey: 'CONCIERGE_CHAT_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'Public concierge Q&A — passengers ask about local area',
    maxTokens: 2048,
    temperature: 0.5,
    thinkingLevel: 'LOW',
    features: ['google_search'],
  },

  // ==========================
  // 8. TRANSLATION (real-time rider communication)
  // ==========================
  // 2026-03-16: Added for FIFA World Cup rider translation feature.
  // Flash for speed — translation is extraction/mapping, not reasoning.
  // Sub-200ms target for real-time conversational UX.
  UTIL_TRANSLATION: {
    envKey: 'UTIL_TRANSLATION_MODEL',
    default: 'gemini-3-flash-preview',
    purpose: 'Real-time text translation for driver-rider communication',
    maxTokens: 512,
    temperature: 0.1, // Near-deterministic for consistent translations
  },

  // ==========================
  // 9. SIRI HOOKS (offer_intelligence)
  // ==========================
  // 2026-02-15: Dedicated role for real-time ride offer analysis via Siri Shortcuts.
  // 2026-02-26: Reverted Pro → Flash. Pro with thinking timed out Siri Shortcuts (~30s limit).
  // Flash is purpose-built for fast vision extraction: <2s for screenshot → JSON decision.
  // No thinking needed — this is OCR + math + rule application, not reasoning.
  OFFER_ANALYZER: {
    envKey: 'OFFER_ANALYZER_MODEL',
    default: 'gemini-3-flash-preview',
    purpose: 'Phase 1: Real-time ride offer analysis from Siri Shortcuts (ACCEPT/REJECT)',
    maxTokens: 1024, // Minimal — just JSON decision + short reasoning
    temperature: 0.1, // Near-deterministic for consistent decisions
    // No thinkingLevel — Flash doesn't need it for OCR/extraction tasks
    features: ['vision'],
  },

  // 2026-02-28: Phase 2 deep analysis — runs async AFTER Siri gets its fast response.
  // Pro 3.1 provides richer reasoning, location analysis, and confidence scoring for DB storage.
  // Not latency-sensitive — driver already has their answer from Flash.
  OFFER_ANALYZER_DEEP: {
    envKey: 'OFFER_ANALYZER_DEEP_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'Phase 2: Async deep ride offer analysis for DB enrichment (runs after Siri response)',
    maxTokens: 2048,
    temperature: 0.2,
    thinkingLevel: 'LOW', // Pro only supports LOW/HIGH; LOW gives reasoning boost without full latency
    features: ['vision'],
  },

  // ==========================
  // 9. INTERNAL AGENTS
  // ==========================
  DOCS_GENERATOR: {
    envKey: 'DOCS_GENERATOR_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'Autonomous documentation generation',
    maxTokens: 8192,
    temperature: 0.7,
    thinkingLevel: 'HIGH',
    skipJsonExtraction: true,
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
  // 2026-02-26: 'event_validator' removed — BRIEFING_EVENTS_VALIDATOR was dead code
  'venue_planner': 'VENUE_SCORER',
  'venue_filter': 'VENUE_FILTER',
  'haiku': 'VENUE_FILTER',  // Legacy name for fast venue filtering
  'coach': 'AI_COACH',
  'COACH_CHAT': 'AI_COACH',  // 2026-02-17: Backward compat for old role name
};

/**
 * Provider detection by model name prefix
 */
// 2026-03-28: Added o3-/o4- prefixes (verified available via API)
export const PROVIDERS = {
  'gpt-': 'openai',
  'o1-': 'openai',
  'o3-': 'openai',
  'o3': 'openai',
  'o4-': 'openai',
  'claude-': 'anthropic',
  'gemini-': 'google',
};

/**
 * Roles that support fallback when primary model fails
 */
// 2026-02-26: ALL BRIEFING_* roles removed from hedged fallback.
// Briefing data fields use Gemini with google_search exclusively. Cross-provider fallback
// may return data in slightly different JSON formats (different field names, structure).
// The briefing parsers use safeJsonParse() with citation suppression + parser hardening.
// 2026-04-04: FIX H-3 — Added BRIEFING_WEATHER, BRIEFING_TRAFFIC, BRIEFING_SCHOOLS,
// BRIEFING_AIRPORT. Previously excluded because fallback was same-provider (Gemini Flash).
// Since getFallbackConfig() now routes Google → GPT-5.4 for cross-provider redundancy,
// having NO fallback means complete data loss on Gemini outage. Some data with possible
// format variance is better than zero data.
export const FALLBACK_ENABLED_ROLES = [
  'STRATEGY_TACTICAL',
  'STRATEGY_CONTEXT',
  'STRATEGY_DAILY',
  'VENUE_FILTER',           // 2026-01-14: Added for Anthropic credit fallback
  'STRATEGY_CORE',          // 2026-01-14: Added for Anthropic credit fallback
  'BRIEFING_WEATHER',       // 2026-04-04: H-3 — weather must not silently fail
  'BRIEFING_TRAFFIC',       // 2026-04-04: H-3 — traffic analysis is driver-critical
  'BRIEFING_SCHOOLS',       // 2026-04-04: H-3 — school closures affect traffic patterns
  'BRIEFING_AIRPORT',       // 2026-04-04: H-3 — airport conditions for airport drivers
  // 2026-02-26: OFFER_ANALYZER removed — vision mode can't be hedged to non-vision fallback.
  // OpenAI adapter doesn't pass images → GPT-5.2 responds first with empty data, discarding
  // Gemini's actual vision analysis. Gemini-only is correct for image-based offer analysis.
];

/**
 * Centralized fallback configuration
 * 2026-01-14: Changed to Gemini 3 Flash for Anthropic credit issues
 * This is a TEMPORARY fallback - Claude remains the primary model
 */
export const FALLBACK_CONFIG = {
  model: 'gemini-3-flash-preview',
  maxTokens: 8192,
  temperature: 0.2,
  features: ['google_search'], // Gemini tool for web search if needed
};

/**
 * Get cross-provider fallback configuration based on primary provider.
 * 2026-02-17: FIX - Ensures fallback is ALWAYS a different provider than primary.
 *
 * Previous bug: FALLBACK_CONFIG used gemini-3-flash-preview for ALL roles.
 * When the primary was also Google (Gemini 3 Pro), the fallback was filtered out
 * because same-provider fallback is skipped. Result: 18 Gemini-primary roles
 * had ZERO redundancy — a single Google outage killed the entire briefing pipeline.
 *
 * @param {string} primaryProvider - The primary provider ('google', 'anthropic', 'openai')
 * @returns {Object} Fallback config with model from a different provider
 */
export function getFallbackConfig(primaryProvider) {
  if (primaryProvider === 'google') {
    // Google primary → OpenAI fallback (cross-provider redundancy)
    // Uses gpt-5-search-api via callOpenAIWithWebSearch for roles needing web search
    // 2026-03-28: Upgraded gpt-5.2 → gpt-5.4
    return {
      model: 'gpt-5.4',
      maxTokens: 8192,
      reasoningEffort: 'low',
    };
  }
  // Anthropic/OpenAI primary → Gemini Flash fallback (existing behavior)
  return { ...FALLBACK_CONFIG };
}

/**
 * Get provider for a model name
 * @param {string} model - Model name (e.g., 'gpt-5.4', 'claude-opus-4-6')
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

  // 1. Role-specific Env (Highest Priority)
  let model = process.env[roleConfig.envKey];
  let sourceInfo = `env:${roleConfig.envKey}`;

  // 2. Service Override (Medium Priority)
  // Check if this role belongs to a service that has a global override
  if (!model) {
    // Agent roles (excluding DOCS_GENERATOR — it has specific model requirements)
    // 2026-02-26: DOCS_GENERATOR removed from AGENT_OVERRIDE_MODEL fallback.
    // Reason: DOCS_GENERATOR needs Gemini (Google Search, prompt format). Inheriting
    // claude-opus-4-6 from AGENT_OVERRIDE causes 9-char responses and validation failures.
    if (canonicalRole === 'AGENT_TASK') {
      if (process.env.AGENT_OVERRIDE_MODEL) {
        model = process.env.AGENT_OVERRIDE_MODEL;
        sourceInfo = 'env:AGENT_OVERRIDE_MODEL';
      }
    }
    // AI Coach roles
    // 2026-02-17: Renamed ASSISTANT_OVERRIDE → AI_COACH_OVERRIDE
    else if (canonicalRole === 'AI_COACH' || canonicalRole.startsWith('COACH_')) {
      if (process.env.AI_COACH_OVERRIDE_MODEL) {
        model = process.env.AI_COACH_OVERRIDE_MODEL;
        sourceInfo = 'env:AI_COACH_OVERRIDE_MODEL';
      }
    }
    // Strategy roles
    else if (canonicalRole.startsWith('STRATEGY_')) {
      // Optional: Could have STRATEGY_OVERRIDE_MODEL, but usually defaults or role-specific are fine
    }
  }

  // 3. Registry Default (Lowest Priority)
  if (!model) {
    model = roleConfig.default;
    sourceInfo = 'default';
  }

  // 2026-02-17: Streaming guard — roles with requiresStreaming MUST use Gemini.
  // If an env override resolved to a non-Gemini model, reject it and use the default.
  // This prevents AI_COACH_OVERRIDE_MODEL=claude-opus-4-6 from breaking AI_COACH streaming.
  if (roleConfig.requiresStreaming && !model.startsWith('gemini-')) {
    console.warn(`📋 [REGISTRY] ⚠️ ${canonicalRole} requires streaming (Gemini only), but resolved to ${model} (${sourceInfo}). Falling back to default: ${roleConfig.default}`);
    model = roleConfig.default;
    sourceInfo = 'default (streaming fallback)';
  }

  const provider = getProviderForModel(model);

  // Log role configuration resolution
  const features = roleConfig.features?.join(', ') || 'none';
  const tablePrefix = canonicalRole.split('_')[0];

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
    CONCIERGE: [],
    DOCS: [],
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
 * 2026-02-15: Added Pro-specific quirks (F-002). Enforced by gemini-adapter.js validateThinkingLevel().
 *
 * Prefix matching: hasQuirk() checks model.startsWith(prefix) || model.includes(prefix).
 * More specific prefixes (e.g. 'gemini-3-pro') are checked alongside broader ones ('gemini-').
 */
export const MODEL_QUIRKS = {
  // 2026-03-28: Broadened from 'gpt-5.2' to 'gpt-5' to cover entire GPT-5 family
  // (5.0, 5.1, 5.2, 5.3, 5.4+). All use max_completion_tokens + reasoning_effort.
  'gpt-5': {
    noTemperature: true,
    useReasoningEffort: true,
    useMaxCompletionTokens: true,
  },
  'o1-': {
    noTemperature: true,
    useReasoningEffort: true,
    useMaxCompletionTokens: true,
  },
  // 2026-03-28: Added o3/o4 quirks (verified available: o3, o3-pro, o3-mini, o4-mini)
  'o3': {
    noTemperature: true,
    useReasoningEffort: true,
    useMaxCompletionTokens: true,
  },
  'o4-': {
    noTemperature: true,
    useReasoningEffort: true,
    useMaxCompletionTokens: true,
  },
  'gemini-': {
    useThinkingConfig: true,
    safetySettingsRequired: true,
  },
  // 2026-02-15: F-002 — Pro models only support LOW and HIGH thinking levels.
  // MEDIUM is Flash-only. Enforced at runtime by gemini-adapter.js validateThinkingLevel().
  'gemini-3-pro': {
    noMediumThinking: true,
    validThinkingLevels: ['LOW', 'HIGH'],
  },
  // 2026-02-25: Gemini 3.1 Pro inherits same thinking constraints as 3 Pro
  'gemini-3.1-pro': {
    noMediumThinking: true,
    validThinkingLevels: ['LOW', 'HIGH'],
  },
  'gemini-3-flash': {
    validThinkingLevels: ['LOW', 'MEDIUM', 'HIGH'],
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
    const model = process.env.ANTHROPIC_MODEL || 'claude-opus-4-6';
    providers.push({ key: 'anthropic', model });
  }

  // Check OpenAI
  if (process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_MODEL || 'gpt-5.4';
    providers.push({ key: 'openai', model });
  }

  // Check Gemini
  if (process.env.GEMINI_API_KEY) {
    const model = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';
    providers.push({ key: 'google', model });
  }

  return {
    providers,
    preferred: process.env.PREFERRED_MODEL || 'google:gemini-3.1-pro-preview',
    fallbacks: process.env.FALLBACK_MODELS || 'openai:gpt-5.4,anthropic:claude-opus-4-6',
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