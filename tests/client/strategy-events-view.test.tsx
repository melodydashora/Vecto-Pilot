import React from 'react';
import '@testing-library/jest-dom/jest-globals';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, within, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.unstable_mockModule('@/components/strategy/StrategyMap', () => ({ default: () => null }));
jest.unstable_mockModule('@/components/BarsDataGrid', () => ({ default: () => null }));
jest.unstable_mockModule('@/components/SmartBlocksStatus', () => ({ SmartBlocksStatus: () => null }));
jest.unstable_mockModule('@/components/co-pilot/GreetingBanner', () => ({ GreetingBanner: () => null }));
jest.unstable_mockModule('@/components/FeedbackModal', () => ({ FeedbackModal: () => null }));
jest.unstable_mockModule('@/hooks/useBriefingQueries', () => ({ useActiveEventsQuery: () => ({ data: { events: [] } }) }));
jest.unstable_mockModule('@/hooks/useTrafficIncidents', () => ({ useTrafficIncidents: () => [] }));
jest.unstable_mockModule('@/hooks/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.unstable_mockModule('@/contexts/location-context-clean', () => ({ useLocation: () => ({ refreshGPS: jest.fn() }) }));
// main's StrategyPage reads user/token from useAuth (venue feedback + source-time gating).
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
  it('shows a badge only for a confirmed event with a supplied label', () => {
    render(<QueryClientProvider client={client}><StrategyPage /></QueryClientProvider>);
    const eventCard = within(screen.getByTestId('block-0'));
    expect(eventCard.getByText('Venue with a confirmed event')).toBeInTheDocument();
    expect(eventCard.getByText(/Event: Live Music/)).toBeInTheDocument();
    expect(within(screen.getByTestId('block-1')).queryByText(/Event:/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId('block-2')).queryByText(/Event:/)).not.toBeInTheDocument();
  });
});
