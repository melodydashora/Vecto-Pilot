import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { act, renderHook, cleanup } from '@testing-library/react';
import type { VoiceSessionOptions } from '@/lib/voice/types';

const toast = jest.fn();
jest.unstable_mockModule('@/hooks/useToast', () => ({ useToast: () => ({ toast }) }));
const { useTTS } = await import('@/hooks/useTTS');
const { RealtimeSession } = await import('@/lib/voice/RealtimeSession');
const audios: FakeAudio[] = [];
class FakeAudio {
  src = ''; currentTime = 0; volume = 1;
  onerror: (() => void) | null = null; onended: (() => void) | null = null;
  pause = jest.fn(); play = jest.fn(async () => {});
  constructor() { audios.push(this); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const browserSpeak = jest.fn();
const getUserMedia = jest.fn<() => Promise<MediaStream>>();
const peer = jest.fn();
const mint = () => ({ ok: true, json: async () => ({ ok: true, token: 'synthetic-token', model: 'synthetic-model' }) }) as Response;
const opts = (): VoiceSessionOptions => ({ userId: 'synthetic-user', events: {
  onStatus: jest.fn(), onError: jest.fn(), onUserTranscriptDelta: jest.fn(), onUserTurnFinal: jest.fn(), onModelTranscriptDelta: jest.fn(), onModelTurnFinal: jest.fn(),
}, askCoachBrain: async () => '' });
beforeEach(() => {
  jest.useFakeTimers(); audios.length = 0; toast.mockClear(); browserSpeak.mockClear(); peer.mockClear(); getUserMedia.mockReset();
  Object.assign(globalThis, { Audio: FakeAudio, SpeechSynthesisUtterance: class { constructor(readonly text: string) {} }, RTCPeerConnection: peer });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel: jest.fn(), speak: browserSpeak, speaking: true } });
  URL.createObjectURL = jest.fn(() => 'blob:synthetic'); URL.revokeObjectURL = jest.fn();
  global.fetch = jest.fn<typeof fetch>(async () => ({ ok: true, blob: async () => new Blob(['audio']) }) as Response);
});
afterEach(() => { cleanup(); jest.clearAllTimers(); jest.useRealTimers(); });

describe('Coach speech cancellation', () => {
  test('late audio error after Stop cannot restart speech through the browser fallback', async () => {
    const { result } = renderHook(() => useTTS());
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.speak('Old synthetic words'); });
    const lateError = audios[0].onerror!;
    act(() => result.current.stop());
    await pending;
    act(() => lateError());
    expect(browserSpeak).not.toHaveBeenCalled();
    expect(result.current.isSpeaking).toBe(false);
  });
  test('a completed old audio callback cannot mark a replacement utterance idle', async () => {
    const { result } = renderHook(() => useTTS());
    await act(async () => { void result.current.speak('First synthetic words'); });
    const lateEnded = audios[0].onended!;
    await act(async () => { void result.current.speak('Replacement words'); });
    act(() => lateEnded());
    expect(result.current.isSpeaking).toBe(true);
    act(() => result.current.stop());
  });
  test('Stop while legacy Realtime mint is pending never starts microphone capture', async () => {
    const response = deferred<Response>();
    global.fetch = jest.fn<typeof fetch>(() => response.promise);
    const session = new RealtimeSession(opts()); const started = session.start();
    session.stop(); response.resolve(mint()); await started;
    expect(getUserMedia).not.toHaveBeenCalled();
    expect((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  test('Stop while legacy Realtime mic permission is pending stops the late stream', async () => {
    global.fetch = jest.fn<typeof fetch>(async () => mint());
    const capture = deferred<MediaStream>(); getUserMedia.mockReturnValue(capture.promise);
    const trackStop = jest.fn(); const session = new RealtimeSession(opts());
    const started = session.start();
    await Promise.resolve(); await Promise.resolve();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    session.stop(); capture.resolve({ getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream);
    await started;
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(peer).not.toHaveBeenCalled();
  });
});
