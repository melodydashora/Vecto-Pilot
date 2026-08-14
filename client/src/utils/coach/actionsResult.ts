// client/src/utils/coach/actionsResult.ts
// Shared handler for /api/chat SSE done-payload metadata. Used by both the
// classic chat hook (useCoachChat) and the voice brain (coachBrain) so action
// side-effects — notes saved, action errors, history-persistence failures —
// surface identically no matter which arm asked the question.
//
// 2026-08-14: persistence_error was emitted by the server (chat.js done
// payload) but never read by any client code before this util existed.

export interface ActionsResult {
  saved: number;
  errors?: string[];
}

export interface DonePayloadMeta {
  actions_result?: ActionsResult;
  persistence_error?: string;
}

export interface DonePayloadHandlers {
  onNotesSaved?: () => void;
  onActionError?: (messages: string[]) => void;
}

export function applyDonePayload(
  payload: DonePayloadMeta,
  handlers: DonePayloadHandlers
): void {
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
