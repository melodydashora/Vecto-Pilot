// server/lib/ai/index.js - Barrel exports for AI module
// Model adapters, providers, and utilities
// Updated 2026-01-05: Removed deprecated llm-router-v2.js and gemini-2.5-pro.js exports

// Main adapter - USE THIS for all AI calls
export { callModel } from './adapters/index.js';

// Individual adapters (for direct access if needed)
export { callAnthropic } from './adapters/anthropic-adapter.js';
export { callAnthropicSonnet45 } from './adapters/anthropic-sonnet45.js';
export { callOpenAI } from './adapters/openai-adapter.js';
export { callGemini } from './adapters/gemini-adapter.js';

// Strategy providers
export { runBriefing } from './providers/briefing.js';
export { runImmediateStrategy, runConsolidator } from './providers/consolidator.js';

// Data access
export { coachDAL } from './coach-dal.js';

// Utilities - now from model-registry.js (updated 2026-01-05)
export { getLLMStatus, getLLMDiagnostics } from './model-registry.js';
export { MODELS } from './models-dictionary.js';
export { unifiedCapabilities } from './unified-ai-capabilities.js';

// Module summary:
// - adapters/index.js: Main dispatcher - callModel(role, {system, user})
// - adapters/*: Provider-specific adapters
// - providers/briefing.js: Gemini-based briefing generation
// - providers/consolidator.js: Strategy consolidation (STRATEGY_TACTICAL + STRATEGY_DAILY roles)
// - coach-dal.js: Data access layer for AI Coach
// - model-registry.js: Role configuration, LLM status and diagnostics
// - models-dictionary.js: Model metadata registry
// - unified-ai-capabilities.js: AI capability manager
