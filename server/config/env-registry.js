// server/config/env-registry.js
// Centralized environment variable registry
// Single source of truth for all env vars used by the system

/**
 * Environment variable definitions
 * required: true = app won't start without it
 * required: false = optional with default
 */
export const ENV_VARS = {
  // === Server ===
  PORT: {
    required: false,
    default: '5000',
    description: 'HTTP server port',
  },
  NODE_ENV: {
    required: false,
    default: 'development',
    description: 'Environment mode (development, production)',
  },

  // === Database ===
  DATABASE_URL: {
    required: true,
    description: 'PostgreSQL connection string',
    sensitive: true,
  },
  DATABASE_URL_UNPOOLED: {
    required: false,
    description: 'Direct PostgreSQL connection (for migrations)',
    sensitive: true,
  },
  PG_MAX: {
    required: false,
    default: '10',
    description: 'Max database pool connections',
  },
  PG_MIN: {
    required: false,
    default: '2',
    description: 'Min database pool connections',
  },
  PG_IDLE_TIMEOUT_MS: {
    required: false,
    default: '30000',
    description: 'Database idle connection timeout',
  },

  // === AI API Keys ===
  ANTHROPIC_API_KEY: {
    required: true,
    description: 'Anthropic API key for Claude models',
    sensitive: true,
  },
  OPENAI_API_KEY: {
    required: true,
    description: 'OpenAI API key for GPT-5.2, TTS, Realtime',
    sensitive: true,
  },
  GEMINI_API_KEY: {
    required: true,
    description: 'Google Gemini API key',
    sensitive: true,
  },

  // === Google APIs ===
  GOOGLE_MAPS_API_KEY: {
    required: true,
    description: 'Google Maps Platform key (Places, Routes, Weather, Geocoding)',
    sensitive: true,
  },

  // === Strategy Model Configuration ===
  STRATEGY_STRATEGIST: {
    required: false,
    default: 'claude-opus-4-6',
    description: 'Model for minstrategy generation',
  },
  STRATEGY_BRIEFER: {
    required: false,
    default: 'gemini-3.1-pro-preview',
    description: 'Model for briefing (events, traffic, news)',
  },
  STRATEGY_CONSOLIDATOR: {
    required: false,
    default: 'gpt-5.5-2026-04-23',
    description: 'Model for immediate strategy consolidation',
  },
  STRATEGY_EVENT_VALIDATOR: {
    required: false,
    default: 'claude-opus-4-6',
    description: 'Model for event validation (with web search)',
  },
  STRATEGY_VENUE_PLANNER: {
    required: false,
    default: 'gpt-5.5-2026-04-23',
    description: 'Model for venue planning',
  },

  // === Timeouts ===
  TRIAD_TIMEOUT_MS: {
    required: false,
    default: '50000',
    description: 'TRIAD pipeline timeout',
  },
  PLANNER_DEADLINE_MS: {
    required: false,
    default: '30000',
    description: 'Venue planner deadline',
  },
  BRIEFING_TIMEOUT_MS: {
    required: false,
    default: '15000',
    description: 'Briefing generation timeout',
  },

  // === Voice ===
  // 2026-04-25: Realtime API requires a realtime-class model, not a chat model.
  // Previous default 'gpt-5.4' was wrong-class and would 4xx against /v1/realtime/sessions.
  VOICE_MODEL: {
    required: false,
    default: 'gpt-realtime',
    description: 'OpenAI Realtime voice-to-voice model (must be realtime class)',
  },

  // === External APIs ===
  TOMTOM_API_KEY: {
    required: false,
    description: 'TomTom Traffic API key',
    sensitive: true,
  },
  PERPLEXITY_API_KEY: {
    required: false,
    description: 'Perplexity API key (holiday detection)',
    sensitive: true,
  },

  // === Auth ===
  JWT_SECRET: {
    required: false,
    description: 'JWT signing secret (dev fallback available)',
    sensitive: true,
  },
  AGENT_TOKEN: {
    required: false,
    description: 'Bearer token for agent server endpoints',
    sensitive: true,
  },

  // === Deployment ===
  REPLIT_DEPLOYMENT: {
    required: false,
    description: 'Set to 1 in production deployments',
  },
  K_SERVICE: {
    required: false,
    description: 'Cloud Run service name (auto-set)',
  },
  CLOUD_RUN_AUTOSCALE: {
    required: false,
    description: 'Enable autoscale optimizations (Cloud Run)',
  },
  // 2026-02-25: Added for Replit-native autoscale detection
  REPLIT_AUTOSCALE: {
    required: false,
    description: 'Enable autoscale optimizations (Replit native)',
  },
  // 2026-02-25: Registered — was used but never in the registry
  ENABLE_BACKGROUND_WORKER: {
    required: false,
    default: 'false',
    description: 'Explicitly enable background strategy worker process',
  },
  FAST_BOOT: {
    required: false,
    description: 'Skip cache warmup on boot',
  },
};

/**
 * Get an environment variable with validation
 * @param {string} key - Environment variable name
 * @param {Object} options - { throwOnMissing: boolean }
 * @returns {string|undefined} Value or default
 */
export function getEnv(key, { throwOnMissing = false } = {}) {
  const spec = ENV_VARS[key];

  if (!spec) {
    console.warn(`[env-registry] Unknown env var: ${key}`);
    return process.env[key];
  }

  const value = process.env[key] ?? spec.default;

  if (!value && spec.required) {
    const msg = `Missing required env var: ${key} - ${spec.description}`;
    if (throwOnMissing) {
      throw new Error(msg);
    }
    console.error(`[env-registry] ${msg}`);
  }

  return value;
}

/**
 * Validate all required environment variables
 * @returns {{ valid: boolean, missing: string[], warnings: string[] }}
 */
export function validateEnv() {
  const missing = [];
  const warnings = [];

  for (const [key, spec] of Object.entries(ENV_VARS)) {
    const value = process.env[key];

    if (spec.required && !value) {
      missing.push(`${key}: ${spec.description}`);
    }

    if (!spec.required && !value && !spec.default) {
      warnings.push(`${key}: Not set (optional)`);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

/**
 * Log environment configuration (safe - no secrets)
 */
export function logEnvConfig() {
  console.log('[env-registry] Configuration:');

  for (const [key, spec] of Object.entries(ENV_VARS)) {
    const value = process.env[key];
    const display = spec.sensitive
      ? (value ? '***SET***' : '(not set)')
      : (value ?? spec.default ?? '(not set)');

    const status = spec.required
      ? (value ? '✓' : '✗ MISSING')
      : (value ? '✓' : '○');

    console.log(`  ${status} ${key}: ${display}`);
  }
}

// 2026-02-25: Removed isProduction() and isDevelopment() — environment-based branching
// is an anti-pattern in autoscale deployments. Route logic by capability flags instead
// (e.g., ENABLE_BACKGROUND_WORKER, CLOUD_RUN_AUTOSCALE, REPLIT_AUTOSCALE).
