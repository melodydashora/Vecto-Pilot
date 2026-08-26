// tests/venue/resolution-coalescer.test.js
// 2026-08-26 (Melody's #2: prevent repeated Google address lookups while
// recommendations load). Regression contract: multiple polls of a ready Smart
// Blocks snapshot must not multiply external API calls — concurrent
// resolutions share in-flight work, successes bridge poll intervals, and
// failures are replayed loudly for a short window instead of stampeding
// Google. Pure module, injected clock — no db/fetch mocks needed.

import { describe, it, expect, jest } from '@jest/globals';
import {
  createResolutionCoalescer,
  DEFAULT_POSITIVE_TTL_MS,
  DEFAULT_NEGATIVE_TTL_MS,
} from '../../server/lib/venue/resolution-coalescer.js';

function makeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('resolution coalescer', () => {
  it('concurrent calls for the same key share ONE piece of work', async () => {
    const clock = makeClock();
    const c = createResolutionCoalescer({ now: clock.now });
    const fn = jest.fn().mockResolvedValue({ formatted_address: '123 Main St' });

    const [a, b, d] = await Promise.all([
      c.run('32.9|-96.8|omni', fn),
      c.run('32.9|-96.8|omni', fn),
      c.run('32.9|-96.8|omni', fn),
    ]);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(d);
    expect(a.formatted_address).toBe('123 Main St');
  });

  it('sequential polls within the positive TTL reuse the result; after it, work re-runs', async () => {
    const clock = makeClock();
    const c = createResolutionCoalescer({ now: clock.now });
    const fn = jest.fn().mockResolvedValue({ ok: true });

    await c.run('k', fn);
    clock.advance(DEFAULT_POSITIVE_TTL_MS - 1);
    await c.run('k', fn);
    expect(fn).toHaveBeenCalledTimes(1); // 15s poll loop, focus refetches — one upstream call

    clock.advance(2); // past expiry
    await c.run('k', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('distinct keys never share', async () => {
    const clock = makeClock();
    const c = createResolutionCoalescer({ now: clock.now });
    const fn = jest.fn().mockResolvedValue({});

    await Promise.all([c.run('a', fn), c.run('b', fn)]);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('failure stays LOUD for every caller but is not recomputed within the negative TTL', async () => {
    const clock = makeClock();
    const c = createResolutionCoalescer({ now: clock.now });
    const fn = jest.fn().mockRejectedValue(new Error('all resolution methods exhausted'));

    // Both concurrent pollers get the rejection; upstream called once.
    const settled = await Promise.allSettled([c.run('k', fn), c.run('k', fn)]);
    expect(settled.map((s) => s.status)).toEqual(['rejected', 'rejected']);
    expect(settled[0].reason.message).toMatch(/exhausted/);
    expect(fn).toHaveBeenCalledTimes(1);

    // Next poll inside the negative window: same loud failure, still one call.
    clock.advance(DEFAULT_NEGATIVE_TTL_MS - 1);
    await expect(c.run('k', fn)).rejects.toThrow(/exhausted/);
    expect(fn).toHaveBeenCalledTimes(1);

    // Window over: the blip may have cleared — retry fresh.
    clock.advance(2);
    fn.mockResolvedValueOnce({ recovered: true });
    await expect(c.run('k', fn)).resolves.toEqual({ recovered: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('a failure expires faster than a success (negative TTL < positive TTL)', async () => {
    const clock = makeClock();
    const c = createResolutionCoalescer({ now: clock.now, positiveTtlMs: 1000, negativeTtlMs: 100 });
    const fail = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(c.run('k', fail)).rejects.toThrow('boom');
    clock.advance(150); // past negative, well inside positive
    fail.mockResolvedValueOnce({ ok: true });
    await expect(c.run('k', fail)).resolves.toEqual({ ok: true });
    expect(fail).toHaveBeenCalledTimes(2);
  });

  it('entry count is bounded (oldest evicted at maxEntries)', async () => {
    const clock = makeClock();
    const c = createResolutionCoalescer({ now: clock.now, maxEntries: 3 });
    const fn = () => Promise.resolve({});

    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((k) => c.run(k, fn)));
    expect(c.size()).toBeLessThanOrEqual(3);
  });

  it('expired entries are swept on access', async () => {
    const clock = makeClock();
    const c = createResolutionCoalescer({ now: clock.now, positiveTtlMs: 100 });
    await c.run('a', () => Promise.resolve({}));
    await c.run('b', () => Promise.resolve({}));
    expect(c.size()).toBe(2);
    clock.advance(200);
    expect(c.size()).toBe(0);
  });
});
