/**
 * useMemory - Client-side hook for interacting with the memory API
 *
 * Provides functions to:
 * - Store/retrieve user preferences
 * - Log conversations
 * - Get full context including memory
 */

import { useState, useEffect, useCallback } from 'react';

interface MemoryContext {
  recentSnapshots: any[];
  recentStrategies: any[];
  recentActions: any[];
  agentPreferences: Record<string, any>;
  sessionHistory: Record<string, any>;
  projectState: Record<string, any>;
  conversationHistory: any[];
  capabilities: Record<string, boolean>;
}

interface UseMemoryOptions {
  userId?: string;
  loadOnMount?: boolean;
}

export function useMemory(options: UseMemoryOptions = {}) {
  const { userId = 'system', loadOnMount = false } = options;

  const [context, setContext] = useState<MemoryContext | null>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load full context from memory
  // 2026-01-06: Removed graceful error handling - errors should surface, not be silenced
  const loadContext = useCallback(async (threadId?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (threadId) params.set('threadId', threadId);

      const res = await fetch(`/agent/context?${params}`);

      // Let errors surface with clear messages - don't silently fail
      if (res.status === 503) {
        throw new Error('Agent is disabled on server (AGENT_ENABLED !== true)');
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Agent auth required (${res.status})`);
      }
      if (!res.ok) {
        throw new Error(`Agent context fetch failed: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      if (data.ok) {
        setContext(data.context);
      }
      return data.context;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('[useMemory] loadContext failed:', message);
      throw err;  // Re-throw so callers know something went wrong
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load conversation history
  const loadConversations = useCallback(async (limit = 30) => {
    try {
      const res = await fetch(`/agent/memory/conversations?userId=${userId}&limit=${limit}`);
      if (!res.ok) throw new Error('Failed to load conversations');

      const data = await res.json();
      if (data.ok) {
        setConversations(data.conversations || []);
      }
      return data.conversations;
    } catch (err) {
      console.error('[useMemory] loadConversations failed:', err);
      return [];
    }
  }, [userId]);

  // Store a conversation
  const logConversation = useCallback(async (topic: string, summary: string) => {
    try {
      const res = await fetch('/agent/memory/conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, summary, userId })
      });

      if (!res.ok) throw new Error('Failed to log conversation');

      const data = await res.json();
      return data.ok;
    } catch (err) {
      console.error('[useMemory] logConversation failed:', err);
      return false;
    }
  }, [userId]);

  // Store a user preference
  const setPreference = useCallback(async (key: string, value: any) => {
    try {
      const res = await fetch('/agent/memory/preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, userId })
      });

      if (!res.ok) throw new Error('Failed to save preference');

      const data = await res.json();
      return data.ok;
    } catch (err) {
      console.error('[useMemory] setPreference failed:', err);
      return false;
    }
  }, [userId]);

  // Store session state
  const setSessionState = useCallback(async (key: string, data: any) => {
    try {
      const res = await fetch('/agent/memory/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, data, userId })
      });

      if (!res.ok) throw new Error('Failed to save session state');

      const result = await res.json();
      return result.ok;
    } catch (err) {
      console.error('[useMemory] setSessionState failed:', err);
      return false;
    }
  }, [userId]);

  // Store project state
  const setProjectState = useCallback(async (key: string, data: any) => {
    try {
      const res = await fetch('/agent/memory/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, data, userId })
      });

      if (!res.ok) throw new Error('Failed to save project state');

      const result = await res.json();
      return result.ok;
    } catch (err) {
      console.error('[useMemory] setProjectState failed:', err);
      return false;
    }
  }, [userId]);

  // Summarize a conversation (extracts key points)
  const summarizeConversation = useCallback((messages: Array<{ role: string; content: string }>): { topic: string; summary: string } => {
    if (messages.length === 0) return { topic: '', summary: '' };

    // Get first user message as topic
    const firstUserMsg = messages.find(m => m.role === 'user');
    const topic = firstUserMsg?.content.slice(0, 100) || 'General conversation';

    // Get last assistant response as summary
    const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
    const summary = lastAssistantMsg?.content.slice(0, 200) || '';

    return { topic, summary };
  }, []);

  // Load on mount if requested
  useEffect(() => {
    if (loadOnMount) {
      loadContext();
      loadConversations();
    }
  }, [loadOnMount, loadContext, loadConversations]);

  return {
    // State
    context,
    conversations,
    isLoading,
    error,

    // Actions
    loadContext,
    loadConversations,
    logConversation,
    setPreference,
    setSessionState,
    setProjectState,
    summarizeConversation,
  };
}

export default useMemory;
