// Real page, offer list and singleton SSE manager; transport and chart drawing
// are synthetic. A reconnect handshake must not cause another reconnect.
import { jest } from '@jest/globals';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OfferAnalyzerPage from '@/pages/co-pilot/OfferAnalyzerPage';
import { DEFAULT_OFFER_RULESET_CONFIG } from '@/lib/offer-ruleset-schema';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { closeAllSSE } from '@/utils/co-pilot-helpers';

jest.mock('@/constants/featureFlags', () => ({ DEBUG_SSE_ENABLED: false, DEBUG_BLOCKS_ENABLED: false }));
jest.mock('@/contexts/auth-context', () => ({ useAuth: () => ({
  user: { userId: 'synthetic-chart-owner' }, token: 'synthetic-token', isAuthenticated: true, isLoading: false,
}) }));
const mockSetup = {
  setup: { profile: { selectedServices: ['economy'] } }, loading: false,
  getEditorDraft: () => null, draftResetVersion: 0, setEditorDraft: jest.fn(),
  beginSave: jest.fn(() => () => {}), finishSave: jest.fn(async () => true), editSetup: jest.fn(),
};
jest.mock('@/contexts/run-setup-context', () => ({ useRunSetup: () => mockSetup }));
jest.mock('@/contexts/location-context-clean', () => ({ useLocation: () => ({ timeZone: 'America/Chicago' }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
const mockToast = jest.fn();
jest.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock('@/components/offer-analyzer/SetupCard', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/offer-analyzer/controls', () => ({
  SliderRow: ({ label }: any) => <span>{label}</span>,
  SwitchRow: ({ label }: any) => <span>{label}</span>,
}));
jest.mock('@/lib/daypart', () => ({ getLocalIso: (date: Date) => date.toISOString() }));
jest.mock('@/components/ui/chart', () => ({
  ChartContainer: ({ children, ...props }: any) => <div aria-label={props['aria-label']}>{children}</div>,
  ChartTooltip: () => null, ChartTooltipContent: () => null,
}));
jest.mock('recharts', () => ({
  BarChart: () => <div data-testid="fixture-chart-drawing" />, Bar: () => null,
  CartesianGrid: () => null, XAxis: () => null, YAxis: () => null,
}));

class SyntheticEventSource extends EventTarget {
  static instances: SyntheticEventSource[] = [];
  closed = false;
  onopen = null;
  onerror = null;
  constructor(public url: string) { super(); SyntheticEventSource.instances.push(this); }
  close() { this.closed = true; }
  send(type: string) { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify({ offer_id: 'synthetic-offer', handshake: type === 'state' }) })); }
}
const originalEventSource = globalThis.EventSource;
const originalFetch = globalThis.fetch;
let statsRequests = 0;
let client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { structuredClone: (value: unknown) => JSON.parse(JSON.stringify(value)) });
  globalThis.EventSource = SyntheticEventSource as unknown as typeof EventSource;
  SyntheticEventSource.instances = [];
  localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'synthetic-token');
  statsRequests = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  globalThis.fetch = jest.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input), 'http://synthetic');
    let data: unknown;
    if (url.pathname.endsWith('/rules')) data = { config: DEFAULT_OFFER_RULESET_CONFIG, version: 7, is_default: false };
    else if (url.pathname.endsWith('/stats')) {
      statsRequests++;
      data = { success: true, date: url.searchParams.get('date'), timeZone: 'America/Chicago',
        period: { key: 'day', start: '2026-10-05T05:00:00Z', end: '2026-10-06T05:00:00Z', label: 'Synthetic day' },
        stats: { analyzed: 10, analyzer_accepted: 8, analyzer_rejected: 2, analyzer_no_data: 0,
          driver_accepted: 3, driver_rejected: 2, cancelled: 0, other: 0, unrecorded: 5, reported_total: 123.5, reported_count: 2 } };
    } else if (url.pathname.endsWith('/offers')) data = { success: true, date: url.searchParams.get('date'), timeZone: 'America/Chicago', include_removed: true, total: 0, offers: [] };
    else throw new Error(`Unexpected synthetic request: ${url.pathname}`);
    return { ok: true, status: 200, json: async () => data } as Response;
  }) as typeof fetch;
});
afterEach(() => {
  cleanup(); closeAllSSE(); client.clear(); localStorage.clear();
  globalThis.EventSource = originalEventSource; globalThis.fetch = originalFetch;
});

test('chart tab changes and SSE handshakes keep one offer stream, while actual offers still refresh counts', async () => {
  render(<QueryClientProvider client={client}><OfferAnalyzerPage /></QueryClientProvider>);
  await screen.findByText('Offer controls for: Economy.');
  await waitFor(() => expect(statsRequests).toBe(1));
  const stream = SyntheticEventSource.instances.at(-1)!;
  const connectionCount = SyntheticEventSource.instances.length;
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Charts' }), { button: 0, ctrlKey: false });
  expect(screen.getByRole('tab', { name: 'Charts' }).getAttribute('data-state')).toBe('active');
  expect(SyntheticEventSource.instances).toHaveLength(connectionCount);
  expect(stream.closed).toBe(false);
  await act(async () => stream.send('state'));
  await waitFor(() => expect(statsRequests).toBe(2));
  expect(SyntheticEventSource.instances).toHaveLength(connectionCount);
  expect(stream.closed).toBe(false);
  await act(async () => stream.send('offer_analyzed'));
  await waitFor(() => expect(statsRequests).toBe(3));
  expect(SyntheticEventSource.instances).toHaveLength(connectionCount);
  expect(stream.closed).toBe(false);
});
