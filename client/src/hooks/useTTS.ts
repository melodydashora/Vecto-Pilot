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
  /** Call from a user gesture (click/tap) to unlock audio for later programmatic playback. */
  warmUp: () => void;
}

/**
 * Hook for text-to-speech functionality using OpenAI TTS
 * @returns Object with speaking state and control functions
 */
export function useTTS(): UseTTSReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 2026-04-13: AudioContext unlocks programmatic audio playback after user gesture
  const audioCtxRef = useRef<AudioContext | null>(null);
  const { toast } = useToast();

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsSpeaking(false);
  }, []);

  // 2026-04-13: Unlock audio for later programmatic playback.
  // Must be called from a user gesture (click/tap). Creates and resumes an
  // AudioContext which stays unlocked for the page session, and also plays
  // a tiny silent buffer through a fresh Audio element to satisfy browsers
  // that gate HTMLAudioElement.play() separately from AudioContext.
  const warmUp = useCallback(() => {
    // Resume or create AudioContext (works in Chrome, Firefox, Safari)
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
    } catch {
      // AudioContext not available — continue without it
    }

    // Also touch the Audio element from gesture context
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    // Play + immediately pause to mark element as user-activated
    const a = audioRef.current;
    a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
    a.volume = 1;
    a.play().then(() => { a.pause(); console.log('[TTS] Audio unlocked'); }).catch(() => {});
  }, []);

  // 2026-03-16: Added optional language parameter for multilingual translation TTS
  // 2026-03-28: Changed to interrupt-and-replace — previous audio is stopped, new audio plays.
  // 2026-04-13: Uses fresh Audio element per call to avoid state pollution from warmUp.
  const speak = useCallback(async (text: string, language?: string) => {
    if (!text) return;

    if (isSpeaking) {
      stop();
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
      console.log(`[TTS] Received ${audioBlob.size} bytes, type: ${audioBlob.type}`);
      const audioUrl = URL.createObjectURL(audioBlob);

      // 2026-04-13: Create fresh element each call — avoids stale state from warmUp
      const audio = new Audio(audioUrl);
      audio.volume = 1;

      // Store ref so stop() can reach it
      if (audioRef.current) {
        audioRef.current.pause();
      }
      audioRef.current = audio;

      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = (e) => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        console.error('[TTS] Audio playback error:', e);
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

  return { isSpeaking, speak, stop, warmUp };
}
