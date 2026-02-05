import { useState, useEffect, useCallback } from 'react';

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: Array<{ name: string; type: string; data: string; }>;
  timestamp?: number;
}

interface StoredChat {
  userId: string;
  snapshotId?: string;
  messages: ChatMessage[];
  lastUpdated: number;
}

const STORAGE_KEY_PREFIX = 'vecto_coach_chat_';

export function useChatPersistence(userId: string, snapshotId?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Key depends on userId and snapshotId to segregate chats
  // If snapshotId changes, we switch to a new chat context or load existing one for that snapshot
  const storageKey = `${STORAGE_KEY_PREFIX}${userId}_${snapshotId || 'global'}`;

  // Load from local storage on mount or key change
  useEffect(() => {
    const loadFromStorage = () => {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const parsed: StoredChat = JSON.parse(stored);
          // Simple validation to ensure it matches current user context
          if (parsed.userId === userId && parsed.snapshotId === snapshotId) {
            setMessages(parsed.messages || []);
          } else {
              setMessages([]);
          }
        } else {
          setMessages([]);
        }
      } catch (e) {
        console.warn('Failed to load chat history', e);
        setMessages([]);
      } finally {
        setIsLoaded(true);
      }
    };

    loadFromStorage();

    // Listen for storage changes (sync across tabs)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storageKey) {
        loadFromStorage();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [storageKey, userId, snapshotId]);

  // Save to local storage whenever messages change
  // Supports both direct value and functional update pattern from useState
  const saveMessages = useCallback((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setMessages(prev => {
      const newMessages = typeof value === 'function' ? value(prev) : value;
      
      try {
        const data: StoredChat = {
          userId,
          snapshotId,
          messages: newMessages,
          lastUpdated: Date.now()
        };
        localStorage.setItem(storageKey, JSON.stringify(data));
      } catch (e) {
        console.warn('Failed to save chat history', e);
      }
      
      return newMessages;
    });
  }, [storageKey, userId, snapshotId]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  return {
    messages,
    setMessages: saveMessages, // Override setter to auto-save
    clearMessages,
    isLoaded
  };
}
