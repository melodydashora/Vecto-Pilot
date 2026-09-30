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
  expect(screen.getByText(/Generation failed · updated/).textContent).toContain(new Date(progress.strategy.updated_at!).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }));
  expect(screen.getByText(/Partial · updated/)).toBeTruthy();
  expect(screen.getByText(/2 saved \(up to 20\)/)).toBeTruthy();
  expect(screen.getByText(/Each question reads them again/)).toBeTruthy();
});

test('read failure is displayed as failed data access, not a successful empty offer log', () => {
  render(<CoachContextReadout progress={{ ...progress, offers: { ...progress.offers, state: 'read_failed', count: 0, updated_at: null } }} />);
  expect(screen.getByText(/Could not read saved data/)).toBeTruthy();
  expect(screen.queryByText(/0 saved/)).toBeNull();
});
