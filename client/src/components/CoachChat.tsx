import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { MessageSquare, Send } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface CoachChatProps {
  userId: string;
  snapshotId?: string;
  strategy?: string;
  blocks?: any[];
}

export default function CoachChat({ userId, snapshotId, strategy, blocks = [] }: CoachChatProps) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
          snapshotId,
          strategy,
          blocks: blocks.map(b => ({ name: b.name, category: b.category, address: b.address }))
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

      {/* Input */}
      <div className="p-3 border-t flex gap-2">
        <Input
          className="flex-1"
          placeholder="Ask about strategy, pings, or where to stage…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !isStreaming && send()}
          disabled={isStreaming}
          data-testid="input-chat-message"
        />
        <Button
          onClick={send}
          disabled={!input.trim() || isStreaming}
          size="icon"
          data-testid="button-send-message"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
