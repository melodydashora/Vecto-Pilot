import React from 'react';
import { test, expect, afterEach } from '@jest/globals';
import { render, screen, cleanup } from '@testing-library/react';
import { CoachContextReadout, type CoachContextProgress } from '../../client/src/components/coach/CoachContextStatus';

afterEach(cleanup);
const progress: CoachContextProgress = {
  read_at: '2026-09-11T10:00:00Z',
  snapshot: { state: 'complete', observed_at: '2026-09-11T08:00:00Z' },
  strategy: { state: 'failed', created_at: '2026-09-11T08:00:00Z', updated_at: '2026-09-11T08:03:00Z' },
  briefing: { state: 'partial', generated_at: null, updated_at: '2026-09-11T08:02:00Z' },
  offers: { state: 'available', count: 2, limit: 20, updated_at: '2026-09-11T08:04:00Z' },
};

test('failed Strategy, partial Briefing and stored timestamps remain distinct from last checked time', () => {
  render(<CoachContextReadout progress={progress} />);
  expect(screen.getByRole('alert').textContent).toContain('Some sources failed');
  expect(screen.getByText(/Generation failed · updated/).textContent).toContain(new Date(progress.strategy.updated_at!).toLocaleString(undefined, { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' }));
  expect(screen.getByText(/Partial · updated/)).toBeTruthy();
  expect(screen.getByText(/2 recent \(up to 20\)/)).toBeTruthy();
  expect(screen.getByText(/Each question reads them again/)).toBeTruthy();
});

test('read failure is displayed as failed data access, not a successful empty offer log', () => {
  render(<CoachContextReadout progress={{ ...progress, offers: { ...progress.offers, state: 'read_failed', count: 0, updated_at: null } }} />);
  expect(screen.getByText(/Could not read saved data/)).toBeTruthy();
  expect(screen.queryByText(/0 recent/)).toBeNull();
});


test('current Coach observation and historical sources show their own saved zones, with explicit UTC for offers', () => {
  render(<CoachContextReadout progress={{ ...progress,
    snapshot: { ...progress.snapshot, timezone: 'America/New_York' },
    strategy: { ...progress.strategy, timezone: 'America/Chicago' },
    briefing: { ...progress.briefing, timezone: 'America/Chicago' },
  }} />);
  expect(screen.getByText(/Available · observed/)).toHaveTextContent('America/New_York');
  expect(screen.getByText(/Generation failed · updated/)).toHaveTextContent('America/Chicago');
  expect(screen.getByText(/Partial · updated/)).toHaveTextContent('America/Chicago');
  expect(screen.getByText(/2 recent/)).toHaveTextContent('UTC');
  expect(screen.getByText(/Saved sources checked/)).toHaveTextContent('America/New_York');
});

test('invalid or absent saved timezone uses explicitly labelled UTC, never browser-local time', () => {
  render(<CoachContextReadout progress={{ ...progress,
    snapshot: { ...progress.snapshot, timezone: 'Invalid/Zone' },
  }} />);
  expect(screen.getByText(/Available · observed/)).toHaveTextContent('UTC');
  expect(screen.getByText(/Generation failed · updated/)).toHaveTextContent('UTC');
});
