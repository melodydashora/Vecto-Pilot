// client/src/hooks/useTTS.ts
// Text-to-speech hook using OpenAI natural voice with browser TTS fallback
//
// 2026-03-16: Created for Translation feature — OpenAI TTS-1-HD
// 2026-04-13: Added browser speechSynthesis fallback for iOS/mobile where
//   audio.play() fails when called seconds after the user gesture (Coach streaming).
//   Translation still uses OpenAI TTS (fast path, ~500ms from gesture).

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
 * Speak using browser's native speechSynthesis API (free, no network, iOS-compatible).
 * Returns true if successfully started, false if not available.
 */
function speakWithBrowserTTS(text: string, language?: string): boolean {
  if (!window.speechSynthesis) return false;

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language === 'en' ? 'en-US' : language || 'en-US';
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  window.speechSynthesis.speak(utterance);
  return true;
}

/**
 * Hook for text-to-speech functionality using OpenAI TTS with browser fallback
 * @returns Object with speaking state and control functions
 */
export function useTTS(): UseTTSReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  const stop = useCallback(() => {
    // Stop OpenAI TTS audio element
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    // Stop browser TTS if active
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  // 2026-04-13: Unlock audio for later programmatic playback.
  // Must be called from a user gesture (click/tap).
  const warmUp = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch { /* best-effort */ }

    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const a = audioRef.current;
    a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
    a.volume = 1;
    a.play().then(() => { a.pause(); console.log('[TTS] Audio unlocked'); }).catch(() => {});
  }, []);

  // 2026-03-16: Added optional language parameter for multilingual translation TTS
  // 2026-03-28: Changed to interrupt-and-replace
  // 2026-04-13: Falls back to browser speechSynthesis if Audio element playback fails (iOS)
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
      console.log(`[TTS] Received ${audioBlob.size} bytes`);
      const audioUrl = URL.createObjectURL(audioBlob);

      if (!audioRef.current) {
        audioRef.current = new Audio();
      }

      const audio = audioRef.current;
      audio.src = audioUrl;
      audio.volume = 1;

      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        // 2026-04-13: Audio element failed (iOS autoplay restriction) — fall back to browser TTS
        console.log('[TTS] Audio element failed, falling back to browser speechSynthesis');
        if (speakWithBrowserTTS(text, language)) {
          // Track when browser TTS finishes
          const checkInterval = setInterval(() => {
            if (!window.speechSynthesis.speaking) {
              clearInterval(checkInterval);
              setIsSpeaking(false);
            }
          }, 200);
        } else {
          setIsSpeaking(false);
          toast({
            title: 'Voice Unavailable',
            description: 'Unable to play audio on this device.',
            variant: 'destructive',
          });
        }
      };

      await audio.play();
      console.log('[TTS] Playing audio via OpenAI TTS');
    } catch (err) {
      // 2026-04-13: Network/API error — try browser TTS as fallback
      console.warn('[TTS] OpenAI TTS failed, trying browser fallback:', err);
      if (speakWithBrowserTTS(text, language)) {
        console.log('[TTS] Playing audio via browser speechSynthesis (fallback)');
        const checkInterval = setInterval(() => {
          if (!window.speechSynthesis.speaking) {
            clearInterval(checkInterval);
            setIsSpeaking(false);
          }
        }, 200);
      } else {
        setIsSpeaking(false);
        toast({
          title: 'Text-to-Speech Failed',
          description: err instanceof Error ? err.message : 'Unable to read aloud.',
          variant: 'destructive',
        });
      }
    }
  }, [isSpeaking, stop, toast]);

  return { isSpeaking, speak, stop, warmUp };
}
