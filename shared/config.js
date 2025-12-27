
// shared/config.js - Centralized configuration with validation
import { z } from 'zod';

// Environment schema
const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url().describe('PostgreSQL connection string'),
  
  // API Keys
  ANTHROPIC_API_KEY: z.string().min(10).optional(),
  OPENAI_API_KEY: z.string().min(10).optional(),
  GOOGLE_MAPS_API_KEY: z.string().min(10).optional(),
  PERPLEXITY_API_KEY: z.string().min(10).optional(),
  
  // Ports
  PORT: z.string().regex(/^\d+$/).transform(Number).default('5000'),
  GATEWAY_PORT: z.string().regex(/^\d+$/).transform(Number).optional(),
  SDK_PORT: z.string().regex(/^\d+$/).transform(Number).optional(),
  EIDOLON_PORT: z.string().regex(/^\d+$/).transform(Number).optional(),
  AGENT_PORT: z.string().regex(/^\d+$/).transform(Number).default('43717'),
  VITE_PORT: z.string().regex(/^\d+$/).transform(Number).optional(),
  
  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Tokens
  AGENT_TOKEN: z.string().min(32).optional(),
  EIDOLON_TOKEN: z.string().min(32).optional(),
  
  // Optional features
  PERPLEXITY_ENABLED: z.string().transform(v => v === 'true').optional(),
  WEB_SEARCH_ENABLED: z.string().transform(v => v === 'true').optional(),
  
  // Timeouts & Performance (from env/shared.env)
  DEFAULT_TIMEOUT_MS: z.string().regex(/^\d+$/).transform(Number).default('180000'),
  API_TIMEOUT_MS: z.string().regex(/^\d+$/).transform(Number).default('120000'),
  LLM_TIMEOUT_MS: z.string().regex(/^\d+$/).transform(Number).default('180000'),
  BROWSER_GPS_TIMEOUT_MS: z.string().regex(/^\d+$/).transform(Number).default('8000'),
  TRANSIENT_RETRY_TIMEOUT_MS: z.string().regex(/^\d+$/).transform(Number).default('45000'),
  TRANSIENT_RETRY_MAX_RETRIES: z.string().regex(/^\d+$/).transform(Number).default('6'),
  JOB_CLEANUP_INTERVAL_MS: z.string().regex(/^\d+$/).transform(Number).default('3600000'),
  ANTHROPIC_TIMEOUT_MS: z.string().regex(/^\d+$/).transform(Number).default('60000'),
  LLM_TOTAL_BUDGET_MS: z.string().regex(/^\d+$/).transform(Number).default('8000'),
  CIRCUIT_COOLDOWN_MS: z.string().regex(/^\d+$/).transform(Number).default('60000'),
  RATE_LIMIT_WINDOW_MS: z.string().regex(/^\d+$/).transform(Number).default('60000'),
  MAX_REQUESTS_PER_WINDOW: z.string().regex(/^\d+$/).transform(Number).default('10'),
  
  // Thresholds
  COORD_DELTA_THRESHOLD_KM: z.string().regex(/^\d+\.?\d*$/).transform(Number).default('0.5'),
  AIRPORT_PROXIMITY_THRESHOLD_MILES: z.string().regex(/^\d+$/).transform(Number).default('25'),
  EXPLORATION_RATE: z.string().regex(/^\d+\.?\d*$/).transform(Number).default('0.2'),
  PROXIMITY_WEIGHT: z.string().regex(/^\d+\.?\d*$/).transform(Number).default('2.0'),
  MIN_BLOCKS_RECOMMENDED: z.string().regex(/^\d+$/).transform(Number).default('6')
});

// Validate and parse environment
let config;
try {
  config = envSchema.parse(process.env);
  console.log('[config] ✅ Environment validation passed');
} catch (err) {
  if (err instanceof z.ZodError) {
    console.error('[config] ❌ Environment validation failed:');
    err.errors.forEach(error => {
      console.error(`  - ${error.path.join('.')}: ${error.message}`);
    });
    console.error('\n[config] Please check your .env file and ensure all required variables are set.');
    console.error('[config] See .env.example for reference.\n');
    process.exit(1);
  }
  throw err;
}

// Port configuration
export const PORTS = {
  GATEWAY: config.GATEWAY_PORT || config.PORT,
  SDK: config.SDK_PORT || config.EIDOLON_PORT, // No fallback - SDK not used in deployment
  AGENT: config.AGENT_PORT,
  VITE: config.VITE_PORT || 5173,
  POSTGRES: parseInt(process.env.PGPORT || '5432', 10)
};

export const URLS = {
  GATEWAY: process.env.GATEWAY_URL || `http://127.0.0.1:${PORTS.GATEWAY}`,
  SDK: process.env.SDK_URL || `http://127.0.0.1:${PORTS.SDK}`,
  AGENT: process.env.AGENT_URL || `http://127.0.0.1:${PORTS.AGENT}`,
  VITE: process.env.VITE_URL || `http://127.0.0.1:${PORTS.VITE}`
};

// Timeouts & Performance Configuration
export const TIMEOUTS = {
  DEFAULT_MS: config.DEFAULT_TIMEOUT_MS,
  API_MS: config.API_TIMEOUT_MS,
  LLM_MS: config.LLM_TIMEOUT_MS,
  BROWSER_GPS_MS: config.BROWSER_GPS_TIMEOUT_MS,
  TRANSIENT_RETRY_MS: config.TRANSIENT_RETRY_TIMEOUT_MS,
  ANTHROPIC_MS: config.ANTHROPIC_TIMEOUT_MS,
  LLM_BUDGET_MS: config.LLM_TOTAL_BUDGET_MS,
  CIRCUIT_COOLDOWN_MS: config.CIRCUIT_COOLDOWN_MS,
  RATE_LIMIT_WINDOW_MS: config.RATE_LIMIT_WINDOW_MS
};

// Thresholds & Limits
export const THRESHOLDS = {
  COORD_DELTA_KM: config.COORD_DELTA_THRESHOLD_KM,
  AIRPORT_PROXIMITY_MILES: config.AIRPORT_PROXIMITY_THRESHOLD_MILES,
  EXPLORATION_RATE: config.EXPLORATION_RATE,
  PROXIMITY_WEIGHT: config.PROXIMITY_WEIGHT,
  MIN_BLOCKS: config.MIN_BLOCKS_RECOMMENDED,
  MAX_REQUESTS_PER_WINDOW: config.MAX_REQUESTS_PER_WINDOW,
  RETRY_MAX: config.TRANSIENT_RETRY_MAX_RETRIES
};

// Export validated config
export { config };

// CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PORTS, URLS, config };
}
