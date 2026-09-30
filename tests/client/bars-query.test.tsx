import React from 'react';
import { jest, test, expect, afterEach } from '@jest/globals';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
jest.unstable_mockModule('../../client/src/utils/co-pilot-helpers', () => ({ getAuthHeader: () => ({}), openNavigation: jest.fn() }));
const { useBarsQuery } = await import('../../client/src/hooks/useBarsQuery');
const { default: BarsMainTab } = await import('../../client/src/components/BarsMainTab');
const props = { latitude: 1, longitude: 1, city: 'City', state: 'AA', timezone: 'Asia/Tokyo', isLocationResolved: true, getAuthHeader: () => ({}) };
const originalFetch = global.fetch;
function Prefetch() { const result = useBarsQuery(props); return <span>{result.barsError ? 'Prefetch failed' : result.barsData ? 'Prefetch done' : 'Prefetch pending'}</span>; }
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); return render(<QueryClientProvider client={client}><Prefetch /><BarsMainTab {...props} /></QueryClientProvider>); }
afterEach(() => { cleanup(); global.fetch = originalFetch; });
test('layout prefetch and tab share one request and actual result contract', async () => {
 global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, data: { venues: [{ name: 'Shared Lounge', type: 'bar', expenseLevel: '$$$', expenseRank: 3, isOpen: true, hoursToday: null, closingSoon: false, minutesUntilClose: null, opensInMinutes: null, crowdLevel: null }], lastCallVenues: [] } }) })) as any;
 mount(); await screen.findByText('Shared Lounge'); expect(screen.getByText('Prefetch done')).toBeInTheDocument(); expect(global.fetch).toHaveBeenCalledTimes(1);
 const options = (global.fetch as any).mock.calls[0][1]; expect(options.signal).toBeInstanceOf(AbortSignal);
});
test('HTTP-success failure envelopes are errors for both consumers', async () => {
 global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: false, data: { venues: [] } }) })) as any;
 mount(); await screen.findByText('Failed to load venues'); expect(screen.getByText('Prefetch failed')).toBeInTheDocument(); expect(screen.queryByText('No venues found')).not.toBeInTheDocument();
});
test('last observer unmount cancels the abandoned request', async () => {
 global.fetch = jest.fn(() => new Promise(() => {})) as any;
 const rendered = mount(); await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
 const signal = (global.fetch as any).mock.calls[0][1].signal; rendered.unmount(); expect(signal.aborted).toBe(true);
});
