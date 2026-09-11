// tests/client/voice-turn-gate.test.tsx
// 2026-09-11: desktop-coach-acceptance items 1 and 4 at the hook/helper seam —
// a failed voice send must not leak speech into the next typed reply, and a busy
// refusal must happen before any transcript-clearing side effect.
import { jest, describe, it, expect } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { createVoiceTurnGate } from '@/utils/coach/voiceTurnGate';
import { useCanonicalVoiceSend } from '@/hooks/coach/useCanonicalVoiceSend';

describe('createVoiceTurnGate', () => {
  it('voice 503 then typed turn: the typed completion is NOT spoken; a later voice turn still is', () => {
    const gate = createVoiceTurnGate();
    gate.arm();                       // voice send admitted
    gate.settle();                    // send settled with NO completion (HTTP 503 / throw / abort)
    expect(gate.armed).toBe(false);
    gate.complete();                  // typed reply completes
    expect(gate.consume()).toBe(false); // read-aloud OFF → silent
    gate.arm(); gate.complete();
    expect(gate.consume()).toBe(true);  // genuine voice success speaks
    gate.settle();
    expect(gate.armed).toBe(false);
  });
  it('a completed voice turn keeps its flag through settle() until the completion handler consumes it', () => {
    const gate = createVoiceTurnGate();
    gate.arm(); gate.complete(); gate.settle();
    expect(gate.armed).toBe(true);
    expect(gate.consume()).toBe(true);
    expect(gate.consume()).toBe(false);
  });
});

describe('useCanonicalVoiceSend admission', () => {
  it('refuses a busy send synchronously, before beforeSend, and reports admission', async () => {
    let release!: () => void;
    const send = jest.fn(() => new Promise<void>(r => { release = r; }));
    const beforeSend = jest.fn();
    const afterSend = jest.fn();
    const { result } = renderHook(() => useCanonicalVoiceSend(send, beforeSend, afterSend));
    let first!: Promise<boolean>, second!: Promise<boolean>;
    act(() => {
      first = result.current('first utterance');
      second = result.current('second utterance');   // same tick: must be refused
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(beforeSend).toHaveBeenCalledTimes(1);       // the refused send never cleared anything
    await expect(second).resolves.toBe(false);
    expect(afterSend).not.toHaveBeenCalled();          // refusal is not a settled send
    act(() => release());
    await expect(first).resolves.toBe(true);
    expect(afterSend).toHaveBeenCalledTimes(1);
    // A deliberate later send works.
    let third!: Promise<boolean>;
    act(() => { third = result.current('third'); });
    act(() => release());
    await expect(third).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('runs afterSend even when the send throws, and empty text is refused', async () => {
    const send = jest.fn(async () => { throw new Error('HTTP 503'); });
    const beforeSend = jest.fn();
    const afterSend = jest.fn();
    const { result } = renderHook(() => useCanonicalVoiceSend(send, beforeSend, afterSend));
    await expect(result.current('   ')).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
    await expect(result.current('hello')).rejects.toThrow('HTTP 503');
    expect(beforeSend).toHaveBeenCalledTimes(1);
    expect(afterSend).toHaveBeenCalledTimes(1);
  });
});
