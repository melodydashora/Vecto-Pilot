// client/src/utils/coach/actionsResult.ts
// Shared handler for /api/chat SSE done-payload metadata. Used by both the
// classic chat hook (useCoachChat) and the voice brain (coachBrain) so action
// side-effects — notes saved, action errors, history-persistence failures —
// surface identically no matter which arm asked the question.
//
// 2026-08-14: persistence_error was emitted by the server (chat.js done
// payload) but never read by any client code before this util existed.

export interface OfferRulesReceipt {
  version: number | null;
  hash: string | null;
  changed: boolean;
  changes: { path: string; label: string; before: unknown; after: unknown }[];
}

export interface ActionsResult {
  saved: number;
  errors?: string[];
  memos?: { id: string; type: string; title: string; created_at: string }[];
  offer_rules?: OfferRulesReceipt;
  coach_snapshot_refresh?: { requested: true; reason: string };
}

export interface DonePayloadMeta {
  conversation_id?: string;
  actions_result?: ActionsResult;
  persistence_error?: string;
  done?: boolean;
  error?: string | boolean;
  response_text?: string;
}

export type CoachSnapshotRefreshHandler = () => string | null | void | Promise<string | null | void>;

export function coachRefreshRequested(payload?: DonePayloadMeta): boolean {
  const refresh = payload?.actions_result?.coach_snapshot_refresh;
  return !!(payload?.done && !payload.error && refresh?.requested === true &&
    typeof refresh.reason === 'string' && refresh.reason.trim());
}

export interface DonePayloadHandlers {
  onNotesSaved?: () => void;
  onOfferRulesSaved?: (receipt: OfferRulesReceipt) => void;
  onRefreshCoachSnapshot?: CoachSnapshotRefreshHandler;
  onActionError?: (messages: string[]) => void;
}

export function applyDonePayload(
  payload: DonePayloadMeta,
  handlers: DonePayloadHandlers
): void {
  if (coachRefreshRequested(payload)) {
    handlers.onRefreshCoachSnapshot?.();
  }
  const rules = payload.actions_result?.offer_rules;
  if (payload.done && !payload.error && rules?.changed && Number.isInteger(rules.version) &&
      (rules.version ?? 0) > 0 && rules.hash) {
    handlers.onOfferRulesSaved?.(rules);
  }
  if ((payload.actions_result?.saved ?? 0) > 0) {
    handlers.onNotesSaved?.();
  }

  const errors: string[] = [];
  if (payload.actions_result?.errors?.length) {
    errors.push(...payload.actions_result.errors);
  }
  if (payload.persistence_error) {
    errors.push(`Not saved to history: ${payload.persistence_error}`);
  }
  if (errors.length > 0) {
    handlers.onActionError?.(errors);
  }
}
