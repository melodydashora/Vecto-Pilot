import React from 'react';
import { jest, test, expect, beforeEach, afterEach } from '@jest/globals';
import { render, waitFor, cleanup } from '@testing-library/react';

const markers: Array<any> = [];
const setContent = jest.fn();
class Marker extends EventTarget {
  map: any; title: string; position: any; gmpClickable = false;
  domEvents: string[] = [];
  constructor(options: any) { super(); Object.assign(this, options); this.title = options.title; this.position = options.position; markers.push(this); }
  addListener(event: string) { throw new Error(`Maps addListener cannot register ${event}; gmp-click uses the DOM event API`); }
  addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    this.domEvents.push(type); super.addEventListener(type, callback, options);
  }
}
const googleApi = { maps: {
  Map: class { fitBounds() {} setCenter() {} setZoom() {} getZoom() { return 11; } addListener() {} },
  TrafficLayer: class { setMap() {} },
  InfoWindow: class { setContent = setContent; open() {} close() {} },
  LatLngBounds: class { extend() {} },
  marker: { AdvancedMarkerElement: Marker },
  event: { addListenerOnce(_target: unknown, _name: string, fn: () => void) { fn(); } },
} };
jest.unstable_mockModule('@/lib/maps/google-maps-loader', () => ({ loadGoogleMaps: async () => googleApi, getMapId: () => 'fixture-map' }));
const { default: StrategyMap } = await import('@/components/strategy/StrategyMap');
const { filterTodayEvents, filterValidEvents, eventDisplayFields } = await import('@/utils/co-pilot-helpers');
const event = {
  title: 'Late show', latitude: 0, longitude: -74,
  event_start_date: '2026-09-30', event_start_time: '00:15', event_end_date: '2026-09-30', event_end_time: '01:30',
  start_time_iso: '2026-09-30T04:15:00Z', end_time_iso: '2026-09-30T05:30:00Z', timezone: 'America/New_York',
};
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
  jest.setSystemTime(new Date('2026-09-30T03:00:00Z'));
  markers.length = 0; setContent.mockClear();
  localStorage.clear();
  window.google = googleApi as unknown as typeof google;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); jest.useRealTimers(); });
test('absolute-only events remain eligible for both map and Briefing', () => {
  const onlyAbsolute = { start_time_iso: event.start_time_iso, end_time_iso: event.end_time_iso };
  expect(filterTodayEvents([onlyAbsolute], 'America/Chicago')).toHaveLength(1);
  expect(filterValidEvents([onlyAbsolute], 'America/Chicago').todayEvents).toHaveLength(1);
});
test('real map keeps zero-coordinate events, displays viewer time and refreshes corrected schedules', async () => {
  const props = { driverLat: 41, driverLng: -87, venues: [], events: [event], timezone: 'America/Chicago' };
  const view = render(<StrategyMap {...props} />);
  await waitFor(() => expect(markers.find(m => m.title === event.title && m.map)).toBeDefined());
  const first = markers.find(m => m.title === event.title && m.map);
  expect(first.gmpClickable).toBe(true);
  first.dispatchEvent(new Event('gmp-click'));
  expect(String(setContent.mock.calls.at(-1)?.[0])).toContain('11:15 PM');
  expect(String(setContent.mock.calls.at(-1)?.[0])).not.toContain('Tomorrow');
  view.rerender(<StrategyMap {...props} driverLat={41.01} />);
  expect(first.map).not.toBeNull();
  view.rerender(<StrategyMap {...props} events={[{ ...event, start_time_iso: '2026-09-30T04:45:00Z' }]} />);
  await waitFor(() => expect(markers.filter(m => m.title === event.title && m.map)).toHaveLength(1));
  const latest = markers.find(m => m.title === event.title && m.map);
  expect(latest).not.toBe(first);
  latest.dispatchEvent(new Event('gmp-click'));
  expect(String(setContent.mock.calls.at(-1)?.[0])).toContain('11:45 PM');
});

test('a disputed representative end stays unconfirmed while raw reports retain their evidence', async () => {
  const variants = [Object.freeze({ ...event }), Object.freeze({ ...event, end_time_iso: '2026-09-30T06:30:00Z' })];
  const disputed = Object.freeze({ ...event, event_end_conflict: true, event_variants: variants });
  expect(eventDisplayFields(disputed, 'America/Chicago')?.event_end_time).toBeUndefined();
  expect(eventDisplayFields({ ...disputed, start_time_iso: undefined }, 'America/Chicago')).toBeNull();
  const legacy = { event_start_date: '2026-09-29', event_start_time: '23:15', event_end_time: '23:45', event_end_conflict: true };
  expect({ ...legacy, ...eventDisplayFields(legacy, 'America/Chicago') }.event_end_time).toBeUndefined();
  render(<StrategyMap driverLat={41} driverLng={-87} venues={[]} events={[disputed]} timezone="America/Chicago" />);
  await waitFor(() => expect(markers.find(m => m.title === event.title && m.map)).toBeDefined());
  markers.find(m => m.title === event.title && m.map).dispatchEvent(new Event('gmp-click'));
  const popup = String(setContent.mock.calls.at(-1)?.[0]);
  expect(popup).toContain('11:15 PM');
  expect(popup).toContain('End time unconfirmed');
  expect(popup).not.toContain('12:30 AM');
  expect(disputed.end_time_iso).toBe('2026-09-30T05:30:00Z');
  expect(disputed.event_variants).toBe(variants);
});

test('every interactive marker category enables and registers DOM gmp-click, and unmount detaches all markers', async () => {
  localStorage.setItem('vecto:map-layers', JSON.stringify({ incidents: true }));
  const view = render(<StrategyMap driverLat={41} driverLng={-87} timezone="America/Chicago"
    venues={[{ id: 'venue', name: 'Synthetic Venue', lat: 41.1, lng: -87.1 }]}
    bars={[{ name: 'Synthetic Bar', type: 'lounge', address: 'Synthetic address', expenseLevel: null, expenseRank: null,
      isOpen: true, closingSoon: false, minutesUntilClose: null, lat: 41.2, lng: -87.2 }]}
    events={[event]} incidents={[{ description: 'Synthetic incident', severity: 'high', category: 'Accident', road: 'Synthetic Road',
      location: 'Synthetic location', isHighway: false, delayMinutes: 3, lengthMiles: 1, distanceFromDriver: 2, incidentLat: 41.3, incidentLon: -87.3 }]} />);
  await waitFor(() => expect(markers.filter(marker => marker.map)).toHaveLength(5));
  const active = markers.filter(marker => marker.map);
  expect(active.find(marker => marker.title === 'Your Location').gmpClickable).toBe(false);
  for (const marker of active.filter(marker => marker.title !== 'Your Location')) {
    expect(marker.gmpClickable).toBe(true); expect(marker.domEvents).toEqual(['gmp-click']);
    setContent.mockClear(); marker.dispatchEvent(new Event('gmp-click'));
    expect(setContent).toHaveBeenCalledTimes(1);
  }
  view.unmount(); expect(active.every(marker => marker.map === null)).toBe(true);
});
