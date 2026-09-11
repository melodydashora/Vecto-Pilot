import { useCallback, useRef } from 'react';

// Silence, manual send and the spoken send phrase may finalize the same turn.
// Claim it synchronously before any UI update or asynchronous chat request.
// 2026-09-11: resolves to whether the turn was ADMITTED (a busy or empty send is refused
// synchronously, before beforeSend, so the caller keeps its transcript), and runs
// afterSend when the admitted send settles — success, HTTP error, throw or abort — so
// the caller can drop a voice flag that no completion consumed (desktop-coach-acceptance
// items 1 and 4).
export function useCanonicalVoiceSend(
  send: (text: string) => Promise<void>,
  beforeSend: () => void,
  afterSend?: () => void,
) {
  const sending = useRef(false);
  return useCallback(async (text: string): Promise<boolean> => {
    if (sending.current || !text.trim()) return false;
    sending.current = true;
    try {
      beforeSend();
      await send(text.trim());
    } finally {
      sending.current = false;
      afterSend?.();
    }
    return true;
  }, [send, beforeSend, afterSend]);
}
