import React from 'react';
import { jest, test, expect, afterEach } from '@jest/globals';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
const { MemoryRouter, Routes, Route, Link } = await import('react-router-dom');
const continueRun = jest.fn();
const setup = { view: 'summary', reviewOpen: false, run: null, setup: { profile: { selectedServices: ['economy'], ridesharePlatforms: ['uber'] },
  vehicle: { year: 2024, make: 'Fixture', model: 'Car' }, rulesVersion: 1, ready: true, missingFields: [] },
  loading: false, starting: false, saving: false, error: null, editSetup: jest.fn(), reviewSetup: jest.fn(), dismissReview: jest.fn(),
  continueWithSavedPreferences: continueRun, reload: jest.fn() };
jest.unstable_mockModule('@/contexts/run-setup-context', () => ({ useRunSetup: () => setup }));
jest.unstable_mockModule('@/contexts/location-context-clean', () => ({ useLocation: () => ({ locationRequested: true }) }));
jest.unstable_mockModule('@/components/GlobalHeader', () => ({ default: () => <div>Driver header</div> }));
jest.unstable_mockModule('@/components/co-pilot/BottomTabNavigation', () => ({ BottomTabNavigation: () => <nav><Link to="/co-pilot/offer-analyzer">Offer Analyzer</Link><Link to="/co-pilot/strategy">Strategy</Link></nav> }));
jest.unstable_mockModule('@/components/ui/toaster', () => ({ Toaster: () => null }));
const { default: CoPilotLayout } = await import('@/layouts/CoPilotLayout');
afterEach(cleanup);
test('held setup leaves Offer Analyzer, earnings and history usable; navigation never continues a run', () => {
  render(<MemoryRouter initialEntries={['/co-pilot/offer-analyzer']}><Routes>
    <Route path="/co-pilot" element={<CoPilotLayout />}>
      <Route path="offer-analyzer" element={<label>Saved earnings<input defaultValue="25" /></label>} />
      <Route path="strategy" element={<p>Previous strategy history</p>} />
    </Route>
  </Routes></MemoryRouter>);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const earnings = screen.getByRole('textbox', { name: 'Saved earnings' });
  expect(earnings).toBeVisible(); fireEvent.change(earnings, { target: { value: '35' } });
  expect(earnings).toHaveValue('35');
  fireEvent.click(screen.getByRole('link', { name: 'Strategy' }));
  expect(screen.getByText('Previous strategy history')).toBeVisible();
  expect(continueRun).not.toHaveBeenCalled();
  expect(screen.queryByText(/version 1/i)).not.toBeInTheDocument();
});
