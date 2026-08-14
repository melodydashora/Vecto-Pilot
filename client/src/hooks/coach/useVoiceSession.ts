// client/src/hooks/coach/useVoiceSession.ts
// 2026-08-11 (todo #33): React lifecycle for the Coach voice switcher.
// Owns the mode (persisted), the active session instance, and the state the
// Coach tab renders (status, interim transcripts, error). Classic mode means
// "no live session" — the existing STT/TTS pipeline stays untouched as the
// control arm and safety net.
//
// 2026-08-14 (unified voice thread — Melody: "voice back and forth inside the
// normal box"): committed turns leave this hook via onVoiceTurnFinal and
// become messages in the SAME chat thread as typed exchanges; only interim
// (in-progress) lines live here. The hook also owns the per-session
// conversationId shared with useCoachChat so typed + spoken exchanges thread
// under one coach_conversations id server-side.
//
// TAP-TO-TALK INVARIANT (Melody, verbatim: "it won't reactivate until I call
// on it"): this hook contains ZERO effects that call start() or resumeMic().
// Both are reachable only from explicit user actions. Keep it that way.

import { useCallback, useEffect, useRef, useState } from 'react';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { GeminiLiveSession } from '@/lib/voice/GeminiLiveSession';
import { RealtimeSession } from '@/lib/voice/RealtimeSession';
import { askCoachBrain, type CoachBrainParams } from '@/lib/voice/coachBrain';
import { applyDonePayload } from '@/utils/coach/actionsResult';
import type { VoiceMode, VoiceSession, VoiceSessionStatus } from '@/lib/voice/types';

const VALID_MODES: VoiceMode[] = ['classic', 'gemini', 'openai'];

// 2026-08-14 (Melody, A/B verdict): "not two different coaches, just Gemini
// Live that can also pause for uploads." Gemini Live IS the Coach voice:
// - default is 'gemini' (was 'classic')
// - a stored 'openai' migrates to 'gemini' (the dropdown that set it is gone)
// - 'classic' is honored ONLY as a deliberate devtools escape hatch
//   (localStorage.setItem(COACH_VOICE_MODE, 'classic')) — no UI sets it.
export function getStoredVoiceMode(): VoiceMode {
  const stored = localStorage.getItem(STORAGE_KEYS.COACH_VOICE_MODE) as VoiceMode | null;
  if (stored === 'openai') {
    localStorage.setItem(STORAGE_KEYS.COACH_VOICE_MODE, 'gemini');
    return 'gemini';
  }
  return stored && VALID_MODES.includes(stored) ? stored : 'gemini';
}

// 2026-08-14: verbal controls, DETERMINISTIC (client-side regex on committed
// driver turns) — the mouth model cannot pause the mic, it can only claim to
// (live test 2026-08-14: "Not a problem, pausing requests right now" while
// nothing paused). Word-boundary so "pausing"/"unstoppable" don't fire.
const VOICE_PAUSE_REGEX = /\b(pause|hold on|stop listening|quiet)\b/i;
const VOICE_STOP_REGEX = /\b(goodbye,?\s+coach|end (?:the )?session|conversation complete|we'?re done)\b/i;

// 2026-08-14: links from a voice brain answer must reach the SCREEN — the
// mouth speaks a TTS-cleaned rendition ("link is in the chat") and the actual
// tappable link lands in the thread. Markdown links keep their label.
function extractLinksMessage(displayText: string): string | null {
  const lines: string[] = [];
  const seen = new Set<string>();
  const mdLinks = displayText.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g);
  for (const m of mdLinks) {
    if (!seen.has(m[2])) { seen.add(m[2]); lines.push(`🔗 ${m[1]}: ${m[2]}`); }
  }
  const bare = displayText.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '').matchAll(/https?:\/\/[^\s<>"')\]]+/g);
  for (const m of bare) {
    if (!seen.has(m[0])) { seen.add(m[0]); lines.push(`🔗 ${m[0]}`); }
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

export interface UseVoiceSessionParams extends CoachBrainParams {
  /** Append a committed voice turn to the chat thread (unified thread). */
  onVoiceTurnFinal?: (role: 'user' | 'assistant', text: string) => void;
  /** Brain-call action side-effects — same handlers classic mode uses. */
  onNotesSaved?: () => void;
  onActionError?: (messages: string[]) => void;
}

export function useVoiceSession(params: UseVoiceSessionParams) {
  const [mode, setModeState] = useState<VoiceMode>(getStoredVoiceMode);
  const [status, setStatus] = useState<VoiceSessionStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string | undefined>(undefined);
  const [interimUser, setInterimUser] = useState('');
  const [interimModel, setInterimModel] = useState('');
  const [micPaused, setMicPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);
  // Per-session stable conversation id — consumed by useCoachChat's send()
  // so typed messages during a live session join the same server thread.
  const conversationIdRef = useRef<string | null>(null);
  // Aborts in-flight brain calls when the session ends (their answers would
  // have no session to speak through).
  const brainAbortRef = useRef<AbortController | null>(null);
  // Latest brain params without re-creating callbacks per render
  // (useSpeechRecognition's optionsRef pattern).
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const stop = useCallback(() => {
    brainAbortRef.current?.abort();
    brainAbortRef.current = null;
    conversationIdRef.current = null;
    sessionRef.current?.stop();
    sessionRef.current = null;
    setStatus('idle');
    setStatusDetail(undefined);
    setInterimUser('');
    setInterimModel('');
    setMicPaused(false);
  }, []);

  // Tap-to-talk: pause mutes the mic but keeps the session warm. Resume is
  // ONLY ever called from a user tap (see invariant in the header). Defined
  // before start() so the events closure below can invoke them.
  const pauseMic = useCallback(() => {
    sessionRef.current?.pauseMic();
    setMicPaused(true);
  }, []);

  const resumeMic = useCallback(() => {
    sessionRef.current?.resumeMic();
    setMicPaused(false);
  }, []);

  const start = useCallback(async () => {
    if (mode === 'classic' || sessionRef.current) return;
    setError(null);
    setInterimUser('');
    setInterimModel('');
    setMicPaused(false);
    conversationIdRef.current = crypto.randomUUID();
    brainAbortRef.current = new AbortController();

    const events = {
      onStatus: (s: VoiceSessionStatus, detail?: string) => {
        setStatus(s);
        setStatusDetail(detail);
        if (s === 'ended') {
          sessionRef.current = null;
          conversationIdRef.current = null;
        }
      },
      onUserTranscriptDelta: (text: string) => setInterimUser(text),
      onUserTurnFinal: (text: string) => {
        setInterimUser('');
        paramsRef.current.onVoiceTurnFinal?.('user', text);
        // Verbal controls — deterministic, evaluated on the committed turn.
        // Stop wins over pause when both match. Resume after a verbal pause
        // is PHYSICAL only (the mic is off — it cannot hear "resume").
        if (VOICE_STOP_REGEX.test(text)) {
          stop();
        } else if (VOICE_PAUSE_REGEX.test(text)) {
          pauseMic();
        }
      },
      onModelTranscriptDelta: (text: string) => setInterimModel(text),
      onModelTurnFinal: (text: string) => {
        setInterimModel('');
        paramsRef.current.onVoiceTurnFinal?.('assistant', text);
      },
      onError: (message: string) => setError(message),
    };
    const brain = (question: string) =>
      askCoachBrain(
        {
          ...paramsRef.current,
          conversationId: conversationIdRef.current ?? undefined,
          signal: brainAbortRef.current?.signal,
          onActionsResult: (payload) =>
            applyDonePayload(payload, {
              onNotesSaved: paramsRef.current.onNotesSaved,
              onActionError: paramsRef.current.onActionError,
            }),
          // Links in the brain's answer surface as a tappable thread message
          // (the mouth's spoken transcript can't carry them).
          onBrainAnswer: (displayText) => {
            const links = extractLinksMessage(displayText);
            if (links) paramsRef.current.onVoiceTurnFinal?.('assistant', links);
          },
        },
        question
      );
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
      conversationIdRef.current = null;
    }
  }, [mode, params.userId, params.snapshotId, stop, pauseMic]);

  /** iOS audio unlock — call from any real user gesture (see VoiceSession). */
  const unlockAudio = useCallback(() => {
    sessionRef.current?.unlockAudio();
  }, []);

  /** Speak a chat-screen answer through the live mouth (no-op when idle). */
  const sayText = useCallback((text: string, context?: { userMessage?: string }) => {
    sessionRef.current?.sayText(text, context);
  }, []);

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
    interimUser,
    interimModel,
    micPaused,
    error,
    start,
    stop,
    pauseMic,
    resumeMic,
    sayText,
    unlockAudio,
    conversationIdRef,
  };
}
