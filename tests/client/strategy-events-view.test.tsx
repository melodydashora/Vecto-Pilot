import React from 'react';
import '@testing-library/jest-dom/jest-globals';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, within, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const map = jest.fn((_props: any) => null);
let activeEvents: any[] = [];
jest.unstable_mockModule('@/components/strategy/StrategyMap', () => ({ default: map }));
jest.unstable_mockModule('@/components/BarsDataGrid', () => ({ default: () => null }));
jest.unstable_mockModule('@/components/SmartBlocksStatus', () => ({ SmartBlocksStatus: () => null }));
jest.unstable_mockModule('@/components/co-pilot/GreetingBanner', () => ({ GreetingBanner: () => null }));
jest.unstable_mockModule('@/components/FeedbackModal', () => ({ FeedbackModal: () => null }));
jest.unstable_mockModule('@/hooks/useBriefingQueries', () => ({ useActiveEventsQuery: () => ({ data: { events: activeEvents } }) }));
jest.unstable_mockModule('@/hooks/useTrafficIncidents', () => ({ useTrafficIncidents: () => [] }));
jest.unstable_mockModule('@/hooks/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.unstable_mockModule('@/contexts/location-context-clean', () => ({ useLocation: () => ({ refreshGPS: jest.fn() }) }));
// main's StrategyPage reads user/token from useAuth (venue feedback + source-time gating).
jest.unstable_mockModule('@/contexts/run-setup-context', () => ({ useRunSetup: () => ({ run: { runId: 'synthetic-run' }, preferencesConfirmed: true, canContinue: true, starting: false, error: null, reviewSetup: jest.fn(), continueWithSavedPreferences: jest.fn() }) }));
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => ({ isAuthenticated: true, user: { userId: 'synthetic-driver' }, token: 'synthetic-token' }) }));
const helpers = await import('@/utils/co-pilot-helpers');
jest.unstable_mockModule('@/utils/co-pilot-helpers', () => ({ ...helpers, logAction: jest.fn() }));

const block = (name: string, latitude: number, extra: object = {}) => ({
  name,
  coordinates: { lat: latitude, lng: -96.82 },
  placeId: `fixture-${name}`,
  valueGrade: 'A',
  notWorth: false,
  estimatedDistanceMiles: 1.2,
  isOpen: true,
  proTips: [],
  ...extra,
});
const blocks = [
  block('Venue with a confirmed event', 33.15, { hasEvent: true, eventBadge: 'Live Music' }),
  block('Venue without an event', 33.18, { hasEvent: false }),
  block('Venue with no event label', 33.21, { hasEvent: true, eventBadge: null }),
];
jest.unstable_mockModule('@/contexts/co-pilot-context', () => ({
  useCoPilot: () => ({
    coords: { latitude: 33.15, longitude: -96.82 },
    lastSnapshotId: 'fixture',
    strategyData: { status: 'ok' },
    immediateStrategy: 'Fixture strategy',
    historicalMap: null,
    rememberMap: jest.fn(),
    isStrategyFetching: false,
    blocks,
    blocksData: { rankingId: 'fixture-ranking' },
    barsData: null,
    isBlocksLoading: false,
    blocksError: null,
    refetchBlocks: jest.fn(),
    enrichmentProgress: 100,
    strategyProgress: 100,
    enrichmentPhase: 'idle',
    pipelinePhase: 'complete',
    timeRemainingText: null,
    timezone: 'America/Chicago',
  }),
}));
const { default: StrategyPage } = await import('@/pages/co-pilot/StrategyPage');
let client: QueryClient;
const originalObserver = globalThis.IntersectionObserver;

beforeEach(() => {
  map.mockClear(); activeEvents = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  globalThis.IntersectionObserver = class {
    disconnect() {}
    observe() {}
    unobserve() {}
    takeRecords() { return []; }
  } as unknown as typeof IntersectionObserver;
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  client.clear();
  globalThis.IntersectionObserver = originalObserver;
  jest.restoreAllMocks();
});

describe('Strategy venue event badges', () => {
  it('preserves absolute event times, venue timezone and conflicting source reports through the actual page', () => {
    const variants = [{ title: 'Late show', end_time_iso: '2026-09-30T05:30:00Z' },
      { title: 'Late show', end_time_iso: '2026-09-30T06:30:00Z' }];
    const event = { title: 'Late show', latitude: 0, longitude: -74,
      event_start_date: '2026-09-30', event_start_time: '00:15', event_end_date: '2026-09-30',
      start_time_iso: '2026-09-30T04:15:00Z', end_time_iso: '2026-09-30T05:30:00Z',
      timezone: 'America/New_York', event_end_conflict: true, event_variants: variants };
    activeEvents = [event];
    render(<QueryClientProvider client={client}><StrategyPage /></QueryClientProvider>);
    const received = map.mock.calls.at(-1)?.[0].events[0];
    expect(received).toMatchObject(event);
    expect(received.event_variants).toBe(variants);
    expect({ ...received, ...helpers.eventDisplayFields(received, 'America/Chicago') }).toMatchObject({
      event_start_date: '2026-09-29', event_start_time: '23:15', event_end_time: undefined,
    });
  });
  it('does not invent an unresolved ISO field for a legacy event that supplies only wall clocks', () => {
    activeEvents = [{ title: 'Legacy report', event_start_date: '2026-09-29', event_start_time: '12:00', latitude: 0, longitude: 1 }];
    render(<QueryClientProvider client={client}><StrategyPage /></QueryClientProvider>);
    const received = map.mock.calls.at(-1)?.[0].events[0];
    expect(Object.prototype.hasOwnProperty.call(received, 'start_time_iso')).toBe(false);
    expect(helpers.eventDisplayFields(received, 'America/Chicago')).toEqual({});
  });
  it('keeps unknown route measurements and surge unknown instead of substituting wait time or demand', () => {
    const saved = { ...blocks[0] };
    Object.assign(blocks[0], { estimatedDistanceMiles: undefined, driveTimeMinutes: undefined, estimatedWaitTime: 17, demandLevel: 'high', surge: undefined });
    try {
      render(<QueryClientProvider client={client}><StrategyPage /></QueryClientProvider>);
      const card = within(screen.getByTestId('block-0'));
      expect(card.getByText('Distance unavailable')).toBeInTheDocument();
      expect(card.getByText('Drive time unavailable')).toBeInTheDocument();
      expect(card.getByText('Surge unavailable')).toBeInTheDocument();
      expect(card.queryByText('0.0 mi')).not.toBeInTheDocument();
      expect(card.queryByText(/est drive time 17/)).not.toBeInTheDocument();
      expect(card.queryByText('1.5x')).not.toBeInTheDocument();
    } finally { Object.assign(blocks[0], saved); }
  });
  it('shows a badge only for a confirmed event with a supplied label', () => {
    render(<QueryClientProvider client={client}><StrategyPage /></QueryClientProvider>);
    const eventCard = within(screen.getByTestId('block-0'));
    expect(eventCard.getByText('Venue with a confirmed event')).toBeInTheDocument();
    expect(eventCard.getByText(/Event: Live Music/)).toBeInTheDocument();
    expect(within(screen.getByTestId('block-1')).queryByText(/Event:/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId('block-2')).queryByText(/Event:/)).not.toBeInTheDocument();
  });
});
