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
// with a tap on return (sessionResumption is a follow-up; todo #37 tracks the
// native shell for true background voice).

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

    // 1. Mint the ephemeral token (backend enforces auth + ownership).
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

    // 2. Mic first — keeps getUserMedia inside the user-gesture chain (iOS).
    await this.mic.start((b64) => {
      // Session may still be connecting for the first ~200ms; drop until live.
      this.session?.sendRealtimeInput({
        audio: { data: b64, mimeType: 'audio/pcm;rate=16000' },
      });
    });

    // 3. Connect the Live WebSocket with the ephemeral token as the API key.
    //    apiVersion must match the mint (v1alpha; see gemini-live-adapter.js).
    const ai = new GoogleGenAI({
      apiKey: mint.token,
      httpOptions: { apiVersion: 'v1alpha' },
    });

    // Driver-chosen voice (Settings → Coach Voice); read at connect time so a
    // change applies on the next session without a reload.
    const voiceName = localStorage.getItem(STORAGE_KEYS.COACH_VOICE_NAME) || undefined;

    this.session = await ai.live.connect({
      model: mint.model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: buildMouthInstructions(mint.context),
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
        // 2026-08-14 (Melody: one consistent voice): driver-chosen prebuilt
        // voice from Settings → Coach Voice. Unset = API default. Invalid
        // names fail loudly at connect (error strip), never silently.
        ...(voiceName && {
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        }),
      },
      callbacks: {
        onopen: () => {
          if (!this.stopped) events.onStatus('live', mint.model);
        },
        onmessage: (message: any) => this.handleMessage(message),
        onerror: (e: ErrorEvent) => {
          if (!this.stopped) events.onError(e.message || 'Gemini Live socket error');
        },
        onclose: (e: CloseEvent) => {
          if (!this.stopped) {
            events.onStatus('ended', e.reason || 'connection closed');
            this.stop();
          }
        },
      },
    });
  }

  private handleMessage(message: any): void {
    const { events } = this.opts;
    const sc = message?.serverContent;

    // Barge-in: server VAD heard the driver — kill queued audio immediately.
    // The interrupted turn's transcript-so-far commits as final: that is
    // (approximately) what the driver actually heard before cutting in.
    if (sc?.interrupted) {
      this.player.flush();
      if (this.suppressRelayTurn) {
        this.suppressRelayTurn = false; // relay was cut off — nothing to emit
      } else if (this.modelBuf.trim()) {
        events.onModelTurnFinal(this.modelBuf.trim());
      }
      this.modelBuf = '';
      this.modelSpeaking = false;
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
    this.session?.sendToolResponse({
      functionResponses: [{ id: callId, name: ASK_COACH_TOOL.name, response: { output: answer } }],
    });
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
    if (this.stopped || !this.session) return;
    const envelope = buildRelayEnvelope(text, context);
    if (this.modelSpeaking) {
      // Mid-turn: a turnComplete:true client turn now could cancel the spoken
      // answer in flight. Queue; dispatched on the turnComplete boundary.
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
    this.mic.stop();
    this.player.close();
    try { this.session?.close(); } catch { /* already closed */ }
    this.session = null;
    this.sayQueue = [];
    // Commit any in-flight coach line so the thread doesn't lose the tail
    // of a sentence the driver already heard.
    if (this.modelBuf.trim() && !this.suppressRelayTurn) {
      this.opts.events.onModelTurnFinal(this.modelBuf.trim());
    }
    this.modelBuf = '';
    this.userBuf = '';
    this.opts.events.onStatus('ended');
  }
}
