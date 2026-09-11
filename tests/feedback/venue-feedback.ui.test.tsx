import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useVenueFeedback } from '../../client/src/hooks/useVenueFeedback';
import { FeedbackModal } from '../../client/src/components/FeedbackModal';
import { QUERY_KEYS } from '../../client/src/constants/apiRoutes';

let auth = { user: { userId: 'driver-a' }, token: 'synthetic-a' };
const toast = jest.fn();
jest.mock('@/contexts/auth-context', () => ({ useAuth: () => auth }));
jest.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast }) }));
const block = (placeId: string) => ({ placeId, name: `Venue ${placeId}`, coordinates: { lat: 33, lng: -97 }, valueGrade: 'A', valuePerMin: 1 });
const original = [block('a'), block('b'), block('c')];
const initial = (snapshot = 'snapshot-a', ranking = 'ranking-a') => ({ ok: true, snapshot_id: snapshot, ranking_id: ranking,
  scope_revision: 0, dismissed_place_ids: [], dismissals: [], blocks: original });
const action = { action: 'dismiss' as const, place_id: 'a', visible_place_ids: ['a', 'b', 'c'], comment: 'Keep my comment' };
const receipt = (body: any) => ({ ...initial(body.snapshot_id, body.ranking_id), scope_revision: 1,
  dismissed_place_ids: ['a'], dismissals: [{ place_id: 'a', action_id: body.request_id, venue_name: 'Venue a' }],
  blocks: [block('b'), block('c'), block('d')], feedback_id: 'feedback-1', action_id: body.request_id,
  place_id: body.place_id, action: body.action, replacement: block('d'), replacement_status: 'replaced', restored: false });
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function deferred<T = any>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
function hook() { return renderHook(({ snapshot, ranking }) => useVenueFeedback(snapshot, ranking), { wrapper, initialProps: { snapshot: 'snapshot-a', ranking: 'ranking-a' } }); }
beforeEach(() => {
  auth = { user: { userId: 'driver-a' }, token: 'synthetic-a' }; toast.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(QUERY_KEYS.BLOCKS_FAST('snapshot-a'), { now: 'synthetic-time', timezone: null, rankingId: 'ranking-a', blocks: original });
  global.fetch = jest.fn(async () => response(initial())) as any;
});
afterEach(() => { cleanup(); client.clear(); });

test('pure saved reload carries bearer auth and does not call generation; duplicate taps wait for a confirmed receipt', async () => {
  const pending = deferred();
  (fetch as jest.Mock).mockImplementation((url, options) => options?.method === 'POST' ? pending.promise : Promise.resolve(response(initial())));
  const h = hook(); await waitFor(() => expect(h.result.current.state?.scope_revision).toBe(0));
  expect((fetch as jest.Mock).mock.calls[0]).toEqual([expect.stringMatching(/^\/api\/blocks-fast\/saved\?snapshotId=snapshot-a&rankingId=ranking-a$/), expect.objectContaining({ headers: { Authorization: 'Bearer synthetic-a' } })]);
  let first!: Promise<any>; let duplicate!: Promise<any>;
  act(() => { first = h.result.current.submit(action); duplicate = h.result.current.submit(action); });
  expect(await duplicate).toBeNull(); expect(h.result.current.pending).toBe(true);
  expect((client.getQueryData(QUERY_KEYS.BLOCKS_FAST('snapshot-a')) as any).blocks).toEqual(original);
  const post = (fetch as jest.Mock).mock.calls.find(([, o]) => o?.method === 'POST');
  expect(post[1].headers.Authorization).toBe('Bearer synthetic-a');
  const body = JSON.parse(post[1].body);
  await act(async () => { pending.resolve(response(receipt(body))); await first; });
  expect((fetch as jest.Mock).mock.calls.filter(([, o]) => o?.method === 'POST')).toHaveLength(1);
  expect(h.result.current.state?.blocks.map(b => b.placeId)).toEqual(['b', 'c', 'd']);
  expect((client.getQueryData(QUERY_KEYS.BLOCKS_FAST('snapshot-a')) as any)).toMatchObject({ now: 'synthetic-time', blocks: receipt(body).blocks });
});

test('unknown network failure keeps the card and reuses the request UUID for an identical retry', async () => {
  let attempt = 0;
  (fetch as jest.Mock).mockImplementation((_url, options) => {
    if (options?.method !== 'POST') return Promise.resolve(response(initial()));
    if (++attempt === 1) return Promise.reject(new Error('Connection interrupted'));
    return Promise.resolve(response(receipt(JSON.parse(options.body))));
  });
  const h = hook(); await waitFor(() => expect(h.result.current.state).not.toBeNull());
  await act(async () => { await expect(h.result.current.submit(action)).rejects.toThrow('Connection interrupted'); });
  expect(h.result.current.state?.blocks).toEqual(original);
  await act(async () => { await h.result.current.submit(action); });
  const bodies = (fetch as jest.Mock).mock.calls.filter(([, o]) => o?.method === 'POST').map(([, o]) => JSON.parse(o.body));
  expect(bodies[0].request_id).toBe(bodies[1].request_id);
  expect(h.result.current.state?.scope_revision).toBe(1);
});

test('confirmed feedback updates qualified current-snapshot caches and preserves their metadata and other rankings', async () => {
  const currentKey = [...QUERY_KEYS.BLOCKS_FAST('snapshot-a'), 'driver-a', 7];
  const otherRankingKey = [...QUERY_KEYS.BLOCKS_FAST('snapshot-a'), 'driver-a', 6];
  const otherSnapshotKey = [...QUERY_KEYS.BLOCKS_FAST('snapshot-b'), 'driver-a', 7];
  const cached = { now: 'original-receipt', timezone: 'UTC', rankingId: 'ranking-a', blocks: original,
    metadata: { totalBlocks: 3, processingTimeMs: 17, modelRoute: 'retained-route' } };
  client.setQueryData(currentKey, cached);
  client.setQueryData(otherRankingKey, { ...cached, rankingId: 'ranking-previous' });
  client.setQueryData(otherSnapshotKey, cached);
  (fetch as jest.Mock).mockImplementation((_url, options) => Promise.resolve(response(options?.method === 'POST'
    ? receipt(JSON.parse(options.body)) : initial())));
  const h = hook();
  await waitFor(() => expect(h.result.current.state?.scope_revision).toBe(0));
  await act(async () => { await h.result.current.submit(action); });
  expect(client.getQueryData(currentKey)).toEqual({ ...cached, blocks: [block('b'), block('c'), block('d')] });
  expect(client.getQueryData(otherRankingKey)).toEqual({ ...cached, rankingId: 'ranking-previous' });
  expect(client.getQueryData(otherSnapshotKey)).toEqual(cached);
});

test.each(['scope', 'action', 'replacement', 'receipt'])('a successful HTTP response with the wrong %s cannot remove a venue', async (kind) => {
  (fetch as jest.Mock).mockImplementation((_url, options) => {
    if (options?.method !== 'POST') return Promise.resolve(response(initial()));
    const r = receipt(JSON.parse(options.body));
    if (kind === 'scope') r.snapshot_id = 'foreign-snapshot';
    if (kind === 'action') r.action_id = 'different-request';
    if (kind === 'replacement') r.replacement = block('a');
    if (kind === 'receipt') r.feedback_id = '';
    return Promise.resolve(response(r));
  });
  const h = hook(); await waitFor(() => expect(h.result.current.state).not.toBeNull());
  await act(async () => { await expect(h.result.current.submit(action)).rejects.toThrow('did not confirm'); });
  expect(h.result.current.state?.blocks).toEqual(original);
});

test('a delayed saved-state read cannot replace a newer confirmed dismissal', async () => {
  const oldRead = deferred();
  (fetch as jest.Mock).mockImplementation((_url, options) => options?.method === 'POST'
    ? Promise.resolve(response(receipt(JSON.parse(options.body)))) : oldRead.promise);
  const h = hook();
  await act(async () => { await h.result.current.submit(action); });
  await act(async () => { oldRead.resolve(response(initial())); });
  expect(h.result.current.state?.scope_revision).toBe(1);
  expect(h.result.current.state?.blocks.map(b => b.placeId)).toEqual(['b', 'c', 'd']);
});

test.each(['account', 'snapshot', 'ranking', 'unmount'])('late POST body after %s change cannot update state or cache, even when fetch ignores abort', async (boundary) => {
  const bodyWait = deferred(); let sent: any;
  (fetch as jest.Mock).mockImplementation((url, options) => {
    if (options?.method === 'POST') { sent = JSON.parse(options.body); return Promise.resolve({ ok: true, status: 200, json: () => bodyWait.promise }); }
    const u = new URL(url, 'http://localhost'); return Promise.resolve(response(initial(u.searchParams.get('snapshotId')!, u.searchParams.get('rankingId')!)));
  });
  const h = hook(); await waitFor(() => expect(h.result.current.state).not.toBeNull());
  let request!: Promise<any>; act(() => { request = h.result.current.submit(action); });
  await act(async () => {});
  if (boundary === 'account') { auth = { user: { userId: 'driver-b' }, token: 'synthetic-b' }; h.rerender({ snapshot: 'snapshot-a', ranking: 'ranking-a' }); }
  if (boundary === 'snapshot') h.rerender({ snapshot: 'snapshot-b', ranking: 'ranking-a' });
  if (boundary === 'ranking') h.rerender({ snapshot: 'snapshot-a', ranking: 'ranking-b' });
  if (boundary === 'unmount') h.unmount();
  const apply = jest.spyOn(client, 'setQueryData');
  await act(async () => { bodyWait.resolve(receipt(sent)); expect(await request).toBeNull(); });
  expect(apply).not.toHaveBeenCalled();
  if (boundary !== 'unmount') expect(h.result.current.state?.scope_revision).toBe(0);
});

test.each([400, 401, 503])('generic app feedback HTTP%s retains comment and reports no false success', async (status) => {
  (fetch as jest.Mock).mockResolvedValue(response({ ok: false }, status));
  const close = jest.fn(), success = jest.fn();
  render(<FeedbackModal isOpen onClose={close} onSuccess={success} isAppFeedback initialSentiment="up" />);
  fireEvent.change(screen.getByLabelText('Additional comments (optional)'), { target: { value: 'Please keep this draft' } });
  fireEvent.click(screen.getByTestId('button-submit-feedback'));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('Additional comments (optional)') as HTMLTextAreaElement).value).toBe('Please keep this draft');
  expect(close).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled(); expect(toast).not.toHaveBeenCalled();
  expect((fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-a');
});

test('modal duplicate taps issue one write, stay open during the wait, and close only on confirmed success', async () => {
  const wait = deferred(); (fetch as jest.Mock).mockReturnValue(wait.promise);
  const close = jest.fn(), success = jest.fn();
  render(<FeedbackModal isOpen onClose={close} onSuccess={success} isAppFeedback initialSentiment="down" />);
  act(() => { fireEvent.click(screen.getByTestId('button-submit-feedback')); fireEvent.click(screen.getByTestId('button-submit-feedback')); });
  expect(fetch).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled();
  await act(async () => { wait.resolve(response({ ok: true })); });
  expect(close).toHaveBeenCalledTimes(1); expect(success).toHaveBeenCalledWith('down'); expect(toast).toHaveBeenCalledTimes(1);
});

test('late generic feedback response after account change cannot close the new modal or announce success', async () => {
  const wait = deferred(); (fetch as jest.Mock).mockReturnValue(wait.promise);
  const close = jest.fn(), success = jest.fn();
  const view = render(<FeedbackModal isOpen onClose={close} onSuccess={success} isAppFeedback initialSentiment="up" />);
  fireEvent.click(screen.getByTestId('button-submit-feedback'));
  auth = { user: { userId: 'driver-b' }, token: 'synthetic-b' };
  view.rerender(<FeedbackModal isOpen onClose={close} onSuccess={success} isAppFeedback initialSentiment="up" />);
  await act(async () => { wait.resolve(response({ ok: true })); });
  expect(close).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled(); expect(toast).not.toHaveBeenCalled();
});
