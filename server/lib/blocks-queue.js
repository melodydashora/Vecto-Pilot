// server/lib/blocks-queue.js
// Async queue with capped concurrency + timeouts for /api/blocks/async

import { setTimeout as delay } from 'timers/promises';

const CONCURRENCY = Number(process.env.BLOCKS_CONCURRENCY || 4);
const TIMEOUT_MS = Number(process.env.BLOCKS_TIMEOUT_MS || 30000);

// Simple concurrency limiter (no external deps)
let activeJobs = 0;
const queue = [];

function createLimit(maxConcurrent) {
  return async function limit(fn) {
    // Wait until we have a free slot
    while (activeJobs >= maxConcurrent) {
      await new Promise(r => setTimeout(r, 100));
    }
    
    activeJobs++;
    try {
      return await fn();
    } finally {
      activeJobs--;
      // Process queue if waiting
      if (queue.length > 0) {
        const next = queue.shift();
        next();
      }
    }
  };
}

const limit = createLimit(CONCURRENCY);

/**
 * runWithTimeout: reject if fn doesn't finish in ms
 */
async function runWithTimeout(fn, ms) {
  return await Promise.race([
    fn(),
    (async () => {
      await delay(ms);
      throw new Error(`timeout ${ms}ms`);
    })()
  ]);
}

/**
 * Run blocks job with timeout and concurrency limiting
 * @param {Function} generateFn - Function that generates blocks (does heavy work)
 * @param {Object} payload - Request payload
 * @returns {Promise<Object>} Result from generateFn
 */
export async function runBlocksJobImpl(generateFn, payload) {
  return await runWithTimeout(
    () => limit(() => generateFn(payload)),
    TIMEOUT_MS
  );
}
