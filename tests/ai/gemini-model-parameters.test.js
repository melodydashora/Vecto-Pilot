// Request contracts for the model-specific thinking and sampling policy.
// Provider support was checked against Google documentation and live synthetic
// requests on 2026-10-11; these tests make no provider requests.
/* global process, global, Response, console, AbortController */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const sdkRequests = [];
let sdkConstructions = 0;
let sdkBehavior;
jest.unstable_mockModule('@google/genai', () => ({ GoogleGenAI: class {
  constructor() {
    sdkConstructions += 1;
    this.models = { generateContent: async request => {
      sdkRequests.push(request);
      return sdkBehavior(request);
    } };
  }
} }));
const { callGemini, callGeminiStream } = await import('../../server/lib/ai/adapters/gemini-adapter.js');

const originalKey = process.env.GEMINI_API_KEY;
let fetchMock;
let errorMock;
beforeEach(() => {
  process.env.GEMINI_API_KEY = 'synthetic-test-key';
  sdkRequests.length = 0;
  sdkConstructions = 0;
  sdkBehavior = () => ({ text: '{"complete":true}', candidates: [{ finishReason: 'STOP' }] });
  fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('data: {}\n\n', { status: 200 }));
  errorMock = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  fetchMock.mockRestore();
  errorMock.mockRestore();
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

const commonRequest = {
  system: 'Return JSON.', user: 'A synthetic request.',
  messageHistory: [{ role: 'user', parts: [{ text: 'A synthetic request.' }] }],
  maxTokens: 1024, temperature: 0.1, topP: 0.8, topK: 12, useSearch: false,
};
const transports = [
  {
    name: 'SDK',
    invoke: options => callGemini({ ...commonRequest, ...options }),
    config: () => sdkRequests[0].config,
    assertSuccess: result => expect(result).toEqual({ ok: true, output: '{"complete":true}' }),
    assertFailure: async (pending, message) => {
      expect(await pending).toEqual({ ok: false, output: '', error: expect.stringContaining(message) });
    },
    expectedLevel: level => level.toLowerCase(),
  },
  {
    name: 'REST stream',
    invoke: options => callGeminiStream({ ...commonRequest, ...options }),
    config: () => JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig,
    assertSuccess: result => expect(result.status).toBe(200),
    assertFailure: async (pending, message) => { await expect(pending).rejects.toThrow(message); },
    expectedLevel: level => level.toUpperCase(),
  },
];

for (const transport of transports) {
  describe(transport.name, () => {
    const supportedLevels = [
      ['gemini-3.6-flash', ['minimal', 'LOW', 'medium', 'HIGH']],
      ['gemini-3.8-flash', ['low', 'MEDIUM', 'high']],
      ['gemini-3.5-flash-lite', ['MINIMAL', 'low', 'MEDIUM', 'high']],
    ].flatMap(([model, levels]) => levels.map(level => [model, level]));
    test.each(supportedLevels)('%s sends supported %s thinking without sampling controls', async (model, thinkingLevel) => {
      transport.assertSuccess(await transport.invoke({ model, thinkingLevel }));
      expect(transport.config()).toMatchObject({
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingLevel: transport.expectedLevel(thinkingLevel) },
      });
      for (const key of ['temperature', 'topP', 'topK']) expect(transport.config()).not.toHaveProperty(key);
      expect(transport.config().thinkingConfig).not.toHaveProperty('thinkingBudget');
    });

    test.each([
      ['gemini-3.5-flash', 'MINIMAL'], // Google's deprecated ID now routes to 3.6 Flash.
      ['gemini-3.7-flash', 'HIGH'], // Google's deprecated ID now routes to 3.8 Flash.
    ])('%s also omits ignored sampling controls', async (model, thinkingLevel) => {
      transport.assertSuccess(await transport.invoke({ model, thinkingLevel }));
      for (const key of ['temperature', 'topP', 'topK']) expect(transport.config()).not.toHaveProperty(key);
      expect(transport.config().thinkingConfig.thinkingLevel).toBe(transport.expectedLevel(thinkingLevel));
    });

    test.each([
      ['gemini-3.8-flash', 'MINIMAL'],
      ['gemini-3.7-flash', 'minimal'],
      ['gemini-3-pro-preview', 'MEDIUM'],
      ['gemini-3.6-flash', 'EXTREME'],
      ['gemini-3.6-flash', ''],
      ['gemini-3.6-flash', false],
      ['gemini-3.6-flash', 0],
    ])('%s rejects unsupported thinking %s before a provider request', async (model, thinkingLevel) => {
      await transport.assertFailure(transport.invoke({ model, thinkingLevel }), 'is not supported');
      expect(sdkConstructions).toBe(0);
      expect(sdkRequests).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('an unverified model fails explicit thinking configuration', async () => {
      await transport.assertFailure(transport.invoke({ model: 'gemini-unverified-flash', thinkingLevel: 'LOW' }), 'No verified thinkingLevel policy');
      expect(sdkConstructions).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('null thinking lets the provider select its default', async () => {
      transport.assertSuccess(await transport.invoke({ model: 'gemini-3.8-flash', thinkingLevel: null }));
      expect(transport.config()).not.toHaveProperty('thinkingConfig');
    });

    test('3.1 Pro accepts MEDIUM while retaining its sampling parameters', async () => {
      transport.assertSuccess(await transport.invoke({ model: 'gemini-3.1-pro-preview', thinkingLevel: 'MEDIUM' }));
      expect(transport.config()).toMatchObject({
        temperature: 0.1,
        thinkingConfig: { thinkingLevel: transport.expectedLevel('MEDIUM') },
      });
      expect(transport.config()).toHaveProperty('topP');
      expect(transport.config()).toHaveProperty('topK');
    });

    test('an explicit zero temperature is retained on a model supporting sampling', async () => {
      transport.assertSuccess(await transport.invoke({ model: 'gemini-3.1-pro-preview', thinkingLevel: 'LOW', temperature: 0 }));
      expect(transport.config().temperature).toBe(0);
    });
  });
}

test('the SDK retains JSON temperature capping on Pro and caller sampling settings', async () => {
  await callGemini({ ...commonRequest, model: 'gemini-3.1-pro-preview', temperature: 0.9, thinkingLevel: 'LOW' });
  expect(sdkRequests[0].config).toMatchObject({ temperature: 0.2, topP: 0.8, topK: 12, responseMimeType: 'application/json' });
});

test('the existing SDK and streaming defaults remain provider-default and HIGH respectively', async () => {
  await callGemini({ ...commonRequest, model: 'gemini-3.8-flash' });
  expect(sdkRequests[0].config).not.toHaveProperty('thinkingConfig');
  await callGeminiStream({ ...commonRequest, model: 'gemini-3.8-flash' });
  const config = JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig;
  expect(config.thinkingConfig).toEqual({ thinkingLevel: 'HIGH' });
});

test('caller cancellation still reaches the SDK on a newly configured model', async () => {
  const controller = new AbortController();
  sdkBehavior = async ({ config }) => {
    expect(config.abortSignal).toBe(controller.signal);
    controller.abort(new Error('Synthetic caller canceled'));
    return { text: '{"complete":true}' };
  };
  const result = await callGemini({ ...commonRequest, model: 'gemini-3.8-flash', thinkingLevel: 'HIGH', signal: controller.signal });
  expect(result).toMatchObject({ ok: false, output: '', error: 'Synthetic caller canceled' });
  expect(sdkRequests).toHaveLength(1);
});

test('caller cancellation still aborts the streaming fetch', async () => {
  const controller = new AbortController();
  fetchMock.mockImplementationOnce(async (_url, options) => {
    controller.abort(new Error('Synthetic caller canceled'));
    options.signal.throwIfAborted();
  });
  await expect(callGeminiStream({ ...commonRequest, model: 'gemini-3.8-flash', thinkingLevel: 'HIGH', signal: controller.signal })).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});

test('provider errors still fail without substituting another model or retrying', async () => {
  sdkBehavior = () => { throw new Error('Synthetic provider rejection'); };
  expect(await callGemini({ ...commonRequest, model: 'gemini-3.8-flash', thinkingLevel: 'HIGH' }))
    .toMatchObject({ ok: false, error: 'Synthetic provider rejection' });
  expect(sdkRequests).toHaveLength(1);

  fetchMock.mockResolvedValueOnce(new Response('Synthetic provider rejection', { status: 400 }));
  await expect(callGeminiStream({ ...commonRequest, model: 'gemini-3.8-flash', thinkingLevel: 'HIGH' }))
    .rejects.toThrow('Gemini API error 400');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
