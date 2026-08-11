/**
 * Hedged Router for LLM Calls
 *
 * 2026-08-11: SEQUENTIAL FAILOVER (was: concurrent racing). The original
 * implementation fired ALL providers simultaneously and kept the first
 * response (Promise.any) — which billed EVERY provider on EVERY call for
 * fallback-enabled roles. This was identified once before (2026-04-30,
 * model-registry.js: briefings "~2× more expensive than necessary") and
 * mitigated by shrinking FALLBACK_ENABLED_ROLES instead of fixing the
 * mechanism; the four strategy roles kept double-billing and contributed
 * to the 2026-08 Google billing spike. The documented INTENT was always
 * failover ("having NO fallback means complete data loss on Gemini
 * outage"), not racing. execute() now tries providers in order and only
 * dispatches the next one when the previous FAILED — one bill per call,
 * same redundancy. Class name kept to avoid rippling imports.
 */

import { classifyError, ErrorType } from './error-classifier.js';
import { ConcurrencyGate } from './concurrency-gate.js';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_PROVIDERS = ['anthropic', 'openai'];

// 2026-08-06: stable, SAFE cause codes for sanitized provider errors. The
// 2026-04-24 sanitization below correctly keeps raw upstream messages (which can
// echo API keys) out of thrown messages — but it also erased the CAUSE, so every
// stored reason field read "All hedged providers failed" and callModel's 503
// retry could never match. A closed vocabulary of codes carries the cause
// without carrying upstream content.
function classifyCauseCode(message) {
  const msg = String(message || '').toLowerCase();
  if (msg.includes('truncated at max_tokens')) return 'truncated';
  if (msg.includes('empty response')) return 'empty-response';
  if (msg.includes('429') || msg.includes('quota') || msg.includes('rate limit')) return 'quota';
  if (msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded')) return 'unavailable';
  if (msg.includes('401') || msg.includes('403') || msg.includes('api key') || msg.includes('permission')) return 'auth';
  if (msg.includes('timeout') || msg.includes('abort')) return 'timeout';
  return 'unknown';
}

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
    // 0 = Disabled timeout (user override)
    const timeout = options.timeout === 0 ? 0 : (options.timeout || this.timeout);
    const providers = options.providers || this.getAvailableProviders();

    if (providers.length === 0) {
      throw new Error('No available providers (all circuits open)');
    }

    this.metrics.totalCalls++;
    const startTime = Date.now();

    // Create abort controllers for each provider
    const controllers = new Map();
    providers.forEach(p => controllers.set(p, new AbortController()));

    // Create master timeout controller (only if timeout > 0)
    let timeoutController = null;
    let timeoutId = null;

    if (timeout > 0) {
      timeoutController = new AbortController();
      timeoutId = setTimeout(() => {
        timeoutController.abort();
      }, timeout);
    }

    try {
      // 2026-08-11: sequential failover (was: race all providers)
      const signal = timeoutController ? timeoutController.signal : null;
      const result = await this._tryProvidersSequentially(request, providers, controllers, signal);

      // Abort any remaining controllers (no-op for providers never dispatched)
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
      if (timeoutId) clearTimeout(timeoutId);
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

  // 2026-08-11: SEQUENTIAL FAILOVER — was _raceProviders (all providers fired
  // at once via Promise.any, billing every provider per call). Providers are
  // now tried strictly in the caller's order (primary first); the next
  // provider is dispatched ONLY after the previous one failed. Failure
  // semantics, sanitization, circuit recording, and the aggregate error
  // contract ("All hedged providers failed (provider:code, ...)") are
  // byte-identical to the racing version — callModel's 503-retry matches on
  // causeCode/causeCodes, and briefing failure reasons store these strings.
  // Timeout note: the master timeout (masterSignal) is an OVERALL budget. The
  // common failure modes (auth 403, 503, quota) fail in <1s, leaving nearly
  // the full budget for the fallback; only a primary that hangs to the full
  // budget forfeits the fallback attempt — the same overall latency the
  // timeout was chosen to cap.
  async _tryProvidersSequentially(request, providers, controllers, masterSignal) {
    const failures = [];

    for (const provider of providers) {
      // Master timeout already spent — stop, report what failed so far.
      if (masterSignal?.aborted) break;

      const controller = controllers.get(provider);

      // Combine with master signal
      const combinedSignal = masterSignal
        ? this._combineSignals(controller.signal, masterSignal)
        : controller.signal;

      // 2026-08-11: release only what was acquired — when acquire() itself
      // rejects (queue timeout / abort-while-queued) the old finally still
      // released, decrementing another request's slot and over-admitting the
      // process-wide gate.
      let acquired = false;
      try {
        await this.concurrencyGate.acquire(provider, combinedSignal);
        acquired = true;

        const response = await this._callProvider(provider, request, combinedSignal);

        return { response, provider };
      } catch (error) {
        const classified = classifyError(error);
        if (classified.affectsCircuit) {
          this._recordProviderFailure(provider);
        }
        // 2026-04-24: SECURITY — do NOT include raw upstream error.message in the
        // thrown error's message; upstream errors (e.g., Google's 403 response) echo
        // the API key back, and that message bubbles up to client responses via
        // callModel result.error. Keep the detail on a property for structured
        // logging; use a generic message string.
        // 2026-08-06: + closed-vocabulary causeCode so the cause survives
        // sanitization (see classifyCauseCode above).
        const causeCode = classifyCauseCode(error?.message);
        const enhancedError = new Error(`${provider}: upstream request failed (${causeCode})`);
        enhancedError.provider = provider;
        enhancedError.causeCode = causeCode;
        enhancedError.originalError = error;
        failures.push(enhancedError);
        // fall through to the next provider
      } finally {
        if (acquired) this.concurrencyGate.release(provider);
      }
    }

    // 2026-08-11: master timeout can expire before ANY provider was tried
    // (loop breaks with failures=[]), which produced "All hedged providers
    // failed ()" with empty causeCodes — nothing for the 503-retry logic to
    // match on. Synthesize one entry per untried provider so the contract
    // shape holds.
    if (failures.length === 0) {
      for (const provider of providers) {
        const timeoutError = new Error(`${provider}: upstream request failed (timeout)`);
        timeoutError.provider = provider;
        timeoutError.causeCode = 'timeout';
        failures.push(timeoutError);
      }
    }

    // 2026-04-24: SECURITY — emit a generic Error.message. The individual provider
    // errors (sanitized above to generic "provider: upstream request failed"
    // strings) are attached as .providerErrors for structured logging but NOT
    // joined into the thrown message.
    const errors = failures.map(e => e.message);
    const causeCodes = failures.map(e => ({ provider: e.provider || 'unknown', code: e.causeCode || 'unknown' }));
    console.error('[AI] All providers failed details:', JSON.stringify(errors, null, 2));
    const aggError = new Error(`All hedged providers failed (${causeCodes.map(c => `${c.provider}:${c.code}`).join(', ')})`);
    aggError.providerErrors = errors;
    aggError.causeCodes = causeCodes;
    aggError.cause = new AggregateError(failures, 'All providers failed');
    throw aggError;
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
