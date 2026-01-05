// server/lib/ai/index.js - Barrel exports for AI module
// Model adapters, providers, and utilities

// Main adapter - USE THIS for all AI calls
export { callModel } from './adapters/index.js';

// Individual adapters (for direct access if needed)
export { callAnthropic } from './adapters/anthropic-adapter.js';
export { callAnthropicSonnet45 } from './adapters/anthropic-sonnet45.js';
export { callOpenAI } from './adapters/openai-adapter.js';
export { callGemini } from './adapters/gemini-adapter.js';
export { callGemini25Pro } from './adapters/gemini-2.5-pro.js';

// Strategy providers
export { runBriefing } from './providers/briefing.js';
export { runImmediateStrategy, runConsolidator } from './providers/consolidator.js';

// Data access
export { coachDAL } from './coach-dal.js';

// Utilities
export { getLLMStatus } from './llm-router-v2.js';
export { MODELS } from './models-dictionary.js';
export { unifiedCapabilities } from './unified-ai-capabilities.js';

// Module summary:
// - adapters/index.js: Main dispatcher - callModel(role, {system, user})
// - adapters/*: Provider-specific adapters
// - providers/briefing.js: Gemini-based briefing generation
// - providers/consolidator.js: Strategy consolidation (STRATEGY_TACTICAL + STRATEGY_DAILY roles)
// - coach-dal.js: Data access layer for AI Coach
// - llm-router-v2.js: LLM status for health checks
// - models-dictionary.js: Model metadata registry
// - unified-ai-capabilities.js: AI capability manager
