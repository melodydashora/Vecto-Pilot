import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { MessageSquare, Send, Loader, Zap, Paperclip, X, BookOpen, Pin, Trash2, Edit2, ChevronRight, AlertCircle, Mic, MicOff, Volume2, VolumeX, FileText, FolderOpen, Camera } from "lucide-react";
import { useCoachChat } from "@/hooks/coach/useCoachChat";
import { useCoachAudioState, type CoachPlaybackSpeed } from "@/hooks/coach/useCoachAudioState";
import { useStreamingReadAloud } from "@/hooks/coach/useStreamingReadAloud";
import { cleanTextForTTS } from "@/utils/coach/cleanTextForTTS";
import { CoachStopBar } from "@/components/coach/CoachStopBar";
import { CameraCaptureModal } from "@/components/coach/CameraCaptureModal";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

// 2026-04-29: TTS speed-selector tier values, used in the chip UI.
const SPEED_OPTIONS: CoachPlaybackSpeed[] = [1.0, 1.25, 1.5, 2.0];

// 2026-05-04 (COACH-V1): Hands-free voice stop phrases. Word-boundary, case-insensitive.
//
// Two semantic intents, each with multiple natural-language variants. The same
// phrase ("I'm done") is in both — disambiguated at runtime by which effect
// is gated active: the stop-and-output effect requires (isListening && !isSpeaking),
// and the stop-replying effect requires (isSpeaking). So "I'm done" fires the
// correct intent based on context. Drivers don't have to learn separate phrases.
//
// Phrase set comes from in-vehicle test feedback 2026-05-04: drivers naturally
// say things like "go ahead", "I've completed my thoughts", "this feature is
// complete" — broader than the original "stop and output" / "stop replying".
//
// SUBMIT/STOP-MIC intent (while listening): captured speech → send to Coach.
const STOP_AND_OUTPUT_REGEX = /\b(stop\s+and\s+output|i'?m\s+done|i\s+am\s+done|i'?ve\s+completed\s+my\s+thoughts|this\s+feature\s+is\s+complete|go\s+ahead|send\s+it|that'?s\s+all)\b/i;
// INTERRUPT-TTS intent (while Coach speaking): cancel TTS, mic continues.
const STOP_REPLYING_REGEX = /\b(stop\s+replying|stop\s+and\s+listen|stop\s+talking|be\s+quiet|hold\s+on|pause|i'?m\s+done|i\s+am\s+done)\b/i;
// 2026-01-09: P1-6 FIX - Use centralized storage keys
import { STORAGE_KEYS } from "@/constants/storageKeys";
import { COACH_STREAMING_TTS_ENABLED } from "@/constants/featureFlags";
import { API_ROUTES } from "@/constants/apiRoutes";

// 2026-01-05: Added for Coach notes panel feature
interface UserNote {
  id: string;
  note_type: 'preference' | 'insight' | 'tip' | 'feedback' | 'pattern' | 'market_update';
  category?: string;
  title: string;
  content: string;
  importance: number;
  is_pinned: boolean;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface SnapshotData {
  snapshot_id?: string;
  city?: string;
  state?: string;
  country?: string;
  formatted_address?: string;
  dow?: number; // 0=Sunday, 1=Monday, etc.
  hour?: number;
  day_part_key?: string;
  weather?: any; // { temp, condition, windSpeed, etc. }
  air?: any; // { aqi, pollutants, etc. }
  holiday?: string;
  is_holiday?: boolean;
  timezone?: string;
  lat?: number;
  lng?: number;
}

interface RideshareCoachProps {
  userId: string;
  snapshotId?: string;
  strategyId?: string;
  strategy?: string;
  snapshot?: SnapshotData;
  blocks?: any[];
  strategyReady?: boolean; // Indicates if strategy is still generating or complete
}

export default function RideshareCoach({
  userId,
  snapshotId,
  strategyId,
  strategy: _strategy,
  snapshot,
  blocks: _blocks = [],
  strategyReady = false
}: RideshareCoachProps) {
  const onSilenceRef = useRef<() => void>();
  const manualStopRef = useRef(false);

  // 2026-04-27: Step 4 — audio state (read-aloud toggle, TTS, STT, derived flags)
  // consolidated into useCoachAudioState. Component destructures the surface it
  // actually uses for stable useCallback deps.
  const audio = useCoachAudioState({
    onSilence: () => onSilenceRef.current?.(),
    silenceThresholdMs: 4000 // H3: 4 seconds silence sends text automatically
  });
  const {
    readAloudEnabled,
    setReadAloudEnabled,
    playbackSpeed,
    setPlaybackSpeed,
    isSpeaking,
    isListening,
    micSupported,
    transcript,
    speak,
    stopSpeak,
    warmUp,
    startMic,
    stopMic,
    clearTranscript,
  } = audio;

  const latestTranscriptRef = useRef('');
  // 2026-04-13: Track whether current message was sent via mic — auto-speak response if so
  const sentViaVoiceRef = useRef(false);
  // 2026-05-04 (COACH-V1): once-per-session guards for the stop-phrase effects
  // (transcript changes per recognition tick; without these the effects re-fire).
  const stopAndOutputFiredRef = useRef(false);
  const stopReplyingFiredRef = useRef(false);
  // 2026-05-04 (COACH-V1): tracks isSpeaking transition true→false for auto-resume mic on TTS end.
  const wasSpeakingRef = useRef(false);

  // 2026-04-27: Step 5 — streaming TTS chunks. Flag-gated OFF by default;
  // Step 6 flips the default. When OFF, pushDelta/flush are never called.
  const streaming = useStreamingReadAloud({ speak, stopSpeak, playbackSpeed });

  const [input, setInput] = useState("");

  // Attachment popover + camera modal state.
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [cameraModalOpen, setCameraModalOpen] = useState(false);

  // Feature-detect: touch-capable devices route Camera to the native input
  // (which opens iOS/Android camera UI); non-touch desktops open the modal.
  const preferNativeCamera = typeof window !== 'undefined' && 'ontouchstart' in window;

  const handleOpenCamera = useCallback(() => {
    setAttachMenuOpen(false);
    if (preferNativeCamera) {
      cameraInputRef.current?.click();
    } else {
      setCameraModalOpen(true);
    }
  }, [preferNativeCamera, cameraInputRef]);

  // 2026-01-05: Notes panel state for Coach memory feature
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesLoading, setNotesLoading] = useState(false);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);

  // 2026-01-05: Notes CRUD functions with optimistic UI — defined before useCoachChat
  // so the hook's onNotesSaved callback can reference fetchNotes directly.
  const fetchNotes = useCallback(async () => {
    setNotesLoading(true);
    try {
      const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      const res = await fetch(API_ROUTES.COACH.NOTES_WITH_PARAMS, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes || []);
      }
    } catch (err) {
      console.error('[RideshareCoach] Failed to fetch notes:', err);
    } finally {
      setNotesLoading(false);
    }
  }, []);

  // 2026-04-26: Audio policy — gate post-stream auto-speak on read-aloud toggle OR mic-sourced send.
  // The mic-sourced bypass preserves the "you spoke, you want to hear the answer" UX even when muted.
  // 2026-04-27 (Step 5): when COACH_STREAMING_TTS_ENABLED, flush() drains the
  // remaining streamed buffer instead of speaking the full blob.
  const handleStreamComplete = useCallback((fullResponse: string) => {
    if (!readAloudEnabled && !sentViaVoiceRef.current) return;

    if (COACH_STREAMING_TTS_ENABLED) {
      streaming.flush();
    } else {
      const spokenText = cleanTextForTTS(fullResponse);
      if (spokenText.length > 0) {
        console.log(`[RideshareCoach] TTS: speaking ${spokenText.length} chars at ${playbackSpeed}×`);
        speak(spokenText.slice(0, 4000), 'en', playbackSpeed);
      }
    }
    sentViaVoiceRef.current = false;
  }, [readAloudEnabled, speak, streaming, playbackSpeed]);

  // 2026-04-27 (Step 5): per-delta hook for chunked TTS. Same gate as
  // handleStreamComplete — duplication is intentional (keeps streaming hook
  // generic; coach UX policy stays in the component).
  const handleStreamDelta = useCallback((delta: string) => {
    if (!COACH_STREAMING_TTS_ENABLED) return;
    if (!readAloudEnabled && !sentViaVoiceRef.current) return;
    streaming.pushDelta(delta);
  }, [readAloudEnabled, streaming]);

  // 2026-04-26: Step 3 — chat lifecycle (SSE stream, action tags, persistence,
  // attachments, abort) extracted to useCoachChat. Component now owns only
  // input field state, audio state (until step 4), and notes panel state.
  const {
    messages: msgs,
    setMessages: _setMsgs,
    isStreaming,
    send,
    validationErrors,
    attachments,
    setAttachments,
    fileInputRef,
    folderInputRef,
    cameraInputRef,
    handleFileSelect,
    appendAttachmentFromDataUrl,
    compressingFiles,
    messagesEndRef,
  } = useCoachChat({
    userId,
    snapshotId,
    strategyId,
    snapshot,
    strategyReady,
    onStreamComplete: handleStreamComplete,
    onStreamDelta: handleStreamDelta,
    onNotesSaved: fetchNotes,
  });
  void _setMsgs;

  // 2026-04-13: Sync speech transcript to ref to avoid stale closure in setTimeout
  useEffect(() => {
    latestTranscriptRef.current = transcript;
  }, [transcript]);

  // H3: VAD Silence Timeout Implementation
  onSilenceRef.current = () => {
    const text = latestTranscriptRef.current.trim();
    if (text) {
      console.log('[RideshareCoach] VAD silence timeout triggered (3-5s) — auto-sending');
      warmUp();
      stopMic();
      setTimeout(() => {
        sentViaVoiceRef.current = true;
        send(text);
        clearTranscript();
      }, 300);
    }
  };

  // 2026-05-04 (COACH-V1): Hands-free auto-listen on Coach tab mount.
  // Pre-flight mic permission (TranslationOverlay pattern), then auto-start
  // listening so the driver doesn't tap anything when entering the Coach tab.
  // Tab leave (component unmount) stops the mic via cleanup. Default on;
  // opt out by setting localStorage[COACH_AUTO_LISTEN_ENABLED] = 'false'.
  useEffect(() => {
    const autoListenEnabled =
      localStorage.getItem(STORAGE_KEYS.COACH_AUTO_LISTEN_ENABLED) !== 'false';
    if (!autoListenEnabled) return;
    if (!micSupported) return;
    if (!navigator.mediaDevices?.getUserMedia) return;

    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        if (!cancelled) {
          console.log('[RideshareCoach] [COACH-V1] Auto-listen: permission granted, starting mic');
          startMic('en');
        }
      })
      .catch((err) => {
        // Permission denied — manual mic toggle (line ~672) remains as fallback.
        console.warn('[RideshareCoach] [COACH-V1] Auto-listen: permission denied', err?.message);
        setMicPermissionDenied(true);
      });

    // Tab leave / component unmount → stop MIC ONLY. TTS intentionally persists
    // across tab changes per Melody's in-vehicle test feedback 2026-05-04:
    //   "I like this speaking that persist when I switch tabs cause I may need
    //    to go back to strategy or to briefing to verify something while I am
    //    on the app."
    // The driver wants to navigate to Strategy/Briefing/etc. while Coach reads
    // the answer aloud. Killing TTS on unmount would break that flow.
    // The big red STOP bar remains the manual cancel for TTS when the driver
    // actually wants playback to stop.
    return () => {
      cancelled = true;
      stopMic();
      // Do NOT call stopSpeak() or streaming.abort() here — TTS must persist.
    };
  }, []); // Mount-only, intentional — destructured callbacks are stable refs

  // 2026-03-18: FIX (C-4) — Always refetch when panel opens (was only fetching when empty)
  useEffect(() => {
    if (notesOpen) {
      fetchNotes();
    }
  }, [notesOpen, fetchNotes]);

  // Optimistic delete with rollback
  const deleteNote = useCallback(async (noteId: string) => {
    const original = notes;
    setNotes(prev => prev.filter(n => n.id !== noteId));

    try {
      const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      const res = await fetch(API_ROUTES.COACH.NOTE(noteId), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Delete failed');
      console.log('[RideshareCoach] Note deleted:', noteId);
    } catch (err) {
      console.error('[RideshareCoach] Delete failed, rolling back:', err);
      setNotes(original); // Rollback on error
    }
  }, [notes]);

  // Optimistic pin toggle with rollback
  const togglePinNote = useCallback(async (noteId: string) => {
    const original = notes;
    setNotes(prev => prev.map(n =>
      n.id === noteId ? { ...n, is_pinned: !n.is_pinned } : n
    ));

    try {
      const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      const res = await fetch(API_ROUTES.COACH.NOTE_PIN(noteId), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Pin toggle failed');
      console.log('[RideshareCoach] Note pin toggled:', noteId);
    } catch (err) {
      console.error('[RideshareCoach] Pin toggle failed, rolling back:', err);
      setNotes(original);
    }
  }, [notes]);

  // Update note content
  const saveNoteEdit = useCallback(async (noteId: string) => {
    if (!editContent.trim()) return;

    const original = notes;
    setNotes(prev => prev.map(n =>
      n.id === noteId ? { ...n, content: editContent } : n
    ));
    setEditingNote(null);

    try {
      const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      const res = await fetch(API_ROUTES.COACH.NOTE(noteId), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ content: editContent })
      });
      if (!res.ok) throw new Error('Update failed');
      console.log('[RideshareCoach] Note updated:', noteId);
    } catch (err) {
      console.error('[RideshareCoach] Update failed, rolling back:', err);
      setNotes(original);
    }
    setEditContent("");
  }, [notes, editContent]);

  // 2026-04-14: Client-side handleEventDeactivation removed (was duplicate of server-side action tag parsing).
  // Server path (chat.js → coach-dal.js) handles DEACTIVATE_EVENT with Zod validation. See RIDESHARE_COACH.md §3.

  // 2026-04-13: Mic toggle — start/stop speech recognition, auto-send transcript
  // Same pattern as TranslationOverlay: latestTranscriptRef avoids stale closure in setTimeout
  const handleMicToggle = useCallback(() => {
    manualStopRef.current = false;
    if (isListening) {
      // 2026-04-13: Warm up audio element NOW (user gesture context) so TTS can
      // play later after streaming completes (browsers block delayed audio.play())
      warmUp();
      stopMic();
      // 300ms delay lets final onresult events commit before we read the ref
      setTimeout(() => {
        const text = latestTranscriptRef.current.trim();
        if (text) {
          sentViaVoiceRef.current = true;
          send(text);
        }
        clearTranscript();
      }, 300);
    } else {
      // Interrupt coach TTS if it's speaking when driver starts talking.
      // 2026-04-27 (Step 5): with streaming flag, abort() also clears the chunk queue.
      if (COACH_STREAMING_TTS_ENABLED) {
        streaming.abort();
      } else if (isSpeaking) {
        stopSpeak();
      }
      clearTranscript();
      startMic('en');
    }
  }, [isListening, isSpeaking, warmUp, stopMic, clearTranscript, startMic, stopSpeak, send, streaming]);

  // 2026-05-04 (COACH-V1, fix-2): hard-cancel BOTH audio paths. The bar's STOP
  // button and the verbal stop-phrase MUST kill the streaming chunk queue too,
  // not just the non-streaming HTMLAudioElement. Without this, the streaming
  // buffer drains independently and the user perceives "stop did nothing."
  const handleStopAllAudio = useCallback(() => {
    manualStopRef.current = true;
    try { streaming.abort(); } catch { /* no-op */ }
    try { stopSpeak(); } catch { /* no-op */ }
  }, [stopSpeak, streaming]);

  // 2026-05-04 (COACH-V1): "stop and output" stop phrase. Fires only while listening
  // AND not speaking (suppress during TTS — Coach saying the phrase via speaker bleed
  // would otherwise trigger a self-stop). Mirrors handleMicToggle's stop-then-send-after-
  // 300ms pattern, but reads the cleaned (phrase-stripped) transcript so the trigger
  // text doesn't appear in the user's question.
  useEffect(() => {
    if (!isListening) {
      stopAndOutputFiredRef.current = false;
      return;
    }
    if (isSpeaking) return; // feedback-loop guard
    if (stopAndOutputFiredRef.current) return;
    if (!STOP_AND_OUTPUT_REGEX.test(transcript)) return;

    stopAndOutputFiredRef.current = true;
    const cleaned = transcript.replace(STOP_AND_OUTPUT_REGEX, '').trim();
    latestTranscriptRef.current = cleaned;
    console.log('[RideshareCoach] [COACH-V1] "stop and output" detected — sending cleaned transcript');

    warmUp();
    stopMic();
    setTimeout(() => {
      const text = latestTranscriptRef.current.trim();
      if (text) {
        sentViaVoiceRef.current = true;
        send(text);
      }
      clearTranscript();
    }, 300);
  }, [transcript, isListening, isSpeaking, warmUp, stopMic, send, clearTranscript]);

  // 2026-05-04 (COACH-V1): "stop replying" stop phrase. Only acts while TTS is
  // speaking. Cancels TTS; mic stays listening so the driver can immediately
  // ask a follow-up without re-tapping. Once-per-speaking-session via the
  // stopReplyingFiredRef guard.
  useEffect(() => {
    if (!isSpeaking) {
      stopReplyingFiredRef.current = false;
      return;
    }
    if (stopReplyingFiredRef.current) return;
    if (!STOP_REPLYING_REGEX.test(transcript)) return;

    stopReplyingFiredRef.current = true;
    console.log('[RideshareCoach] [COACH-V1] TTS-stop phrase detected (replying/listen/done) — hard-cancelling all audio, mic continues');

    handleStopAllAudio();
    clearTranscript();
  }, [transcript, isSpeaking, handleStopAllAudio, clearTranscript]);

  // 2026-05-04 (COACH-V1): Auto-resume mic on TTS end. Clears any transcript
  // captured during TTS (likely the Coach's own voice via speaker bleed) so the
  // driver's next utterance starts from a clean slate.
  useEffect(() => {
    if (wasSpeakingRef.current && !isSpeaking) {
      console.log('[RideshareCoach] [COACH-V1] TTS ended — clearing transcript, resuming mic');
      clearTranscript();
      const autoListenEnabled =
        localStorage.getItem(STORAGE_KEYS.COACH_AUTO_LISTEN_ENABLED) !== 'false';
      if (manualStopRef.current) {
        console.log('[RideshareCoach] Manual stop detected, skipping auto-resume');
        manualStopRef.current = false;
      } else if (autoListenEnabled && !isListening && micSupported) {
        // H1: 500ms delay before resuming mic to prevent capturing TTS tail/echo
        setTimeout(() => {
          if (!manualStopRef.current) startMic('en');
        }, 500);
      }
    }
    wasSpeakingRef.current = isSpeaking;
  }, [isSpeaking, isListening, micSupported, startMic, clearTranscript]);

  // 2026-04-26: Submit handler — gates and clears input, then delegates to chat.send.
  // Preserves the original semantics: empty input + no attachments → no-op (input untouched);
  // mid-stream click → no-op (typing preserved).
  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (isStreaming) return;
    setInput("");
    send(text);
  }, [input, attachments, isStreaming, send]);

  const suggestedQuestions = [
    "Where should I go right now?",
    "What's happening in my area?",
    "Let's just chat",
  ];

  return (
    <Card className="relative flex flex-col h-[580px] border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 overflow-hidden shadow-lg rounded-xl">
      {/* 2026-05-04 (COACH-V1): Driver-safety three-state bar — full-width, 80px tall, always at top.
          IDLE (green) → tap starts mic via synchronous user gesture (mobile-safe bootstrap).
          LISTENING (blue) → tap stops mic and sends captured speech.
          SPEAKING (red) → tap cancels Coach TTS only; mic remains listening. */}
      <CoachStopBar
        isSpeaking={isSpeaking}
        isListening={isListening}
        onStopSpeak={handleStopAllAudio}
        onMicToggle={handleMicToggle}
      />
      {/* Clean Header with Notes Button */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-white/20">
          <Zap className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-sm">Coach</h3>
          <p className="text-xs text-white/80">Powered by Gemini 3 Pro</p>
        </div>
        {/* 2026-04-13: Voice Output Toggle */}
        <Button
          onClick={() => {
            const next = !readAloudEnabled;
            setReadAloudEnabled(next);  // hook persists to localStorage (new key)
            if (next) warmUp(); // Unlock audio on enable gesture
            else stopSpeak();
          }}
          size="sm"
          variant="ghost"
          className="text-white hover:bg-white/20"
          title={readAloudEnabled ? 'Mute coach voice' : 'Enable coach voice'}
          data-testid="button-voice-toggle"
        >
          {readAloudEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </Button>
        {/* 2026-04-29: TTS speed selector — visible only when read-aloud is on.
            Browser timestretch preserves pitch up to ~2× cleanly for speech. */}
        {readAloudEnabled && (
          <div
            className="flex items-center gap-0.5 bg-white/10 rounded-full px-1 py-0.5"
            data-testid="speed-selector"
            role="group"
            aria-label="Playback speed"
          >
            {/* 2026-04-30: chip polish — text-[10px]→text-xs (AA-readable), px-1.5
                py-0.5→px-2 py-1 (better hit target + matches sibling Button height),
                hover:bg-white/10→hover:bg-white/20 (visible against the bg-white/10
                parent), inactive text-white/70→text-white (passes AA-small contrast). */}
            {SPEED_OPTIONS.map((speed) => (
              <button
                key={speed}
                type="button"
                aria-pressed={playbackSpeed === speed}
                onClick={() => setPlaybackSpeed(speed)}
                className={`text-xs px-2 py-1 rounded-full transition ${
                  playbackSpeed === speed
                    ? 'bg-white text-blue-700 font-bold shadow-sm'
                    : 'text-white hover:bg-white/20'
                }`}
                title={`Playback speed ${speed}×`}
                data-testid={`button-speed-${speed}`}
              >
                {speed === 1.0 ? '1×' : `${speed}×`}
              </button>
            ))}
          </div>
        )}
        {/* 2026-01-05: Notes Panel Toggle */}
        <Button
          onClick={() => setNotesOpen(!notesOpen)}
          size="sm"
          variant="ghost"
          className="text-white hover:bg-white/20 relative"
          title="View Coach's Notes About You"
          data-testid="button-toggle-notes"
        >
          <BookOpen className="h-4 w-4" />
          {notes.length > 0 && (
            <span className="absolute -top-1 -right-1 h-4 w-4 bg-yellow-400 text-blue-900 rounded-full text-[10px] font-bold flex items-center justify-center">
              {notes.length > 9 ? '9+' : notes.length}
            </span>
          )}
        </Button>
      </div>

      {/* Validation Errors Banner */}
      {validationErrors.length > 0 && (
        <div className="px-4 py-2 bg-red-50 dark:bg-red-900/50 border-b border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <div className="text-xs">
              {validationErrors.map((err, i) => (
                <span key={i}>
                  <strong>{err.field}:</strong> {err.message}
                  {i < validationErrors.length - 1 && ' | '}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mic Permission Denied Banner */}
      {micPermissionDenied && (
        <div className="px-4 py-2 bg-yellow-50 dark:bg-yellow-900/50 border-b border-yellow-200 dark:border-yellow-800">
          <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <div className="text-xs">
              <strong>Microphone Access Denied:</strong> Coach cannot hear you. Please allow microphone access in your browser settings to use hands-free voice commands.
            </div>
          </div>
        </div>
      )}

      {/* Notes Panel (Slide-out) */}
      {notesOpen && (
        <div className="absolute inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setNotesOpen(false)}
          />
          {/* Panel */}
          <div className="relative ml-auto w-80 h-full bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-gray-700 flex flex-col shadow-xl animate-slide-in-right">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-amber-500 to-orange-500 text-white">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                <h3 className="font-semibold text-sm">Coach's Notes</h3>
              </div>
              <Button
                onClick={() => setNotesOpen(false)}
                size="sm"
                variant="ghost"
                className="text-white hover:bg-white/20"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <p className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
              Things I've learned about you from our chats
            </p>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {notesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader className="h-5 w-5 animate-spin text-amber-500" />
                </div>
              ) : notes.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No notes yet</p>
                  <p className="text-xs">Chat with me to build your profile!</p>
                </div>
              ) : (
                notes.map(note => (
                  <div
                    key={note.id}
                    className={`p-3 rounded-lg border text-sm ${
                      note.is_pinned
                        ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-700'
                        : 'bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                        note.note_type === 'preference' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                        note.note_type === 'insight' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' :
                        note.note_type === 'tip' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                        'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                      }`}>
                        {note.note_type}
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => togglePinNote(note.id)}
                          className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
                            note.is_pinned ? 'text-amber-500' : 'text-gray-400'
                          }`}
                          title={note.is_pinned ? 'Unpin' : 'Pin'}
                        >
                          <Pin className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => {
                            setEditingNote(note.id);
                            setEditContent(note.content);
                          }}
                          className="p-1 rounded text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-blue-500"
                          title="Edit"
                        >
                          <Edit2 className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => deleteNote(note.id)}
                          className="p-1 rounded text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-red-500"
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <h4 className="font-medium text-gray-900 dark:text-white text-sm mb-1">{note.title}</h4>
                    {editingNote === note.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={editContent}
                          onChange={e => setEditContent(e.target.value)}
                          className="w-full p-2 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                          rows={3}
                        />
                        <div className="flex gap-1">
                          <Button size="sm" onClick={() => saveNoteEdit(note.id)} className="text-xs h-6">
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingNote(null)} className="text-xs h-6">
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-gray-600 dark:text-gray-300 text-xs leading-relaxed">{note.content}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-400">
                      <span>{note.created_by === 'ai_coach' ? '🤖 AI' : '👤 You'}</span>
                      <span>•</span>
                      <span>{new Date(note.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Messages Area - Light background for readability */}
      {/* 2026-04-16: WCAG — role="log" + aria-live for screen reader announcement of new messages */}
      <div role="log" aria-live="polite" className="flex-1 overflow-auto p-4 space-y-4 bg-gray-50 dark:bg-slate-800">
        {msgs.length === 0 && (
          <div className="text-center py-8 space-y-4">
            <div className="inline-flex items-center justify-center h-14 w-14 bg-blue-100 dark:bg-blue-900 rounded-full">
              <MessageSquare className="h-7 w-7 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white text-base mb-2">Hey! I'm Your Coach</h4>
              <p className="text-sm text-gray-600 dark:text-gray-300 max-w-sm mx-auto leading-relaxed">
                Ask me anything - rideshare strategy, life advice, or just chat. I can search the web too!
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center pt-3">
              {suggestedQuestions.map((q, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="text-xs bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-blue-50 dark:hover:bg-blue-900 hover:border-blue-400 shadow-sm"
                  onClick={() => {
                    setInput(q);
                    setTimeout(() => {
                      send(q);
                      setInput("");
                    }, 100);
                  }}
                  data-testid={`button-suggested-${i}`}
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) => (
          <div
            key={i}
            className={`flex gap-2 animate-fade-in ${m.role === "user" ? "justify-end" : "justify-start"}`}
            data-testid={`message-${m.role}-${i}`}
          >
            {m.role === "assistant" && (
              <div className="flex-shrink-0 h-7 w-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
                <Zap className="h-3.5 w-3.5 text-white" />
              </div>
            )}
            {/* 2026-04-09: Added break-words to prevent long URLs/paths from overflowing chat bubbles */}
            <div
              className={`inline-block rounded-2xl px-4 py-2.5 max-w-[75%] shadow-sm break-words ${
                m.role === "user"
                  ? "bg-blue-600 text-white rounded-br-sm"
                  : "bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-bl-sm"
              }`}
            >
              <p className={`text-sm leading-relaxed ${m.role === "assistant" ? "whitespace-pre-wrap" : ""}`}>
                {m.content || (m.role === "assistant" && isStreaming && i === msgs.length - 1 ? (
                  <span className="inline-flex items-center gap-1.5 text-gray-500">
                    <Loader className="h-3.5 w-3.5 animate-spin" />
                    Thinking...
                  </span>
                ) : "")}
              </p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Attachments Display */}
      {(attachments.length > 0 || compressingFiles.size > 0) && (
        <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/50 border-t border-blue-200 dark:border-blue-800 flex flex-wrap gap-2">
          {attachments.map((file, i) => (
            <div key={i} className="flex items-center gap-1 bg-white dark:bg-slate-700 px-2 py-1 rounded-full text-xs text-gray-700 dark:text-gray-200 border border-blue-200 dark:border-blue-600">
              <Paperclip className="h-3 w-3" />
              <span className="truncate max-w-[100px]">{file.name}</span>
              <button
                onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                className="hover:text-red-500"
                data-testid={`button-remove-attachment-${i}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {Array.from(compressingFiles).map((name) => (
            <div key={`compressing-${name}`} className="flex items-center gap-1 bg-white dark:bg-slate-700 px-2 py-1 rounded-full text-xs text-gray-500 dark:text-gray-400 border border-blue-200 dark:border-blue-600 opacity-70">
              <Loader className="h-3 w-3 animate-spin" />
              <span className="truncate max-w-[100px]">{name}</span>
            </div>
          ))}
        </div>
      )}

      {/* 2026-04-13: Listening indicator — shows real-time transcript while mic is active */}
      {isListening && (
        <div className="px-4 py-2 bg-green-50 dark:bg-green-900/30 border-t border-green-200 dark:border-green-800 flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <p className="text-sm text-green-800 dark:text-green-200 flex-1 truncate">
            {transcript || 'Listening...'}
          </p>
          <button
            onClick={handleMicToggle}
            className="text-xs text-green-700 dark:text-green-300 underline"
          >
            Done
          </button>
        </div>
      )}

      {/* Input Area */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 flex gap-2">
        <Input
          id="coach-chat-message"
          name="coach-chat-message"
          className="flex-1 rounded-full border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          placeholder={isListening ? "Listening..." : "Ask anything - rideshare tips, life advice, or just chat..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !isStreaming && handleSubmit()}
          disabled={isStreaming || isListening}
          autoComplete="off"
          data-testid="input-chat-message"
        />

        {/* Hidden inputs — three sources, one handler */}
        <input
          id="coach-file-upload"
          name="coach-file-upload"
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          accept="image/*,.pdf,.doc,.docx,.txt"
          data-testid="input-file-upload"
        />
        <input
          id="coach-folder-upload"
          name="coach-folder-upload"
          ref={folderInputRef}
          type="file"
          multiple
          // @ts-expect-error - webkitdirectory not in standard HTMLInputElement types
          webkitdirectory=""
          directory=""
          onChange={handleFileSelect}
          className="hidden"
          data-testid="input-folder-upload"
        />
        <input
          id="coach-camera-capture"
          name="coach-camera-capture"
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelect}
          className="hidden"
          data-testid="input-camera-capture"
        />

        {/* Attachment Popover Menu */}
        <Popover open={attachMenuOpen} onOpenChange={setAttachMenuOpen}>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              className="rounded-full h-10 w-10 bg-gray-500 hover:bg-gray-600 text-white"
              title="Attach files, folder, or camera"
              disabled={isStreaming || isListening}
              data-testid="button-attachment-menu"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-44 p-1" align="end" side="top">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-accent text-left"
              onClick={() => { setAttachMenuOpen(false); fileInputRef.current?.click(); }}
              data-testid="button-attach-files"
            >
              <FileText className="h-4 w-4" /> Files
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-accent text-left"
              onClick={() => { setAttachMenuOpen(false); folderInputRef.current?.click(); }}
              data-testid="button-attach-folder"
            >
              <FolderOpen className="h-4 w-4" /> Folder
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-accent text-left"
              onClick={handleOpenCamera}
              data-testid="button-attach-camera"
            >
              <Camera className="h-4 w-4" /> Camera
            </button>
          </PopoverContent>
        </Popover>

        {/* Camera Capture Modal (desktop path) */}
        <CameraCaptureModal
          open={cameraModalOpen}
          onClose={() => setCameraModalOpen(false)}
          onCapture={(dataUrl) => appendAttachmentFromDataUrl(dataUrl)}
        />

        {/* 2026-04-13: Mic Button — big, prominent, pulses red while listening */}
        {micSupported && (
          <Button
            onClick={handleMicToggle}
            size="icon"
            className={`rounded-full h-10 w-10 text-white transition-colors ${
              isListening
                ? 'bg-red-500 hover:bg-red-600 animate-pulse'
                : 'bg-green-600 hover:bg-green-700'
            }`}
            title={isListening ? 'Stop listening & send' : 'Speak to coach'}
            disabled={isStreaming}
            data-testid="button-mic-toggle"
          >
            {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        )}

        {/* Send Button */}
        <Button
          onClick={handleSubmit}
          disabled={(!input.trim() && !isListening) || isStreaming}
          size="icon"
          className="rounded-full h-10 w-10 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40"
          data-testid="button-send-message"
        >
          {isStreaming ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </Card>
  );
}
