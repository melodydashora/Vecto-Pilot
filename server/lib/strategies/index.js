// server/lib/strategies/index.js
// Centralized strategy provider registry
// Prevents ReferenceError from undefined strategy functions

import { generateStrategyForSnapshot } from '../strategy-generator.js';

// Provider map - all strategy generators registered here
export const providers = {
  // Primary strategy generator (Claude Opus 4.1 → Gemini → GPT-5 consolidation)
  triad: generateStrategyForSnapshot,
  
  // Alias for backward compatibility
  consolidated: generateStrategyForSnapshot,
  
  // Future: Add additional providers here
  // anthropic: claudeOnlyStrategy,
  // openai: gptOnlyStrategy,
};

// Startup assertion - fails fast if providers are not functions
export function assertStrategies() {
  const required = ['triad', 'consolidated'];
  
  for (const name of required) {
    if (typeof providers[name] !== 'function') {
      throw new Error(`Strategy provider '${name}' not registered or not a function - check imports`);
    }
  }
  
  console.log(`✅ Strategy providers validated: ${Object.keys(providers).join(', ')}`);
}

// Get a strategy provider by name with validation
export function getStrategyProvider(providerName = 'triad') {
  const provider = providers[providerName];
  
  if (!provider) {
    const available = Object.keys(providers).join(', ');
    throw new Error(`Unknown strategy provider: ${providerName}. Available: ${available}`);
  }
  
  return provider;
}
