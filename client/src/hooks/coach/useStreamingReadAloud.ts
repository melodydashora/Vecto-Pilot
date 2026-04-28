// client/src/hooks/coach/useStreamingReadAloud.ts
// Streams TTS audio in sentence-sized chunks as SSE deltas arrive.
//
// 2026-04-27: Step 5 of COACH_PASS2_PHASE_B_PLAN. Buffers deltas, slices at
// sentence boundaries (findSentenceBoundary), cleans each chunk via
// cleanTextForTTS, and feeds them into a FIFO queue drained sequentially via
// the audio hook's speak(). Trades small audio gaps between chunks for a much
// faster word-time-to-first-audio than waiting for the full response.

import { useCallback, useRef } from 'react';
import { findSentenceBoundary } from '@/utils/coach/sentenceBoundary';
import { cleanTextForTTS } from '@/utils/coach/cleanTextForTTS';

export interface UseStreamingReadAloudParams {
  /** Speaks one chunk; should resolve when audio playback completes. */
  speak: (text: string, language?: string) => Promise<void>;
  /** Stops in-flight TTS audio (called during abort). */
  stopSpeak: () => void;
  /** BCP-47 language code; default 'en'. */
  language?: string;
  /** Hard cap per chunk to avoid runaway calls if a single sentence is huge. */
  maxChunkChars?: number;
}

export interface UseStreamingReadAloudReturn {
  /** Append an SSE delta to the buffer; flush any complete sentences to the queue. */
  pushDelta: (delta: string) => void;
  /** Coerce a final flush — drains everything remaining (including malformed tail). */
  flush: () => void;
  /** Cancel: clear queue + buffer, stop in-flight audio. */
  abort: () => void;
}

export function useStreamingReadAloud({
  speak,
  stopSpeak,
  language = 'en',
  maxChunkChars = 1000,
}: UseStreamingReadAloudParams): UseStreamingReadAloudReturn {
  const bufferRef = useRef<string>('');
  const queueRef = useRef<string[]>([]);
  const drainingRef = useRef<boolean>(false);

  // FIFO drain: idempotent (the drainingRef guard prevents concurrent drains).
  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;

    try {
      while (queueRef.current.length > 0) {
        const chunk = queueRef.current.shift();
        if (!chunk) continue;

        try {
          await speak(chunk, language);
        } catch (err) {
          console.warn('[useStreamingReadAloud] chunk speak failed:', err);
        }
      }
    } finally {
      drainingRef.current = false;
    }
  }, [speak, language]);

  // Pull every complete sentence off the buffer and enqueue as TTS chunks.
  const drainBufferToQueue = useCallback(() => {
    while (true) {
      const idx = findSentenceBoundary(bufferRef.current);
      if (idx <= 0) break;

      const sentence = bufferRef.current.slice(0, idx);
      bufferRef.current = bufferRef.current.slice(idx);

      const cleaned = cleanTextForTTS(sentence);
      if (!cleaned) continue;

      const chunk = cleaned.length > maxChunkChars ? cleaned.slice(0, maxChunkChars) : cleaned;
      queueRef.current.push(chunk);
    }
  }, [maxChunkChars]);

  const pushDelta = useCallback((delta: string) => {
    if (!delta) return;
    bufferRef.current += delta;
    drainBufferToQueue();
    void drain();
  }, [drain, drainBufferToQueue]);

  const flush = useCallback(() => {
    if (!bufferRef.current) return;
    // Append a paragraph break — findSentenceBoundary treats it as a boundary
    bufferRef.current += '\n\n';
    drainBufferToQueue();

    // Fallback: if remainder is stranded (e.g. unclosed [...] action tag broke
    // the boundary scanner), emit it as a final chunk so audio doesn't disappear.
    if (bufferRef.current.trim()) {
      const cleaned = cleanTextForTTS(bufferRef.current);
      if (cleaned) queueRef.current.push(cleaned);
      bufferRef.current = '';
    }

    void drain();
  }, [drain, drainBufferToQueue]);

  const abort = useCallback(() => {
    queueRef.current = [];
    bufferRef.current = '';
    stopSpeak();
  }, [stopSpeak]);

  return { pushDelta, flush, abort };
}
