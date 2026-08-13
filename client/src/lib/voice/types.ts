// client/src/lib/voice/types.ts
// 2026-08-11 (todo #33): provider-agnostic voice session contract for the
// Coach voice switcher (Classic / Gemini Live / GPT Realtime).
//
// The abstraction sits at "voice session" altitude, NOT socket altitude —
// Gemini Live is a WebSocket streaming raw PCM16 while GPT Realtime is a
// WebRTC peer connection, and forcing them into one transport shape would
// make both worse. Each implementation owns its mic capture and playback;
// the shared surface is lifecycle + transcripts + the brain hook.
//
// MOUTH-VS-BRAIN (hard requirement, joint decision 2026-08-11): the live
// model is the mouth. Substantive questions route through askCoachBrain →
// POST /api/chat (AI_COACH role: google_search grounding + the full
// action-tag tool surface). Neither session class answers from its own head.

export type VoiceMode = 'classic' | 'gemini' | 'openai';

export type VoiceSessionStatus = 'idle' | 'connecting' | 'live' | 'ended' | 'error';

export interface VoiceSessionEvents {
  onStatus: (status: VoiceSessionStatus, detail?: string) => void;
  /** User speech transcript (from the provider's input transcription). */
  onUserTranscript: (text: string, final: boolean) => void;
  /** Model speech transcript (what the mouth is saying). */
  onModelTranscript: (text: string, final: boolean) => void;
  onError: (message: string) => void;
}

export interface VoiceSessionOptions {
  userId: string;
  snapshotId?: string;
  events: VoiceSessionEvents;
  /** The brain call — ask_coach_backend's executor. Resolves to the Coach's answer text. */
  askCoachBrain: (question: string) => Promise<string>;
}

export interface VoiceSession {
  readonly mode: Exclude<VoiceMode, 'classic'>;
  /** Connect + start mic. MUST be called from a user gesture (iOS audio unlock). */
  start(): Promise<void>;
  /** Tear down everything: mic, audio, socket/peer. Idempotent. */
  stop(): void;
}

/** Server context shape returned by both token mints (realtime.js / gemini-live.js). */
export interface VoiceTokenContext {
  city?: string;
  state?: string;
  dayPart?: string;
  hour?: number;
  address?: string;
  timezone?: string;
  weather?: { temp?: number; condition?: string };
  strategy?: string;
}

/**
 * Shared mouth prompt. Kept deliberately tight: long-lived sessions bill the
 * whole prompt continuously, and the intelligence lives in the brain anyway.
 */
export function buildMouthInstructions(ctx: VoiceTokenContext | undefined): string {
  const where = ctx?.city ? `${ctx.city}${ctx.state ? ', ' + ctx.state : ''}` : 'their area';
  const when = ctx?.dayPart || 'right now';
  return [
    `You are the VOICE of the Vecto Pilot AI Coach — a calm, sharp co-pilot for a rideshare driver in ${where} (${when}). The driver is DRIVING: keep replies short, conversational, and hands-free friendly.`,
    `You are the mouth, not the brain. For ANY substantive question — strategy, earnings, offers, events, venues, saving notes or memos, anything needing data or current info — say a brief acknowledgment (e.g. "checking that") and call ask_coach_backend with a clear, self-contained question. Relay its answer conversationally; do not read markdown, tags, or long lists aloud.`,
    `Only answer directly from your own head for small talk and immediate clarifications.`,
    `If the driver says the conversation is complete ("conversation complete", "we're done", "goodbye coach"), confirm briefly and stop talking.`,
    ctx?.strategy ? `Current strategy summary (context, may be stale): ${ctx.strategy}` : '',
  ].filter(Boolean).join('\n');
}

/** ask_coach_backend JSON schema shared by both providers (shape only — each adapts syntax). */
export const ASK_COACH_TOOL = {
  name: 'ask_coach_backend',
  description:
    "Ask the full Vecto Pilot AI Coach backend (live web search, driver's database, events, offer history, notes/memos). Use for every substantive question. The question must be self-contained.",
  parameters: {
    type: 'object' as const,
    properties: {
      question: {
        type: 'string' as const,
        description: "The driver's question, restated self-contained.",
      },
    },
    required: ['question'],
  },
};
