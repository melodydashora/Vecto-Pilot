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
}

const BRAIN_TIMEOUT_MS = 60_000;

/**
 * Ask the Coach backend one self-contained question; resolve to the final
 * cleaned answer text. Throws with a descriptive message on failure — the
 * caller turns that into a spoken "I couldn't reach the coach" so the
 * session degrades loudly, never silently.
 */
export async function askCoachBrain(
  { userId, snapshotId, snapshot }: CoachBrainParams,
  question: string
): Promise<string> {
  const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), BRAIN_TIMEOUT_MS);

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
        // Stateless per question: the live session holds conversational
        // context in the mouth model; the mouth is instructed to restate
        // questions self-contained.
        threadHistory: [],
        snapshotId,
        snapshot,
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
        } catch { /* partial SSE line */ }
      }
      const lastNl = acc.lastIndexOf('\n');
      if (lastNl >= 0) acc = acc.slice(lastNl + 1);
    }

    if (streamError && !full) throw new Error(streamError);

    const cleaned = cleanTextForTTS(full).trim();
    if (!cleaned) throw new Error('coach backend returned an empty answer');
    return cleaned;
  } finally {
    window.clearTimeout(timer);
  }
}
