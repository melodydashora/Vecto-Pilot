import { test, expect } from '@jest/globals';
import { prioritizeBriefingEvents } from '../../server/lib/events/briefing-event-priority.js';

const snapshot = { lat: 0, lng: 0 };
const event = (title, impact, longitude) => ({ title, impact, latitude: 0, longitude });

test('nearby supported value precedes major market draws without changing saved evidence', () => {
  const source = [event('Far major draw', 'high', 1), event('Local medium draw', 'medium', 0.01),
    event('Local high draw', 'high', 0.1), event('Routine local event', 'low', 0.001),
    event('Far medium draw', 'medium', 1), event('Unknown crowd', null, 0.001)];
  const original = structuredClone(source);
  const result = prioritizeBriefingEvents(source, snapshot);
  expect(result.map(item => item.title)).toEqual(['Local high draw', 'Local medium draw', 'Far major draw']);
  expect(result.map(item => item.event_scope)).toEqual(['nearby', 'nearby', 'market']);
  expect(source).toEqual(original);
  expect(result[0].straight_line_distance_miles).toBeGreaterThan(6);
  expect(result[0].straight_line_distance_miles).toBeLessThan(7);
});

test('verified distance orders comparable draws and preserves full coordinate precision', () => {
  const precise = event('Precise venue', 'high', 0.012345678901234);
  const result = prioritizeBriefingEvents([event('Farther venue', 'high', 0.1), precise,
    event('At current location', 'high', 0)], snapshot);
  expect(result.map(item => item.title)).toEqual(['At current location', 'Precise venue', 'Farther venue']);
  expect(result[0].straight_line_distance_miles).toBe(0);
  expect(result[1].longitude).toBe(precise.longitude);
});

test('unknown distance is never called nearby and capacity/category cannot invent crowd impact', () => {
  const result = prioritizeBriefingEvents([
    { title: 'Known major draw', impact: 'high' },
    { title: 'Huge building', capacity_estimate: 100000, category: 'concert', latitude: 0, longitude: 0 },
    { title: 'Medium with no distance', impact: 'medium' },
  ], snapshot);
  expect(result).toEqual([{ title: 'Known major draw', impact: 'high', event_scope: 'market', straight_line_distance_miles: null }]);
});

test('priority does not merge distinct performances or modify conflicting schedule reports', () => {
  const source = [event('Same title', 'high', 0.1), event('Same title', 'high', 0.1)]
    .map((item, index) => ({ ...item, event_start_time: index ? '21:00' : '18:00',
      event_variants: [{ event_end_time: '20:00' }, { event_end_time: '20:30' }], event_end_conflict: true }));
  const result = prioritizeBriefingEvents(source, snapshot);
  expect(result).toHaveLength(2);
  expect(result[0].event_variants).toEqual(source[0].event_variants);
  expect(result[0].event_end_conflict).toBe(true);
});
