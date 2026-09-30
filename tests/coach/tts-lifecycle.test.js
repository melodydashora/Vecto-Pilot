import { jest, describe, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
const { Buffer } = globalThis;
let activeResponse;
const synthesize = jest.fn(async (_body, options) => {
  activeResponse?.emit('close');
  expect(options?.signal?.aborted).toBe(true);
  return { arrayBuffer: async () => Buffer.from('synthetic-audio') };
});
jest.unstable_mockModule('openai', () => ({ default: class { audio = { speech: { create: synthesize } }; } }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth: (_req, _res, next) => next() }));
const { default: router } = await import('../../server/api/chat/tts.js');
const app = express(); app.use(express.json());
app.use((_req, res, next) => { activeResponse = res; next(); }); app.use('/tts', router);
describe('TTS provider cancellation', () => {
  test('route disconnect reaches the SDK request and prevents late audio delivery', async () => {
    const result = await request(app).post('/tts').send({ text: 'Synthetic voice text' });
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(synthesize.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(result.headers['content-type']).not.toContain('audio/mpeg');
  });
});
