import { renderHook, act } from '@testing-library/react';
import { useChatPersistence, ChatMessage } from '../client/src/hooks/useChatPersistence';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    }
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

describe('useChatPersistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('should initialize with empty messages if no storage exists', () => {
    const { result } = renderHook(() => useChatPersistence('user1', 'snap1'));
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoaded).toBe(true);
  });

  it('should save messages to localStorage', () => {
    const { result } = renderHook(() => useChatPersistence('user1', 'snap1'));
    
    const newMessages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' }
    ];

    act(() => {
      result.current.setMessages(newMessages);
    });

    expect(result.current.messages).toEqual(newMessages);
    
    const stored = window.localStorage.getItem('vecto_coach_chat_user1_snap1');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.messages).toEqual(newMessages);
    expect(parsed.userId).toBe('user1');
    expect(parsed.snapshotId).toBe('snap1');
  });

  it('should support functional state updates', () => {
    const { result } = renderHook(() => useChatPersistence('user1', 'snap1'));
    
    // Initial message
    act(() => {
      result.current.setMessages([{ role: 'user', content: 'Initial' }]);
    });

    // Functional update
    act(() => {
      result.current.setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Response' }
      ]);
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].content).toBe('Initial');
    expect(result.current.messages[1].content).toBe('Response');

    // Verify storage
    const stored = window.localStorage.getItem('vecto_coach_chat_user1_snap1');
    const parsed = JSON.parse(stored!);
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[1].content).toBe('Response');
  });

  it('should load existing messages from localStorage', () => {
    const existingMessages: ChatMessage[] = [
      { role: 'user', content: 'Previous message' }
    ];
    
    window.localStorage.setItem('vecto_coach_chat_user1_snap1', JSON.stringify({
      userId: 'user1',
      snapshotId: 'snap1',
      messages: existingMessages,
      lastUpdated: Date.now()
    }));

    const { result } = renderHook(() => useChatPersistence('user1', 'snap1'));
    
    expect(result.current.messages).toEqual(existingMessages);
  });

  it('should separate storage by snapshotId', () => {
    const { result: result1 } = renderHook(() => useChatPersistence('user1', 'snap1'));
    const { result: result2 } = renderHook(() => useChatPersistence('user1', 'snap2'));

    act(() => {
        result1.current.setMessages([{ role: 'user', content: 'Snap1 msg' }]);
    });

    expect(result1.current.messages).toHaveLength(1);
    expect(result2.current.messages).toHaveLength(0); // Should remain empty
  });

  it('should clear messages', () => {
    const { result } = renderHook(() => useChatPersistence('user1', 'snap1'));
    
    act(() => {
      result.current.setMessages([{ role: 'user', content: 'Hello' }]);
    });

    expect(window.localStorage.getItem('vecto_coach_chat_user1_snap1')).toBeTruthy();

    act(() => {
      result.current.clearMessages();
    });

    expect(result.current.messages).toEqual([]);
    expect(window.localStorage.getItem('vecto_coach_chat_user1_snap1')).toBeNull();
  });
});
