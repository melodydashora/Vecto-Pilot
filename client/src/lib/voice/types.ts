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

// 2026-08-14 (unified voice thread): the old (text, final) pair was ambiguous —
// Gemini's fragments + a final flag caused the last fragment to REPLACE the
// accumulated line. Engines now own turn accumulation and emit two distinct
// streams: deltas carry the full interim line so far (render in place), and
// finals carry the committed turn (append to the chat thread).
export interface VoiceSessionEvents {
  onStatus: (status: VoiceSessionStatus, detail?: string) => void;
  /** Interim driver speech — the accumulated line so far (replaces prior interim). */
  onUserTranscriptDelta: (text: string) => void;
  /** Committed full driver turn — append to the thread; interim clears. */
  onUserTurnFinal: (text: string) => void;
  /** Interim coach speech — the accumulated line so far (replaces prior interim). */
  onModelTranscriptDelta: (text: string) => void;
  /** Committed full coach turn — append to the thread; interim clears. */
  onModelTurnFinal: (text: string) => void;
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
  /**
   * Mute the mic WITHOUT tearing down the session (no re-getUserMedia on
   * resume — keeps iOS gesture requirements satisfied). Tap-to-talk doctrine
   * (Melody 2026-08-13): NOTHING may auto-resume a paused mic — only an
   * explicit resumeMic() from a user action.
   */
  pauseMic(): void;
  resumeMic(): void;
  /**
   * Best-effort audio unlock from a user gesture. Auto-started sessions (tab
   * entry) have no gesture, and iOS keeps playback contexts suspended until
   * one — the component calls this from a one-time pointerdown listener.
   */
  unlockAudio(): void;
  /**
   * Make the mouth SPEAK a provided answer (relay), not treat it as driver
   * speech. Used when the driver types/uploads through the chat screen while
   * live: the brain's answer streams into the thread as text AND is spoken.
   * Implementations queue if the model is mid-response and suppress the relay
   * turn's own transcript events (the answer is already in the thread).
   */
  sayText(text: string, context?: { userMessage?: string }): void;
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
    `You are a FULL companion, not just a dispatcher (Melody doctrine, 2026-08-14): the driver can talk to you about anything — health, stress, money worries, family, life questions, or just company on a long shift. Engage warmly on any topic. If the driver isn't feeling well or needs help or free resources (food, shelter, financial help, crisis support), that comes BEFORE driving strategy — care first, and route resource lookups through ask_coach_backend so they get real, current, local answers.`,
    `You are the mouth, not the brain. For ANY substantive question — strategy, earnings, offers, events, venues, saving notes or memos, anything needing data or current info — say a brief acknowledgment (e.g. "checking that") and call ask_coach_backend with a clear, self-contained question. Relay its answer conversationally; do not read markdown, tags, or long lists aloud.`,
    `Never speak tool or system names aloud. Words like "ask_coach_backend", "backend", "function call", or descriptions of HOW you fetch answers must never reach the driver — acknowledge naturally and make the call silently.`,
    `The moment ask_coach_backend returns, deliver its answer immediately — never sit on it or wait for the driver to speak first.`,
    `You cannot send, show, pop up, or display anything yourself — you are a voice. When the coach backend's answer contains a link or address, the link appears in the chat window AUTOMATICALLY; say "the link's in the chat" and nothing more about the mechanism. NEVER claim you are sending something. If the driver asks for a link or a place to navigate to, that is a substantive question: call ask_coach_backend and ask it to include the address and map link.`,
    `Compliments, thanks, and small talk need no backend call — just respond warmly and briefly from your own head.`,
    `Default to short replies while driving; when the driver invites detail ("tell me more", open-ended questions, clearly parked), give a fuller answer.`,
    `Some incoming messages are relay notes: they carry the coach's answer to something the driver did on the chat screen (typed or uploaded) and say so explicitly. Speak the relayed answer naturally. Never read, repeat, quote, or imitate the relay note's wording — the driver must never hear about the mechanism.`,
    `If the driver says the conversation is complete ("conversation complete", "we're done", "goodbye coach"), confirm briefly and stop talking.`,
    ctx?.strategy ? `Current strategy summary (context, may be stale): ${ctx.strategy}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Relay envelope for sayText — shared by both engines. userMessage is
 * truncated: it is context, not content (the answer is what gets spoken).
 *
 * 2026-08-14: de-brandified. The original "[[COACH_RELAY]]" marker was a
 * teachable prefix — the live test showed the mouth MIMICKING it, prefixing
 * its own normal answers with the literal marker (which then surfaced in the
 * on-screen transcript). Plain parenthetical prose gives it nothing catchy
 * to copy; useVoiceSession additionally sanitizes any residual mimicry.
 */
export function buildRelayEnvelope(text: string, context?: { userMessage?: string }): string {
  const about = context?.userMessage
    ? ` in response to the driver's chat message «${context.userMessage.slice(0, 200)}»`
    : '';
  return `(Relay note — this is not the driver's voice. The coach answered${about} on the chat screen. Speak this answer naturally, condensed for voice, without mentioning this note.)\n${text}`;
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
