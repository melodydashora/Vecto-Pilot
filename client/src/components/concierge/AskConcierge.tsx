// client/src/components/concierge/AskConcierge.tsx
// 2026-02-13: AI Concierge Assistant — public AI Q&A for passengers on the concierge page
// Passengers can ask about local restaurants, events, directions, etc.
// Uses CONCIERGE_CHAT model role (Gemini 3 Pro with Google Search)
// Rate limited: 3 questions per minute on server, 5 per session on client

import { useState, useRef, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MessageCircle, Send, Loader2, Sparkles } from 'lucide-react';
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
  'What are the best restaurants nearby?',
  'Is this area safe to walk around at night?',
  'What else is happening tonight?',
  'Where can I find good coffee nearby?',
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

  const sendQuestion = async (question: string) => {
    if (!question.trim() || isLoading) return;
    if (questionCount >= MAX_QUESTIONS_PER_SESSION) {
      setError('You\'ve reached the question limit for this session. Refresh to ask more.');
      return;
    }

    const userMessage: ChatMessage = { role: 'user', content: question.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);
    setQuestionCount(prev => prev + 1);

    try {
      const response = await fetch(API_ROUTES.CONCIERGE.PUBLIC_ASK(token), {
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

      const data = await response.json();

      if (data.ok && data.answer) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.answer }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.error || 'Sorry, I couldn\'t find an answer. Try rephrasing your question.',
        }]);
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Connection error. Please check your internet and try again.',
      }]);
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
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-indigo-500" />
        <h3 className="text-sm font-semibold text-gray-700">AI Concierge Assistant</h3>
        {questionCount > 0 && (
          <span className="text-xs text-gray-400">({remainingQuestions} left)</span>
        )}
      </div>

      <Card className="bg-white border-gray-200 shadow-sm">
        <CardContent className="p-4 space-y-3">
          {/* Empty state — show suggested questions */}
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-indigo-400" />
                Ask anything about the area
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_QUESTIONS.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => sendQuestion(q)}
                    disabled={isLoading}
                    className="text-xs px-2.5 py-1.5 bg-indigo-50 text-indigo-700 rounded-full hover:bg-indigo-100 transition-colors disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chat messages */}
          {messages.length > 0 && (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {/* Loading indicator */}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3">
                    <div className="flex items-center gap-2 text-gray-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span className="text-xs">Thinking...</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Error message */}
          {error && (
            <p className="text-xs text-red-500 text-center">{error}</p>
          )}

          {/* Input form */}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={remainingQuestions > 0 ? 'Ask about nearby places...' : 'Question limit reached'}
              disabled={isLoading || remainingQuestions <= 0}
              className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-full bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed"
              maxLength={500}
            />
            <Button
              type="submit"
              size="sm"
              disabled={!input.trim() || isLoading || remainingQuestions <= 0}
              className="rounded-full h-9 w-9 p-0 bg-indigo-600 hover:bg-indigo-700"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
