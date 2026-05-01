// server/lib/validate-strategy-env.js
// Startup validation for required STRATEGY_* environment variables
// Fail-fast with clear error messages if critical config is missing

/**
 * Validate all required STRATEGY_* environment variables at startup
 * Exits process with clear error message if any required vars are missing
 */
export function validateStrategyEnv() {
  const requiredVars = [
    'STRATEGY_STRATEGIST',
    'STRATEGY_BRIEFER',
    'STRATEGY_CONSOLIDATOR'
  ];

  const missing = [];
  const warnings = [];

  // Check required model assignments
  for (const varName of requiredVars) {
    const value = process.env[varName];
    if (!value || value.trim().length === 0) {
      missing.push(varName);
    }
  }

  // Check API keys based on model assignments
  const strategistModel = process.env.STRATEGY_STRATEGIST;
  const brieferModel = process.env.STRATEGY_BRIEFER;
  const consolidatorModel = process.env.STRATEGY_CONSOLIDATOR;

  if (strategistModel?.startsWith('claude-') && !process.env.ANTHROPIC_API_KEY) {
    warnings.push('STRATEGY_STRATEGIST uses Claude but ANTHROPIC_API_KEY is not set');
  }
  if (strategistModel?.startsWith('gpt-') && !process.env.OPENAI_API_KEY) {
    warnings.push('STRATEGY_STRATEGIST uses GPT but OPENAI_API_KEY is not set');
  }
  if (strategistModel?.startsWith('gemini-') && !process.env.GEMINI_API_KEY) {
    warnings.push('STRATEGY_STRATEGIST uses Gemini but GEMINI_API_KEY is not set');
  }

  if (brieferModel?.startsWith('claude-') && !process.env.ANTHROPIC_API_KEY) {
    warnings.push('STRATEGY_BRIEFER uses Claude but ANTHROPIC_API_KEY is not set');
  }
  if (brieferModel?.startsWith('gpt-') && !process.env.OPENAI_API_KEY) {
    warnings.push('STRATEGY_BRIEFER uses GPT but OPENAI_API_KEY is not set');
  }
  if (brieferModel?.startsWith('gemini-') && !process.env.GEMINI_API_KEY) {
    warnings.push('STRATEGY_BRIEFER uses Gemini but GEMINI_API_KEY is not set');
  }

  if (consolidatorModel?.startsWith('claude-') && !process.env.ANTHROPIC_API_KEY) {
    warnings.push('STRATEGY_CONSOLIDATOR uses Claude but ANTHROPIC_API_KEY is not set');
  }
  if (consolidatorModel?.startsWith('gpt-') && !process.env.OPENAI_API_KEY) {
    warnings.push('STRATEGY_CONSOLIDATOR uses GPT but OPENAI_API_KEY is not set');
  }
  if (consolidatorModel?.startsWith('gemini-') && !process.env.GEMINI_API_KEY) {
    warnings.push('STRATEGY_CONSOLIDATOR uses Gemini but GEMINI_API_KEY is not set');
  }

  // Print configuration summary
  console.log('\n🔧 AI Strategy Pipeline Configuration:');
  console.log(`   Strategist:    ${strategistModel || 'NOT SET'}`);
  console.log(`   Briefer:       ${brieferModel || 'NOT SET'}`);
  console.log(`   Consolidator:  ${consolidatorModel || 'NOT SET'}`);

  // Print warnings
  if (warnings.length > 0) {
    console.warn('\n⚠️  Configuration warnings:');
    warnings.forEach(w => console.warn(`   - ${w}`));
  }

  // Fail-fast on missing required vars
  if (missing.length > 0) {
    console.error('\n❌ FATAL: Missing required environment variables for AI strategy pipeline:');
    missing.forEach(varName => {
      console.error(`   - ${varName} is not set`);
    });
    console.error('\nPlease configure these environment variables (see server/lib/ai/model-registry.js for valid model IDs):');
    console.error('   STRATEGY_STRATEGIST=...');
    console.error('   STRATEGY_BRIEFER=...');
    console.error('   STRATEGY_CONSOLIDATOR=...');
    console.error('\nExiting due to missing configuration...\n');
    process.exit(1);
  }

  console.log('✅ All required STRATEGY_* environment variables are set\n');
}
