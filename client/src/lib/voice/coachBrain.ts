// client/src/lib/voice/coachBrain.ts
// 2026-08-11 (todo #33): the BRAIN call — ask_coach_backend's executor.
//
// Routes a live-voice question through the existing /api/chat pipeline
// (AI_COACH role: gemini text brain, HIGH thinking, google_search grounding,
// and the full server-side action-tag surface — SAVE_NOTE, event CRUD,
// COACH_MEMO, zone/market intel, offer decisions). The mouth model receives
// the accumulated answer as a function response and speaks its own rendition,
// so the entire Coach tool surface transfers to voice with zero new tools.
//
// The SSE consumption mirrors useCoachChat's parser (data: {delta} lines,
// done on stream close); action tags are stripped from the returned text so
// the mouth never reads tag JSON aloud (the server already EXECUTED them).

import { API_ROUTES } from '@/constants/apiRoutes';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { cleanTextForTTS } from '@/utils/coach/cleanTextForTTS';
import { stripActionTags } from '@/utils/coach/stripActionTags';
import type { DonePayloadMeta } from '@/utils/coach/actionsResult';
import type { ThreadTurn } from './types';

export interface CoachBrainParams {
  userId: string;
  snapshotId?: string;
  /** Minimal snapshot fields the chat endpoint's timezone gate expects. */
  snapshot?: {
    city?: string;
    state?: string;
    timezone?: string;
    hour?: number;
    day_part_key?: string;
  };
  /**
   * 2026-08-14 (unified voice thread): stable per-session conversation id —
   * threads all brain calls (and typed messages) of one live session under a
   * single coach_conversations id server-side.
   */
  conversationId?: string;
  /**
   * 2026-08-14 (brain-hears): recent committed thread turns (text only), the
   * same [{role, content}] shape typed chat sends — the server builds
   * messageHistory from it, so the brain answers "should I take it?" knowing
   * what "it" is. Capped to the last 20 turns at send time.
   */
  threadHistory?: ThreadTurn[];
  /** External abort (session teardown) — combined with the 60s timeout. */
  signal?: AbortSignal;
  /** Done-payload metadata (actions_result / persistence_error) consumer. */
  onActionsResult?: (payload: DonePayloadMeta) => void;
  /**
   * 2026-08-14: the brain's DISPLAY text (tags stripped, markdown + URLs
   * intact). The mouth only ever speaks a TTS-cleaned rendition — links and
   * rich content would otherwise never reach the driver's screen (live test:
   * the mouth claimed "sending that link now" while nothing existed to send).
   */
  onBrainAnswer?: (displayText: string) => void;
}

const BRAIN_TIMEOUT_MS = 60_000;

/**
 * Ask the Coach backend one self-contained question; resolve to the final
 * cleaned answer text. Throws with a descriptive message on failure — the
 * caller turns that into a spoken "I couldn't reach the coach" so the
 * session degrades loudly, never silently.
 */
export async function askCoachBrain(
  { userId, snapshotId, snapshot, conversationId, threadHistory, signal, onActionsResult, onBrainAnswer }: CoachBrainParams,
  question: string
): Promise<string> {
  const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), BRAIN_TIMEOUT_MS);
  // External abort (session teardown) chains into the fetch controller.
  // Manual chaining instead of AbortSignal.any — wider browser support.
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const res = await fetch(API_ROUTES.CHAT.SEND, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({
        userId,
        message: question,
        // 2026-08-14 (brain-hears): was hard-coded [] — "stateless per
        // question" made every brain call amnesiac ("should I take it?"
        // arrived with no "it"). The caller now passes the committed visible
        // thread and the server builds messageHistory from it, exactly like
        // typed chat. Capped to the last 20 turns so long sessions can't
        // bloat the request.
        threadHistory: (threadHistory ?? []).slice(-20),
        snapshotId,
        snapshot,
        conversationId,
        source: 'voice',
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const raw = await res.text();
      let msg = `coach backend HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(raw);
        msg = parsed.message || parsed.error || msg;
      } catch { /* non-JSON error body */ }
      throw new Error(msg);
    }

    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let acc = '';
    let full = '';
    let streamError: string | null = null;

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += dec.decode(value, { stream: true });
      for (const line of acc.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try {
          const msg = JSON.parse(line.slice(5).trim());
          if (msg.delta) full += msg.delta;
          if (typeof msg.error === 'string') streamError = msg.error;
          // Done payload carries actions_result / persistence_error — surface
          // through the same handler classic mode uses (notes refresh, errors).
          if (msg.done && (msg.actions_result || msg.persistence_error)) {
            onActionsResult?.(msg);
          }
        } catch { /* partial SSE line */ }
      }
      const lastNl = acc.lastIndexOf('\n');
      if (lastNl >= 0) acc = acc.slice(lastNl + 1);
    }

    if (streamError && !full) throw new Error(streamError);

    // Display text first (links/markdown intact) — the consumer surfaces
    // rich content (links) into the chat thread.
    const display = stripActionTags(full);
    if (display) onBrainAnswer?.(display);

    const cleaned = cleanTextForTTS(full).trim();
    if (!cleaned) throw new Error('coach backend returned an empty answer');
    return cleaned;
  } finally {
    window.clearTimeout(timer);
  }
}
