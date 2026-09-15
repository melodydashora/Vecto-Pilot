// Actual StrategyPage and PreviousStrategyCard rendering. Current provider state
// is supplied explicitly here; the actual provider's A→B/identity transitions are
// covered separately in previous-strategy.test.tsx. No DB, app or provider calls.
import React from 'react';
import { jest, beforeEach, afterEach, describe, it, test, expect } from '@jest/globals';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/jest-globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockAuth = { user: { userId: 'driver-history-a' }, token: 'synthetic-history-token' };
const mockMap = jest.fn((_props: unknown) => <div data-testid="current-map-fixture" />);
const mockLogAction = jest.fn();
const mockRefreshBlocks = jest.fn();
const mockRefreshGPS = jest.fn();
let mockState: Record<string, any>;
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => mockAuth }));
jest.unstable_mockModule('@/contexts/location-context-clean', () => ({ useLocation: () => ({ refreshGPS: mockRefreshGPS, isLoading: false }) }));
jest.unstable_mockModule('@/contexts/co-pilot-context', () => ({ useCoPilot: () => mockState }));
jest.unstable_mockModule('@/components/strategy/StrategyMap', () => ({ __esModule: true, default: (props: unknown) => mockMap(props) }));
jest.unstable_mockModule('@/components/BarsDataGrid', () => ({ __esModule: true, default: () => <div data-testid="current-grid-fixture" /> }));
jest.unstable_mockModule('@/components/co-pilot/GreetingBanner', () => ({ GreetingBanner: () => null }));
jest.unstable_mockModule('@/components/SmartBlocksStatus', () => ({ SmartBlocksStatus: () => <div data-testid="current-pipeline-status">Current pipeline fixture</div> }));
jest.unstable_mockModule('@/hooks/useBriefingQueries', () => ({ useActiveEventsQuery: () => ({ data: { events: [] } }) }));
jest.unstable_mockModule('@/hooks/useTrafficIncidents', () => ({ useTrafficIncidents: () => [] }));
jest.unstable_mockModule('@/hooks/useStrategyLoadingMessages', () => ({ useStrategyLoadingMessages: () => ({ badge: 'Current snapshot pending', text: 'Preparing current snapshot B', icon: '', step: 'Current Briefing', messageCount: 1, currentIndex: 0 }) }));
const actualHelpers = await import('@/utils/co-pilot-helpers');
jest.unstable_mockModule('@/utils/co-pilot-helpers', () => ({ ...actualHelpers, logAction: (...args: unknown[]) => mockLogAction(...args) }));
jest.unstable_mockModule('@/constants/featureFlags', () => ({ COACH_STREAMING_TTS_ENABLED: true, DEBUG_MAP_ENABLED: false, DEBUG_VENUES_ENABLED: false, DEBUG_SSE_ENABLED: false, DEBUG_BLOCKS_ENABLED: false }));
const { default: StrategyPage } = await import('@/pages/co-pilot/StrategyPage');

const receivedAt = '2026-09-11T03:00:00.000Z';
const history = {
  ownerId: mockAuth.user.userId, sourceSnapshotId: 'snapshot-a',
  text: 'Earlier guidance: wait near the east exit while the evening crowd leaves.',
  receivedAt, city: 'Chicago', timezone: 'America/Chicago',
};
let client: QueryClient;
const originalFetch = globalThis.fetch;
function Page() { return <QueryClientProvider client={client}><StrategyPage /></QueryClientProvider>; }
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockState = {
    coords: { latitude: 41, longitude: -87 }, lastSnapshotId: 'snapshot-b',
    strategyData: { status: 'pending' }, immediateStrategy: '', previousStrategy: { ...history },
    isStrategyFetching: true, snapshotData: null, blocks: [], blocksData: undefined,
    isBlocksLoading: false, blocksError: null, barsData: null, refetchBlocks: mockRefreshBlocks,
    enrichmentProgress: 15, strategyProgress: 12, enrichmentPhase: 'analyzing', pipelinePhase: 'analyzing',
    timeRemainingText: '', timezone: 'America/Chicago',
  };
  mockMap.mockClear(); mockLogAction.mockClear(); mockRefreshBlocks.mockClear(); mockRefreshGPS.mockClear();
  globalThis.fetch = jest.fn(async () => { throw new Error('History rendering must not start an API request'); });
});
afterEach(() => {
  cleanup(); client.clear();
  expect(globalThis.fetch).not.toHaveBeenCalled(); globalThis.fetch = originalFetch;
  expect(mockRefreshBlocks).not.toHaveBeenCalled(); expect(mockRefreshGPS).not.toHaveBeenCalled();
  expect(mockLogAction).not.toHaveBeenCalled();
});

test('pending snapshot B keeps A as explicitly previous guidance alongside the current pending status', () => {
  render(<Page />);
  const card = screen.getByTestId('previous-strategy-card');
  expect(card).toHaveTextContent('Previous strategy');
  expect(card).toHaveTextContent('New strategy on the way');
  expect(card).toHaveTextContent(history.text);
  expect(card).toHaveTextContent('Last received');
  expect(card).toHaveTextContent('Chicago');
  expect(card.querySelector('time')).toHaveAttribute('dateTime', receivedAt);
  expect(card.querySelector('time')).toHaveTextContent('2026-09-11 03:00 UTC');
  expect(screen.getByTestId('strategy-pending-card')).toHaveTextContent('Preparing current snapshot B');
  expect(screen.getByTestId('current-pipeline-status')).toBeInTheDocument();
  expect(screen.queryByTestId('immediate-strategy-card')).not.toBeInTheDocument();
});

test('history is read-only text and cannot attach historical venue IDs, feedback, navigation or dwell', () => {
  render(<Page />);
  const card = screen.getByTestId('previous-strategy-card');
  expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  expect(within(card).queryByRole('link')).not.toBeInTheDocument();
  expect(card.querySelector('[data-place-id],[data-block-index],canvas,iframe,input,textarea')).toBeNull();
  expect(document.querySelector('[data-place-id]')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Remove .* from this strategy$/ })).not.toBeInTheDocument();
  for (const [props] of mockMap.mock.calls) {
    expect(props).toMatchObject({ venues: [], snapshotId: 'snapshot-b' });
  }
});

test('missing GPS retains previous text while keeping the actual current GPS prompt visible', () => {
  mockState.coords = null;
  render(<Page />);
  expect(screen.getByTestId('previous-strategy-card')).toHaveTextContent(history.text);
  expect(screen.getByTestId('strategy-needs-gps')).toHaveTextContent('GPS Required for Strategy');
  expect(screen.getByRole('button', { name: 'Enable GPS' })).toBeEnabled();
  expect(screen.queryByTestId('current-map-fixture')).not.toBeInTheDocument();
});

test('a current failure stays visible alongside previous guidance instead of becoming fresh success', () => {
  mockState.strategyData = { status: 'failed' }; mockState.isStrategyFetching = false;
  render(<Page />);
  expect(screen.getByTestId('previous-strategy-card')).toHaveTextContent(history.text);
  expect(screen.getByTestId('strategy-failed-card')).toHaveTextContent('Strategy Generation Failed');
  expect(screen.queryByTestId('immediate-strategy-card')).not.toBeInTheDocument();
});

test('when current B arrives, its current card replaces history and no previous text remains', () => {
  const view = render(<Page />);
  expect(screen.getByTestId('previous-strategy-card')).toHaveTextContent(history.text);
  mockState = { ...mockState, strategyData: { status: 'ok' }, immediateStrategy: 'Current B guidance: take the north staging lane.', isStrategyFetching: false };
  view.rerender(<Page />);
  expect(screen.getByTestId('immediate-strategy-card')).toHaveTextContent(mockState.immediateStrategy);
  expect(screen.queryByTestId('previous-strategy-card')).not.toBeInTheDocument();
  expect(screen.queryByText(history.text)).not.toBeInTheDocument();
});

test('historical markup remains literal text without creating active HTML or navigation', () => {
  const unsafeLookingText = '<img src="x" onerror="window.historyProbe=true"> **Earlier text** <a href="https://synthetic.invalid">Old venue</a>';
  mockState.previousStrategy = { ...history, text: unsafeLookingText };
  render(<Page />);
  const card = screen.getByTestId('previous-strategy-card');
  expect(card).toHaveTextContent('<img src="x" onerror="window.historyProbe=true">');
  expect(card).toHaveTextContent('<a href="https://synthetic.invalid">Old venue</a>');
  expect(card.querySelector('strong')).toHaveTextContent('Earlier text');
  expect(card.querySelector('img,a,script')).toBeNull();
});

test('an account with no prior guidance keeps the existing pending page without an empty history card', () => {
  mockState.previousStrategy = null;
  render(<Page />);
  expect(screen.queryByTestId('previous-strategy-card')).not.toBeInTheDocument();
  expect(screen.getByTestId('strategy-pending-card')).toBeInTheDocument();
});

test('legacy home-radius flags cannot mark current nearby venues as outside a driver limit', () => {
  mockState.blocks = Array.from({ length: 6 }, (_, index) => ({
    name: `Current fixture venue ${index}`, placeId: `current-venue-${index}`,
    coordinates: { lat: 41 + index * 0.02, lng: -87 }, valueGrade: 'A',
    estimatedDistanceMiles: 1, driveTimeMinutes: 3, beyondDeadhead: true, distanceFromHomeMi: 200,
  }));
  mockState.strategyData = { status: 'ok' };
  mockState.immediateStrategy = 'Use verified demand near the current location.';
  mockState.isStrategyFetching = false;
  render(<Page />);
  const cards = screen.getByTestId('blocks-list');
  expect(cards.querySelectorAll('[data-block-index]')).toHaveLength(3);
  for (const index of [0, 1, 2]) {
    expect(screen.getByTestId(`block-${index}`)).toBeVisible();
    expect(screen.getByTestId(`block-${index}`)).not.toHaveClass('bg-amber-50/30');
  }
  expect(within(cards).queryByText(/from home|Beyond range/)).not.toBeInTheDocument();
});
