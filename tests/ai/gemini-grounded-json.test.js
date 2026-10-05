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
const realTimers = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
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
  jest.useRealTimers();
  Object.assign(global, realTimers);
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

  test('Events reserves headroom for HIGH thinking and a complete grounded result', async () => {
    behavior = () => answered('[{"title":"Synthetic complete event"}]');
    const result = await callModel('BRIEFING_EVENTS_DISCOVERY', { system: 'Return only JSON.', user: 'Find verified events.' });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ model: 'gemini-3.8-flash', config: {
      maxOutputTokens: 32768, thinkingConfig: { thinkingLevel: 'high' }, tools: [{ googleSearch: {} }],
    } });
    expect(requests[0].config).not.toHaveProperty('responseMimeType');
    expect(JSON.parse(result.output)).toEqual([{ title: 'Synthetic complete event' }]);
  });
});

describe('Events gets its own three-minute router budget', () => {
  test('actual role/router accepts a complete Events answer after the former two-minute limit', async () => {
    jest.useFakeTimers();
    let providerSignal;
    behavior = params => new Promise((resolve, reject) => {
      providerSignal = params.config.abortSignal;
      const timer = setTimeout(() => resolve(answered('[{"title":"Complete synthetic event"}]')), 150000);
      providerSignal.addEventListener('abort', () => {
        clearTimeout(timer); reject(providerSignal.reason);
      }, { once: true });
    });
    const pending = callModel('BRIEFING_EVENTS_DISCOVERY', { system: 'Return JSON.', user: 'Find events.' });
    await jest.advanceTimersByTimeAsync(120000);
    expect(providerSignal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(30000);
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.output)).toEqual([{ title: 'Complete synthetic event' }]);
    expect(requests).toHaveLength(1); expect(jest.getTimerCount()).toBe(0);
  });

  test.each([['BRIEFING_EVENTS_DISCOVERY', 180000], ['BRIEFING_HOLIDAY', 120000]])(
    '%s aborts its SDK request at its own %ims limit', async (role, deadline) => {
      jest.useFakeTimers();
      let providerSignal;
      behavior = params => new Promise((_resolve, reject) => {
        providerSignal = params.config.abortSignal;
        providerSignal.addEventListener('abort', () => reject(providerSignal.reason), { once: true });
      });
      const pending = callModel(role, { system: 'Return JSON.', user: 'Find current data.' });
      await jest.advanceTimersByTimeAsync(deadline - 1);
      expect(providerSignal?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      const result = await pending;
      expect(providerSignal.aborted).toBe(true);
      expect(result).toMatchObject({ ok: false, text: null });
      expect(result.error).toContain('google:timeout');
      expect(requests).toHaveLength(1); expect(jest.getTimerCount()).toBe(0);
    }
  );

  test('caller cancellation still interrupts Events before its extended deadline', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    let providerSignal;
    behavior = params => new Promise((_resolve, reject) => {
      providerSignal = params.config.abortSignal;
      providerSignal.addEventListener('abort', () => reject(providerSignal.reason), { once: true });
    });
    const pending = callModel('BRIEFING_EVENTS_DISCOVERY', { system: 'Return JSON.', user: 'Find events.', signal: controller.signal });
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();
    expect((await pending).ok).toBe(false);
    expect(providerSignal.aborted).toBe(true);
    expect(requests).toHaveLength(1); expect(jest.getTimerCount()).toBe(0);
  });
});

describe('truncated responses remain failures with content-free diagnostics', () => {
  test('adapter records only numeric usage and rejects a partial MAX_TOKENS response', async () => {
    const partial = '[{"title":"PRIVATE_SYNTHETIC_EVENT';
    behavior = () => ({ text: partial, candidates: [{ finishReason: 'MAX_TOKENS' }],
      usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 768, thoughtsTokenCount: 32000,
        totalTokenCount: 34268, privateDebug: 'PRIVATE_SYNTHETIC_USAGE' } });
    const result = await callGemini({ model: 'gemini-3.8-flash', system: 'Return JSON.', user: 'Find events.',
      maxTokens: 32768, thinkingLevel: 'HIGH', useSearch: true });
    expect(result).toMatchObject({ ok: false, truncated: true, output: partial });
    const diagnostic = warn.mock.calls.flat().join(' ');
    for (const value of ['finishReason=MAX_TOKENS', 'max_tokens=32768', 'promptTokens=1500',
      'outputTokens=768', 'thoughtsTokens=32000', 'totalTokens=34268']) expect(diagnostic).toContain(value);
    expect(diagnostic).not.toContain('PRIVATE_SYNTHETIC');
  });

  test('missing or malformed usage is not logged as zero or upstream text', async () => {
    behavior = () => ({ text: '', candidates: [{ finishReason: 'MAX_TOKENS' }],
      usageMetadata: { promptTokenCount: 'PRIVATE_SYNTHETIC_USAGE', candidatesTokenCount: -1,
        thoughtsTokenCount: 0, totalTokenCount: Infinity } });
    const result = await callGemini({ model: 'gemini-3.8-flash', system: 'Return JSON.', user: 'Find events.', maxTokens: 32768 });
    expect(result.ok).toBe(false);
    const diagnostic = warn.mock.calls.flat().join(' ');
    expect(diagnostic).toContain('thoughtsTokens=0');
    for (const value of ['promptTokens=', 'outputTokens=', 'totalTokens=', 'PRIVATE_SYNTHETIC']) {
      expect(diagnostic).not.toContain(value);
    }
  });

  test.each(['[{"title":"PRIVATE_SYNTHETIC_EVENT', '[]'])('actual role/router rejects MAX_TOKENS even for JSON-shaped text: %s', async output => {
    behavior = () => ({ text: output, candidates: [{ finishReason: 'MAX_TOKENS' }],
      usageMetadata: { candidatesTokenCount: 768, thoughtsTokenCount: 32000 } });
    const result = await callModel('BRIEFING_EVENTS_DISCOVERY', { system: 'Return JSON.', user: 'Find events.' });
    expect(result).toMatchObject({ ok: false, success: false, text: null });
    expect(result.error).toContain('google:truncated');
    expect(result).not.toHaveProperty('output');
    expect(requests).toHaveLength(1);
    expect(JSON.stringify([...warn.mock.calls, ...error.mock.calls])).not.toContain('PRIVATE_SYNTHETIC_EVENT');
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
