import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { MessageSquare, Send, Loader, Zap, Paperclip, X } from "lucide-react";
import { useMemory } from "@/hooks/useMemory";

interface Message {
  role: "user" | "assistant";
  content: string;
  attachments?: Array<{ name: string; type: string; data: string; }>;
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

interface CoachChatProps {
  userId: string;
  snapshotId?: string;
  strategyId?: string;
  strategy?: string;
  snapshot?: SnapshotData;
  blocks?: any[];
  strategyReady?: boolean; // Indicates if strategy is still generating or complete
}

export default function CoachChat({
  userId,
  snapshotId,
  strategyId,
  strategy,
  snapshot,
  blocks = [],
  strategyReady = false
}: CoachChatProps) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [_isVoiceActive, setIsVoiceActive] = useState(false);
  const [_voiceTranscript, setVoiceTranscript] = useState("");
  const [attachments, setAttachments] = useState<Array<{ name: string; type: string; data: string; }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const realtimeRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const _audioContextRef = useRef<AudioContext | null>(null);

  // Memory integration for persistent context
  const { logConversation, summarizeConversation, context } = useMemory({
    userId,
    loadOnMount: true
  });

  // Handle event deactivation commands from AI Coach
  const handleEventDeactivation = useCallback(async (content: string) => {
    const deactivatePattern = /\[DEACTIVATE_EVENT:\s*({[^}]+})\]/g;
    const matches = content.matchAll(deactivatePattern);

    for (const match of matches) {
      try {
        const data = JSON.parse(match[1]);
        const { event_title, reason, notes } = data;

        if (!event_title || !reason) {
          console.warn('[CoachChat] Invalid deactivation command:', data);
          continue;
        }

        console.log('[CoachChat] Processing event deactivation:', event_title, reason);

        // First, find the event by title (search in discovered events)
        const token = localStorage.getItem('vecto_auth_token');
        const searchRes = await fetch(`/api/briefing/discovered-events/${snapshotId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!searchRes.ok) {
          console.error('[CoachChat] Failed to search for events');
          continue;
        }

        const searchData = await searchRes.json();
        const eventToDeactivate = searchData.events?.find(
          (e: any) => e.title.toLowerCase().includes(event_title.toLowerCase())
        );

        if (!eventToDeactivate) {
          console.warn('[CoachChat] Event not found:', event_title);
          continue;
        }

        // Deactivate the event
        const deactivateRes = await fetch(`/api/briefing/event/${eventToDeactivate.id}/deactivate`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ reason, notes })
        });

        if (deactivateRes.ok) {
          const result = await deactivateRes.json();
          console.log('[CoachChat] ✅ Event deactivated:', result.title);
        } else {
          console.error('[CoachChat] Failed to deactivate event:', await deactivateRes.text());
        }
      } catch (err) {
        console.error('[CoachChat] Error processing deactivation:', err);
      }
    }
  }, [snapshotId]);

  // Log conversation when it ends (after assistant response completes)
  const logCurrentConversation = useCallback(async () => {
    if (msgs.length < 2) return; // Need at least one exchange

    const { topic, summary } = summarizeConversation(msgs);
    if (topic && summary) {
      await logConversation(topic, summary);
      console.log('[CoachChat] Conversation logged to memory');
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

  // Initialize voice chat with OpenAI Realtime API
  async function _startVoiceChat() {
    try {
      setIsVoiceActive(true);
      console.log('[voice] Starting voice chat session...');

      // Get ephemeral token from backend
      const res = await fetch('/api/realtime/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ snapshotId, userId, strategyId }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to get token');
      }

      const { token, model, context } = await res.json();
      console.log('[voice] Token received, model:', model, 'token:', token?.substring(0, 20) + '...');

      if (!token) {
        throw new Error('No token returned from server');
      }

      // Initialize WebSocket connection to OpenAI Realtime API
      // Token must be passed as query parameter for auth
      const wsUrl = `wss://api.openai.com/v1/realtime?model=${model}&token=${token}`;
      console.log('[voice] Connecting to realtime API...');
      const ws = new WebSocket(wsUrl);
      realtimeRef.current = ws;

      ws.onopen = () => {
        console.log('[voice] WebSocket connected - sending session config');
        
        // Send session setup with driver context
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: `You are an AI companion for rideshare drivers in ${context.city || 'unknown'}, TX. 
Weather: ${context.weather?.conditions || 'clear'} (${context.weather?.tempF || 70}°F)
Time: ${context.dayPart || 'day'} (${context.hour || 12}:00)
Strategy: ${context.strategy?.substring(0, 150) || 'Generate advice for earning opportunities'}

Keep responses under 100 words. Be conversational, friendly, and supportive. Focus on safety and maximizing earnings.`,
            voice: 'alloy',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1' },
          },
        }));

        // Start audio capture AFTER session is configured
        startAudioCapture();
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleRealtimeMessage(msg);
      };

      ws.onerror = (err) => {
        console.error('[voice] WebSocket error:', err);
        setIsVoiceActive(false);
      };

      ws.onclose = (event) => {
        console.log('[voice] Voice chat ended, code:', event.code, 'reason:', event.reason);
        setIsVoiceActive(false);
      };
      
      ws.onerror = (event) => {
        console.error('[voice] WebSocket error:', event);
      };
    } catch (err) {
      console.error('[voice] Start failed:', err);
      setIsVoiceActive(false);
      alert('Failed to start voice chat: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  }

  function stopVoiceChat() {
    if (realtimeRef.current) {
      // Clean up MediaRecorder if attached
      const mediaRecorder = (realtimeRef.current as any).mediaRecorder;
      const audioStream = (realtimeRef.current as any).audioStream;
      
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        console.log('[voice] MediaRecorder stopped');
      }
      
      if (audioStream) {
        audioStream.getTracks().forEach((track: MediaStreamTrack) => {
          track.stop();
          console.log('[voice] Audio track stopped');
        });
      }
      
      // Close WebSocket
      realtimeRef.current.close();
      realtimeRef.current = null;
    }
    setIsVoiceActive(false);
    setVoiceTranscript("");
  }

  async function startAudioCapture() {
    try {
      console.log('[voice] Starting audio capture...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true } 
      });
      console.log('[voice] ✅ Microphone access granted');
      
      // Use MediaRecorder for reliable audio capture (avoids deprecated ScriptProcessor)
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      
      mediaRecorder.ondataavailable = async (event) => {
        if (!realtimeRef.current || realtimeRef.current.readyState !== WebSocket.OPEN) {
          console.log('[voice] WebSocket not ready, skipping audio chunk');
          return;
        }
        
        if (event.data.size === 0) return;
        
        // Read as ArrayBuffer for raw audio data
        const arrayBuffer = await event.data.arrayBuffer();
        // Convert to base64 for transmission
        const bytes = new Uint8Array(arrayBuffer);
        const base64Audio = btoa(String.fromCharCode.apply(null, Array.from(bytes)));
        
        try {
          realtimeRef.current.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: base64Audio,
          }));
          console.log('[voice] 📡 Audio chunk sent (', bytes.length, 'bytes)');
        } catch (err) {
          console.error('[voice] Failed to send audio:', err);
        }
      };
      
      mediaRecorder.onerror = (err) => {
        console.error('[voice] MediaRecorder error:', err);
        stopVoiceChat();
      };
      
      // Start recording with 100ms chunks for streaming
      mediaRecorder.start(100);
      console.log('[voice] ✅ MediaRecorder started, sending audio in 100ms chunks');
      
      // Store reference to stop recording later
      (realtimeRef.current as any).mediaRecorder = mediaRecorder;
      (realtimeRef.current as any).audioStream = stream;
    } catch (err) {
      console.error('[voice] Audio capture failed:', err);
      setIsVoiceActive(false);
      alert('Microphone access denied: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  }

  function handleRealtimeMessage(msg: any) {
    if (msg.type === 'response.audio_transcript.delta') {
      // AI is speaking - show in transcript
      setVoiceTranscript(prev => prev + (msg.delta || ''));
    } else if (msg.type === 'conversation.item.created') {
      // Message created
      if (msg.item?.role === 'assistant') {
        setMsgs(prev => [...prev, { role: 'assistant', content: msg.item.content?.[0]?.transcript || '' }]);
      }
    } else if (msg.type === 'input_audio_buffer.speech_started') {
      // User started speaking
      console.log('[voice] User speech detected');
    } else if (msg.type === 'input_audio_buffer.speech_stopped') {
      // User stopped speaking
      console.log('[voice] User speech ended');
    }
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

  async function send() {
    if (!input.trim() && attachments.length === 0 || isStreaming) return;
    
    const my = input.trim();
    setInput("");
    const filesToSend = attachments;
    setAttachments([]);
    setMsgs((m) => [...m, { role: "user", content: my || "(uploaded files)", attachments: filesToSend }, { role: "assistant", content: "" }]);
    setIsStreaming(true);

    controllerRef.current?.abort();
    controllerRef.current = new AbortController();

    try {
      const token = localStorage.getItem('vecto_auth_token');
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { 
          "content-type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ 
          userId, 
          message: my || "(analyzing files)",
          threadHistory: msgs,  // Send full conversation history for context awareness
          snapshotId,
          strategyId,  // Entry point: Strategy ID from UI → Full schema access
          strategy,
          blocks,  // Send full blocks array with all fields (events, earnings, tips, etc.)
          attachments: filesToSend,  // Include uploaded files for analysis
          // Snapshot context: weather, AQI, city, daypart, etc. (enables early engagement)
          snapshot: snapshot ? {
            city: snapshot.city,
            state: snapshot.state,
            formatted_address: snapshot.formatted_address,
            timezone: snapshot.timezone,
            hour: snapshot.hour,
            day_part_key: snapshot.day_part_key,
            dow: snapshot.dow,
            weather: snapshot.weather,
            air: snapshot.air,
            holiday: snapshot.holiday,
            is_holiday: snapshot.is_holiday,
            coordinates: snapshot.lat && snapshot.lng ? { lat: snapshot.lat, lng: snapshot.lng } : undefined
          } : undefined,
          strategyReady // Helps Coach know if strategy is still generating
        }),
        signal: controllerRef.current.signal,
      });

      if (!res.ok && res.headers.get("content-type")?.includes("text/event-stream") === false) {
        const t = await res.text();
        setMsgs((m) => [...m.slice(0, -1), { role: "assistant", content: `Sorry—chat failed: ${t}` }]);
        setIsStreaming(false);
        return;
      }

      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let acc = "";

      // eslint-disable-next-line no-constant-condition
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
          } catch (_err) {
            // Ignore parse errors for partial SSE data
          }
        }
        // keep only last partial line in buffer
        const lastNl = acc.lastIndexOf("\n");
        if (lastNl >= 0) acc = acc.slice(lastNl + 1);
      }
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name !== 'AbortError') {
        setMsgs((m) => [...m.slice(0, -1), { role: "assistant", content: `Connection error: ${error.message}` }]);
      }
    } finally {
      setIsStreaming(false);

      // Check for event deactivation commands in the last assistant message
      setMsgs((currentMsgs) => {
        const lastMsg = currentMsgs[currentMsgs.length - 1];
        if (lastMsg?.role === 'assistant' && lastMsg.content.includes('[DEACTIVATE_EVENT:')) {
          handleEventDeactivation(lastMsg.content);
        }
        return currentMsgs;
      });
    }
  }

  const suggestedQuestions = [
    "Where should I go right now?",
    "What's happening in my area?",
    "Let's just chat",
  ];

  return (
    <Card className="flex flex-col h-[500px] border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 overflow-hidden shadow-lg rounded-xl">
      {/* Clean Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-white/20">
          <Zap className="h-4 w-4" />
        </div>
        <div>
          <h3 className="font-semibold text-sm">Rideshare Coach</h3>
          <p className="text-xs text-white/80">AI Strategy Assistant</p>
        </div>
      </div>

      {/* Messages Area - Light background for readability */}
      <div className="flex-1 overflow-auto p-4 space-y-4 bg-gray-50 dark:bg-slate-800">
        {msgs.length === 0 && (
          <div className="text-center py-8 space-y-4">
            <div className="inline-flex items-center justify-center h-14 w-14 bg-blue-100 dark:bg-blue-900 rounded-full">
              <MessageSquare className="h-7 w-7 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white text-base mb-2">Hey! I'm Your AI Companion</h4>
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
            <div
              className={`inline-block rounded-2xl px-4 py-2.5 max-w-[75%] shadow-sm ${
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

      {/* Input Area */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 flex gap-2">
        <Input
          className="flex-1 rounded-full border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          placeholder="Ask anything - rideshare tips, life advice, or just chat..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !isStreaming && send()}
          disabled={isStreaming}
          data-testid="input-chat-message"
        />
        
        {/* File Input (Hidden) */}
        <input
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
          disabled={isStreaming}
          data-testid="button-upload-file"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        
        {/* Send Button */}
        <Button
          onClick={send}
          disabled={!input.trim() || isStreaming}
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
