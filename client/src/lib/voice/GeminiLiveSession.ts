// client/src/lib/voice/GeminiLiveSession.ts
// 2026-08-11 (todo #33): Gemini Live arm of the Coach voice switcher.
//
// Transport (live-verified 2026-08-11): the Live API is WebSocket-only.
// Auth: single-use ephemeral token minted by our backend
// (POST /api/gemini-live/token — ownership-checked, model-locked) used as the
// SDK apiKey; the real GEMINI_API_KEY never reaches the browser.
// Audio: PCM16 16 kHz up / 24 kHz down (pcm.ts). Barge-in: server VAD sends
// serverContent.interrupted → flush playback.
// Tools: google_search + ask_coach_backend COMBINE in one session (verified,
// ai.google.dev/gemini-api/docs/live-tools). Function calling is SYNCHRONOUS
// on gemini-3.1-flash-live-preview: the model waits for the tool response,
// which is why the mouth prompt tells it to acknowledge before calling.
//
// iOS note (verified against iOS 26.6 + 27 beta): backgrounding suspends the
// socket AND audio. Treated as an expected disconnect — the driver restarts
// with a tap on return (todo #37 tracks the native shell for true background
// voice).
//
// 2026-08-14 (session continuity): the session no longer dies with the socket.
// sessionResumption handles + goAway-aware transparent reconnect live in
// connectLive()/scheduleReconnect(); fresh (handle-less) connects bridge the
// recent chat thread into the instructions so a reborn mouth still knows the
// conversation. SDK surface verified in @google/genai 1.52.0 genai.d.ts:
// LiveConnectConfig.sessionResumption?: SessionResumptionConfig {handle?,
// transparent?}; LiveServerMessage.sessionResumptionUpdate {newHandle?,
// resumable?}; LiveServerMessage.goAway {timeLeft?}.

import { GoogleGenAI, Modality, Type } from '@google/genai';
import { API_ROUTES } from '@/constants/apiRoutes';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { MicCapture, PcmPlayer } from './pcm';
import {
  type VoiceSession,
  type VoiceSessionOptions,
  type VoiceTokenContext,
  buildMouthInstructions,
  buildRelayEnvelope,
  formatThreadTail,
  ASK_COACH_TOOL,
} from './types';

interface MintResponse {
  ok: boolean;
  token: string;
  model: string;
  /** Optional mouth thinking (server env knob GEMINI_LIVE_THINKING_BUDGET;
   *  -1 = dynamic). Absent = no thinkingConfig — the low-latency default. */
  thinkingBudget?: number;
  context?: VoiceTokenContext;
  error?: string;
}

export class GeminiLiveSession implements VoiceSession {
  readonly mode = 'gemini' as const;
  private opts: VoiceSessionOptions;
  private mic = new MicCapture();
  private player = new PcmPlayer();
  // SDK live session — typed loosely; the SDK's live surface is still
  // evolving alongside the preview models (see registry deprecation notes).
  private session: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
  private stopped = false;

  // 2026-08-14 (unified voice thread): the session owns turn accumulation.
  // Transcription events arrive as fragments; the old (text, final) surface
  // let a final fragment REPLACE the accumulated line upstream.
  private userBuf = '';
  private modelBuf = '';
  private modelSpeaking = false;
  // Relay machinery (sayText): queue while the model is mid-turn — a
  // turnComplete:true client turn mid-generation risks cancelling the ongoing
  // spoken answer. suppressRelayTurn skips the relay response's OWN transcript
  // events (the answer text is already in the chat thread).
  private sayQueue: string[] = [];
  private suppressRelayTurn = false;

  // 2026-08-14 (session continuity): newest resumable handle from the server's
  // sessionResumptionUpdate messages — latest wins; presented on reconnect so
  // the server restores the session's real state (memory survives the socket).
  private resumeHandle: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // goAway received: the server announced it will drop the socket (connection
  // rotation / session time limit) — the coming onclose is expected, not a
  // failure. State marker only today; a future preemptive-reconnect path (or
  // debugging) reads it to tell orderly drops from network loss.
  private reconnectExpected = false;
  // Review 2026-08-14 (confirmed 3/3): a brain call resolving while the
  // socket is down (reconnect window) must not drop its tool response — the
  // model waits SYNCHRONOUSLY on it, so a handle-resumed session would sit on
  // a forever-pending call ("let me check that…" then permanent silence).
  // Stashed here; delivered after a handle-resume, discarded (with a warn) on
  // a fresh connect where the call id no longer exists.
  private pendingToolResponses: Array<{ id: string; answer: string }> = [];

  constructor(opts: VoiceSessionOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    const { events } = this.opts;
    events.onStatus('connecting');

    // Synchronously inside the tap, before any await:
    // 1. Unlock the PLAYBACK context (iOS suspends contexts created later —
    //    2026-08-11 device test: live session, transcripts, no sound).
    this.player.unlock();
    // 2. Declare two-way-call audio routing (Safari 16.4+ Audio Session API):
    //    keeps playback audible with the ringer switch off and pairs
    //    mic + speaker routes. Routing-only — not a background entitlement.
    try {
      (navigator as any).audioSession.type = 'play-and-record';
    } catch { /* API absent outside Safari — fine */ }

    // 3. Mic first — keeps getUserMedia inside the user-gesture chain (iOS).
    //    2026-08-14 (session continuity): the mic starts HERE, ONCE, and
    //    persists across reconnects — its frames no-op while this.session is
    //    null, so a reborn socket needs no new gesture and no re-getUserMedia
    //    (playback context is already unlocked, pause state untouched).
    //    Mic-before-mint is a deliberate reorder: getUserMedia now sits even
    //    closer to the tap, and a failed mint still releases the mic because
    //    useVoiceSession calls session.stop() when start() throws.
    await this.mic.start((b64) => {
      // Session may still be connecting for the first ~200ms (and is null
      // during a reconnect window); drop until live.
      this.session?.sendRealtimeInput({
        audio: { data: b64, mimeType: 'audio/pcm;rate=16000' },
      });
    });

    // Review 2026-08-14 (confirmed 3/3): stop() may have raced the pending
    // getUserMedia — its mic.stop() no-oped because the capture graph didn't
    // exist yet. Without this check the mic stays hot forever while the UI
    // shows idle (End tapped, or tab left, mid permission prompt).
    if (this.stopped) {
      this.mic.stop();
      return;
    }

    // 4. Mint + connect — shared with the reconnect path (connectLive), which
    //    re-mints because ephemeral tokens are single-use.
    await this.connectLive();
  }

  /**
   * 2026-08-14 (session continuity): mint a fresh ephemeral token and open the
   * Live socket. Shared by start() and the reconnect path — every (re)connect
   * re-mints because tokens are single-use. With `resumeHandle` the server
   * restores the prior session's real state (no history bridge needed);
   * without it, a FRESH session gets the recent chat thread bridged into its
   * instructions so a reborn mouth still knows the conversation.
   */
  private async connectLive(resumeHandle?: string): Promise<void> {
    const { events } = this.opts;

    // Mint the ephemeral token (backend enforces auth + ownership).
    const authToken = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    const res = await fetch(API_ROUTES.GEMINI_LIVE.TOKEN, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authToken && { Authorization: `Bearer ${authToken}` }),
      },
      body: JSON.stringify({ userId: this.opts.userId, snapshotId: this.opts.snapshotId }),
    });
    const mint = (await res.json()) as MintResponse;
    if (!res.ok || !mint.ok || !mint.token) {
      throw new Error(mint.error || `Gemini Live token mint failed (HTTP ${res.status})`);
    }
    // End is final (Melody doctrine): stop() may have raced the mint.
    if (this.stopped) return;

    // Connect the Live WebSocket with the ephemeral token as the API key.
    // apiVersion must match the mint (v1alpha; see gemini-live-adapter.js).
    const ai = new GoogleGenAI({
      apiKey: mint.token,
      httpOptions: { apiVersion: 'v1alpha' },
    });

    // Driver-chosen voice (Settings → Coach Voice); read at connect time so a
    // change applies on the next session without a reload.
    const voiceName = localStorage.getItem(STORAGE_KEYS.COACH_VOICE_NAME) || undefined;

    // History bridge — FRESH connects only. Handle-resumes skip it: the server
    // restores the real session context, and a bridge would duplicate it.
    // formatThreadTail caps the bridge (12 turns / 240 chars / 2000 total) and
    // returns '' when there's no thread — buildMouthInstructions omits it then.
    const recentThread = resumeHandle
      ? undefined
      : formatThreadTail(this.opts.getThreadTail?.() ?? []);

    const session = await ai.live.connect({
      model: mint.model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: buildMouthInstructions(mint.context, recentThread),
        tools: [
          { googleSearch: {} },
          {
            functionDeclarations: [
              {
                name: ASK_COACH_TOOL.name,
                description: ASK_COACH_TOOL.description,
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    question: {
                      type: Type.STRING,
                      description: ASK_COACH_TOOL.parameters.properties.question.description,
                    },
                  },
                  required: ['question'],
                },
              },
            ],
          },
        ],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        // Registry-driven mouth-thinking experiment. The SDK errors loudly on
        // models without thinking support — surfaced via onerror (fail loud).
        ...(mint.thinkingBudget !== undefined && {
          thinkingConfig: { thinkingBudget: mint.thinkingBudget },
        }),
        // 2026-08-14 (Melody's road test: "it couldn't stay in context"):
        // the live model's window is only 131k and streamed road audio burns
        // ~25-32 tok/s even in silence — a shift-length session WILL hit the
        // limit, and without compression the session's memory dies there.
        // Sliding-window compression (server defaults) keeps it alive.
        contextWindowCompression: { slidingWindow: {} },
        // 2026-08-14 (Melody: one consistent voice): driver-chosen prebuilt
        // voice from Settings → Coach Voice. Unset = API default. Invalid
        // names fail loudly at connect (error strip), never silently.
        ...(voiceName && {
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        }),
        // 2026-08-14 (session continuity): ask the server for resumption
        // handles (it then sends sessionResumptionUpdate messages); on a
        // reconnect, present the newest handle so the session's memory
        // survives the socket. Field name verified: SessionResumptionConfig
        // {handle?: string} in @google/genai 1.52.0.
        sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
      },
      callbacks: {
        onopen: () => {
          if (this.stopped) return;
          events.onStatus('live', mint.model);
          this.reconnectExpected = false;
          // Review 2026-08-14 (confirmed 3/3): do NOT reset the retry budget
          // here. The SDK sends the setup message (carrying the resumption
          // handle) only AFTER the socket opens — a stale/rejected handle
          // manifests as open-then-close, so resetting on open made the
          // 2-attempt bound unenforceable (infinite mint/connect/close loop).
          // The budget resets in handleMessage, on the first server message —
          // the earliest proof the setup was actually accepted.
        },
        onmessage: (message: any) => this.handleMessage(message),
        onerror: (e: ErrorEvent) => {
          if (!this.stopped) events.onError(e.message || 'Gemini Live socket error');
        },
        onclose: (e: CloseEvent) => {
          if (this.stopped) return;
          // Socket is dead: null the session so mic frames no-op while we
          // decide (MicCapture keeps running untouched — pause state and all).
          this.session = null;
          // The in-flight model turn died with the socket. Commit what the
          // driver actually heard (mirrors the `interrupted` handler) so a
          // reborn session's first turn can't concatenate onto a dead tail.
          // Review 2026-08-14 (confirmed 3/3): the commit must happen BEFORE
          // any 'ended' emit — the hook's 'ended' handler flushes and nulls
          // the conversation id, so a turn committed after it lands on screen
          // but never persists.
          this.commitBufferedTurn();
          if (this.resumeHandle && this.reconnectAttempts < 2) {
            // sayQueue survives — it's drained after the reconnect.
            this.scheduleReconnect();
            return;
          }
          // No handle (server never made this session resumable) or retries
          // exhausted — the pre-continuity behavior: the session is over.
          events.onStatus('ended', e.reason || 'connection closed');
          this.stop();
        },
      },
    });

    if (this.stopped) {
      // stop() raced the connect (End is final) — kill the socket just opened.
      try { session.close(); } catch { /* already closed */ }
      return;
    }
    this.session = session;

    // Brain answers that resolved while the socket was down: a handle-resume
    // restores the session's pending tool call — answer it now. On a fresh
    // connect the call id no longer exists; discard loudly (the model never
    // asked this session, so an orphan response would be a protocol error).
    if (this.pendingToolResponses.length > 0) {
      if (resumeHandle) {
        for (const p of this.pendingToolResponses) this.sendToolResponse(p.id, p.answer);
      } else {
        console.warn(`[VOICE] ${this.pendingToolResponses.length} brain answer(s) discarded — fresh session, original tool call gone`);
      }
      this.pendingToolResponses = [];
    }

    // Relays queued while no socket existed (mid-turn on the old socket, the
    // reconnect window, or the initial connect) would wait forever — dispatch
    // one now; turnComplete boundaries drain the rest.
    if (!this.modelSpeaking) {
      const queued = this.sayQueue.shift();
      if (queued) this.dispatchRelay(queued);
    }
  }

  /**
   * 2026-08-14 (session continuity): transparent reconnect. The Live API
   * drops sockets deliberately (goAway before rotation / session limits) and
   * iOS drops them on backgrounding; with a resumption handle the
   * conversation state survives the socket. Two attempts with backoff
   * (500 ms then 1500 ms), then give up loudly. A user stop() cancels the
   * pending timer and any in-flight attempt — End is final (Melody doctrine).
   */
  private scheduleReconnect(): void {
    const { events } = this.opts;
    this.reconnectAttempts += 1;
    events.onStatus('connecting', 'reconnecting');
    const delay = this.reconnectAttempts === 1 ? 500 : 1500;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped || !this.resumeHandle) return;
      void this.connectLive(this.resumeHandle).catch((err: unknown) => {
        if (this.stopped) return;
        if (this.reconnectAttempts < 2) {
          this.scheduleReconnect();
          return;
        }
        // Retries exhausted — fail loud, then the pre-continuity ended path.
        events.onError(err instanceof Error ? err.message : 'Gemini Live reconnect failed');
        events.onStatus('ended', 'reconnect failed');
        this.stop();
      });
    }, delay);
  }

  private handleMessage(message: any): void {
    const { events } = this.opts;
    const sc = message?.serverContent;

    // First server message = the setup (and any resumption handle) was
    // accepted — NOW the session is proven healthy and the retry budget
    // resets. (See onopen comment: resetting on raw socket-open let a stale
    // handle loop forever.)
    this.reconnectAttempts = 0;

    // 2026-08-14 (session continuity): the server periodically posts a
    // resumption handle — store the newest (latest wins; resumable:false
    // updates carry an empty handle and are skipped). Field names verified in
    // @google/genai 1.52.0: sessionResumptionUpdate.{resumable, newHandle}.
    const resumption = message?.sessionResumptionUpdate;
    if (resumption?.resumable && resumption?.newHandle) {
      this.resumeHandle = resumption.newHandle;
    }

    // goAway ({timeLeft}): the server will drop the socket soon (connection
    // rotation). Mark the coming onclose as expected — the reconnect path in
    // onclose handles the rebirth; nothing to tear down here.
    if (message?.goAway) {
      this.reconnectExpected = true;
    }

    // Barge-in: server VAD heard the driver — kill queued audio immediately.
    // The interrupted turn's transcript-so-far commits as final: that is
    // (approximately) what the driver actually heard before cutting in.
    if (sc?.interrupted) {
      this.player.flush();
      this.commitBufferedTurn();
    }

    // Model audio chunks (PCM16 24 kHz base64).
    const parts = sc?.modelTurn?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part?.inlineData?.data) {
          this.player.enqueue(part.inlineData.data);
          this.modelSpeaking = true;
        }
      }
    }

    // The model responding marks the driver's turn as committed: flush the
    // accumulated user transcript into the thread.
    if ((this.modelSpeaking || sc?.outputTranscription?.text) && this.userBuf.trim()) {
      events.onUserTurnFinal(this.userBuf.trim());
      this.userBuf = '';
    }

    // Transcripts — fragments accumulate here; deltas carry the whole line.
    if (sc?.inputTranscription?.text) {
      this.userBuf += sc.inputTranscription.text;
      events.onUserTranscriptDelta(this.userBuf);
    }
    if (sc?.outputTranscription?.text && !this.suppressRelayTurn) {
      this.modelBuf += sc.outputTranscription.text;
      events.onModelTranscriptDelta(this.modelBuf);
    }

    // Turn boundary: commit the coach turn, then dispatch any queued relay.
    if (sc?.turnComplete) {
      if (this.suppressRelayTurn) {
        this.suppressRelayTurn = false;
      } else if (this.modelBuf.trim()) {
        events.onModelTurnFinal(this.modelBuf.trim());
      }
      this.modelBuf = '';
      this.modelSpeaking = false;
      const queued = this.sayQueue.shift();
      if (queued) this.dispatchRelay(queued);
    }

    // Tool calls → the brain. Live API requires manual tool-response handling.
    const calls = message?.toolCall?.functionCalls;
    if (Array.isArray(calls)) {
      // 2026-08-14: the ack ("checking that…") is its own turn — commit it
      // before the tool round-trip. Without this the post-tool answer
      // concatenated onto the ack in one transcript line (live test:
      // "…How does that sound to start?Checking on that").
      if (this.modelBuf.trim() && !this.suppressRelayTurn) {
        events.onModelTurnFinal(this.modelBuf.trim());
        this.modelBuf = '';
      }
      for (const call of calls) {
        if (call?.name === ASK_COACH_TOOL.name) {
          void this.runBrainCall(call.id, String(call.args?.question ?? ''));
        }
      }
    }
  }

  private async runBrainCall(callId: string, question: string): Promise<void> {
    let answer: string;
    try {
      answer = await this.opts.askCoachBrain(question);
    } catch (err) {
      // Fail loud THROUGH the mouth: the model tells the driver it couldn't
      // reach the coach instead of silently stalling the (synchronous) call.
      answer = `The coach backend could not be reached (${err instanceof Error ? err.message : 'unknown error'}). Tell the driver you couldn't check right now.`;
    }
    if (this.stopped) return;
    if (!this.session) {
      // Reconnect window — stash; connectLive delivers after a handle-resume.
      this.pendingToolResponses.push({ id: callId, answer });
      return;
    }
    this.sendToolResponse(callId, answer);
  }

  private sendToolResponse(callId: string, answer: string): void {
    this.session?.sendToolResponse({
      functionResponses: [{ id: callId, name: ASK_COACH_TOOL.name, response: { output: answer } }],
    });
  }

  /** Commit the in-flight coach line (what the driver actually heard) to the
   *  thread, exactly once — shared by barge-in, socket-death, and stop().
   *  Suppressed relay turns emit nothing (their text is already on screen). */
  private commitBufferedTurn(): void {
    if (this.suppressRelayTurn) {
      this.suppressRelayTurn = false;
    } else if (this.modelBuf.trim()) {
      this.opts.events.onModelTurnFinal(this.modelBuf.trim());
    }
    this.modelBuf = '';
    this.modelSpeaking = false;
  }

  /** Tap-to-talk pause: mic muted at capture (frames dropped + track disabled).
   *  The socket stays open — the driver resumes with a tap, never automatically. */
  pauseMic(): void {
    this.mic.setEnabled(false);
    // Anything half-heard before the pause is stale — don't let it commit later.
    this.userBuf = '';
    this.opts.events.onUserTranscriptDelta('');
  }

  resumeMic(): void {
    this.mic.setEnabled(true);
  }

  /** iOS playback unlock from a real gesture (auto-started sessions have none). */
  unlockAudio(): void {
    this.player.unlock();
  }

  /** Speak a chat-screen answer through the mouth (see VoiceSession.sayText). */
  sayText(text: string, context?: { userMessage?: string }): void {
    if (this.stopped) return;
    const envelope = buildRelayEnvelope(text, context);
    if (this.modelSpeaking || !this.session) {
      // Mid-turn: a turnComplete:true client turn now could cancel the spoken
      // answer in flight. No session: connecting/reconnecting — dropping here
      // silently ate typed-chat answers (review 2026-08-14, confirmed 3/3).
      // Queue; dispatched on the turnComplete boundary or after (re)connect.
      this.sayQueue.push(envelope);
      return;
    }
    this.dispatchRelay(envelope);
  }

  private dispatchRelay(envelope: string): void {
    if (this.stopped || !this.session) return;
    // The relay's spoken response is a duplicate of text already in the
    // thread — suppress its transcript events (audio still plays).
    this.suppressRelayTurn = true;
    this.session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: envelope }] }],
      turnComplete: true,
    });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    // 2026-08-14 (session continuity): End is final (Melody doctrine) — a
    // pending reconnect must never resurrect a session the driver ended.
    // Clearing the handle also disarms any in-flight connectLive (its stopped
    // checks) and the reconnect gate in onclose.
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.resumeHandle = null;
    this.reconnectExpected = false;
    this.mic.stop();
    this.player.close();
    try { this.session?.close(); } catch { /* already closed */ }
    this.session = null;
    this.sayQueue = [];
    this.pendingToolResponses = [];
    // Commit any in-flight coach line BEFORE the 'ended' emit — the hook's
    // 'ended' handler flushes persistence, then nulls the conversation id.
    this.commitBufferedTurn();
    this.userBuf = '';
    this.opts.events.onStatus('ended');
  }
}
