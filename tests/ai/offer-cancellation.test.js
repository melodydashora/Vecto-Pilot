import { jest, test, expect, beforeEach, afterEach } from '@jest/globals';

const requests = [];
let behavior;
jest.unstable_mockModule('@google/genai', () => ({ GoogleGenAI: class {
  constructor() { this.models = { generateContent: async params => { requests.push(params); return behavior(params); } }; }
} }));
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ aiLog: log, chainLog: jest.fn(), createWorkflowLogger: () => log, OP: {} }));
const { callModel } = await import('../../server/lib/ai/adapters/index.js');
const originalKey = process.env.GEMINI_API_KEY;
beforeEach(() => { requests.length = 0; process.env.GEMINI_API_KEY = 'synthetic-test-key'; });
afterEach(() => { if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey; });

test('Analyzer deadline reaches the actual SDK and prevents later retry', async () => {
  const controller = new AbortController();
  let dispatched;
  const started = new Promise(resolve => { dispatched = resolve; });
  behavior = ({ config }) => new Promise((_, reject) => {
    config.abortSignal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
    dispatched();
  });
  const pending = callModel('OFFER_ANALYZER', { system: 'Return JSON.', user: 'Synthetic offer', signal: controller.signal });
  await started;
  expect(requests[0].config.abortSignal).toBeDefined();
  controller.abort();
  expect((await pending).ok).toBe(false);
  expect(requests[0].config.abortSignal.aborted).toBe(true);
  expect(requests).toHaveLength(1);
});

test('already expired work never dispatches an SDK request', async () => {
  const controller = new AbortController(); controller.abort();
  behavior = () => { throw new Error('must not dispatch'); };
  expect((await callModel('OFFER_ANALYZER', { system: 'JSON', user: 'Synthetic', signal: controller.signal })).ok).toBe(false);
  expect(requests).toHaveLength(0);
});

test('503 retry carries the same caller deadline and aborts its SDK request', async () => {
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
  const pending = callModel('OFFER_ANALYZER_DEEP', { system: 'JSON', user: 'Synthetic', signal: controller.signal });
  await started;
  controller.abort();
  expect((await pending).ok).toBe(false);
  expect(requests).toHaveLength(2);
  expect(requests[1].config.abortSignal.aborted).toBe(true);
});

test('an aborted unavailable result does not start a retry', async () => {
  const controller = new AbortController();
  behavior = () => { controller.abort(); throw new Error('503 UNAVAILABLE'); };
  expect((await callModel('OFFER_ANALYZER', { system: 'JSON', user: 'Synthetic', signal: controller.signal })).ok).toBe(false);
  expect(requests).toHaveLength(1);
});

test('SDK completion after cancellation cannot become a successful analysis', async () => {
  const controller = new AbortController();
  behavior = () => { controller.abort(); return { text: '{"decision":"ACCEPT"}' }; };
  const result = await callModel('OFFER_ANALYZER', { system: 'JSON', user: 'Synthetic', signal: controller.signal });
  expect(result.ok).toBe(false);
  expect(requests).toHaveLength(1);
});
