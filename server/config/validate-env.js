// server/lib/validate-env.js
// Environment validation at startup - fast-fail for missing critical variables

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
  const hasGemini = !!process.env.GEMINI_API_KEY || !!process.env.GOOGLE_AI_API_KEY;
  
  if (!hasAnthropic && !hasOpenAI && !hasGemini) {
    errors.push('At least one AI provider API key required: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY');
  }

  if (process.env.GOOGLE_AI_API_KEY && !process.env.GEMINI_API_KEY) {
    warnings.push('GOOGLE_AI_API_KEY is deprecated - use GEMINI_API_KEY instead');
  }
  
  // CRITICAL: Google Maps (required for location services)
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    errors.push('GOOGLE_MAPS_API_KEY is required for location services');
  }
  
  // WARNINGS: Optional but recommended services
  if (!process.env.OPENWEATHER_API_KEY) {
    warnings.push('OPENWEATHER_API_KEY not set - weather data will be unavailable');
  }
  
  if (!process.env.GOOGLEAQ_API_KEY) {
    warnings.push('GOOGLEAQ_API_KEY not set - air quality data will be unavailable');
  }

  // Uber OAuth & Encryption (Optional but recommended for full feature set)
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    warnings.push('TOKEN_ENCRYPTION_KEY not set - Uber auth will fail');
  }
  if (!process.env.UBER_CLIENT_ID || !process.env.UBER_CLIENT_SECRET || !process.env.UBER_REDIRECT_URI) {
    warnings.push('Uber OAuth credentials (CLIENT_ID, SECRET, REDIRECT_URI) not fully configured');
  }
  
  // Model configuration validation
  const strategist = process.env.STRATEGY_STRATEGIST || 'claude-opus-4-6';
  const briefer = process.env.STRATEGY_BRIEFER || 'gemini-3-pro-preview';
  const consolidator = process.env.STRATEGY_CONSOLIDATOR || 'gpt-5.2';
  
  console.log('[env-validation] AI Model Configuration:', {
    strategist,
    briefer,
    consolidator
  });
  
  // Port validation
  const port = parseInt(process.env.PORT || process.env.EIDOLON_PORT || '5000');
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`Invalid PORT: ${port} (must be 1-65535)`);
  }
  
  // Deployment mode validation
  const mode = process.env.APP_MODE || process.env.MODE || 'mono';
  const validModes = ['mono', 'split'];
  if (!validModes.includes(mode)) {
    warnings.push(`Invalid MODE: ${mode} (expected: mono or split) - defaulting to mono`);
  }
  
  // Results
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  
  if (hasErrors) {
    console.error('\n❌ ENVIRONMENT VALIDATION FAILED\n');
    errors.forEach((err, i) => {
      console.error(`  ${i + 1}. ${err}`);
    });
    console.error('\nFix these errors and restart the server.\n');
    return { valid: false, errors, warnings };
  }
  
  if (hasWarnings) {
    console.warn('\n⚠️  ENVIRONMENT WARNINGS\n');
    warnings.forEach((warn, i) => {
      console.warn(`  ${i + 1}. ${warn}`);
    });
    console.warn('\n');
  }
  
  console.log('✅ Environment validation passed');
  return { valid: true, errors: [], warnings };
}

/**
 * Validate and exit if critical errors found
 * Use this at server startup to prevent misconfigured deployments
 */
export function validateOrExit() {
  // Skip exit in test mode to allow test runner to mock env or handle errors
  if (process.env.NODE_ENV === 'test') {
    console.log('[env-validation] Test mode detected - skipping fatal exit');
    return { valid: true, errors: [], warnings: [] };
  }

  const result = validateEnvironment();
  
  if (!result.valid) {
    console.error('[env-validation] Server startup aborted due to configuration errors');
    process.exit(1);
  }
  
  return result;
}
