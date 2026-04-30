// server/lib/strategy/index.js - Barrel exports for strategy module
// Strategy generation pipeline and utilities

// Strategy utilities
export {
  ensureStrategyRow,
  updatePhase,
  fallbackStrategy,
  PHASE_EXPECTED_DURATIONS
} from './strategy-utils.js';

// Venue planning
export { generateTacticalPlan } from './tactical-planner.js';

// Module summary:
// - strategy-utils.js: DB operations, phase tracking, fallbacks
// - tactical-planner.js: VENUE_SCORER role - tactical guidance generation
