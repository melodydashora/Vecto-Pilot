// Compact setup choice: canonical edits stay in their owners, no generation here.
import React from 'react';
import { jest, test, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
const { MemoryRouter, useLocation } = await import('react-router-dom');
const confirmPreferences = jest.fn<() => boolean>();
const start = jest.fn();
const editSetup = jest.fn();
let setup: any;
jest.unstable_mockModule('@/contexts/run-setup-context', () => ({ useRunSetup: () => setup }));
const { default: RunSetupSummary } = await import('@/components/co-pilot/RunSetupSummary');
function Destination() { return <output aria-label="Current page">{useLocation().pathname}</output>; }
const app = () => <MemoryRouter><RunSetupSummary /><Destination /></MemoryRouter>;
beforeEach(() => {
  setup = { setup: { ready: true, missingFields: [], profile: { nickname: 'Private nickname', ridesharePlatforms: ['uber'] },
    vehicle: { make: 'Private car' }, rules: { global: { rating_floor: 4.92 } } }, loading: false,
    starting: false, saving: false, saveUnconfirmed: false, unsavedEditors: [], canContinue: true,
    error: null, editSetup, confirmPreferences, continueWithSavedPreferences: start };
  confirmPreferences.mockReset().mockReturnValue(true); editSetup.mockReset(); start.mockReset();
});
afterEach(cleanup);

test('shows only the two choices without driver preferences or raw platform names', () => {
  render(app());
  expect(screen.getAllByRole('button')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Continue with Preference' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Change Preferences for this session' })).toBeEnabled();
  expect(screen.queryByText(/Private nickname|Private car|uber|4\.92/)).not.toBeInTheDocument();
  expect(start).not.toHaveBeenCalled();
});
test('Continue confirms the choice and opens Strategy without starting generation', () => {
  render(app()); fireEvent.click(screen.getByRole('button', { name: 'Continue with Preference' }));
  expect(confirmPreferences).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Current page')).toHaveTextContent('/co-pilot/strategy');
  expect(start).not.toHaveBeenCalled();
});
test('an unsuccessful confirmation remains on the current page', () => {
  confirmPreferences.mockReturnValue(false); render(app());
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Preference' }));
  expect(screen.getByLabelText('Current page')).toHaveTextContent('/');
  expect(start).not.toHaveBeenCalled();
});
test('Change Preferences opens the editor for this session without generation', () => {
  render(app()); fireEvent.click(screen.getByRole('button', { name: 'Change Preferences for this session' }));
  expect(editSetup).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Current page')).toHaveTextContent('/co-pilot/settings');
  expect(confirmPreferences).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
});
test.each(['incomplete', 'unconfirmed', 'unsaved', 'loading'])('%s setup cannot continue, but remains editable', reason => {
  setup.canContinue = false;
  if (reason === 'incomplete') setup.setup = { ready: false, profile: null, missingFields: ['offerRules'] };
  if (reason === 'unconfirmed') setup.saveUnconfirmed = true;
  if (reason === 'unsaved') setup.unsavedEditors = ['offerAnalyzer'];
  if (reason === 'loading') setup.loading = true;
  render(app());
  expect(screen.getByRole('button', { name: 'Continue with Preference' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Change Preferences for this session' })).toBeEnabled();
  expect(start).not.toHaveBeenCalled();
});
test('pending save disables both choices without clearing drafts', () => {
  setup.canContinue = false; setup.saving = true; setup.unsavedEditors = ['preferences'];
  render(app()); for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  expect(setup.unsavedEditors).toEqual(['preferences']); expect(start).not.toHaveBeenCalled();
});
