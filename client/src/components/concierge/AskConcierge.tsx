// client/src/components/concierge/AskConcierge.tsx
// 2026-02-13: AI Concierge Assistant — public AI Q&A for passengers on the concierge page
// 2026-04-02: Redesigned as full-height chat-first experience. Dark theme, modern messaging UI.
// Uses CONCIERGE_CHAT model role (Gemini 3 Pro with Google Search)
// Rate limited: 3 questions per minute on server, 5 per session on client

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Send, MessageSquare } from 'lucide-react';
import { API_ROUTES } from '@/constants/apiRoutes';
import { getLocalHour } from '@/lib/daypart';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AskConciergeProps {
  token: string;
  lat: number;
  lng: number;
  /** GPS-resolved IANA timezone (coords → Google Timezone API). Null while
   *  resolving — time-aware features are omitted rather than guessed. */
  timezone: string | null;
  venueContext?: string;
  eventContext?: string;
}

const MAX_QUESTIONS_PER_SESSION = 5;

// 2026-04-18: Replaced the static SUGGESTED_QUESTIONS array with a daypart-aware
// builder per the Coach inbox request (2026-04-09 "Dynamic Time-Aware Concierge
// Prompts"). Uses the driver's GPS-resolved timezone (passed via props) to
// compute local hour and serve morning / afternoon / evening / late-night prompts.
// NOTE: these 4 buckets are a UI prompt-suggestion scheme, deliberately distinct
// from the canonical 6-part daypart taxonomy in shared/dayparts.js.
// 2026-07-06: hour now comes from the shared adapter (the old inline
// `hour12: false` extraction returned "24" at midnight on Chromium < 124 and
// then silently defaulted to 'afternoon'). If the timezone is missing/invalid
// we OMIT the suggestion chips instead of guessing a daypart — no fallbacks.
function getSuggestedQuestions(timezone: string | null): string[] {
  if (!timezone) return []; // still resolving GPS timezone — omit, don't guess
  let hour: number;
  try {
    hour = getLocalHour(new Date(), timezone);
  } catch (err) {
    console.error('[AskConcierge] Cannot derive local hour — hiding suggested prompts:', err);
    return [];
  }
  if (hour >= 5 && hour < 11) {
    return ['Coffee nearby?', 'Quick breakfast spots', "What's open now?", 'Morning commute tips'];
  }
  if (hour >= 11 && hour < 17) {
    return ['Lunch spots nearby', 'Things to do here', "What's nearby?", 'Sightseeing ideas'];
  }
  if (hour >= 17 && hour < 22) {
    return ['Dinner spots nearby', 'Events happening now', 'Best places to eat', 'Nightlife options'];
  }
  return ['Late-night food', "What's open now?", 'Safe spots nearby', 'Events happening now'];
}

export function AskConcierge({ token, lat, lng, timezone, venueContext, eventContext }: AskConciergeProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [questionCount, setQuestionCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); requestRef.current = null; }, [token, lat, lng, timezone]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 2026-04-02: Streaming implementation — tokens appear in real time via SSE
  const sendQuestion = async (question: string) => {
    if (!question.trim() || requestRef.current || !timezone) return;
    if (questionCount >= MAX_QUESTIONS_PER_SESSION) {
      setError('Question limit reached. Refresh the page to ask more.');
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    const current = () => requestRef.current === controller && !controller.signal.aborted;
    const deadline = window.setTimeout(() => controller.abort(), 90000);
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
        credentials: 'omit',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question.trim(),
          lat,
          lng,
          // Omit timezone entirely while unresolved — never send a guess
          ...(timezone ? { timezone } : {}),
          venueContext: venueContext || '',
          eventContext: eventContext || '',
        }),
      });

      if (!current()) return;
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
      let finished = false;
      const consume = (line: string) => {
        if (finished || !line.startsWith('data:')) return;
        const json = line.slice(5).trim();
        if (!json) return;
        const data = JSON.parse(json);
        if (data.error) throw new Error(String(data.error));
        if (data.done) { finished = true; return; }
        if (typeof data.delta === 'string' && data.delta) setMessages(prev => {
          const updated = [...prev];
          updated[assistantIdx] = { role: 'assistant', content: (updated[assistantIdx]?.content || '') + data.delta };
          return updated;
        });
      };
      try {
        while (!finished) {
          const { done, value } = await reader.read();
          if (!current()) return;
          if (done) {
            buffer += decoder.decode();
            if (buffer.trim()) consume(buffer);
            if (!finished) throw new Error('The answer ended before it was complete.');
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n'); buffer = lines.pop() || '';
          for (const line of lines) consume(line);
        }
      } finally { await reader.cancel(); }

    } catch (caught) {
      if (requestRef.current !== controller) return;
      setError(controller.signal.aborted ? 'The answer timed out. Please try again.' : caught instanceof Error ? caught.message : 'The answer could not be completed.');
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
      window.clearTimeout(deadline);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsLoading(false);
        inputRef.current?.focus();
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendQuestion(input);
  };

  const remainingQuestions = MAX_QUESTIONS_PER_SESSION - questionCount;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div role="log" aria-live="polite" className="flex-1 overflow-auto p-4 space-y-2.5 bg-gray-50 dark:bg-slate-800">
        {messages.length === 0 && (
          <div className="text-center py-8 space-y-4">
            <div className="inline-flex items-center justify-center h-14 w-14 bg-blue-100 dark:bg-blue-900 rounded-full"><MessageSquare className="h-7 w-7 text-blue-600 dark:text-blue-400" /></div>
            <h2 className="font-semibold text-gray-900 dark:text-white text-base">Hello! I'm Your Concierge</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">Ask about nearby places, directions, or local events. I can search the web too.</p>
            <div className="flex flex-wrap gap-2 justify-center pt-3">{getSuggestedQuestions(timezone).map(q => <Button key={q} variant="outline" size="sm" className="text-xs bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600" onClick={() => sendQuestion(q)} disabled={isLoading || !timezone}>{q}</Button>)}</div>
          </div>
        )}
        {messages.map((message, index) => <p key={index} className="break-words whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200"><span className="font-semibold">{message.role === 'user' ? 'You' : 'Concierge'}: </span>{message.content || (isLoading ? 'Thinking...' : '')}</p>)}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900">
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300 mb-2">{error}</p>}
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input ref={inputRef} aria-label="Ask the concierge" type="text" value={input} onChange={e => setInput(e.target.value)} placeholder="Ask about the area..." disabled={isLoading || !timezone || remainingQuestions <= 0} className="flex-1 min-w-0 rounded-lg border border-gray-300 dark:border-gray-600 p-3 text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white" maxLength={500} />
          <Button type="submit" size="icon" aria-label="Send question" disabled={!input.trim() || isLoading || !timezone || remainingQuestions <= 0}>{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
        </form>
        {questionCount > 0 && <p className="mt-2 text-xs text-gray-500">{remainingQuestions} questions remaining this visit.</p>}
      </div>
    </div>
  );
}
