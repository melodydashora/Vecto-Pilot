import React from 'react';
import { jest, test, expect, beforeEach, afterEach } from '@jest/globals';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let auth = { user: { userId: 'fixture-driver' }, token: 'fixture-token', sessionId: 'fixture-session' };
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => auth }));
const { CoachContextStatus } = await import('@/components/coach/CoachContextStatus');
const originalFetch = globalThis.fetch;
let requests: Array<{ url: URL; options: RequestInit }>;
let client: QueryClient;
const progress = { read_at: null, snapshot: { state: 'complete' }, strategy: { state: 'missing', created_at: null }, briefing: { state: 'missing' }, offers: { state: 'available', count: 0, limit: 20 } };
function View({ source, coach }: { source?: string; coach?: string }) {
  return <QueryClientProvider client={client}><CoachContextStatus snapshotId={source} coachSnapshotId={coach} /></QueryClientProvider>;
}
beforeEach(() => {
  auth = { user: { userId: 'fixture-driver' }, token: 'fixture-token', sessionId: 'fixture-session' };
  requests = []; client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  globalThis.fetch = jest.fn<typeof fetch>(async (input, options = {}) => {
    requests.push({ url: new URL(String(input), 'http://fixture.local'), options });
    return { ok: true, json: async () => progress } as Response;
  });
});
afterEach(() => { cleanup(); client.clear(); globalThis.fetch = originalFetch; });

test('summary keeps the MAIN source stable while reading the separate Coach observation', async () => {
  const view = render(<View source="saved-main" coach="coach-a" />);
  await screen.findByText(/Coach reads the latest saved/);
  expect(requests[0].url.pathname).toBe('/api/chat/context/saved-main');
  expect(requests[0].url.searchParams.get('coachSnapshotId')).toBe('coach-a');
  expect(requests[0].url.searchParams.get('summary')).toBe('1');
  view.rerender(<View source="saved-main" coach="coach-b" />);
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1].url.pathname).toBe('/api/chat/context/saved-main');
  expect(requests[1].url.searchParams.get('coachSnapshotId')).toBe('coach-b');
});

test('without MAIN context the summary uses only the independent Coach observation', async () => {
  render(<View coach="coach-only" />); await screen.findByText(/Coach reads the latest saved/);
  expect(requests[0].url.pathname).toBe('/api/chat/context/coach-only');
  expect(requests[0].url.searchParams.get('coachSnapshotId')).toBe('coach-only');
  expect(screen.getByText(/without starting Strategy/)).toBeInTheDocument();
});

test('a new auth session reads again rather than reusing the prior session summary', async () => {
  const view = render(<View source="saved-main" coach="coach-a" />); await screen.findByText(/Coach reads the latest saved/);
  auth = { ...auth, sessionId: 'next-session', token: 'next-token' };
  view.rerender(<View source="saved-main" coach="coach-a" />);
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1].options.headers).toEqual({ Authorization: 'Bearer next-token' });
});
