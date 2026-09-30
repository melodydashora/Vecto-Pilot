import React from 'react';
import { jest, test, expect, beforeEach, afterEach } from '@jest/globals';
import { renderHook, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { QUERY_KEYS } from '@/constants/apiRoutes';

jest.unstable_mockModule('@/utils/co-pilot-helpers', () => ({
  getAuthHeader: () => ({ Authorization: `Bearer ${localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)}` }),
  subscribeBriefingReady: () => () => {},
}));
const { useActiveEventsQuery } = await import('@/hooks/useBriefingQueries');
const clients: QueryClient[] = [];
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>(r => { resolve = r; }); return { promise, resolve }; }
async function tick() { await act(async () => { await jest.advanceTimersByTimeAsync(0); }); }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return { client, ...renderHook(({ snapshotId }) => useActiveEventsQuery(snapshotId), {
    initialProps: { snapshotId: 'old-snapshot' },
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  }) };
}
beforeEach(() => {
  jest.useFakeTimers(); localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'old-session');
  global.fetch = jest.fn<typeof fetch>();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup(); clients.splice(0).forEach(client => client.clear());
  window.dispatchEvent(new CustomEvent('vecto-auth-error'));
  jest.restoreAllMocks(); jest.useRealTimers(); localStorage.clear();
});

test.each([401, 404])('delayed %s body from an old session cannot reset a new login or snapshot', async status => {
  const body = deferred();
  const authError = jest.fn(), ownershipError = jest.fn();
  window.addEventListener('vecto-auth-error', authError); window.addEventListener('snapshot-ownership-error', ownershipError);
  try {
    jest.mocked(fetch).mockResolvedValue({ ok: false, status, json: () => body.promise } as Response);
    mount(); await tick();
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'new-session');
    await act(async () => { body.resolve({ error: status === 401 ? 'unauthorized' : 'snapshot_not_found' }); }); await tick();
    expect(authError).not.toHaveBeenCalled(); expect(ownershipError).not.toHaveBeenCalled();
  } finally { window.removeEventListener('vecto-auth-error', authError); window.removeEventListener('snapshot-ownership-error', ownershipError); }
});

test('late success cannot publish the previous session events after token replacement', async () => {
  const body = deferred();
  jest.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: () => body.promise } as Response);
  const { client } = mount(); await tick();
  localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'new-session');
  await act(async () => { body.resolve({ events: [{ title: 'Previous driver event' }] }); }); await tick();
  expect(client.getQueryData<{ events: unknown[] }>(QUERY_KEYS.BRIEFING_EVENTS_ACTIVE('old-snapshot'))?.events).toEqual([]);
});

test('snapshot replacement aborts the old request and prevents its delayed 401 effect', async () => {
  const body = deferred(); const authError = jest.fn();
  window.addEventListener('vecto-auth-error', authError);
  try {
    jest.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401, json: () => body.promise } as Response)
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ events: [] }) } as Response);
    const { rerender } = mount(); await tick();
    const signal = jest.mocked(fetch).mock.calls[0][1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    rerender({ snapshotId: 'replacement-snapshot' }); await tick();
    expect(signal?.aborted).toBe(true);
    await act(async () => { body.resolve({ error: 'unauthorized' }); }); await tick();
    expect(authError).not.toHaveBeenCalled();
  } finally { window.removeEventListener('vecto-auth-error', authError); }
});

test('a current-session 401 still dispatches the existing auth recovery', async () => {
  const authError = jest.fn(); window.addEventListener('vecto-auth-error', authError);
  try {
    jest.mocked(fetch).mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'session_expired' }) } as Response);
    mount(); await tick();
    expect(authError).toHaveBeenCalledTimes(1);
    expect((authError.mock.calls[0][0] as CustomEvent).detail.error).toBe('session_expired');
  } finally { window.removeEventListener('vecto-auth-error', authError); }
});
