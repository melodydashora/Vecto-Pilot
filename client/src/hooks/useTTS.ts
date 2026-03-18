// client/src/hooks/useTTS.ts
// Text-to-speech hook using OpenAI natural voice

import { useState, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/useToast';
import { API_ROUTES } from '@/constants/apiRoutes';
import { STORAGE_KEYS } from '@/constants/storageKeys';

interface UseTTSReturn {
  isSpeaking: boolean;
  /** Speak text aloud. Optionally specify a language for multilingual TTS. */
  speak: (text: string, language?: string) => Promise<void>;
  stop: () => void;
}

/**
 * Hook for text-to-speech functionality using OpenAI TTS
 * @returns Object with speaking state and control functions
 */
export function useTTS(): UseTTSReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsSpeaking(false);
  }, []);

  // 2026-03-16: Added optional language parameter for multilingual translation TTS
  const speak = useCallback(async (text: string, language?: string) => {
    if (!text) return;

    if (isSpeaking) {
      stop();
      return;
    }

    try {
      setIsSpeaking(true);
      console.log(`[TTS] Requesting audio synthesis...${language ? ` (lang: ${language})` : ''}`);

      // 2026-03-18: FIX (B-2) — Add auth header for authenticated TTS endpoint
      const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      const response = await fetch(API_ROUTES.TTS, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ text, ...(language && { language }) })
      });

      if (!response.ok) {
        throw new Error(`TTS failed: ${response.statusText}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      if (!audioRef.current) {
        audioRef.current = new Audio();
      }

      const audio = audioRef.current;
      audio.src = audioUrl;

      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        toast({
          title: 'Playback Failed',
          description: 'Unable to play audio.',
          variant: 'destructive',
        });
      };

      await audio.play();
      console.log('[TTS] Playing audio');
    } catch (err) {
      setIsSpeaking(false);
      console.error('[TTS] Error:', err);
      toast({
        title: 'Text-to-Speech Failed',
        description: err instanceof Error ? err.message : 'Unable to read aloud.',
        variant: 'destructive',
      });
    }
  }, [isSpeaking, stop, toast]);

  return { isSpeaking, speak, stop };
}
