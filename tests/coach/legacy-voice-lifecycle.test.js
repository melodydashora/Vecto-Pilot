import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
let activeResponse;
const minted = jest.fn(async () => ({ token: 'synthetic-google-token' }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth: (req, _res, next) => { req.auth = { userId: 'owner' }; next(); } }));
jest.unstable_mockModule('../../server/middleware/require-snapshot-ownership.js', () => ({ verifySnapshotOwnership: async () => ({ ok: true }) }));
jest.unstable_mockModule('../../server/lib/ai/rideshare-coach-dal.js', () => ({ rideshareCoachDAL: { getCompleteContext: async () => null } }));
jest.unstable_mockModule('../../server/lib/ai/mouth-digest.js', () => ({ buildLearnedDigest: async () => null }));
jest.unstable_mockModule('../../server/lib/ai/adapters/gemini-live-adapter.js', () => ({ mintGeminiLiveToken: minted }));
const { default: realtime } = await import('../../server/api/chat/realtime.js');
const { default: gemini } = await import('../../server/api/chat/gemini-live.js');
const app = express(); app.use(express.json()); app.use((_req, res, next) => { activeResponse = res; next(); });
app.use('/realtime', realtime); app.use('/gemini', gemini);
beforeEach(() => {
  minted.mockReset().mockResolvedValue({ token: 'synthetic-google-token' });
  globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ value: 'synthetic-openai-token' }) }));
});
describe('Legacy Coach voice mint lifecycle', () => {
  test.each(['/realtime', '/gemini'])('%s authenticates context identity and marks credentials no-store', async route => {
    const result = await request(app).post(route + '/token').send({ userId: 'spoofed-owner' });
    expect(result.status).toBe(200);
    expect(result.body.context.user_id).toBe('owner');
    expect(result.headers['cache-control']).toBe('no-store');
  });
  test.each(['/realtime', '/gemini'])('%s refuses malformed identifiers before provider use', async route => {
    const result = await request(app).post(route + '/token').send({ snapshotId: {}, userId: 'owner' });
    expect(result.status).toBe(400); expect(globalThis.fetch).not.toHaveBeenCalled(); expect(minted).not.toHaveBeenCalled();
  });
  test('OpenAI missing credential in a successful response is an upstream failure', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    expect((await request(app).post('/realtime/token').send({ userId: 'owner' })).status).toBe(502);
  });
  test.each(['/realtime', '/gemini'])('%s forwards client disconnect to the mint request', async route => {
    let seen;
    if (route === '/realtime') globalThis.fetch.mockImplementation(async (_url, options) => {
      seen = options.signal; activeResponse.emit('close');
      return { ok: true, json: async () => ({ value: 'late-token' }) };
    });
    else minted.mockImplementation(async options => { seen = options.signal; activeResponse.emit('close'); return { token: 'late-token' }; });
    const result = await request(app).post(route + '/token').send({ userId: 'owner' });
    expect(seen?.aborted).toBe(true);
    expect(result.body).not.toHaveProperty('token');
  });
});
