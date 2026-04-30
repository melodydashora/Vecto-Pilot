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
//   - OpenAI TTS playback through car speakers (interrupt-and-replace)
//   - Wake Lock to prevent screen sleep
//   - Quick phrase buttons for zero-speech interaction
//   - Mic permission preflight for instant first-tap response
//   - Browser locale STT hint for auto-detect mode (2026-03-28)

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useTTS } from '@/hooks/useTTS';
import { useToast } from '@/hooks/useToast';
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

// 2026-04-05: Removed 'auto' from language list (audit fix 1A).
// targetLang='auto' is undefined behavior — rider language must be explicitly selected.
// Auto-detect is valid for sourceLang (detecting what someone speaks) but NOT for targetLang.
// 2026-04-05: Added nativeName so riders can self-identify their language (Problem 4 fix)
const LANGUAGES = [
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', flag: '🇺🇦' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪' },
  { code: 'sq', name: 'Albanian', nativeName: 'Shqip', flag: '🇦🇱' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'zh', name: 'Mandarin', nativeName: '中文', flag: '🇨🇳' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
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
  // 2026-04-05: Default to '' (unset) — rider language MUST be explicitly selected (audit fix 1A).
  // 'auto' as targetLang is undefined behavior. Show language picker on first interaction.
  const [riderLang, setRiderLang] = useState('');
  const [messages, setMessages] = useState<TranslationMessage[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [activeMode, setActiveMode] = useState<'idle' | 'driver-speaking' | 'rider-speaking'>('idle');
  const [showQuickPhrases, setShowQuickPhrases] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(true); // 2026-04-05: Open picker on mount

  // Hooks
  const speech = useSpeechRecognition();
  const tts = useTTS();
  const { toast } = useToast();
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const riderPanelRef = useRef<HTMLDivElement>(null);
  const driverPanelRef = useRef<HTMLDivElement>(null);
  // 2026-03-28: Ref tracks latest transcript to avoid stale closures in setTimeout callbacks.
  // React state (speech.finalTranscript) can be stale inside timeouts due to batching.
  const latestTranscriptRef = useRef('');

  // 2026-03-28: Keep transcript ref in sync with speech state
  useEffect(() => {
    latestTranscriptRef.current = (speech.finalTranscript + ' ' + speech.interimTranscript).trim();
  }, [speech.finalTranscript, speech.interimTranscript]);

  // Acquire Wake Lock on mount, release on unmount
  // 2026-03-28: Also preflight mic permission so first tap doesn't prompt
  useEffect(() => {
    requestWakeLock().then(sentinel => {
      wakeLockRef.current = sentinel;
    });
    // Preflight: request mic permission early so first tap is instant
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          stream.getTracks().forEach(t => t.stop());
          console.log('[TranslationOverlay] Mic permission pre-granted');
        })
        .catch(() => {}); // Will prompt on first mic tap
    }
    return () => {
      wakeLockRef.current?.release();
    };
  }, []);

  // 2026-03-28: Reset activeMode on speech errors (permission denied, unsupported browser)
  useEffect(() => {
    if (speech.error && activeMode !== 'idle') {
      console.warn('[TranslationOverlay] Speech error, resetting to idle:', speech.error);
      setActiveMode('idle');
    }
  }, [speech.error, activeMode]);

  // 2026-03-18: Auto-reset activeMode when speech recognizer stops on its own
  // (e.g., silence timeout, end of speech detected by browser).
  // 2026-03-28: Fixed stale transcript bug — reads latestTranscriptRef INSIDE timeout
  // so final onresult events during the 300ms window are captured.
  // Also: driver path now auto-translates (no pendingText), matching rider path.
  useEffect(() => {
    if (!speech.isListening && (activeMode === 'driver-speaking' || activeMode === 'rider-speaking')) {
      const currentMode = activeMode;
      // Small delay to let any final onresult commit
      const timer = setTimeout(() => {
        // 2026-03-28: Read ref AFTER delay — captures final words that arrive during 300ms window
        const text = latestTranscriptRef.current;
        speech.clear();
        setActiveMode('idle');

        if (text && currentMode === 'driver-speaking') {
          // 2026-04-05: Rider language must be set (audit fix 1A)
          if (!riderLang) {
            toast({ title: 'Select rider language', description: 'Choose the rider\'s language before translating.', variant: 'destructive' });
            return;
          }
          translateText(text, 'en', riderLang).then(result => {
            if (result) {
              addMessage(text, result.translatedText, 'en', result.detectedLang || riderLang, 'driver');
            }
          });
        } else if (text && currentMode === 'rider-speaking') {
          // 2026-04-05: Use explicit riderLang as sourceLang hint (audit fix 1B)
          translateText(text, riderLang || 'auto', 'en').then(result => {
            if (result) {
              addMessage(text, result.translatedText, result.detectedLang || riderLang, 'en', 'rider');
            }
          });
        }
      }, 300);

      return () => clearTimeout(timer);
    }
  }, [speech.isListening]);

  // Auto-scroll both panels when new messages arrive
  useEffect(() => {
    riderPanelRef.current?.scrollTo({ top: riderPanelRef.current.scrollHeight, behavior: 'smooth' });
    driverPanelRef.current?.scrollTo({ top: driverPanelRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  /**
   * Translate text via the server API
   */
  // 2026-04-05: Added auth pre-check (audit fix 1D) and toast errors (audit fix 1C)
  const translateText = useCallback(async (
    text: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<{ translatedText: string; detectedLang: string } | null> => {
    try {
      setIsTranslating(true);

      // 2026-04-05: Auth pre-check (audit fix 1D) — fail fast with clear message
      const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      if (!token) {
        toast({ title: 'Session expired', description: 'Please log in to use translation.', variant: 'destructive' });
        return null;
      }

      const response = await fetch(API_ROUTES.TRANSLATE.SEND, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text, sourceLang, targetLang }),
      });

      if (response.status === 401 || response.status === 403) {
        toast({ title: 'Session expired', description: 'Please log in to use translation.', variant: 'destructive' });
        return null;
      }

      if (!response.ok) {
        toast({ title: 'Translation failed', description: 'Please try again.', variant: 'destructive' });
        return null;
      }

      const data = await response.json();

      // 2026-04-05: Auto-lock rider language from first detection (when riderLang unset)
      if (!riderLang && data.detectedLang && data.detectedLang !== 'en') {
        console.log(`[TranslationOverlay] Auto-detected rider language: ${data.detectedLang}`);
        setRiderLang(data.detectedLang);
      }

      return {
        translatedText: data.translatedText,
        detectedLang: data.detectedLang,
      };
    } catch (err) {
      // 2026-04-05: Toast on failure (audit fix 1C) — network errors, etc.
      console.error('[TranslationOverlay] Translation error:', err);
      toast({ title: 'Translation failed', description: 'Check connection and try again.', variant: 'destructive' });
      return null;
    } finally {
      setIsTranslating(false);
    }
  }, [riderLang, toast]);

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
  // 2026-03-28: Driver mic — auto-translate on stop (same seamless flow as rider).
  // Previously required manual Send confirmation via pendingText (removed).
  // Reads latestTranscriptRef inside timeout to avoid stale closure bug.
  const handleDriverMic = useCallback(() => {
    // 2026-04-05: Block if rider language not selected (audit fix 1A)
    if (!riderLang) {
      setShowLangPicker(true);
      toast({ title: 'Select rider language', description: 'Choose the rider\'s language first.', variant: 'destructive' });
      return;
    }
    if (activeMode === 'driver-speaking') {
      speech.stop();
      setActiveMode('idle');
      setTimeout(() => {
        const text = latestTranscriptRef.current;
        speech.clear();
        if (text) {
          translateText(text, 'en', riderLang).then(result => {
            if (result) {
              addMessage(text, result.translatedText, 'en', result.detectedLang || riderLang, 'driver');
            }
          });
        }
      }, 300);
    } else {
      setActiveMode('driver-speaking');
      speech.clear();
      speech.start('en');
    }
  }, [speech, activeMode, riderLang, translateText, addMessage, toast]);

  /**
   * Handle rider mic button — listen in rider's language, translate to English
   */
  // 2026-03-28: Rider mic — reads latestTranscriptRef inside timeout (stale closure fix).
  // In auto-detect mode, uses browser language as STT hint instead of hardcoded English.
  // 2026-04-05: Audit fixes 1A + 1B — require explicit riderLang, use it as STT hint
  // (navigator.language returns DRIVER's locale on this split-screen, not rider's)
  const handleRiderMic = useCallback(() => {
    if (!riderLang) {
      setShowLangPicker(true);
      toast({ title: 'Select rider language', description: 'Choose the rider\'s language first.', variant: 'destructive' });
      return;
    }
    if (activeMode === 'rider-speaking') {
      speech.stop();
      setActiveMode('idle');
      setTimeout(() => {
        const text = latestTranscriptRef.current;
        speech.clear();
        if (text) {
          translateText(text, riderLang, 'en').then(result => {
            if (result) {
              addMessage(text, result.translatedText, result.detectedLang || riderLang, 'en', 'rider');
            }
          });
        }
      }, 300);
    } else {
      setActiveMode('rider-speaking');
      speech.clear();
      // 2026-04-05: Use explicitly selected riderLang as STT hint (audit fix 1B).
      // navigator.language returns the DRIVER's locale (this is the driver's phone).
      speech.start(riderLang);
    }
  }, [speech, activeMode, riderLang, translateText, addMessage, toast]);

  /**
   * Handle quick phrase selection — instant translation + display
   */
  const handleQuickPhrase = useCallback(async (phrase: QuickPhrase) => {
    if (!riderLang) {
      setShowLangPicker(true);
      toast({ title: 'Select rider language', description: 'Choose the rider\'s language first.', variant: 'destructive' });
      return;
    }
    setShowQuickPhrases(false);
    const result = await translateText(phrase.en, 'en', riderLang);
    if (result) {
      await addMessage(phrase.en, result.translatedText, 'en', riderLang, 'driver');
    }
  }, [riderLang, translateText, addMessage, toast]);

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
        <span>EN ↔ {!riderLang ? '⚠️ Select language' : `${selectedLang?.flag} ${selectedLang?.nativeName}`}</span>
        {isTranslating && <span className="animate-pulse">Translating...</span>}
        {speech.isListening && (
          <span className="animate-pulse text-red-200">
            Listening{speech.interimTranscript ? `: "${speech.interimTranscript.substring(0, 30)}"` : '...'}
          </span>
        )}
      </div>

      {/* ================================================================ */}
      {/* DRIVER PANEL (BOTTOM) — English text + controls                  */}
      {/* 2026-04-05: Restructured — mic at top, lang picker as modal,     */}
      {/*   quick phrases below mic, language names in native script       */}
      {/* ================================================================ */}
      <div className="flex-1 bg-background overflow-hidden flex flex-col relative">
        {/* Controls bar — pinned at TOP of driver section for instant access */}
        <div className="shrink-0 border-b bg-card p-2 space-y-2">
          {/* Primary action row */}
          <div className="flex items-center gap-2">
            {/* Driver Mic — prominent, takes most width */}
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
                if (showLangPicker) setShowLangPicker(false);
              }}
            >
              💬
            </Button>

            {/* Language picker toggle */}
            <Button
              variant="outline"
              className="h-12 px-3 text-sm"
              onClick={() => {
                setShowLangPicker(!showLangPicker);
                if (showQuickPhrases) setShowQuickPhrases(false);
              }}
            >
              {selectedLang ? selectedLang.flag : '🌐'}
            </Button>

            {/* New Ride — clear conversation and reset */}
            {messages.length > 0 && (
              <Button
                variant="outline"
                className="h-12 px-3 text-xs"
                onClick={() => {
                  setMessages([]);
                  setRiderLang('');
                  setActiveMode('idle');
                  speech.clear();
                  setShowQuickPhrases(false);
                  setShowLangPicker(true);
                }}
              >
                🔄
              </Button>
            )}
          </div>

          {/* Quick Phrases panel (expandable, directly below action buttons) */}
          {showQuickPhrases && (
            <div className="max-h-40 overflow-y-auto pt-2 border-t">
              <QuickPhrases
                onSelect={handleQuickPhrase}
                isTranslating={isTranslating}
              />
            </div>
          )}

          {/* Speech recognition not supported warning */}
          {!speech.isSupported && (
            <div className="text-xs text-destructive text-center">
              Speech recognition not supported in this browser. Use Quick Phrases instead.
            </div>
          )}
        </div>

        {/* Messages area */}
        <div ref={driverPanelRef} className="flex-1 overflow-y-auto p-3">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-2">
              <div className="text-4xl">🌐</div>
              <div className="text-lg font-medium">Rider Translation</div>
              <div className="text-sm text-center max-w-xs">
                {!riderLang
                  ? "Tap 🌐 to select rider's language, then tap 🎤 to speak."
                  : 'Tap the mic to speak, or use Quick Phrases. Rider sees translated text on the top half.'}
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

        {/* Language picker — modal overlay (replaces inline 5x3 grid) */}
        {showLangPicker && (
          <div className="absolute inset-0 z-10 bg-background/95 backdrop-blur-sm flex flex-col p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">Select Rider's Language</h3>
              {riderLang && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowLangPicker(false)}
                  className="text-muted-foreground"
                >
                  ✕
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Rider can also tap their language below.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {LANGUAGES.map(lang => (
                <Button
                  key={lang.code}
                  variant={lang.code === riderLang ? 'default' : 'outline'}
                  className="h-auto py-2 px-1.5 flex flex-col items-center gap-0.5"
                  onClick={() => {
                    setRiderLang(lang.code);
                    setShowLangPicker(false);
                  }}
                >
                  <span className="text-lg leading-none">{lang.flag}</span>
                  <span className="text-sm font-medium leading-tight">{lang.nativeName}</span>
                  <span className="text-[10px] text-muted-foreground leading-tight">{lang.name}</span>
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
