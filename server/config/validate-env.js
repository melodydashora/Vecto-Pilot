// server/config/validate-env.js
// Environment validation at startup - fast-fail for missing critical variables.
// 2026-05-13: Migrated NODE_ENV reads to APP_RUNTIME (Phase 2 v2 §3, §7 D6).

import { resolveAppRuntime } from './load-env.js';

/**
 * Validate required environment variables at server startup
 * Fails fast with clear error messages to prevent misconfigured deployments
 */
export function validateEnvironment() {
  const errors = [];
  const warnings = [];

  // CRITICAL: Database connection (required for all modes)
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is required (Replit PostgreSQL)');
  }

  // CRITICAL: AI providers (at least one required for strategy generation)
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;

  if (!hasAnthropic && !hasOpenAI && !hasGemini) {
    errors.push('At least one AI provider API key required: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY');
  }

  // CRITICAL: Google Maps (required for location services)
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    errors.push('GOOGLE_MAPS_API_KEY is required for location services');
  }

  // 2026-03-17: SECURITY FIX (F-12) — Auth secret validation.
  // Production MUST have a proper JWT_SECRET; dev falls back to REPLIT_DEVSERVER_INTERNAL_ID.
  // 2026-05-03: AUTH-003 — JWT_SECRET now signs standard JWTs (HS256) via server/lib/jwt.js.
  // Legacy 2-segment HMAC tokens are still verified during the transition window via
  // server/middleware/auth.js dual-verify dispatch; same secret powers both paths in v1.
  // 2026-05-13: isDeployment is now derived from APP_RUNTIME (sanctioned env-class enum)
  // rather than NODE_ENV (build-mode only, owned by Vite/framework). See env-registry.js
  // doctrine comment. Fixes Phase 1 recon audit deviation #3 where workspace inherited
  // prod severity escalation because the wrapper forced NODE_ENV='production'.
  const isDeployment = resolveAppRuntime() === 'deployment';
  if (isDeployment && !process.env.JWT_SECRET) {
    errors.push('JWT_SECRET is required in production (JWT signing will fail)');
  } else if (!process.env.JWT_SECRET && !process.env.REPLIT_DEVSERVER_INTERNAL_ID) {
    warnings.push('JWT_SECRET not set and no REPLIT_DEVSERVER_INTERNAL_ID fallback — JWTs cannot be signed');
  }

  // 2026-04-09: Promoted to production error. Without this secret, agent/system auth
  // endpoints reject ALL requests — that's not a degradation, it's a broken feature.
  if (!process.env.VECTO_AGENT_SECRET) {
    if (isDeployment) {
      errors.push('VECTO_AGENT_SECRET not set — agent/system auth endpoints will reject all requests');
    } else {
      warnings.push('VECTO_AGENT_SECRET not set — agent/system auth endpoints will reject all requests');
    }
  }

  // WARNINGS: Optional but recommended services
  if (!process.env.OPENWEATHER_API_KEY) {
    warnings.push('OPENWEATHER_API_KEY not set - weather data will be unavailable');
  }

  if (!process.env.GOOGLEAQ_API_KEY) {
    warnings.push('GOOGLEAQ_API_KEY not set - air quality data will be unavailable');
  }

  // 2026-02-19: Uber OAuth validation (only when Uber integration is configured)
  // 2026-04-09: Promoted to production errors. If Uber is configured but deps are missing,
  // that's not a "warning" — Uber auth is BROKEN and users will hit a wall at runtime.
  const hasAnyUberConfig = !!(process.env.UBER_CLIENT_ID || process.env.UBER_CLIENT_SECRET || process.env.UBER_REDIRECT_URI);
  if (hasAnyUberConfig) {
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      if (isDeployment) {
        errors.push('TOKEN_ENCRYPTION_KEY not set — Uber OAuth is configured but token encryption will fail');
      } else {
        warnings.push('TOKEN_ENCRYPTION_KEY not set - Uber auth will fail');
      }
    }
    if (!process.env.UBER_CLIENT_ID || !process.env.UBER_CLIENT_SECRET || !process.env.UBER_REDIRECT_URI) {
      if (isDeployment) {
        errors.push('Uber OAuth credentials (CLIENT_ID, SECRET, REDIRECT_URI) not fully configured — Uber integration is broken');
      } else {
        warnings.push('Uber OAuth credentials (CLIENT_ID, SECRET, REDIRECT_URI) not fully configured');
      }
    }
  }

  // Port validation
  // 2026-05-13: EIDOLON_PORT fallback dropped (Phase 2 v2 §7 D2). EIDOLON_PORT is the
  // SDK port (3102), not the gateway port (5000); including it as a fallback here was
  // a Replit Agent port-role conflation (Step B B3). EIDOLON_PORT remains a real var
  // with live callsites in shared/ports.js, shared/config.js, diagnostic-identity.js.
  const port = parseInt(process.env.PORT || '5000');
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`Invalid PORT: ${port} (must be 1-65535)`);
  }

  // Deployment mode validation
  // 2026-05-13: MODE legacy alias dropped (Phase 2 v2 §7 D3). Grep-verify confirmed
  // zero JS callers outside this file. APP_MODE is now the sole mode signal.
  const mode = process.env.APP_MODE || 'mono';
  const validModes = ['mono', 'split'];
  if (!validModes.includes(mode)) {
    warnings.push(`Invalid MODE: ${mode} (expected: mono or split) - defaulting to mono`);
  }

  // Results
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;

  if (hasErrors) {
    console.error('\nENVIRONMENT VALIDATION FAILED\n');
    errors.forEach((err, i) => {
      console.error(`  ${i + 1}. ${err}`);
    });
    console.error('\nFix these errors and restart the server.\n');
    return { valid: false, errors, warnings };
  }

  if (hasWarnings) {
    console.warn('\n ENVIRONMENT WARNINGS\n');
    warnings.forEach((warn, i) => {
      console.warn(`  ${i + 1}. ${warn}`);
    });
    console.warn('\n');
  }

  console.log('Environment validation passed');
  return { valid: true, errors: [], warnings };
}

/**
 * Validate and exit if critical errors found
 * Use this at server startup to prevent misconfigured deployments
 */
export function validateOrExit() {
  // Skip exit in test mode to allow test runner to mock env or handle errors.
  // 2026-05-13: Migrated from NODE_ENV to APP_RUNTIME per Manifesto §3, §7 D6.
  if (resolveAppRuntime() === 'test') {
    console.log('[CONFIG] [ENV] [VALIDATION] Test mode detected - skipping fatal exit');
    return { valid: true, errors: [], warnings: [] };
  }

  const result = validateEnvironment();

  if (!result.valid) {
    console.error('[CONFIG] [ENV] [VALIDATION] Server startup aborted due to configuration errors');
    process.exit(1);
  }

  return result;
}
