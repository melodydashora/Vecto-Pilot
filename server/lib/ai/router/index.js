/**
 * LLM Router Factory
 * Configures and exports router instances for different use cases
 */

import { HedgedRouter } from './hedged-router.js';
import { ConcurrencyGate } from './concurrency-gate.js';
import { classifyError, ErrorType, isRetriable, shouldAffectCircuitBreaker } from './error-classifier.js';

// Router mode from environment
const ROUTER_MODE = process.env.LLM_ROUTER_MODE || 'hedged';
const HEDGED_TIMEOUT = parseInt(process.env.LLM_HEDGED_TIMEOUT_MS || '8000', 10);

// Shared concurrency gate for all routers
const sharedGate = new ConcurrencyGate({
  maxConcurrent: parseInt(process.env.LLM_MAX_CONCURRENT_PER_PROVIDER || '10', 10),
  queueTimeout: 30000
});

// Router mode configuration by role
export const ROUTER_CONFIG = {
  // Speed-critical roles use hedged routing
  STRATEGY_TACTICAL: { mode: 'hedged', timeout: 8000 },
  BRIEFING_TRAFFIC: { mode: 'hedged', timeout: 8000 },
  BRIEFING_EVENTS: { mode: 'hedged', timeout: 8000 },

  // Accuracy-critical roles use single provider
  STRATEGY_CORE: { mode: 'single', timeout: 30000 },
  VENUE_SCORER: { mode: 'single', timeout: 15000 },
  ENRICHMENT: { mode: 'single', timeout: 20000 },

  // Default for unspecified roles
  DEFAULT: { mode: ROUTER_MODE, timeout: HEDGED_TIMEOUT }
};

/**
 * Get router configuration for a specific role
 * @param {string} role
 * @returns {{ mode: string, timeout: number }}
 */
export function getRouterConfig(role) {
  return ROUTER_CONFIG[role] || ROUTER_CONFIG.DEFAULT;
}

/**
 * Create a hedged router instance
 * @param {Object} options
 * @returns {HedgedRouter}
 */
export function createHedgedRouter(options = {}) {
  return new HedgedRouter({
    timeout: options.timeout || HEDGED_TIMEOUT,
    providers: options.providers || ['anthropic', 'openai', 'google'],
    concurrencyGate: sharedGate,
    adapters: options.adapters,
    circuitThreshold: options.circuitThreshold || 5,
    circuitResetMs: options.circuitResetMs || 60000
  });
}

/**
 * Get the shared concurrency gate for external monitoring
 * @returns {ConcurrencyGate}
 */
export function getSharedGate() {
  return sharedGate;
}

// Re-export components
export {
  HedgedRouter,
  ConcurrencyGate,
  classifyError,
  ErrorType,
  isRetriable,
  shouldAffectCircuitBreaker
};

export default {
  createHedgedRouter,
  getRouterConfig,
  getSharedGate,
  ROUTER_CONFIG,
  HedgedRouter,
  ConcurrencyGate,
  classifyError,
  ErrorType
};
