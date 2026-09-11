// tests/client/coach-stream-fence.test.tsx
// 2026-09-11: stream identity fence for useCoachChat (desktop-coach-review.md item 3).
// Synthetic fixtures only: no gateway, provider, network or real account data.
// fetch is replaced with a controllable SSE reader so "late" deltas / done payloads
// can be delivered AFTER the hook has switched identity or unmounted.
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });

// useMemory would call /agent/context after a completed exchange; keep it inert.
jest.unstable_mockModule('@/hooks/useMemory', () => ({
  useMemory: () => ({
    logConversation: jest.fn(async () => undefined),
    summarizeConversation: () => ({ topic: null, summary: null }),
  }),
}));
const { useCoachChat } = await import('@/hooks/coach/useCoachChat');
const { API_ROUTES } = await import('@/constants/apiRoutes');

type Chunk = { value?: Uint8Array; done: boolean };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

/** One controllable SSE stream: each read() resolves only when the test pushes. */
function makeStream() {
  const pending: Array<ReturnType<typeof deferred<Chunk>>> = [];
  const queued: Chunk[] = [];
  const cancel = jest.fn(async () => undefined);
  const reader = {
    read: jest.fn(() => {
      const q = queued.shift();
      if (q) return Promise.resolve(q);
      const d = deferred<Chunk>();
      pending.push(d);
      return d.promise;
    }),
    cancel,
    // 2026-09-11: the candidate's readCoachEvents releases the lock in its finally.
    releaseLock: () => {},
  };
  const enc = new TextEncoder();
  const push = (chunk: Chunk) => {
    const d = pending.shift();
    if (d) d.resolve(chunk); else queued.push(chunk);
  };
  return {
    reader,
    cancel,
    sse: (payload: object) => push({ value: enc.encode(`data: ${JSON.stringify(payload)}\n\n`), done: false }),
    end: () => push({ done: true }),
  };
}

const fetchCalls: Array<{ url: string; init: RequestInit; stream: ReturnType<typeof makeStream> }> = [];
function installFetch() {
  (globalThis as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    const stream = makeStream();
    fetchCalls.push({ url, init, stream });
    return {
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
      body: { getReader: () => stream.reader },
    } as unknown as Response;
  });
}

// 2026-09-11: deliberately ignore AbortSignal at BOTH await boundaries. The
// generation fence must protect state even when a transport delivers late work.
function holdFirstResponse(kind: 'sse' | 'http-error', headersPending: boolean) {
  const nextFetch = globalThis.fetch;
  const headers = deferred<Response>();
  const text = deferred<string>();
  const stream = makeStream();
  const readText = jest.fn(() => text.promise);
  const response = {
    ok: kind === 'sse',
    status: kind === 'sse' ? 200 : 503,
    headers: { get: () => kind === 'sse' ? 'text/event-stream' : 'application/json' },
    body: { getReader: () => stream.reader },
    text: readText,
  } as unknown as Response;
  let first = true;
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (!first) return nextFetch(input, init);
    first = false;
    fetchCalls.push({ url: String(input), init: init!, stream });
    return headers.promise;
  });
  if (!headersPending) headers.resolve(response);
  return {
    releaseHeaders: () => headers.resolve(response),
    releaseText: (body = '{"message":"Private stale error for A"}') => text.resolve(body),
    readText,
    stream,
  };
}

const key = (userId: string, snapshotId?: string) => `vecto_coach_chat_${userId}_${snapshotId || 'global'}`;
const stored = (k: string) => window.localStorage.getItem(k);
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

let onStreamDelta: jest.Mock;
let onStreamComplete: jest.Mock;
let onNotesSaved: jest.Mock;

beforeEach(() => {
  window.localStorage.clear();
  fetchCalls.length = 0;
  installFetch();
  onStreamDelta = jest.fn();
  onStreamComplete = jest.fn();
  onNotesSaved = jest.fn();
});
afterEach(() => { jest.restoreAllMocks(); });

function mount(initial: { userId: string; snapshotId?: string }) {
  return renderHook(
    (props: { userId: string; snapshotId?: string }) => useCoachChat({
      ...props,
      onStreamDelta: onStreamDelta as unknown as (d: string) => void,
      onStreamComplete: onStreamComplete as unknown as (t: string, m: { userMessage: string }) => void,
      onNotesSaved: onNotesSaved as unknown as () => void,
    }),
    { initialProps: initial },
  );
}

describe('useCoachChat identity fence', () => {
  it('normal path: a single stream updates the last assistant message, strips tags on done and reports saved notes', async () => {
    const { result } = mount({ userId: 'driver-a', snapshotId: 'snap-a' });
    await act(async () => { void result.current.send('hello'); });
    await flush();
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe(API_ROUTES.CHAT.SEND);
    expect(JSON.parse(fetchCalls[0].init.body as string)).toMatchObject({ userId: 'driver-a', snapshotId: 'snap-a', message: 'hello' });
    expect(result.current.isStreaming).toBe(true);

    const { stream } = fetchCalls[0];
    await act(async () => { stream.sse({ delta: 'Hi there ' }); await Promise.resolve(); });
    await flush();
    await act(async () => { stream.sse({ delta: '[SAVE_NOTE: {"title":"t","detail":"d"}]' }); await Promise.resolve(); });
    await flush();
    await act(async () => { stream.sse({ done: true, conversation_id: 'c1', actions_result: { saved: 1, errors: [] } }); await Promise.resolve(); });
    await flush();
    await act(async () => { stream.end(); await Promise.resolve(); });
    await flush();

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(result.current.messages[1].content).toBe('Hi there');
    expect(onStreamDelta).toHaveBeenCalledTimes(2);
    expect(onStreamComplete).toHaveBeenCalledWith('Hi there', { userMessage: 'hello' });
    expect(onNotesSaved).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stored(key('driver-a', 'snap-a'))!).messages[1].content).toBe('Hi there');
  });

  it('snapshot switch mid-stream: aborts A, and A\'s late deltas/done touch neither B\'s UI nor either storage key', async () => {
    const { result, rerender } = mount({ userId: 'driver-a', snapshotId: 'snap-a' });
    await act(async () => { void result.current.send('question for A'); });
    await flush();
    const a = fetchCalls[0];
    const aSignal = a.init.signal as AbortSignal;
    expect(aSignal.aborted).toBe(false);
    const aStorageBefore = stored(key('driver-a', 'snap-a'));
    expect(aStorageBefore).toContain('question for A');

    // Identity changes to snapshot B while A is still streaming.
    rerender({ userId: 'driver-a', snapshotId: 'snap-b' });
    await flush();
    expect(aSignal.aborted).toBe(true);
    expect(result.current.isStreaming).toBe(false);

    // B gets its own seeded assistant message.
    await act(async () => {
      result.current.setMessages([{ role: 'user', content: 'B asks' }, { role: 'assistant', content: 'B answer' }]);
    });
    await flush();
    const bStorageBefore = stored(key('driver-a', 'snap-b'));
    expect(JSON.parse(bStorageBefore!).messages[1].content).toBe('B answer');

    // A's late work arrives after the switch.
    await act(async () => { a.stream.sse({ delta: 'STALE-A ' }); await Promise.resolve(); });
    await flush();
    await act(async () => { a.stream.sse({ done: true, actions_result: { saved: 3, errors: ['stale error'] } }); await Promise.resolve(); });
    await flush();
    await act(async () => { a.stream.end(); await Promise.resolve(); });
    await flush();

    expect(result.current.messages).toEqual([{ role: 'user', content: 'B asks' }, { role: 'assistant', content: 'B answer' }]);
    expect(stored(key('driver-a', 'snap-b'))).toBe(bStorageBefore);
    expect(stored(key('driver-a', 'snap-a'))).toBe(aStorageBefore);
    expect(onStreamDelta).not.toHaveBeenCalled();
    expect(onStreamComplete).not.toHaveBeenCalled();
    expect(onNotesSaved).not.toHaveBeenCalled();
    expect(result.current.validationErrors).toEqual([]);
    expect(a.stream.cancel).toHaveBeenCalled();
    expect(result.current.isStreaming).toBe(false);
  });

  it('account switch mid-stream: the new account\'s thread and storage are untouched by the old account\'s stream', async () => {
    const { result, rerender } = mount({ userId: 'driver-a', snapshotId: 'snap-1' });
    await act(async () => { void result.current.send('A private question'); });
    await flush();
    const a = fetchCalls[0];
    const aStorageBefore = stored(key('driver-a', 'snap-1'));

    rerender({ userId: 'driver-b', snapshotId: 'snap-1' });
    await flush();
    expect((a.init.signal as AbortSignal).aborted).toBe(true);
    expect(result.current.messages).toEqual([]);

    await act(async () => { a.stream.sse({ delta: 'A secret answer' }); await Promise.resolve(); });
    await flush();
    await act(async () => { a.stream.sse({ done: true, actions_result: { saved: 1 } }); await Promise.resolve(); });
    await flush();
    await act(async () => { a.stream.end(); await Promise.resolve(); });
    await flush();

    expect(result.current.messages).toEqual([]);
    expect(stored(key('driver-b', 'snap-1'))).toBeNull();
    expect(stored(key('driver-a', 'snap-1'))).toBe(aStorageBefore);
    expect(onStreamDelta).not.toHaveBeenCalled();
    expect(onNotesSaved).not.toHaveBeenCalled();

    // B can start its own stream afterwards and it is not fenced.
    await act(async () => { void result.current.send('B question'); });
    await flush();
    expect(fetchCalls).toHaveLength(2);
    expect(JSON.parse(fetchCalls[1].init.body as string).userId).toBe('driver-b');
    expect(result.current.isStreaming).toBe(true);
    await act(async () => { fetchCalls[1].stream.sse({ delta: 'B reply' }); await Promise.resolve(); });
    await flush();
    // 2026-09-11: a reply is confirmed only by a done payload (confirmedCoachReply).
    await act(async () => { fetchCalls[1].stream.sse({ done: true, conversation_id: 'c2' }); await Promise.resolve(); });
    await flush();
    await act(async () => { fetchCalls[1].stream.end(); await Promise.resolve(); });
    await flush();
    expect(result.current.messages[1].content).toBe('B reply');
    expect(onStreamDelta).toHaveBeenCalledWith('B reply');
  });

  it('unmount mid-stream aborts the request and late deltas/done fire no callbacks', async () => {
    const { result, unmount } = mount({ userId: 'driver-a', snapshotId: 'snap-a' });
    await act(async () => { void result.current.send('hello'); });
    await flush();
    const a = fetchCalls[0];
    const before = stored(key('driver-a', 'snap-a'));

    unmount();
    expect((a.init.signal as AbortSignal).aborted).toBe(true);

    await act(async () => { a.stream.sse({ delta: 'late' }); await Promise.resolve(); });
    await flush();
    await act(async () => { a.stream.sse({ done: true, actions_result: { saved: 1 } }); await Promise.resolve(); });
    await flush();
    await act(async () => { a.stream.end(); await Promise.resolve(); });
    await flush();

    expect(stored(key('driver-a', 'snap-a'))).toBe(before);
    expect(onStreamDelta).not.toHaveBeenCalled();
    expect(onStreamComplete).not.toHaveBeenCalled();
    expect(onNotesSaved).not.toHaveBeenCalled();
    expect(a.stream.cancel).toHaveBeenCalled();
  });

  const boundaries = ['account', 'snapshot', 'unmount'] as const;
  const phases = ['headers', 'body'] as const;
  const responseKinds = ['sse', 'http-error'] as const;
  const lateResponses = boundaries.flatMap(boundary => phases.flatMap(phase =>
    responseKinds.map(kind => ({ boundary, phase, kind }))));

  it.each(lateResponses)('$boundary change while $kind $phase are pending fences late work and preserves B', async ({ boundary, phase, kind }) => {
    const transport = holdFirstResponse(kind, phase === 'headers');
    const initial = { userId: 'driver-a', snapshotId: 'snap-a' };
    const next = boundary === 'account'
      ? { userId: 'driver-b', snapshotId: 'snap-a' }
      : { userId: 'driver-a', snapshotId: 'snap-b' };
    const hook = mount(initial);
    let sendA!: Promise<void>;
    await act(async () => { sendA = hook.result.current.send('A private question'); });
    await flush();
    const a = fetchCalls[0];
    const aBefore = stored(key(initial.userId, initial.snapshotId));
    if (phase === 'body') {
      expect(kind === 'sse' ? transport.stream.reader.read : transport.readText).toHaveBeenCalledTimes(1);
    } else {
      expect(transport.stream.reader.read).not.toHaveBeenCalled();
      expect(transport.readText).not.toHaveBeenCalled();
    }

    if (boundary === 'unmount') hook.unmount();
    else hook.rerender(next);
    await flush();
    expect((a.init.signal as AbortSignal).aborted).toBe(true);

    let bBefore: string | null = null;
    if (boundary !== 'unmount') {
      await act(async () => { void hook.result.current.send('B question'); });
      await flush();
      expect(fetchCalls).toHaveLength(2);
      expect(hook.result.current.isStreaming).toBe(true);
      bBefore = stored(key(next.userId, next.snapshotId));
    }

    await act(async () => {
      transport.releaseHeaders();
      transport.releaseText();
      transport.stream.sse({ delta: 'Private stale answer for A' });
      transport.stream.sse({ done: true, actions_result: { saved: 1, errors: ['Stale action error'] } });
      transport.stream.end();
      await sendA;
    });

    expect(stored(key(initial.userId, initial.snapshotId))).toBe(aBefore);
    expect(onStreamDelta).not.toHaveBeenCalled();
    expect(onStreamComplete).not.toHaveBeenCalled();
    expect(onNotesSaved).not.toHaveBeenCalled();
    if (boundary === 'unmount') return;

    // A's late error handler/finally must not overwrite B's thread or release
    // its busy flag; a second deliberate send is refused while B is active.
    expect(hook.result.current.isStreaming).toBe(true);
    expect(hook.result.current.validationErrors).toEqual([]);
    expect(hook.result.current.messages.map(message => message.content)).toEqual(['B question', '']);
    expect(stored(key(next.userId, next.snapshotId))).toBe(bBefore);
    await act(async () => { await hook.result.current.send('Blocked duplicate B'); });
    expect(fetchCalls).toHaveLength(2);

    await act(async () => {
      fetchCalls[1].stream.sse({ delta: 'B confirmed reply' });
      fetchCalls[1].stream.sse({ done: true, actions_result: { saved: 1, errors: [] } });
      fetchCalls[1].stream.end();
    });
    await flush();
    expect(hook.result.current.isStreaming).toBe(false);
    expect(hook.result.current.messages.map(message => message.content)).toEqual(['B question', 'B confirmed reply']);
    expect(onStreamDelta).toHaveBeenCalledTimes(1);
    expect(onStreamComplete).toHaveBeenCalledWith('B confirmed reply', { userMessage: 'B question' });
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(onNotesSaved).toHaveBeenCalledTimes(1);
    expect(stored(key(initial.userId, initial.snapshotId))).toBe(aBefore);
    expect(JSON.parse(stored(key(next.userId, next.snapshotId))!).messages[1].content).toBe('B confirmed reply');
  });

  it('still displays a current HTTP error and releases its own busy flag', async () => {
    const transport = holdFirstResponse('http-error', false);
    const { result } = mount({ userId: 'driver-a', snapshotId: 'snap-a' });
    let sending!: Promise<void>;
    await act(async () => { sending = result.current.send('hello'); });
    await flush();
    expect(transport.readText).toHaveBeenCalledTimes(1);
    await act(async () => {
      transport.releaseText('{"message":"Synthetic service unavailable"}');
      await sending;
    });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages[1].content).toBe('Sorry—chat failed: Synthetic service unavailable');
    expect(onStreamComplete).not.toHaveBeenCalled();
  });
});
