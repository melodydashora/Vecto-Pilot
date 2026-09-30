const { AbortController } = globalThis;
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import process from 'node:process';
let constructorFails = false;
const create = jest.fn(async () => ({ name: 'synthetic-ephemeral-token' }));
const constructed = jest.fn();
jest.unstable_mockModule('@google/genai', () => ({ GoogleGenAI: class {
  constructor(options) { constructed(options); if (constructorFails) throw new Error('synthetic constructor failure'); }
  authTokens = { create };
} }));
const { mintGeminiLiveToken } = await import('../../server/lib/ai/adapters/gemini-live-adapter.js');
const original = Object.fromEntries(['GOOGLE_API_KEY', 'GEMINI_API_KEY'].map(key => [key, process.env[key]]));
beforeEach(() => { constructorFails = false; create.mockClear(); constructed.mockClear(); process.env.GOOGLE_API_KEY = 'synthetic-maps'; process.env.GEMINI_API_KEY = 'synthetic-gemini'; });
afterEach(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
describe('Gemini voice mint SDK boundary', () => {
  test('constructor failure restores the other Google service key', async () => {
    constructorFails = true;
    await expect(mintGeminiLiveToken({ model: 'synthetic-live-model' })).rejects.toThrow('synthetic constructor failure');
    expect(process.env.GOOGLE_API_KEY).toBe('synthetic-maps');
    expect(create).not.toHaveBeenCalled();
  });
  test('the SDK receives the transport signal and the existing model constraint', async () => {
    const controller = new AbortController();
    await mintGeminiLiveToken({ model: 'synthetic-live-model', signal: controller.signal });
    expect(create).toHaveBeenCalledWith({ config: expect.objectContaining({ abortSignal: controller.signal, liveConnectConstraints: { model: 'synthetic-live-model' }, uses: 1 }) });
  });
  test('an ended request cannot construct a provider or mint a credential', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(mintGeminiLiveToken({ model: 'synthetic-live-model', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(constructed).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
});
