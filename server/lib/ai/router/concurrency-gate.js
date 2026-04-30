/**
 * Concurrency Gate for LLM Router
 * Manages concurrent request limits per provider
 */

const DEFAULT_MAX_CONCURRENT = 10;
const DEFAULT_QUEUE_TIMEOUT = 30000; // 30 seconds

export class ConcurrencyGate {
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent || DEFAULT_MAX_CONCURRENT;
    this.queueTimeout = options.queueTimeout || DEFAULT_QUEUE_TIMEOUT;

    // Track active requests per provider
    this.activeRequests = new Map(); // provider -> count
    this.waitingQueue = new Map();   // provider -> Array<{resolve, reject, timer}>
  }

  /**
   * Get current count of active requests for a provider
   * @param {string} provider
   * @returns {number}
   */
  getActiveCount(provider) {
    return this.activeRequests.get(provider) || 0;
  }

  /**
   * Check if a provider has capacity for new requests
   * @param {string} provider
   * @returns {boolean}
   */
  hasCapacity(provider) {
    return this.getActiveCount(provider) < this.maxConcurrent;
  }

  /**
   * Acquire a slot for a provider. Waits if at capacity.
   * @param {string} provider
   * @param {AbortSignal} [signal] - Optional abort signal
   * @returns {Promise<void>}
   */
  async acquire(provider, signal) {
    // Check if immediately available
    if (this.hasCapacity(provider)) {
      this._incrementActive(provider);
      return;
    }

    // Wait for a slot
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._removeFromQueue(provider, entry);
        reject(new Error(`Queue timeout waiting for ${provider} slot`));
      }, this.queueTimeout);

      const entry = {
        resolve: () => {
          clearTimeout(timer);
          this._incrementActive(provider);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer
      };

      // Handle abort signal
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          this._removeFromQueue(provider, entry);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      }

      // Add to queue
      if (!this.waitingQueue.has(provider)) {
        this.waitingQueue.set(provider, []);
      }
      this.waitingQueue.get(provider).push(entry);
    });
  }

  /**
   * Release a slot for a provider
   * @param {string} provider
   */
  release(provider) {
    const current = this.getActiveCount(provider);
    if (current > 0) {
      this.activeRequests.set(provider, current - 1);
    }

    // Check waiting queue
    const queue = this.waitingQueue.get(provider);
    if (queue && queue.length > 0) {
      const next = queue.shift();
      if (queue.length === 0) {
        this.waitingQueue.delete(provider);
      }
      // Resolve the waiting promise
      next.resolve();
    }
  }

  /**
   * Get stats for monitoring
   * @returns {Object}
   */
  getStats() {
    const stats = {
      providers: {}
    };

    for (const [provider, count] of this.activeRequests) {
      stats.providers[provider] = {
        active: count,
        waiting: (this.waitingQueue.get(provider) || []).length,
        capacity: this.maxConcurrent
      };
    }

    return stats;
  }

  // Private methods
  _incrementActive(provider) {
    const current = this.getActiveCount(provider);
    this.activeRequests.set(provider, current + 1);
  }

  _removeFromQueue(provider, entry) {
    const queue = this.waitingQueue.get(provider);
    if (queue) {
      const idx = queue.indexOf(entry);
      if (idx !== -1) {
        queue.splice(idx, 1);
      }
      if (queue.length === 0) {
        this.waitingQueue.delete(provider);
      }
    }
  }
}

// Singleton instance with default settings
export const defaultGate = new ConcurrencyGate();

export default ConcurrencyGate;
