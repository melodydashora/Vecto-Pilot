import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { TextEncoder } from 'node:util';
import { render, screen, cleanup } from '@testing-library/react';
import { GptLiveSession } from '@/lib/voice/GptLiveSession';
import { LiveTranscriptLedger, splitLiveAppend } from '@/lib/voice/live-transcripts';
import { LiveCoachCaptions } from '@/components/coach/LiveCoachCaptions';
import { STORAGE_KEYS } from '@/constants/storageKeys';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let messages: any[], track: any, pc: any, channel: any;
let getUserMedia: ReturnType<typeof jest.fn<() => Promise<MediaStream>>>;
const event = (id: string, text: string, role = 'input', start = 0) => ({ type: `session.${role}_transcript.delta`, event_id: id, delta: text, start_ms: start, end_ms: start + 10 });
function fixture() {
  const events = { onStatus: jest.fn(), onError: jest.fn(), onUserTranscriptDelta: jest.fn(), onModelTranscriptDelta: jest.fn(), onUserTurnFinal: jest.fn(), onModelTurnFinal: jest.fn(), onTranscriptFragment: jest.fn(), onControl: jest.fn() };
  const brain = jest.fn(async (_question: string, _options?: { answerOnly?: boolean }) => 'Verified current answer.');
  const session = new GptLiveSession({ userId: 'driver', snapshotId: 'owned-snapshot', events, askCoachBrain: brain });
  return { session, events, brain, incoming: (e: any) => (session as any).handleEvent(e) };
}
beforeEach(() => {
  Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
  localStorage.clear(); messages = [];
  track = { enabled: true, stop: jest.fn() };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  getUserMedia = jest.fn(async () => stream);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  channel = { readyState: 'open', send: (s: string) => messages.push(JSON.parse(s)), close: jest.fn(), onmessage: null, onclose: null };
  pc = { iceGatheringState: 'complete', addTrack: jest.fn(), createDataChannel: () => channel,
    createOffer: async () => ({ type: 'offer', sdp: 'v=0\r\ns=fixture' }),
    setLocalDescription: async (d: any) => { pc.localDescription = d; },
    setRemoteDescription: jest.fn(async () => {}), close: jest.fn(), localDescription: null };
  Object.defineProperty(globalThis, 'RTCPeerConnection', { configurable: true, value: function () { return pc; } });
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: function () { return { setAttribute() {}, play: async () => {}, pause: jest.fn(), srcObject: null }; } });
  global.fetch = jest.fn<typeof fetch>(async () => ({ ok: true, json: async () => ({ ok: true, transport: { sdp: 'answer' } }) }) as Response);
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); jest.useRealTimers(); });
describe('GPT-Live session protocol and driver controls', () => {
  test('constructing does not open a mic; HTTP negotiation alone is not live', async () => {
    const f = fixture(); expect(getUserMedia).not.toHaveBeenCalled();
    const start = f.session.start(); await flush();
    expect(f.events.onStatus).toHaveBeenCalledWith('connecting');
    expect(f.events.onStatus).not.toHaveBeenCalledWith('live', expect.anything());
    f.incoming({ type: 'session.started' }); await start;
    expect(f.events.onStatus).toHaveBeenCalledWith('live', 'gpt-live-1');
    expect(messages.some(e => e.type === 'session.start' || e.type === 'response.create')).toBe(false);
    f.session.stop(); f.incoming({ type: 'session.closed' });
  });
  test('end during the permission prompt stops late mic tracks and makes no provider request', async () => {
    const permission = deferred<MediaStream>(); getUserMedia.mockReturnValueOnce(permission.promise);
    const f = fixture(); const start = f.session.start(); f.session.stop();
    permission.resolve({ getTracks: () => [track] } as unknown as MediaStream); await start;
    expect(track.stop).toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  test('pause while permission is pending remains paused after startup', async () => {
    const permission = deferred<MediaStream>(); getUserMedia.mockReturnValueOnce(permission.promise);
    const f = fixture(); const start = f.session.start(); f.session.pauseMic();
    permission.resolve({ getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream);
    await flush(); f.incoming({ type: 'session.started' }); await start;
    expect(track.enabled).toBe(false);
    expect(messages.some(e => e.type === 'session.input_audio.unmute')).toBe(false);
    f.session.stop(); f.incoming({ type: 'session.closed' });
  });
  test('uses a separate OpenAI voice preference and never sends the project key', async () => {
    localStorage.setItem(STORAGE_KEYS.COACH_VOICE_NAME, 'Aoede'); localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'session-auth');
    const f = fixture(); const start = f.session.start(); await flush(); f.incoming({ type: 'session.started' }); await start;
    const [url, init] = jest.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/coach-live/session'); expect(JSON.parse(String(init?.body)).voice).toBe('marin');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer session-auth' });
    f.session.stop(); f.incoming({ type: 'session.closed' });
  });
  test('fragments cannot execute work; a unique delegation routes their timing and exact words to the Coach', async () => {
    const f = fixture(); f.incoming({ type: 'session.started' }); f.incoming(event('a', 'Where ')); f.incoming(event('b', 'now?', 'input', 10));
    expect(f.brain).not.toHaveBeenCalled(); expect(f.events.onUserTurnFinal).not.toHaveBeenCalled();
    const delegation = { type: 'session.delegation.created', offset_ms: 30, delegation: { id: 'opaque_delegation', target: 'client' } };
    f.incoming(delegation); f.incoming(delegation); await flush();
    expect(f.brain).toHaveBeenCalledTimes(1); expect(f.brain.mock.calls[0][0]).toContain('user [0-10 ms]: Where ');
    expect(f.brain.mock.calls[0][0]).toContain('user [10-20 ms]: now?'); f.session.stop();
  });
  test.each([undefined, -1, NaN])('a delegation with invalid offset %s asks for repetition without executing work', async offset => {
    const f = fixture(); const start = f.session.start(); await flush(); f.incoming({ type: 'session.started' }); await start;
    f.incoming(event('a', 'Save a note'));
    f.incoming({ type: 'session.delegation.created', offset_ms: offset, delegation: { id: 'malformed', target: 'client' } }); await flush();
    expect(f.brain).not.toHaveBeenCalled();
    expect(messages.some(e => e.type === 'session.commentary.append' && e.content.includes('Please repeat it'))).toBe(true);
    f.session.stop(); f.incoming({ type: 'session.closed' });
  });
  test('continued speech replaces a late answer with a fresh answer-only check instead of leaving silence', async () => {
    const f = fixture(); const answer = deferred<string>(); f.brain.mockReturnValueOnce(answer.promise);
    const start = f.session.start(); await flush(); f.incoming({ type: 'session.started' }); await start;
    f.incoming(event('a', 'Friday')); f.incoming({ type: 'session.delegation.created', offset_ms: 20, delegation: { id: 'one', target: 'client' } }); await flush();
    f.incoming(event('b', 'Actually Thursday', 'input', 30)); answer.resolve('Old Friday answer'); await flush();
    expect(messages.some(e => e.type === 'session.commentary.append' && e.content.includes('Old Friday'))).toBe(false);
    expect(messages.some(e => e.type === 'session.thinking.append')).toBe(true);
    expect(f.brain).toHaveBeenCalledTimes(2);
    expect(f.brain.mock.calls[1][0]).toContain('Actually Thursday');
    expect(f.brain.mock.calls[1][0]).toContain('Old Friday answer');
    expect(f.brain.mock.calls[1][1]).toEqual({ answerOnly: true });
    expect(messages.some(e => e.type === 'session.commentary.append' && e.content === 'Verified current answer.')).toBe(true);
    f.session.stop(); f.incoming({ type: 'session.delegation.created', offset_ms: 40, delegation: { id: 'two', target: 'client' } }); await flush();
    expect(f.brain).toHaveBeenCalledTimes(2); f.incoming({ type: 'session.closed' });
  });
  test('another delegation for an already reconciled utterance cannot repeat a completed action', async () => {
    const f = fixture(); f.incoming({ type: 'session.started' }); f.incoming(event('a', 'Check my saved data'));
    f.incoming({ type: 'session.delegation.created', offset_ms: 20, delegation: { id: 'first', target: 'client' } }); await flush();
    f.incoming({ type: 'session.delegation.created', offset_ms: 20, delegation: { id: 'second', target: 'client' } }); await flush();
    expect(f.brain).toHaveBeenCalledTimes(1); f.session.stop();
  });
  test('pause disables capture immediately; end stops devices and drains final control events', async () => {
    const f = fixture(); const start = f.session.start(); await flush(); f.incoming({ type: 'session.started' }); await start;
    f.session.pauseMic(); expect(track.enabled).toBe(false); expect(messages.some(e => e.type === 'session.input_audio.mute')).toBe(true);
    f.incoming(event('a', 'Caption update')); expect(track.enabled).toBe(false);
    f.session.resumeMic(); expect(track.enabled).toBe(true);
    f.session.stop(); expect(track.stop).toHaveBeenCalled(); expect(messages.some(e => e.type === 'session.close')).toBe(true);
    expect(pc.close).not.toHaveBeenCalled(); f.incoming({ type: 'session.closed' }); expect(pc.close).toHaveBeenCalledTimes(1);
    f.session.resumeMic(); expect(track.stop).toHaveBeenCalledTimes(1);
  });
  test('a brief disconnected state recovers the same session and preserves microphone pause', async () => {
    jest.useFakeTimers();
    const f = fixture(); const start = f.session.start(); await flush(); f.incoming({ type: 'session.started' }); await start;
    f.session.pauseMic(); pc.connectionState = 'disconnected'; pc.onconnectionstatechange();
    await jest.advanceTimersByTimeAsync(2000);
    expect(track.stop).not.toHaveBeenCalled(); expect(track.enabled).toBe(false);
    pc.connectionState = 'connected'; pc.onconnectionstatechange();
    await jest.advanceTimersByTimeAsync(5000);
    expect(track.stop).not.toHaveBeenCalled(); expect(track.enabled).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(f.events.onStatus).toHaveBeenLastCalledWith('live', 'gpt-live-1');
    f.session.stop(); f.incoming({ type: 'session.closed' });
  });
  test('a persistent disconnect stops capture and never starts another session automatically', async () => {
    jest.useFakeTimers();
    const f = fixture(); const start = f.session.start(); await flush(); f.incoming({ type: 'session.started' }); await start;
    pc.connectionState = 'disconnected'; pc.onconnectionstatechange();
    await jest.advanceTimersByTimeAsync(5000);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(f.events.onStatus).toHaveBeenLastCalledWith('ended'); expect(fetch).toHaveBeenCalledTimes(1);
    f.incoming({ type: 'session.closed' });
  });
  test('a stalled negotiation request has a client deadline and stops its microphone', async () => {
    jest.useFakeTimers();
    jest.mocked(fetch).mockImplementationOnce((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const f = fixture(); const start = f.session.start(); const rejected = expect(start).rejects.toThrow('Live voice connection timed out');
    await flush(); await jest.advanceTimersByTimeAsync(35000); await rejected;
    expect(track.stop).toHaveBeenCalledTimes(1); f.incoming({ type: 'session.closed' });
  });
  test('End after an open control channel requests close even before session.started', async () => {
    const f = fixture(); const start = f.session.start(); await flush();
    f.session.stop(); await start;
    expect(messages.some(e => e.type === 'session.close')).toBe(true);
    expect(track.stop).toHaveBeenCalledTimes(1); f.incoming({ type: 'session.closed' });
  });
  test('a late negotiation body after End cannot restart connection setup', async () => {
    const body = deferred<any>();
    jest.mocked(fetch).mockResolvedValueOnce({ ok: true, json: () => body.promise } as Response);
    const f = fixture(); const start = f.session.start(); await flush();
    f.session.stop(); body.resolve({ ok: true, transport: { sdp: 'late answer' } }); await start;
    expect(pc.setRemoteDescription).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledTimes(1); f.incoming({ type: 'session.closed' });
  });
});
describe('full duplex transcripts', () => {
  test('preserves whitespace, repeated words, overlapping intervals and late fragments without inventing final turns', () => {
    const ledger = new LiveTranscriptLedger();
    ledger.add(event('a', 'hello ')); ledger.add(event('b', 'hello', 'input', 10)); ledger.add(event('c', 'Hi', 'output', 5)); ledger.add(event('a', 'duplicate'));
    expect(ledger.fragments.map(f => f.text)).toEqual(['hello ', 'hello', 'Hi']);
    expect(ledger.context(0)).not.toContain('assistant'); expect(ledger.context(-1)).toBeNull();
    render(<LiveCoachCaptions fragments={ledger.fragments} />);
    expect(screen.getByLabelText('Live voice captions')).toHaveTextContent('hello hello');
    expect(screen.getByText('Live captions · automatic transcript')).toBeInTheDocument();
  });
  test('multilingual append chunks preserve exact Unicode and stay below the API token bound', () => {
    const source = 'Hello café 🧡 こんにちは '.repeat(100); const chunks = splitLiveAppend(source);
    expect(chunks.join('')).toBe(source); expect(chunks.every(c => new TextEncoder().encode(c).length <= 450)).toBe(true);
  });
});
