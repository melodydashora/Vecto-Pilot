// client/src/hooks/coach/useVoiceSession.ts
// 2026-08-11 (todo #33): React lifecycle for the Coach voice switcher.
// Owns the mode (persisted), the active session instance, and the state the
// Coach tab renders (status, transcripts, error). Classic mode means "no
// live session" — the existing STT/TTS pipeline stays untouched as the
// control arm and safety net.

import { useCallback, useEffect, useRef, useState } from 'react';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { GeminiLiveSession } from '@/lib/voice/GeminiLiveSession';
import { RealtimeSession } from '@/lib/voice/RealtimeSession';
import { askCoachBrain, type CoachBrainParams } from '@/lib/voice/coachBrain';
import type { VoiceMode, VoiceSession, VoiceSessionStatus } from '@/lib/voice/types';

const VALID_MODES: VoiceMode[] = ['classic', 'gemini', 'openai'];

export function getStoredVoiceMode(): VoiceMode {
  const stored = localStorage.getItem(STORAGE_KEYS.COACH_VOICE_MODE) as VoiceMode | null;
  return stored && VALID_MODES.includes(stored) ? stored : 'classic';
}

export type UseVoiceSessionParams = CoachBrainParams;

export function useVoiceSession(params: UseVoiceSessionParams) {
  const [mode, setModeState] = useState<VoiceMode>(getStoredVoiceMode);
  const [status, setStatus] = useState<VoiceSessionStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string | undefined>(undefined);
  const [userLine, setUserLine] = useState('');
  const [modelLine, setModelLine] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);
  // Latest brain params without re-creating callbacks per render
  // (useSpeechRecognition's optionsRef pattern).
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setStatus('idle');
    setStatusDetail(undefined);
  }, []);

  const start = useCallback(async () => {
    if (mode === 'classic' || sessionRef.current) return;
    setError(null);
    setUserLine('');
    setModelLine('');

    const events = {
      onStatus: (s: VoiceSessionStatus, detail?: string) => {
        setStatus(s);
        setStatusDetail(detail);
        if (s === 'ended') sessionRef.current = null;
      },
      onUserTranscript: (text: string, final: boolean) => {
        setUserLine((prev) => (final ? text : prev + text));
      },
      onModelTranscript: (text: string, final: boolean) => {
        setModelLine((prev) => (final ? text : prev + text));
      },
      onError: (message: string) => setError(message),
    };
    const brain = (question: string) => askCoachBrain(paramsRef.current, question);
    const opts = {
      userId: params.userId,
      snapshotId: params.snapshotId,
      events,
      askCoachBrain: brain,
    };

    const session: VoiceSession =
      mode === 'gemini' ? new GeminiLiveSession(opts) : new RealtimeSession(opts);
    sessionRef.current = session;
    try {
      await session.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'voice session failed to start';
      setError(message);
      setStatus('error');
      session.stop();
      sessionRef.current = null;
    }
  }, [mode, params.userId, params.snapshotId]);

  const setMode = useCallback((next: VoiceMode) => {
    stop();
    setError(null);
    localStorage.setItem(STORAGE_KEYS.COACH_VOICE_MODE, next);
    setModeState(next);
  }, [stop]);

  // Tab leave / unmount → tear the session down (mic must never outlive the tab).
  useEffect(() => stop, [stop]);

  return {
    mode,
    setMode,
    status,
    statusDetail,
    isLive: status === 'live' || status === 'connecting',
    userLine,
    modelLine,
    error,
    start,
    stop,
  };
}
