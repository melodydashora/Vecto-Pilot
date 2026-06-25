// client/src/pages/welcome/WelcomePage.tsx
// 2026-05-16: Public /welcome iPad kiosk — re-skinned to match the live vectopilot.com aesthetic.
//
// SOURCE-OF-TRUTH BRAND VALUES (extracted from live app):
//   Body bg:           bg-gray-50                                        (CoPilotLayout.tsx:16)
//   Header gradient:   bg-gradient-to-r from-blue-600 to-purple-600      (GlobalHeader.tsx:423)
//   Header text:       text-white                                        (GlobalHeader.tsx:423)
//   Card:              bg-white border border-gray-200 rounded-xl shadow-sm
//   Heading text:      text-gray-900 / text-gray-800
//   Body text:         text-gray-700 / text-gray-600
//   Primary CTA:       bg-blue-600 hover:bg-blue-700 text-white          (StrategyPage.tsx:405)
//   Purple accent:     text-purple-600                                   (StrategyPage.tsx:421)
//
// Modern light SaaS aesthetic. NOT a dark moody slide deck.
// Public route — no auth required. Designed for landscape iPad as an in-car kiosk.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Mic, MicOff, Volume2, VolumeX,
  Maximize, RotateCcw, Heart, Hand, QrCode, Home, Star,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  SLIDE_KEYS, type SlideKey, renderSlide, T,
} from './slides';
import {
  useVoiceCommands, useSoundFx, useKioskGestures, toggleFullscreen,
  type VoiceCommand,
} from './hooks';

// ─────────────────────────────────────────────────────────────────────────
// 2026-05-15: QR triptych targets — all PUBLIC, no auth required.
// donate:    Public Vecto Pilot donate page (Square link + cost breakdown + future scope)
// concierge: /c/:token PublicConciergePage (rider companion)
// uber:      https://m.uber.com/ — Universal Link opens Uber app if installed,
//            else mobile web. (iOS Safari blocks uber:// URIs from QR scans.)
// ─────────────────────────────────────────────────────────────────────────
const QR_LINKS = {
  donate:    '/welcome/support',
  concierge: '/c/welcome',
  uber:      'https://m.uber.com/',
};

const QUIZ_CORRECT: Record<string, string> = {
  quizDoors:      'B',
  quizExperience: 'FALSE',
  quizStars:      'A',
  quizMilitary:   'FALSE',
};

const QUIZ_KEYS: SlideKey[] = ['quizDoors', 'quizExperience', 'quizStars', 'quizMilitary'];

function buildAbsoluteURL(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl;
  if (typeof window === 'undefined') return pathOrUrl;
  return `${window.location.origin}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

// ════════════════════════════════════════════════════════════════════════
// QR triptych — renders inside the final "farewell" slide
// ════════════════════════════════════════════════════════════════════════
function FarewellTriptych({ onRestart }: { onRestart: () => void }) {
  // 2026-05-15: Vecto Pilot brand colors (blue-600/violet-600 gradient on cards).
  // QRs: support (donate page), concierge (rider companion), Uber (mobile web → app).
  const cards = [
    { icon: Heart, label: 'Support Vecto Pilot', sub: 'Help cover API costs + future development', url: QR_LINKS.donate,    gradient: 'from-blue-600 to-purple-600' },
    { icon: QrCode,   label: 'Ask the Concierge',  sub: 'AI assistant for your ride',                 url: QR_LINKS.concierge, gradient: 'from-purple-600 to-blue-600' },
    { icon: Star,     label: 'Rate Your Driver',   sub: 'Open Uber → tap profile → Ratings',         url: QR_LINKS.uber,      gradient: 'from-blue-500 to-purple-500' },
  ];
  return (
    <div className="w-full max-w-6xl text-center">
      <div className="text-4xl md:text-7xl mb-2 md:mb-4 animate-[fadeUp_700ms_ease-out]">🙏</div>
      <h1 className="font-serif font-black text-3xl md:text-7xl">Thank You for Riding!</h1>
      <p className="text-sm md:text-2xl mt-2 md:mt-4 opacity-90">
        Have questions? Just ask. Enjoy a safe and comfortable ride.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-6 mt-5 md:mt-12">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-2xl p-3 md:p-6 flex flex-col items-center bg-white shadow-xl text-slate-900"
          >
            <div className={`w-10 h-10 md:w-14 md:h-14 rounded-full flex items-center justify-center mb-2 md:mb-3 bg-gradient-to-br ${c.gradient} text-white shadow-md`}>
              <c.icon className="w-5 h-5 md:w-7 md:h-7" />
            </div>
            <div className="font-bold text-base md:text-2xl text-blue-700">{c.label}</div>
            <div className="text-xs md:text-base mt-1 opacity-70 text-center">{c.sub}</div>
            <div className="mt-2 md:mt-4 p-2 md:p-3 bg-white rounded-xl shadow-inner border border-blue-100">
              <QRCodeSVG
                value={buildAbsoluteURL(c.url)}
                size={130}
                level="M"
                bgColor="#ffffff"
                fgColor={T.burgundy}
                className="md:!w-[170px] md:!h-[170px]"
              />
            </div>
            <div className="text-[10px] md:text-xs mt-2 md:mt-3 font-mono break-all opacity-60 max-w-[180px]">
              {c.url}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={onRestart}
        className="mt-5 md:mt-10 inline-flex items-center gap-2 md:gap-3 px-5 md:px-8 py-3 md:py-4 rounded-full text-base md:text-2xl font-semibold bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        <RotateCcw className="w-5 h-5 md:w-7 md:h-7" /> Start Over for Next Rider
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Confetti — pure CSS, no library
// ════════════════════════════════════════════════════════════════════════
function Confetti({ count = 60 }: { count?: number }) {
  const pieces = useMemo(() => Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.8,
    duration: 2.5 + Math.random() * 1.5,
    color: [T.rose, T.burgundy, T.terracotta, T.cream, T.slate][i % 5],
    size: 8 + Math.random() * 6,
  })), [count]);
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden z-30">
      {pieces.map(p => (
        <span
          key={p.id}
          className="absolute top-[-20px] rounded-sm"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            animation: `confettiFall ${p.duration}s linear ${p.delay}s forwards`,
          }}
        />
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Main WelcomePage
// ════════════════════════════════════════════════════════════════════════
export default function WelcomePage() {
  const [unlocked, setUnlocked] = useState(false);
  const [index, setIndex] = useState(0);
  const [quizSelected, setQuizSelected] = useState<Partial<Record<SlideKey, string>>>({});
  const [soundOn, setSoundOn] = useState(true);
  const [voiceOn, setVoiceOn] = useState(false);
  const [transition, setTransition] = useState<'idle' | 'out'>('idle');
  // 2026-05-15: shake fires on HONK; burst fires localized confetti on each correct quiz answer.
  const [shaking, setShaking] = useState(false);
  const [burst, setBurst] = useState(false);

  const { play, unlock: unlockAudio } = useSoundFx(soundOn);

  // ── derived: quiz score
  const correctCount = useMemo(
    () => QUIZ_KEYS.reduce((n, k) => n + (quizSelected[k] === QUIZ_CORRECT[k] ? 1 : 0), 0),
    [quizSelected],
  );

  const currentKey: SlideKey = SLIDE_KEYS[index];

  // ── navigation
  const goNext = useCallback(() => {
    setIndex(i => {
      if (i >= SLIDE_KEYS.length - 1) return i;
      setTransition('out');
      window.setTimeout(() => setTransition('idle'), 250);
      play('whoosh');
      return i + 1;
    });
  }, [play]);

  const goBack = useCallback(() => {
    setIndex(i => {
      if (i <= 0) return i;
      setTransition('out');
      window.setTimeout(() => setTransition('idle'), 250);
      play('whoosh');
      return i - 1;
    });
  }, [play]);

  const goTo = useCallback((key: SlideKey) => {
    const target = SLIDE_KEYS.indexOf(key);
    if (target < 0) return;
    setTransition('out');
    window.setTimeout(() => setTransition('idle'), 250);
    play('whoosh');
    setIndex(target);
  }, [play]);

  const restart = useCallback(() => {
    play('chime');
    setQuizSelected({});
    setIndex(0);
  }, [play]);

  // ── quiz answer handler
  const handleAnswer = useCallback((id: SlideKey, choice: string, isCorrect: boolean) => {
    if (quizSelected[id]) return; // already answered, no double-count
    setQuizSelected(prev => ({ ...prev, [id]: choice }));
    play(isCorrect ? 'correct' : 'wrong');
    if (isCorrect) {
      // 2026-05-15: localized confetti burst on correct answer (in addition to the
      // bigger scoreboard celebration). Reset-then-set so a fast 2nd correct re-triggers.
      setBurst(false);
      window.setTimeout(() => setBurst(true), 10);
      window.setTimeout(() => setBurst(false), 2500);
    }
  }, [play, quizSelected]);

  // ── HONK handler — shake the app + play a 2-tone horn
  const handleHonk = useCallback(() => {
    setShaking(false);
    window.setTimeout(() => setShaking(true), 10);
    window.setTimeout(() => setShaking(false), 520);
    play('honk');
  }, [play]);

  // ── voice commands
  const onVoice = useCallback((cmd: VoiceCommand) => {
    switch (cmd.type) {
      case 'next':    goNext(); break;
      case 'back':    goBack(); break;
      case 'home':    restart(); break;
      case 'quiz':    goTo('quizIntro'); break;
      case 'restart': restart(); break;
      case 'choice': {
        if (!QUIZ_KEYS.includes(currentKey)) return;
        const correct = QUIZ_CORRECT[currentKey];
        handleAnswer(currentKey, cmd.letter, cmd.letter === correct);
        break;
      }
    }
  }, [goNext, goBack, restart, goTo, currentKey, handleAnswer]);

  const { supported: voiceSupported, listening: voiceListening } = useVoiceCommands(
    unlocked && voiceOn,
    onVoice,
  );

  // ── keyboard + touch
  useKioskGestures({ onNext: goNext, onBack: goBack, enabled: unlocked });

  // ── auto-advance from intro 1.5s after quiz completion → scoreboard
  useEffect(() => {
    if (currentKey !== 'quizMilitary') return;
    if (!quizSelected.quizMilitary) return;
    const t = window.setTimeout(() => goTo('scoreboard'), 2200);
    return () => window.clearTimeout(t);
  }, [currentKey, quizSelected.quizMilitary, goTo]);

  // ── chime when stats slide first appears (subtle delight)
  useEffect(() => {
    if (currentKey === 'stats' || currentKey === 'scoreboard') play('chime');
    if (currentKey === 'farewell') play('fanfare');
  }, [currentKey, play]);

  // ════════════ Tap-to-begin gate (audio + voice unlock) ════════════════
  if (!unlocked) {
    return (
      <button
        onClick={() => { unlockAudio(); setUnlocked(true); }}
        className="fixed inset-0 w-screen h-screen flex items-center justify-center text-left bg-gray-50"
      >
        <div className="text-center animate-[fadeUp_900ms_ease-out] px-6 max-w-2xl">
          <div className="inline-block p-4 md:p-6 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 shadow-lg mb-4 md:mb-6">
            <Heart fill="#ffffff" stroke="#ffffff" className="w-12 h-12 md:w-20 md:h-20" />
          </div>
          <h1 className="font-serif font-black text-4xl md:text-7xl mt-3 md:mt-6 tracking-tight text-gray-900">Welcome.</h1>
          <p className="text-lg md:text-2xl mt-2 md:mt-4 italic text-gray-600">An interactive tour of your ride</p>
          <div className="mt-6 md:mt-12 inline-flex items-center gap-2 md:gap-4 px-5 md:px-10 py-3 md:py-5 rounded-full text-lg md:text-2xl font-semibold bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg">
            <Hand className="w-5 h-5 md:w-7 md:h-7" /> Tap anywhere to begin
          </div>
          <p className="text-xs md:text-base mt-5 md:mt-10 text-gray-500">Sound and voice control will turn on once you tap.</p>
        </div>
      </button>
    );
  }

  // ═════════════════ Main kiosk view ════════════════════════════════════
  const total = SLIDE_KEYS.length;
  const progress = ((index + 1) / total) * 100;
  const inQuiz = QUIZ_KEYS.includes(currentKey);
  const showConfetti = currentKey === 'scoreboard' && correctCount >= 3;
  const isFarewell = currentKey === 'farewell';

  return (
    <div
      className={`fixed inset-0 w-screen h-screen overflow-hidden select-none bg-gray-50 ${shaking ? 'animate-shake' : ''}`}
    >
      {/* Inline keyframes — co-located so the whole experience is one file's worth of CSS */}
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes confettiFall {
          0%   { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0.7; }
        }
        @keyframes slideOut { from { opacity: 1; } to { opacity: 0; } }
        @keyframes shake {
          0%, 100% { transform: translate(0, 0) rotate(0); }
          10%, 30%, 50%, 70%, 90% { transform: translate(-4px, -2px) rotate(-0.8deg); }
          20%, 40%, 60%, 80%      { transform: translate(4px, 2px)   rotate(0.8deg); }
        }
        .animate-shake { animation: shake 0.5s cubic-bezier(.36,.07,.19,.97); }
      `}</style>

      {showConfetti && <Confetti />}
      {burst && <Confetti count={30} />}

      {/* Slide stage */}
      <div
        key={currentKey}
        className="w-full h-full"
        style={{
          animation: transition === 'out' ? 'slideOut 250ms ease-out' : 'fadeUp 400ms ease-out',
        }}
      >
        {isFarewell
          ? renderSlide('farewell', {
              onJump: goTo,
              onHonk: handleHonk,
              quiz: { selected: quizSelected, onAnswer: handleAnswer, correctCount },
              farewellNode: <FarewellTriptych onRestart={restart} />,
            })
          : renderSlide(currentKey, {
              onJump: goTo,
              onHonk: handleHonk,
              quiz: { selected: quizSelected, onAnswer: handleAnswer, correctCount },
              farewellNode: null,
            })}
      </div>

      {/* Top bar — light SaaS pills on the gray-50 body. Parent has pointer-events-none
          so the body underneath stays tappable; both inner button groups must keep
          pointer-events-auto so volume/mic/fullscreen remain clickable (2026-05-16 fix). */}
      <div className="absolute top-3 left-0 right-0 z-20 flex items-center justify-between px-3 md:px-6 pointer-events-none">
        <div className="flex items-center gap-2 md:gap-3 pointer-events-auto">
          <div className="rounded-full px-3 py-1 md:px-4 md:py-1.5 text-xs md:text-sm font-mono bg-white border border-gray-200 shadow-sm text-gray-700">
            {index + 1} / {total}
          </div>
          {inQuiz && (
            <div className="rounded-full px-3 py-1 md:px-4 md:py-1.5 text-xs md:text-sm font-semibold shadow-sm bg-gradient-to-r from-blue-600 to-purple-600 text-white">
              Score: {correctCount} / {QUIZ_KEYS.length}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 md:gap-2 pointer-events-auto">
          <button
            onClick={() => setSoundOn(s => !s)}
            className="p-2 md:p-3 rounded-full bg-white border border-gray-200 shadow-sm text-blue-600 hover:bg-gray-50 transition-colors"
            aria-label={soundOn ? 'Mute sounds' : 'Enable sounds'}
          >
            {soundOn ? <Volume2 className="w-4 h-4 md:w-5 md:h-5" /> : <VolumeX className="w-4 h-4 md:w-5 md:h-5" />}
          </button>
          {voiceSupported && (
            <button
              onClick={() => setVoiceOn(v => !v)}
              className={`p-2 md:p-3 rounded-full border shadow-sm transition-colors ${
                voiceListening
                  ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white border-transparent'
                  : 'bg-white border-gray-200 text-blue-600 hover:bg-gray-50'
              }`}
              aria-label={voiceOn ? 'Disable voice control' : 'Enable voice control'}
              title={voiceOn ? 'Listening — say "next", "back", "A", "B", "true", "false"' : 'Enable voice control'}
            >
              {voiceOn ? <Mic className="w-4 h-4 md:w-5 md:h-5" /> : <MicOff className="w-4 h-4 md:w-5 md:h-5" />}
            </button>
          )}
          <button
            onClick={() => toggleFullscreen()}
            className="p-2 md:p-3 rounded-full bg-white border border-gray-200 shadow-sm text-blue-600 hover:bg-gray-50 transition-colors"
            aria-label="Toggle fullscreen"
          >
            <Maximize className="w-4 h-4 md:w-5 md:h-5" />
          </button>
        </div>
      </div>

      {/* Bottom progress bar — taxi rides the fill as the rider advances */}
      <div className="absolute bottom-0 left-0 right-0 h-2 bg-gray-200 z-20">
        <div
          className="h-full transition-all duration-500 ease-out relative bg-gradient-to-r from-blue-600 to-purple-600"
          style={{ width: `${progress}%` }}
        >
          <div className="absolute -top-4 -right-3 text-2xl drop-shadow-lg pointer-events-none" aria-hidden>🚕</div>
        </div>
      </div>

      {/* Prev / Next / Home — 2026-05-15: subtle ghost buttons per Melody.
          Edge-anchored, semi-transparent white with backdrop blur, blue chevron.
          48px touch target meets accessibility (Apple HIG ≥44px). */}
      {index > 0 && (
        <button
          onClick={goBack}
          className="absolute left-3 md:left-5 top-1/2 -translate-y-1/2 z-20 w-12 h-12 md:w-14 md:h-14 rounded-full bg-white border border-gray-200 hover:bg-gray-50 flex items-center justify-center text-blue-600 hover:text-blue-700 shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          aria-label="Previous slide"
        >
          <ChevronLeft size={26} strokeWidth={2.2} />
        </button>
      )}
      {index < total - 1 && (
        <button
          onClick={goNext}
          className="absolute right-3 md:right-5 top-1/2 -translate-y-1/2 z-20 w-12 h-12 md:w-14 md:h-14 rounded-full bg-white border border-gray-200 hover:bg-gray-50 flex items-center justify-center text-blue-600 hover:text-blue-700 shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          aria-label="Next slide"
        >
          <ChevronRight size={26} strokeWidth={2.2} />
        </button>
      )}

      {/* Home button — subtle pill at bottom-center. Hidden on Hero. */}
      {index > 0 && (
        <button
          onClick={() => goTo('hero')}
          className="absolute bottom-5 md:bottom-7 left-1/2 -translate-x-1/2 z-20 w-12 h-12 md:w-14 md:h-14 rounded-full bg-white border border-gray-200 hover:bg-gray-50 flex items-center justify-center text-blue-600 hover:text-blue-700 shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          aria-label="Return to welcome screen"
        >
          <Home size={22} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}
