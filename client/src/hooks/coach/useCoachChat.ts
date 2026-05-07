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

const MAX_ATTACHMENTS = 10;
// 9 MB precheck — server limit is 10 MB at /api/chat (server/bootstrap/middleware.js:210),
// leaving ~1 MB headroom for message + threadHistory + snapshot + IDs.
const PAYLOAD_BUDGET_BYTES = 9 * 1024 * 1024;

const ACCEPTED_NON_IMAGE_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

function isAcceptedFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  if (ACCEPTED_NON_IMAGE_TYPES.has(file.type)) return true;
  return /\.(pdf|doc|docx|txt)$/i.test(file.name);
}

async function compressImageToDataUrl(file: File, maxDim = 2048, quality = 0.85): Promise<string> {
  if (!file.type.startsWith('image/')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Canvas 2D context unavailable');
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return canvas.toDataURL('image/jpeg', quality);
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
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  folderInputRef: React.RefObject<HTMLInputElement | null>;
  cameraInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Append a pre-encoded data URL as an attachment (used by CameraCaptureModal). */
  appendAttachmentFromDataUrl: (dataUrl: string, name?: string) => void;
  /** Filenames currently being compressed — chip UI shows a spinner for these. */
  compressingFiles: Set<string>;

  messagesEndRef: React.RefObject<HTMLDivElement | null>;
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
  const folderInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [compressingFiles, setCompressingFiles] = useState<Set<string>>(new Set());

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

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const filesList = e.currentTarget.files;
    if (!filesList) return;
    const inputEl = e.currentTarget;

    // Filter: only accepted types. Folder pickers return everything in the dir;
    // we drop unsupported files quietly with a count message.
    const accepted = Array.from(filesList).filter(isAcceptedFile);
    const droppedByType = filesList.length - accepted.length;

    // Cap: never exceed MAX_ATTACHMENTS in total.
    const remaining = MAX_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      setValidationErrors([{ field: 'attachments', message: `Max ${MAX_ATTACHMENTS} attachments` }]);
      setTimeout(() => setValidationErrors([]), 5000);
      if (inputEl) inputEl.value = '';
      return;
    }
    const toProcess = accepted.slice(0, remaining);
    const droppedByCap = accepted.length - toProcess.length;

    if (droppedByType > 0 || droppedByCap > 0) {
      const parts: string[] = [];
      if (droppedByType > 0) parts.push(`${droppedByType} unsupported`);
      if (droppedByCap > 0) parts.push(`${droppedByCap} over ${MAX_ATTACHMENTS}-file cap`);
      setValidationErrors([{ field: 'attachments', message: `Skipped: ${parts.join(', ')}` }]);
      setTimeout(() => setValidationErrors([]), 5000);
    }

    // Mark each file as "compressing" while we run it through the helper.
    setCompressingFiles(prev => {
      const next = new Set(prev);
      toProcess.forEach(f => next.add(f.name));
      return next;
    });

    // Compress in parallel; each promise individually appends + clears its compressing state.
    await Promise.all(
      toProcess.map(async (file) => {
        try {
          const data = await compressImageToDataUrl(file);
          setAttachments(prev => [...prev, {
            name: file.name,
            type: file.type.startsWith('image/') ? 'image/jpeg' : file.type,
            data,
          }]);
        } catch (err) {
          console.warn(`[Coach] Failed to encode attachment ${file.name}:`, err);
        } finally {
          setCompressingFiles(prev => {
            const next = new Set(prev);
            next.delete(file.name);
            return next;
          });
        }
      })
    );

    if (inputEl) inputEl.value = '';
  }, [attachments.length]);

  const appendAttachmentFromDataUrl = useCallback((dataUrl: string, name?: string) => {
    setAttachments(prev => {
      if (prev.length >= MAX_ATTACHMENTS) {
        setValidationErrors([{ field: 'attachments', message: `Max ${MAX_ATTACHMENTS} attachments` }]);
        setTimeout(() => setValidationErrors([]), 5000);
        return prev;
      }
      return [...prev, {
        name: name ?? `camera-${Date.now()}.jpg`,
        type: 'image/jpeg',
        data: dataUrl,
      }];
    });
  }, []);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const send = useCallback(async (text: string, attachmentsOverride?: CoachAttachment[]) => {
    const messageText = text;
    const filesToSend = attachmentsOverride ?? attachments;
    if (!messageText && filesToSend.length === 0) return;
    if (isStreaming) return;

    // Precheck: total attachment payload must fit under server's 10 MB limit
    // with headroom for message + thread history + snapshot + IDs.
    const totalAttachmentBytes = filesToSend.reduce((sum, a) => sum + a.data.length, 0);
    if (totalAttachmentBytes > PAYLOAD_BUDGET_BYTES) {
      setValidationErrors([{
        field: 'attachments',
        message: 'Attachments are too large. Try fewer files or a smaller photo.',
      }]);
      setTimeout(() => setValidationErrors([]), 5000);
      return;
    }

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
          } else if (errData.code === 'payload_too_large') {
            setMsgs((m) => [...m.slice(0, -1), {
              role: "assistant",
              content: "Attachments are too large for the coach. Try a smaller image, take a new photo at lower resolution, or attach fewer files."
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
            // 2026-05-05: Discriminate string-shaped error messages (legacy) from
            // boolean flags (H4 fallback envelope). Boolean true is a signal that
            // belongs in done payload metadata, not in the message bubble — overwriting
            // the bubble would nuke the delta-accumulated response that streamed first.
            if (typeof msg.error === 'string') {
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
    folderInputRef,
    cameraInputRef,
    handleFileSelect,
    appendAttachmentFromDataUrl,
    compressingFiles,
    messagesEndRef,
  };
}
