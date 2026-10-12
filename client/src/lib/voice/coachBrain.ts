// client/src/lib/voice/coachBrain.ts
// Typed and spoken requests share /api/chat, full current source context,
// GPT Responses search and confirmed action receipts. The voice receives
// only completed answers, never action tags or unconfirmed success claims.

import { API_ROUTES } from '@/constants/apiRoutes';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { cleanTextForTTS } from '@/utils/coach/cleanTextForTTS';
import { confirmedCoachReply } from '@/utils/coach/confirmedReply';
import { readCoachEvents } from '@/utils/coach/readCoachEvents';
import { coachRefreshRequested, type DonePayloadMeta, type CoachSnapshotRefreshHandler } from '@/utils/coach/actionsResult';
import type { ThreadTurn } from './types';

export interface CoachBrainParams {
  userId: string;
  /** Live sessions retain the credential that owns their transcript and actions. */
  authToken?: string | null;
  snapshotId?: string;
  /** Fresh Coach observation, separate from the stable saved guidance/thread ID. */
  coachSnapshotId?: string;
  onRefreshCoachSnapshot?: CoachSnapshotRefreshHandler;
  source?: 'typed' | 'voice';
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
  threadHistory?: (ThreadTurn & { attachments?: { name: string; type: string; data: string }[] })[];
  /** External abort (session teardown) — combined with the 180s timeout. */
  signal?: AbortSignal;
  /** Reconcile continued speech without repeating actions or automatic learning. */
  answerOnly?: boolean;
  /** A fresh-context answer uses the normal search/reasoning deadline. */
  contextRefreshContinuation?: boolean;
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

const BRAIN_TIMEOUT_MS = 180_000;

/**
 * Ask the Coach backend one self-contained question; resolve to the final
 * cleaned answer text. Throws with a descriptive message on failure — the
 * caller turns that into a spoken "I couldn't reach the coach" so the
 * session degrades loudly, never silently.
 */
export async function askCoachBrain(
  { userId, authToken, snapshotId, coachSnapshotId, snapshot, conversationId, threadHistory, signal, answerOnly = false, contextRefreshContinuation = false, onActionsResult, onBrainAnswer, onRefreshCoachSnapshot, source = 'voice' }: CoachBrainParams,
  question: string
): Promise<string> {
  const token = authToken === undefined ? localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) : authToken;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), answerOnly && !contextRefreshContinuation ? 30000 : BRAIN_TIMEOUT_MS);
  // External abort (session teardown) chains into the fetch controller.
  // Manual chaining instead of AbortSignal.any — wider browser support.
  if (signal?.aborted) controller.abort();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const assertActive = () => {
    if (controller.signal.aborted || token !== localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)) {
      throw new DOMException('Coach request canceled', 'AbortError');
    }
  };

  try {
    assertActive();
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
        coachSnapshotId,
        snapshot,
        conversationId,
        source,
        answerOnly,
      }),
      signal: controller.signal,
    });

    assertActive();
    if (!res.ok) {
      const raw = await res.text();
      let msg = `coach backend HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(raw);
        msg = parsed.message || parsed.error || msg;
      } catch { /* non-JSON error body */ }
      throw new Error(msg);
    }

    let full = '';
    let completion: DonePayloadMeta | undefined;
    for await (const msg of readCoachEvents(res.body)) {
      assertActive();
      if (msg.delta) full += msg.delta;
      if (msg.done) {
        completion = msg;
      }
    }
    assertActive();
    let display = confirmedCoachReply(full, completion);
    if (display) onBrainAnswer?.(display);
    assertActive();
    // One fresh observation can complete this question. The follow-up is
    // read-only and cannot request another capture or repeat settings/memos.
    if (!answerOnly && coachRefreshRequested(completion) && onRefreshCoachSnapshot) {
      // The first provider request is complete. GPS has its own deadline and
      // the continuation gets a full provider deadline; external abort remains linked.
      window.clearTimeout(timer);
      try {
        const refreshedId = await onRefreshCoachSnapshot();
        assertActive();
        if (typeof refreshedId === 'string' && refreshedId) {
          await askCoachBrain({ userId, authToken: token, snapshotId, coachSnapshotId: refreshedId, snapshot,
            conversationId: completion?.conversation_id || conversationId,
            threadHistory: [...(threadHistory ?? []), { role: 'user', content: question }, { role: 'assistant', content: display }],
            signal: controller.signal, source, answerOnly: true, contextRefreshContinuation: true,
            onBrainAnswer: answer => { display += `\n\n${answer}`; onBrainAnswer?.(answer); },
          }, `Use the newly saved Coach snapshot to finish answering this question: ${question}`);
          assertActive();
        } else if (refreshedId === null) {
          const message = 'Coach location could not be refreshed. The previous observation is still the only available location; check the location status before relying on nearby advice.';
          display += `\n\n${message}`;
          onBrainAnswer?.(message);
        }
      } catch {
        assertActive();
        const message = 'Coach could not complete the answer with refreshed context. Check the location status and ask again.';
        display += `\n\n${message}`;
        onBrainAnswer?.(message);
      }
    }
    // A settings receipt can retire the prior Strategy context. Deliver the
    // confirmed answer before allowing that readback to change the voice scope.
    if (completion?.actions_result || completion?.persistence_error) onActionsResult?.(completion);

    const cleaned = cleanTextForTTS(display).trim();
    if (!cleaned) throw new Error('coach backend returned an empty answer');
    return cleaned;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    window.clearTimeout(timer);
  }
}
