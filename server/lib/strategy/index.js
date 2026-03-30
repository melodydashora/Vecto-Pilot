// server/lib/strategy/index.js - Barrel exports for strategy module
// Strategy generation pipeline and utilities

// Main entry points
export { generateStrategyForSnapshot } from './strategy-generator.js';
export { runSimpleStrategyPipeline } from './strategy-generator-parallel.js';

// Strategy utilities
export {
  ensureStrategyRow,
  updatePhase,
  fallbackStrategy,
  PHASE_EXPECTED_DURATIONS
} from './strategy-utils.js';

// Venue planning
export { planVenues } from './planner-gpt5.js';
export { generateTacticalPlan } from './tactical-planner.js';

// Triggers and prompts
export { detectTriggers } from './strategy-triggers.js';
export { providers, getStrategyProvider } from './providers.js';

// Validation
export { safeAssertStrategies, maybeWarmCaches } from './assert-safe.js';

// Module summary:
// - strategy-generator.js: Entry point, routes to parallel pipeline
// - strategy-generator-parallel.js: TRIAD orchestrator (Phase 1-4)
// - strategy-utils.js: DB operations, phase tracking, fallbacks
// - planner-gpt5.js: Venue planning with STRATEGY_TACTICAL role
// - tactical-planner.js: VENUE_SCORER role - tactical guidance generation
// - strategy-triggers.js: Trigger condition detection
// - providers.js: Strategy provider registry
// - assert-safe.js: Async validation, cache warming
// - strategyPrompt.js: System prompts (imported directly where needed)
