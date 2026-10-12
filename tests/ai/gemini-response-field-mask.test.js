// Exercise the installed SDK's HTTP header construction, with all fetches mocked.
/* global process, global, Headers, Response, console */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { callGemini, callGeminiStream } from '../../server/lib/ai/adapters/gemini-adapter.js';

const originalKey = process.env.GEMINI_API_KEY;
let fetchMock;
let warnMock;
let errorMock;
beforeEach(() => {
  process.env.GEMINI_API_KEY = 'synthetic-test-key';
  fetchMock = jest.spyOn(global, 'fetch').mockImplementation(() => {
    throw new Error('Unexpected provider request blocked by test');
  });
  warnMock = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errorMock = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  fetchMock.mockRestore(); warnMock.mockRestore(); errorMock.mockRestore();
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

const request = { model: 'gemini-3.8-flash', system: 'Return JSON.', user: 'Synthetic public fixture.',
  thinkingLevel: 'HIGH', maxTokens: 8192, useSearch: true };
const response = data => new Response(JSON.stringify(data), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});
const expectedFields = ['candidates.content.parts.text', 'candidates.content.parts.thought',
  'candidates.finishReason', 'candidates.safetyRatings', 'candidates.groundingMetadata',
  'promptFeedback', 'usageMetadata', 'modelVersion'];
function assertOneShotMask() {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0];
  expect(String(url)).toContain('/models/gemini-3.8-flash:generateContent');
  const headers = new Headers(options.headers);
  expect(headers.get('X-Goog-FieldMask')?.split(',')).toEqual(expectedFields);
  const body = JSON.parse(options.body);
  expect(body).not.toHaveProperty('httpOptions');
  expect(body.generationConfig.thinkingConfig.thinkingLevel.toUpperCase()).toBe('HIGH');
  expect(body.generationConfig.maxOutputTokens).toBe(8192);
  expect(body.tools).toEqual([{ googleSearch: {} }]);
  expect(body.generationConfig).not.toHaveProperty('responseMimeType');
  return body;
}

test('one-shot SDK sends the mask while retaining HIGH thinking and visible JSON', async () => {
  fetchMock.mockResolvedValueOnce(response({ candidates: [{
    content: { parts: [{ text: 'Synthetic thought summary', thought: true }, { text: '{"complete":true}' }] },
    finishReason: 'STOP', safetyRatings: [], groundingMetadata: { groundingChunks: [] },
  }], usageMetadata: { thoughtsTokenCount: 12, candidatesTokenCount: 5 }, modelVersion: 'gemini-3.8-flash' }));
  expect(await callGemini(request)).toEqual({ ok: true, output: '{"complete":true}' });
  assertOneShotMask();
});

test('a masked SDK response still fails MAX_TOKENS even for complete-looking JSON', async () => {
  fetchMock.mockResolvedValueOnce(response({ candidates: [{
    content: { parts: [{ text: '[]' }] }, finishReason: 'MAX_TOKENS',
  }], usageMetadata: { thoughtsTokenCount: 8190, candidatesTokenCount: 2 } }));
  expect(await callGemini(request)).toMatchObject({ ok: false, output: '[]', truncated: true,
    error: expect.stringContaining('finishReason=MAX_TOKENS') });
  assertOneShotMask();
  expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('thoughtsTokens=8190'));
});

test('HTTP 400 remains a failed one-shot call with no retry', async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
    error: { code: 400, message: 'Synthetic invalid request', status: 'INVALID_ARGUMENT' },
  }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
  expect(await callGemini(request)).toMatchObject({ ok: false, output: '',
    error: expect.stringContaining('Synthetic invalid request') });
  assertOneShotMask();
});

test('streaming keeps thought signatures in history and does not set a response mask', async () => {
  const streamText = 'data: {"candidates":[{"content":{"parts":[{"text":"ok","thoughtSignature":"synthetic-next-signature"}]}}]}\n\n';
  fetchMock.mockResolvedValueOnce(new Response(streamText, { status: 200 }));
  const messageHistory = [
    { role: 'user', parts: [{ text: 'Earlier question' }] },
    { role: 'model', parts: [{ text: 'Earlier answer', thoughtSignature: 'synthetic-prior-signature' }] },
    { role: 'user', parts: [{ text: 'Follow-up question' }] },
  ];
  const result = await callGeminiStream({ ...request, messageHistory });
  expect(await result.text()).toBe(streamText);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0];
  expect(String(url)).toContain(':streamGenerateContent');
  expect(new Headers(options.headers).has('X-Goog-FieldMask')).toBe(false);
  const body = JSON.parse(options.body);
  expect(body.contents).toEqual(messageHistory);
  expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe('HIGH');
});
