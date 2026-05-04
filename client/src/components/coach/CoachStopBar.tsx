// client/src/components/coach/CoachStopBar.tsx
// COACH-V1 (2026-05-04): Driver-safety STOP button for the Coach UI.
//
// Sized for in-vehicle peripheral-vision tapping: full-width, h-20 (80px).
// This is intentionally larger than standard primary CTAs (typ. 40-48px)
// because the safety constraint trumps visual hierarchy — "tiny right now
// could mean the difference between an accident and an accident" (Melody).
//
// Behavior: tap stops Coach TTS playback only. Mic stays listening so the
// driver can immediately speak the next question without re-enabling voice.
//
// State: when Coach isn't speaking, the bar is rendered in a disabled
// (greyed) state so its location is predictable across the entire UX —
// drivers learn where to find it once, not "wait for it to appear."

import { Square } from 'lucide-react';

interface CoachStopBarProps {
  /** Whether the Coach is currently speaking (TTS active). */
  isSpeaking: boolean;
  /** Stops Coach TTS playback. Mic should remain listening. */
  onStop: () => void;
}

export function CoachStopBar({ isSpeaking, onStop }: CoachStopBarProps) {
  return (
    <button
      type="button"
      onClick={onStop}
      disabled={!isSpeaking}
      aria-label={isSpeaking ? 'Stop Coach playback' : 'Coach is not speaking'}
      data-testid="button-coach-stop-bar"
      className={`
        w-full
        h-20
        flex items-center justify-center gap-3
        font-bold text-2xl
        select-none
        transition-colors
        ${isSpeaking
          ? 'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white shadow-lg cursor-pointer'
          : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'}
      `}
    >
      <Square
        className="h-8 w-8"
        fill={isSpeaking ? 'currentColor' : 'none'}
        strokeWidth={2.5}
      />
      <span>STOP</span>
    </button>
  );
}

export default CoachStopBar;
