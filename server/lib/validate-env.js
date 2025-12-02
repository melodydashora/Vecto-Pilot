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
  const hasGoogle = !!process.env.GOOGLE_AI_API_KEY;
  
  if (!hasAnthropic && !hasOpenAI && !hasGoogle) {
    errors.push('At least one AI provider API key required: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_AI_API_KEY');
  }
  
  // CRITICAL: Google Maps (required for location services)
  if (!process.env.GOOGLE_MAPS_API_KEY && !process.env.VITE_GOOGLE_MAPS_API_KEY) {
    errors.push('GOOGLE_MAPS_API_KEY or VITE_GOOGLE_MAPS_API_KEY is required for location services');
  }
  
  // WARNINGS: Optional but recommended services
  if (!process.env.OPENWEATHER_API_KEY) {
    warnings.push('OPENWEATHER_API_KEY not set - weather data will be unavailable');
  }
  
  if (!process.env.GOOGLEAQ_API_KEY) {
    warnings.push('GOOGLEAQ_API_KEY not set - air quality data will be unavailable');
  }
  
  if (!process.env.PERPLEXITY_API_KEY) {
    warnings.push('PERPLEXITY_API_KEY not set - briefing research will be limited');
  }
  
  // Model configuration validation
  const strategist = process.env.STRATEGY_STRATEGIST || 'claude-sonnet-4-5-20250929';
  const briefer = process.env.STRATEGY_BRIEFER || 'sonar-pro';
  const consolidator = process.env.STRATEGY_CONSOLIDATOR || 'gpt-5.1-2025-11-13';
  
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
  const mode = process.env.MODE || 'mono';
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
  const result = validateEnvironment();
  
  if (!result.valid) {
    console.error('[env-validation] Server startup aborted due to configuration errors');
    process.exit(1);
  }
  
  return result;
}
