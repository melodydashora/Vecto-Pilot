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
    description: 'Build-mode only (Vite/framework verbosity). NOT consumed by app logic at runtime — use APP_RUNTIME for runtime-topology decisions per the doctrine comment at the bottom of this file.',
  },

  // 2026-05-13: APP_RUNTIME is the sanctioned environment-class enum (see doctrine
  // comment at bottom of file). Replaces NODE_ENV as the runtime-topology signal.
  APP_RUNTIME: {
    required: false,
    description: 'Runtime topology: workspace | deployment | test. Resolution at module load: explicit env var > derived from REPLIT_DEPLOYMENT === "1" → deployment > default "workspace". Set explicitly in .replit:run as APP_RUNTIME=workspace; test runner sets APP_RUNTIME=test. Resolution implemented in gateway-server.js.',
  },

  APP_MODE: {
    required: false,
    default: 'mono',
    description: 'Process topology: mono (default; gateway + embedded agent) | split (gateway + standalone agent-server.js on AGENT_PORT). Read by gateway-server.js:35, validate-env.js:94.',
  },
  MODE: {
    required: false,
    description: 'DEPRECATED — legacy alias for APP_MODE. Slated for removal in Phase 2 v2 deletion D3. Both still accepted by validate-env.js:94 during transition.',
  },
  TRUST_PROXY_HOPS: {
    required: false,
    default: '1',
    description: 'Express trust-proxy hop count for req.ip resolution. 0 = distrust all X-Forwarded-For; 1 = trust single edge (Replit/Cloud Run/Cloudflare); 2+ = multi-hop CDN chain. Read by gateway-server.js:94.',
  },
  EIDOLON_PORT: {
    required: false,
    description: 'Legacy SDK port (default 3102 in shared/ports.js). Separate from gateway PORT. Read by shared/ports.js:15, shared/config.js:20, server/api/health/diagnostic-identity.js:17. Note: the misplaced fallback at validate-env.js:88 is dropped in Phase 2 v2 deletion D2.',
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
  GOOGLE_AI_API_KEY: {
    required: false,
    description: 'DEPRECATED — use GEMINI_API_KEY. Accepted by validate-env.js:23 as a Gemini auth alias with deprecation warning at validate-env.js:29-31 when set without GEMINI_API_KEY. Hard removal was attempted in Step 2 (Manifesto §7 D4) but Codex review on PR #33 caught that the operator surface (Replit Secrets, .env files) had not been verified as migrated; deprecation cycle restored in Step 8. Hard removal deferred until the warning cycle surfaces operator-side migration completion.',
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
    default: 'claude-opus-4-8',
    description: 'Model for main strategy generation',
  },
  STRATEGY_BRIEFER: {
    required: false,
    default: 'gemini-3.5-flash',
    description: 'Model for briefing (events, traffic, news)',
  },
  STRATEGY_CONSOLIDATOR: {
    required: false,
    default: 'gpt-5.5-2026-04-23',
    description: 'Model for immediate strategy consolidation',
  },
  STRATEGY_EVENT_VALIDATOR: {
    required: false,
    default: 'claude-opus-4-8',
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
  OPENWEATHER_API_KEY: {
    required: false,
    description: 'OpenWeather API key. Warning if missing — weather data degrades gracefully (validate-env.js:58).',
    sensitive: true,
  },
  GOOGLEAQ_API_KEY: {
    required: false,
    description: 'Google Air Quality API key. Warning if missing — AQ data unavailable (validate-env.js:62).',
    sensitive: true,
  },

  // === Auth ===
  JWT_SECRET: {
    required: false,
    description: 'JWT (HS256) signing secret — see server/lib/jwt.js (dev fallback: REPLIT_DEVSERVER_INTERNAL_ID)',
    sensitive: true,
  },
  AGENT_TOKEN: {
    required: false,
    description: 'Bearer token for agent server endpoints',
    sensitive: true,
  },
  VECTO_AGENT_SECRET: {
    required: false,
    description: 'Bearer secret for agent/system auth endpoints. Hard error in APP_RUNTIME=deployment (agent endpoints reject all requests without it). Warning otherwise. Read by validate-env.js:49.',
    sensitive: true,
  },
  REPLIT_DEVSERVER_INTERNAL_ID: {
    required: false,
    description: 'Dev-only fallback for JWT_SECRET when unset. Auto-injected by Replit IDE in workspace; absent in deployment. Read by validate-env.js:43, server/lib/jwt.js.',
    sensitive: true,
  },
  TOKEN_ENCRYPTION_KEY: {
    required: false,
    description: 'AES key for Uber OAuth token encryption at rest. Required if any UBER_* var is set. Hard error in APP_RUNTIME=deployment (Uber auth breaks). Warning otherwise. Read by validate-env.js:71.',
    sensitive: true,
  },

  // === Uber Integration ===
  UBER_CLIENT_ID: {
    required: false,
    description: 'Uber OAuth client ID. If set, CLIENT_SECRET and REDIRECT_URI must also be set. Read by validate-env.js:69,78.',
    sensitive: true,
  },
  UBER_CLIENT_SECRET: {
    required: false,
    description: 'Uber OAuth client secret. Required if UBER_CLIENT_ID is set.',
    sensitive: true,
  },
  UBER_REDIRECT_URI: {
    required: false,
    description: 'Uber OAuth redirect URI. Required if UBER_CLIENT_ID is set.',
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
  DISABLE_SPAWN_AGENT: {
    required: false,
    description: 'When set to "1", gateway does not spawn embedded agent. Used in workflow mode where agent runs as standalone process on AGENT_PORT (43717). Read by server/agent/embed.js.',
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
    console.warn(`[CONFIG] [ENV] Unknown env var: ${key}`);
    return process.env[key];
  }

  const value = process.env[key] ?? spec.default;

  if (!value && spec.required) {
    const msg = `Missing required env var: ${key} - ${spec.description}`;
    if (throwOnMissing) {
      throw new Error(msg);
    }
    console.error(`[CONFIG] [ENV] ${msg}`);
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
  console.log('[CONFIG] [ENV] Configuration:');

  for (const [key, spec] of Object.entries(ENV_VARS)) {
    const value = process.env[key];
    const display = spec.sensitive
      ? (value ? 'set' : 'not set')
      : (value ?? spec.default ?? 'not set');

    const flag = spec.required && !value ? ' [MISSING]' : '';

    console.log(`  ${key}=${display}${flag}`);
  }
}

// 2026-05-13: Doctrine update (Phase 2 v2 startup unification, full-lead-authorization).
// APP_RUNTIME (workspace|deployment|test) is the SOLE sanctioned environment-class enum
// for branching application behavior. Every other concern routes through a capability flag.
//
// Allowed in application code: branch on APP_RUNTIME for validator severity policy,
//   test-skip policy, and any true runtime-topology decision where workspace/deployment/
//   test differ structurally.
// Disallowed in application code: NODE_ENV reads (build-mode only, owned by Vite/framework);
//   ad-hoc REPLIT_DEPLOYMENT or REPL_ID reads for non-topology concerns; resurrecting
//   isProduction()/isDevelopment() helpers.
// Allowed in infrastructure code (server/config/*, gateway-server.js pre-main bootstrap):
//   REPLIT_DEPLOYMENT may be read at module load to drive APP_RUNTIME resolution or
//   env-loading-strategy selection (see load-env.js:138-149). Once APP_RUNTIME is
//   computed, application code uses APP_RUNTIME only.
//
// Capability flags kept: ENABLE_BACKGROUND_WORKER, CLOUD_RUN_AUTOSCALE, REPLIT_AUTOSCALE,
//   DISABLE_SPAWN_AGENT, FAST_BOOT, TRUST_PROXY_HOPS, AGENT_ENABLED. These remain the
//   right tool for "can this process do X here?" — APP_RUNTIME answers only "what
//   topology am I in?", which is a strictly narrower question.
//
// Historical: isProduction()/isDevelopment() were removed 2026-02-25 because they
//   conflated build-mode with runtime topology. APP_RUNTIME re-introduces that
//   distinction cleanly without the conflation.
