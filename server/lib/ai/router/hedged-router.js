/**
 * Hedged Router for LLM Calls
 * Fires concurrent requests to multiple providers, takes first response
 */

import { classifyError, ErrorType } from './error-classifier.js';
import { ConcurrencyGate } from './concurrency-gate.js';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_PROVIDERS = ['anthropic', 'openai'];

export class HedgedRouter {
  constructor(options = {}) {
    this.timeout = options.timeout || DEFAULT_TIMEOUT_MS;
    this.providers = options.providers || DEFAULT_PROVIDERS;
    this.concurrencyGate = options.concurrencyGate || new ConcurrencyGate();
    this.adapters = options.adapters || null; // Map of provider -> adapter function

    // Circuit breaker state per provider
    this.circuitState = new Map(); // provider -> { failures: number, openUntil: Date }
    this.circuitThreshold = options.circuitThreshold || 5;
    this.circuitResetMs = options.circuitResetMs || 60000;

    // Metrics
    this.metrics = {
      totalCalls: 0,
      successfulCalls: 0,
      timeouts: 0,
      byProvider: new Map()
    };
  }

  /**
   * Execute a hedged request across multiple providers
   * @param {Object} request - The LLM request (messages, options, etc.)
   * @param {Object} [options] - Override options for this call
   * @returns {Promise<{response: any, provider: string, latencyMs: number}>}
   */
  async execute(request, options = {}) {
    const timeout = options.timeout || this.timeout;
    const providers = options.providers || this.getAvailableProviders();

    if (providers.length === 0) {
      throw new Error('No available providers (all circuits open)');
    }

    this.metrics.totalCalls++;
    const startTime = Date.now();

    // Create abort controllers for each provider
    const controllers = new Map();
    providers.forEach(p => controllers.set(p, new AbortController()));

    // Create master timeout controller
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, timeout);

    try {
      // Race all providers
      const result = await this._raceProviders(request, providers, controllers, timeoutController.signal);

      // Abort all other in-flight requests
      this._abortOthers(controllers, result.provider);

      // Record success
      this.metrics.successfulCalls++;
      this._recordProviderSuccess(result.provider);

      result.latencyMs = Date.now() - startTime;
      return result;

    } catch (error) {
      const classified = classifyError(error);

      if (classified.type === ErrorType.TIMEOUT) {
        this.metrics.timeouts++;
      }

      // Abort all requests on failure
      for (const controller of controllers.values()) {
        try { controller.abort(); } catch (e) { /* ignore */ }
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Execute a single-provider request (no hedging)
   * @param {Object} request
   * @param {string} provider
   * @param {Object} [options]
   * @returns {Promise<{response: any, provider: string, latencyMs: number}>}
   */
  async executeSingle(request, provider, options = {}) {
    const timeout = options.timeout || this.timeout;
    const startTime = Date.now();

    if (!this.isProviderAvailable(provider)) {
      throw new Error(`Provider ${provider} circuit is open`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      await this.concurrencyGate.acquire(provider, controller.signal);

      const response = await this._callProvider(provider, request, controller.signal);

      this._recordProviderSuccess(provider);

      return {
        response,
        provider,
        latencyMs: Date.now() - startTime
      };
    } catch (error) {
      const classified = classifyError(error);
      if (classified.affectsCircuit) {
        this._recordProviderFailure(provider);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      this.concurrencyGate.release(provider);
    }
  }

  /**
   * Get providers with open circuits filtered out
   * @returns {string[]}
   */
  getAvailableProviders() {
    return this.providers.filter(p => this.isProviderAvailable(p));
  }

  /**
   * Check if provider circuit is closed (available)
   * @param {string} provider
   * @returns {boolean}
   */
  isProviderAvailable(provider) {
    const state = this.circuitState.get(provider);
    if (!state) return true;

    if (state.openUntil && Date.now() < state.openUntil.getTime()) {
      return false; // Circuit is open
    }

    // Circuit is half-open or closed
    return true;
  }

  /**
   * Get current metrics
   * @returns {Object}
   */
  getMetrics() {
    return {
      ...this.metrics,
      byProvider: Object.fromEntries(this.metrics.byProvider),
      circuitStates: Object.fromEntries(this.circuitState),
      concurrency: this.concurrencyGate.getStats()
    };
  }

  /**
   * Reset circuit breaker for a provider
   * @param {string} provider
   */
  resetCircuit(provider) {
    this.circuitState.delete(provider);
  }

  // Private methods

  async _raceProviders(request, providers, controllers, masterSignal) {
    const promises = providers.map(async (provider) => {
      const controller = controllers.get(provider);

      // Combine with master signal
      const combinedSignal = this._combineSignals(controller.signal, masterSignal);

      try {
        await this.concurrencyGate.acquire(provider, combinedSignal);

        const response = await this._callProvider(provider, request, combinedSignal);

        return { response, provider };
      } catch (error) {
        const classified = classifyError(error);
        if (classified.affectsCircuit) {
          this._recordProviderFailure(provider);
        }
        throw error;
      } finally {
        this.concurrencyGate.release(provider);
      }
    });

    // Return first successful response
    return Promise.any(promises);
  }

  async _callProvider(provider, request, signal) {
    if (!this.adapters) {
      throw new Error('No adapters configured for HedgedRouter');
    }

    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`No adapter found for provider: ${provider}`);
    }

    return adapter(request, { signal });
  }

  _abortOthers(controllers, winningProvider) {
    for (const [provider, controller] of controllers) {
      if (provider !== winningProvider) {
        try {
          controller.abort();
        } catch (e) {
          // Ignore abort errors
        }
      }
    }
  }

  _recordProviderSuccess(provider) {
    // Reset failure count on success
    const state = this.circuitState.get(provider);
    if (state) {
      state.failures = 0;
      state.openUntil = null;
    }

    // Update metrics
    if (!this.metrics.byProvider.has(provider)) {
      this.metrics.byProvider.set(provider, { success: 0, failure: 0 });
    }
    this.metrics.byProvider.get(provider).success++;
  }

  _recordProviderFailure(provider) {
    let state = this.circuitState.get(provider);
    if (!state) {
      state = { failures: 0, openUntil: null };
      this.circuitState.set(provider, state);
    }

    state.failures++;

    // Open circuit if threshold exceeded
    if (state.failures >= this.circuitThreshold) {
      state.openUntil = new Date(Date.now() + this.circuitResetMs);
    }

    // Update metrics
    if (!this.metrics.byProvider.has(provider)) {
      this.metrics.byProvider.set(provider, { success: 0, failure: 0 });
    }
    this.metrics.byProvider.get(provider).failure++;
  }

  _combineSignals(signal1, signal2) {
    const controller = new AbortController();

    const abortHandler = () => controller.abort();

    if (signal1?.aborted || signal2?.aborted) {
      controller.abort();
      return controller.signal;
    }

    signal1?.addEventListener('abort', abortHandler, { once: true });
    signal2?.addEventListener('abort', abortHandler, { once: true });

    return controller.signal;
  }
}

export default HedgedRouter;
