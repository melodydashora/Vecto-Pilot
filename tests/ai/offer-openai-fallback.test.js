// Real role registry, dispatcher and sequential router; provider adapters are
// mocked so tonight's OpenAI text path and preserved Gemini image path reach no paid APIs.
import { jest, test, expect, beforeEach, afterEach } from '@jest/globals';

const callGemini = jest.fn();
const callOpenAI = jest.fn();
const callOpenAIWithWebSearch = jest.fn();
const unused = jest.fn(async () => { throw new Error('Unexpected provider dispatch'); });
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ aiLog: log, chainLog: jest.fn(), createWorkflowLogger: () => log, OP: {} }));
jest.unstable_mockModule('../../server/lib/ai/adapters/gemini-adapter.js', () => ({ callGemini, callGeminiStream: unused }));
jest.unstable_mockModule('../../server/lib/ai/adapters/openai-adapter.js', () => ({ callOpenAI, callOpenAIWithWebSearch }));
jest.unstable_mockModule('../../server/lib/ai/adapters/anthropic-adapter.js', () => ({ callAnthropic: unused, callAnthropicWithWebSearch: unused }));
jest.unstable_mockModule('../../server/lib/ai/adapters/vertex-adapter.js', () => ({
  callVertexAI: unused, callVertexAIStream: unused, isVertexAIAvailable: () => false, getVertexAIStatus: () => ({}),
}));
const { callModel } = await import('../../server/lib/ai/adapters/index.js');

const roles = [
  ['OFFER_ANALYZER', 'gemini-3.5-flash-lite', 1024],
  ['OFFER_ANALYZER_DEEP', 'gemini-3.1-pro-preview', 2048],
];
const payload = () => ({
  system: 'Return ONLY JSON using the supplied synthetic rules.',
  user: 'Synthetic OCR offer: pickup 2.1 miles at Fixture Pickup Road; dropoff 6.4 miles at Fixture Destination Avenue.',
});
const image = { mimeType: 'image/png', data: 'c3ludGhldGljLWltYWdl' };
const success = output => ({ ok: true, output });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
let errorLog;
beforeEach(() => {
  jest.clearAllMocks();
  callGemini.mockReset().mockResolvedValue(success('{"source":"vision"}'));
  callOpenAI.mockReset().mockResolvedValue(success('{"source":"text"}'));
  callOpenAIWithWebSearch.mockReset().mockResolvedValue(success('{"source":"search"}'));
  errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { errorLog.mockRestore(); jest.useRealTimers(); });

test.each(roles)('%s sends OCR directly to OpenAI with the original budget and no Google request', async (role, _visionModel, budget) => {
  const started = deferred();
  const primary = deferred();
  callOpenAI.mockImplementation(() => { started.resolve(); return primary.promise; });
  const request = payload();
  const result = callModel(role, request);
  await started.promise;
  expect(callGemini).not.toHaveBeenCalled();
  expect(callOpenAI).toHaveBeenCalledTimes(1);
  expect(callOpenAI).toHaveBeenCalledWith(expect.objectContaining({
    model: 'gpt-6-luna', role, system: request.system, user: request.user,
    maxTokens: budget, reasoningEffort: 'none', jsonMode: true, signal: expect.any(AbortSignal),
  }));
  primary.resolve({ ...success('{"source":"text"}'), model: 'gpt-6-luna-resolved' });
  await expect(result).resolves.toMatchObject({
    success: true, ok: true, text: '{"source":"text"}', output: '{"source":"text"}',
    provider: 'openai', model: 'gpt-6-luna-resolved',
  });
  expect(callOpenAI.mock.calls[0][0].images ?? []).toHaveLength(0);
  expect(callGemini).not.toHaveBeenCalled();
  expect(callOpenAIWithWebSearch).not.toHaveBeenCalled();
});

test.each(roles.flatMap(([role]) => ['429 quota', '503 UNAVAILABLE', '403 permission denied']
  .map(error => [role, error])))('%s OpenAI failure %s never dispatches Google or another OpenAI attempt', async (role, error) => {
  callOpenAI.mockResolvedValue({ ok: false, error: `${error} synthetic-provider-secret` });
  const result = await callModel(role, payload());
  expect(result).toMatchObject({ success: false, ok: false, text: null });
  expect(result.error).toContain('openai:');
  expect(result.error).not.toContain('synthetic-provider-secret');
  expect(callOpenAI).toHaveBeenCalledTimes(1);
  expect(callGemini).not.toHaveBeenCalled();
  expect(callOpenAIWithWebSearch).not.toHaveBeenCalled();
});

test.each(roles.flatMap(([role, model, budget]) => [false, true]
  .map(hasText => [role, model, budget, hasText])))('%s preserves every image with %s, %s tokens, OCR=%s', async (role, model, budget, hasText) => {
  const request = { ...payload(), user: hasText ? payload().user : 'Analyze the supplied screenshot.', images: [image] };
  const result = await callModel(role, request);
  expect(callGemini).toHaveBeenCalledTimes(1);
  expect(callGemini).toHaveBeenCalledWith(expect.objectContaining({
    model, maxTokens: budget, images: [image], user: request.user,
    temperature: role === 'OFFER_ANALYZER' ? 0.1 : 0.2,
    thinkingLevel: role === 'OFFER_ANALYZER' ? 'MINIMAL' : 'LOW',
  }));
  expect(result).toMatchObject({ ok: true, provider: 'google', model });
  expect(callOpenAI).not.toHaveBeenCalled(); expect(callOpenAIWithWebSearch).not.toHaveBeenCalled();
  // Selecting a vision configuration must not mutate the next text request.
  const textResult = await callModel(role, payload());
  expect(callGemini).toHaveBeenCalledTimes(1);
  expect(callOpenAI).toHaveBeenCalledTimes(1);
  expect(textResult).toMatchObject({ ok: true, provider: 'openai', model: 'gpt-6-luna' });
});

test.each(roles)('%s failed image-bearing input never drops images into the text-only OpenAI path', async role => {
  callGemini.mockResolvedValue({ ok: false, error: '429 quota' });
  const result = await callModel(role, { ...payload(), images: [image] });
  expect(result.ok).toBe(false);
  expect(callGemini).toHaveBeenCalledTimes(1);
  expect(callGemini).toHaveBeenCalledWith(expect.objectContaining({ images: [image] }));
  expect(callOpenAI).not.toHaveBeenCalled(); expect(callOpenAIWithWebSearch).not.toHaveBeenCalled();
});

test.each(roles)('%s lowercase calls retain the canonical Offer Analyzer adapter contract', async (role, _primary, budget) => {
  const result = await callModel(role.toLowerCase(), payload());
  expect(callOpenAI).toHaveBeenCalledTimes(1);
  // The adapter uses this role to require complete answers, disable storage and
  // SDK retries, and reject dummy credentials for Offer Analyzer.
  expect(callOpenAI).toHaveBeenCalledWith(expect.objectContaining({
    role, model: 'gpt-6-luna', maxTokens: budget, reasoningEffort: 'none',
    jsonMode: true, signal: expect.any(AbortSignal),
  }));
  expect(result).toMatchObject({ ok: true, provider: 'openai', model: 'gpt-6-luna' });
  expect(callGemini).not.toHaveBeenCalled();
});

test.each(roles)('%s image-bearing 503 retains the existing Gemini vision retry', async role => {
  callGemini.mockResolvedValueOnce({ ok: false, error: '503 UNAVAILABLE' }).mockResolvedValueOnce(success('{"source":"vision-retry"}'));
  const result = await callModel(role, { ...payload(), images: [image] });
  expect(callGemini).toHaveBeenCalledTimes(2);
  expect(callGemini.mock.calls[1][0]).toMatchObject({ model: 'gemini-3.5-flash', images: [image] });
  expect(callOpenAI).not.toHaveBeenCalled(); expect(callOpenAIWithWebSearch).not.toHaveBeenCalled();
  expect(result).toMatchObject({ ok: true, provider: 'google-fallback', model: 'gemini-3.5-flash' });
});

test.each(roles)('%s never dispatches either provider after caller cancellation', async role => {
  const controller = new AbortController(); controller.abort();
  const result = await callModel(role, { ...payload(), signal: controller.signal });
  expect(result.ok).toBe(false);
  expect(callGemini).not.toHaveBeenCalled(); expect(callOpenAI).not.toHaveBeenCalled();
});

test.each(roles)('%s abort during vision analysis prevents Gemini retry and OpenAI dispatch', async role => {
  const controller = new AbortController();
  const started = deferred();
  callGemini.mockImplementation(({ signal }) => new Promise(resolve => {
    started.resolve(signal);
    signal.addEventListener('abort', () => resolve({ ok: false, error: '503 UNAVAILABLE after abort' }), { once: true });
  }));
  const pending = callModel(role, { ...payload(), images: [image], signal: controller.signal });
  const signal = await started.promise;
  controller.abort();
  expect((await pending).ok).toBe(false); expect(signal.aborted).toBe(true);
  expect(callGemini).toHaveBeenCalledTimes(1); expect(callOpenAI).not.toHaveBeenCalled();
});

test.each(roles)('%s OpenAI text analysis remains inside the original caller deadline', async role => {
  const controller = new AbortController();
  const started = deferred();
  callOpenAI.mockImplementation(({ signal }) => new Promise(resolve => {
    started.resolve(signal);
    signal.addEventListener('abort', () => resolve({ ok: false, error: 'request aborted' }), { once: true });
  }));
  const pending = callModel(role, { ...payload(), signal: controller.signal });
  const signal = await started.promise;
  expect(signal).toBeInstanceOf(AbortSignal);
  controller.abort();
  expect((await pending).ok).toBe(false); expect(signal.aborted).toBe(true);
  expect(callGemini).not.toHaveBeenCalled(); expect(callOpenAI).toHaveBeenCalledTimes(1);
});

test('unrelated Briefing keeps its existing Gemini 503 retry and never dispatches OpenAI', async () => {
  callGemini.mockResolvedValueOnce({ ok: false, error: '503 UNAVAILABLE' }).mockResolvedValueOnce(success('{"source":"legacy-retry"}'));
  const result = await callModel('BRIEFING_TRAFFIC', payload());
  expect(callGemini).toHaveBeenCalledTimes(2);
  expect(callGemini.mock.calls[1][0]).toMatchObject({ model: 'gemini-3.5-flash', useSearch: true });
  expect(callOpenAI).not.toHaveBeenCalled(); expect(callOpenAIWithWebSearch).not.toHaveBeenCalled();
  expect(result).toMatchObject({ ok: true, model: 'gemini-3.5-flash', provider: 'google-fallback' });
});

test('unrelated Strategy cross-provider fallback retains its existing search model budget', async () => {
  callGemini.mockResolvedValue({ ok: false, error: '429 quota' });
  const result = await callModel('STRATEGY_CONTEXT', payload());
  expect(callOpenAI).not.toHaveBeenCalled();
  expect(callOpenAIWithWebSearch).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.5-2026-04-23', maxTokens: 8192, reasoningEffort: 'low' }));
  expect(result).toMatchObject({ ok: true, provider: 'openai' });
});
