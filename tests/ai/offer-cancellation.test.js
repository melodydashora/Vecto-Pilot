import { jest, test, expect, beforeEach, afterEach } from '@jest/globals';

const requests = [];
const openAIRequests = [];
let behavior;
let openAIBehavior;
jest.unstable_mockModule('@google/genai', () => ({ GoogleGenAI: class {
  constructor() { this.models = { generateContent: async params => { requests.push(params); return behavior(params); } }; }
} }));
jest.unstable_mockModule('openai', () => ({ default: class {
  constructor() {
    this.chat = { completions: { create: async (body, options) => {
      openAIRequests.push({ body, options });
      return openAIBehavior(body, options);
    } } };
  }
} }));
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ aiLog: log, chainLog: jest.fn(), createWorkflowLogger: () => log, OP: {} }));
const { callModel } = await import('../../server/lib/ai/adapters/index.js');
const originalKey = process.env.GEMINI_API_KEY;
const originalOpenAIKey = process.env.OPENAI_API_KEY;
const roles = ['OFFER_ANALYZER', 'OFFER_ANALYZER_DEEP'];
const images = [{ mimeType: 'image/png', data: 'c3ludGhldGljLWltYWdl' }];
let errorLog;
beforeEach(() => {
  requests.length = 0; openAIRequests.length = 0;
  process.env.GEMINI_API_KEY = 'synthetic-test-key';
  process.env.OPENAI_API_KEY = 'synthetic-openai-test-key';
  behavior = () => { throw new Error('Unexpected Gemini SDK dispatch'); };
  openAIBehavior = () => { throw new Error('Unexpected OpenAI SDK dispatch'); };
  errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorLog.mockRestore();
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
  if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalOpenAIKey;
});

test.each(roles)('%s text deadline reaches the OpenAI SDK without a Gemini attempt or retry', async role => {
  const controller = new AbortController();
  let dispatched;
  const started = new Promise(resolve => { dispatched = resolve; });
  openAIBehavior = (_body, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
    dispatched();
  });
  const pending = callModel(role, { system: 'Return JSON.', user: 'Synthetic OCR with addresses and distances', signal: controller.signal });
  await started;
  expect(openAIRequests[0].options.signal).toBeDefined();
  controller.abort();
  expect((await pending).ok).toBe(false);
  expect(openAIRequests[0].options.signal.aborted).toBe(true);
  expect(openAIRequests[0].options.maxRetries).toBe(0);
  expect(openAIRequests[0].body.model).toBe('gpt-6-luna');
  expect(openAIRequests).toHaveLength(1);
  expect(requests).toHaveLength(0);
});

test.each(roles.flatMap(role => [[role, 'text'], [role, 'vision']]))('already expired %s %s work never dispatches an SDK request', async (role, mode) => {
  const controller = new AbortController(); controller.abort();
  expect((await callModel(role, { system: 'JSON', user: 'Synthetic', signal: controller.signal,
    ...(mode === 'vision' ? { images } : {}) })).ok).toBe(false);
  expect(requests).toHaveLength(0);
  expect(openAIRequests).toHaveLength(0);
});

test.each(roles)('%s image deadline still reaches the Gemini SDK without an OpenAI attempt', async role => {
  const controller = new AbortController();
  let dispatched;
  const started = new Promise(resolve => { dispatched = resolve; });
  behavior = ({ config }) => new Promise((_, reject) => {
    config.abortSignal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
    dispatched();
  });
  const pending = callModel(role, { system: 'JSON', user: 'Synthetic screenshot', images, signal: controller.signal });
  await started;
  controller.abort();
  expect((await pending).ok).toBe(false);
  expect(requests).toHaveLength(1);
  expect(requests[0].config.abortSignal.aborted).toBe(true);
  expect(openAIRequests).toHaveLength(0);
});

test.each([
  ['BRIEFING_TRAFFIC', {}],
  ...roles.map(role => [role, { images }]),
])('%s Gemini 503 retry still carries the caller deadline to the SDK', async (role, input) => {
  const controller = new AbortController();
  let retried;
  const started = new Promise(resolve => { retried = resolve; });
  behavior = ({ config }) => {
    if (requests.length === 1) throw new Error('503 UNAVAILABLE');
    return new Promise((_, reject) => {
      config.abortSignal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
      retried();
    });
  };
  const pending = callModel(role, { system: 'JSON', user: 'Synthetic', ...input, signal: controller.signal });
  await started;
  controller.abort();
  expect((await pending).ok).toBe(false);
  expect(requests).toHaveLength(2);
  expect(requests[1].config.abortSignal.aborted).toBe(true);
  expect(openAIRequests).toHaveLength(0);
});

test.each(['text', 'vision'])('an aborted unavailable %s result does not start a retry', async mode => {
  const controller = new AbortController();
  behavior = () => { controller.abort(); throw new Error('503 UNAVAILABLE'); };
  openAIBehavior = () => { controller.abort(); throw Object.assign(new Error('Unavailable'), { status: 503 }); };
  expect((await callModel('OFFER_ANALYZER', { system: 'JSON', user: 'Synthetic', signal: controller.signal,
    ...(mode === 'vision' ? { images } : {}) })).ok).toBe(false);
  expect(requests).toHaveLength(mode === 'vision' ? 1 : 0);
  expect(openAIRequests).toHaveLength(mode === 'text' ? 1 : 0);
});

test.each(['text', 'vision'])('%s SDK completion after cancellation cannot become a successful analysis', async mode => {
  const controller = new AbortController();
  behavior = () => { controller.abort(); return { text: '{"decision":"ACCEPT"}' }; };
  openAIBehavior = () => {
    controller.abort();
    return { choices: [{ finish_reason: 'stop', message: { content: '{"decision":"ACCEPT"}' } }] };
  };
  const result = await callModel('OFFER_ANALYZER', { system: 'JSON', user: 'Synthetic', signal: controller.signal,
    ...(mode === 'vision' ? { images } : {}) });
  expect(result.ok).toBe(false);
  expect(requests).toHaveLength(mode === 'vision' ? 1 : 0);
  expect(openAIRequests).toHaveLength(mode === 'text' ? 1 : 0);
});
