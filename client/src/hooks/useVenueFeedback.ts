import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { API_ROUTES, QUERY_KEYS } from '@/constants/apiRoutes';
import type { BlocksResponse, SmartBlock } from '@/types/co-pilot';

export interface VenueDismissal { place_id: string; action_id: string; venue_name: string }
export interface VenueFeedbackState {
  ok: true;
  snapshot_id: string;
  ranking_id: string;
  scope_revision: number;
  dismissed_place_ids: string[];
  dismissals: VenueDismissal[];
  blocks: SmartBlock[];
}
export interface VenueFeedbackReceipt extends VenueFeedbackState {
  feedback_id: string;
  action_id: string;
  place_id: string;
  action: 'dismiss' | 'restore' | 'upvote';
  replacement: SmartBlock | null;
  replacement_status: 'replaced' | 'exhausted' | 'not_requested';
  restored: boolean;
}
export interface VenueFeedbackAction {
  place_id: string;
  action: VenueFeedbackReceipt['action'];
  visible_place_ids: string[];
  comment?: string | null;
  undo_action_id?: string;
}

function validBlock(value: unknown): value is SmartBlock {
  const b = value as SmartBlock | null;
  return !!b && typeof b.name === 'string' && typeof b.placeId === 'string' && !!b.placeId &&
    Number.isFinite(b.coordinates?.lat) && Number.isFinite(b.coordinates?.lng);
}
export function isVenueFeedbackState(value: unknown, snapshotId: string, rankingId: string): value is VenueFeedbackState {
  const s = value as VenueFeedbackState | null;
  return !!s && s.ok === true && s.snapshot_id === snapshotId && s.ranking_id === rankingId &&
    Number.isInteger(s.scope_revision) && s.scope_revision >= 0 &&
    Array.isArray(s.blocks) && s.blocks.length <= 3 && s.blocks.every(validBlock) &&
    new Set(s.blocks.map(b => b.placeId)).size === s.blocks.length &&
    Array.isArray(s.dismissed_place_ids) && s.dismissed_place_ids.every(id => typeof id === 'string') &&
    s.blocks.every(b => !s.dismissed_place_ids.includes(b.placeId!)) &&
    Array.isArray(s.dismissals) && s.dismissals.every(d => typeof d.place_id === 'string' &&
      typeof d.action_id === 'string' && !!d.action_id && typeof d.venue_name === 'string' && s.dismissed_place_ids.includes(d.place_id));
}

/** Confirmed, driver-scoped state. Reload reads saved rows and never starts generation. */
export function useVenueFeedback(snapshotId: string | null, rankingId?: string) {
  const { user, token } = useAuth();
  const queryClient = useQueryClient();
  const key = JSON.stringify([user?.userId, token, snapshotId, rankingId]);
  const scopeRef = useRef({ key, active: true, busy: false, controllers: new Set<AbortController>(), revision: -1 });
  if (scopeRef.current.key !== key) {
    scopeRef.current.active = false;
    scopeRef.current.controllers.forEach(c => c.abort());
    scopeRef.current = { key, active: true, busy: false, controllers: new Set(), revision: -1 };
  }
  const scope = scopeRef.current;
  const [saved, setSaved] = useState<{ key: string; value: VenueFeedbackState } | null>(null);
  const [problem, setProblem] = useState<{ key: string; message: string } | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const retryRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const current = () => scope.active && scopeRef.current === scope;
  const apply = (value: VenueFeedbackState) => {
    if (!current() || value.scope_revision < scope.revision) return;
    scope.revision = value.scope_revision;
    setSaved({ key, value });
    setProblem(null);
    if (value.scope_revision > 0) {
      queryClient.setQueryData<BlocksResponse>(QUERY_KEYS.BLOCKS_FAST(snapshotId), previous =>
        previous && previous.rankingId === rankingId ? { ...previous, blocks: value.blocks } : previous);
    }
  };

  const reload = useCallback(async () => {
    if (!snapshotId || !rankingId || !token || !user?.userId) return;
    const controller = new AbortController(); scope.controllers.add(controller);
    try {
      const response = await fetch(`/api/blocks-fast/saved?snapshotId=${encodeURIComponent(snapshotId)}&rankingId=${encodeURIComponent(rankingId)}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      if (!current()) return;
      if (!response.ok) throw new Error('Saved venue choices could not be loaded. Retry to recover your choices.');
      const value: unknown = await response.json();
      if (!current()) return;
      if (!isVenueFeedbackState(value, snapshotId, rankingId)) throw new Error('The server did not confirm saved venue choices.');
      apply(value);
      return true;
    } catch (error) {
      if (current()) setProblem({ key, message: error instanceof Error ? error.message : 'Saved venue choices could not be loaded.' });
      return false;
    } finally { scope.controllers.delete(controller); }
  // The scope contains the identity, token and exact recommendation pair.
  }, [key]);

  useEffect(() => {
    scope.active = true;
    void reload();
    return () => { scope.active = false; scope.controllers.forEach(c => c.abort()); };
  }, [scope, reload]);

  const submit = async (action: VenueFeedbackAction): Promise<VenueFeedbackReceipt | null> => {
    if (!snapshotId || !rankingId || !token || !user?.userId) throw new Error('Sign in and load a strategy before giving feedback.');
    if (!current() || scope.busy) return null;
    scope.busy = true; setPendingKey(key);
    const fingerprint = JSON.stringify([key, action]);
    if (retryRef.current?.fingerprint !== fingerprint) retryRef.current = { fingerprint, id: crypto.randomUUID() };
    const requestId = retryRef.current.id;
    const controller = new AbortController(); scope.controllers.add(controller);
    try {
      const response = await fetch(API_ROUTES.FEEDBACK.VENUE, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        signal: controller.signal,
        body: JSON.stringify({ ...action, request_id: requestId, snapshot_id: snapshotId, ranking_id: rankingId }),
      });
      if (!current()) return null;
      const value = await response.json();
      if (!current()) return null;
      if (!response.ok) {
        const message = response.status === 409 ? 'Recommendations changed. Reload saved choices, then retry your feedback.'
          : response.status === 429 ? 'Too many requests. Wait a moment, then retry.' : 'Feedback was not confirmed. Your venue and comment are unchanged; please retry.';
        if (response.status === 409) { setProblem({ key, message }); retryRef.current = null; }
        throw new Error(message);
      }
      const receipt = value as VenueFeedbackReceipt;
      if (!isVenueFeedbackState(value, snapshotId, rankingId) ||
          receipt.action_id !== requestId || receipt.place_id !== action.place_id || receipt.action !== action.action ||
          typeof receipt.feedback_id !== 'string' || !receipt.feedback_id || typeof receipt.restored !== 'boolean' ||
          !['replaced', 'exhausted', 'not_requested'].includes(receipt.replacement_status) ||
          (receipt.replacement !== null && !validBlock(receipt.replacement)) ||
          (action.action === 'dismiss' && !value.dismissed_place_ids.includes(action.place_id)) ||
          (action.action === 'restore' && value.dismissed_place_ids.includes(action.place_id)) ||
          (receipt.replacement_status === 'replaced' && (!receipt.replacement ||
            !value.blocks.some(block => block.placeId === receipt.replacement?.placeId) ||
            action.visible_place_ids.includes(receipt.replacement.placeId!))) ||
          (receipt.replacement_status === 'exhausted' && receipt.replacement !== null)) {
        throw new Error('The server did not confirm this feedback. Your comment is still available to retry.');
      }
      apply(value);
      retryRef.current = null;
      return value as VenueFeedbackReceipt;
    } catch (error) {
      if (!current()) return null;
      throw error;
    } finally {
      scope.controllers.delete(controller); scope.busy = false;
      if (current()) setPendingKey(null);
    }
  };
  return { state: saved?.key === key ? saved.value : null, error: problem?.key === key ? problem.message : null,
    pending: pendingKey === key, reload, submit };
}
