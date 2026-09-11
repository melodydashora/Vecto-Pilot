// 2026-09-11: mount the actual StrategyPage, FeedbackModal, feedback hook,
// query cache and A/B shortlist filter. Synthetic HTTP only. Auth/location/
// co-pilot data and unrelated map/grid/greeting/events/traffic/pipeline status
// are fixtures; feature flags match current feedback-independent defaults.
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { API_ROUTES, QUERY_KEYS } from '@/constants/apiRoutes';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import type { BlocksResponse, SmartBlock } from '@/types/co-pilot';
import type { VenueFeedbackState } from '@/hooks/useVenueFeedback';
import { useToast } from '@/hooks/useToast';

let mockAuth = { user: { userId: 'driver-a' }, token: 'synthetic-a' };
let mockScope = { snapshotId: 'snapshot-a', rankingId: 'ranking-a' };
const mockRefreshBlocks = jest.fn();
const mockCoords = { latitude: 41, longitude: -87 };
jest.mock('@/contexts/auth-context', () => ({ useAuth: () => mockAuth }));
jest.mock('@/contexts/location-context-clean', () => ({ useLocation: () => ({ refreshGPS: jest.fn(), isLoading: false }) }));
jest.mock('@/contexts/co-pilot-context', () => ({ useCoPilot: () => {
  const { useQuery } = require('@tanstack/react-query');
  const { data } = useQuery({ queryKey: ['/api/blocks-fast', mockScope.snapshotId], enabled: false,
    queryFn: () => { throw new Error('Page test must not regenerate blocks'); } });
  return { coords: mockCoords, lastSnapshotId: mockScope.snapshotId, strategyData: { status: 'ok' },
    immediateStrategy: 'Synthetic current strategy', isStrategyFetching: false, snapshotData: null,
    blocks: data?.blocks || [], blocksData: data, isBlocksLoading: false, blocksError: null,
    barsData: null, refetchBlocks: mockRefreshBlocks, enrichmentProgress: 100, strategyProgress: 100,
    enrichmentPhase: 'idle', pipelinePhase: 'complete', timeRemainingText: '', timezone: 'America/Chicago' };
} }));
jest.mock('@/components/strategy/StrategyMap', () => ({ __esModule: true,
  default: ({ venues }: { venues: Array<{ id: string }> }) => <div data-testid="fixture-map" data-place-ids={venues.map(venue => venue.id).join(',')} /> }));
jest.mock('@/components/BarsDataGrid', () => ({ __esModule: true,
  default: ({ blocks }: { blocks: SmartBlock[] }) => <div data-testid="fixture-grid" data-place-ids={blocks.map(block => block.placeId).join(',')} /> }));
jest.mock('@/components/co-pilot/GreetingBanner', () => ({ GreetingBanner: () => null }));
jest.mock('@/components/SmartBlocksStatus', () => ({ SmartBlocksStatus: () => null }));
jest.mock('@/hooks/useBriefingQueries', () => ({ useActiveEventsQuery: () => ({ data: { events: [] } }) }));
jest.mock('@/hooks/useTrafficIncidents', () => ({ useTrafficIncidents: () => [] }));
jest.mock('@/constants/featureFlags', () => ({ COACH_STREAMING_TTS_ENABLED: true,
  DEBUG_MAP_ENABLED: false, DEBUG_VENUES_ENABLED: false, DEBUG_SSE_ENABLED: false, DEBUG_BLOCKS_ENABLED: false }));
import StrategyPage from '@/pages/co-pilot/StrategyPage';

const block = (placeId: string, name: string, latitude: number, valueGrade = 'A'): SmartBlock => ({
  placeId, name, valueGrade, coordinates: { lat: latitude, lng: -87 }, valuePerMin: 1.2,
  estimatedDistanceMiles: 2, estimatedWaitTime: 8, estimatedEarningsPerRide: 18, isOpen: true,
});
const alpha = block('place-alpha', 'Stage Alpha', 41);
const beta = block('place-beta', 'Stage Beta', 41.03, 'B');
const replacement = block('place-replacement', 'Stage Replacement', 41.06);
const lowValue = block('place-low', 'Filtered Low Value', 41.09, 'C');
let rawBlocks = [lowValue, alpha, beta];
function state(snapshotId = mockScope.snapshotId, rankingId = mockScope.rankingId,
  blocks = [alpha, beta], revision = 0, dismissals: VenueFeedbackState['dismissals'] = []): VenueFeedbackState {
  return { ok: true, snapshot_id: snapshotId, ranking_id: rankingId, scope_revision: revision,
    blocks, dismissals, dismissed_place_ids: dismissals.map(dismissal => dismissal.place_id) };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const response = (value: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value }) as Response;
const posts: Array<{ body: Record<string, any>; init: RequestInit; reply: ReturnType<typeof deferred<Response>> }> = [];
const actions: Array<Record<string, any>> = [];
const savedStates = new Map<string, VenueFeedbackState>();
const unexpected: string[] = [];
const originalFetch = globalThis.fetch;
const originalObserver = globalThis.IntersectionObserver;
let client: QueryClient;
let now = 1000;
class Observer {
  static instances: Observer[] = [];
  targets: Element[] = [];
  disconnected = false;
  constructor(public callback: IntersectionObserverCallback) { Observer.instances.push(this); }
  observe(target: Element) { this.targets.push(target); }
  disconnect() { this.disconnected = true; }
  emit(target: Element, isIntersecting: boolean) {
    this.callback([{ target, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}
function savedKey(token: string, snapshotId: string, rankingId: string) { return `${token}:${snapshotId}:${rankingId}`; }
function seedScope(blocks = rawBlocks, saved = state()) {
  client.setQueryData<BlocksResponse>(QUERY_KEYS.BLOCKS_FAST(mockScope.snapshotId), {
    now: '2026-09-11T02:45:00Z', timezone: 'America/Chicago', rankingId: mockScope.rankingId, blocks,
    metadata: { totalBlocks: blocks.length, processingTimeMs: 10 },
  });
  savedStates.set(savedKey(mockAuth.token, mockScope.snapshotId, mockScope.rankingId), saved);
}
function Page() { return <QueryClientProvider client={client}><StrategyPage /></QueryClientProvider>; }
// Observe the actual toast store without mounting unrelated toast animation timers.
function ToastReceipt() {
  const { toasts } = useToast();
  return <div data-testid="feedback-announcements">{toasts.map(toast => <p key={toast.id}>{toast.title} {toast.description}</p>)}</div>;
}
async function mountPage() { const view = render(<Page />); await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Stage Alpha from this strategy' })).toBeEnabled()); return view; }
function visibleIds() { return Array.from(document.querySelectorAll<HTMLElement>('[data-place-id]')).map(element => element.dataset.placeId); }
function card(placeId: string) { return document.querySelector<HTMLElement>(`[data-place-id="${placeId}"]`)!; }
function receipt(index: number, options: { blocks?: SmartBlock[]; exhausted?: boolean; restore?: boolean } = {}) {
  const body = posts[index].body;
  const dismissals = options.restore ? [] : [{ place_id: body.place_id, action_id: body.request_id, venue_name: 'Stage Alpha' }];
  return { ...state(body.snapshot_id, body.ranking_id, options.blocks ?? (options.restore ? [alpha, beta] : [replacement, beta]), options.restore ? 2 : 1, dismissals),
    action_id: body.request_id, feedback_id: 'feedback-fixture', place_id: body.place_id, action: body.action,
    replacement: options.restore || options.exhausted ? null : replacement,
    replacement_status: options.restore ? 'not_requested' : options.exhausted ? 'exhausted' : 'replaced', restored: !!options.restore };
}
async function beginDismiss(comment = 'This is quiet right now') {
  fireEvent.click(screen.getByRole('button', { name: 'Remove Stage Alpha from this strategy' }));
  fireEvent.change(screen.getByLabelText('Additional comments (optional)'), { target: { value: comment } });
  fireEvent.click(screen.getByTestId('button-submit-feedback'));
  await waitFor(() => expect(posts.length).toBeGreaterThan(0));
}
async function confirm(index: number, value = receipt(index)) {
  const token = String((posts[index].init.headers as Record<string, string>).Authorization).slice(7);
  savedStates.set(savedKey(token, value.snapshot_id, value.ranking_id), value);
  await act(async () => { posts[index].reply.resolve(response(value)); });
}

beforeEach(() => {
  mockAuth = { user: { userId: 'driver-a' }, token: 'synthetic-a' };
  mockScope = { snapshotId: 'snapshot-a', rankingId: 'ranking-a' };
  rawBlocks = [lowValue, alpha, beta];
  posts.length = 0; actions.length = 0; unexpected.length = 0; savedStates.clear(); Observer.instances.length = 0;
  mockRefreshBlocks.mockClear(); localStorage.clear(); localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, mockAuth.token);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  seedScope(); now = 1000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  globalThis.IntersectionObserver = Observer as unknown as typeof IntersectionObserver;
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/blocks-fast/saved?')) {
      const params = new URL(url, 'https://synthetic.invalid').searchParams;
      const token = (init!.headers as Record<string, string>).Authorization.slice(7);
      const saved = savedStates.get(savedKey(token, params.get('snapshotId')!, params.get('rankingId')!));
      if (!saved) throw new Error('Missing saved-scope fixture');
      return response(saved);
    }
    if (url === API_ROUTES.FEEDBACK.VENUE && init?.method === 'POST') {
      const reply = deferred<Response>();
      posts.push({ init, body: JSON.parse(init.body as string), reply });
      return reply.promise;
    }
    if (url === API_ROUTES.ACTIONS) { actions.push(JSON.parse(init!.body as string)); return response({ ok: true }); }
    unexpected.push(url); throw new Error(`Unexpected page test request: ${url}`);
  });
});
afterEach(async () => {
  cleanup();
  await act(async () => { posts.forEach(post => post.reply.resolve(response({ error: 'Fixture cleanup' }, 503))); });
  client.clear(); jest.restoreAllMocks(); globalThis.fetch = originalFetch; globalThis.IntersectionObserver = originalObserver;
  expect(unexpected).toEqual([]);
  expect(mockRefreshBlocks).not.toHaveBeenCalled();
});

test('actual shortlist includes A and B, excludes C, exposes named thumbs and renders no stray zero', async () => {
  await mountPage();
  expect(visibleIds()).toEqual(['place-alpha', 'place-beta']);
  expect(screen.getByRole('button', { name: 'Recommend Stage Alpha' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Recommend Stage Beta' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Remove Stage Beta from this strategy' })).toBeEnabled();
  expect(screen.getByTestId('filter-badge')).toHaveTextContent('Grades A & B');
  expect(screen.getByTestId('fixture-grid')).toHaveAttribute('data-place-ids', 'place-alpha,place-beta');
  const textNodes = document.createTreeWalker(screen.getByTestId('strategy-page'), NodeFilter.SHOW_TEXT);
  const standaloneZeros: Node[] = []; while (textNodes.nextNode()) if (textNodes.currentNode.textContent?.trim() === '0') standaloneZeros.push(textNodes.currentNode);
  expect(standaloneZeros).toEqual([]);
});

test('confirmed dismissal updates actual cards/cache/map/grid; reload retains it and Undo restores Alpha', async () => {
  const view = await mountPage();
  await beginDismiss();
  expect(visibleIds()).toEqual(['place-alpha', 'place-beta']);
  expect(screen.getByLabelText('Additional comments (optional)')).toBeDisabled();
  fireEvent.click(screen.getByTestId('button-submit-feedback'));
  expect(posts).toHaveLength(1);
  expect(posts[0].body).toMatchObject({ action: 'dismiss', place_id: 'place-alpha', visible_place_ids: ['place-alpha', 'place-beta'] });
  expect(posts[0].init.headers).toMatchObject({ Authorization: 'Bearer synthetic-a' });
  await confirm(0);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(visibleIds()).toEqual(['place-replacement', 'place-beta']);
  expect(screen.getByTestId('fixture-map')).toHaveAttribute('data-place-ids', 'place-replacement,place-beta');
  expect(screen.getByTestId('fixture-grid')).toHaveAttribute('data-place-ids', 'place-replacement,place-beta');
  expect(client.getQueryData<BlocksResponse>(QUERY_KEYS.BLOCKS_FAST('snapshot-a'))).toMatchObject({ now: '2026-09-11T02:45:00Z', blocks: [replacement, beta] });
  view.unmount(); render(<Page />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Undo removal of Stage Alpha' })).toBeEnabled());
  expect(visibleIds()).toEqual(['place-replacement', 'place-beta']);
  fireEvent.click(screen.getByRole('button', { name: 'Undo removal of Stage Alpha' }));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1].body).toMatchObject({ action: 'restore', place_id: 'place-alpha', undo_action_id: posts[0].body.request_id });
  await confirm(1, receipt(1, { restore: true }));
  await waitFor(() => expect(visibleIds()).toEqual(['place-alpha', 'place-beta']));
  expect(screen.queryByRole('button', { name: 'Undo removal of Stage Alpha' })).not.toBeInTheDocument();
});

test('an exhausted pool leaves an honest empty list and an available Undo', async () => {
  seedScope([alpha], state(undefined, undefined, [alpha]));
  await mountPage(); await beginDismiss();
  await confirm(0, receipt(0, { exhausted: true, blocks: [] }));
  await waitFor(() => expect(visibleIds()).toEqual([]));
  expect(screen.getByText('No alternative is available in this strategy. Undo a removal to bring a venue back.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Undo removal of Stage Alpha' })).toBeEnabled();
});

test('503 preserves the actual card and editable comment; retry reuses the action ID', async () => {
  await mountPage(); await beginDismiss('Keep this exact draft');
  await act(async () => { posts[0].reply.resolve(response({ error: 'Synthetic unavailable' }, 503)); });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Feedback was not confirmed'));
  expect(visibleIds()).toEqual(['place-alpha', 'place-beta']);
  expect(screen.getByLabelText('Additional comments (optional)')).toHaveValue('Keep this exact draft');
  expect(screen.getByLabelText('Additional comments (optional)')).toBeEnabled();
  fireEvent.click(screen.getByTestId('button-submit-feedback'));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1].body.request_id).toBe(posts[0].body.request_id);
  await confirm(1);
  await waitFor(() => expect(visibleIds()).toEqual(['place-replacement', 'place-beta']));
});

test('409 reloads newer saved choices inside the open modal, retaining the comment and retrying the current visible IDs', async () => {
  await mountPage();
  const savedReads = () => (globalThis.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).startsWith('/api/blocks-fast/saved?'));
  await waitFor(() => expect(savedReads()).toHaveLength(1));
  await beginDismiss('Keep this conflict draft');
  // Another tab removes Beta while this driver is giving feedback about Alpha.
  // The initial saved load succeeded; the POST is where this conflict first appears.
  const betaDismissal = { place_id: beta.placeId!, action_id: 'other-tab-action', venue_name: beta.name };
  savedStates.set(savedKey(mockAuth.token, mockScope.snapshotId, mockScope.rankingId),
    state(undefined, undefined, [alpha, replacement], 1, [betaDismissal]));
  await act(async () => { posts[0].reply.resolve(response({ error: 'visible_scope_conflict' }, 409)); });
  const dialog = screen.getByRole('dialog');
  await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Reload saved choices'));
  expect(visibleIds()).toEqual(['place-alpha', 'place-beta']);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reload saved choices' }));
  await waitFor(() => expect(visibleIds()).toEqual(['place-alpha', 'place-replacement']));
  expect(savedReads()).toHaveLength(2);
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(within(dialog).getByLabelText('Additional comments (optional)')).toHaveValue('Keep this conflict draft');
  expect(within(dialog).getByTestId('button-submit-feedback')).toBeEnabled();
  fireEvent.click(within(dialog).getByTestId('button-submit-feedback'));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1].body).toMatchObject({ place_id: 'place-alpha', visible_place_ids: ['place-alpha', 'place-replacement'], comment: 'Keep this conflict draft' });
  expect(posts[1].body.request_id).not.toBe(posts[0].body.request_id);
  const gamma = block('place-gamma', 'Stage Gamma', 41.12);
  const alphaDismissal = { place_id: alpha.placeId!, action_id: posts[1].body.request_id, venue_name: alpha.name };
  await confirm(1, { ...receipt(1),
    ...state(undefined, undefined, [gamma, replacement], 2, [betaDismissal, alphaDismissal]), replacement: gamma });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(visibleIds()).toEqual(['place-gamma', 'place-replacement']);
});

test('duplicate Undo reports eligibility without claiming a venue absent from the canonical shortlist is back', async () => {
  await mountPage(); render(<ToastReceipt />);
  await beginDismiss(); await confirm(0);
  await waitFor(() => expect(visibleIds()).toEqual(['place-replacement', 'place-beta']));
  fireEvent.click(screen.getByRole('button', { name: 'Undo removal of Stage Alpha' }));
  await waitFor(() => expect(posts).toHaveLength(2));
  // A successful duplicate Undo can clear the removal while newer choices
  // exclude Alpha. Only the receipt's current blocks establish visibility.
  await confirm(1, { ...receipt(1, { restore: true, blocks: [replacement, beta] }), restored: false });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo removal of Stage Alpha' })).not.toBeInTheDocument());
  expect(visibleIds()).toEqual(['place-replacement', 'place-beta']);
  const announcement = screen.getByTestId('feedback-announcements');
  expect(announcement).toHaveTextContent('Removal cleared');
  expect(announcement).toHaveTextContent('eligible again but is outside the current shortlist');
  expect(announcement).not.toHaveTextContent('Venue restored');
  expect(announcement).not.toHaveTextContent('Stage Alpha is back in this strategy');
});

test.each(['snapshot', 'account'])('a new %s ignores old confirmation callbacks and preserves its open draft', async boundary => {
  const view = await mountPage(); await beginDismiss('Old private draft');
  const oldCache = client.getQueryData(QUERY_KEYS.BLOCKS_FAST('snapshot-a'));
  if (boundary === 'account') {
    mockAuth = { user: { userId: 'driver-b' }, token: 'synthetic-b' };
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, mockAuth.token);
  }
  mockScope = { snapshotId: 'snapshot-b', rankingId: 'ranking-b' };
  act(() => { seedScope(); view.rerender(<Page />); });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect((posts[0].init.signal as AbortSignal).aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Stage Alpha from this strategy' }));
  fireEvent.change(screen.getByLabelText('Additional comments (optional)'), { target: { value: 'New scope draft' } });
  await confirm(0);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByLabelText('Additional comments (optional)')).toHaveValue('New scope draft');
  expect(visibleIds()).toEqual(['place-alpha', 'place-beta']);
  expect(client.getQueryData(QUERY_KEYS.BLOCKS_FAST('snapshot-a'))).toEqual(oldCache);
  expect(client.getQueryData<BlocksResponse>(QUERY_KEYS.BLOCKS_FAST('snapshot-b'))?.blocks).toEqual(rawBlocks);
});

test('dwell logging follows displayed place identity after replacement, not the old raw index', async () => {
  await mountPage();
  const oldCard = card('place-alpha');
  const oldObserver = Observer.instances.find(observer => !observer.disconnected && observer.targets.includes(oldCard))!;
  act(() => oldObserver.emit(oldCard, true));
  await beginDismiss(); await confirm(0);
  await waitFor(() => expect(visibleIds()).toEqual(['place-replacement', 'place-beta']));
  expect(oldObserver.disconnected).toBe(true);
  now = 1900;
  act(() => oldObserver.emit(oldCard, false));
  expect(actions.filter(action => action.action === 'block_dwell')).toEqual([]);
  const newCard = card('place-replacement');
  const nextObserver = Observer.instances.find(observer => !observer.disconnected && observer.targets.includes(newCard))!;
  act(() => nextObserver.emit(newCard, true));
  now = 2800;
  act(() => nextObserver.emit(newCard, false));
  await waitFor(() => expect(actions.filter(action => action.action === 'block_dwell')).toEqual([
    expect.objectContaining({ ranking_id: 'ranking-a', block_id: 'place-replacement', dwell_ms: 900, from_rank: 1 }),
  ]));
  expect(within(newCard).getByRole('button', { name: 'Remove Stage Replacement from this strategy' })).toBeEnabled();
});

test.each(['snapshot', 'ranking'])('an open, unsent venue draft closes when its opening %s changes', async boundary => {
  const view = await mountPage();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Stage Alpha from this strategy' }));
  fireEvent.change(screen.getByLabelText('Additional comments (optional)'), { target: { value: 'Old scope only' } });
  expect(posts).toHaveLength(0);
  mockScope = boundary === 'snapshot'
    ? { snapshotId: 'snapshot-b', rankingId: 'ranking-b' }
    : { snapshotId: 'snapshot-a', rankingId: 'ranking-b' };
  act(() => { seedScope([replacement, beta], state(undefined, undefined, [replacement, beta])); view.rerender(<Page />); });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByLabelText('Additional comments (optional)')).not.toBeInTheDocument();
  expect(visibleIds()).toEqual(['place-replacement', 'place-beta']);
  expect(posts).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Stage Replacement from this strategy' }));
  expect(screen.getByLabelText('Additional comments (optional)')).toHaveValue('');
  fireEvent.click(screen.getByTestId('button-submit-feedback'));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0].body).toMatchObject({ snapshot_id: mockScope.snapshotId, ranking_id: 'ranking-b', place_id: 'place-replacement' });
  expect(posts.some(post => post.body.place_id === 'place-alpha')).toBe(false);
});

test.each(['snapshot', 'account'])('dwell elapsed time does not cross a %s change while prior blocks and ranking are retained', async boundary => {
  const view = await mountPage();
  const target = card('place-alpha');
  const oldObserver = Observer.instances.find(observer => !observer.disconnected && observer.targets.includes(target))!;
  act(() => oldObserver.emit(target, true));
  now = 1800;
  if (boundary === 'snapshot') mockScope = { snapshotId: 'snapshot-b', rankingId: 'ranking-a' };
  else {
    mockAuth = { user: { userId: 'driver-b' }, token: 'synthetic-b' };
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, mockAuth.token);
  }
  // During refresh the old block object/ranking can remain visible until the
  // replacement response arrives. A new scope must start fresh dwell timing.
  await act(async () => { seedScope(); view.rerender(<Page />); });
  now = 1900;
  act(() => oldObserver.emit(target, false));
  expect(actions.filter(action => action.action === 'block_dwell')).toEqual([]);
  expect(oldObserver.disconnected).toBe(true);
  const currentTarget = card('place-alpha');
  const currentObserver = Observer.instances.find(observer => !observer.disconnected && observer.targets.includes(currentTarget))!;
  act(() => currentObserver.emit(currentTarget, true));
  now = 2200;
  act(() => currentObserver.emit(currentTarget, false));
  expect(actions.filter(action => action.action === 'block_dwell')).toEqual([]);
  act(() => currentObserver.emit(currentTarget, true));
  now = 2900;
  act(() => currentObserver.emit(currentTarget, false));
  await waitFor(() => expect(actions.filter(action => action.action === 'block_dwell')).toEqual([
    expect.objectContaining({ ranking_id: 'ranking-a', block_id: 'place-alpha', dwell_ms: 700, from_rank: 1 }),
  ]));
});

test('queued entries from a disconnected observer cannot restart a historical dwell timer', async () => {
  const view = await mountPage();
  const target = card('place-alpha');
  const oldObserver = Observer.instances.find(observer => !observer.disconnected && observer.targets.includes(target))!;
  act(() => oldObserver.emit(target, true));
  mockScope = { snapshotId: 'snapshot-b', rankingId: 'ranking-b' };
  await act(async () => { seedScope([replacement, beta], state(undefined, undefined, [replacement, beta])); view.rerender(<Page />); });
  expect(oldObserver.disconnected).toBe(true);
  // Browser callbacks already queued before disconnect may still be delivered.
  // Clearing the old Map alone does not invalidate a later queued enter/exit.
  now = 2000;
  act(() => oldObserver.emit(target, true));
  now = 2900;
  act(() => oldObserver.emit(target, false));
  expect(actions.filter(action => action.action === 'block_dwell')).toEqual([]);
});
