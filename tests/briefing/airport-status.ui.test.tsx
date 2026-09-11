import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AirportCard } from '../../client/src/components/briefing/AirportCard';

afterEach(cleanup);
const show = (fields: Record<string, unknown> = {}) => render(<AirportCard isAirportLoading={false}
  airportData={{ airport_conditions: { airports: [{ code: 'AAA', name: 'Synthetic airport',
    status: 'normal', delays: 'No current delays reported', ...fields }] } }} />);

test('FAA ground stop replaces model-normal badge and preserves source observations', () => {
  show({ faa_closure_status: 'ground-stop', faa_has_delays: true, faa_delay_minutes: 0,
    faa_ground_stops: [{ reason: 'Synthetic weather restriction', end_time: '18:00 UTC' }],
    faa_source_updated_at: 'Thu Sep 10 17:00:00 2026 GMT', faa_fetched_at: '2026-09-10T17:03:00.000Z' });
  expect(screen.getByText('Ground Stop')).toBeTruthy();
  expect(screen.getByText('FAA: Ground stop')).toBeTruthy();
  expect(screen.queryByText('On Time')).toBeNull();
  expect(screen.queryByText('No current delays reported')).toBeNull();
  expect(screen.getByText(/Synthetic weather restriction/).textContent).toContain('18:00 UTC');
  expect(screen.getByText('FAA feed updated: Thu Sep 10 17:00:00 2026 GMT')).toBeTruthy();
  expect(screen.getByText('Retrieved: 2026-09-10T17:03:00.000Z')).toBeTruthy();
  expect(screen.queryByText(/0 min/)).toBeNull();
});

test('unquantified FAA delay remains a delay with unknown duration', () => {
  show({ faa_has_delays: true, faa_delay_minutes: null, faa_closure_status: 'unknown', faa_delay_reason: 'Traffic management' });
  expect(screen.getByText('Delays')).toBeTruthy();
  expect(screen.getByText('FAA: Delays reported')).toBeTruthy();
  expect(screen.getByText('Traffic management')).toBeTruthy();
  expect(screen.getByText('Delay duration not reported.')).toBeTruthy();
  expect(screen.queryByText('On Time')).toBeNull();
});

test('a scoped FAA restriction does not claim the whole airport is closed or reopening', () => {
  show({ faa_closure_status: 'restricted', faa_has_delays: false, faa_delay_reason: 'Restricted to selected aircraft',
    faa_closure_start: '17:00 UTC', faa_closure_end: '19:00 UTC' });
  expect(screen.getByText('Restrictions')).toBeTruthy();
  expect(screen.getByText('Restricted to selected aircraft')).toBeTruthy();
  expect(screen.getByText(/does not mean the entire airport is closed/)).toBeTruthy();
  expect(screen.getByText('FAA restriction start: 17:00 UTC')).toBeTruthy();
  expect(screen.getByText('FAA reported restriction end: 19:00 UTC')).toBeTruthy();
  expect(screen.queryByText(/reopening/)).toBeNull();
  expect(screen.queryByText('Closed')).toBeNull();
  expect(screen.queryByText('On Time')).toBeNull();
});

test.each([false, null])('unsupported/unknown FAA coverage %s is neutral, with no invented timestamp', supported => {
  show({ faa_supported: supported, faa_has_delays: null, faa_delay_minutes: null, faa_closure_status: 'unknown' });
  expect(screen.getByText('Unknown')).toBeTruthy();
  expect(screen.queryByText('On Time')).toBeNull();
  expect(screen.queryByText(/FAA feed updated:/)).toBeNull();
  expect(screen.queryByText('No current delays reported')).toBeNull();
  expect(screen.queryByText(/Retrieved:/)).toBeNull();
  expect(screen.getByText(supported === false ? 'FAA: Airport not covered by ASWS' : 'FAA: Status unknown')).toBeTruthy();
});

test('a measured delay is visible even when the older has-delays field is missing', () => {
  show({ faa_delay_minutes: 28, faa_closure_status: 'open' });
  expect(screen.getByText('FAA reported delay: 28 min')).toBeTruthy();
  expect(screen.queryByText('On Time')).toBeNull();
});

test('explicit FAA no-delay does not erase a separately researched disruption', () => {
  show({ status: 'severe', delays: 'Terminal disruption', faa_has_delays: false, faa_delay_minutes: 0, faa_closure_status: 'open' });
  expect(screen.getByText('Severe Delays')).toBeTruthy();
  expect(screen.getByText('FAA: No delays reported')).toBeTruthy();
  expect(screen.getByText('Terminal disruption')).toBeTruthy();
});

test('legacy model-only rows retain their display and missing status is unknown', () => {
  const view = show();
  expect(screen.getByText('On Time')).toBeTruthy();
  expect(screen.queryByText(/FAA:/)).toBeNull();
  view.unmount();
  show({ status: undefined, delays: undefined });
  expect(screen.getByText('Unknown')).toBeTruthy();
  expect(screen.queryByText('On Time')).toBeNull();
});

test('a ground-stop observation is sufficient when the other FAA fields are absent', () => {
  show({ faa_ground_stops: [{ reason: 'Synthetic ground stop', end_time: null }] });
  expect(screen.getByText('Ground Stop')).toBeTruthy();
  expect(screen.getByText('Ground stop: Synthetic ground stop')).toBeTruthy();
  expect(screen.getByText('Delay duration not reported.')).toBeTruthy();
  expect(screen.queryByText('On Time')).toBeNull();
  expect(screen.queryByText(/reopening/)).toBeNull();
});

test('an explicit FAA closure retains its start and reported reopening label', () => {
  show({ faa_closure_status: 'closed', faa_closure_start: '17:00 UTC', faa_closure_end: '19:00 UTC' });
  expect(screen.getByText('Closed')).toBeTruthy();
  expect(screen.getByText('FAA: Closure reported')).toBeTruthy();
  expect(screen.getByText('FAA closure start: 17:00 UTC')).toBeTruthy();
  expect(screen.getByText('FAA reported reopening: 19:00 UTC')).toBeTruthy();
});

test('retrieval time alone never becomes a source update time', () => {
  show({ faa_has_delays: true, faa_fetched_at: '2026-09-10T17:03:00.000Z' });
  expect(screen.getByText('Retrieved: 2026-09-10T17:03:00.000Z')).toBeTruthy();
  expect(screen.queryByText(/FAA feed updated:/)).toBeNull();
});

test('normalized historical status remains neutral when FAA coverage is unknown', () => {
  show({ status: ' NORMAL ', faa_supported: null });
  expect(screen.getByText('Unknown')).toBeTruthy();
  expect(screen.queryByText('On Time')).toBeNull();
  expect(screen.queryByText('No current delays reported')).toBeNull();
});

test('collapse has a focusable native button with explicit expanded state', () => {
  show({ faa_has_delays: true });
  const toggle = screen.getByRole('button', { name: /Airport Conditions/ });
  expect(toggle.tagName).toBe('BUTTON');
  toggle.focus();
  expect(document.activeElement).toBe(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeTruthy();
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('FAA: Delays reported')).toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('FAA: Delays reported')).toBeTruthy();
});

test('loading retains an accessible collapse name', () => {
  render(<AirportCard isAirportLoading={true} />);
  expect(screen.getByRole('button', { name: 'Airport Conditions' })).toBeTruthy();
  expect(screen.getByText('Loading airport data...')).toBeTruthy();
});

test('no section received never claims that no nearby airports exist', () => {
  render(<AirportCard isAirportLoading={false} />);
  expect(screen.getByText('Waiting for airport information…')).toBeTruthy();
  expect(screen.queryByText('No nearby airports found')).toBeNull();
});

test('an inner pending marker is honored even when the query loading flag is false', () => {
  render(<AirportCard isAirportLoading={false} airportData={{ airport_conditions: { _pending: true, airports: [] } } as any} />);
  expect(screen.getByText('Loading airport data...')).toBeTruthy();
  expect(screen.queryByText('No nearby airports found')).toBeNull();
});

test('a resolved empty section requires and displays its actual reason', () => {
  const view = render(<AirportCard isAirportLoading={false} airportData={{ airport_conditions: { airports: [], verifiedEmpty: true, reason: 'Synthetic verified selection returned no airports' } }} />);
  expect(screen.getByText('Synthetic verified selection returned no airports')).toBeTruthy();
  view.rerender(<AirportCard isAirportLoading={false} airportData={{ airport_conditions: { airports: [], recommendations: 'A recommendation is not an empty-result reason' } }} />);
  expect(screen.getByRole('alert').textContent).toMatch(/no reason/);
  expect(screen.queryByText('A recommendation is not an empty-result reason')).toBeNull();
  expect(screen.queryByText('No nearby airports found')).toBeNull();
});

test('a known failure remains visible with its reason even when nearby identities or a loading flag remain', () => {
  render(<AirportCard isAirportLoading={true} airportData={{ airport_conditions: { isFallback: true, reason: 'Synthetic research timeout', airports: [{ code: 'AAA', name: 'Known synthetic airport', status: 'unknown' }] } }} />);
  expect(screen.getByRole('alert').textContent).toContain('Synthetic research timeout');
  expect(screen.getByText('Known synthetic airport')).toBeTruthy();
  expect(screen.queryByText('No nearby airports found')).toBeNull();
});

test('legacy directional on-time claims stay unconfirmed during an observed FAA disruption', () => {
  show({ faa_closure_status: 'ground-stop', faa_has_delays: true, arrivalDelays: { status: 'none', avgMinutes: 0 } });
  expect(screen.getByText('Arrivals')).toBeTruthy();
  expect(screen.getByText('Status not confirmed')).toBeTruthy();
  expect(screen.queryByText('On Time')).toBeNull();
  expect(screen.queryByText('Normal')).toBeNull();
  expect(screen.queryByText('Departures')).toBeNull();
});

test('one historical direction preserves its reported delay without inventing the missing direction', () => {
  show({ status: 'delayed', arrivalDelays: { status: 'delayed', avgMinutes: 18 } });
  expect(screen.getByText('~18 min delay')).toBeTruthy();
  expect(screen.queryByText('Departures')).toBeNull();
  expect(screen.queryByText('Normal')).toBeNull();
});
