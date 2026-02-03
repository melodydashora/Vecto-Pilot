/**
 * Hedged Router Tests
 * Tests for the LLM hedged routing system
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { HedgedRouter } from '../../server/lib/ai/router/hedged-router.js';
import { ConcurrencyGate } from '../../server/lib/ai/router/concurrency-gate.js';
import { classifyError, ErrorType } from '../../server/lib/ai/router/error-classifier.js';

describe('HedgedRouter', () => {
  let router;
  let mockAdapters;

  beforeEach(() => {
    // Create mock adapters
    mockAdapters = new Map();
    mockAdapters.set('anthropic', jest.fn());
    mockAdapters.set('openai', jest.fn());
    mockAdapters.set('google', jest.fn());

    router = new HedgedRouter({
      providers: ['anthropic', 'openai'],
      adapters: mockAdapters,
      timeout: 5000,
      circuitThreshold: 3,
      circuitResetMs: 1000,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should return first successful response', async () => {
      // Anthropic responds first
      mockAdapters.get('anthropic').mockResolvedValueOnce({
        ok: true,
        output: 'Anthropic response',
      });

      // OpenAI is slower
      mockAdapters.get('openai').mockImplementation(() =>
        new Promise(resolve =>
          setTimeout(() => resolve({ ok: true, output: 'OpenAI response' }), 100)
        )
      );

      const result = await router.execute({ system: 'test', user: 'test' });

      expect(result.response.output).toBe('Anthropic response');
      expect(result.provider).toBe('anthropic');
    });

    it('should use second provider if first fails', async () => {
      // Anthropic fails
      mockAdapters.get('anthropic').mockRejectedValueOnce(new Error('Anthropic error'));

      // OpenAI succeeds
      mockAdapters.get('openai').mockResolvedValueOnce({
        ok: true,
        output: 'OpenAI fallback response',
      });

      const result = await router.execute({ system: 'test', user: 'test' });

      expect(result.response.output).toBe('OpenAI fallback response');
      expect(result.provider).toBe('openai');
    });

    it('should throw if all providers fail', async () => {
      mockAdapters.get('anthropic').mockRejectedValueOnce(new Error('Anthropic error'));
      mockAdapters.get('openai').mockRejectedValueOnce(new Error('OpenAI error'));

      await expect(router.execute({ system: 'test', user: 'test' }))
        .rejects.toThrow();
    });

    it('should timeout if response takes too long', async () => {
      const slowRouter = new HedgedRouter({
        providers: ['anthropic'],
        adapters: mockAdapters,
        timeout: 100, // Very short timeout
      });

      // Response takes too long
      mockAdapters.get('anthropic').mockImplementation(() =>
        new Promise(resolve =>
          setTimeout(() => resolve({ ok: true, output: 'late' }), 500)
        )
      );

      await expect(slowRouter.execute({ system: 'test', user: 'test' }))
        .rejects.toThrow();
    });
  });

  describe('circuit breaker', () => {
    it('should open circuit after threshold failures', async () => {
      // Fail enough times to open circuit
      mockAdapters.get('anthropic').mockRejectedValue(new Error('Server error'));
      mockAdapters.get('openai').mockResolvedValue({ ok: true, output: 'success' });

      // Cause multiple failures
      for (let i = 0; i < 3; i++) {
        try {
          await router.executeSingle({ system: 'test', user: 'test' }, 'anthropic');
        } catch (e) {
          // Expected
        }
      }

      // Anthropic circuit should now be open
      expect(router.isProviderAvailable('anthropic')).toBe(false);
      expect(router.isProviderAvailable('openai')).toBe(true);
    });

    it('should reset circuit after success', async () => {
      // First fail
      mockAdapters.get('anthropic').mockRejectedValueOnce(new Error('error'));

      try {
        await router.executeSingle({ system: 'test', user: 'test' }, 'anthropic');
      } catch (e) {}

      // Then succeed
      mockAdapters.get('anthropic').mockResolvedValueOnce({ ok: true, output: 'success' });
      await router.executeSingle({ system: 'test', user: 'test' }, 'anthropic');

      // Circuit should be healthy
      expect(router.isProviderAvailable('anthropic')).toBe(true);
    });
  });
});

describe('ConcurrencyGate', () => {
  let gate;

  beforeEach(() => {
    gate = new ConcurrencyGate({ maxConcurrent: 2, queueTimeout: 1000 });
  });

  it('should allow requests up to max concurrent', async () => {
    expect(gate.hasCapacity('test')).toBe(true);

    await gate.acquire('test');
    expect(gate.getActiveCount('test')).toBe(1);

    await gate.acquire('test');
    expect(gate.getActiveCount('test')).toBe(2);

    expect(gate.hasCapacity('test')).toBe(false);
  });

  it('should release slots correctly', async () => {
    await gate.acquire('test');
    await gate.acquire('test');
    expect(gate.hasCapacity('test')).toBe(false);

    gate.release('test');
    expect(gate.getActiveCount('test')).toBe(1);
    expect(gate.hasCapacity('test')).toBe(true);
  });

  it('should track providers independently', async () => {
    await gate.acquire('anthropic');
    await gate.acquire('openai');

    expect(gate.getActiveCount('anthropic')).toBe(1);
    expect(gate.getActiveCount('openai')).toBe(1);
  });
});

describe('Error Classifier', () => {
  it('should classify abort errors', () => {
    const error = new DOMException('Aborted', 'AbortError');
    const result = classifyError(error);

    expect(result.type).toBe(ErrorType.ABORTED);
    expect(result.shouldRetry).toBe(false);
    expect(result.affectsCircuit).toBe(false);
  });

  it('should classify timeout errors', () => {
    const error = new Error('Request timeout');
    error.code = 'ETIMEDOUT';
    const result = classifyError(error);

    expect(result.type).toBe(ErrorType.TIMEOUT);
    expect(result.shouldRetry).toBe(true);
    expect(result.affectsCircuit).toBe(true);
  });

  it('should classify rate limit errors', () => {
    const error = new Error('Rate limit exceeded');
    error.status = 429;
    const result = classifyError(error);

    expect(result.type).toBe(ErrorType.THROTTLED);
    expect(result.shouldRetry).toBe(false);
    expect(result.affectsCircuit).toBe(true);
  });

  it('should classify server errors', () => {
    const error = new Error('Internal server error');
    error.status = 500;
    const result = classifyError(error);

    expect(result.type).toBe(ErrorType.SERVER);
    expect(result.shouldRetry).toBe(true);
    expect(result.affectsCircuit).toBe(true);
  });

  it('should classify client errors', () => {
    const error = new Error('Bad request');
    error.status = 400;
    const result = classifyError(error);

    expect(result.type).toBe(ErrorType.CLIENT);
    expect(result.shouldRetry).toBe(false);
    expect(result.affectsCircuit).toBe(false);
  });
});
