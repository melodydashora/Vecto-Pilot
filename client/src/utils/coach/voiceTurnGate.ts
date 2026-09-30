// client/src/utils/coach/voiceTurnGate.ts
// 2026-09-11 (desktop-coach-acceptance item 4, verified in the current tree): RideshareCoach
// set `sentViaVoiceRef = true` before a spoken send and cleared it only when the stream
// COMPLETED. A voice turn that failed (HTTP 503, thrown fetch, abort) left the flag set, so
// the NEXT typed reply was read aloud even with read-aloud OFF. This gate makes the flag's
// lifetime explicit: it is armed when a voice turn is admitted, consumed by the completion
// handler, and disarmed when the send settles WITHOUT a completion.
export interface VoiceTurnGate {
  /** A voice turn was admitted: the next completed reply may be spoken. */
  arm(): void;
  /** The completion handler ran for the in-flight turn (spoken or not). */
  complete(): void;
  /** The send promise settled. If no completion happened, the flag is dropped. */
  settle(): void;
  /** Should a completed reply be spoken because the driver asked by voice? Consumes the flag. */
  consume(): boolean;
  readonly armed: boolean;
}

export function createVoiceTurnGate(): VoiceTurnGate {
  let armed = false;
  let completed = false;
  return {
    arm() { armed = true; completed = false; },
    complete() { completed = true; },
    settle() { if (!completed) armed = false; completed = false; },
    consume() { const spoken = armed; armed = false; return spoken; },
    get armed() { return armed; },
  };
}
