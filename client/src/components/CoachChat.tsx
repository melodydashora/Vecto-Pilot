import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { MessageSquare, Send, Mic, Phone, Square } from "lucide-react";

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
      console.log('[voice] Token received, model:', model, 'context:', context);

      // Initialize WebSocket connection to OpenAI Realtime API with dynamic model
      const wsUrl = `wss://api.openai.com/v1/realtime?model=${model}`;
      const ws = new WebSocket(wsUrl);
      realtimeRef.current = ws;

      ws.onopen = () => {
        console.log('[voice] WebSocket connected');
        
        // Send session setup with authorization
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            model: model,
            instructions: `You are an AI companion for rideshare drivers. You have access to current context:
Location: ${context.city || 'unknown'}
Weather: ${context.weather?.conditions || 'unknown'}
Time: ${context.dayPart || 'unknown'} (${context.hour}:00)
Current Strategy: ${context.strategy?.substring(0, 200) || 'none'}

Keep responses concise (under 100 words). Be friendly and supportive. Help drivers with strategy, venue recommendations, or just conversation. Never suggest illegal activities.`,
            voice: 'alloy',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1' },
          },
        }));

        // Add authorization header (done via token in URL, but send confirmation)
        ws.send(JSON.stringify({
          type: 'session.user.auth',
          token: token,
        }));

        // Start audio capture
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

      ws.onclose = () => {
        console.log('[voice] Voice chat ended');
        setIsVoiceActive(false);
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
      const audioContext = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (event) => {
        const audioData = event.inputBuffer.getChannelData(0);
        
        // Convert Float32 to Int16 (PCM16)
        const pcm16Data = new Int16Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
          const s = Math.max(-1, Math.min(1, audioData[i]));
          pcm16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        
        // Send PCM16 audio to WebSocket as base64
        if (realtimeRef.current?.readyState === WebSocket.OPEN) {
          const base64Audio = btoa(String.fromCharCode.apply(null, Array.from(pcm16Data)));
          realtimeRef.current.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: base64Audio,
          }));
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      console.log('[voice] Audio capture started');
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
    <Card className="flex flex-col h-[500px] border-2">
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b bg-muted/50">
        <MessageSquare className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">AI Companion</h3>
        <span className="text-xs text-muted-foreground ml-auto">Always here to help</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {msgs.length === 0 && (
          <div className="text-center py-8 space-y-4">
            <p className="text-sm text-muted-foreground">
              Ask me about strategy, venues, or just chat. I'm here for you! 💬
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {suggestedQuestions.map((q, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="text-xs"
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
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            data-testid={`message-${m.role}-${i}`}
          >
            <div
              className={`inline-block rounded-2xl px-4 py-2 max-w-[80%] ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{m.content}</p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Voice Transcript Display */}
      {voiceTranscript && (
        <div className="px-3 py-2 bg-blue-50 border-t text-sm text-blue-900 max-h-12 overflow-auto">
          🎤 {voiceTranscript}
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t flex gap-2">
        <Input
          className="flex-1"
          placeholder={isVoiceActive ? "Listening... speak now" : "Ask about strategy, pings, or where to stage…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !isStreaming && !isVoiceActive && send()}
          disabled={isStreaming || isVoiceActive}
          data-testid="input-chat-message"
        />
        
        {/* Voice Button */}
        <Button
          onClick={isVoiceActive ? stopVoiceChat : startVoiceChat}
          size="icon"
          variant={isVoiceActive ? "destructive" : "outline"}
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
          data-testid="button-send-message"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
