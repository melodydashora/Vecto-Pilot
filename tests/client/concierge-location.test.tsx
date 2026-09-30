import React from 'react';
import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

let token: string | undefined = 'bookmark-a';
const navigate = jest.fn();
jest.unstable_mockModule('react-router-dom', () => ({ useParams: () => ({ token }), useNavigate: () => navigate,
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
jest.unstable_mockModule('@/components/concierge/AskConcierge', () => ({ AskConcierge: (props: unknown) => <output data-testid="context">{JSON.stringify(props)}</output> }));
const { default: Page } = await import('@/pages/concierge/PublicConciergePage');
let positions: PositionCallback[];
const response = (data: unknown) => ({ ok: true, json: async () => data }) as Response;
const fix = () => ({ timestamp: Date.now(), coords: { latitude: 1.123456789, longitude: 2.123456789, accuracy: 5 } }) as GeolocationPosition;
const resolved = () => ({ lat: fix().coords.latitude, lng: fix().coords.longitude, timezone: 'UTC' });
async function flush() { await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  token = 'bookmark-a'; positions = [];
  navigate.mockClear(); localStorage.clear();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: jest.fn((callback: PositionCallback) => positions.push(callback)) } });
  global.fetch = jest.fn<typeof fetch>().mockImplementation(async input => String(input).includes('/context?') ? response(resolved()) : response({ ok: true }));
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

test('a new guest without a token can open the page and create a bookmark before locating', async () => {
  token = undefined;
  jest.mocked(fetch).mockResolvedValue(response({ token: 'new-bookmark' }));
  render(<Page />); await flush();
  expect(navigate).toHaveBeenCalledWith('/c/new-bookmark', { replace: true });
  expect(screen.queryByTestId('context')).toBeNull();
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
});

test('a GPS callback from an old bookmark cannot populate or request the new bookmark', async () => {
  const view = render(<Page />); await flush();
  fireEvent.click(screen.getByText('Use my precise location'));
  token = 'bookmark-b'; view.rerender(<Page />); await flush();
  await act(async () => { positions[0](fix()); });
  expect(screen.queryByTestId('context')).toBeNull();
  expect(jest.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/context?'))).toBe(false);
});
test('a late context response cannot restore an old bookmark location and the request is aborted', async () => {
  let settle!: (value: Response) => void;
  jest.mocked(fetch).mockImplementation(async input => String(input).includes('/context?')
    ? new Promise<Response>(resolve => { settle = resolve; }) : response({ ok: true }));
  const view = render(<Page />); await flush();
  fireEvent.click(screen.getByText('Use my precise location'));
  await act(async () => { positions[0](fix()); });
  const request = jest.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/context?'))!;
  token = 'bookmark-b'; view.rerender(<Page />); await flush();
  expect(request[1]?.signal?.aborted).toBe(true);
  await act(async () => settle(response(resolved())));
  expect(screen.queryByTestId('context')).toBeNull();
});
test('Google context keeps the supplied precision, while mismatching coordinates cannot be published', async () => {
  render(<Page />); await flush();
  fireEvent.click(screen.getByText('Use my precise location'));
  await act(async () => { positions[0](fix()); });
  expect(JSON.parse(screen.getByTestId('context').textContent!)).toMatchObject({ token, ...resolved() });
  jest.mocked(fetch).mockResolvedValue(response({ ...resolved(), lat: 9 }));
  fireEvent.click(screen.getByText('Refresh my location'));
  await act(async () => { positions[1](fix()); });
  expect(screen.queryByTestId('context')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Location changed');
});
