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

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { API_ROUTES } from '@/constants/apiRoutes';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { GeminiLiveSession } from '@/lib/voice/GeminiLiveSession';
import { RealtimeSession } from '@/lib/voice/RealtimeSession';
import { askCoachBrain, type CoachBrainParams } from '@/lib/voice/coachBrain';
import { applyDonePayload } from '@/utils/coach/actionsResult';
import type { ThreadTurn, VoiceMode, VoiceSession, VoiceSessionStatus } from '@/lib/voice/types';

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

// 2026-08-14 (Melody: "keeping that mic on but with a trigger word instead
// for hands off approach"): wake-phrase resume. While PAUSED the live session
// hears nothing (unchanged — frames dropped, track disabled); a local
// SpeechRecognition watches for the wake phrase and resumes the session mic.
// The tap-to-talk invariant holds: reactivation only by the driver's explicit
// act — now a tap OR the wake phrase. End remains final: the wake watcher
// runs ONLY during pause, never after End/idle.
const WAKE_REGEX = /\b(?:hey|okay|ok)[,\s]+coach\b|\bresume listening\b/i;

/** Minimal browser SpeechRecognition surface (vendor-prefixed, untyped in TS). */
interface WakeRecognizer {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: Array<Array<{ transcript?: string }>> }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

// 2026-08-14: defense-in-depth against relay-marker mimicry. The live test
// showed the mouth prefixing its OWN answers with the relay marker it was
// taught ("[[COACH_RELAY]] ..." appeared verbatim in coach transcript lines).
// The envelope is now plain prose (types.ts), and this strips any residue —
// old-style markers and copied relay-note phrasing — from mouth transcripts.
function sanitizeMouthText(text: string): string {
  return text
    .replace(/\[?\[?COACH[_ ]?RELAY\]?\]?:?\s*/gi, '')
    .replace(/\(Relay note[^)]*\)\s*/gi, '')
    // 2026-08-14 live test: the mouth SPOKE its tool call ("Call
    // ask_coach_backend with..."). Audio can't be unsaid, but the screen
    // stays clean: drop narrated-call sentences, soften stray tool names.
    .replace(/[^.?!]*\bcall\s+ask[_ ]?coach[_ ]?backend\b[^.?!]*[.?!]?/gi, '')
    .replace(/\bask[_ ]?coach[_ ]?backend\b/gi, 'the coach system')
    .trim();
}

// 2026-08-14: links from a voice brain answer must reach the SCREEN — the
// mouth speaks a TTS-cleaned rendition ("link is in the chat") and the actual
// tappable link lands in the thread. Markdown links keep their label; bare
// Google Maps links get a decoded destination label (live test: a naked
// URL-encoded link left Melody asking "I don't know what it's for").
function labelForBareUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('google.com') && u.pathname.startsWith('/maps')) {
      const q = u.searchParams.get('query');
      if (q) return `Map to ${q}`;
    }
  } catch { /* unparseable URL — no label */ }
  return null;
}

function extractLinksMessage(displayText: string): string | null {
  const lines: string[] = [];
  const seen = new Set<string>();
  const mdLinks = displayText.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g);
  for (const m of mdLinks) {
    if (!seen.has(m[2])) { seen.add(m[2]); lines.push(`🔗 ${m[1]}: ${m[2]}`); }
  }
  const bare = displayText.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '').matchAll(/https?:\/\/[^\s<>"')\]]+/g);
  for (const m of bare) {
    if (!seen.has(m[0])) {
      seen.add(m[0]);
      const label = labelForBareUrl(m[0]);
      lines.push(label ? `🔗 ${label}: ${m[0]}` : `🔗 ${m[0]}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

// 2026-08-14 (voice-turns): debounce window for batching committed voice
// turns into one POST /api/chat/voice-turns (server persists them verbatim
// as 'voice_transcript' rows — the Coach learning loop's capture end).
const VOICE_TURN_FLUSH_MS = 3_000;

export interface UseVoiceSessionParams extends CoachBrainParams {
  /** Append a committed voice turn to the chat thread (unified thread). */
  onVoiceTurnFinal?: (role: 'user' | 'assistant', text: string) => void;
  /** Brain-call action side-effects — same handlers classic mode uses. */
  onNotesSaved?: () => void;
  onActionError?: (messages: string[]) => void;
  /**
   * 2026-08-14 (brain-hears/continuity): component-owned, render-time-fresh
   * mirror of the committed visible thread (text turns only — no attachment
   * or synthesized link messages). Brain calls send it as threadHistory;
   * engines read it via getThreadTail at (re)connect. A ref, not state —
   * RideshareCoach reassigns .current each render.
   */
  threadTailRef?: MutableRefObject<ThreadTurn[]>;
}

export function useVoiceSession(params: UseVoiceSessionParams) {
  const [mode, setModeState] = useState<VoiceMode>(getStoredVoiceMode);
  const [status, setStatus] = useState<VoiceSessionStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string | undefined>(undefined);
  const [interimUser, setInterimUser] = useState('');
  const [interimModel, setInterimModel] = useState('');
  const [micPaused, setMicPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 2026-08-14 (checking indicator): true while ≥1 brain call is in flight.
  // Deterministic — set/cleared around the actual await in the brain wrapper
  // (the one true begin/end boundary for both engines), never inferred from
  // the mouth's speech.
  const [checking, setChecking] = useState(false);
  const sessionRef = useRef<VoiceSession | null>(null);
  // Concurrent brain-call counter behind `checking` — calls can overlap, so
  // count, don't boolean-toggle. Declared before the callbacks that capture
  // it (React Compiler contract — lessons_learned #28).
  const checkingCountRef = useRef(0);
  // 2026-08-14 (voice-turns): committed turns queue here between debounce
  // flushes; the timer arms on the first queued turn and drains the batch.
  const pendingTurnsRef = useRef<ThreadTurn[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  // Wake-phrase watcher (browser SpeechRecognition), alive only while paused.
  // Declared before every callback that captures it (React Compiler contract).
  const wakeRecRef = useRef<WakeRecognizer | null>(null);
  // Links from a brain answer wait here until the mouth's SPOKEN answer has
  // committed to the thread — a naked link arriving before any explanation
  // confused the live test ("I don't know what it's for").
  const pendingLinksRef = useRef<string | null>(null);
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

  // 2026-08-14 (voice-turns): drain the pending queue into one POST. Capture
  // is BEST-EFFORT: a failed flush warns (counts only — never turn content)
  // and DROPS the batch; no retry loop may ever disturb the live session.
  // Always clears the debounce timer first so stop()/unmount leave nothing
  // armed.
  const flushPendingTurns = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (pendingTurnsRef.current.length === 0) return;
    const conversationId = conversationIdRef.current;
    if (!conversationId) {
      // No conversation to attach to — drop rather than leak turns into a
      // future session's thread.
      pendingTurnsRef.current = [];
      return;
    }
    const turns = pendingTurnsRef.current;
    pendingTurnsRef.current = [];
    const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    void fetch(API_ROUTES.CHAT.VOICE_TURNS, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({
        conversationId,
        snapshotId: paramsRef.current.snapshotId,
        turns,
      }),
      // The end-of-session batch must survive unmount/tab-leave.
      keepalive: true,
    })
      .then((res) => {
        if (!res.ok) console.warn(`[useVoiceSession] voice-turns flush HTTP ${res.status} — dropped ${turns.length} turn(s)`);
      })
      .catch(() => {
        console.warn(`[useVoiceSession] voice-turns flush failed — dropped ${turns.length} turn(s)`);
      });
  }, []);

  // Queue one committed turn; arm the debounce timer on the first. Only the
  // onUserTurnFinal / onModelTurnFinal events feed this — client-synthesized
  // link messages and relay speech never pass through those events (relay
  // transcripts are suppressed engine-side), so neither can land here.
  const queueVoiceTurn = useCallback((role: 'user' | 'assistant', content: string) => {
    if (!conversationIdRef.current) return; // no session thread to attach to
    const trimmed = content.trim();
    if (!trimmed) return; // server 400s empty content — would reject the batch
    // Server contract caps a turn at 4000 chars; an over-cap turn would 400
    // the whole batch, so cap here (visible truncation beats a dropped batch).
    pendingTurnsRef.current.push({ role, content: trimmed.slice(0, 4000) });
    if (flushTimerRef.current === null) {
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        flushPendingTurns();
      }, VOICE_TURN_FLUSH_MS);
    }
  }, [flushPendingTurns]);

  const stop = useCallback(() => {
    // End is FINAL: kill the wake watcher too — nothing listens after End.
    const rec = wakeRecRef.current;
    wakeRecRef.current = null;
    try { rec?.stop(); } catch { /* already stopped */ }
    brainAbortRef.current?.abort();
    brainAbortRef.current = null;
    // 2026-08-14 (voice-turns): session.stop() runs BEFORE the conversation
    // id is nulled — engines synchronously commit any buffered final turn
    // (queued via onModelTurnFinal) and emit 'ended', whose handler flushes
    // while conversationIdRef is still set. The direct flush below is the
    // backstop for the no-session path (stop() while already idle).
    sessionRef.current?.stop();
    sessionRef.current = null;
    flushPendingTurns();
    conversationIdRef.current = null;
    // Backstop: links never vanish because the session died before the
    // spoken answer committed.
    const links = pendingLinksRef.current;
    if (links) {
      pendingLinksRef.current = null;
      paramsRef.current.onVoiceTurnFinal?.('assistant', links);
    }
    setStatus('idle');
    setStatusDetail(undefined);
    setInterimUser('');
    setInterimModel('');
    setMicPaused(false);
  }, [flushPendingTurns]);

  const stopWakeWatch = useCallback(() => {
    const rec = wakeRecRef.current;
    wakeRecRef.current = null; // null BEFORE stop so onend doesn't restart it
    try { rec?.stop(); } catch { /* already stopped */ }
  }, []);

  // Tap-to-talk: pause mutes the session mic but keeps the session warm.
  // Resume happens ONLY from the driver's explicit act — a tap or the wake
  // phrase (see invariant in the header). Defined before start() so the
  // events closure below can invoke them.
  const resumeMic = useCallback(() => {
    stopWakeWatch();
    sessionRef.current?.resumeMic();
    setMicPaused(false);
  }, [stopWakeWatch]);

  const startWakeWatch = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR || wakeRecRef.current) return; // unsupported → tap still resumes
    const rec: WakeRecognizer = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0]?.transcript ?? '';
      }
      if (WAKE_REGEX.test(text)) resumeMic();
    };
    rec.onend = () => {
      // Browser recognizers self-terminate periodically — restart while the
      // pause (and only the pause) is still in force.
      if (wakeRecRef.current === rec) {
        try { rec.start(); } catch { /* already running */ }
      }
    };
    wakeRecRef.current = rec;
    try { rec.start(); } catch { /* mic busy/denied — tap still works */ }
  }, [resumeMic]);

  const pauseMic = useCallback(() => {
    sessionRef.current?.pauseMic();
    setMicPaused(true);
    startWakeWatch();
  }, [startWakeWatch]);

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
          // 2026-08-14 (voice-turns): flush BEFORE nulling the conversation
          // id (the batch body needs it) — 'ended' can also arrive from the
          // server side (socket close) where stop() never ran.
          flushPendingTurns();
          sessionRef.current = null;
          conversationIdRef.current = null;
        }
      },
      onUserTranscriptDelta: (text: string) => setInterimUser(text),
      onUserTurnFinal: (text: string) => {
        setInterimUser('');
        paramsRef.current.onVoiceTurnFinal?.('user', text);
        // 2026-08-14 (voice-turns): queue BEFORE the control regexes — a
        // "goodbye coach" turn belongs to the record, and stop() flushes it.
        queueVoiceTurn('user', text);
        // Verbal controls — deterministic, evaluated on the committed turn.
        // Stop wins over pause when both match. Resume after a verbal pause
        // is PHYSICAL only (the mic is off — it cannot hear "resume").
        if (VOICE_STOP_REGEX.test(text)) {
          stop();
        } else if (VOICE_PAUSE_REGEX.test(text)) {
          pauseMic();
        }
      },
      onModelTranscriptDelta: (text: string) => setInterimModel(sanitizeMouthText(text)),
      onModelTurnFinal: (text: string) => {
        setInterimModel('');
        const clean = sanitizeMouthText(text);
        if (clean) {
          paramsRef.current.onVoiceTurnFinal?.('assistant', clean);
          // 2026-08-14 (voice-turns): the sanitized on-screen turn is what
          // persists. The 🔗 links message below stays OUT of the queue —
          // it is client-synthesized and never passes through this event.
          queueVoiceTurn('assistant', clean);
        }
        // The spoken answer is on screen — now its links make sense.
        const links = pendingLinksRef.current;
        if (links) {
          pendingLinksRef.current = null;
          paramsRef.current.onVoiceTurnFinal?.('assistant', links);
        }
      },
      onError: (message: string) => setError(message),
    };
    // 2026-08-14 (checking indicator): this wrapper is the ONE true begin/end
    // boundary of a brain call for both engines — the deterministic `checking`
    // flag lives here (the component renders its "checking…" line off it,
    // engine-agnostic), never inferred from what the mouth says.
    const brain = async (question: string) => {
      checkingCountRef.current += 1;
      setChecking(true);
      try {
        return await askCoachBrain(
          {
            ...paramsRef.current,
            conversationId: conversationIdRef.current ?? undefined,
            signal: brainAbortRef.current?.signal,
            // 2026-08-14 (brain-hears): the committed visible thread rides
            // along so the brain answers in context. Copied — the component
            // reassigns the ref's array each render, and the request must
            // carry a stable snapshot of it.
            threadHistory: paramsRef.current.threadTailRef?.current
              ? [...paramsRef.current.threadTailRef.current]
              : undefined,
            onActionsResult: (payload) =>
              applyDonePayload(payload, {
                onNotesSaved: paramsRef.current.onNotesSaved,
                onActionError: paramsRef.current.onActionError,
              }),
            // Links in the brain's answer surface as a tappable thread message
            // (the mouth's spoken transcript can't carry them). Buffered until
            // the spoken answer commits — see pendingLinksRef.
            onBrainAnswer: (displayText) => {
              const links = extractLinksMessage(displayText);
              if (links) pendingLinksRef.current = links;
            },
          },
          question
        );
      } finally {
        checkingCountRef.current -= 1;
        if (checkingCountRef.current === 0) setChecking(false);
      }
    };
    const opts = {
      userId: params.userId,
      snapshotId: params.snapshotId,
      events,
      askCoachBrain: brain,
      // 2026-08-14 (continuity): render-time-fresh committed-thread reader —
      // engines call it at (re)connect to bridge recent conversation into a
      // fresh session's instructions (formatThreadTail caps it there).
      getThreadTail: () => paramsRef.current.threadTailRef?.current ?? [],
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
  }, [mode, params.userId, params.snapshotId, stop, pauseMic, flushPendingTurns, queueVoiceTurn]);

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
    /** True while ≥1 brain call is in flight (deterministic, engine-agnostic). */
    checking,
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
