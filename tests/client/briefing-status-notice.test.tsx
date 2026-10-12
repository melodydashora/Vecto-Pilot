import React from 'react';
import { jest, test, expect, beforeEach, afterEach } from '@jest/globals';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TextDecoder, TextEncoder } from 'node:util';

Object.assign(globalThis, { TextDecoder, TextEncoder });
const { MemoryRouter, Routes, Route, Link } = await import('react-router-dom');
const signOut = jest.fn();
const continueRun = jest.fn();
let context = {
  contextSnapshotId: 'synthetic-source',
  criticalError: null as { type: string; details?: string; message?: string } | null,
  briefingData: { generationError: null as string | null, isGathering: false, isRetryExhausted: false },
};
jest.unstable_mockModule('@/contexts/co-pilot-context', () => ({ useCoPilot: () => context }));
jest.unstable_mockModule('@/contexts/run-setup-context', () => ({ useRunSetup: () => ({
  view: 'summary', reviewOpen: false, saving: false, dismissReview: jest.fn(), reviewSetup: jest.fn(),
  continueWithSavedPreferences: continueRun,
}) }));
jest.unstable_mockModule('@/contexts/location-context-clean', () => ({ useLocation: () => ({ locationRequested: true }) }));
jest.unstable_mockModule('@/components/GlobalHeader', () => ({ default: () => <header>
  <span>Driver header</span><button onClick={signOut}>Sign out</button>
</header> }));
jest.unstable_mockModule('@/components/co-pilot/BottomTabNavigation', () => ({ BottomTabNavigation: () => <nav aria-label="Main navigation">
  <Link to="/co-pilot/strategy">Strategy</Link><Link to="/co-pilot/settings">Preferences</Link>
</nav> }));
jest.unstable_mockModule('@/components/co-pilot/RunSetupSummary', () => ({ default: () => <p>Setup summary</p> }));
jest.unstable_mockModule('@/components/ui/toaster', () => ({ Toaster: () => null }));

const { BriefingStatusNotice } = await import('@/components/briefing/BriefingStatusNotice');
const { default: CoPilotLayout } = await import('@/layouts/CoPilotLayout');
const pending = { snapshotId: 'synthetic-source', isGathering: true, error: null, updatesUnavailable: false };
const notice = (props = pending) => <MemoryRouter><BriefingStatusNotice {...props} /></MemoryRouter>;
const tick = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });
const slowTitle = 'Intelligence gathering is taking longer than usual.';
function layout() {
  return <MemoryRouter initialEntries={['/co-pilot/strategy']}><Routes>
    <Route path="/co-pilot" element={<CoPilotLayout />}>
      <Route path="strategy" element={<><p>Saved Strategy remains available</p><button disabled>Continue Strategy</button></>} />
      <Route path="briefing" element={<p>Available Briefing sections</p>} />
      <Route path="coach" element={<p>Coach conversation</p>} />
      <Route path="settings" element={<label>Nickname<input defaultValue="Synthetic driver" /></label>} />
    </Route>
  </Routes></MemoryRouter>;
}

beforeEach(() => {
  jest.useFakeTimers(); signOut.mockClear(); continueRun.mockClear();
  context = { contextSnapshotId: 'synthetic-source', criticalError: null,
    briefingData: { generationError: null, isGathering: false, isRetryExhausted: false } };
});
afterEach(() => { cleanup(); jest.clearAllTimers(); jest.useRealTimers(); });

test('only confirmed gathering shows the slow notice after 45 seconds', () => {
  render(notice());
  tick(44_999); expect(screen.queryByRole('region', { name: 'Briefing status' })).not.toBeInTheDocument();
  tick(1); expect(screen.getByRole('heading', { name: slowTitle })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('The latest confirmed status is still gathering data.');
  expect(screen.getByRole('status')).toHaveTextContent('Strategy requires complete intelligence.');
});

test.each([null, 'synthetic-source'])('does not infer running work from an absent or idle source %s', snapshotId => {
  render(notice({ ...pending, snapshotId, isGathering: false }));
  tick(90_000); expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('a different source restarts the waiting period without flashing the previous slow notice', () => {
  const view = render(notice()); tick(45_000);
  view.rerender(notice({ ...pending, snapshotId: 'replacement-source' }));
  expect(screen.queryByText(slowTitle)).not.toBeInTheDocument();
  tick(44_999); expect(screen.queryByText(slowTitle)).not.toBeInTheDocument();
  tick(1); expect(screen.getByText(slowTitle)).toBeVisible();
});

test('completion cancels the timer and a later gathering period starts from zero', () => {
  const view = render(notice()); tick(30_000);
  view.rerender(notice({ ...pending, isGathering: false }));
  tick(60_000); expect(screen.queryByRole('status')).not.toBeInTheDocument();
  view.rerender(notice()); tick(44_999);
  expect(screen.queryByText(slowTitle)).not.toBeInTheDocument();
  tick(1); expect(screen.getByText(slowTitle)).toBeVisible();
});

test('unmount clears the pending timer', () => {
  const view = render(notice()); expect(jest.getTimerCount()).toBe(1);
  view.unmount(); expect(jest.getTimerCount()).toBe(0);
});

test('terminal failure shows its actual reason immediately with no running claim or spinner', () => {
  render(<MemoryRouter><BriefingStatusNotice {...pending} error="Schools: official calendar could not be verified." /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Some intelligence could not be gathered' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Schools: official calendar could not be verified.');
  tick(90_000); expect(screen.queryByText(slowTitle)).not.toBeInTheDocument();
  expect(screen.queryByText(/still gathering data/)).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(document.querySelector('[class*="animate-spin"]')).toBeNull();
});

test('exhausted updates describe unknown status without claiming the server stopped or is still running', () => {
  render(notice({ ...pending, updatesUnavailable: true }));
  expect(screen.getByRole('heading', { name: 'Intelligence updates could not be confirmed.' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('This does not confirm whether gathering has finished.');
  tick(90_000); expect(screen.queryByText(slowTitle)).not.toBeInTheDocument();
  expect(screen.queryByText(/still gathering data/)).not.toBeInTheDocument();
});

test('terminal research failure takes precedence over unavailable updates', () => {
  render(<MemoryRouter><BriefingStatusNotice {...pending} error="Traffic research failed." updatesUnavailable /></MemoryRouter>);
  expect(screen.getByText('Traffic research failed.')).toBeVisible();
  expect(screen.queryByText('Intelligence updates could not be confirmed.')).not.toBeInTheDocument();
});

test.each(['View Briefing', 'Open Coach', 'Change preferences'])('layout keeps header, navigation, saved content and %s available during failure', label => {
  context.briefingData.generationError = 'News: required source was unavailable.';
  render(layout());
  expect(screen.getByRole('banner')).toBeVisible();
  expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  expect(screen.getByText('Saved Strategy remains available')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Continue Strategy' })).toBeDisabled();
  const main = screen.getByRole('main');
  expect(within(main).getByRole('region', { name: 'Briefing status' })).toHaveTextContent('News: required source was unavailable.');
  fireEvent.click(screen.getByRole('link', { name: label }));
  if (label === 'View Briefing') expect(screen.getByText('Available Briefing sections')).toBeVisible();
  else if (label === 'Open Coach') expect(screen.getByText('Coach conversation')).toBeVisible();
  else {
    const nickname = screen.getByRole('textbox', { name: 'Nickname' });
    fireEvent.change(nickname, { target: { value: 'Editable preferences' } });
    expect(nickname).toHaveValue('Editable preferences');
  }
  expect(screen.getByRole('banner')).toBeVisible();
  expect(signOut).not.toHaveBeenCalled(); expect(continueRun).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(signOut).toHaveBeenCalledTimes(1);
});

test('layout also displays a saved Briefing error while preserving route content', () => {
  context.criticalError = { type: 'briefing_failed', details: 'Previously confirmed Briefing failure.' };
  render(layout());
  expect(screen.getByRole('status')).toHaveTextContent('Previously confirmed Briefing failure.');
  expect(screen.getByText('Saved Strategy remains available')).toBeVisible();
});

test('layout does not turn an unrelated error into a Briefing failure', () => {
  context.criticalError = { type: 'unknown', details: 'Unrelated failure' };
  render(layout()); tick(90_000);
  expect(screen.queryByRole('region', { name: 'Briefing status' })).not.toBeInTheDocument();
  expect(screen.getByText('Saved Strategy remains available')).toBeVisible();
});
