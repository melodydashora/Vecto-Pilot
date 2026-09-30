// client/src/hooks/coach/useVoiceSession.ts
// Owns the explicit GPT-Live session lifecycle and the resources that belong
// to it: microphone controls, wake listener, backend requests and captions.
// Timed caption fragments retain their provenance. Completed written Coach
// answers join the chat thread under the session's stable conversation ID.
//
// TAP-TO-TALK INVARIANT (Melody, verbatim: "it won't reactivate until I call
// on it"): this hook contains ZERO effects that call start() or resumeMic().
// Both are reachable only from explicit user actions. Keep it that way.

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { API_ROUTES } from '@/constants/apiRoutes';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { GeminiLiveSession } from '@/lib/voice/GeminiLiveSession';
import { GptLiveSession } from '@/lib/voice/GptLiveSession';
import type { LiveTranscriptFragment } from '@/lib/voice/live-transcripts';
import { RealtimeSession } from '@/lib/voice/RealtimeSession';
import { askCoachBrain, type CoachBrainParams } from '@/lib/voice/coachBrain';
import { applyDonePayload } from '@/utils/coach/actionsResult';
import type { ThreadTurn, VoiceMode, VoiceSession, VoiceSessionStatus } from '@/lib/voice/types';

// Melody, 2026-09-12: use OpenAI live voice with the canonical GPT Coach.
// Old provider preferences cannot silently choose a different engine.
export function getStoredVoiceMode(): VoiceMode {
  return 'gpt-live';
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

// Batch voice capture for persistence. GPT-Live sends original fragment JSON
// with voice_transcript_fragment provenance; legacy engines send full turns.
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
  const [liveCaptions, setLiveCaptions] = useState<LiveTranscriptFragment[]>([]);
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
  // Async callbacks belong to the session that created them. A stopped session
  // must never clear, resume, or append into its replacement.
  const sessionEpochRef = useRef(0);
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
  const sessionOwnerRef = useRef<{ userId: string; token: string | null; snapshotId?: string; mode: VoiceMode } | null>(null);
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
    const owner = sessionOwnerRef.current;
    if (!owner) return;
    const token = owner.token;
    void fetch(API_ROUTES.CHAT.VOICE_TURNS, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({
        conversationId,
        voiceMode: owner.mode,
        snapshotId: owner.snapshotId,
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

  // Queue original fragment JSON or a legacy turn. Synthesized link messages
  // do not use this queue. Bound batches to the server's request contract.
  const queueVoiceTurn = useCallback((role: 'user' | 'assistant', content: string) => {
    if (!conversationIdRef.current) return; // no session thread to attach to
    const trimmed = content.trim();
    if (!trimmed) return; // server 400s empty content — would reject the batch
    // Server contract caps a turn at 4000 chars; an over-cap turn would 400
    // the whole batch, so cap here (visible truncation beats a dropped batch).
    pendingTurnsRef.current.push({ role, content: trimmed.slice(0, 4000) });
    if (pendingTurnsRef.current.length >= 40) { flushPendingTurns(); return; }
    if (flushTimerRef.current === null) {
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        flushPendingTurns();
      }, VOICE_TURN_FLUSH_MS);
    }
  }, [flushPendingTurns]);

  const stop = useCallback(() => {
    const owner = sessionOwnerRef.current;
    const canPublish = owner?.userId === paramsRef.current.userId
      && owner?.token === localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
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
    sessionEpochRef.current += 1;
    sessionRef.current = null;
    flushPendingTurns();
    conversationIdRef.current = null;
    sessionOwnerRef.current = null;
    // Backstop: links never vanish because the session died before the
    // spoken answer committed.
    const links = pendingLinksRef.current;
    if (links) {
      pendingLinksRef.current = null;
      if (canPublish) paramsRef.current.onVoiceTurnFinal?.('assistant', links);
    }
    setStatus('idle');
    setStatusDetail(undefined);
    setInterimUser('');
    setInterimModel('');
    setMicPaused(false);
    setChecking(false);
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
    if (!sessionRef.current) return;
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
      if (wakeRecRef.current !== rec) return;
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
    if (!sessionRef.current) return;
    sessionRef.current?.pauseMic();
    setMicPaused(true);
    startWakeWatch();
  }, [startWakeWatch]);

  const start = useCallback(async () => {
    if (mode === 'classic' || sessionRef.current) return;
    const epoch = ++sessionEpochRef.current;
    const owner = { userId: params.userId, token: localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN), snapshotId: params.snapshotId, mode };
    sessionOwnerRef.current = owner;
    const isCurrent = () => sessionEpochRef.current === epoch
      && paramsRef.current.userId === owner.userId
      && localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) === owner.token;
    const guard = <Args extends unknown[]>(callback: (...args: Args) => void) =>
      (...args: Args) => { if (isCurrent()) callback(...args); };
    setError(null);
    setInterimUser('');
    setInterimModel('');
    setLiveCaptions([]);
    setMicPaused(false);
    const conversationId = crypto.randomUUID();
    conversationIdRef.current = conversationId;
    const brainController = new AbortController();
    brainAbortRef.current = brainController;
    checkingCountRef.current = 0;
    setChecking(false);

    const events = {
      onTranscriptFragment: guard((fragment: LiveTranscriptFragment) => {
        setLiveCaptions(previous => [...previous, fragment].slice(-200));
        // Preserve fragment text and session offsets in the existing text column.
        // This is an automatic transcript, not a completed turn or playback receipt.
        queueVoiceTurn(fragment.role, JSON.stringify(fragment));
      }),
      onControl: guard((control: 'pause' | 'stop') => { if (control === 'stop') stop(); else pauseMic(); }),
      onStatus: guard((s: VoiceSessionStatus, detail?: string) => {
        setStatus(s);
        setStatusDetail(detail);
        if (s === 'ended') {
          stopWakeWatch();
          brainController.abort();
          setMicPaused(false);
          setChecking(false);
          // 2026-08-14 (voice-turns): flush BEFORE nulling the conversation
          // id (the batch body needs it) — 'ended' can also arrive from the
          // server side (socket close) where stop() never ran.
          flushPendingTurns();
          sessionRef.current = null;
          conversationIdRef.current = null;
          sessionOwnerRef.current = null;
          sessionEpochRef.current += 1;
        }
      }),
      onUserTranscriptDelta: guard((text: string) => setInterimUser(text)),
      onUserTurnFinal: guard((text: string) => {
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
      }),
      onModelTranscriptDelta: guard((text: string) => setInterimModel(sanitizeMouthText(text))),
      onModelTurnFinal: guard((text: string) => {
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
      }),
      onError: guard((message: string) => setError(message)),
    };
    // 2026-08-14 (checking indicator): this wrapper is the ONE true begin/end
    // boundary of a brain call for both engines — the deterministic `checking`
    // flag lives here (the component renders its "checking…" line off it,
    // engine-agnostic), never inferred from what the mouth says.
    const brain = async (question: string, options?: { answerOnly?: boolean }) => {
      if (!isCurrent() || brainController.signal.aborted) throw new Error('Voice session has ended');
      checkingCountRef.current += 1;
      setChecking(true);
      try {
        return await askCoachBrain(
          {
            ...paramsRef.current,
            authToken: owner.token,
            conversationId,
            signal: brainController.signal,
            answerOnly: options?.answerOnly === true,
            // 2026-08-14 (brain-hears): the committed visible thread rides
            // along so the brain answers in context. Copied — the component
            // reassigns the ref's array each render, and the request must
            // carry a stable snapshot of it.
            threadHistory: paramsRef.current.threadTailRef?.current
              ? [...paramsRef.current.threadTailRef.current]
              : undefined,
            onActionsResult: guard((payload) =>
              applyDonePayload(payload, {
                onNotesSaved: paramsRef.current.onNotesSaved,
                onActionError: paramsRef.current.onActionError,
              })),
            // Links in the brain's answer surface as a tappable thread message
            // (the mouth's spoken transcript can't carry them). Buffered until
            // the spoken answer commits — see pendingLinksRef.
            onBrainAnswer: guard((displayText: string) => {
              if (brainController.signal.aborted) return;
              if (mode === 'gpt-live') {
                paramsRef.current.onVoiceTurnFinal?.('assistant', displayText);
                return;
              }
              const links = extractLinksMessage(displayText);
              if (links) pendingLinksRef.current = links;
            }),
          },
          question
        );
      } finally {
        if (isCurrent()) {
          checkingCountRef.current -= 1;
          if (checkingCountRef.current === 0) setChecking(false);
        }
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
      mode === 'gpt-live' ? new GptLiveSession(opts) : mode === 'gemini' ? new GeminiLiveSession(opts) : new RealtimeSession(opts);
    sessionRef.current = session;
    try {
      await session.start();
    } catch (err) {
      if (!isCurrent()) return;
      const message = err instanceof Error ? err.message : 'voice session failed to start';
      session.stop();
      setError(message);
      setStatus('error');
      sessionRef.current = null;
      conversationIdRef.current = null;
    }
  }, [mode, params.userId, params.snapshotId, stop, pauseMic, stopWakeWatch, flushPendingTurns, queueVoiceTurn]);

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

  // Account replacement and unmount end the old capture session. Its final
  // queued fragments retain the original token/snapshot, even if storage changed.
  useEffect(() => stop, [stop, params.userId]);

  return {
    mode,
    setMode,
    status,
    statusDetail,
    isLive: status === 'live' || status === 'connecting',
    interimUser,
    interimModel,
    liveCaptions,
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
