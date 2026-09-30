import { jest, test, beforeEach, expect } from '@jest/globals';
const discovery = jest.fn(), traffic = jest.fn(), combined = jest.fn();
jest.unstable_mockModule('../../server/lib/venue/venue-intelligence.js', () => ({ discoverNearbyVenues: discovery, getTrafficIntelligence: traffic, getSmartBlocksIntelligence: combined }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth: (_req, _res, next) => next() }));
const { default: router } = await import('../../server/api/venue/venue-intelligence.js');
const query = { lat: '1', lng: '2', city: 'City', state: 'AB', timezone: 'Asia/Tokyo' };
async function invoke(path, extra) { let status = 200, body; const res = { status: value => { status = value; return res; }, json: value => { body = value; } }; await router.stack.find(layer => layer.route?.path === path).route.stack.at(-1).handle({ query: { ...query, ...extra } }, res); return { status, body }; }
beforeEach(() => { jest.clearAllMocks(); discovery.mockResolvedValue({ venues: [], last_call_venues: [] }); combined.mockResolvedValue({ venues: {} }); traffic.mockResolvedValue({}); });
test.each(['/nearby', '/traffic', '/smart-blocks', '/last-call'])('%s rejects invalid/ranged GPS before provider work', async path => {
 for (const lat of ['1garbage', '91', '', 'Infinity']) expect((await invoke(path, { lat })).status).toBe(400);
 expect(discovery).not.toHaveBeenCalled(); expect(traffic).not.toHaveBeenCalled(); expect(combined).not.toHaveBeenCalled();
});
test.each(['0', '-1', 'bad', '25miles'])('invalid radius %s is rejected, never replaced with25', async radius => {
 expect((await invoke('/nearby', { radius })).status).toBe(400); expect(discovery).not.toHaveBeenCalled();
});
test.each(['/smart-blocks', '/last-call'])('%s forwards valid timezone to its independent pipeline', async path => {
 expect((await invoke(path, {})).status).toBe(200);
 expect((path === '/last-call' ? discovery : combined).mock.calls[0][0].timezone).toBe('Asia/Tokyo');
});
test('provider discovery failure is an error response', async () => { discovery.mockRejectedValue(new Error('Fixture outage')); expect((await invoke('/nearby', {})).status).toBe(503); });
