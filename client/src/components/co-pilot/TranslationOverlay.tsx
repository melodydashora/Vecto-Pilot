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
import { STORAGE_KEYS } from '@/constants/storageKeys';
import QuickPhrases, { type QuickPhrase } from './QuickPhrases';

// 2026-03-18: Rider intro text per language (U-1)
// Shown in top panel when no messages yet — tells rider what to do
const RIDER_INTRO: Record<string, string> = {
  es: 'Tu conductor usa un traductor. Toca 🎤 para hablar en español.',
  pl: 'Twój kierowca korzysta z tłumacza. Dotknij 🎤, aby mówić po polsku.',
  uk: 'Ваш водій використовує перекладач. Натисніть 🎤, щоб говорити українською.',
  sv: 'Din förare använder en översättare. Tryck på 🎤 för att prata på svenska.',
  sq: 'Shoferi juaj përdor një përkthyes. Prekni 🎤 për të folur shqip.',
  pt: 'Seu motorista está usando um tradutor. Toque em 🎤 para falar em português.',
  fr: 'Votre chauffeur utilise un traducteur. Appuyez sur 🎤 pour parler en français.',
  de: 'Ihr Fahrer verwendet einen Übersetzer. Tippen Sie auf 🎤, um Deutsch zu sprechen.',
  ja: '運転手は翻訳機を使っています。🎤をタップして日本語で話してください。',
  ko: '기사가 번역기를 사용하고 있습니다. 🎤을 눌러 한국어로 말하세요.',
  ar: 'يستخدم سائقك مترجمًا. اضغط على 🎤 للتحدث بالعربية.',
  hi: 'आपका ड्राइवर अनुवादक का उपयोग कर रहा है। हिंदी में बोलने के लिए 🎤 दबाएं।',
  zh: '您的司机正在使用翻译器。点击 🎤 用中文说话。',
  it: 'Il tuo autista sta usando un traduttore. Tocca 🎤 per parlare in italiano.',
  ru: 'Ваш водитель использует переводчик. Нажмите 🎤, чтобы говорить по-русски.',
};

// Language options for the selector (FIFA World Cup priority languages)
const LANGUAGES = [
  { code: 'auto', name: 'Auto-detect', flag: '🌐' },
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
  // 2026-03-18: Default to auto-detect — driver shouldn't have to guess rider's language
  const [riderLang, setRiderLang] = useState('auto');
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
      // 2026-03-18: FIX (B-1) — Server requires auth, was missing Bearer token
      const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      const response = await fetch(API_ROUTES.TRANSLATE.SEND, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ text, sourceLang, targetLang }),
      });

      if (!response.ok) {
        throw new Error(`Translation failed: ${response.statusText}`);
      }

      const data = await response.json();

      // 2026-03-18: Auto-detect — when riderLang is 'auto', lock to detected language
      // after first successful detection. No extra API call needed.
      if (riderLang === 'auto' && data.detectedLang && data.detectedLang !== 'en') {
        console.log(`[TranslationOverlay] Auto-detected rider language: ${data.detectedLang}`);
        setRiderLang(data.detectedLang);
      }

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
  }, [riderLang]);

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

    // 2026-03-18: Auto-TTS for BOTH directions
    // Rider spoke → play English translation for driver (hands-free, eyes on road)
    // Driver spoke/tapped phrase → play rider's language so rider hears it too
    if (speaker === 'rider') {
      await tts.speak(translatedText, 'en');
    } else {
      // Speak the translated text in rider's language
      await tts.speak(translatedText, targetLang);
    }
  }, [tts]);

  /**
   * Handle driver mic button — listen in English, translate to rider's language
   */
  // 2026-03-18: FIX (F-1) — Capture transcript and clear BEFORE translating.
  // Previously clear() happened after translateText resolved, but finalTranscript
  // kept accumulating across turns because onresult appends to prev.
  // Also: instead of auto-translating on stop, set pending text for confirmation (U-2).
  const [pendingText, setPendingText] = useState<{ text: string; speaker: 'driver' | 'rider' } | null>(null);

  // 2026-03-18: Driver mic — use activeMode to toggle (not speech.isListening which can
  // go false independently if recognizer times out from silence).
  // After stop(), wait 300ms for Web Speech API to commit final onresult.
  const handleDriverMic = useCallback(() => {
    if (activeMode === 'driver-speaking') {
      speech.stop();
      setActiveMode('idle'); // Immediately stop flashing
      setTimeout(() => {
        const text = (speech.finalTranscript + ' ' + speech.interimTranscript).trim();
        speech.clear();
        if (text) {
          setPendingText({ text, speaker: 'driver' });
        }
      }, 300);
    } else {
      setActiveMode('driver-speaking');
      setPendingText(null);
      speech.clear();
      speech.start('en');
    }
  }, [speech, activeMode]);

  /**
   * Handle rider mic button — listen in rider's language, translate to English
   */
  // 2026-03-18: Rider mic — reset to idle IMMEDIATELY on stop so button stops flashing.
  // Then wait 300ms for transcript, then translate.
  const handleRiderMic = useCallback(() => {
    if (activeMode === 'rider-speaking') {
      speech.stop();
      setActiveMode('idle'); // Immediately stop flashing
      setTimeout(() => {
        const text = (speech.finalTranscript + ' ' + speech.interimTranscript).trim();
        speech.clear();
        if (text) {
          const sourceLang = riderLang === 'auto' ? 'auto' : riderLang;
          // isTranslating state shows "Translating..." in the divider bar
          translateText(text, sourceLang, 'en').then(result => {
            if (result) {
              addMessage(text, result.translatedText, result.detectedLang || sourceLang, 'en', 'rider');
            }
          });
        }
      }, 300);
    } else {
      setActiveMode('rider-speaking');
      setPendingText(null);
      speech.clear();
      speech.start(riderLang === 'auto' ? 'en' : riderLang);
    }
  }, [speech, activeMode, riderLang, translateText, addMessage]);

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

  // Phase 5 (U-2): Confirm or cancel pending transcript
  const handleConfirmSend = useCallback(() => {
    if (!pendingText) return;
    const { text, speaker } = pendingText;
    setPendingText(null);

    if (speaker === 'driver') {
      // Driver→rider: translate English to rider's language (or auto-detect target)
      const target = riderLang === 'auto' ? 'es' : riderLang; // fallback to Spanish if not yet detected
      translateText(text, 'en', target).then(result => {
        if (result) addMessage(text, result.translatedText, 'en', target, 'driver');
      });
    } else {
      const source = riderLang === 'auto' ? 'auto' : riderLang;
      translateText(text, source, 'en').then(result => {
        if (result) addMessage(text, result.translatedText, result.detectedLang || source, 'en', 'rider');
      });
    }
  }, [pendingText, riderLang, translateText, addMessage]);

  const handleCancelSend = useCallback(() => {
    setPendingText(null);
  }, []);

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
            <div className="text-center space-y-3 px-4">
              <div className="text-5xl">{selectedLang?.flag}</div>
              <div className="text-2xl sm:text-3xl font-medium text-white leading-relaxed">
                {RIDER_INTRO[riderLang] || `Your driver is using a translator. Tap 🎤 to speak.`}
              </div>
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
        <span>EN ↔ {riderLang === 'auto' ? '🌐 Auto-detect' : `${selectedLang?.flag} ${selectedLang?.name}`}</span>
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

        {/* Transcript confirmation bar (U-2) — driver reviews before sending */}
        {pendingText && (
          <div className="shrink-0 border-t bg-yellow-50 dark:bg-yellow-900/30 px-3 py-2 flex items-center gap-2">
            <div className="flex-1 text-sm font-medium truncate">
              "{pendingText.text}"
            </div>
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white h-8 px-3" onClick={handleConfirmSend}>
              Send
            </Button>
            <Button size="sm" variant="outline" className="h-8 px-3" onClick={handleCancelSend}>
              Cancel
            </Button>
          </div>
        )}

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
