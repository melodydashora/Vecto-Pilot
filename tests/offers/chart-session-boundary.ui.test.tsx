// Actual component/session boundary: only auth/location and chart drawing are
// fixtures. Deferred transport deliberately ignores AbortSignal at both stages.
import { jest } from '@jest/globals';
jest.mock('@/lib/daypart', () => ({ getLocalIso: (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (key: string) => parts.find(part => part.type === key)?.value;
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}`;
} }));
import React, { useLayoutEffect, useRef } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import OffersDecisionChart from '@/components/offer-analyzer/OffersDecisionChart';

let mockAuth = { user: { userId: 'same-synthetic-owner' }, token: 'synthetic-session-a', isAuthenticated: true, isLoading: false };
jest.mock('@/contexts/auth-context', () => ({ useAuth: () => mockAuth }));
jest.mock('@/contexts/location-context-clean', () => ({ useLocation: () => ({ timeZone: 'America/Chicago' }) }));
jest.mock('@/components/ui/chart', () => ({
  ChartContainer: ({ children, ...props }: any) => <div aria-label={props['aria-label']}>{children}</div>,
  ChartTooltip: () => null, ChartTooltipContent: () => null,
}));
jest.mock('recharts', () => ({
  BarChart: () => <div data-testid="fixture-chart-drawing" />, Bar: () => null,
  CartesianGrid: () => null, XAxis: () => null, YAxis: () => null,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const summary = (total: number) => ({
  success: true, period: { key: '7d', start: '2026-09-04T03:00:00Z', end: '2026-09-11T03:00:00Z', label: 'Rolling last 7 days' },
  stats: { analyzed: 10, analyzer_accepted: 8, analyzer_rejected: 2, analyzer_no_data: 0,
    driver_accepted: 3, driver_rejected: 2, cancelled: 0, other: 0, unrecorded: 5,
    reported_total: total, reported_count: 2 },
});
type Request = {
  url: string; init: RequestInit; headers: ReturnType<typeof deferred<Response>>;
  body: ReturnType<typeof deferred<unknown>>; json: jest.Mock;
};
const requests: Request[] = [];
const originalFetch = globalThis.fetch;
function deliverHeaders(request: Request) {
  request.headers.resolve({ ok: true, status: 200, json: request.json } as unknown as Response);
}
async function complete(request: Request, total: number) {
  await act(async () => { deliverHeaders(request); request.body.resolve(summary(total)); });
}
function CaptureBeforePassiveEffects({ capture }: { capture: (text: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  // On an auth-driven parent update this runs after the chart's DOM commit,
  // before its passive cleanup can clear results or abort the prior fetch.
  useLayoutEffect(() => { capture(element.current?.textContent || ''); });
  return <div ref={element}><OffersDecisionChart refreshToken="fixed-list-version" /></div>;
}

beforeEach(() => {
  mockAuth = { user: { userId: 'same-synthetic-owner' }, token: 'synthetic-session-a', isAuthenticated: true, isLoading: false };
  requests.length = 0;
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = deferred<Response>(), body = deferred<unknown>();
    const request = { url: String(input), init, headers, body, json: jest.fn(() => body.promise) };
    requests.push(request);
    // No abort listener: exercise the component guard even when the transport
    // completes successfully after cancellation or while JSON is decoding.
    return headers.promise;
  }) as typeof fetch;
});
afterEach(async () => {
  cleanup();
  await act(async () => { requests.forEach(request => { deliverHeaders(request); request.body.resolve(summary(999.99)); }); });
  globalThis.fetch = originalFetch;
});

test('same-owner token replacement hides confirmed prior-session counts in the commit before effect cleanup', async () => {
  const commits: string[] = [];
  const capture = (text: string) => commits.push(text);
  const view = render(<CaptureBeforePassiveEffects capture={capture} />);
  expect(requests).toHaveLength(1);
  await complete(requests[0], 111.11);
  expect(screen.getByText('$111.11')).toBeInTheDocument();
  commits.length = 0;
  mockAuth = { ...mockAuth, token: 'synthetic-session-b' };
  view.rerender(<CaptureBeforePassiveEffects capture={capture} />);
  expect(commits).toHaveLength(1);
  expect(commits[0]).not.toContain('$111.11');
  expect(commits[0]).toContain('Loading period counts');
  expect(requests).toHaveLength(2);
  expect(requests[1].init.headers).toEqual({ Authorization: 'Bearer synthetic-session-b' });
  await complete(requests[1], 222.22);
  expect(screen.getByText('$222.22')).toBeInTheDocument();
  expect(screen.queryByText('$111.11')).not.toBeInTheDocument();
});

test.each(['headers', 'body'] as const)('late old-session %s cannot replace successful new-token counts, even when transport ignores abort', async stage => {
  const view = render(<OffersDecisionChart refreshToken="fixed-list-version" />);
  const oldRequest = requests[0];
  expect(oldRequest.url).toBe('/api/offer-analyzer/offers/stats?period=7d');
  expect(oldRequest.init.headers).toEqual({ Authorization: 'Bearer synthetic-session-a' });
  if (stage === 'body') {
    await act(async () => { deliverHeaders(oldRequest); });
    expect(oldRequest.json).toHaveBeenCalledTimes(1);
  } else expect(oldRequest.json).not.toHaveBeenCalled();

  mockAuth = { ...mockAuth, token: 'synthetic-session-b' };
  view.rerender(<OffersDecisionChart refreshToken="fixed-list-version" />);
  expect(oldRequest.init.signal?.aborted).toBe(true);
  expect(requests).toHaveLength(2);
  expect(requests[1].init.headers).toEqual({ Authorization: 'Bearer synthetic-session-b' });
  await complete(requests[1], 222.22);
  await waitFor(() => expect(screen.getByText('$222.22')).toBeInTheDocument());
  await complete(oldRequest, 999.99);
  expect(oldRequest.json).toHaveBeenCalledTimes(1);
  expect(screen.getByText('$222.22')).toBeInTheDocument();
  expect(screen.queryByText('$999.99')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a prior-session error is hidden before cleanup while the new session can still report its own failed read', async () => {
  const commits: string[] = [];
  const capture = (text: string) => commits.push(text);
  const view = render(<CaptureBeforePassiveEffects capture={capture} />);
  await act(async () => { requests[0].headers.resolve({ ok: false, status: 503 } as Response); });
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load decision counts for this period.');
  commits.length = 0;
  mockAuth = { ...mockAuth, token: 'synthetic-session-b' };
  view.rerender(<CaptureBeforePassiveEffects capture={capture} />);
  expect(commits).toHaveLength(1);
  expect(commits[0]).not.toContain('Could not load decision counts');
  expect(commits[0]).toContain('Loading period counts');
  await act(async () => { deliverHeaders(requests[1]); requests[1].body.resolve({ success: true }); });
  expect(screen.getByRole('alert')).toHaveTextContent('The server did not return complete decision counts.');
  expect(screen.getByRole('button', { name: 'Retry counts' })).toBeEnabled();
});

test.each(['headers', 'body'] as const)('late old-session %s failure cannot replace successful new-token counts', async stage => {
  const view = render(<OffersDecisionChart refreshToken="fixed-list-version" />);
  const oldRequest = requests[0];
  if (stage === 'body') await act(async () => { deliverHeaders(oldRequest); });
  mockAuth = { ...mockAuth, token: 'synthetic-session-b' };
  view.rerender(<OffersDecisionChart refreshToken="fixed-list-version" />);
  await complete(requests[1], 222.22);
  await act(async () => {
    if (stage === 'headers') oldRequest.headers.resolve({ ok: false, status: 503 } as Response);
    else oldRequest.body.resolve({ success: true }); // Malformed old JSON throws in validSummary.
  });
  expect(oldRequest.init.signal?.aborted).toBe(true);
  expect(screen.getByText('$222.22')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
