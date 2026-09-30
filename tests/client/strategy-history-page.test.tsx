// Actual StrategyPage and PreviousStrategyCard rendering. Current provider state
// is supplied explicitly here; the actual provider's A→B/identity transitions are
// covered separately in previous-strategy.test.tsx. No DB, app or provider calls.
import React from 'react';
import { jest, beforeEach, afterEach, describe, it, test, expect } from '@jest/globals';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/jest-globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockAuth = { user: { userId: 'driver-history-a' }, token: 'synthetic-history-token' };
const mockMap = jest.fn((_props: unknown) => <div data-testid="current-map-fixture" />);
const mockLogAction = jest.fn();
const mockRefreshBlocks = jest.fn();
const mockRefreshGPS = jest.fn();
const mockContinueStrategy = jest.fn(async (_snapshotId: string) => true);
const mockReviewSetup = jest.fn();
let mockSetup: Record<string, any>;
let mockLocation: Record<string, any>;
let mockState: Record<string, any>;
jest.unstable_mockModule('@/contexts/run-setup-context', () => ({ useRunSetup: () => mockSetup }));
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => mockAuth }));
jest.unstable_mockModule('@/contexts/location-context-clean', () => ({ useLocation: () => mockLocation }));
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
  mockLocation = { refreshGPS: mockRefreshGPS, isLoading: false, contextReady: true, lastSnapshotId: 'source-b' };
  mockSetup = { run: { runId: 'synthetic-run', sourceSnapshotId: 'source-b' }, preferencesConfirmed: true, canContinue: true, starting: false, error: null, reviewSetup: mockReviewSetup, continueWithSavedPreferences: mockContinueStrategy };
  mockContinueStrategy.mockClear(); mockReviewSetup.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockState = {
    coords: { latitude: 41, longitude: -87 }, lastSnapshotId: 'snapshot-b',
    strategyData: { status: 'pending' }, immediateStrategy: '', previousStrategy: { ...history },
    historicalMap: null, rememberMap: jest.fn(),
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


test('Strategy Refresh consumes prepared context without collecting another location', async () => {
  render(<Page />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh Strategy' })); });
  expect(mockContinueStrategy).toHaveBeenCalledWith('source-b');
  expect(mockRefreshGPS).not.toHaveBeenCalled();
});

test('Strategy Continue opens the preference choice when no choice has been confirmed', async () => {
  mockSetup.preferencesConfirmed = false;
  mockSetup.run = null;
  mockState.previousStrategy = null;
  render(<Page />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue Strategy' })); });
  expect(mockReviewSetup).toHaveBeenCalledTimes(1);
  expect(mockContinueStrategy).not.toHaveBeenCalled();
  expect(screen.getByTestId('strategy-ready-card')).toBeVisible();
  expect(screen.queryByTestId('strategy-pending-card')).not.toBeInTheDocument();
});

test('pending context disables Strategy start while other saved guidance stays visible', () => {
  mockLocation.contextReady = false; mockLocation.isLoading = true;
  render(<Page />);
  expect(screen.getByRole('button', { name: 'Refresh Strategy' })).toBeDisabled();
  expect(screen.getByTestId('previous-strategy-card')).toHaveTextContent(history.text);
  expect(mockContinueStrategy).not.toHaveBeenCalled();
});

test('failed replacement keeps previous venues and map until a completed replacement arrives', async () => {
  mockState.strategyData = { status: 'failed' };
  mockState.strategyError = 'This Strategy refresh failed.';
  mockState.previousBlocksData = { blocks: [{ name: 'Earlier venue', address: 'Earlier address', placeId: 'earlier-place' }] };
  mockState.historicalMap = { sourceSnapshotId: 'snapshot-a', props: { driverLat: 42, driverLng: -88,
    venues: [{ id: 'earlier-place', name: 'Earlier venue', lat: 42, lng: -88 }], bars: [], events: [] } };
  const view = render(<Page />);
  const venues = screen.getByTestId('previous-strategy-venues');
  expect(venues).toHaveTextContent('Earlier venue');
  expect(venues).toHaveTextContent('Earlier address');
  expect(venues.querySelector('button,a,[data-place-id]')).toBeNull();
  expect(mockMap.mock.calls.at(-1)?.[0]).toMatchObject({ driverLat: 42, driverLng: -88, snapshotId: 'snapshot-a' });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry Strategy' })); });
  expect(mockContinueStrategy).toHaveBeenCalledWith('source-b');
  expect(screen.getByTestId('previous-strategy-venues')).toHaveTextContent('Earlier venue');
  mockState = { ...mockState, strategyError: null, strategyData: { status: 'ok' }, previousBlocksData: null,
    previousStrategy: { ...history, sourceSnapshotId: 'snapshot-b', text: 'Completed new guidance' },
    immediateStrategy: 'Completed new guidance', historicalMap: null };
  view.rerender(<Page />);
  expect(screen.getByTestId('immediate-strategy-card')).toHaveTextContent('Completed new guidance');
  expect(screen.queryByTestId('previous-strategy-venues')).not.toBeInTheDocument();
  expect(screen.queryByTestId('previous-strategy-card')).not.toBeInTheDocument();
});


test('a pending replacement venue ranking retains the completed previous map until its venues arrive', () => {
  mockState.strategyData = { status: 'pending_blocks' };
  mockState.immediateStrategy = 'New guidance; venues still preparing.';
  mockState.isBlocksLoading = true;
  mockState.previousBlocksData = { blocks: [{ name: 'Earlier venue', address: 'Earlier address', placeId: 'earlier-place' }] };
  mockState.historicalMap = { sourceSnapshotId: 'snapshot-a', props: { driverLat: 42, driverLng: -88,
    venues: [{ id: 'earlier-place', name: 'Earlier venue', lat: 42, lng: -88 }], bars: [], events: [] } };
  const view = render(<Page />);
  expect(screen.getByTestId('previous-strategy-venues')).toHaveTextContent('Earlier venue');
  expect(mockMap.mock.calls.at(-1)?.[0]).toMatchObject({ driverLat: 42, driverLng: -88, snapshotId: 'snapshot-a' });
  mockState = { ...mockState, strategyData: { status: 'ok' }, isBlocksLoading: false, previousBlocksData: null,
    previousStrategy: { ...history, sourceSnapshotId: 'snapshot-b', text: mockState.immediateStrategy },
    blocks: [{ name: 'Replacement venue', placeId: 'replacement-place', coordinates: { lat: 41.1, lng: -87.1 } }] };
  view.rerender(<Page />);
  expect(screen.queryByTestId('previous-strategy-venues')).not.toBeInTheDocument();
  expect(mockMap.mock.calls.at(-1)?.[0]).toMatchObject({ driverLat: 41, driverLng: -87, snapshotId: 'snapshot-b',
    venues: [{ id: 'replacement-place', name: 'Replacement venue', lat: 41.1, lng: -87.1 }] });
});
