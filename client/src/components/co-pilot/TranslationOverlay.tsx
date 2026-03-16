// client/src/components/co-pilot/TranslationOverlay.tsx
// Split-screen "Rearview" translation UI for driver-rider communication
//
// 2026-03-16: Created for FIFA World Cup rider translation feature.
//
// Layout:
//   TOP HALF:    Rider-facing — rotated 180° for backseat readability, large font
//   BOTTOM HALF: Driver-facing — English text, mic button, quick phrases, language selector
//
// Features:
//   - Web Speech API for on-device STT (free, zero API cost)
//   - Gemini 3 Flash translation (~100-200ms)
//   - OpenAI TTS playback through car speakers
//   - Wake Lock to prevent screen sleep
//   - Quick phrase buttons for zero-speech interaction

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useTTS } from '@/hooks/useTTS';
import { API_ROUTES } from '@/constants/apiRoutes';
import QuickPhrases, { type QuickPhrase } from './QuickPhrases';

// Language options for the selector (FIFA World Cup priority languages)
const LANGUAGES = [
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'pl', name: 'Polish', flag: '🇵🇱' },
  { code: 'uk', name: 'Ukrainian', flag: '🇺🇦' },
  { code: 'sv', name: 'Swedish', flag: '🇸🇪' },
  { code: 'sq', name: 'Albanian', flag: '🇦🇱' },
  { code: 'pt', name: 'Portuguese', flag: '🇵🇹' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
  { code: 'zh', name: 'Mandarin', flag: '🇨🇳' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'ru', name: 'Russian', flag: '🇷🇺' },
];

interface TranslationMessage {
  id: string;
  originalText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  speaker: 'driver' | 'rider';
  timestamp: number;
}

/**
 * Request a Wake Lock to prevent the screen from sleeping during translation sessions.
 * Falls back gracefully if the API is not supported.
 */
async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  try {
    if ('wakeLock' in navigator) {
      const sentinel = await navigator.wakeLock.request('screen');
      console.log('[TranslationOverlay] Wake Lock acquired');
      return sentinel;
    }
  } catch (err) {
    console.warn('[TranslationOverlay] Wake Lock failed:', err);
  }
  return null;
}

export default function TranslationOverlay() {
  // State
  const [riderLang, setRiderLang] = useState('es'); // Default: Spanish (most common in DFW)
  const [messages, setMessages] = useState<TranslationMessage[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [activeMode, setActiveMode] = useState<'idle' | 'driver-speaking' | 'rider-speaking'>('idle');
  const [showQuickPhrases, setShowQuickPhrases] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(false);

  // Hooks
  const speech = useSpeechRecognition();
  const tts = useTTS();
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const riderPanelRef = useRef<HTMLDivElement>(null);
  const driverPanelRef = useRef<HTMLDivElement>(null);

  // Acquire Wake Lock on mount, release on unmount
  useEffect(() => {
    requestWakeLock().then(sentinel => {
      wakeLockRef.current = sentinel;
    });
    return () => {
      wakeLockRef.current?.release();
    };
  }, []);

  // Auto-scroll both panels when new messages arrive
  useEffect(() => {
    riderPanelRef.current?.scrollTo({ top: riderPanelRef.current.scrollHeight, behavior: 'smooth' });
    driverPanelRef.current?.scrollTo({ top: driverPanelRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  /**
   * Translate text via the server API
   */
  const translateText = useCallback(async (
    text: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<{ translatedText: string; detectedLang: string } | null> => {
    try {
      setIsTranslating(true);
      const response = await fetch(API_ROUTES.TRANSLATE.SEND, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sourceLang, targetLang }),
      });

      if (!response.ok) {
        throw new Error(`Translation failed: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        translatedText: data.translatedText,
        detectedLang: data.detectedLang,
      };
    } catch (err) {
      console.error('[TranslationOverlay] Translation error:', err);
      return null;
    } finally {
      setIsTranslating(false);
    }
  }, []);

  /**
   * Add a message to the conversation and auto-play TTS
   */
  const addMessage = useCallback(async (
    originalText: string,
    translatedText: string,
    sourceLang: string,
    targetLang: string,
    speaker: 'driver' | 'rider',
  ) => {
    const msg: TranslationMessage = {
      id: crypto.randomUUID(),
      originalText,
      translatedText,
      sourceLang,
      targetLang,
      speaker,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, msg]);

    // Auto-TTS: speak the translation aloud for the other party
    // Driver speaks English → TTS plays rider's language for rider (they read the text instead)
    // Rider speaks their language → TTS plays English for driver (hands-free)
    if (speaker === 'rider') {
      // Rider spoke → play English translation for driver via car speakers
      await tts.speak(translatedText, 'en');
    }
    // When driver speaks, rider reads the translated text on screen (no TTS needed — they see it)
  }, [tts]);

  /**
   * Handle driver mic button — listen in English, translate to rider's language
   */
  const handleDriverMic = useCallback(() => {
    if (speech.isListening) {
      speech.stop();
      // Translate whatever was captured
      if (speech.finalTranscript.trim()) {
        setActiveMode('idle');
        translateText(speech.finalTranscript, 'en', riderLang).then(result => {
          if (result) {
            addMessage(speech.finalTranscript, result.translatedText, 'en', riderLang, 'driver');
            speech.clear();
          }
        });
      }
    } else {
      setActiveMode('driver-speaking');
      speech.clear();
      speech.start('en');
    }
  }, [speech, riderLang, translateText, addMessage]);

  /**
   * Handle rider mic button — listen in rider's language, translate to English
   */
  const handleRiderMic = useCallback(() => {
    if (speech.isListening) {
      speech.stop();
      if (speech.finalTranscript.trim()) {
        setActiveMode('idle');
        translateText(speech.finalTranscript, riderLang, 'en').then(result => {
          if (result) {
            addMessage(speech.finalTranscript, result.translatedText, riderLang, 'en', 'rider');
            speech.clear();
          }
        });
      }
    } else {
      setActiveMode('rider-speaking');
      speech.clear();
      speech.start(riderLang);
    }
  }, [speech, riderLang, translateText, addMessage]);

  /**
   * Handle quick phrase selection — instant translation + display
   */
  const handleQuickPhrase = useCallback(async (phrase: QuickPhrase) => {
    setShowQuickPhrases(false);
    const result = await translateText(phrase.en, 'en', riderLang);
    if (result) {
      await addMessage(phrase.en, result.translatedText, 'en', riderLang, 'driver');
    }
  }, [riderLang, translateText, addMessage]);

  const selectedLang = LANGUAGES.find(l => l.code === riderLang);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] bg-background overflow-hidden">
      {/* ================================================================ */}
      {/* RIDER PANEL (TOP) — Rotated 180° for backseat readability       */}
      {/* ================================================================ */}
      <div
        className="flex-1 bg-slate-900 border-b-4 border-blue-500 overflow-hidden"
        style={{ transform: 'rotate(180deg)' }}
      >
        <div ref={riderPanelRef} className="h-full overflow-y-auto p-4 flex flex-col justify-end">
          {messages.length === 0 ? (
            <div className="text-center text-slate-500 text-2xl font-light">
              {selectedLang?.flag} Translation Ready
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`rounded-xl px-4 py-3 max-w-[90%] ${
                    msg.speaker === 'driver'
                      ? 'bg-blue-600/90 text-white ml-auto text-right'
                      : 'bg-slate-700 text-white mr-auto'
                  }`}
                >
                  <div className="text-2xl sm:text-3xl md:text-4xl font-medium leading-relaxed">
                    {msg.speaker === 'driver' ? msg.translatedText : msg.originalText}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Rider mic button (also rotated, so it appears right-side-up from backseat) */}
          {activeMode !== 'driver-speaking' && (
            <Button
              onClick={handleRiderMic}
              className={`mt-3 mx-auto w-16 h-16 rounded-full text-2xl ${
                activeMode === 'rider-speaking'
                  ? 'bg-red-500 hover:bg-red-600 animate-pulse'
                  : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              {activeMode === 'rider-speaking' ? '⬛' : '🎤'}
            </Button>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* DIVIDER — Visual separator with language indicator               */}
      {/* ================================================================ */}
      <div className="bg-blue-500 px-4 py-1 flex items-center justify-between text-white text-sm font-medium shrink-0">
        <span>EN ↔ {selectedLang?.flag} {selectedLang?.name}</span>
        {isTranslating && <span className="animate-pulse">Translating...</span>}
        {speech.isListening && (
          <span className="animate-pulse text-red-200">
            Listening{speech.interimTranscript ? `: "${speech.interimTranscript.substring(0, 30)}"` : '...'}
          </span>
        )}
      </div>

      {/* ================================================================ */}
      {/* DRIVER PANEL (BOTTOM) — English text + controls                  */}
      {/* ================================================================ */}
      <div className="flex-1 bg-background overflow-hidden flex flex-col">
        {/* Messages */}
        <div ref={driverPanelRef} className="flex-1 overflow-y-auto p-3">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-2">
              <div className="text-4xl">🌐</div>
              <div className="text-lg font-medium">Rider Translation</div>
              <div className="text-sm text-center max-w-xs">
                Tap the mic to speak, or use Quick Phrases below.
                Rider sees translated text on the top half of the screen.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`rounded-lg px-3 py-2 max-w-[85%] ${
                    msg.speaker === 'driver'
                      ? 'bg-primary/10 ml-auto text-right'
                      : 'bg-muted mr-auto'
                  }`}
                >
                  <div className="text-base font-medium">
                    {msg.speaker === 'driver' ? msg.originalText : msg.translatedText}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {msg.speaker === 'driver' ? 'You' : 'Rider'} • {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Controls bar */}
        <Card className="shrink-0 border-t rounded-none p-3 space-y-2">
          {/* Quick Phrases panel (expandable) */}
          {showQuickPhrases && (
            <div className="max-h-48 overflow-y-auto pb-2 border-b mb-2">
              <QuickPhrases
                onSelect={handleQuickPhrase}
                isTranslating={isTranslating}
              />
            </div>
          )}

          {/* Language picker (expandable) */}
          {showLangPicker && (
            <div className="max-h-48 overflow-y-auto pb-2 border-b mb-2">
              <div className="grid grid-cols-3 gap-1.5">
                {LANGUAGES.map(lang => (
                  <Button
                    key={lang.code}
                    variant={lang.code === riderLang ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs h-auto py-1.5"
                    onClick={() => {
                      setRiderLang(lang.code);
                      setShowLangPicker(false);
                    }}
                  >
                    {lang.flag} {lang.name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {/* Driver Mic */}
            <Button
              onClick={handleDriverMic}
              className={`flex-1 h-12 text-base font-medium ${
                activeMode === 'driver-speaking'
                  ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
                  : ''
              }`}
              variant={activeMode === 'driver-speaking' ? 'default' : 'default'}
            >
              {activeMode === 'driver-speaking' ? '⬛ Stop' : '🎤 Speak English'}
            </Button>

            {/* Quick Phrases toggle */}
            <Button
              variant="outline"
              className="h-12 px-3"
              onClick={() => {
                setShowQuickPhrases(!showQuickPhrases);
                setShowLangPicker(false);
              }}
            >
              💬
            </Button>

            {/* Language picker toggle */}
            <Button
              variant="outline"
              className="h-12 px-3"
              onClick={() => {
                setShowLangPicker(!showLangPicker);
                setShowQuickPhrases(false);
              }}
            >
              {selectedLang?.flag || '🌐'}
            </Button>
          </div>

          {/* Speech recognition not supported warning */}
          {!speech.isSupported && (
            <div className="text-xs text-destructive text-center">
              Speech recognition not supported in this browser. Use Quick Phrases instead.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
