// client/src/hooks/coach/useCoachAudioState.ts
// Aggregates voice/audio state for the Coach: persisted read-aloud
// toggle, browser TTS (useTTS), browser STT (useSpeechRecognition), and
// derived flags reserved for Phase B/C wiring.
//
// 2026-04-27: Step 4 of COACH_PASS2_PHASE_B_PLAN. Renames `voiceEnabled` →
// `readAloudEnabled` with idempotent localStorage migration: read NEW key
// first, fall back to OLD legacy key, write NEW only. Old key intentionally
// left untouched for one-release rollback safety.

import { useCallback, useState } from 'react';
import { useTTS } from '@/hooks/useTTS';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { STORAGE_KEYS } from '@/constants/storageKeys';

export interface UseCoachAudioStateParams {
  /**
   * Chat streaming state (used for `isThinking`/`isStreamingText`/`canBargeIn`
   * derivation). Defaults to `false`. Step 5 wires this from `useCoachChat`.
   */
  chatStreaming?: boolean;
}

/** 2026-04-29: TTS playback speed tier. 1.0 default; 2.0 max (browser timestretch). */
export type CoachPlaybackSpeed = 1.0 | 1.25 | 1.5 | 2.0;

const VALID_PLAYBACK_SPEEDS: readonly CoachPlaybackSpeed[] = [1.0, 1.25, 1.5, 2.0] as const;

export interface UseCoachAudioStateReturn {
  // Persisted preference (renamed from voiceEnabled)
  readAloudEnabled: boolean;
  setReadAloudEnabled: (next: boolean) => void;

  // 2026-04-29: TTS playback speed (1.0 / 1.25 / 1.5 / 2.0×)
  playbackSpeed: CoachPlaybackSpeed;
  setPlaybackSpeed: (next: CoachPlaybackSpeed) => void;

  // TTS state + actions
  isSpeaking: boolean;
  speak: (text: string, language?: string) => Promise<void>;
  stopSpeak: () => void;
  warmUp: () => void;

  // Speech recognition state + actions
  isListening: boolean;
  /** Alias for `isListening` today; reserved name for Phase C Realtime distinction. */
  micSessionActive: boolean;
  micSupported: boolean;
  transcript: string;
  finalTranscript: string;
  interimTranscript: string;
  micError: string | null;
  startMic: (lang?: string) => void;
  stopMic: () => void;
  clearTranscript: () => void;

  // Streaming-derived flags (placeholders until Step 5 wires firstDeltaSeen)
  isThinking: boolean;
  isStreamingText: boolean;
  /** True while audio is playing or chat is streaming — barge-in is meaningful. */
  canBargeIn: boolean;

  // Future / placeholder
  /** Reserved for Phase C OpenAI Realtime / Gemini Live integration. */
  realtimeConnected: boolean;
}

export function useCoachAudioState({ chatStreaming = false }: UseCoachAudioStateParams = {}): UseCoachAudioStateReturn {
  const tts = useTTS();
  const speech = useSpeechRecognition();

  // Idempotent migration: read NEW key first, fall back to LEGACY, write NEW only.
  // Legacy key (vectopilot_coach_voice) intentionally left in place for one release.
  const [readAloudEnabled, setReadAloudEnabledState] = useState<boolean>(() => {
    const next = localStorage.getItem(STORAGE_KEYS.COACH_READ_ALOUD_ENABLED);
    if (next !== null) return next === 'true';
    const legacy = localStorage.getItem(STORAGE_KEYS.COACH_VOICE_ENABLED);
    return legacy === 'true';
  });

  const setReadAloudEnabled = useCallback((next: boolean) => {
    setReadAloudEnabledState(next);
    localStorage.setItem(STORAGE_KEYS.COACH_READ_ALOUD_ENABLED, String(next));
  }, []);

  // 2026-04-29: TTS playback speed (per-device persistence, default 1.0)
  const [playbackSpeed, setPlaybackSpeedState] = useState<CoachPlaybackSpeed>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.COACH_PLAYBACK_SPEED);
    if (stored !== null) {
      const parsed = parseFloat(stored);
      if (VALID_PLAYBACK_SPEEDS.includes(parsed as CoachPlaybackSpeed)) {
        return parsed as CoachPlaybackSpeed;
      }
    }
    return 1.0;
  });

  const setPlaybackSpeed = useCallback((next: CoachPlaybackSpeed) => {
    setPlaybackSpeedState(next);
    localStorage.setItem(STORAGE_KEYS.COACH_PLAYBACK_SPEED, String(next));
  }, []);

  return {
    readAloudEnabled,
    setReadAloudEnabled,
    playbackSpeed,
    setPlaybackSpeed,

    isSpeaking: tts.isSpeaking,
    speak: tts.speak,
    stopSpeak: tts.stop,
    warmUp: tts.warmUp,

    isListening: speech.isListening,
    micSessionActive: speech.isListening,
    micSupported: speech.isSupported,
    transcript: speech.transcript,
    finalTranscript: speech.finalTranscript,
    interimTranscript: speech.interimTranscript,
    micError: speech.error,
    startMic: speech.start,
    stopMic: speech.stop,
    clearTranscript: speech.clear,

    // Step 5 will split these via firstDeltaSeen; today both collapse to chatStreaming.
    isThinking: chatStreaming,
    isStreamingText: false,
    canBargeIn: tts.isSpeaking || chatStreaming,

    realtimeConnected: false,
  };
}
