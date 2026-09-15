// 2026-09-11: Desktop Coach acceptance 1/3/4/5. Mount the real Coach, chat,
// canonical voice send, persistence, SSE reader, audio preferences and memo UI.
// Only speech recognition/TTS hardware and unrelated useMemory are replaced;
// every HTTP request is answered by synthetic fixtures or rejected locally.
import React, { useSyncExternalStore, useState } from 'react';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let hardware = { transcript: '', isListening: false, isSpeaking: false };
const updateHardware = (next: Partial<typeof hardware>) => {
  hardware = { ...hardware, ...next };
  listeners.forEach(listener => listener());
};
let onSilence: (() => void) | undefined;
const startMic = jest.fn(() => updateHardware({ isListening: true }));
const stopMic = jest.fn(() => updateHardware({ isListening: false }));
const clearTranscript = jest.fn(() => updateHardware({ transcript: '' }));
const playback: Array<ReturnType<typeof deferred<void>>> = [];
const speak = jest.fn((_text: string, _language?: string, _speed?: number) => {
  updateHardware({ isSpeaking: true });
  const pending = deferred<void>();
  playback.push(pending);
  return pending.promise;
});
const stopSpeak = jest.fn(() => {
  updateHardware({ isSpeaking: false });
  playback.splice(0).forEach(pending => pending.resolve());
});
const warmUp = jest.fn();
jest.unstable_mockModule('@/hooks/useTTS', () => ({ useTTS: () => ({
  ...useSyncExternalStore(subscribe, () => hardware), speak, stop: stopSpeak, warmUp,
}) }));
jest.unstable_mockModule('@/hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: (options: { onSilence?: () => void }) => {
    onSilence = options.onSilence;
    const state = useSyncExternalStore(subscribe, () => hardware);
    return { ...state, finalTranscript: state.transcript, interimTranscript: '',
      isSupported: true, error: null, start: startMic, stop: stopMic, clear: clearTranscript };
  },
}));
jest.unstable_mockModule('@/hooks/useMemory', () => ({ useMemory: () => ({
  logConversation: jest.fn(async () => undefined), summarizeConversation: () => ({ topic: null, summary: null }),
}) }));

const { default: RideshareCoach } = await import('@/components/RideshareCoach');
const { STORAGE_KEYS } = await import('@/constants/storageKeys');
const { API_ROUTES } = await import('@/constants/apiRoutes');

type Chunk = { value?: Uint8Array; done: boolean };
function streamResponse() {
  const queue: Chunk[] = [];
  let pending: ReturnType<typeof deferred<Chunk>> | undefined;
  const push = (chunk: Chunk) => {
    if (pending) { const read = pending; pending = undefined; read.resolve(chunk); }
    else queue.push(chunk);
  };
  const reader = {
    read: () => {
      if (queue.length) return Promise.resolve(queue.shift()!);
      pending = deferred<Chunk>();
      return pending.promise;
    },
    cancel: async () => { push({ done: true }); }, releaseLock: () => {},
  };
  return {
    response: { ok: true, status: 200, headers: { get: () => 'text/event-stream' },
      body: { getReader: () => reader } } as unknown as Response,
    event: (payload: object) => push({ done: false, value: new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`) }),
    end: () => push({ done: true }),
  };
}
const chats: Array<{ init: RequestInit; stream: ReturnType<typeof streamResponse> }> = [];
let nextHttpError = false;
let notesReads = 0;
let memoReads = 0;
let savedMemos: object[] = [];
const unexpectedRequests: string[] = [];
const originalFetch = globalThis.fetch;
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
const storageKey = 'vecto_coach_chat_driver-fixture_snapshot-fixture';
const history = () => JSON.parse(localStorage.getItem(storageKey) || '{"messages":[]}').messages as Array<{ role: string; content: string }>;

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
function mountCoach() {
  return render(<RideshareCoach userId="driver-fixture" snapshotId="snapshot-fixture" />);
}
function prepareTyped(text: string) {
  fireEvent.change(screen.getByTestId('input-chat-message'), { target: { value: text } });
}
function submitTyped(text: string) {
  prepareTyped(text);
  fireEvent.click(screen.getByTestId('button-send-message'));
}
function scheduleVoice(text: string) {
  act(() => updateHardware({ transcript: text, isListening: false }));
  act(() => onSilence?.());
}
async function sendVoice(text: string) {
  scheduleVoice(text);
  await act(async () => { jest.advanceTimersByTime(300); });
  await flush();
}
async function finishChat(index: number, text: string, actions?: object) {
  await act(async () => {
    chats[index].stream.event({ delta: text });
    chats[index].stream.event({ done: true, response_text: text, ...(actions ? { actions_result: actions } : {}) });
    chats[index].stream.end();
  });
  await flush();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  localStorage.clear();
  localStorage.setItem(STORAGE_KEYS.COACH_AUTO_LISTEN_ENABLED, 'false');
  localStorage.setItem(STORAGE_KEYS.COACH_READ_ALOUD_ENABLED, 'false');
  hardware = { transcript: '', isListening: false, isSpeaking: false };
  chats.length = 0; unexpectedRequests.length = 0; playback.length = 0;
  nextHttpError = false; notesReads = 0; memoReads = 0; savedMemos = [];
  HTMLElement.prototype.scrollIntoView = jest.fn();
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === API_ROUTES.CHAT.SEND) {
      const stream = streamResponse();
      chats.push({ init: init!, stream });
      if (nextHttpError) {
        nextHttpError = false;
        return { ok: false, status: 503, headers: { get: () => 'application/json' },
          text: async () => '{"message":"Synthetic voice failure"}' } as unknown as Response;
      }
      return stream.response;
    }
    if (url === API_ROUTES.COACH.NOTES_WITH_PARAMS) {
      notesReads += 1;
      return { ok: true, json: async () => ({ notes: [] }) } as Response;
    }
    if (url === '/api/coach/memos?limit=50') {
      memoReads += 1;
      return { ok: true, json: async () => ({ memos: savedMemos }) } as Response;
    }
    unexpectedRequests.push(url);
    throw new Error(`Unexpected synthetic Coach request: ${url}`);
  });
});
afterEach(async () => {
  cleanup();
  await act(async () => {
    chats.forEach(({ stream }) => stream.end());
    playback.splice(0).forEach(pending => pending.resolve());
  });
  jest.clearAllTimers();
  jest.useRealTimers();
  globalThis.fetch = originalFetch;
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  expect(unexpectedRequests).toEqual([]);
});

describe('mounted Coach canonical input and confirmed output', () => {
  it.each(['typed-first', 'voice-first'])('%s in one synchronous act admits one turn and keeps the losing input', async order => {
    mountCoach();
    prepareTyped('Typed question');
    scheduleVoice('Spoken question');
    act(() => {
      if (order === 'typed-first') fireEvent.click(screen.getByTestId('button-send-message'));
      jest.advanceTimersByTime(300);
      if (order === 'voice-first') fireEvent.click(screen.getByTestId('button-send-message'));
    });
    await flush();
    expect(chats).toHaveLength(1);
    expect((chats[0].init.signal as AbortSignal).aborted).toBe(false);
    expect(history().map(message => message.role)).toEqual(['user', 'assistant']);
    const expected = order === 'typed-first' ? 'Typed question' : 'Spoken question';
    expect(JSON.parse(chats[0].init.body as string).message).toBe(expected);
    if (order === 'typed-first') expect(hardware.transcript).toBe('Spoken question');
    else expect(screen.getByTestId('input-chat-message')).toHaveValue('Typed question');
    await finishChat(0, 'First reply');
    act(() => updateHardware({ isSpeaking: false }));
    submitTyped('Deliberate later question');
    await flush();
    expect(chats).toHaveLength(2);
    await finishChat(1, 'Later reply');
  });

  it('a voice finalizer refused after typed streaming begins retains its transcript', async () => {
    mountCoach();
    submitTyped('Typed request');
    await flush();
    await sendVoice('Keep this spoken draft');
    expect(chats).toHaveLength(1);
    expect(hardware.transcript).toBe('Keep this spoken draft');
    expect(clearTranscript).not.toHaveBeenCalled();
    await finishChat(0, 'Typed reply');
    expect(speak).not.toHaveBeenCalled();
  });

  it('voice HTTP 503 then typed success stays silent; a later genuine voice reply speaks', async () => {
    mountCoach(); nextHttpError = true;
    await sendVoice('First voice question');
    expect(screen.getByTestId('message-assistant-1')).toHaveTextContent('Synthetic voice failure');
    expect(speak).not.toHaveBeenCalled();
    submitTyped('Typed follow-up');
    await flush();
    await finishChat(1, 'Silent typed reply');
    expect(speak).not.toHaveBeenCalled();
    await sendVoice('Later voice question');
    await finishChat(2, 'Spoken reply');
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith('Spoken reply', 'en', 1);
  });

  it.each(['saved', 'failed'])('%s memo waits for the final receipt before speech, refresh and durable confirmation', async outcome => {
    mountCoach();
    fireEvent.click(screen.getByTestId('button-toggle-notes'));
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Reported memos' }), { button: 0, ctrlKey: false });
    await flush();
    const notesBefore = notesReads; const memosBefore = memoReads;
    expect(memosBefore).toBe(1);
    await sendVoice('Please report the map issue');
    await act(async () => { chats[0].stream.event({ delta: 'Saved your report.' }); });
    await flush();
    expect(speak).not.toHaveBeenCalled();
    expect(notesReads).toBe(notesBefore);
    expect(memoReads).toBe(memosBefore);
    const receipt = { id: 'receipt-fixture', title: 'Synthetic map issue', type: 'bug', created_at: '2026-09-11T02:30:00Z' };
    if (outcome === 'saved') savedMemos = [{ ...receipt, detail: 'Synthetic detail', status: 'new' }];
    await act(async () => {
      chats[0].stream.event({ done: true, response_text: 'Report processed.', actions_result: outcome === 'saved'
        ? { saved: 1, memos: [receipt], errors: [] }
        : { saved: 0, errors: ['Memo write failed'] } });
      chats[0].stream.end();
    });
    await flush();
    expect(speak).toHaveBeenCalledTimes(1);
    const durableReply = history()[1].content;
    expect(durableReply).not.toContain('Saved your report.');
    if (outcome === 'saved') {
      expect(durableReply).toContain('Saved reported memo: Synthetic map issue (receipt receipt-)');
      expect(screen.getByText('Synthetic map issue')).toBeInTheDocument();
      expect(notesReads).toBe(notesBefore + 1);
      expect(memoReads).toBe(memosBefore + 1);
    } else {
      expect(durableReply).toContain('not saved: Memo write failed');
      expect(notesReads).toBe(notesBefore);
      expect(memoReads).toBe(memosBefore);
      expect(String(speak.mock.calls[0][0])).not.toContain('Saved your report.');
    }
  });

  it.each(['silence', 'manual', 'stop-phrase'])('unmount cancels a pending %s finalizer before it can send or restart the mic', async finalizer => {
    const view = mountCoach();
    if (finalizer === 'silence') scheduleVoice('Unsent voice draft');
    else {
      act(() => updateHardware({ transcript: finalizer === 'stop-phrase' ? 'Unsent voice draft send it' : 'Unsent voice draft', isListening: true }));
      // 2026-09-15: the default voice mode is gpt-live, which does not render the classic
      // CoachStopBar; the listening indicator's "Done" button calls the same handleMicToggle
      // (manual finalizer) in every mode, so the case still exercises the manual path.
      if (finalizer === 'manual') fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    }
    view.unmount();
    const startsBefore = startMic.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(500); });
    await flush();
    expect(chats).toHaveLength(0);
    expect(startMic).toHaveBeenCalledTimes(startsBefore);
    expect(speak).not.toHaveBeenCalled();
  });

  it.each(['Strategy', 'Briefing'])('authorized playback continues ordinary navigation to %s', async destination => {
    localStorage.setItem(STORAGE_KEYS.COACH_AUTO_LISTEN_ENABLED, 'true');
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: jest.fn(async () => ({ getTracks: () => [{ stop: jest.fn() }] })),
    } });
    function Navigation() {
      const [page, setPage] = useState('Coach');
      return <><button onClick={() => setPage(destination)}>Navigate</button>{page === 'Coach'
        ? <RideshareCoach userId="driver-fixture" snapshotId="snapshot-fixture" /> : <p>{page}</p>}</>;
    }
    render(<Navigation />);
    await flush();
    await sendVoice('Read this while I check my plan');
    await finishChat(0, 'Already authorized speech');
    expect(hardware.isSpeaking).toBe(true);
    const stopsBefore = stopSpeak.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Navigate' }));
    await flush();
    expect(screen.getByText(destination)).toBeInTheDocument();
    expect(hardware.isSpeaking).toBe(true);
    expect(stopSpeak).toHaveBeenCalledTimes(stopsBefore);
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it('an account switch stops prior-account playback while ordinary navigation remains separate', async () => {
    const view = mountCoach();
    await sendVoice('Private question for account A');
    await finishChat(0, 'Private answer for account A');
    expect(hardware.isSpeaking).toBe(true);
    view.rerender(<RideshareCoach userId="driver-b" snapshotId="snapshot-b" />);
    await flush();
    expect(hardware.isSpeaking).toBe(false);
    expect(stopSpeak).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Private answer for account A')).not.toBeInTheDocument();
  });

  it('leaving after speech ends cancels the delayed microphone restart', async () => {
    localStorage.setItem(STORAGE_KEYS.COACH_AUTO_LISTEN_ENABLED, 'true');
    const view = mountCoach();
    await flush();
    await sendVoice('Read this answer');
    await finishChat(0, 'Finished speech');
    act(() => updateHardware({ isSpeaking: false }));
    const startsBefore = startMic.mock.calls.length;
    view.unmount();
    await act(async () => { jest.advanceTimersByTime(500); });
    expect(startMic).toHaveBeenCalledTimes(startsBefore);
  });
});
