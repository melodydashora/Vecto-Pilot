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
export { generateTacticalPlan } from './tactical-planner.js';

// Triggers and prompts
export { detectTriggers } from './strategy-triggers.js';
export { providers, getStrategyProvider } from './providers.js';

// Module summary:
// - strategy-generator.js: Entry point, routes to parallel pipeline
// - strategy-generator-parallel.js: TRIAD orchestrator (Phase 1-4)
// - strategy-utils.js: DB operations, phase tracking, fallbacks
// - tactical-planner.js: VENUE_SCORER role - tactical guidance generation
// - strategy-triggers.js: Trigger condition detection
// - providers.js: Strategy provider registry
