import React from 'react';
import '@testing-library/jest-dom/jest-globals';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { QUERY_KEYS } from '@/constants/apiRoutes';

const helpers = await import('@/utils/co-pilot-helpers');
jest.unstable_mockModule('@/contexts/run-setup-context', () => ({ useRunSetup: () => ({ run: null }) }));
jest.unstable_mockModule('@/utils/co-pilot-helpers', () => ({
  ...helpers,
  getAuthHeader: () => ({ Authorization: 'Bearer synthetic' }),
  subscribeStrategyReady: () => () => {},
  subscribeBlocksReady: () => () => {},
  subscribeBriefingReady: () => () => {},
  subscribePhaseChange: () => () => {},
}));
jest.unstable_mockModule('@/contexts/location-context-clean', () => ({
  useLocation: () => ({
    currentCoords: null,
    city: 'Synthetic city',
    state: 'CA',
    timeZone: 'America/Los_Angeles',
    isLocationResolved: true,
    lastSnapshotId: 'briefing-fixture',
    runId: 'briefing-run',
  }),
}));
// main's CoPilotProvider scopes snapshot state to an authScope built from user.userId + token.
jest.unstable_mockModule('@/contexts/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { userId: 'synthetic-driver' }, token: 'synthetic-token' }),
}));
jest.unstable_mockModule('@/hooks/useEnrichmentProgress', () => ({
  useEnrichmentProgress: () => ({ progress: 100, strategyProgress: 100, phase: 'idle', pipelinePhase: 'complete' }),
}));
jest.unstable_mockModule('@/hooks/useBarsQuery', () => ({
  useBarsQuery: () => ({ barsData: null, isBarsLoading: false, refetchBars: () => {} }),
}));

const { CoPilotProvider } = await import('@/contexts/co-pilot-context');
const { default: BriefingPage } = await import('@/pages/co-pilot/BriefingPage');
const clients: QueryClient[] = [];
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

function aggregate() {
  return {
    snapshot_id: 'briefing-fixture',
    briefing: {
      holiday: { name: null, _pending: false, _generationFailed: false },
      weather: { current: null, forecast: [], _pending: false, _generationFailed: false },
      traffic: { incidents: [], reason: '', _pending: false, _generationFailed: false },
      news: { items: [], reason: '', _pending: false, _generationFailed: false },
      events: { items: [] as object[], marketEvents: [] as object[], market_name: '', reason: '', _pending: false, _generationFailed: false },
      school_closures: { items: [], reason: '', _pending: false, _generationFailed: false },
      // main's AirportCard treats an empty list with no reason as incomplete (role=alert); give it a real reason.
      airport_conditions: { airports: [], reason: 'No airports within range', _pending: false, _generationFailed: false },
    },
  };
}

function mount(data: ReturnType<typeof aggregate>) {
  global.fetch = jest.fn<typeof fetch>(async input => {
    const url = String(input);
    if (url.startsWith('/api/briefing/snapshot/')) return response(data);
    if (url.startsWith('/api/snapshot/')) return response({ city: 'Synthetic city', timezone: 'America/Los_Angeles' });
    if (url.startsWith('/api/blocks/strategy/')) return response({ status: 'error' });
    throw new Error(`Unexpected fixture request: ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><CoPilotProvider><BriefingPage /></CoPilotProvider></QueryClientProvider>);
  return client;
}

beforeEach(() => {
  // UTC is already September 14, but the driver's local date is September 13.
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
  jest.setSystemTime(new Date('2026-09-14T02:00:00Z'));
  localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'synthetic');
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  localStorage.clear();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('upstream briefing aggregate through its real provider, page, and event cards while Strategy is held', () => {
  it('shows local today and upcoming events, including a known start without an end time', async () => {
    const data = aggregate();
    data.briefing.events.items = [
      { title: 'Known start', venue: 'Fixture venue', event_start_date: '2026-09-13', event_start_time: '19:30' },
      { title: 'Tomorrow concert', event_start_date: '2026-09-14', event_start_time: '20:00', event_end_time: '22:00' },
      { title: 'Ended yesterday', event_start_date: '2026-09-12', event_start_time: '20:00' },
      { title: 'Unknown start', event_start_date: '2026-09-13', event_start_time: 'TBD' },
    ];
    data.briefing.events.market_name = 'Fixture market';
    data.briefing.events.marketEvents = [
      { title: 'Major local event', event_start_date: '2026-09-13', event_start_time: '21:00' },
      { title: 'Major tomorrow event', event_start_date: '2026-09-14', event_start_time: '21:00' },
    ];
    mount(data);
    expect(await screen.findByText('Known start')).toBeInTheDocument();
    expect(screen.getByText('Tomorrow concert')).toBeInTheDocument();
    expect(screen.queryByText('Ended yesterday')).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown start')).not.toBeInTheDocument();
    expect(screen.getByText('Fixture market')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Major Events in Your Market'));
    expect(screen.getByText('Major local event')).toBeInTheDocument();
    expect(screen.queryByText('Major tomorrow event')).not.toBeInTheDocument();
    expect(jest.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/briefing/'))).toHaveLength(1);
    expect(jest.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/blocks'))).toBe(false);
    expect(jest.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(fetch).toHaveBeenCalledWith('/api/briefing/snapshot/briefing-fixture', expect.objectContaining({ headers: { Authorization: 'Bearer synthetic' } }));
  });

  it('preserves provider failure flags and reasons for every section', async () => {
    const data = aggregate();
    Object.values(data.briefing).forEach(section => { section._generationFailed = true; });
    data.briefing.traffic.reason = 'Traffic provider unavailable';
    data.briefing.news.reason = 'News provider unavailable';
    data.briefing.events.reason = 'Event discovery unavailable';
    data.briefing.school_closures.reason = 'School source unavailable';
    data.briefing.airport_conditions.reason = 'Airport source unavailable';
    mount(data);
    expect(await screen.findByText(/Events couldn't be generated.*Event discovery unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Weather temporarily unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Traffic data couldn't be retrieved.*Traffic provider unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/News couldn't be generated.*News provider unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/School source unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Airport source unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('No events found in your area')).not.toBeInTheDocument();
    expect(screen.queryByText('No significant traffic issues')).not.toBeInTheDocument();
  });

  it('keeps pending and verified-empty events distinct', async () => {
    const data = aggregate();
    data.briefing.events._pending = true;
    mount(data);
    expect(await screen.findByText('Loading events...')).toBeInTheDocument();
    expect(screen.queryByText('No events found in your area')).not.toBeInTheDocument();
  });

  it('shows the server explanation after verified-empty discovery', async () => {
    const data = aggregate();
    data.briefing.events.reason = 'No scheduled events in this market today';
    mount(data);
    expect(await screen.findByText('No scheduled events in this market today')).toBeInTheDocument();
    expect(screen.queryByText('Loading events...')).not.toBeInTheDocument();
    expect(screen.queryByText(/Events couldn't be generated/)).not.toBeInTheDocument();
  });

  it('shows exhausted recovery honestly and restores the cards after an explicit retry', async () => {
    const data = aggregate();
    data.briefing.events.reason = 'No scheduled events in this market today';
    const client = mount(data);
    await screen.findByText('No scheduled events in this market today');
    client.setQueryData(QUERY_KEYS.BRIEFING_AGGREGATE('briefing-fixture'), {
      snapshot_id: 'briefing-fixture', briefing: {}, _error: 503, _exhausted: true,
    });
    expect(await screen.findByText('Briefing data is temporarily unavailable. Try again to refresh it.')).toHaveAttribute('role', 'alert');
    expect(screen.queryByText('No events found in your area')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading forecast...')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry briefing' }));
    expect(await screen.findByText('No scheduled events in this market today')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

it('preserves a venue event across display midnight and surfaces missing market coverage', async () => {
  const data = aggregate();
  Object.assign(data.briefing.events, { market_status: 'partial', unresolved_market_events: 1 });
  data.briefing.events.marketEvents = [{ title: 'Across-zone show', venue: 'Verified venue',
    event_start_date: '2026-09-14', event_end_date: '2026-09-14', event_start_time: '00:15', event_end_time: '01:30',
    start_time_iso: '2026-09-14T04:15:00Z', end_time_iso: '2026-09-14T05:30:00Z', timezone: 'America/New_York' }];
  mount(data);
  expect(await screen.findByText('Some market events have unconfirmed times and are not shown.')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Major Events in Your Market'));
  expect(screen.getByText('Across-zone show')).toBeInTheDocument();
  expect(screen.queryByText('00:15')).not.toBeInTheDocument();
});

it('shows a completed event section while another required section remains pending', async () => {
  const data = aggregate();
  data.briefing.school_closures._pending = true;
  data.briefing.events.items = [{ title: 'Ready while schools load', event_start_date: '2026-09-13', event_start_time: '20:00' }];
  mount(data);
  expect(await screen.findByText('Ready while schools load')).toBeInTheDocument();
  expect(screen.getByText('Loading school closures...')).toBeInTheDocument();
  expect(screen.queryByText('Loading events...')).not.toBeInTheDocument();
});
