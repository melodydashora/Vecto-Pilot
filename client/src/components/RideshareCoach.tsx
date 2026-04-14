import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { MessageSquare, Send, Loader, Zap, Paperclip, X, BookOpen, Pin, Trash2, Edit2, ChevronRight, AlertCircle, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useMemory } from "@/hooks/useMemory";
import { useChatPersistence } from "@/hooks/useChatPersistence";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useTTS } from "@/hooks/useTTS";
// 2026-01-09: P1-6 FIX - Use centralized storage keys
import { STORAGE_KEYS } from "@/constants/storageKeys";
import { API_ROUTES } from "@/constants/apiRoutes";

// 2026-01-05: Added for AI Coach notes panel feature
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

interface ValidationError {
  field: string;
  message: string;
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
  // Use persistent state hook
  const { messages: msgs, setMessages: setMsgs, isLoaded: _isChatLoaded } = useChatPersistence(userId, snapshotId);
  
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ name: string; type: string; data: string; }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 2026-04-13: Voice integration — reuses Translation feature's proven hooks
  // STT: free on-device Web Speech API, TTS: OpenAI TTS-1-HD via /api/tts
  const speech = useSpeechRecognition();
  const tts = useTTS();
  const latestTranscriptRef = useRef('');
  const [voiceEnabled, setVoiceEnabled] = useState(() =>
    localStorage.getItem(STORAGE_KEYS.COACH_VOICE_ENABLED) === 'true'
  );

  // 2026-01-05: Notes panel state for AI Coach memory feature
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesLoading, setNotesLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  // Memory integration for conversation logging (context not used, so no loadOnMount)
  // 2026-01-06: Removed loadOnMount=true - was fetching /agent/context but result was unused (_context)
  const { logConversation, summarizeConversation } = useMemory({
    userId,
    loadOnMount: false  // Only load when explicitly needed
  });

  // 2026-04-13: Sync speech transcript to ref to avoid stale closure in setTimeout
  useEffect(() => {
    latestTranscriptRef.current = speech.transcript;
  }, [speech.transcript]);

  // 2026-01-05: Notes CRUD functions with optimistic UI
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

  // Handle validation errors from chat API (ready for future use)
  const _handleValidationErrors = useCallback((errors: ValidationError[]) => {
    setValidationErrors(errors);
    // Clear after 5 seconds
    setTimeout(() => setValidationErrors([]), 5000);
  }, []);

  // 2026-04-14: Client-side handleEventDeactivation removed (was duplicate of server-side action tag parsing).
  // Server path (chat.js → coach-dal.js) handles DEACTIVATE_EVENT with Zod validation. See RIDESHARE_COACH.md §3.

  // Log conversation when it ends (after assistant response completes)
  const logCurrentConversation = useCallback(async () => {
    if (msgs.length < 2) return; // Need at least one exchange

    const { topic, summary } = summarizeConversation(msgs);
    if (topic && summary) {
      await logConversation(topic, summary);
      console.log('[RideshareCoach] Conversation logged to memory');
    }
  }, [msgs, logConversation, summarizeConversation]);

  // Log conversation when streaming ends
  useEffect(() => {
    if (!isStreaming && msgs.length >= 2) {
      // Small delay to ensure last message is complete
      const timer = setTimeout(() => {
        logCurrentConversation();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, msgs.length, logCurrentConversation]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // 2026-04-13: Track whether current message was sent via mic — auto-speak response if so
  const sentViaVoiceRef = useRef(false);

  // 2026-04-13: Mic toggle — start/stop speech recognition, auto-send transcript
  // Same pattern as TranslationOverlay: latestTranscriptRef avoids stale closure in setTimeout
  const handleMicToggle = useCallback(() => {
    if (speech.isListening) {
      // 2026-04-13: Warm up audio element NOW (user gesture context) so TTS can
      // play later after streaming completes (browsers block delayed audio.play())
      tts.warmUp();
      speech.stop();
      // 300ms delay lets final onresult events commit before we read the ref
      setTimeout(() => {
        const text = latestTranscriptRef.current.trim();
        if (text) {
          sentViaVoiceRef.current = true;
          send(text);
        }
        speech.clear();
      }, 300);
    } else {
      // Interrupt coach TTS if it's speaking when driver starts talking
      if (tts.isSpeaking) tts.stop();
      speech.clear();
      speech.start('en');
    }
  }, [speech, tts]);

  // 2026-04-13: Strip markdown/action tags from coach response for clean TTS playback
  function cleanTextForTTS(text: string): string {
    return text
      .replace(/\[[\w_]+:\s*\{[\s\S]*?\}\s*\]/g, '')  // Remove action tags [SAVE_NOTE: {...}]
      .replace(/\*\*([^*]+)\*\*/g, '$1')                // Remove markdown bold
      .replace(/\*([^*]+)\*/g, '$1')                     // Remove markdown italic
      .replace(/```[\s\S]*?```/g, '')                    // Remove code blocks
      .replace(/`([^`]+)`/g, '$1')                       // Remove inline code
      .replace(/#{1,6}\s/g, '')                          // Remove headers
      .replace(/\n{2,}/g, '. ')                          // Paragraphs → pauses
      .replace(/\s{2,}/g, ' ')                           // Collapse whitespace
      .trim();
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.currentTarget.files;
    if (!files) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      
      reader.onload = (evt) => {
        const data = evt.target?.result as string;
        setAttachments(prev => [...prev, {
          name: file.name,
          type: file.type,
          data: data
        }]);
      };
      
      reader.readAsDataURL(file);
    }
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  // 2026-04-13: Added overrideMessage param so handleMicToggle can send transcript directly
  // without going through the input state (avoids stale closure race condition)
  async function send(overrideMessage?: string) {
    const messageText = overrideMessage || input.trim();
    if (!messageText && attachments.length === 0 || isStreaming) return;

    setInput("");
    const filesToSend = attachments;
    setAttachments([]);
    setMsgs((m) => [...m, { role: "user", content: messageText || "(uploaded files)", attachments: filesToSend }, { role: "assistant", content: "" }]);
    setIsStreaming(true);

    controllerRef.current?.abort();
    controllerRef.current = new AbortController();

    try {
      const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(API_ROUTES.CHAT.SEND, {
        method: "POST",
        headers,
        // 2026-01-06: P1-C - Reduced payload size
        // Server uses CoachDAL to rebuild full context from IDs
        // Only send: IDs + message + history + attachments + minimal snapshot for timezone
        body: JSON.stringify({
          userId,
          message: messageText || "(analyzing files)",
          threadHistory: msgs,  // Conversation context
          snapshotId,           // Server fetches full snapshot via CoachDAL
          strategyId,           // Server fetches strategy + blocks via CoachDAL
          attachments: filesToSend,
          // Minimal snapshot - only timezone (required) and city/state for early engagement
          snapshot: snapshot ? {
            city: snapshot.city,
            state: snapshot.state,
            timezone: snapshot.timezone,
            hour: snapshot.hour,
            day_part_key: snapshot.day_part_key
          } : undefined,
          strategyReady
        }),
        signal: controllerRef.current.signal,
      });

      if (!res.ok && res.headers.get("content-type")?.includes("text/event-stream") === false) {
        try {
          const errData = await res.json();
          // 2026-01-06: Handle specific error codes with user-friendly messages
          if (errData.code === 'missing_timezone') {
            setMsgs((m) => [...m.slice(0, -1), {
              role: "assistant",
              content: "I need your location to give you accurate advice! Please enable GPS in your browser settings and refresh the page."
            }]);
          } else {
            setMsgs((m) => [...m.slice(0, -1), { role: "assistant", content: `Sorry—chat failed: ${errData.message || errData.error}` }]);
          }
        } catch {
          const t = await res.text();
          setMsgs((m) => [...m.slice(0, -1), { role: "assistant", content: `Sorry—chat failed: ${t}` }]);
        }
        setIsStreaming(false);
        return;
      }

      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let acc = "";
      // 2026-04-13: Accumulate full response locally for TTS (avoids side-effect in setState)
      let fullResponse = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });

        // parse SSE lines
        for (const line of acc.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const msg = JSON.parse(line.slice(5).trim());
            if (msg.delta) {
              fullResponse += msg.delta;
              setMsgs((m) => {
                const copy = [...m];
                const last = copy[copy.length - 1];
                if (last?.role === "assistant") {
                  last.content += msg.delta;
                }
                return copy;
              });
              setTimeout(scrollToBottom, 10);
            }
            if (msg.error) {
              setMsgs((m) => {
                const copy = [...m];
                const last = copy[copy.length - 1];
                if (last?.role === "assistant") {
                  last.content = `Error: ${msg.error}`;
                }
                return copy;
              });
            }
            // 2026-03-18: FIX (C-4, H-4) — Handle action results from done event
            if (msg.actions_result) {
              // Refresh notes panel if any notes were saved
              if (msg.actions_result.saved > 0) {
                fetchNotes();
              }
              // Wire existing validation error banner (was dead code)
              if (msg.actions_result.errors?.length > 0) {
                setValidationErrors(
                  msg.actions_result.errors.map((e: string) => ({ field: 'action', message: e }))
                );
                setTimeout(() => setValidationErrors([]), 8000);
              }
            }
          } catch (_err) {
            // Ignore parse errors for partial SSE data
          }
        }
        // keep only last partial line in buffer
        const lastNl = acc.lastIndexOf("\n");
        if (lastNl >= 0) acc = acc.slice(lastNl + 1);
      }

      // 2026-04-13: Auto-speak coach response after streaming completes
      // Triggers if: voice toggle is ON, OR if the user spoke this message via mic
      // (If you spoke your question, you want to hear the answer — no toggle needed)
      if ((voiceEnabled || sentViaVoiceRef.current) && fullResponse) {
        const spokenText = cleanTextForTTS(fullResponse);
        if (spokenText.length > 0) {
          console.log(`[RideshareCoach] TTS: speaking ${spokenText.length} chars`);
          tts.speak(spokenText.slice(0, 4000), 'en');
        }
        sentViaVoiceRef.current = false;
      }
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name !== 'AbortError') {
        setMsgs((m) => [...m.slice(0, -1), { role: "assistant", content: `Connection error: ${error.message}` }]);
      }
    } finally {
      setIsStreaming(false);

      // 2026-04-14: Event deactivation is handled server-side via action tag parsing in chat.js.
      // No client-side duplicate processing needed.
    }
  }

  const suggestedQuestions = [
    "Where should I go right now?",
    "What's happening in my area?",
    "Let's just chat",
  ];

  return (
    <Card className="relative flex flex-col h-[500px] border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 overflow-hidden shadow-lg rounded-xl">
      {/* Clean Header with Notes Button */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-white/20">
          <Zap className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-sm">Rideshare Coach</h3>
          <p className="text-xs text-white/80">Powered by Gemini 3 Pro</p>
        </div>
        {/* 2026-04-13: Voice Output Toggle */}
        <Button
          onClick={() => {
            const next = !voiceEnabled;
            setVoiceEnabled(next);
            localStorage.setItem(STORAGE_KEYS.COACH_VOICE_ENABLED, String(next));
            if (next) tts.warmUp(); // Unlock audio on enable gesture
            else tts.stop();
          }}
          size="sm"
          variant="ghost"
          className="text-white hover:bg-white/20"
          title={voiceEnabled ? 'Mute coach voice' : 'Enable coach voice'}
          data-testid="button-voice-toggle"
        >
          {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </Button>
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
      <div className="flex-1 overflow-auto p-4 space-y-4 bg-gray-50 dark:bg-slate-800">
        {msgs.length === 0 && (
          <div className="text-center py-8 space-y-4">
            <div className="inline-flex items-center justify-center h-14 w-14 bg-blue-100 dark:bg-blue-900 rounded-full">
              <MessageSquare className="h-7 w-7 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white text-base mb-2">Hey! I'm Your Rideshare Coach</h4>
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
                    setTimeout(() => send(), 100);
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
      {attachments.length > 0 && (
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
        </div>
      )}

      {/* 2026-04-13: Listening indicator — shows real-time transcript while mic is active */}
      {speech.isListening && (
        <div className="px-4 py-2 bg-green-50 dark:bg-green-900/30 border-t border-green-200 dark:border-green-800 flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <p className="text-sm text-green-800 dark:text-green-200 flex-1 truncate">
            {speech.transcript || 'Listening...'}
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
          placeholder={speech.isListening ? "Listening..." : "Ask anything - rideshare tips, life advice, or just chat..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !isStreaming && send()}
          disabled={isStreaming || speech.isListening}
          autoComplete="off"
          data-testid="input-chat-message"
        />

        {/* File Input (Hidden) */}
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

        {/* File Upload Button */}
        <Button
          onClick={() => fileInputRef.current?.click()}
          size="icon"
          className="rounded-full h-10 w-10 bg-gray-500 hover:bg-gray-600 text-white"
          title="Upload files (images, PDFs, documents)"
          disabled={isStreaming || speech.isListening}
          data-testid="button-upload-file"
        >
          <Paperclip className="h-4 w-4" />
        </Button>

        {/* 2026-04-13: Mic Button — big, prominent, pulses red while listening */}
        {speech.isSupported && (
          <Button
            onClick={handleMicToggle}
            size="icon"
            className={`rounded-full h-10 w-10 text-white transition-colors ${
              speech.isListening
                ? 'bg-red-500 hover:bg-red-600 animate-pulse'
                : 'bg-green-600 hover:bg-green-700'
            }`}
            title={speech.isListening ? 'Stop listening & send' : 'Speak to coach'}
            disabled={isStreaming}
            data-testid="button-mic-toggle"
          >
            {speech.isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        )}

        {/* Send Button */}
        <Button
          onClick={() => send()}
          disabled={(!input.trim() && !speech.isListening) || isStreaming}
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
