// Actual role router and Gemini adapter; SDK transport is synthetic and cannot
// contact Google. Structured output is opt-in at the caller boundary.
import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';

const requests = [];
let answer;
jest.unstable_mockModule('@google/genai', () => ({ GoogleGenAI: class {
  constructor() { this.models = { generateContent: async params => { requests.push(params); return answer(params); } }; }
} }));
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ aiLog: log, chainLog: jest.fn(), createWorkflowLogger: () => log, OP: {} }));
const { callModel } = await import('../../server/lib/ai/adapters/index.js');
const { callGemini } = await import('../../server/lib/ai/adapters/gemini-adapter.js');
const { airportConditionsSchema, airportTerminalsSchema } = await import('../../server/lib/briefing/shared/airport-response-schema.js');

const schema = { type: 'object', properties: { airports: { type: 'array', items: {
  type: 'object', properties: { code: { type: 'string', enum: ['AAA'] } }, required: ['code'],
} } }, required: ['airports'] };
const params = { system: 'Return only JSON.', user: 'Research the synthetic airport.', responseJsonSchema: schema };
const answered = () => ({ text: '{"airports":[{"code":"AAA"}]}',
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"airports":[{"code":"AAA"}]}' }] } }] });
const originalKey = process.env.GEMINI_API_KEY;
beforeEach(() => {
  requests.length = 0; answer = answered; process.env.GEMINI_API_KEY = 'synthetic-structured-output-key';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
});

test('caller schema reaches the actual grounded Airport SDK request with JSON MIME', async () => {
  const before = JSON.stringify(schema);
  const result = await callModel('BRIEFING_AIRPORT', params);
  expect(result.ok).toBe(true); expect(requests).toHaveLength(1);
  expect(requests[0].config).toMatchObject({ tools: [{ googleSearch: {} }],
    responseMimeType: 'application/json', responseJsonSchema: schema });
  expect(JSON.stringify(schema)).toBe(before);
  expect(JSON.parse(result.output)).toEqual({ airports: [{ code: 'AAA' }] });
});

test('grounded callers without a schema preserve the legacy no-bare-MIME request', async () => {
  const { responseJsonSchema: _schema, ...legacy } = params;
  const result = await callModel('BRIEFING_AIRPORT', legacy);
  expect(result.ok).toBe(true); expect(requests).toHaveLength(1);
  expect(requests[0].config.tools).toEqual([{ googleSearch: {} }]);
  expect(requests[0].config).not.toHaveProperty('responseMimeType');
  expect(requests[0].config).not.toHaveProperty('responseJsonSchema');
});

test('the existing 503 retry preserves the same caller schema and grounding', async () => {
  answer = () => { if (requests.length === 1) throw new Error('503 UNAVAILABLE synthetic response'); return answered(); };
  const result = await callModel('BRIEFING_AIRPORT', params);
  expect(result).toMatchObject({ ok: true, provider: 'google-fallback' });
  expect(requests).toHaveLength(2); expect(requests[1].model).not.toBe(requests[0].model);
  for (const request of requests) expect(request.config).toMatchObject({ tools: [{ googleSearch: {} }],
    responseMimeType: 'application/json', responseJsonSchema: schema });
});

test.each(['not-a-schema', [], 7, true, null])('invalid explicit schema %j fails before an SDK request', async responseJsonSchema => {
  const result = await callModel('BRIEFING_AIRPORT', { ...params, responseJsonSchema });
  expect(result.ok).toBe(false); expect(requests).toHaveLength(0);
  expect(result.error).toEqual(expect.any(String));
  const direct = await callGemini({ model: 'gemini-3.8-flash', system: params.system, user: params.user,
    maxTokens: 1024, useSearch: true, responseJsonSchema });
  expect(direct.ok).toBe(false); expect(direct.error).toMatch(/responseJsonSchema/);
  expect(requests).toHaveLength(0);
});

test.each([
  ['conditions', airportConditionsSchema], ['terminals', airportTerminalsSchema],
])('the real %s phase schema reaches the SDK unchanged', async (phase, buildSchema) => {
  const responseJsonSchema = buildSchema(['AAA', 'BBB']);
  const body = phase === 'conditions'
    ? { airports: ['AAA', 'BBB'].map(code => ({ code, status: 'unreported', delays: 'unreported' })) }
    : { airports: ['AAA', 'BBB'].map(code => ({ code, busyTimes: [], terminals: [] })), busyPeriods: [], recommendations: 'unreported' };
  answer = () => ({ text: JSON.stringify(body),
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(body) }] } }] });
  const result = await callModel('BRIEFING_AIRPORT', { ...params, responseJsonSchema });
  expect(result.ok).toBe(true); expect(requests).toHaveLength(1);
  expect(requests[0].config).toMatchObject({ tools: [{ googleSearch: {} }],
    responseMimeType: 'application/json', responseJsonSchema });
});
