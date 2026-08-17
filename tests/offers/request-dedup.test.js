// tests/offers/request-dedup.test.js — analyze-offer idempotency primitives (2026-08-17).
import { requestFingerprint, createRequestDedup, createTtlMemo } from '../../server/lib/offers/request-dedup.js';

describe('requestFingerprint', () => {
  test('identical text with different whitespace → same key; different identity → different key', () => {
    const a = requestFingerprint({ identity: 'vp_tok', text: 'Uber X  $12.40\n 8 mi' });
    const b = requestFingerprint({ identity: 'vp_tok', text: 'Uber X $12.40 8 mi ' });
    const c = requestFingerprint({ identity: 'other', text: 'Uber X $12.40 8 mi' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  test('image bytes are part of the key; text vs image never collide; empty text ignored', () => {
    const img = 'iVBORw0KGgoAAAANSUhEUg' + 'A'.repeat(500);
    const t = requestFingerprint({ identity: 'd1', text: 'x' });
    const i = requestFingerprint({ identity: 'd1', image: img });
    const i2 = requestFingerprint({ identity: 'd1', image: img.slice(0, -1) + 'B' });
    expect(i).not.toBe(t);
    expect(i).not.toBe(i2);
    expect(requestFingerprint({ identity: 'd1', text: '   ', image: img })).toBe(i);
  });
});

describe('createRequestDedup', () => {
  test('miss → claim; second identical claim joins and receives the settled payload', async () => {
    let t = 1000;
    const dd = createRequestDedup({ ttlMs: 60_000, now: () => t });
    const first = dd.claim('k');
    expect(first.hit).toBe(false);
    const second = dd.claim('k');
    expect(second.hit).toBe(true);
    let got = null;
    const waiter = second.promise.then((p) => { got = p; });
    first.settle({ decision: 'ACCEPT', voice: 'Accept.' });
    await waiter;
    expect(got).toEqual({ decision: 'ACCEPT', voice: 'Accept.' });
    // Already-settled entries replay immediately within the TTL
    t += 30_000;
    const third = dd.claim('k');
    expect(third.hit).toBe(true);
    await expect(third.promise).resolves.toEqual({ decision: 'ACCEPT', voice: 'Accept.' });
    expect(third.ageMs).toBe(30_000);
  });

  test('entries expire after the TTL → a fresh claim computes again', () => {
    let t = 0;
    const dd = createRequestDedup({ ttlMs: 60_000, now: () => t });
    dd.claim('k').settle({ ok: 1 });
    t = 60_001;
    expect(dd.claim('k').hit).toBe(false);
  });

  test('a failed original is never replayed: waiters reject, next claim is a miss', async () => {
    const dd = createRequestDedup({ ttlMs: 60_000, now: () => 0 });
    const first = dd.claim('k');
    const joined = dd.claim('k');
    expect(joined.hit).toBe(true);
    first.fail(new Error('boom'));
    await expect(joined.promise).rejects.toThrow('boom');
    expect(dd.claim('k').hit).toBe(false);
  });

  test('settle/fail are idempotent and the map is bounded', () => {
    const dd = createRequestDedup({ ttlMs: 60_000, maxEntries: 3, now: () => 0 });
    const c = dd.claim('a');
    c.settle(1); c.settle(2); c.fail(new Error('late')); // no throw, first settle wins
    dd.claim('b'); dd.claim('c'); dd.claim('d');
    expect(dd.size()).toBeLessThanOrEqual(3);
    expect(dd.claim('a').hit).toBe(false); // oldest evicted
  });
});

describe('createTtlMemo', () => {
  test('get/set with expiry and bound', () => {
    let t = 0;
    const m = createTtlMemo({ ttlMs: 1000, maxEntries: 2, now: () => t });
    expect(m.get('x')).toBeUndefined();
    m.set('x', { tz: 'America/Chicago' });
    expect(m.get('x')).toEqual({ tz: 'America/Chicago' });
    t = 1001;
    expect(m.get('x')).toBeUndefined();
    m.set('a', 1); m.set('b', 2); m.set('c', 3);
    expect(m.size()).toBe(2);
    expect(m.get('a')).toBeUndefined();
  });
});
