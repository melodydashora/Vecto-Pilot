// client/src/components/concierge/AskConcierge.tsx
// 2026-02-13: AI Concierge Assistant — public AI Q&A for passengers on the concierge page
// 2026-04-02: Redesigned as full-height chat-first experience. Dark theme, modern messaging UI.
// Uses CONCIERGE_CHAT model role (Gemini 3 Pro with Google Search)
// Rate limited: 3 questions per minute on server, 5 per session on client

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, Send, MessageSquare } from 'lucide-react';
import { API_ROUTES } from '@/constants/apiRoutes';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AskConciergeProps {
  token: string;
  lat: number;
  lng: number;
  timezone: string;
  venueContext?: string;
  eventContext?: string;
}

const MAX_QUESTIONS_PER_SESSION = 5;

const SUGGESTED_QUESTIONS = [
  "What's nearby?",
  'Best places to eat',
  'Events happening now',
  'Things to do here',
];

export function AskConcierge({ token, lat, lng, timezone, venueContext, eventContext }: AskConciergeProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [questionCount, setQuestionCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 2026-04-02: Streaming implementation — tokens appear in real time via SSE
  const sendQuestion = async (question: string) => {
    if (!question.trim() || isLoading) return;
    if (questionCount >= MAX_QUESTIONS_PER_SESSION) {
      setError('Question limit reached. Refresh the page to ask more.');
      return;
    }

    const userMessage: ChatMessage = { role: 'user', content: question.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);
    setQuestionCount(prev => prev + 1);

    // Add empty assistant message that will be filled by streaming chunks
    const assistantIdx = messages.length + 1; // +1 for the user message we just added
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const response = await fetch(API_ROUTES.CONCIERGE.PUBLIC_ASK_STREAM(token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question.trim(),
          lat,
          lng,
          timezone,
          venueContext: venueContext || '',
          eventContext: eventContext || '',
        }),
      });

      if (!response.ok || !response.body) {
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIdx] = { role: 'assistant', content: 'Sorry, I couldn\'t connect to the AI. Try again.' };
          return updated;
        });
        setIsLoading(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);

            if (data.done) break;

            if (data.error) {
              setMessages(prev => {
                const updated = [...prev];
                updated[assistantIdx] = { role: 'assistant', content: data.error };
                return updated;
              });
              break;
            }

            if (data.delta) {
              setMessages(prev => {
                const updated = [...prev];
                updated[assistantIdx] = {
                  role: 'assistant',
                  content: (updated[assistantIdx]?.content || '') + data.delta,
                };
                return updated;
              });
            }
          } catch {
            // Skip unparseable chunks
          }
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        if (updated[assistantIdx]) {
          updated[assistantIdx] = {
            role: 'assistant',
            content: updated[assistantIdx].content || 'Connection error. Please check your internet and try again.',
          };
        }
        return updated;
      });
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendQuestion(input);
  };

  const remainingQuestions = MAX_QUESTIONS_PER_SESSION - questionCount;

  return (
    <div className="flex flex-col flex-1">
      {/* ═══ CHAT AREA ═══ */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Empty state — welcome + suggested questions */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center min-h-[300px] py-8">
            {/* Welcome icon — large circle matching AI Coach style */}
            <div className="inline-flex items-center justify-center h-16 w-16 bg-purple-500/15 rounded-full mb-5">
              <MessageSquare className="h-8 w-8 text-purple-400" />
            </div>

            <h2 className="text-xl font-bold text-white mb-2">
              How can I help?
            </h2>
            <p className="text-sm text-slate-400 mb-8 text-center max-w-xs leading-relaxed">
              Ask me about restaurants, events, safety, directions — anything about the area.
            </p>

            {/* Suggested questions — wrapped centered grid */}
            <div className="flex flex-wrap justify-center gap-2 max-w-sm">
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendQuestion(q)}
                  disabled={isLoading}
                  className="text-xs px-4 py-2.5 bg-slate-800/60 text-slate-300 rounded-full border border-slate-700 hover:bg-slate-700 hover:text-white hover:border-slate-500 transition-all disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages */}
        {messages.length > 0 && (
          <div className="space-y-4">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="h-6 w-6 rounded-full bg-indigo-500/20 flex items-center justify-center mr-2 mt-1 flex-shrink-0">
                    <Sparkles className="h-3 w-3 text-indigo-400" />
                  </div>
                )}
                {/* 2026-04-09: Added break-words to prevent long URLs/paths from overflowing chat bubbles */}
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed break-words ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-md'
                      : 'bg-slate-800 text-slate-200 rounded-bl-md border border-slate-700'
                  }`}
                >
                  {/* 2026-04-02: Render newlines in assistant responses as line breaks */}
                  {msg.role === 'assistant' ? (
                    msg.content.split('\n').map((line, i) => (
                      <span key={i}>
                        {line}
                        {i < msg.content.split('\n').length - 1 && <br />}
                      </span>
                    ))
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

            {/* Loading indicator — only shows before first streaming token arrives */}
            {isLoading && (!messages.length || !messages[messages.length - 1]?.content) && (
              <div className="flex justify-start">
                <div className="h-6 w-6 rounded-full bg-indigo-500/20 flex items-center justify-center mr-2 mt-1 flex-shrink-0">
                  <Sparkles className="h-3 w-3 text-indigo-400" />
                </div>
                <div className="bg-slate-800 border border-slate-700 rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="h-1.5 w-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="h-1.5 w-1.5 bg-indigo-400 rounded-full animate-bounce" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ═══ INPUT BAR (pinned to bottom, matches AI Coach styling) ═══ */}
      <div className="p-3 border-t border-slate-800 bg-slate-900">
        {/* Error message */}
        {error && (
          <p className="text-xs text-red-400 text-center mb-2">{error}</p>
        )}

        <form onSubmit={handleSubmit} className="flex items-center gap-2 max-w-lg mx-auto w-full">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={remainingQuestions > 0 ? 'Ask anything about the area...' : 'Question limit reached'}
            disabled={isLoading || remainingQuestions <= 0}
            className="flex-1 min-w-0 text-sm px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-full text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
            maxLength={500}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isLoading || remainingQuestions <= 0}
            className="rounded-full h-10 w-10 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 transition-colors"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>

        {/* Remaining questions counter */}
        {questionCount > 0 && remainingQuestions > 0 && (
          <p className="text-center text-[10px] text-slate-600 mt-1.5">
            {remainingQuestions} question{remainingQuestions !== 1 ? 's' : ''} remaining
          </p>
        )}
      </div>
    </div>
  );
}
