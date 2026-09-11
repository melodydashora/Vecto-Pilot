import { useCallback, useRef } from 'react';

// Silence, manual send and the spoken send phrase may finalize the same turn.
// Claim it synchronously before any UI update or asynchronous chat request.
export function useCanonicalVoiceSend(send: (text: string) => Promise<void>, beforeSend: () => void) {
  const sending = useRef(false);
  return useCallback(async (text: string) => {
    if (sending.current || !text.trim()) return;
    sending.current = true;
    try {
      beforeSend();
      await send(text.trim());
    } finally {
      sending.current = false;
    }
  }, [send, beforeSend]);
}
