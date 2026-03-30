// client/src/hooks/useSpeechRecognition.ts
// Browser-native speech recognition hook using Web Speech API
//
// 2026-03-16: Created for FIFA World Cup rider translation feature.
// Uses on-device speech recognition (free, zero API cost, low latency).
// Supported in Chrome 33+, Safari 14.1+, Edge 79+.

import { useState, useRef, useCallback, useEffect } from 'react';

// Web Speech API types (not in standard TypeScript lib)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface UseSpeechRecognitionReturn {
  /** Whether the browser supports the Web Speech API */
  isSupported: boolean;
  /** Whether the recognizer is actively listening */
  isListening: boolean;
  /** The current transcript (final + interim) */
  transcript: string;
  /** Only the final (committed) transcript */
  finalTranscript: string;
  /** The interim (in-progress) transcript */
  interimTranscript: string;
  /** Last error message, if any */
  error: string | null;
  /** Start listening in the given language (BCP 47 code, e.g. "es-ES") */
  start: (lang?: string) => void;
  /** Stop listening */
  stop: () => void;
  /** Clear the transcript */
  clear: () => void;
}

/**
 * Get the SpeechRecognition constructor (vendor-prefixed in some browsers)
 */
function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * Map ISO 639-1 language codes to BCP 47 locale codes for better recognition accuracy.
 * The Web Speech API works better with full locale codes (e.g., "es-ES" vs "es").
 */
const LANG_TO_BCP47: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  pl: 'pl-PL',
  uk: 'uk-UA',
  sv: 'sv-SE',
  sq: 'sq-AL',
  pt: 'pt-BR',
  fr: 'fr-FR',
  de: 'de-DE',
  ja: 'ja-JP',
  ko: 'ko-KR',
  ar: 'ar-SA',
  hi: 'hi-IN',
  zh: 'zh-CN',
  it: 'it-IT',
  ru: 'ru-RU',
  tr: 'tr-TR',
  vi: 'vi-VN',
  th: 'th-TH',
  tl: 'fil-PH',
};

/**
 * Hook for browser-native speech recognition using the Web Speech API.
 * Provides real-time speech-to-text with interim results for conversational UI.
 *
 * @returns Speech recognition state and control functions
 */
export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  // 2026-03-18: FIX (F-2) — Ref tracks finalTranscript to avoid stale closure in onresult
  const finalTranscriptRef = useRef('');

  const SpeechRecognition = getSpeechRecognition();
  const isSupported = SpeechRecognition !== null;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  const start = useCallback((lang: string = 'en') => {
    if (!SpeechRecognition) {
      setError('Speech recognition not supported in this browser');
      return;
    }

    // Stop any existing session
    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }

    setError(null);
    setInterimTranscript('');

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = LANG_TO_BCP47[lang] || lang;

    recognition.onstart = () => {
      setIsListening(true);
      console.log(`[SpeechRecognition] Started listening (${recognition.lang})`);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      // 2026-03-18: FIX (F-2) — Use ref to avoid stale closure for finalTranscript
      if (final) {
        const updated = finalTranscriptRef.current + (finalTranscriptRef.current ? ' ' : '') + final;
        finalTranscriptRef.current = updated;
        setFinalTranscript(updated);
        setTranscript(updated);
        setInterimTranscript('');
      } else {
        setInterimTranscript(interim);
        const base = finalTranscriptRef.current;
        setTranscript(base + (base ? ' ' : '') + interim);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // 'no-speech' and 'aborted' are normal operational states, not errors
      if (event.error === 'no-speech' || event.error === 'aborted') {
        console.log(`[SpeechRecognition] ${event.error} (normal)`);
        return;
      }
      console.error(`[SpeechRecognition] Error: ${event.error}`);
      setError(event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      console.log('[SpeechRecognition] Stopped');
    };

    recognitionRef.current = recognition;
    recognition.start();
  // 2026-03-18: Removed finalTranscript from deps — ref handles it now
  }, [SpeechRecognition]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
  }, []);

  const clear = useCallback(() => {
    setTranscript('');
    setFinalTranscript('');
    setInterimTranscript('');
    setError(null);
    finalTranscriptRef.current = '';
  }, []);

  return {
    isSupported,
    isListening,
    transcript,
    finalTranscript,
    interimTranscript,
    error,
    start,
    stop,
    clear,
  };
}
