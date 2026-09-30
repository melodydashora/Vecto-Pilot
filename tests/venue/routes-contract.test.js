import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
const { getRouteMatrix, getRouteWithTraffic } = await import('../../server/lib/external/routes-api.js');
const originalFetch = global.fetch;
let origin;
let sequence = 1;
const destination = { lat: 2, lng: 2 };
const route = { distanceMeters: 1000, duration: '123.5s', staticDuration: '100s' };
const response = value => ({ ok: true, json: async () => value, text: async () => JSON.stringify(value) });
beforeEach(() => { origin = { lat: 1 + sequence++ / 100, lng: 1 }; process.env.GOOGLE_MAPS_API_KEY = 'mock-route-key'; global.fetch = jest.fn(); });
afterEach(() => { global.fetch = originalFetch; });

test.each([
  { originIndex: 0, destinationIndex: 0, status: {}, condition: 'ROUTE_NOT_FOUND' },
  { originIndex: 0, destinationIndex: 0, status: { code: 5 }, condition: 'ROUTE_EXISTS', distanceMeters: 1000, duration: '100s' },
])('failed matrix elements never become a zero-distance route: %j', async item => {
  global.fetch.mockResolvedValue(response([item]));
  const result = await getRouteMatrix([origin], [destination]);
  expect(result[0].routeAvailable).toBe(false); expect(result[0].distanceMeters).toBeNull(); expect(result[0].durationSeconds).toBeNull();
});
test('matrix preserves successful zero/decimal measurements and explicit condition', async () => {
  global.fetch.mockResolvedValue(response([{ originIndex: 0, destinationIndex: 0, status: {}, condition: 'ROUTE_EXISTS', distanceMeters: 0, duration: '0.5s' }]));
  const result = await getRouteMatrix([origin], [destination]);
  expect(result[0]).toMatchObject({ routeAvailable: true, distanceMeters: 0, durationSeconds: 0.5, condition: 'ROUTE_EXISTS' });
});
test.each([
  [[{ destinationIndex: 2, condition: 'ROUTE_EXISTS', distanceMeters: 1, duration: '1s' }]],
  [[{ destinationIndex: 0, condition: 'ROUTE_EXISTS', distanceMeters: 1, duration: '1s' }, { destinationIndex: 0, condition: 'ROUTE_EXISTS', distanceMeters: 1, duration: '1s' }]],
])('invalid or duplicate matrix indices fail instead of attaching the wrong venue: %j', async items => {
  global.fetch.mockResolvedValue(response(items));
  await expect(getRouteMatrix([origin], [destination])).rejects.toThrow(/index|duplicate/i);
});
test.each([{ distanceMeters: 12 }, { distanceMeters: -5, duration: '12s' }, { distanceMeters: 12, duration: 'oops' }])('incomplete single route is not usable: %j', async item => {
  global.fetch.mockResolvedValue(response({ routes: [item] }));
  await expect(getRouteWithTraffic(origin, destination)).rejects.toThrow(/invalid|missing/i);
});
test('concurrent identical requests share one provider operation', async () => {
  let finish;
  global.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const first = getRouteWithTraffic(origin, destination);
  const second = getRouteWithTraffic(origin, destination);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  finish(response({ routes: [route] }));
  await expect(first).resolves.toMatchObject({ durationSeconds: 123.5 });
  await expect(second).resolves.toMatchObject({ durationSeconds: 123.5 });
});
test('different departure times do not share a cached route', async () => {
  global.fetch.mockResolvedValue(response({ routes: [route] }));
  await getRouteWithTraffic(origin, destination, { departureTime: '2026-10-01T12:00:00Z' });
  await getRouteWithTraffic(origin, destination, { departureTime: '2026-10-01T18:00:00Z' });
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
test('invalid GPS never reaches Google', async () => {
  await expect(getRouteWithTraffic({ lat: 91, lng: 1 }, destination)).rejects.toThrow(/coordinates/i);
  expect(global.fetch).not.toHaveBeenCalled();
});
