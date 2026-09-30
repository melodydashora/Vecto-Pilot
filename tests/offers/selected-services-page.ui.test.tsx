import { jest } from '@jest/globals';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OfferAnalyzerPage from '../../client/src/pages/co-pilot/OfferAnalyzerPage';
import { DEFAULT_OFFER_RULESET_CONFIG } from '../../client/src/lib/offer-ruleset-schema';

let auth = { user: { userId: 'synthetic-owner' }, token: 'synthetic-token' };
let selection: string[] | null = ['economy'];
const finishSave = jest.fn(async () => true);
const beginSave = jest.fn(() => () => {});
const setEditorDraft = jest.fn();
let setup = { profile: { selectedServices: selection } };
jest.mock('@/contexts/auth-context', () => ({ useAuth: () => auth }));
jest.mock('@/contexts/run-setup-context', () => ({ useRunSetup: () => ({
  setup, loading: false, getEditorDraft: () => null, draftResetVersion: 0,
  setEditorDraft, beginSave, finishSave, editSetup: jest.fn(),
}) }));
jest.mock('@/contexts/location-context-clean', () => ({ useLocation: () => ({ timeZone: 'America/Chicago' }) }));
jest.mock('@/lib/offer-local-date', () => ({ todayForDriver: () => '2026-09-29' }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/components/offer-analyzer/SetupCard', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/offer-analyzer/OffersCard', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/offer-analyzer/OffersDecisionChart', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/offer-analyzer/GeographyCard', () => ({ __esModule: true, default: () => <p>Saved avoidance controls</p> }));
jest.mock('@/components/offer-analyzer/controls', () => ({
  SliderRow: ({ label, value, onChange }: any) => <label>{label}<input type="range" value={value}
    onChange={event => onChange(Number(event.target.value))} /></label>,
  SwitchRow: ({ label, checked, onCheckedChange }: any) => <label>{label}<input type="checkbox" checked={checked}
    onChange={event => onCheckedChange(event.target.checked)} /></label>,
}));

const response = (config: unknown) => ({ ok: true, status: 200, json: async () => ({ config, version: 7, is_default: false }) });

beforeEach(() => {
  Object.assign(globalThis, { structuredClone: (value: unknown) => JSON.parse(JSON.stringify(value)) });
  auth = { user: { userId: 'synthetic-owner' }, token: 'synthetic-token' };
  selection = ['economy']; setup = { profile: { selectedServices: selection } };
  beginSave.mockClear(); finishSave.mockClear(); setEditorDraft.mockClear();
  global.fetch = jest.fn(async () => response(DEFAULT_OFFER_RULESET_CONFIG)) as unknown as typeof fetch;
});
afterEach(cleanup);

test('the page uses confirmed profile selections, hides unrelated controls, and saves all hidden rules unchanged', async () => {
  const config = JSON.parse(JSON.stringify(DEFAULT_OFFER_RULESET_CONFIG));
  config.tiers.premium.floor_per_mile = 2.35;
  config.delivery.min_per_hour = 37;
  global.fetch = jest.fn(async () => response(config)) as unknown as typeof fetch;
  const view = render(<OfferAnalyzerPage />);
  await screen.findByText('Offer controls for: Economy.');
  expect(screen.queryByText('Analyze delivery offers')).toBeNull();
  expect(screen.queryByText('Premium rides')).toBeNull();
  expect(screen.getByText('Saved avoidance controls')).toBeTruthy();
  expect(screen.getByText('Vision Rules')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(finishSave).toHaveBeenCalledTimes(1));
  const save = (fetch as jest.Mock).mock.calls.find(([, init]: any[]) => init?.method === 'PUT')!;
  expect(JSON.parse(save[1].body).config).toEqual(config);
  setup = { profile: { selectedServices: ['delivery'] } };
  view.rerender(<OfferAnalyzerPage />);
  await screen.findByText('Offer controls for: Delivery.');
  expect(screen.getByText('Analyze delivery offers')).toBeTruthy();
  expect(screen.queryByText('Rider rating floor')).toBeNull();
  expect(screen.queryByText('Rate Targets')).toBeNull();
  expect(screen.queryByText('Saved avoidance controls')).toBeNull();
  expect(screen.queryByText('Vision Rules')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(finishSave).toHaveBeenCalledTimes(2));
  const saves = (fetch as jest.Mock).mock.calls.filter(([, init]: any[]) => init?.method === 'PUT');
  expect(JSON.parse(saves[1][1].body).config).toEqual(config);
});

test('a legacy profile keeps existing controls and explains the optional service selection', async () => {
  setup = { profile: { selectedServices: null } };
  render(<OfferAnalyzerPage />);
  await screen.findByText(/You haven’t chosen services yet/);
  expect(screen.getByText('Standard rides')).toBeTruthy();
  expect(screen.getByText('Premium rides')).toBeTruthy();
  expect(screen.getByText('Analyze delivery offers')).toBeTruthy();
  expect(beginSave).not.toHaveBeenCalled();
});

test('a delayed rules response from the previous account cannot restore that account controls or settings', async () => {
  let resolveOld!: (value: unknown) => void;
  const oldResponse = new Promise(resolve => { resolveOld = resolve; });
  const latest = JSON.parse(JSON.stringify(DEFAULT_OFFER_RULESET_CONFIG));
  latest.delivery.min_per_hour = 41;
  global.fetch = jest.fn()
    .mockImplementationOnce(() => oldResponse)
    .mockImplementation(async () => response(latest)) as unknown as typeof fetch;
  const view = render(<OfferAnalyzerPage />);
  auth = { user: { userId: 'synthetic-new-owner' }, token: 'synthetic-new-token' };
  setup = { profile: { selectedServices: ['delivery'] } };
  view.rerender(<OfferAnalyzerPage />);
  await screen.findByText('Offer controls for: Delivery.');
  resolveOld(response(DEFAULT_OFFER_RULESET_CONFIG));
  await waitFor(() => expect(screen.getByText('Analyze delivery offers')).toBeTruthy());
  expect(screen.queryByText('Standard rides')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save and review', hidden: true }));
  await waitFor(() => expect(finishSave).toHaveBeenCalledTimes(1));
  const save = (fetch as jest.Mock).mock.calls.find(([, init]: any[]) => init?.method === 'PUT')!;
  expect(save[1].headers.Authorization).toBe('Bearer synthetic-new-token');
  expect(JSON.parse(save[1].body).config.delivery.min_per_hour).toBe(41);
});
