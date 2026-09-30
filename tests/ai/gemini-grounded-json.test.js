// Grounded JSON contract for the Google adapter.
// Verified live on 2026-09-29 (13 provider calls): with Google Search grounding enabled,
// a bare JSON response mime type (no schema) makes the pinned Briefer model return zero
// candidates after 30-75 s. Grounding without the mime type answers in about 5 s, and the
// adapter's own extraction turns the fenced answer into parseable JSON.
import { jest, test, expect, beforeEach, afterEach, describe } from '@jest/globals';

const requests = [];
let behavior;
jest.unstable_mockModule('@google/genai', () => ({ GoogleGenAI: class {
  constructor() { this.models = { generateContent: async params => { requests.push(params); return behavior(params); } }; }
} }));
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ aiLog: log, chainLog: jest.fn(), createWorkflowLogger: () => log, OP: {} }));

const { callGemini } = await import('../../server/lib/ai/adapters/gemini-adapter.js');
const { callModel } = await import('../../server/lib/ai/adapters/index.js');
const { MODEL_ROLES, roleUsesGoogleSearch, getProviderForModel } = await import('../../server/lib/ai/model-registry.js');

const answered = text => ({ text, candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] });
const originalKey = process.env.GEMINI_API_KEY;
let warn;
let error;
beforeEach(() => {
  requests.length = 0;
  process.env.GEMINI_API_KEY = 'synthetic-test-key';
  behavior = () => answered('{"holiday":"none","is_holiday":false}');
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  error = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
});

describe('request shape', () => {
  test('a grounded JSON request sends Google Search and no bare JSON mime type', async () => {
    const result = await callGemini({ model: 'synthetic-flash', system: 'Return ONLY JSON.', user: 'Synthetic question', maxTokens: 1024, useSearch: true });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].config.tools).toEqual([{ googleSearch: {} }]);
    expect(requests[0].config).not.toHaveProperty('responseMimeType');
  });

  test('an ungrounded JSON request still uses JSON mode', async () => {
    await callGemini({ model: 'synthetic-flash', system: 'Return ONLY JSON.', user: 'Synthetic question', maxTokens: 1024, useSearch: false });
    expect(requests[0].config.responseMimeType).toBe('application/json');
    expect(requests[0].config).not.toHaveProperty('tools');
  });

  test('a request that does not ask for JSON never sends JSON mode', async () => {
    behavior = () => answered('Plain prose answer.');
    await callGemini({ model: 'synthetic-flash', system: 'Answer briefly.', user: 'Synthetic question', maxTokens: 1024, useSearch: true });
    expect(requests[0].config).not.toHaveProperty('responseMimeType');
  });

  const groundedGoogleRoles = Object.entries(MODEL_ROLES)
    .filter(([role, config]) => getProviderForModel(config.model) === 'google' && roleUsesGoogleSearch(role))
    .map(([role]) => role);

  test('the registry has grounded Google roles to protect', () => {
    expect(groundedGoogleRoles).toEqual(expect.arrayContaining([
      'BRIEFING_TRAFFIC', 'BRIEFING_NEWS', 'BRIEFING_EVENTS_DISCOVERY', 'BRIEFING_SCHOOLS', 'BRIEFING_AIRPORT', 'BRIEFING_HOLIDAY',
    ]));
  });

  test.each(groundedGoogleRoles)('%s reaches the provider grounded and without a bare JSON mime type', async role => {
    const result = await callModel(role, { system: 'Return ONLY JSON.', user: 'Synthetic question. Respond in json.' });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].config.tools).toEqual([{ googleSearch: {} }]);
    expect(requests[0].config).not.toHaveProperty('responseMimeType');
  });
});

describe('grounded answers', () => {
  test('a fenced JSON answer is returned as parseable JSON', async () => {
    behavior = () => answered('```json\n{"holiday": "None", "is_holiday": false}\n```');
    const result = await callGemini({ model: 'synthetic-flash', system: 'Return ONLY JSON.', user: 'Synthetic question', maxTokens: 1024, useSearch: true });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.output)).toEqual({ holiday: 'None', is_holiday: false });
  });

  test('prose before a JSON answer is removed', async () => {
    behavior = () => answered('Here is the result\n[{"title":"Synthetic event"}]');
    const result = await callGemini({ model: 'synthetic-flash', system: 'Return ONLY JSON.', user: 'Synthetic question', maxTokens: 1024, useSearch: true });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.output)).toEqual([{ title: 'Synthetic event' }]);
  });
});

describe('empty responses fail loudly with a usable cause', () => {
  test('zero candidates is reported with counts and no upstream content', async () => {
    behavior = () => ({ text: '', candidates: [], usageMetadata: { promptTokenCount: 4540, thoughtsTokenCount: 4840, totalTokenCount: 9380 } });
    const result = await callGemini({ model: 'synthetic-flash', system: 'Return ONLY JSON.', user: 'Synthetic question', maxTokens: 1024, useSearch: true });
    expect(result.ok).toBe(false);
    expect(result.output).toBe('');
    expect(result.error).toMatch(/^Empty response from Gemini/);
    expect(result.error).toContain('candidates=0');
    expect(result.error).toContain('thoughtsTokens=4840');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('candidates=0'));
  });

  test('a finish reason and a block reason are kept in the cause', async () => {
    behavior = () => ({ text: '', candidates: [{ finishReason: 'SAFETY' }], promptFeedback: { blockReason: 'OTHER' } });
    const result = await callGemini({ model: 'synthetic-flash', system: 'Answer briefly.', user: 'Synthetic question', maxTokens: 1024 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('finishReason=SAFETY');
    expect(result.error).toContain('blockReason=OTHER');
    expect(result.error).toContain('candidates=1');
  });

  test('the role call still reports the stable empty-response code', async () => {
    behavior = () => ({ text: '', candidates: [] });
    const result = await callModel('BRIEFING_HOLIDAY', { system: 'Return ONLY JSON.', user: 'Synthetic question' });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain('empty-response');
  });
});
