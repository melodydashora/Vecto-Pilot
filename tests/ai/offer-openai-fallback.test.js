// Real role registry, dispatcher and sequential router; provider adapters are
// mocked to verify Gemini text/image routing without paid API calls.
import { jest, test, expect, beforeEach, afterEach } from '@jest/globals';
const { console, AbortController, AbortSignal } = globalThis;

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

const roles = [['OFFER_ANALYZER', 1024], ['OFFER_ANALYZER_DEEP', 2048]];
const payload = () => ({ system: 'Return ONLY JSON using the supplied synthetic rules.',
  user: 'Synthetic OCR offer: pickup 2.1 miles at Fixture Pickup Road; dropoff 6.4 miles at Fixture Destination Avenue.' });
const image = { mimeType: 'image/png', data: 'c3ludGhldGljLWltYWdl' };
const success = output => ({ ok: true, output });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
let errorLog;
beforeEach(() => {
  jest.clearAllMocks();
  callGemini.mockReset().mockResolvedValue(success('{"source":"gemini"}'));
  callOpenAI.mockReset().mockResolvedValue(success('{"source":"text"}'));
  callOpenAIWithWebSearch.mockReset().mockResolvedValue(success('{"source":"search"}'));
  errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { errorLog.mockRestore(); });

test.each(roles.flatMap(([role, budget]) => ['text', 'image', 'mixed'].map(mode => [role, budget, mode])))('%s routes %s tokens / %s input to Gemini 3.8 LOW', async (role, budget, mode) => {
  const request = { ...payload(), ...(mode !== 'text' && { images: [image] }), ...(mode === 'image' && { user: 'Analyze the supplied screenshot.' }) };
  const result = await callModel(role, request);
  expect(callGemini).toHaveBeenCalledTimes(1);
  expect(callGemini).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.8-flash', maxTokens: budget, thinkingLevel: 'LOW',
    system: request.system, user: request.user, images: request.images, signal: expect.any(AbortSignal) }));
  expect(callGemini.mock.calls[0][0].temperature).toBeUndefined();
  expect(result).toMatchObject({ ok: true, provider: 'google', model: 'gemini-3.8-flash' });
  expect(callOpenAI).not.toHaveBeenCalled(); expect(callOpenAIWithWebSearch).not.toHaveBeenCalled();
});

test.each(roles.flatMap(([role]) => ['429 quota', '400 invalid argument', '403 permission denied', 'truncated at max_tokens=1024 (finishReason=MAX_TOKENS)']
  .map(error => [role, error])))('%s failure %s stays failed with no cross-provider fallback', async (role, error) => {
  callGemini.mockResolvedValue({ ok: false, error: `${error} synthetic-provider-secret` });
  const result = await callModel(role, payload());
  expect(result).toMatchObject({ success: false, ok: false, text: null });
  expect(result.error).not.toContain('synthetic-provider-secret');
  expect(callGemini).toHaveBeenCalledTimes(1);
  expect(callOpenAI).not.toHaveBeenCalled(); expect(callOpenAIWithWebSearch).not.toHaveBeenCalled();
});

test.each(roles)('%s lower-case role resolves the same text/image contract without mutation', async (role, budget) => {
  await callModel(role.toLowerCase(), { ...payload(), images: [image] });
  await callModel(role, payload());
  expect(callGemini).toHaveBeenCalledTimes(2);
  expect(callGemini.mock.calls[0][0]).toMatchObject({ model: 'gemini-3.8-flash', images: [image], maxTokens: budget, thinkingLevel: 'LOW' });
  expect(callGemini.mock.calls[1][0]).toMatchObject({ model: 'gemini-3.8-flash', maxTokens: budget, thinkingLevel: 'LOW' });
  expect(callGemini.mock.calls[1][0].images).toBeUndefined(); expect(callOpenAI).not.toHaveBeenCalled();
});

test.each(roles.flatMap(([role]) => ['text', 'image'].map(mode => [role, mode])))('%s %s 503 fails without another model or provider attempt', async (role, mode) => {
  callGemini.mockResolvedValueOnce({ ok: false, error: '503 UNAVAILABLE' });
  const result = await callModel(role, { ...payload(), ...(mode === 'image' && { images: [image] }) });
  expect(callGemini).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ ok: false, success: false, text: null });
  expect(callOpenAI).not.toHaveBeenCalled(); expect(callOpenAIWithWebSearch).not.toHaveBeenCalled();
});

test.each(roles)('%s never dispatches after caller cancellation', async role => {
  const controller = new AbortController(); controller.abort();
  expect((await callModel(role, { ...payload(), signal: controller.signal })).ok).toBe(false);
  expect(callGemini).not.toHaveBeenCalled(); expect(callOpenAI).not.toHaveBeenCalled();
});

test.each(roles.flatMap(([role]) => ['text', 'image'].map(mode => [role, mode])))('%s %s cancellation reaches adapter and prevents a retry', async (role, mode) => {
  const controller = new AbortController(), started = deferred();
  callGemini.mockImplementation(({ signal }) => new Promise(resolve => {
    started.resolve(signal);
    signal.addEventListener('abort', () => resolve({ ok: false, error: '503 UNAVAILABLE after abort' }), { once: true });
  }));
  const pending = callModel(role, { ...payload(), ...(mode === 'image' && { images: [image] }), signal: controller.signal });
  const signal = await started.promise; controller.abort();
  expect((await pending).ok).toBe(false); expect(signal.aborted).toBe(true);
  expect(callGemini).toHaveBeenCalledTimes(1); expect(callOpenAI).not.toHaveBeenCalled();
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
