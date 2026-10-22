// 2026-10-17: pins which tab each rules card lives in. Every TabsContent is forceMount
// (hidden by CSS only), so a card is in the DOM whatever tab is active — the only way to
// see placement under jsdom is to look inside the named tabpanel. Melody: Limits belong
// with Gates, not beside the phone-setup instructions.
import { jest } from '@jest/globals';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import OfferAnalyzerPage from '../../client/src/pages/co-pilot/OfferAnalyzerPage';
import { DEFAULT_OFFER_RULESET_CONFIG } from '../../client/src/lib/offer-ruleset-schema';

const auth = { user: { userId: 'synthetic-owner' }, token: 'synthetic-token' };
let setup: { profile: { selectedServices: string[] | null } } = { profile: { selectedServices: ['economy'] } };
jest.mock('@/contexts/auth-context', () => ({ useAuth: () => auth }));
jest.mock('@/contexts/run-setup-context', () => ({ useRunSetup: () => ({
  setup, loading: false, getEditorDraft: () => null, draftResetVersion: 0,
  setEditorDraft: jest.fn(), beginSave: jest.fn(() => () => {}), finishSave: jest.fn(async () => true), editSetup: jest.fn(),
}) }));
jest.mock('@/contexts/location-context-clean', () => ({ useLocation: () => ({ timeZone: 'America/Chicago' }) }));
jest.mock('@/lib/offer-local-date', () => ({ todayForDriver: () => '2026-10-17' }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/components/offer-analyzer/SetupCard', () => ({ __esModule: true, default: () => <p>Phone setup instructions</p> }));
jest.mock('@/components/offer-analyzer/OffersCard', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/offer-analyzer/OffersDecisionChart', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/offer-analyzer/GeographyCard', () => ({ __esModule: true, default: () => <p>Saved avoidance controls</p> }));
jest.mock('@/components/offer-analyzer/controls', () => ({
  SliderRow: ({ label, value, onChange }: any) => <label>{label}<input type="range" value={value}
    onChange={event => onChange(Number(event.target.value))} /></label>,
  SwitchRow: ({ label, checked, onCheckedChange }: any) => <label>{label}<input type="checkbox" checked={checked}
    onChange={event => onCheckedChange(event.target.checked)} /></label>,
}));

const response = (config: unknown, is_default = false) => ({ ok: true, status: 200, json: async () => ({ config, version: 7, is_default }) });

beforeEach(() => {
  Object.assign(globalThis, { structuredClone: (value: unknown) => JSON.parse(JSON.stringify(value)) });
  setup = { profile: { selectedServices: ['economy'] } };
  global.fetch = jest.fn(async () => response(DEFAULT_OFFER_RULESET_CONFIG)) as unknown as typeof fetch;
});
afterEach(cleanup);

test('Limits render in the Gates tab under the gate switches, not beside the setup instructions', async () => {
  render(<OfferAnalyzerPage />);
  await screen.findByText('Offer controls for: Economy.');
  const gates = screen.getByRole('tabpanel', { name: 'Gates' });
  expect(within(gates).getByText('Rider rating floor')).toBeTruthy();
  expect(within(gates).getByText('Pickup limits')).toBeTruthy();
  expect(within(gates).getByText('Total time limit')).toBeTruthy();
  expect(within(gates).getByText('Acceptance rate protection')).toBeTruthy();
  // Order on the page: gates first, then limits.
  const gateTexts = within(gates).getAllByText(/Rider rating floor|Pickup limits/).map(node => node.textContent);
  expect(gateTexts.findIndex(text => text?.startsWith('Rider rating floor')))
    .toBeLessThan(gateTexts.findIndex(text => text?.startsWith('Pickup limits')));

  const rules = screen.getByRole('tabpanel', { name: 'Rules & Setup' });
  expect(within(rules).getByText('Phone setup instructions')).toBeTruthy();
  expect(within(rules).getByText('Saved avoidance controls')).toBeTruthy();
  expect(within(rules).getByText('Vision Rules')).toBeTruthy();
  expect(within(rules).queryByText('Pickup limits')).toBeNull();
  expect(within(rules).queryByText('Total time limit')).toBeNull();

  const rates = screen.getByRole('tabpanel', { name: 'Rates' });
  expect(within(rates).getByText('Rate Targets')).toBeTruthy();
  expect(within(rates).queryByText('Pickup limits')).toBeNull();
});

test('the initial-rules notice shows on the Gates tab where the driver lands', async () => {
  global.fetch = jest.fn(async () => response(DEFAULT_OFFER_RULESET_CONFIG, true)) as unknown as typeof fetch;
  render(<OfferAnalyzerPage />);
  await screen.findByText('Offer controls for: Economy.');
  const gates = screen.getByRole('tabpanel', { name: 'Gates' });
  expect(within(gates).getByText(/You are using initial rules/)).toBeTruthy();
});

test('a delivery-only selection hides limits along with the other ride controls and keeps saved values', async () => {
  setup = { profile: { selectedServices: ['delivery'] } };
  render(<OfferAnalyzerPage />);
  await screen.findByText('Offer controls for: Delivery.');
  expect(screen.queryByText('Pickup limits')).toBeNull();
  expect(screen.queryByText('Total time limit')).toBeNull();
  expect(screen.queryByText('Acceptance rate protection')).toBeNull();
  expect(screen.getByText('Ride gates and limits are hidden because no ride services are selected. Saved ride rules are preserved.')).toBeTruthy();
  expect(screen.getByText('Analyze delivery offers')).toBeTruthy();
});
