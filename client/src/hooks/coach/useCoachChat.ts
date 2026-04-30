// client/src/hooks/coach/useCoachChat.ts
// Encapsulates the Coach chat lifecycle: SSE streaming, action-tag
// parsing, persistence, attachments, and abort. Pure chat — no audio concerns.
//
// 2026-04-26: Extracted from RideshareCoach.tsx (Step 3 of COACH_PASS2_PHASE_B_PLAN).
// Internal variable names (`fullResponse`, `isStreaming`) preserved per plan contract.

import { useState, useRef, useCallback, useEffect } from 'react';
import { useChatPersistence, type ChatMessage } from '@/hooks/useChatPersistence';
import { useMemory } from '@/hooks/useMemory';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { API_ROUTES } from '@/constants/apiRoutes';

export interface CoachAttachment {
  name: string;
  type: string;
  data: string;
}

export interface CoachValidationError {
  field: string;
  message: string;
}

export interface CoachSnapshotPayload {
  city?: string;
  state?: string;
  timezone?: string;
  hour?: number;
  day_part_key?: string;
}

export interface UseCoachChatParams {
  userId: string;
  snapshotId?: string;
  strategyId?: string;
  snapshot?: CoachSnapshotPayload;
  strategyReady?: boolean;
  /** Fired once SSE stream completes successfully with the assembled assistant response. */
  onStreamComplete?: (fullResponse: string) => void;
  /** Fired on each SSE delta as it arrives (for streaming consumers like read-aloud chunks). */
  onStreamDelta?: (delta: string) => void;
  /** Fired when the server reports notes were saved via action tags (caller refetches). */
  onNotesSaved?: () => void;
}

export interface UseCoachChatReturn {
  messages: ChatMessage[];
  setMessages: (m: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  isMessagesLoaded: boolean;

  isStreaming: boolean;
  send: (text: string, attachmentsOverride?: CoachAttachment[]) => Promise<void>;
  abort: () => void;

  validationErrors: CoachValidationError[];

  attachments: CoachAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<CoachAttachment[]>>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;

  messagesEndRef: React.RefObject<HTMLDivElement>;
}

export function useCoachChat({
  userId,
  snapshotId,
  strategyId,
  snapshot,
  strategyReady = false,
  onStreamComplete,
  onStreamDelta,
  onNotesSaved,
}: UseCoachChatParams): UseCoachChatReturn {
  const { messages: msgs, setMessages: setMsgs, isLoaded: _isChatLoaded } = useChatPersistence(userId, snapshotId);

  const [isStreaming, setIsStreaming] = useState(false);
  const [attachments, setAttachments] = useState<CoachAttachment[]>([]);
  const [validationErrors, setValidationErrors] = useState<CoachValidationError[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { logConversation, summarizeConversation } = useMemory({
    userId,
    loadOnMount: false,
  });

  // Reserved for future wiring (kept to preserve current behavior of dead code).
  const _handleValidationErrors = useCallback((errors: CoachValidationError[]) => {
    setValidationErrors(errors);
    setTimeout(() => setValidationErrors([]), 5000);
  }, []);
  void _handleValidationErrors;

  const logCurrentConversation = useCallback(async () => {
    if (msgs.length < 2) return;
    const { topic, summary } = summarizeConversation(msgs);
    if (topic && summary) {
      await logConversation(topic, summary);
      console.log('[RideshareCoach] Conversation logged to memory');
    }
  }, [msgs, logConversation, summarizeConversation]);

  useEffect(() => {
    if (!isStreaming && msgs.length >= 2) {
      const timer = setTimeout(() => {
        logCurrentConversation();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, msgs.length, logCurrentConversation]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const send = useCallback(async (text: string, attachmentsOverride?: CoachAttachment[]) => {
    const messageText = text;
    const filesToSend = attachmentsOverride ?? attachments;
    if (!messageText && filesToSend.length === 0) return;
    if (isStreaming) return;

    if (!attachmentsOverride) setAttachments([]);
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
          threadHistory: msgs,
          snapshotId,
          strategyId,
          attachments: filesToSend,
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
      let fullResponse = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });

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
              onStreamDelta?.(msg.delta);
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
            if (msg.actions_result) {
              if (msg.actions_result.saved > 0) {
                onNotesSaved?.();
              }
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
        const lastNl = acc.lastIndexOf("\n");
        if (lastNl >= 0) acc = acc.slice(lastNl + 1);
      }

      if (fullResponse) {
        onStreamComplete?.(fullResponse);
      }
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name !== 'AbortError') {
        setMsgs((m) => [...m.slice(0, -1), { role: "assistant", content: `Connection error: ${error.message}` }]);
      }
    } finally {
      setIsStreaming(false);
    }
  }, [
    attachments,
    isStreaming,
    msgs,
    userId,
    snapshotId,
    strategyId,
    snapshot,
    strategyReady,
    setMsgs,
    scrollToBottom,
    onNotesSaved,
    onStreamComplete,
    onStreamDelta,
  ]);

  return {
    messages: msgs,
    setMessages: setMsgs,
    isMessagesLoaded: _isChatLoaded,
    isStreaming,
    send,
    abort,
    validationErrors,
    attachments,
    setAttachments,
    fileInputRef,
    handleFileSelect,
    messagesEndRef,
  };
}
