/**
 * Standardized Logging Utility
 * Provides consistent logging across all modules with correlation IDs
 */

import { randomUUID } from 'crypto';

// Global correlation ID stack (for request context)
const correlationStack = [];

export function getCorrelationId() {
  return correlationStack[correlationStack.length - 1] || randomUUID().substring(0, 8);
}

export function setCorrelationId(id) {
  correlationStack.push(id);
  return () => correlationStack.pop();
}

/**
 * Create a logger instance for a module
 * @param {string} module - Module name (e.g., 'gateway', 'blocks-router', 'db-client')
 * @returns {Object} Logger object with info, warn, error methods
 */
export function createLogger(module) {
  return {
    info: (message, data = {}) => {
      const correlationId = getCorrelationId();
      console.log(`[${module}:${correlationId}] ℹ️  ${message}`, data && Object.keys(data).length > 0 ? data : '');
    },
    
    warn: (message, data = {}) => {
      const correlationId = getCorrelationId();
      console.warn(`[${module}:${correlationId}] ⚠️  ${message}`, data && Object.keys(data).length > 0 ? data : '');
    },
    
    error: (message, err = null, data = {}) => {
      const correlationId = getCorrelationId();
      const errorMsg = err?.message || (typeof err === 'string' ? err : '');
      console.error(`[${module}:${correlationId}] ❌ ${message}`, errorMsg, data && Object.keys(data).length > 0 ? data : '');
      if (err?.stack) console.error(`   Stack: ${err.stack.split('\n').slice(0, 3).join('\n   ')}`);
    },
    
    debug: (message, data = {}) => {
      if (process.env.DEBUG === 'true') {
        const correlationId = getCorrelationId();
        console.debug(`[${module}:${correlationId}] 🔍 ${message}`, data && Object.keys(data).length > 0 ? data : '');
      }
    },
    
    // For SSE and streaming responses
    stream: (message, data = {}) => {
      const correlationId = getCorrelationId();
      console.log(`[${module}:${correlationId}] 📡 ${message}`, data && Object.keys(data).length > 0 ? data : '');
    }
  };
}

// Default logger instance
export const logger = createLogger('app');
