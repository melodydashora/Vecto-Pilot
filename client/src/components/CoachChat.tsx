import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { MessageSquare, Send, Mic, Square, Loader, Zap } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
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
  local_news?: any;
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
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const realtimeRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Initialize voice chat with OpenAI Realtime API
  async function startVoiceChat() {
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
      realtimeRef.current.close();
      realtimeRef.current = null;
    }
    setIsVoiceActive(false);
    setVoiceTranscript("");
  }

  async function startAudioCapture() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ 
        sampleRate: 24000 
      });
      audioContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      
      processor.onaudioprocess = (event) => {
        if (!realtimeRef.current || realtimeRef.current.readyState !== WebSocket.OPEN) {
          return;
        }
        
        const audioData = event.inputBuffer.getChannelData(0);
        
        // Convert Float32 to Int16 (PCM16)
        const pcm16Data = new Int16Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
          const s = Math.max(-1, Math.min(1, audioData[i]));
          pcm16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        
        // Send PCM16 audio as base64
        const base64Audio = btoa(String.fromCharCode.apply(null, Array.from(pcm16Data)));
        realtimeRef.current.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64Audio,
        }));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      console.log('[voice] Audio capture started on stream');
    } catch (err) {
      console.error('[voice] Audio capture failed:', err);
      stopVoiceChat();
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
  };

  async function send() {
    if (!input.trim() || isStreaming) return;
    
    const my = input.trim();
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: my }, { role: "assistant", content: "" }]);
    setIsStreaming(true);

    controllerRef.current?.abort();
    controllerRef.current = new AbortController();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ 
          userId, 
          message: my,
          threadHistory: msgs,  // Send full conversation history for context awareness
          snapshotId,
          strategyId,  // Entry point: Strategy ID from UI → Full schema access
          strategy,
          blocks,  // Send full blocks array with all fields (events, earnings, tips, etc.)
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
            local_news: snapshot.local_news,
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
          } catch (err) {
            // Ignore parse errors for partial SSE data
          }
        }
        // keep only last partial line in buffer
        const lastNl = acc.lastIndexOf("\n");
        if (lastNl >= 0) acc = acc.slice(lastNl + 1);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMsgs((m) => [...m.slice(0, -1), { role: "assistant", content: `Connection error: ${err.message}` }]);
      }
    } finally {
      setIsStreaming(false);
    }
  }

  const suggestedQuestions = [
    "Where should I stage right now?",
    "How's my strategy looking?",
    "Just want to chat - how are you?",
  ];

  return (
    <Card className="flex flex-col h-[500px] border-2 bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-950 dark:to-blue-950 overflow-hidden shadow-lg">
      {/* Premium Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-700 dark:to-indigo-700 text-white shadow-sm">
        <div className="flex items-center justify-center h-9 w-9 rounded-full bg-white/20 backdrop-blur">
          <Zap className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-bold text-sm">Rideshare Coach</h3>
          <p className="text-xs text-blue-100">AI Strategy & Earnings Companion</p>
        </div>
        {isVoiceActive && (
          <div className="ml-auto flex items-center gap-1">
            <span className="text-xs bg-white/20 px-2 py-1 rounded-full animate-pulse">🎤 Listening</span>
          </div>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-auto p-4 space-y-4 scroll-smooth">
        {msgs.length === 0 && (
          <div className="text-center py-10 space-y-5">
            <div className="inline-block p-3 bg-blue-100 dark:bg-blue-900 rounded-full">
              <MessageSquare className="h-8 w-8 text-blue-600 dark:text-blue-300" />
            </div>
            <div>
              <h4 className="font-semibold text-foreground mb-1">Welcome to Your Rideshare Coach!</h4>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                Get instant advice on venues, strategy, earnings tips, or just chat. Tap any suggestion below to get started!
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center pt-2">
              {suggestedQuestions.map((q, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="text-xs hover:bg-blue-50 dark:hover:bg-blue-900 border-blue-200 dark:border-blue-800"
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
              <div className="flex-shrink-0 h-7 w-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <span className="text-xs text-white">⚡</span>
              </div>
            )}
            <div
              className={`inline-block rounded-2xl px-4 py-3 max-w-xs shadow-sm ${
                m.role === "user"
                  ? "bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-br-none"
                  : "bg-white dark:bg-slate-800 text-foreground border border-blue-100 dark:border-blue-900 rounded-bl-none"
              }`}
            >
              <p className={`text-sm leading-relaxed ${m.role === "assistant" ? "whitespace-pre-wrap" : ""}`}>
                {m.content || (m.role === "assistant" && isStreaming && i === msgs.length - 1 ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader className="h-4 w-4 animate-spin" />
                    Thinking...
                  </span>
                ) : "")}
              </p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Voice Transcript Display */}
      {voiceTranscript && (
        <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 border-t border-blue-200 dark:border-blue-800 text-sm text-blue-900 dark:text-blue-100 max-h-14 overflow-auto flex items-center gap-2">
          <span className="animate-pulse">🎤</span>
          <span className="font-medium">You said:</span>
          <span className="italic">{voiceTranscript}</span>
        </div>
      )}

      {/* Input Area */}
      <div className="p-3 border-t bg-white dark:bg-slate-900 flex gap-2">
        <div className="flex-1 relative">
          <Input
            className="flex-1 rounded-full border-2 border-blue-200 dark:border-blue-800 focus:border-blue-600 dark:focus:border-blue-500 bg-slate-50 dark:bg-slate-800 transition-colors"
            placeholder={isVoiceActive ? "🎤 Listening... speak now" : "Ask about strategy, venues, or earnings…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !isStreaming && !isVoiceActive && send()}
            disabled={isStreaming || isVoiceActive}
            data-testid="input-chat-message"
          />
        </div>
        
        {/* Voice Button */}
        <Button
          onClick={isVoiceActive ? stopVoiceChat : startVoiceChat}
          size="icon"
          className={`rounded-full transition-all ${
            isVoiceActive 
              ? "bg-red-500 hover:bg-red-600 animate-pulse" 
              : "bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600"
          }`}
          title={isVoiceActive ? "Stop voice chat" : "Start voice chat"}
          data-testid="button-voice-chat"
        >
          {isVoiceActive ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>

        {/* Text Send Button */}
        <Button
          onClick={send}
          disabled={!input.trim() || isStreaming || isVoiceActive}
          size="icon"
          className="rounded-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 transition-all"
          data-testid="button-send-message"
        >
          {isStreaming ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </Card>
  );
}
