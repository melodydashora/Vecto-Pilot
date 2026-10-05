import React from 'react';
import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { closeAllSSE } from '@/utils/co-pilot-helpers';
import { useBriefingQueries } from '@/hooks/useBriefingQueries';
class Source {
  static instances: Source[] = [];
  listeners = new Map<string, (event: { data: string }) => void>();
  close = jest.fn();
  constructor(public url: string) { Source.instances.push(this); }
  addEventListener(name: string, fn: (event: { data: string }) => void) { this.listeners.set(name, fn); }
  emit(data: unknown) { this.listeners.get('briefing_ready')?.({ data: JSON.stringify(data) }); }
}
const originalSource = globalThis.EventSource;
const clients: QueryClient[] = [];
const pending = (id = 'source-a'): any => ({ snapshot_id: id, briefing: Object.fromEntries(
  ['weather','traffic','events','news','school_closures','airport_conditions','holiday'].map(key => [key, { _pending: true }])) });
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
async function tick(ms = 0) { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); }
function mount() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
 return renderHook(({ snapshotId }) => useBriefingQueries({ snapshotId, isAuthenticated: true }), {
  initialProps: { snapshotId: 'source-a' }, wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
beforeEach(() => {
 jest.useFakeTimers(); localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'synthetic-session');
 globalThis.EventSource = Source as unknown as typeof EventSource; Source.instances = [];
 global.fetch = jest.fn<typeof fetch>(); jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); closeAllSSE(); localStorage.clear(); globalThis.EventSource = originalSource; jest.restoreAllMocks(); jest.useRealTimers(); });
test('a required failed section ends pending polling and closes the actual Briefing stream', async () => {
 const failed = pending(); failed.briefing.airport_conditions = { _generationFailed: true, error: 'Airport source unavailable' };
 jest.mocked(fetch).mockResolvedValue(response(failed));
 const { result } = mount(); await tick(); await tick(1);
 expect(result.current.generationError).toContain('Airport source unavailable');
 expect(Object.values(result.current.isLoading)).not.toContain(true);
 expect(Source.instances[0].close).toHaveBeenCalledTimes(1);
 const count = jest.mocked(fetch).mock.calls.length;
 Source.instances[0].emit({ snapshot_id: 'source-a' }); await tick(120000);
 expect(fetch).toHaveBeenCalledTimes(count);
});
test('a new source reopens its own stream and an old failure cannot replace it', async () => {
 const failed = pending(); failed.briefing.holiday = { _generationFailed: true, reason: 'Holiday unavailable' };
 jest.mocked(fetch).mockResolvedValueOnce(response(failed)).mockResolvedValue(response(pending('source-b')));
 const { result, rerender } = mount(); await tick(); await tick(1);
 expect(result.current.generationError).toContain('Holiday unavailable');
 rerender({ snapshotId: 'source-b' }); await tick(); await tick(1);
 expect(result.current.generationError).toBeNull(); expect(result.current.isLoading.airport).toBe(true);
 const current = Source.instances.at(-1)!; expect(current.url).toContain('source-b'); expect(current.close).not.toHaveBeenCalled();
 const count = jest.mocked(fetch).mock.calls.length; Source.instances[0].emit({ snapshot_id: 'source-a', status: 'error' }); await tick(1);
 expect(fetch).toHaveBeenCalledTimes(count); expect(result.current.generationError).toBeNull();
});
test('completed immutable Briefing also releases its stream without generating another source', async () => {
 const complete = pending(); Object.values(complete.briefing).forEach((section: any) => { section._pending = false; });
 jest.mocked(fetch).mockResolvedValue(response(complete)); const { result } = mount(); await tick(); await tick(1);
 expect(result.current.generationError).toBeNull(); expect(Source.instances[0].close).toHaveBeenCalledTimes(1);
 expect(jest.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});

test('more than twelve successful progress notifications retain known events and keep the stream open', async () => {
 let revision = 0;
 jest.mocked(fetch).mockImplementation(async () => {
  const data = pending();
  data.status = 'pending'; data.updated_at = `2026-10-05T12:00:${String(revision++).padStart(2, '0')}Z`;
  data.briefing.events = { _pending: true, items: [{ title: 'Verified during discovery' }], marketEvents: [] };
  return response(data);
 });
 const { result } = mount(); await tick(); await tick(1);
 const source = Source.instances[0];
 for (let i = 0; i < 15; i++) { source.emit({ snapshot_id: 'source-a', section: 'events' }); await tick(); await tick(1); }
 expect(jest.mocked(fetch).mock.calls.length).toBeGreaterThan(12);
 expect(result.current.isRetryExhausted).toBe(false);
 expect(result.current.eventsData?.events).toEqual([{ title: 'Verified during discovery' }]);
 expect(result.current.isLoading.events).toBe(true);
 expect(source.close).not.toHaveBeenCalled();
 expect(jest.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

test('a failed section waits for terminal aggregate status while other sections can still arrive', async () => {
 const partial = pending(); partial.status = 'pending'; partial.updated_at = '2026-10-05T12:00:00Z';
 partial.briefing.airport_conditions = { _generationFailed: true, error: 'Airport unavailable' };
 partial.briefing.events = { _pending: true, items: [{ title: 'Known event' }], marketEvents: [] };
 jest.mocked(fetch).mockResolvedValue(response(partial));
 const { result } = mount(); await tick(); await tick(1);
 expect(result.current.generationError).toBeNull();
 expect(Source.instances[0].close).not.toHaveBeenCalled();
 expect(result.current.isLoading.events).toBe(true);
 const terminal = { ...partial, status: 'error', briefing: { ...partial.briefing,
  events: { items: [{ title: 'Known event' }], marketEvents: [], _generationFailed: true, reason: 'Another category failed' } } };
 jest.mocked(fetch).mockResolvedValue(response(terminal));
 Source.instances[0].emit({ snapshot_id: 'source-a', status: 'error' }); await tick(); await tick(1);
 expect(result.current.generationError).toContain('Another category failed');
 expect(result.current.eventsData?.events).toEqual([{ title: 'Known event' }]);
 expect(Source.instances[0].close).toHaveBeenCalledTimes(1);
 const count = jest.mocked(fetch).mock.calls.length; await tick(200000);
 expect(fetch).toHaveBeenCalledTimes(count);
});
