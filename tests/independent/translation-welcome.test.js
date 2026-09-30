import { jest, expect, test, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
let activeResponse;
const model = jest.fn(); const gemini = jest.fn();
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel: model }));
jest.unstable_mockModule('../../server/lib/ai/adapters/gemini-adapter.js', () => ({ callGemini: gemini }));
jest.unstable_mockModule('../../server/middleware/rate-limit.js', () => ({ translationLimiter: (_req, _res, next) => next() }));
jest.unstable_mockModule('express-rate-limit', () => ({ default: () => (_req, _res, next) => next() }));
const { default: translation } = await import('../../server/api/hooks/translate.js');
const { default: welcome } = await import('../../server/api/welcome-ai/welcome-ai.js');
const app = express(); app.use(express.json()); app.use((_req, res, next) => { activeResponse = res; next(); }); app.use(translation); app.use(welcome);
beforeEach(() => { model.mockReset(); gemini.mockReset(); });
test.each(['{}', '[]', 'null', '{"translatedText":"   ","detectedLang":"en","targetLang":"es","confidence":95}'])('invalid translation shape cannot be spoken as success: %s', async text => {
  model.mockResolvedValue({ success: true, text });
  const result = await request(app).post('/translate').send({ text: 'Synthetic words', device_id: 'fixture-device' });
  expect(result.body.success).toBe(false); expect(result.body.voice).not.toContain('undefined');
});
test('zero confidence stays zero', async () => {
  model.mockResolvedValue({ success: true, text: '{"translatedText":"hola","detectedLang":"en","targetLang":"es","confidence":0}' });
  const result = await request(app).post('/translate').send({ text: 'hello', device_id: 'fixture-device', target_lang: 'es' });
  expect(result.body).toMatchObject({ success: true, confidence: 0 });
});
test.each(['/icebreaker', '/ask'])('%s cannot claim a blank answer succeeded', async path => {
  gemini.mockResolvedValue({ ok: true, output: '  ' });
  const result = await request(app).post(path).send({ question: 'Synthetic question' });
  expect(result.status).toBe(502); expect(result.body.ok).toBe(false);
});
test.each(['/translate', '/icebreaker', '/ask'])('%s forwards disconnect and suppresses late success', async path => {
  let signal;
  model.mockImplementation(async (_role, params) => { signal = params.signal; activeResponse.emit('close'); return { success: true, text: '{"translatedText":"hola","detectedLang":"en","targetLang":"es","confidence":95}' }; });
  gemini.mockImplementation(async params => { signal = params.signal; activeResponse.emit('close'); return { ok: true, output: 'A late synthetic answer' }; });
  const result = await request(app).post(path).send({ question: 'Question', text: 'Words', device_id: 'fixture-device' });
  expect(signal?.aborted).toBe(true); expect(result.body.success ?? result.body.ok).toBe(false);
});

test('translation in a different target language is not a successful reply', async () => {
  model.mockResolvedValue({ success: true, text: '{"translatedText":"hola","detectedLang":"en","targetLang":"es","confidence":90}' });
  const result = await request(app).post('/translate').send({ text: 'hello', device_id: 'fixture-device', target_lang: 'fr' });
  expect(result.body.success).toBe(false);
});
