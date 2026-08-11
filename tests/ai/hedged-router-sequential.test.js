// tests/ai/hedged-router-sequential.test.js
//
// 2026-08-11: pins the sequential-failover semantics of HedgedRouter after the
// racing removal (execute() previously fired ALL providers concurrently via
// Promise.any, billing every provider on every call — the mechanism behind the
// 2026-08 Google billing spike and the 2026-04-30 "briefings ~2× more
// expensive" finding).
//
// Load-bearing contracts pinned here:
//   1. Primary success ⇒ fallback adapter is NEVER dispatched (one bill per call).
//   2. Primary failure ⇒ fallback is tried, in caller order.
//   3. All fail ⇒ error message is exactly
//      "All hedged providers failed (provider:code, ...)" with .causeCodes —
//      callModel's 503-retry matches on causeCode/causeCodes, and briefing
//      failure reasons store these strings verbatim.
//   4. Sanitization: thrown messages never contain upstream error text.

import { describe, test, expect } from '@jest/globals';
import { HedgedRouter } from '../../server/lib/ai/router/hedged-router.js';

process.env.NODE_ENV = 'test';

function makeRouter(adapterImpls) {
  const adapters = new Map(Object.entries(adapterImpls));
  return new HedgedRouter({
    providers: Object.keys(adapterImpls),
    adapters,
    timeout: 5000,
  });
}

describe('HedgedRouter — sequential failover (no racing)', () => {
  test('primary success: fallback adapter is NEVER dispatched', async () => {
    const calls = [];
    const router = makeRouter({
      google: async () => { calls.push('google'); return { ok: true, output: 'g' }; },
      openai: async () => { calls.push('openai'); return { ok: true, output: 'o' }; },
    });

    const result = await router.execute({ role: 'TEST' }, { providers: ['google', 'openai'] });

    expect(result.provider).toBe('google');
    expect(result.response.output).toBe('g');
    expect(calls).toEqual(['google']); // the billing assertion
  });

  test('primary failure: fallback is dispatched and wins', async () => {
    const calls = [];
    const router = makeRouter({
      google: async () => { calls.push('google'); throw new Error('403 PERMISSION_DENIED key=SECRET'); },
      openai: async () => { calls.push('openai'); return { ok: true, output: 'o' }; },
    });

    const result = await router.execute({ role: 'TEST' }, { providers: ['google', 'openai'] });

    expect(result.provider).toBe('openai');
    expect(calls).toEqual(['google', 'openai']); // strict order, both tried
  });

  test('all fail: aggregate message format and causeCodes survive', async () => {
    const router = makeRouter({
      google: async () => { throw new Error('403 PERMISSION_DENIED'); },
      openai: async () => { throw new Error('totally novel upstream failure'); },
    });

    await expect(
      router.execute({ role: 'TEST' }, { providers: ['google', 'openai'] })
    ).rejects.toMatchObject({
      message: 'All hedged providers failed (google:auth, openai:unknown)',
      causeCodes: [
        { provider: 'google', code: 'auth' },
        { provider: 'openai', code: 'unknown' },
      ],
    });
  });

  test('sanitization: upstream error text never reaches the thrown message', async () => {
    const router = makeRouter({
      google: async () => { throw new Error('403 forbidden AIzaFAKEKEY123 echoed by upstream'); },
    });

    try {
      await router.execute({ role: 'TEST' }, { providers: ['google'] });
      throw new Error('expected rejection');
    } catch (err) {
      expect(err.message).not.toContain('AIzaFAKEKEY123');
      expect(err.providerErrors.join(' ')).not.toContain('AIzaFAKEKEY123');
      expect(err.message).toBe('All hedged providers failed (google:auth)');
    }
  });

  test('single provider list behaves as plain call with failover contract', async () => {
    const router = makeRouter({
      google: async () => ({ ok: true, output: 'solo' }),
    });
    const result = await router.execute({ role: 'TEST' }, { providers: ['google'] });
    expect(result.response.output).toBe('solo');
  });
});

// 2026-08-11: residue fixes found in the post-racing audit — the gate must
// only release slots it actually acquired, and a pre-loop master abort must
// still produce a contract-shaped aggregate error.
describe('HedgedRouter — gate accounting and empty-failure aggregate', () => {
  test('acquire rejection: release() is NOT called for a slot never acquired', async () => {
    const events = [];
    const gate = {
      acquire: async () => { events.push('acquire'); throw new Error('gate queue timeout'); },
      release: () => { events.push('release'); },
    };
    const adapters = new Map([['google', async () => ({ ok: true })]]);
    const router = new HedgedRouter({ providers: ['google'], adapters, concurrencyGate: gate, timeout: 5000 });

    await expect(
      router.execute({ role: 'TEST' }, { providers: ['google'] })
    ).rejects.toThrow('All hedged providers failed');

    expect(events).toEqual(['acquire']); // no release-without-acquire drift
  });

  test('master signal aborted before first provider: causeCodes still populated', async () => {
    const router = makeRouter({
      google: async () => ({ ok: true, output: 'g' }),
      openai: async () => ({ ok: true, output: 'o' }),
    });
    const aborted = new AbortController();
    aborted.abort();
    const controllers = new Map([
      ['google', new AbortController()],
      ['openai', new AbortController()],
    ]);

    await expect(
      router._tryProvidersSequentially({ role: 'TEST' }, ['google', 'openai'], controllers, aborted.signal)
    ).rejects.toMatchObject({
      message: 'All hedged providers failed (google:timeout, openai:timeout)',
      causeCodes: [
        { provider: 'google', code: 'timeout' },
        { provider: 'openai', code: 'timeout' },
      ],
    });
  });
});
