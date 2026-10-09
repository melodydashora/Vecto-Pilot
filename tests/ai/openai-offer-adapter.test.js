import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';

const create = jest.fn();
const logged = jest.fn();
jest.unstable_mockModule('openai', () => ({ default: class {
  constructor() { this.chat = { completions: { create } }; }
} }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({
  aiLog: { phase: logged, done: logged, error: logged }, chainLog: logged, OP: {}
}));

const { callOpenAI } = await import('../../server/lib/ai/adapters/openai-adapter.js');
const originalKey = process.env.OPENAI_API_KEY;
const originalLogLevel = process.env.LOG_LEVEL;
const offerRequest = {
  role: 'OFFER_ANALYZER', model: 'gpt-6-test', system: 'Return JSON for this offer.',
  user: 'OCR: $12.50, 4.2 miles. Pickup: 123 Example St. Dropoff: 456 Sample Ave.',
  maxTokens: 1024, temperature: 0.1, reasoningEffort: 'none', jsonMode: true
};
const completed = (overrides = {}) => ({
  model: 'gpt-6-test-resolved',
  choices: [{ finish_reason: 'stop', message: { content: '{"decision":"REJECT"}' } }],
  ...overrides
});

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'synthetic-test-key';
  process.env.LOG_LEVEL = 'debug';
  create.mockReset().mockResolvedValue(completed());
  logged.mockClear();
});
afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalLogLevel;
});

test('OCR, distance, and addresses reach Chat Completions unchanged with JSON mode and actual model provenance', async () => {
  const result = await callOpenAI(offerRequest);
  expect(create).toHaveBeenCalledWith({
    model: 'gpt-6-test',
    messages: [
      { role: 'system', content: offerRequest.system },
      { role: 'user', content: offerRequest.user }
    ],
    max_completion_tokens: 1024, reasoning_effort: 'none', response_format: { type: 'json_object' }, store: false
  }, { maxRetries: 0 });
  expect(result).toEqual({ ok: true, output: '{"decision":"REJECT"}', model: 'gpt-6-test-resolved' });
  expect(logged).toHaveBeenCalledWith({ parent: 'HOOKS', sub: 'OFFER_ANALYZER', callTypes: ['AI'] }, 'request (1024 tokens)');
  expect(JSON.stringify(logged.mock.calls)).not.toContain('123 Example St');
});

test('explicit messages and legacy text request parameters are preserved', async () => {
  const messages = Object.freeze([
    Object.freeze({ role: 'system', content: 'Existing system instruction' }),
    Object.freeze({ role: 'user', content: 'Existing message' })
  ]);
  create.mockResolvedValue({ choices: [{ message: { content: ' legacy answer ' } }] });
  const result = await callOpenAI({ model: 'gpt-4-test', messages, maxTokens: 50, temperature: 0.2 });
  expect(create).toHaveBeenCalledWith({ model: 'gpt-4-test', messages, max_tokens: 50, temperature: 0.2 });
  expect(result).toMatchObject({ ok: true, output: 'legacy answer' });
});

test.each(['OFFER_ANALYZER', 'OFFER_ANALYZER_DEEP'])('%s disables SDK retries and forwards cancellation', async role => {
  const controller = new AbortController();
  let dispatched;
  const started = new Promise(resolve => { dispatched = resolve; });
  create.mockImplementation((_body, options) => new Promise((_resolve, reject) => {
    dispatched();
    expect(options).toEqual({ signal: controller.signal, maxRetries: 0 });
    options.signal.addEventListener('abort', () => reject(new Error('transport secret response')), { once: true });
  }));
  const pending = callOpenAI({ ...offerRequest, role, signal: controller.signal });
  await started;
  controller.abort();
  expect(await pending).toEqual({ ok: false, output: '', error: 'OpenAI request cancelled' });
  expect(create).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(logged.mock.calls)).not.toContain('transport secret response');
});

test('already cancelled work never reaches the SDK', async () => {
  const controller = new AbortController();
  controller.abort(new Error('private abort reason'));
  expect((await callOpenAI({ ...offerRequest, signal: controller.signal })).ok).toBe(false);
  expect(create).not.toHaveBeenCalled();
  expect(JSON.stringify(logged.mock.calls)).not.toContain('private abort reason');
});

test('a transport that completes after cancellation cannot publish its result', async () => {
  const controller = new AbortController();
  create.mockImplementation(async () => {
    controller.abort();
    return completed({ choices: [{ finish_reason: 'stop', message: { content: '{"decision":"ACCEPT"}' } }] });
  });
  expect(await callOpenAI({ ...offerRequest, signal: controller.signal })).toEqual({
    ok: false, output: '', error: 'OpenAI request cancelled'
  });
  expect(JSON.stringify(logged.mock.calls)).not.toContain('response (');
});

test.each(['length', 'content_filter', 'tool_calls', 'function_call', undefined])('Offer Analyzer rejects finish reason %s', async finishReason => {
  create.mockResolvedValue(completed({ choices: [{ finish_reason: finishReason, message: { content: '{"decision":"ACCEPT"}' } }] }));
  const result = await callOpenAI(offerRequest);
  expect(result.ok).toBe(false);
  if (finishReason === 'length') expect(result.truncated).toBe(true);
  expect(JSON.stringify(logged.mock.calls)).not.toContain('response (');
});

test.each([
  { refusal: 'private refusal text' },
  { tool_calls: [{ id: 'tool-private', type: 'function', function: { name: 'tool', arguments: '{}' } }] },
  { function_call: { name: 'tool-private', arguments: '{}' } }
])('non-answer message fields cannot become a successful analysis', async messageFields => {
  create.mockResolvedValue(completed({ choices: [{ finish_reason: 'stop', message: { content: '{"decision":"ACCEPT"}', ...messageFields } }] }));
  const result = await callOpenAI(offerRequest);
  expect(result.ok).toBe(false);
  expect(result.output).toBe('');
  expect(JSON.stringify(logged.mock.calls)).not.toContain('private');
});

test('provider failures report only safe HTTP status without raw payload or OCR', async () => {
  create.mockRejectedValue(Object.assign(new Error('https://provider.test?key=secret OCR 123 Example St'), { status: 403 }));
  const result = await callOpenAI(offerRequest);
  expect(result).toEqual({ ok: false, output: '', error: 'OpenAI provider returned HTTP 403' });
  expect(JSON.stringify(logged.mock.calls)).not.toMatch(/secret|123 Example St|provider\.test/);
});

test('Offer Analyzer cannot use dummy fixtures even after a real client was cached', async () => {
  await callOpenAI(offerRequest);
  create.mockClear();
  process.env.OPENAI_API_KEY = 'sk-dummy-test';
  expect((await callOpenAI(offerRequest)).ok).toBe(false);
  expect(create).not.toHaveBeenCalled();
  expect(JSON.stringify(logged.mock.calls)).not.toContain('ACCEPT');
});

test('unrelated dummy fixtures stay local even after a real client was cached', async () => {
  await callOpenAI(offerRequest);
  create.mockClear();
  process.env.OPENAI_API_KEY = 'sk-dummy-test';
  process.env.LOG_LEVEL = 'info';
  const result = await callOpenAI({ model: 'gpt-4-test', user: 'Fixture only', maxTokens: 100 });
  expect(result.ok).toBe(true);
  expect(JSON.parse(result.output).decision).toBe('ACCEPT');
  expect(create).not.toHaveBeenCalled();
});
