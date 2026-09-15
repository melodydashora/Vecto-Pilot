import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { act, renderHook, cleanup } from '@testing-library/react';
import type { VoiceSessionOptions } from '@/lib/voice/types';

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
  sessions.length = 0; recognizers = []; brain.mockClear(); localStorage.clear();
  Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: class {
    onend?: () => void;
    start = jest.fn();
    stop = jest.fn(() => this.onend?.());
    constructor() { recognizers.push(this); }
  } });
  global.fetch = jest.fn<typeof fetch>(async () => ({ ok: true }) as Response);
});
afterEach(() => { cleanup(); delete (window as any).SpeechRecognition; });

describe('Coach hook owns every voice resource for its session', () => {
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
    const signal = brain.mock.calls[0][0].signal;
    act(() => sessions[0].opts.events.onStatus('ended'));
    expect(signal.aborted).toBe(true);
    expect(recognizers[0].stop).toHaveBeenCalledTimes(1);
    expect(recognizers[0].start).toHaveBeenCalledTimes(1);
    expect(result.current.micPaused).toBe(false);
    await act(async () => { finish('Late answer'); await request; });
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
