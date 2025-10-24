
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
  WEB_SEARCH_ENABLED: z.string().transform(v => v === 'true').optional()
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
  SDK: config.SDK_PORT || config.EIDOLON_PORT || 3101,
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

// Export validated config
export { config };

// CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PORTS, URLS, config };
}
