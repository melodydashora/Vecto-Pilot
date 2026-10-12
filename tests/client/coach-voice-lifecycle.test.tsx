import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { act, renderHook, cleanup } from '@testing-library/react';
import type { VoiceSessionOptions } from '@/lib/voice/types';
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });

// Keep the real SSE/receipt implementation available for integration cases;
// only provider audio sessions are synthetic. No request leaves this fixture.
const { askCoachBrain: realCoachBrain } = await import('@/lib/voice/coachBrain');
const { STORAGE_KEYS } = await import('@/constants/storageKeys');
const { API_ROUTES } = await import('@/constants/apiRoutes');
const originalFetch = globalThis.fetch;
const rulesReceipt = {
  version: 8, hash: 'synthetic-rules-hash', changed: true,
  changes: [{ path: 'decision.min_score', label: 'Minimum score', before: 60, after: 70 }],
};
function streamResponse() {
  type Chunk = { value?: Uint8Array; done: boolean };
  const queue: Chunk[] = [];
  let resolveRead: ((value: Chunk) => void) | undefined;
  const push = (chunk: Chunk) => {
    if (resolveRead) { const resolve = resolveRead; resolveRead = undefined; resolve(chunk); }
    else queue.push(chunk);
  };
  return {
    response: { ok: true, body: { getReader: () => ({
      read: () => queue.length ? Promise.resolve(queue.shift()!) : new Promise<Chunk>(resolve => { resolveRead = resolve; }),
      cancel: async () => { push({ done: true }); }, releaseLock: () => {},
    }) } } as unknown as Response,
    event: (payload: object) => push({ done: false, value: new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`) }),
    end: () => push({ done: true }),
  };
}

const sessions: FakeSession[] = [];
class FakeSession {
  readonly mode = 'gpt-live';
  opts: VoiceSessionOptions;
  rejectStart!: (error: Error) => void;
  private resolveStart!: () => void;
  start = jest.fn(() => {
    this.opts.events.onStatus('connecting');
    return new Promise<void>((resolve, reject) => { this.resolveStart = resolve; this.rejectStart = reject; });
  });
  stop = jest.fn(() => this.opts.events.onStatus('ended'));
  pauseMic = jest.fn();
  resumeMic = jest.fn();
  constructor(opts: VoiceSessionOptions) { this.opts = opts; sessions.push(this); }
  connected() { this.opts.events.onStatus('live'); this.resolveStart(); }
}
const brain = jest.fn<(...args: any[]) => Promise<string>>(async () => 'Verified answer');
jest.unstable_mockModule('@/lib/voice/GptLiveSession', () => ({ GptLiveSession: FakeSession }));
jest.unstable_mockModule('@/lib/voice/GeminiLiveSession', () => ({ GeminiLiveSession: FakeSession }));
jest.unstable_mockModule('@/lib/voice/RealtimeSession', () => ({ RealtimeSession: FakeSession }));
jest.unstable_mockModule('@/lib/voice/coachBrain', () => ({ askCoachBrain: brain }));
const { useVoiceSession } = await import('@/hooks/coach/useVoiceSession');
let recognizers: any[];
beforeEach(() => {
  sessions.length = 0; recognizers = []; brain.mockReset().mockResolvedValue('Verified answer'); localStorage.clear();
  Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: class {
    onend?: () => void;
    start = jest.fn();
    stop = jest.fn(() => this.onend?.());
    constructor() { recognizers.push(this); }
  } });
  global.fetch = jest.fn<typeof fetch>(async () => ({ ok: true }) as Response);
});
afterEach(() => { cleanup(); delete (window as any).SpeechRecognition; globalThis.fetch = originalFetch; });

describe('Coach hook owns every voice resource for its session', () => {
  test('a completed first answer cannot expire the fresh-context continuation while GPS is being captured', async () => {
    jest.useFakeTimers();
    const first = streamResponse(); const second = streamResponse();
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    let finishCapture!: (id: string) => void;
    const onRefreshCoachSnapshot = jest.fn(() => new Promise<string>(resolve => { finishCapture = resolve; }));
    try {
      const request = realCoachBrain({ userId: 'fixture-driver', onRefreshCoachSnapshot }, 'Use my location');
      await jest.advanceTimersByTimeAsync(170000);
      first.event({ done: true, response_text: 'Requesting current context.', actions_result: {
        saved: 0, coach_snapshot_refresh: { requested: true, reason: 'Current location needed' },
      } }); first.end();
      await jest.advanceTimersByTimeAsync(0);
      expect(onRefreshCoachSnapshot).toHaveBeenCalledTimes(1);
      // This crosses the first provider request's old 180-second deadline.
      await jest.advanceTimersByTimeAsync(20000);
      finishCapture('coach-refreshed');
      await jest.advanceTimersByTimeAsync(0);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(jest.mocked(globalThis.fetch).mock.calls[1][1]?.signal?.aborted).toBe(false);
      second.event({ done: true, response_text: 'Guidance from the new observation.' }); second.end();
      expect(await request).toContain('new observation');
    } finally { jest.useRealTimers(); }
  });

  test('voice automatically completes a location-dependent question after one capture and cannot loop or replay actions', async () => {
    const first = streamResponse(); const second = streamResponse();
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    brain.mockImplementation(realCoachBrain);
    const onRefreshCoachSnapshot = jest.fn(async () => 'coach-new');
    const onOfferRulesSaved = jest.fn(); const onVoiceTurnFinal = jest.fn();
    const { result } = renderHook(() => useVoiceSession({ userId: 'fixture-driver', snapshotId: 'saved-guidance',
      coachSnapshotId: 'coach-old', onRefreshCoachSnapshot, onOfferRulesSaved, onVoiceTurnFinal }));
    let connecting!: Promise<void>;
    act(() => { connecting = result.current.start(); });
    await act(async () => { sessions[0].connected(); await connecting; });
    let request!: Promise<string>;
    act(() => { request = sessions[0].opts.askCoachBrain('Where should I go around the accident?'); });
    await act(async () => {
      first.event({ done: true, conversation_id: result.current.conversationIdRef.current, response_text: 'Checking current location.',
        actions_result: { saved: 0, coach_snapshot_refresh: { requested: true, reason: 'Current incident guidance' } } });
      first.end();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(onRefreshCoachSnapshot).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(jest.mocked(globalThis.fetch).mock.calls[1][1]?.body))).toMatchObject({
      snapshotId: 'saved-guidance', coachSnapshotId: 'coach-new', source: 'voice', answerOnly: true,
      conversationId: result.current.conversationIdRef.current,
    });
    let answer = '';
    await act(async () => {
      second.event({ done: true, response_text: 'Advice using the refreshed observation.', actions_result: {
        saved: 1, offer_rules: rulesReceipt, coach_snapshot_refresh: { requested: true, reason: 'Must not loop' },
      } }); second.end(); answer = await request;
    });
    expect(answer).toContain('refreshed observation');
    expect(onVoiceTurnFinal).toHaveBeenCalledWith('assistant', expect.stringContaining('refreshed observation'));
    expect(onRefreshCoachSnapshot).toHaveBeenCalledTimes(1);
    expect(onOfferRulesSaved).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(sessions).toHaveLength(1);
  });

  test('voice refresh keeps its live conversation and the next brain request uses the new Coach observation', async () => {
    const first = streamResponse(); const second = streamResponse();
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    brain.mockImplementation(realCoachBrain);
    const events: string[] = [];
    const onRefreshCoachSnapshot = jest.fn(() => { events.push('refresh'); });
    const onVoiceTurnFinal = jest.fn(() => { events.push('answer'); });
    const { result, rerender } = renderHook(({ coachSnapshotId }) => useVoiceSession({
      userId: 'fixture-driver', snapshotId: 'saved-guidance', coachSnapshotId, onRefreshCoachSnapshot, onVoiceTurnFinal,
    }), { initialProps: { coachSnapshotId: 'coach-one' } });
    let connecting!: Promise<void>;
    act(() => { connecting = result.current.start(); });
    await act(async () => { sessions[0].connected(); await connecting; });
    const conversationId = result.current.conversationIdRef.current;
    let request!: Promise<string>;
    act(() => { request = sessions[0].opts.askCoachBrain('I moved. Check my location.'); });
    const done = { done: true, response_text: 'Requesting a fresh observation.', actions_result: {
      saved: 0, coach_snapshot_refresh: { requested: true, reason: 'Location changed' },
    } };
    await act(async () => { first.event(done); first.event(done); });
    expect(onRefreshCoachSnapshot).not.toHaveBeenCalled();
    await act(async () => { first.end(); await request; });
    expect(events).toEqual(['answer', 'refresh']);
    rerender({ coachSnapshotId: 'coach-two' });
    expect(result.current.conversationIdRef.current).toBe(conversationId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].stop).not.toHaveBeenCalled();
    act(() => { request = sessions[0].opts.askCoachBrain('Where now?'); });
    await act(async () => { second.event({ done: true, response_text: 'Current location guidance.' }); second.end(); await request; });
    const calls = jest.mocked(globalThis.fetch).mock.calls;
    expect(JSON.parse(String(calls[0][1]?.body))).toMatchObject({ snapshotId: 'saved-guidance', coachSnapshotId: 'coach-one', conversationId });
    expect(JSON.parse(String(calls[1][1]?.body))).toMatchObject({ snapshotId: 'saved-guidance', coachSnapshotId: 'coach-two', conversationId });
    expect(onRefreshCoachSnapshot).toHaveBeenCalledTimes(1);
  });

  test('the real voice brain publishes the confirmed answer before one settings callback', async () => {
    const stream = streamResponse();
    globalThis.fetch = jest.fn<typeof fetch>(async input => {
      if (String(input) !== API_ROUTES.CHAT.SEND) throw new Error('Unexpected voice fixture request');
      return stream.response;
    });
    brain.mockImplementationOnce(realCoachBrain);
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'fixture-token');
    const events: string[] = [];
    let stopAfterSave = () => {};
    const onVoiceTurnFinal = jest.fn((_role: string, text: string) => { events.push('answer'); expect(text).toContain('Minimum score: 60 → 70'); });
    const onOfferRulesSaved = jest.fn(() => { events.push('saved'); stopAfterSave(); });
    const { result } = renderHook(() => useVoiceSession({ userId: 'fixture-driver', snapshotId: 'fixture-snapshot', onVoiceTurnFinal, onOfferRulesSaved }));
    stopAfterSave = () => result.current.stop();
    let connecting!: Promise<void>;
    act(() => { connecting = result.current.start(); });
    await act(async () => { sessions[0].connected(); await connecting; });
    let request!: Promise<string>;
    act(() => { request = sessions[0].opts.askCoachBrain('Raise my minimum score'); });
    const completion = request.then(value => ({ value, error: null }), error => ({ value: null, error }));
    await act(async () => { stream.event({ delta: 'I saved everything.' }); });
    expect(onVoiceTurnFinal).not.toHaveBeenCalled();
    expect(onOfferRulesSaved).not.toHaveBeenCalled();
    const done = { done: true, response_text: 'Ready for the next offer.', actions_result: { saved: 1, offer_rules: rulesReceipt } };
    await act(async () => { stream.event(done); stream.event(done); });
    expect(onOfferRulesSaved).not.toHaveBeenCalled();
    await act(async () => { stream.end(); await completion; });
    expect(events).toEqual(['answer', 'saved']);
    expect(onOfferRulesSaved).toHaveBeenCalledTimes(1);
    expect(onOfferRulesSaved).toHaveBeenCalledWith(rulesReceipt);
    expect(onVoiceTurnFinal).toHaveBeenCalledWith('assistant', expect.stringContaining('Offer Analyzer settings saved.'));
    expect((await completion).error).toMatchObject({ name: 'AbortError' });
    expect((await completion).value).toBeNull(); // ended audio cannot receive the old answer
    expect(result.current.status).toBe('idle');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, options] = (globalThis.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0];
    expect((options!.headers as Record<string, string>).Authorization).toBe('Bearer fixture-token');
    expect(JSON.parse(options!.body as string)).toMatchObject({ source: 'voice', snapshotId: 'fixture-snapshot' });
  });

  test.each(['no-change', 'error', 'unfinished'] as const)('real voice %s completion cannot claim a saved-settings callback', async outcome => {
    const stream = streamResponse();
    globalThis.fetch = jest.fn<typeof fetch>(async () => stream.response);
    brain.mockImplementationOnce(realCoachBrain);
    const onOfferRulesSaved = jest.fn();
    const { result } = renderHook(() => useVoiceSession({ userId: 'fixture-driver', onOfferRulesSaved }));
    let connecting!: Promise<void>;
    act(() => { connecting = result.current.start(); });
    await act(async () => { sessions[0].connected(); await connecting; });
    let request!: Promise<string>;
    act(() => { request = sessions[0].opts.askCoachBrain('Check my saved settings'); });
    await act(async () => {
      stream.event({ ...(outcome === 'unfinished' ? { delta: 'Saved.' } : { done: true }),
        ...(outcome === 'error' ? { error: true } : {}), response_text: 'Settings checked.',
        actions_result: { saved: 0, offer_rules: { ...rulesReceipt, changed: outcome !== 'no-change' } } });
      stream.end();
      await request;
    });
    expect(onOfferRulesSaved).not.toHaveBeenCalled();
  });

  test.each(['account', 'token', 'stop'] as const)('a late voice settings receipt is suppressed after %s replacement', async scope => {
    const stream = streamResponse();
    globalThis.fetch = jest.fn<typeof fetch>(async () => stream.response);
    brain.mockImplementationOnce(realCoachBrain);
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'old-fixture-token');
    const oldSaved = jest.fn(); const newSaved = jest.fn(); const onVoiceTurnFinal = jest.fn();
    const onRefreshCoachSnapshot = jest.fn();
    const { result, rerender } = renderHook(({ userId, onOfferRulesSaved }) => useVoiceSession({ userId, onOfferRulesSaved, onVoiceTurnFinal, onRefreshCoachSnapshot }),
      { initialProps: { userId: 'old-driver', onOfferRulesSaved: oldSaved } });
    let connecting!: Promise<void>;
    act(() => { connecting = result.current.start(); });
    await act(async () => { sessions[0].connected(); await connecting; });
    let request!: Promise<string>;
    act(() => { request = sessions[0].opts.askCoachBrain('Old account settings request'); });
    const completion = request.then(value => ({ value, error: null }), error => ({ value: null, error }));
    await act(async () => { await Promise.resolve(); });
    if (scope === 'stop') act(() => result.current.stop());
    else {
      localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'new-fixture-token');
      if (scope === 'account') rerender({ userId: 'new-driver', onOfferRulesSaved: newSaved });
    }
    await act(async () => {
      stream.event({ done: true, response_text: 'Old settings saved.', actions_result: { saved: 1, offer_rules: rulesReceipt,
        coach_snapshot_refresh: { requested: true, reason: 'Old session moved' } } });
      stream.end();
      await completion;
    });
    expect(oldSaved).not.toHaveBeenCalled();
    expect(newSaved).not.toHaveBeenCalled();
    expect(onVoiceTurnFinal).not.toHaveBeenCalled();
    expect(onRefreshCoachSnapshot).not.toHaveBeenCalled();
    expect((await completion).error).toMatchObject({ name: 'AbortError' });
  });

  test('provider disconnect while paused stops the wake listener and aborts its brain request', async () => {
    const { result } = renderHook(() => useVoiceSession({ userId: 'fixture-driver' }));
    let connecting!: Promise<void>;
    act(() => { connecting = result.current.start(); });
    await act(async () => { sessions[0].connected(); await connecting; });
    act(() => result.current.pauseMic());
    expect(recognizers[0].start).toHaveBeenCalledTimes(1);
    let finish!: (text: string) => void;
    brain.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let request!: Promise<string>;
    act(() => { request = sessions[0].opts.askCoachBrain('A synthetic question'); });
    const completion = request.then(value => ({ value, error: null }), error => ({ value: null, error }));
    const signal = brain.mock.calls[0][0].signal;
    act(() => sessions[0].opts.events.onStatus('ended'));
    expect(signal.aborted).toBe(true);
    expect(recognizers[0].stop).toHaveBeenCalledTimes(1);
    expect(recognizers[0].start).toHaveBeenCalledTimes(1);
    expect(result.current.micPaused).toBe(false);
    await act(async () => { finish('Late answer'); await completion; });
    expect((await completion).error).toMatchObject({ name: 'AbortError' });
    expect((await completion).value).toBeNull();
  });

  test('late failed startup and callbacks cannot clear or append to a replacement session', async () => {
    const onVoiceTurnFinal = jest.fn();
    const { result } = renderHook(() => useVoiceSession({ userId: 'fixture-driver', onVoiceTurnFinal }));
    let oldStart!: Promise<void>; let newStart!: Promise<void>;
    act(() => { oldStart = result.current.start(); });
    act(() => result.current.stop());
    act(() => { newStart = result.current.start(); });
    await act(async () => { sessions[1].connected(); await newStart; });
    await act(async () => { sessions[0].rejectStart(new Error('Late old failure')); await oldStart; });
    act(() => {
      sessions[0].opts.events.onStatus('ended');
      sessions[0].opts.events.onError('Old error');
      sessions[0].opts.events.onUserTurnFinal('Old words');
    });
    expect(result.current.status).toBe('live');
    expect(result.current.error).toBeNull();
    expect(onVoiceTurnFinal).not.toHaveBeenCalled();
    act(() => result.current.pauseMic());
    expect(sessions[1].pauseMic).toHaveBeenCalledTimes(1);
  });

  test('a stale wake callback cannot reactivate the mic after End or resume its replacement', async () => {
    const { result } = renderHook(() => useVoiceSession({ userId: 'fixture-driver' }));
    let connecting!: Promise<void>;
    act(() => { connecting = result.current.start(); });
    await act(async () => { sessions[0].connected(); await connecting; });
    act(() => result.current.pauseMic());
    const oldWake = recognizers[0].onresult;
    act(() => result.current.stop());
    act(() => oldWake({ resultIndex: 0, results: [[{ transcript: 'hey coach' }]] }));
    expect(sessions[0].resumeMic).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    act(() => { connecting = result.current.start(); });
    await act(async () => { sessions[1].connected(); await connecting; });
    act(() => result.current.pauseMic());
    act(() => oldWake({ resultIndex: 0, results: [[{ transcript: 'hey coach' }]] }));
    expect(sessions[1].resumeMic).not.toHaveBeenCalled();
    expect(result.current.micPaused).toBe(true);
    expect(recognizers[1].stop).not.toHaveBeenCalled();
  });
});


describe('Live Coach account ownership', () => {
  test('account replacement ends the old voice and never sends its fragments using the new token', async () => {
    const { STORAGE_KEYS } = await import('@/constants/storageKeys');
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'alice-token');
    const aliceFinal = jest.fn(); const bobFinal = jest.fn();
    const { result, rerender } = renderHook(({ userId, snapshotId, onVoiceTurnFinal }) => useVoiceSession({ userId, snapshotId, onVoiceTurnFinal }), { initialProps: { userId: 'alice', snapshotId: 'alice-snap', onVoiceTurnFinal: aliceFinal } });
    let connecting!: Promise<void>;
    act(() => { connecting = result.current.start(); });
    await act(async () => { sessions[0].connected(); await connecting; });
    act(() => sessions[0].opts.events.onUserTurnFinal('Alice synthetic turn'));
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'bob-token');
    rerender({ userId: 'bob', snapshotId: 'bob-snap', onVoiceTurnFinal: bobFinal });
    expect(sessions[0].stop).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
    act(() => sessions[0].opts.events.onUserTurnFinal('Old late words'));
    expect(bobFinal).not.toHaveBeenCalled();
    for (const [, options] of (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls) {
      const body = JSON.parse(options!.body as string);
      expect((options!.headers as Record<string, string>).Authorization).toBe('Bearer alice-token');
      expect(body.snapshotId).toBe('alice-snap');
    }
  });
  test('unmount after token replacement does not flush old fragments as the new account', async () => {
    const { STORAGE_KEYS } = await import('@/constants/storageKeys');
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'alice-token');
    const { result, unmount } = renderHook(() => useVoiceSession({ userId: 'alice', snapshotId: 'alice-snap' }));
    let connecting!: Promise<void>;
    act(() => { connecting = result.current.start(); });
    await act(async () => { sessions[0].connected(); await connecting; });
    act(() => sessions[0].opts.events.onUserTurnFinal('Alice synthetic turn'));
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'bob-token');
    unmount();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('Bearer alice-token');
  });
});
