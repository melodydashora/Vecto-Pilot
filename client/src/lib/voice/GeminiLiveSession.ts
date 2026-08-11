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
  ASK_COACH_TOOL,
} from './types';

interface MintResponse {
  ok: boolean;
  token: string;
  model: string;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    if (sc?.interrupted) {
      this.player.flush();
    }

    // Model audio chunks (PCM16 24 kHz base64).
    const parts = sc?.modelTurn?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part?.inlineData?.data) this.player.enqueue(part.inlineData.data);
      }
    }

    // Transcripts.
    if (sc?.inputTranscription?.text) {
      events.onUserTranscript(sc.inputTranscription.text, Boolean(sc.turnComplete));
    }
    if (sc?.outputTranscription?.text) {
      events.onModelTranscript(sc.outputTranscription.text, Boolean(sc.turnComplete));
    }

    // Tool calls → the brain. Live API requires manual tool-response handling.
    const calls = message?.toolCall?.functionCalls;
    if (Array.isArray(calls)) {
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

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.mic.stop();
    this.player.close();
    try { this.session?.close(); } catch { /* already closed */ }
    this.session = null;
    this.opts.events.onStatus('ended');
  }
}
