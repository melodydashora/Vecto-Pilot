// client/src/components/coach/CoachStopBar.tsx
// COACH-V1 (2026-05-04): Driver-safety three-state action bar for the Coach UI.
//
// Sized for in-vehicle peripheral-vision tapping: full-width, h-20 (80px).
// This is intentionally larger than standard primary CTAs (typ. 40-48px)
// because the safety constraint trumps visual hierarchy — "tiny right now
// could mean the difference between an accident and an accident" (Melody).
//
// Three-state machine, priority order: speaking > listening > idle.
//
//   IDLE      (green)  "🎤 TAP TO ENABLE MIC"        → onMicToggle (start mic)
//   LISTENING (blue)   "🎤 LISTENING — tap to stop"  → onMicToggle (stop mic, send capture)
//   SPEAKING  (red)    "■ STOP"                      → onStopSpeak (cancel TTS, mic continues)
//
// Why three states instead of just stop:
//   Mobile browsers (especially iOS Safari) require recognition.start() to be
//   inside a synchronous user-gesture handler. The mount-effect auto-start
//   chained off getUserMedia.then() loses gesture context and silently fails.
//   The IDLE state of this bar is the reliable bootstrap path: when auto-start
//   doesn't take, the driver taps the green bar and listening starts from a
//   real user gesture — works on every browser.
//
//   See translate-audit findings §12.A and the COACH-V1 plan doc Q2/Q4.

import { Mic, Square } from 'lucide-react';

interface CoachStopBarProps {
  /** Whether the Coach is currently speaking (TTS active). */
  isSpeaking: boolean;
  /** Whether the mic is actively listening. */
  isListening: boolean;
  /** Stops Coach TTS playback (mic should remain listening). */
  onStopSpeak: () => void;
  /** Toggles mic state. Implementation handles start vs stop based on isListening. */
  onMicToggle: () => void;
}

export function CoachStopBar({ isSpeaking, isListening, onStopSpeak, onMicToggle }: CoachStopBarProps) {
  // Priority: SPEAKING wins over LISTENING wins over IDLE.
  // Each state has a single, predictable action — never ambiguous mid-drive.

  if (isSpeaking) {
    return (
      <button
        type="button"
        onClick={onStopSpeak}
        aria-label="Stop Coach playback"
        data-testid="button-coach-stop-bar"
        data-state="speaking"
        className="
          w-full h-20
          flex items-center justify-center gap-3
          font-bold text-2xl select-none
          bg-red-600 hover:bg-red-700 active:bg-red-800
          text-white shadow-lg cursor-pointer
          transition-colors
        "
      >
        <Square className="h-8 w-8" fill="currentColor" strokeWidth={2.5} />
        <span>STOP</span>
      </button>
    );
  }

  if (isListening) {
    return (
      <button
        type="button"
        onClick={onMicToggle}
        aria-label="Mic is listening — tap to stop and send"
        data-testid="button-coach-stop-bar"
        data-state="listening"
        className="
          w-full h-20
          flex items-center justify-center gap-3
          font-bold text-xl select-none
          bg-blue-600 hover:bg-blue-700 active:bg-blue-800
          text-white shadow-md cursor-pointer
          transition-colors
        "
      >
        <Mic className="h-7 w-7 animate-pulse" strokeWidth={2.5} />
        <span>LISTENING — tap to stop</span>
      </button>
    );
  }

  // IDLE — bootstrap path. Tapping here starts the mic from a synchronous
  // user gesture, which mobile browsers accept where useEffect-chained calls
  // get rejected for gesture-token expiry.
  return (
    <button
      type="button"
      onClick={onMicToggle}
      aria-label="Tap to enable hands-free voice"
      data-testid="button-coach-stop-bar"
      data-state="idle"
      className="
        w-full h-20
        flex items-center justify-center gap-3
        font-bold text-xl select-none
        bg-green-600 hover:bg-green-700 active:bg-green-800
        text-white shadow-md cursor-pointer
        transition-colors
      "
    >
      <Mic className="h-7 w-7" strokeWidth={2.5} />
      <span>TAP TO ENABLE MIC</span>
    </button>
  );
}

export default CoachStopBar;
