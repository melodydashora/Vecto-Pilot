import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OfferOutcomeRow, { type AnalyzedOffer } from '../../client/src/components/offer-analyzer/OfferOutcomeRow';
import OffersDecisionChart from '../../client/src/components/offer-analyzer/OffersDecisionChart';
import OffersCard from '../../client/src/components/offer-analyzer/OffersCard';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@/utils/co-pilot-helpers', () => ({ getAuthHeader: () => ({ Authorization: 'Bearer synthetic' }), subscribeOfferAnalyzed: () => () => {} }));
jest.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => <select aria-label="What did you do?" value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}><option value="">Choose an outcome</option>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>, SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));
let auth = { user: { userId: 'synthetic-a' }, token: 'synthetic-token-a', isAuthenticated: true, isLoading: false };
jest.mock('@/contexts/auth-context', () => ({ useAuth: () => auth }));
let location = { timeZone: 'America/Chicago' as string | null };
jest.mock('@/contexts/location-context-clean', () => ({ useLocation: () => location }));
jest.mock('@/components/ui/chart', () => ({ ChartContainer: ({ children }: any) => <div>{children}</div>, ChartTooltip: () => null, ChartTooltipContent: () => null }));
jest.mock('recharts', () => ({ BarChart: () => <div data-testid="decision-chart" />, Bar: () => null, CartesianGrid: () => null, XAxis: () => null, YAxis: () => null }));
const offer: AnalyzedOffer = { id: '00000000-0000-4000-8000-000000000001', decision: 'ACCEPT', price: 12.5, created_at: '2026-09-10T12:00:00Z' };
const outcome = (overrides = {}) => ({ id: 'synthetic-outcome', offer_intelligence_id: offer.id, revision: 1, driver_decision: 'Accepted', driver_reasoning: null, actual_pay: 12.5, reimbursements: null, extras: null, other: null, total_earned: 12.5, ...overrides });
const reply = (body: unknown, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const pick = (decision: string) => fireEvent.change(screen.getByRole('combobox', { name: 'What did you do?' }), { target: { value: decision } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save outcome' }));
beforeEach(() => { global.fetch = jest.fn() as any; auth = { user: { userId: 'synthetic-a' }, token: 'synthetic-token-a', isAuthenticated: true, isLoading: false }; location = { timeZone: 'America/Chicago' }; });
afterEach(cleanup);

test('offered pay is only a draft; explicit confirmed save collapses and Edit restores every zero and amount', async () => {
  const confirmed = outcome({ actual_pay: 0, reimbursements: 3, extras: 2, other: 1, total_earned: 6 });
  (fetch as jest.Mock).mockImplementation(() => reply({ success: true, outcome: confirmed }));
  const refreshed = jest.fn(); render(<OfferOutcomeRow offer={offer} onOutcomeSaved={refreshed} />);
  pick('Accepted'); expect((screen.getByLabelText('Actual pay') as HTMLInputElement).value).toBe('12.5'); expect(fetch).not.toHaveBeenCalled();
  for (const [label, value] of [['Actual pay', '0'], ['Reimbursements', '3'], ['Extras', '2'], ['Other earnings', '1']]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  save(); await screen.findByText(/Saved:/); expect(screen.queryByLabelText('Actual pay')).toBeNull(); expect(refreshed).toHaveBeenCalledTimes(1);
  expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toMatchObject({ expected_revision: null, actual_pay: 0, reimbursements: 3, extras: 2, other: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Edit' })); expect((screen.getByLabelText('Actual pay') as HTMLInputElement).value).toBe('0'); expect((screen.getByLabelText('Other earnings') as HTMLInputElement).value).toBe('1');
});
test('failed and malformed saves keep the draft open; unknown or implausible amounts are not invented', async () => {
  (fetch as jest.Mock).mockImplementationOnce(() => reply({}, 503)).mockImplementationOnce(() => reply({ success: true, outcome: { id: 'incomplete' } }));
  render(<OfferOutcomeRow offer={{ ...offer, reason_kind: 'implausible_parse' }} onOutcomeSaved={jest.fn()} />); pick('Accepted');
  expect(screen.queryByRole('option', { name: 'Followed the call' })).toBeNull();
  expect((screen.getByLabelText('Actual pay') as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('Extras'), { target: { value: '4.75' } }); save(); await screen.findByRole('alert');
  expect((screen.getByLabelText('Extras') as HTMLInputElement).value).toBe('4.75'); save(); await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/did not confirm/));
  expect(screen.getByLabelText('Extras')).toBeTruthy();
});
test('Other/error and rejected outcomes save explicitly, collapse, and never submit offered dollars', async () => {
  (fetch as jest.Mock).mockImplementation(() => reply({ success: true, outcome: outcome({ driver_decision: 'Other', driver_reasoning: 'Unreadable screenshot', actual_pay: null, total_earned: 0 }) }));
  render(<OfferOutcomeRow offer={{ ...offer, decision: 'NO DATA' }} onOutcomeSaved={jest.fn()} />);
  expect(screen.queryByRole('option', { name: 'Followed the call' })).toBeNull(); pick('Other');
  fireEvent.change(screen.getByLabelText('What happened? (optional)'), { target: { value: 'Unreadable screenshot' } }); expect(fetch).not.toHaveBeenCalled(); save();
  await screen.findByText(/Saved:/); const body = JSON.parse((fetch as jest.Mock).mock.calls[0][1].body);
  expect(body).toMatchObject({ driver_decision: 'Other', driver_reasoning: 'Unreadable screenshot' }); expect(body.actual_pay).toBeUndefined(); expect(screen.queryByRole('combobox')).toBeNull();
});
test('previously recorded rejection is compact and offered money stays out of its save', async () => {
  (fetch as jest.Mock).mockImplementation(() => reply({ success: true, outcome: outcome({ revision: 2, driver_decision: 'Rejected', actual_pay: null, total_earned: 0 }) }));
  render(<OfferOutcomeRow offer={{ ...offer, outcome_id: 'old', outcome_revision: 1, driver_decision: 'Rejected' }} onOutcomeSaved={jest.fn()} />);
  expect(screen.queryByRole('combobox')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Edit' })); save(); await screen.findByText(/Saved:/);
  const body = JSON.parse((fetch as jest.Mock).mock.calls[0][1].body); expect(body.expected_revision).toBe(1); expect(body.actual_pay).toBeUndefined();
});
test('an outdated client response clearly requests refresh and leaves the unsaved form visible', async () => {
  (fetch as jest.Mock).mockImplementation(() => reply({ error: 'outcome_version_required' }, 400));
  render(<OfferOutcomeRow offer={offer} onOutcomeSaved={jest.fn()} />); pick('Rejected'); save();
  await screen.findByRole('alert'); expect(screen.getByRole('alert').textContent).toMatch(/refresh the Offer Analyzer/); expect(screen.getByRole('combobox')).toBeTruthy();
});
test('refetch cannot erase an open draft; revision conflict retains it until explicit saved-version review', async () => {
  const existing = { ...offer, outcome_id: 'old', outcome_revision: 1, driver_decision: 'Accepted' as const, actual_pay: 10 };
  (fetch as jest.Mock).mockImplementation(() => reply({ current: outcome({ revision: 2, actual_pay: 25, total_earned: 25 }) }, 409));
  const view = render(<OfferOutcomeRow offer={existing} onOutcomeSaved={jest.fn()} />); fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Actual pay'), { target: { value: '17' } });
  view.rerender(<OfferOutcomeRow offer={{ ...existing, outcome_revision: 2, actual_pay: 25 }} onOutcomeSaved={jest.fn()} />);
  expect((screen.getByLabelText('Actual pay') as HTMLInputElement).value).toBe('17'); save(); await screen.findByRole('alert');
  expect((screen.getByLabelText('Actual pay') as HTMLInputElement).value).toBe('17'); expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body).expected_revision).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Load saved version' })); expect((screen.getByLabelText('Actual pay') as HTMLInputElement).value).toBe('25');
});
test('a newer GET survives an older POST success and a failed refetch without losing the submitted draft', async () => {
  const existing = { ...offer, outcome_id: 'old', outcome_revision: 1, driver_decision: 'Accepted' as const, actual_pay: 10, total_earned: 10 };
  let resolvePost: (value: unknown) => void = () => {};
  (fetch as jest.Mock).mockImplementationOnce(() => new Promise(done => { resolvePost = done; }))
    .mockImplementationOnce(() => reply({}, 503))
    .mockImplementationOnce(() => reply({ success: true, outcome: outcome({ revision: 4, actual_pay: 30, total_earned: 30 }) }));
  const refreshFailed = jest.fn();
  const refresh = jest.fn(() => { void fetch('/synthetic-offers-refetch').then(response => { if (!response.ok) refreshFailed(); }); });
  const view = render(<OfferOutcomeRow offer={existing} onOutcomeSaved={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Actual pay'), { target: { value: '17' } });
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'My submitted draft' } });
  save();
  const newest = { ...existing, outcome_revision: 3, actual_pay: 30, total_earned: 30, driver_reasoning: 'Newer saved note' };
  view.rerender(<OfferOutcomeRow offer={newest} onOutcomeSaved={refresh} />);
  await act(async () => resolvePost(await reply({ success: true, outcome: outcome({ revision: 2, actual_pay: 17, total_earned: 17, driver_reasoning: 'My submitted draft' }) })));
  await waitFor(() => expect(refreshFailed).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('alert').textContent).toMatch(/save completed, but a newer saved version/);
  expect((screen.getByLabelText('Actual pay') as HTMLInputElement).value).toBe('17');
  expect((screen.getByLabelText('Note (optional)') as HTMLTextAreaElement).value).toBe('My submitted draft');
  expect((screen.getByRole('button', { name: 'Save outcome' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('status').textContent).toContain('$30.00');
  // A second, stale list response cannot reverse the canonical revision either.
  view.rerender(<OfferOutcomeRow offer={{ ...existing, outcome_revision: 2, actual_pay: 17, total_earned: 17 }} onOutcomeSaved={jest.fn()} />);
  expect(screen.getByRole('status').textContent).toContain('$30.00');
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect((screen.getByLabelText('Actual pay') as HTMLInputElement).value).toBe('30');
  expect((screen.getByLabelText('Note (optional)') as HTMLTextAreaElement).value).toBe('Newer saved note');
  save(); await screen.findByText(/Saved:/);
  expect(JSON.parse((fetch as jest.Mock).mock.calls[2][1].body)).toMatchObject({ expected_revision: 3, actual_pay: 30 });
});
test('an older 409 cannot replace a newer GET and saved-version review follows later GETs without replacing the draft', async () => {
  const existing = { ...offer, outcome_id: 'old', outcome_revision: 1, driver_decision: 'Accepted' as const, actual_pay: 10, total_earned: 10 };
  let resolvePost: (value: unknown) => void = () => {};
  (fetch as jest.Mock).mockImplementationOnce(() => new Promise(done => { resolvePost = done; }))
    .mockImplementationOnce(() => reply({ current: outcome({ revision: 3, actual_pay: 30, total_earned: 30 }) }, 409))
    .mockImplementationOnce(() => reply({ success: true, outcome: outcome({ revision: 5, actual_pay: 40, total_earned: 40 }) }));
  const view = render(<OfferOutcomeRow offer={existing} onOutcomeSaved={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Actual pay'), { target: { value: '17' } }); save();
  view.rerender(<OfferOutcomeRow offer={{ ...existing, outcome_revision: 3, actual_pay: 30, total_earned: 30 }} onOutcomeSaved={jest.fn()} />);
  await act(async () => resolvePost(await reply({ current: outcome({ revision: 2, actual_pay: 20, total_earned: 20 }) }, 409)));
  expect(screen.getByRole('alert').textContent).toMatch(/changed elsewhere/);
  expect((screen.getByLabelText('Actual pay') as HTMLInputElement).value).toBe('17');
  fireEvent.click(screen.getByRole('button', { name: 'Load saved version' }));
  expect((screen.getByLabelText('Actual pay') as HTMLInputElement).value).toBe('30');
  // Resolve another conflict while still editing, then receive an even newer list result.
  fireEvent.change(screen.getByLabelText('Actual pay'), { target: { value: '18' } }); save(); await screen.findByRole('alert');
  view.rerender(<OfferOutcomeRow offer={{ ...existing, outcome_revision: 4, actual_pay: 40, total_earned: 40 }} onOutcomeSaved={jest.fn()} />);
  expect((screen.getByLabelText('Actual pay') as HTMLInputElement).value).toBe('18');
  fireEvent.click(screen.getByRole('button', { name: 'Load saved version' }));
  expect((screen.getByLabelText('Actual pay') as HTMLInputElement).value).toBe('40');
  save(); await screen.findByText(/Saved:/);
  expect(JSON.parse((fetch as jest.Mock).mock.calls[2][1].body)).toMatchObject({ expected_revision: 4, actual_pay: 40 });
});
test('saving disables the inputs and duplicate submit; saved unknown actual pay stays blank when reopened', async () => {
  let resolve: (value: unknown) => void = () => {}; (fetch as jest.Mock).mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<OfferOutcomeRow offer={offer} onOutcomeSaved={jest.fn()} />); pick('Accepted'); save();
  expect((screen.getByLabelText('Actual pay') as HTMLInputElement).disabled).toBe(true); save(); expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => resolve(await reply({ success: true, outcome: outcome({ actual_pay: null, total_earned: 0 }) })));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' })); expect((screen.getByLabelText('Actual pay') as HTMLInputElement).value).toBe('');
});
const summary = (key = '7d', overrides = {}) => ({ success: true, period: { key, start: '2026-09-03T12:00:00Z', end: '2026-09-10T12:00:00Z', label: 'Rolling last 7 days' }, stats: { analyzed: 150, analyzer_accepted: 90, analyzer_rejected: 50, analyzer_no_data: 10, driver_accepted: 40, driver_rejected: 30, cancelled: 3, other: 2, unrecorded: 75, reported_total: 123.5, reported_count: 10, ...overrides } });
test('chart uses complete server counts and requests the chosen rolling period', async () => {
  (fetch as jest.Mock).mockImplementation((url: string) => reply(summary(url.endsWith('30d') ? '30d' : '7d')));
  render(<OffersDecisionChart refreshToken="one" />); await screen.findByText(/123.50/);
  expect(screen.getByText(/40 accepted/).textContent).toContain('30 rejected'); expect(screen.getByText(/75 not recorded/)).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: 'Decision period' }), { target: { value: '30d' } });
  await waitFor(() => expect((fetch as jest.Mock).mock.calls.at(-1)[0]).toBe('/api/offer-analyzer/offers/stats?period=30d'));
  await screen.findByText(/123.50/); expect(screen.getByText(/not earnings or savings/)).toBeTruthy();
});
test('chart clears across account changes and ignores late prior-account responses', async () => {
  let resolve: (value: unknown) => void = () => {}; (fetch as jest.Mock).mockImplementationOnce(() => reply(summary())).mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = render(<OffersDecisionChart refreshToken="one" />); await screen.findByText(/123.50/);
  auth = { ...auth, user: { userId: 'synthetic-b' }, token: 'synthetic-token-b' }; view.rerender(<OffersDecisionChart refreshToken="one" />); expect(screen.queryByText(/123.50/)).toBeNull();
  auth = { ...auth, isAuthenticated: false }; view.rerender(<OffersDecisionChart refreshToken="one" />);
  await act(async () => resolve(await reply(summary()))); expect(screen.queryByText(/123.50/)).toBeNull(); expect(screen.queryByRole('combobox')).toBeNull();
});
test('a late response for the old period cannot replace the selected period counts', async () => {
  let resolve: (value: unknown) => void = () => {};
  (fetch as jest.Mock).mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockImplementationOnce(() => reply(summary('30d', { reported_total: 456 })));
  render(<OffersDecisionChart refreshToken="one" />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Decision period' }), { target: { value: '30d' } }); await screen.findByText(/456.00/);
  await act(async () => resolve(await reply(summary()))); expect(screen.queryByText(/123.50/)).toBeNull(); expect(screen.getByText(/456.00/)).toBeTruthy();
});
test('missing summary fields show an error and empty verified periods show no invented chart', async () => {
  (fetch as jest.Mock).mockImplementationOnce(() => reply({ success: true })).mockImplementationOnce(() => reply(summary('7d', { analyzed: 0, analyzer_accepted: 0, analyzer_rejected: 0, analyzer_no_data: 0, driver_accepted: 0, driver_rejected: 0, cancelled: 0, other: 0, unrecorded: 0, reported_total: 0, reported_count: 0 })));
  render(<OffersDecisionChart refreshToken="one" />); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Retry counts' }));
  await screen.findByText('No analyzed offers in this period.'); expect(screen.queryByTestId('decision-chart')).toBeNull();
});

test('a background list error preserves the open outcome draft through retry', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const existing = { ...offer, outcome_id: 'saved', outcome_revision: 1, driver_decision: 'Accepted', actual_pay: 10, total_earned: 10 };
  let listCalls = 0;
  (fetch as jest.Mock).mockImplementation((url: string) => {
    if (url.includes('/stats?')) return reply(summary());
    listCalls += 1;
    return listCalls === 2 ? reply({}, 503) : reply({ success: true, offers: [existing] });
  });
  render(<QueryClientProvider client={client}><OffersCard /></QueryClientProvider>);
  await screen.findByText(/Saved:/);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Actual pay'), { target: { value: '17' } });
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Keep my draft' } });
  await act(async () => { await client.invalidateQueries(); });
  await screen.findByText(/Could not (?:load|refresh) your offers/);
  expect((screen.getByLabelText('Actual pay') as HTMLInputElement).value).toBe('17');
  expect((screen.getByLabelText('Note (optional)') as HTMLTextAreaElement).value).toBe('Keep my draft');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(listCalls).toBe(3));
  expect((screen.getByLabelText('Actual pay') as HTMLInputElement).value).toBe('17');
  client.clear();
});

test('switching accounts removes the previous offer and draft before the new list arrives', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let resolveList: (value: unknown) => void = () => {};
  let listCalls = 0;
  (fetch as jest.Mock).mockImplementation((url: string) => {
    if (url.includes('/stats?')) return reply(summary());
    listCalls += 1;
    return listCalls === 1 ? reply({ success: true, offers: [{ ...offer, product_type: 'Prior driver offer' }] }) : new Promise(done => { resolveList = done; });
  });
  const view = render(<QueryClientProvider client={client}><OffersCard /></QueryClientProvider>);
  await screen.findByText('Prior driver offer'); pick('Accepted');
  fireEvent.change(screen.getByLabelText('Actual pay'), { target: { value: '17' } });
  auth = { ...auth, user: { userId: 'synthetic-b' }, token: 'synthetic-token-b' };
  view.rerender(<QueryClientProvider client={client}><OffersCard /></QueryClientProvider>);
  expect(screen.queryByText('Prior driver offer')).toBeNull();
  expect(screen.queryByLabelText('Actual pay')).toBeNull();
  await waitFor(() => expect(listCalls).toBe(2));
  const listRequests = (fetch as jest.Mock).mock.calls.filter(([url]) => !url.includes('/stats?'));
  expect(listRequests[1][1].headers.Authorization).toBe('Bearer synthetic-token-b');
  await act(async () => resolveList(await reply({ success: true, offers: [] })));
  await screen.findByText(/No offers yet/); client.clear();
});

test.each([
  { period: { ...summary().period, start: '2026-09-11T12:00:00Z' } },
  { stats: { ...summary().stats, analyzer_accepted: 91 } },
  { stats: { ...summary().stats, unrecorded: 76 } },
  { stats: { ...summary().stats, reported_count: 41 } },
  { stats: { ...summary().stats, reported_count: 0 } },
])('contradictory summary counts or bounds show an error rather than financial claims: %j', async invalid => {
  (fetch as jest.Mock).mockImplementation(() => reply({ ...summary(), ...invalid }));
  render(<OffersDecisionChart refreshToken="invalid" />);
  await screen.findByRole('alert');
  expect(screen.queryByText(/123.50/)).toBeNull();
  expect(screen.queryByTestId('decision-chart')).toBeNull();
});

test('period and offer timestamps use the GPS timezone and retain exact source instants', async () => {
  (fetch as jest.Mock).mockImplementation(() => reply(summary()));
  render(<><OffersDecisionChart refreshToken="time" /><OfferOutcomeRow offer={offer} onOutcomeSaved={jest.fn()} /></>);
  await screen.findByText(/123.50/);
  const times = Array.from(document.querySelectorAll('time'));
  expect(times.map(element => element.dateTime)).toEqual([summary().period.start, summary().period.end, offer.created_at]);
  expect(times[0].textContent).toBe('2026-09-03 07:00:00');
  expect(times[2].textContent).toBe('2026-09-10 07:00:00 (America/Chicago)');
  expect(screen.getByText(/Local time: America\/Chicago, resolved from GPS/)).toBeTruthy();
});

test('missing GPS timezone leaves calendar times unresolved instead of using browser time', async () => {
  location = { timeZone: null };
  (fetch as jest.Mock).mockImplementation(() => reply(summary()));
  render(<><OffersDecisionChart refreshToken="time" /><OfferOutcomeRow offer={offer} onOutcomeSaved={jest.fn()} /></>);
  await screen.findByText(/123.50/);
  expect(document.querySelector('time')).toBeNull();
  expect(screen.getByText('Local period times await GPS location.')).toBeTruthy();
  expect(screen.getByText('Local time awaits GPS location')).toBeTruthy();
});

test('a latest-25 refresh retains an older unsaved draft until the driver explicitly cancels', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const recent = Array.from({ length: 25 }, (_, index) => ({ ...offer, id: `synthetic-${index}`, product_type: index === 24 ? 'Oldest edited offer' : `Offer ${index}`, outcome_id: `outcome-${index}`, outcome_revision: 1, driver_decision: 'Accepted', actual_pay: 10, total_earned: 10 }));
  let list = recent;
  (fetch as jest.Mock).mockImplementation((url: string) => reply(url.includes('/stats?') ? summary() : { success: true, offers: list }));
  render(<QueryClientProvider client={client}><OffersCard /></QueryClientProvider>);
  await screen.findByText('Oldest edited offer');
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[24]);
  fireEvent.change(screen.getByLabelText('Actual pay'), { target: { value: '17' } });
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Keep the older draft' } });
  list = [{ ...recent[0], id: 'newest-offer' }, ...recent.slice(0, 24)];
  await act(async () => { await client.invalidateQueries(); });
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(25));
  expect(screen.getByText('Oldest edited offer')).toBeTruthy();
  expect((screen.getByLabelText('Actual pay') as HTMLInputElement).value).toBe('17');
  expect((screen.getByLabelText('Note (optional)') as HTMLTextAreaElement).value).toBe('Keep the older draft');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByText('Oldest edited offer')).toBeNull();
  client.clear();
});

test('an in-flight outcome save is canceled when its driver signs out and cannot update the new driver', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let resolvePost: (value: unknown) => void = () => {};
  (fetch as jest.Mock).mockImplementation((url: string, options: RequestInit) => {
    if (options?.method === 'POST') return new Promise(done => { resolvePost = done; });
    return reply(url.includes('/stats?') ? summary() : { success: true, offers: auth.user.userId === 'synthetic-a' ? [offer] : [] });
  });
  const view = render(<QueryClientProvider client={client}><OffersCard /></QueryClientProvider>);
  await screen.findByText('Offered $12.50'); pick('Accepted'); save();
  const saveRequest = (fetch as jest.Mock).mock.calls.find(([, options]) => options?.method === 'POST')[1];
  expect(saveRequest.headers.Authorization).toBe('Bearer synthetic-token-a');
  auth = { ...auth, user: { userId: 'synthetic-b' }, token: 'synthetic-token-b' };
  view.rerender(<QueryClientProvider client={client}><OffersCard /></QueryClientProvider>);
  expect(saveRequest.signal.aborted).toBe(true);
  await screen.findByText(/No offers yet/);
  await act(async () => resolvePost(await reply({ success: true, outcome: outcome() })));
  expect(screen.queryByText(/Saved:/)).toBeNull();
  expect(screen.queryByLabelText('Actual pay')).toBeNull();
  client.clear();
});
