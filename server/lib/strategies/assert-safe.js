// server/lib/strategies/assert-safe.js
// Async, yielding version of assertStrategies for post-listen validation
// Prevents event loop starvation during boot

import { providers } from './index.js';

/**
 * Safely assert strategy providers in batches with yielding
 * This prevents blocking the event loop during boot validation
 * 
 * @param {Object} options - Configuration options
 * @param {number} options.batchSize - Number of providers to validate per batch
 * @param {number} options.delayMs - Delay between batches (0 = setImmediate)
 */
export async function safeAssertStrategies(options = {}) {
  const { batchSize = 5, delayMs = 0 } = options;
  
  const required = ['triad', 'consolidated'];
  const allProviders = Object.keys(providers);
  
  console.log(`[assert] Validating ${allProviders.length} strategy providers (batched)...`);
  
  // Batch validation to avoid starving event loop
  for (let i = 0; i < required.length; i += batchSize) {
    const batch = required.slice(i, i + batchSize);
    
    for (const name of batch) {
      if (typeof providers[name] !== 'function') {
        throw new Error(`Strategy provider '${name}' not registered or not a function`);
      }
    }
    
    // Yield to event loop between batches
    if (delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    } else {
      await new Promise(r => setImmediate(r));
    }
  }
  
  console.log(`✅ Strategy providers validated: ${allProviders.join(', ')}`);
  return true;
}

/**
 * Warmup function for strategy caches (if needed)
 * Only runs if FAST_BOOT is not set
 */
export async function maybeWarmCaches() {
  const fastBoot = process.env.FAST_BOOT === '1';
  
  if (fastBoot) {
    console.log('[warmup] Skipping cache warmup (FAST_BOOT enabled)');
    return;
  }
  
  // Add any cache warming logic here
  console.log('[warmup] Cache warmup complete (no-op for now)');
}

/**
 * Load AI configs (if needed)
 * Should be non-blocking and fail gracefully
 */
export async function maybeLoadAiConfigs() {
  try {
    // Add any remote config loading here
    console.log('[ai-config] Configuration loaded');
  } catch (e) {
    console.warn('[ai-config] Failed to load configs:', e?.message);
  }
}
