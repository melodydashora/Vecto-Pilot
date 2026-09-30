import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { subscribeOfferAnalyzed, closeAllSSE } from '@/utils/co-pilot-helpers';
class Source {
  static instances: Source[] = [];
  listeners = new Map<string, (event: { data: string }) => void>();
  close = jest.fn();
  constructor(public url: string) { Source.instances.push(this); }
  addEventListener(name: string, fn: (event: { data: string }) => void) { this.listeners.set(name, fn); }
  emit(name: string, data: unknown) { this.listeners.get(name)?.({ data: JSON.stringify(data) }); }
}
const original = globalThis.EventSource;
beforeEach(() => {
  closeAllSSE(); Source.instances = [];
  globalThis.EventSource = Source as unknown as typeof EventSource;
  localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'owner-a');
});
afterEach(() => { closeAllSSE(); localStorage.clear(); globalThis.EventSource = original; });
test('an old unsubscribe cannot remove a new login subscription with the same callback', () => {
  const callback = jest.fn();
  const leaveOld = subscribeOfferAnalyzed(callback);
  closeAllSSE(); localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'owner-b');
  const leaveNew = subscribeOfferAnalyzed(callback);
  leaveOld();
  expect(Source.instances[1].close).not.toHaveBeenCalled();
  Source.instances[1].emit('offer_analyzed', { offer_id: 'b' });
  expect(callback).toHaveBeenCalledWith({ offer_id: 'b' });
  leaveNew(); expect(Source.instances[1].close).toHaveBeenCalledTimes(1);
});
test('a changed token cannot reuse the previous owners stream or deliver queued old events', () => {
  const oldCallback = jest.fn(), currentCallback = jest.fn();
  subscribeOfferAnalyzed(oldCallback);
  localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'owner-b');
  subscribeOfferAnalyzed(currentCallback);
  expect(Source.instances).toHaveLength(2);
  expect(Source.instances[0].close).toHaveBeenCalledTimes(1);
  Source.instances[0].emit('offer_analyzed', { offer_id: 'old' });
  expect(oldCallback).not.toHaveBeenCalled(); expect(currentCallback).not.toHaveBeenCalled();
  Source.instances[1].emit('state', { offer_id: 'new' });
  expect(currentCallback).toHaveBeenCalledWith({ offer_id: 'new' });
});
test('one failing subscriber cannot prevent others from receiving the same event', () => {
  subscribeOfferAnalyzed(() => { throw new Error('fixture subscriber failure'); });
  const callback = jest.fn(); subscribeOfferAnalyzed(callback);
  Source.instances[0].emit('offer_analyzed', { offer_id: 'shared' });
  expect(callback).toHaveBeenCalledWith({ offer_id: 'shared' });
});
test('signed-out subscriptions do not open unauthenticated reconnect loops', () => {
  localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  const release = subscribeOfferAnalyzed(jest.fn()); release();
  expect(Source.instances).toHaveLength(0);
});

test('two consumers sharing one callback retain independent unsubscribe lifetimes', () => {
  const callback = jest.fn();
  const first = subscribeOfferAnalyzed(callback);
  const second = subscribeOfferAnalyzed(callback);
  first();
  expect(Source.instances.at(-1)?.close).not.toHaveBeenCalled();
  second();
  expect(Source.instances.at(-1)?.close).toHaveBeenCalledTimes(1);
});
