// client/src/pages/landing/LandingPage.tsx
// 2026-04-02: Public marketing/demo landing page — no auth required.
// Interactive phone mockup showcasing all 7 Vecto Pilot features with auto-play demo.

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MapPin, BarChart2, Languages, Navigation, Smartphone,
  ChevronRight, ChevronLeft, Star, TrendingUp, AlertTriangle,
  QrCode, Mic, Globe, Map, Coffee, FileText, Cloud, Plane,
  Car, Phone, Play, Square, Zap, Brain, Shield, ArrowRight,
  Github, ExternalLink
} from 'lucide-react';

const FEATURES = [
  {
    id: 'strategy',
    title: 'Real-Time Strategy',
    description: 'Stop guessing. Get live, location-aware positioning recommendations to maximize earnings and minimize dead time.',
    icon: Navigation,
    color: 'violet'
  },
  {
    id: 'lounges',
    title: 'Lounges & Bars',
    description: 'Live directory of high-value venues with crowd estimates, phone numbers, and one-tap navigation.',
    icon: Coffee,
    color: 'fuchsia'
  },
  {
    id: 'briefing',
    title: 'Daily Briefing',
    description: 'Start your shift right with comprehensive traffic alerts and live airport queue conditions.',
    icon: FileText,
    color: 'slate'
  },
  {
    id: 'map',
    title: 'Strategic Map',
    description: 'Visualize demand clusters and high-value zones on a live interactive map.',
    icon: Map,
    color: 'green'
  },
  {
    id: 'intel',
    title: 'Market Intelligence',
    description: 'Master your city with demand rhythms, universal zone logic, and our proprietary Deadhead Risk Calculator.',
    icon: BarChart2,
    color: 'amber'
  },
  {
    id: 'translate',
    title: 'Live Rider Translation',
    description: 'Break the barrier. Split-screen live translation lets your international riders read along seamlessly.',
    icon: Languages,
    color: 'blue'
  },
  {
    id: 'concierge',
    title: 'In-Car Concierge',
    description: 'Elevate the rider experience with custom venue recommendations and a personalized scannable QR code.',
    icon: QrCode,
    color: 'teal'
  }
];

type ColorKey = 'violet' | 'fuchsia' | 'slate' | 'green' | 'amber' | 'blue' | 'teal';

const COLOR_MAP: Record<ColorKey, { bg: string; text: string; iconBg: string; dot: string; ring: string }> = {
  violet:  { bg: 'bg-violet-100', text: 'text-violet-600', iconBg: 'bg-violet-600', dot: 'bg-violet-500', ring: 'ring-violet-200' },
  fuchsia: { bg: 'bg-fuchsia-100', text: 'text-fuchsia-600', iconBg: 'bg-fuchsia-600', dot: 'bg-fuchsia-500', ring: 'ring-fuchsia-200' },
  slate:   { bg: 'bg-slate-200', text: 'text-slate-700', iconBg: 'bg-slate-700', dot: 'bg-slate-500', ring: 'ring-slate-300' },
  green:   { bg: 'bg-green-100', text: 'text-green-600', iconBg: 'bg-green-600', dot: 'bg-green-500', ring: 'ring-green-200' },
  amber:   { bg: 'bg-amber-100', text: 'text-amber-600', iconBg: 'bg-amber-600', dot: 'bg-amber-400', ring: 'ring-amber-200' },
  blue:    { bg: 'bg-blue-100', text: 'text-blue-600', iconBg: 'bg-blue-600', dot: 'bg-blue-500', ring: 'ring-blue-200' },
  teal:    { bg: 'bg-teal-100', text: 'text-teal-600', iconBg: 'bg-teal-600', dot: 'bg-teal-500', ring: 'ring-teal-200' },
};

export default function LandingPage() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [displayIndex, setDisplayIndex] = useState(0);
  const [phase, setPhase] = useState<'visible' | 'fading-out' | 'fading-in'>('visible');
  const [isPlaying, setIsPlaying] = useState(false);
  const [heroVisible, setHeroVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setTimeout(() => setHeroVisible(true), 100); }, []);

  const goTo = useCallback((nextIndex: number) => {
    if (nextIndex === activeIndex && phase === 'visible') return;
    setPhase('fading-out');
    setActiveIndex(nextIndex);

    const navBtn = document.getElementById(`phone-nav-${FEATURES[nextIndex].id}`);
    if (navBtn) {
      navBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }

    setTimeout(() => {
      setDisplayIndex(nextIndex);
      setPhase('fading-in');
      setTimeout(() => setPhase('visible'), 320);
    }, 300);
  }, [activeIndex, phase]);

  const goNext = useCallback(() => {
    goTo((activeIndex + 1) % FEATURES.length);
  }, [activeIndex, goTo]);

  const goPrev = useCallback(() => {
    goTo((activeIndex - 1 + FEATURES.length) % FEATURES.length);
  }, [activeIndex, goTo]);

  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(goNext, 4200);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isPlaying, goNext]);

  const handleManualNav = (idx: number) => {
    setIsPlaying(false);
    goTo(idx);
  };

  const feature = FEATURES[displayIndex];
  const colors = COLOR_MAP[feature.color as ColorKey];
  const Icon = feature.icon;

  const contentClass = phase === 'fading-out'
    ? 'opacity-0 translate-y-3 scale-[0.98] blur-[2px]'
    : 'opacity-100 translate-y-0 scale-100 blur-0';

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-violet-200 pb-20">
      <style>{`
        @keyframes heroUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        .hero-animate { opacity: 0; animation: heroUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .hero-d1 { animation-delay: 0.15s; }
        .hero-d2 { animation-delay: 0.3s; }
        .hero-d3 { animation-delay: 0.45s; }
        @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        .shimmer { background: linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.3) 50%, transparent 70%); background-size: 200% 100%; animation: shimmer 3s ease-in-out infinite; }
        .phone-glow { box-shadow: 0 0 80px rgba(124,58,237,0.12), 0 25px 50px rgba(0,0,0,0.15); }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .content-transition { transition: opacity 0.3s ease, transform 0.3s ease, filter 0.3s ease; }
      `}</style>

      {/* Nav */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md z-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 lg:h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-violet-600 rounded-lg flex items-center justify-center shadow-md">
              <Smartphone className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight">Vecto Pilot&trade;</span>
          </div>
          <div className="hidden md:flex gap-8 text-sm font-medium text-slate-600">
            <a href="#features" className="hover:text-violet-600 transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-violet-600 transition-colors">How it Works</a>
            <a href="#pricing" className="hover:text-violet-600 transition-colors">Pricing</a>
          </div>
        </div>
      </nav>

      <main className="pt-24 lg:pt-32 pb-10 lg:pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {/* Hero */}
        <div className={`text-center max-w-3xl mx-auto mb-10 lg:mb-16 ${heroVisible ? '' : 'opacity-0'}`}>
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-100 text-violet-700 text-sm font-semibold mb-4 lg:mb-6 border border-violet-200 relative overflow-hidden ${heroVisible ? 'hero-animate' : ''}`}>
            <div className="shimmer absolute inset-0 rounded-full"></div>
            <Star className="w-4 h-4 relative z-10" />
            <span className="relative z-10">The #1 Strategic Rideshare Assistant</span>
          </div>
          <h1 className={`text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight mb-4 lg:mb-6 leading-tight ${heroVisible ? 'hero-animate hero-d1' : ''}`}>
            Drive Smarter.<br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-violet-600">Maximize Your Earnings.</span>
          </h1>
          <p className={`text-base lg:text-xl text-slate-600 mb-6 lg:mb-8 leading-relaxed max-w-2xl mx-auto ${heroVisible ? 'hero-animate hero-d2' : ''}`}>
            Vecto Pilot is your AI-powered co-pilot. Get real-time positioning strategies, market intelligence, and in-car concierge tools right on your dashboard.
          </p>
          <div className={`flex gap-4 justify-center ${heroVisible ? 'hero-animate hero-d3' : ''}`}>
            <button
              onClick={() => {
                const next = !isPlaying;
                setIsPlaying(next);
                if (next) document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="bg-violet-600 text-white px-8 py-3.5 rounded-full font-semibold text-lg hover:bg-violet-700 transition-all shadow-lg shadow-violet-200 flex items-center gap-2 active:scale-[0.98]"
            >
              {isPlaying
                ? <><span>Stop Demo</span><Square className="w-5 h-5 fill-current" /></>
                : <><span>Watch Demo</span><Play className="w-5 h-5 fill-current" /></>
              }
            </button>
          </div>
        </div>

        {/* ======= SHOWCASE ======= */}
        <div id="features" className="mt-12 lg:mt-24 bg-white rounded-3xl p-5 md:p-8 lg:p-12 shadow-xl border border-slate-100">
          <div className="flex flex-col lg:flex-row items-center gap-8 lg:gap-16">

            {/* LEFT: Feature text */}
            <div className="w-full lg:w-1/2 order-2 lg:order-1 flex flex-col items-center lg:items-start min-h-[300px] justify-center">
              <div className={`content-transition ${contentClass} w-full`}>
                <div className="flex items-center gap-4 mb-4 lg:mb-5">
                  <div className={`p-3 lg:p-4 rounded-2xl ${colors.iconBg} text-white shadow-lg`}>
                    <Icon className="w-6 h-6 lg:w-7 lg:h-7" />
                  </div>
                  <div>
                    <div className={`text-xs font-bold uppercase tracking-widest ${colors.text} mb-1`}>
                      {displayIndex + 1} / {FEATURES.length}
                    </div>
                    <h2 className="text-2xl lg:text-3xl font-extrabold text-slate-900 leading-tight">
                      {feature.title}
                    </h2>
                  </div>
                </div>
                <p className="text-base lg:text-lg text-slate-600 leading-relaxed mb-6 lg:mb-8 max-w-md">
                  {feature.description}
                </p>
              </div>

              {/* Navigation row */}
              <div className="flex items-center gap-4 w-full">
                <button onClick={goPrev} className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors shrink-0">
                  <ChevronLeft className="w-5 h-5 text-slate-600" />
                </button>
                <div className="flex gap-2 flex-1 justify-center">
                  {FEATURES.map((f, i) => {
                    const c = COLOR_MAP[f.color as ColorKey];
                    const FIcon = f.icon;
                    return (
                      <button
                        key={f.id}
                        onClick={() => handleManualNav(i)}
                        title={f.title}
                        className={`relative rounded-full transition-all duration-300 flex items-center justify-center ${
                          i === activeIndex
                            ? `w-10 h-10 ${c.iconBg} text-white shadow-lg ring-4 ${c.ring} scale-110`
                            : 'w-8 h-8 bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'
                        }`}
                      >
                        <FIcon className={`${i === activeIndex ? 'w-4 h-4' : 'w-3.5 h-3.5'}`} />
                      </button>
                    );
                  })}
                </div>
                <button onClick={goNext} className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors shrink-0">
                  <ChevronRight className="w-5 h-5 text-slate-600" />
                </button>
              </div>
            </div>

            {/* RIGHT: Phone mockup */}
            <div className="w-full lg:w-1/2 flex justify-center order-1 lg:order-2">
              <div className="relative w-[280px] h-[560px] lg:w-[320px] lg:h-[650px] bg-slate-900 rounded-[2.5rem] lg:rounded-[3rem] border-[10px] lg:border-[12px] border-slate-900 overflow-hidden ring-1 ring-slate-200/50 phone-glow">
                <div className="absolute top-0 inset-x-0 h-5 lg:h-6 flex justify-center z-50">
                  <div className="w-28 lg:w-32 h-5 lg:h-6 bg-slate-900 rounded-b-3xl"></div>
                </div>
                <div className={`absolute inset-0 bg-slate-50 overflow-y-auto hide-scrollbar content-transition ${contentClass}`}>
                  {displayIndex === 0 && <StrategyScreen />}
                  {displayIndex === 1 && <LoungesScreen />}
                  {displayIndex === 2 && <BriefingScreen />}
                  {displayIndex === 3 && <MapScreen />}
                  {displayIndex === 4 && <IntelScreen />}
                  {displayIndex === 5 && <TranslateScreen />}
                  {displayIndex === 6 && <ConciergeScreen />}
                </div>
                <div className="absolute bottom-0 w-full bg-white border-t border-slate-200 z-40 pb-4 lg:pb-5 pt-2 lg:pt-3">
                  <div className="flex overflow-x-auto gap-4 lg:gap-6 px-4 lg:px-6 scroll-smooth hide-scrollbar">
                    {FEATURES.map((f, i) => {
                      const FIcon = f.icon;
                      const c = COLOR_MAP[f.color as ColorKey];
                      const isActive = i === activeIndex;
                      return (
                        <div
                          key={f.id}
                          id={`phone-nav-${f.id}`}
                          onClick={() => handleManualNav(i)}
                          className={`flex flex-col items-center gap-0.5 cursor-pointer shrink-0 transition-all duration-300 ${isActive ? c.text : 'text-slate-400 hover:text-slate-600'}`}
                        >
                          <div className={`transition-transform duration-300 ${isActive ? 'scale-110' : ''}`}>
                            <FIcon className="w-4 h-4 lg:w-5 lg:h-5" />
                          </div>
                          <span className={`text-[9px] lg:text-[10px] ${isActive ? 'font-bold' : 'font-medium'}`}>
                            {f.title.split(' ')[0]}
                          </span>
                          {isActive && <div className={`w-1 h-1 rounded-full ${c.dot} -mt-0.5`}></div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </main>

      {/* ======= HOW IT WORKS ======= */}
      <section id="how-it-works" className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto py-16 lg:py-24">
        <div className="text-center mb-12 lg:mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-100 text-blue-700 text-sm font-semibold mb-4 border border-blue-200">
            <Zap className="w-4 h-4" />
            <span>Simple Setup</span>
          </div>
          <h2 className="text-3xl lg:text-4xl font-extrabold tracking-tight text-slate-900 mb-4">
            Up and Running in Minutes
          </h2>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            No hardware. No training. Just sign in and start driving smarter.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
          {[
            {
              step: '01',
              title: 'Sign Up & Set Location',
              description: 'Create your account and grant location access. Vecto Pilot auto-detects your city, market, and timezone.',
              icon: MapPin,
              color: 'violet',
            },
            {
              step: '02',
              title: 'Get Your Strategy',
              description: 'Our AI analyzes traffic, events, weather, and demand patterns to generate your personalized positioning strategy.',
              icon: Brain,
              color: 'blue',
            },
            {
              step: '03',
              title: 'Drive & Earn More',
              description: 'Follow real-time recommendations. The system learns from your market and continuously refines its advice.',
              icon: TrendingUp,
              color: 'green',
            },
          ].map((item) => {
            const StepIcon = item.icon;
            return (
              <div key={item.step} className="relative">
                <div className="bg-white rounded-2xl p-6 lg:p-8 shadow-sm border border-slate-100 hover:shadow-md transition-shadow h-full">
                  <div className="flex items-center gap-4 mb-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg ${
                      item.color === 'violet' ? 'bg-violet-600' :
                      item.color === 'blue' ? 'bg-blue-600' : 'bg-green-600'
                    } text-white`}>
                      <StepIcon className="w-6 h-6" />
                    </div>
                    <span className="text-4xl font-extrabold text-slate-100">{item.step}</span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">{item.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{item.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ======= BUILT WITH / TECH STACK ======= */}
      <section id="pricing" className="bg-white border-y border-slate-200 py-16 lg:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10 lg:mb-14">
            <h2 className="text-3xl lg:text-4xl font-extrabold tracking-tight text-slate-900 mb-4">
              Built for Serious Drivers
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Enterprise-grade AI infrastructure powering individual driver success.
            </p>
          </div>

          {/* Tech badges */}
          <div className="flex flex-wrap justify-center gap-3 mb-12 lg:mb-16">
            {[
              { label: 'Claude Opus', sub: 'Strategy' },
              { label: 'Gemini Pro', sub: 'Briefings' },
              { label: 'GPT-5.2', sub: 'Consolidation' },
              { label: 'Google Search', sub: 'Live Data' },
              { label: 'TomTom', sub: 'Traffic' },
              { label: 'Google Maps', sub: 'Routes' },
              { label: 'React 19', sub: 'Frontend' },
              { label: 'PostgreSQL', sub: 'Database' },
            ].map((t) => (
              <div key={t.label} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-center hover:border-violet-200 hover:bg-violet-50/30 transition-colors">
                <div className="font-bold text-sm text-slate-800">{t.label}</div>
                <div className="text-[10px] text-slate-500 font-medium">{t.sub}</div>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 lg:gap-8">
            {[
              { value: '7', label: 'AI-Powered Features' },
              { value: '3', label: 'Frontier AI Models' },
              { value: '<60s', label: 'Strategy Generation' },
              { value: '24/7', label: 'Real-Time Updates' },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-3xl lg:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-violet-600 mb-1">{s.value}</div>
                <div className="text-sm text-slate-600 font-medium">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ======= CTA BANNER ======= */}
      <section className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto py-16 lg:py-24">
        <div className="bg-gradient-to-br from-blue-600 via-violet-600 to-violet-700 rounded-3xl p-8 md:p-12 lg:p-16 text-center text-white relative overflow-hidden">
          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3"></div>
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-1/3 -translate-x-1/4"></div>

          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-white/90 text-sm font-semibold mb-6 border border-white/20">
              <Shield className="w-4 h-4" />
              <span>Free to try. No credit card required.</span>
            </div>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight mb-4 leading-tight">
              Ready to Drive Smarter?
            </h2>
            <p className="text-lg text-blue-100 mb-8 max-w-xl mx-auto leading-relaxed">
              Join the drivers who are using AI to outperform their market. Your first briefing is generated in under 60 seconds.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="/auth/sign-up"
                className="inline-flex items-center justify-center gap-2 bg-white text-violet-700 px-8 py-3.5 rounded-full font-bold text-lg hover:bg-violet-50 transition-all shadow-lg active:scale-[0.98]"
              >
                Get Started Free <ArrowRight className="w-5 h-5" />
              </a>
              <a
                href="/auth/sign-in"
                className="inline-flex items-center justify-center gap-2 bg-white/10 text-white px-8 py-3.5 rounded-full font-bold text-lg hover:bg-white/20 transition-all border border-white/20"
              >
                Sign In
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ======= FOOTER ======= */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-violet-600 rounded-lg flex items-center justify-center shadow-md">
                <Smartphone className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="font-bold text-lg tracking-tight text-slate-900">Vecto Pilot&trade;</span>
                <p className="text-xs text-slate-500">AI-Powered Rideshare Co-Pilot</p>
              </div>
            </div>

            <div className="flex items-center gap-6 text-sm text-slate-600">
              <a href="/policy" className="hover:text-violet-600 transition-colors">Privacy Policy</a>
              <a href="/auth/terms" className="hover:text-violet-600 transition-colors">Terms</a>
              <a
                href="https://github.com/melodydashora/Vecto-Pilot"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-violet-600 transition-colors flex items-center gap-1.5"
              >
                <Github className="w-4 h-4" /> GitHub <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="text-xs text-slate-400">
              &copy; {new Date().getFullYear()} Vecto Pilot. Built with Claude, Gemini & GPT.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ===============================================
   PHONE SCREENS
=============================================== */

function StrategyScreen() {
  return (
    <div className="pb-20 lg:pb-24 bg-slate-50 min-h-full">
      <div className="bg-gradient-to-br from-blue-600 to-violet-600 pt-8 lg:pt-10 pb-6 px-4 text-white">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4" />
            <span className="font-bold text-sm">Vecto Pilot&trade;</span>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold">09:36 PM</div>
            <div className="text-[10px] text-blue-200">Frisco, TX</div>
          </div>
        </div>
      </div>
      <div className="p-3 space-y-3 -mt-4">
        <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-100 flex items-center gap-3 relative z-10">
          <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">M</div>
          <div>
            <div className="font-bold text-slate-800 text-sm">Good evening, Melody!</div>
            <div className="text-[10px] text-slate-500">AI strategy analyzing conditions.</div>
          </div>
        </div>
        <div className="bg-orange-50 rounded-xl p-3 border border-orange-100 shadow-sm">
          <div className="flex items-center gap-2 text-orange-600 font-bold mb-2 text-xs">
            <MapPin className="w-3.5 h-3.5" /> Where to be NOW
          </div>
          <div className="space-y-2 text-[11px] text-slate-700 leading-relaxed">
            <p><strong className="text-slate-900">GO:</strong> Legacy West & The Star. Position near Renaissance Dallas.</p>
            <p><strong className="text-slate-900">AVOID:</strong> I-35E and DNT access roads. Heavy congestion.</p>
            <p><strong className="text-slate-900">WHY:</strong> Stars game ending, but traffic makes south trip inefficient.</p>
          </div>
        </div>
        <div className="mt-4">
          <div className="font-bold text-slate-800 mb-2 flex items-center gap-2 text-xs">
            <TrendingUp className="w-3.5 h-3.5 text-violet-600" /> High-Value Venues
          </div>
          <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-100 mb-2">
            <div className="flex justify-between items-start mb-1">
              <div>
                <div className="font-bold text-slate-900 text-xs">Legacy Hall</div>
                <div className="text-[10px] text-slate-500">5908 Windrose Ave, Plano</div>
              </div>
              <div className="bg-green-100 text-green-700 text-[9px] px-2 py-0.5 rounded font-bold">OPEN</div>
            </div>
            <div className="flex justify-between items-center mt-3">
              <div className="text-orange-500 font-bold text-[10px] flex items-center gap-1"><TrendingUp className="w-3 h-3" /> HIGH VALUE</div>
              <div className="text-center"><div className="font-bold text-slate-900 text-xs">7.1 mi</div><div className="text-[9px] text-slate-500">12 min</div></div>
              <div className="text-right"><div className="text-violet-600 font-bold text-xs">1.5x</div><div className="text-[9px] text-slate-500">Surge</div></div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-100">
            <div className="font-bold text-slate-900 text-xs">Sidecar Social Frisco</div>
            <div className="text-[10px] text-slate-500 mb-2">6770 Winning Dr, Frisco</div>
            <div className="bg-violet-50 p-2 rounded-lg text-[10px] text-slate-700 border border-violet-100">
              <strong className="text-violet-700 block mb-0.5">AI Tip:</strong>
              Cleanest pickup on Winning Dr. Groups drift toward the Omni.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoungesScreen() {
  const venues = [
    { name: "III Forks", addr: "1303 Legacy Dr", price: "$$$$", rating: "4.6", phone: "(972) 267-1776", crowd: "high", color: "bg-orange-500" },
    { name: "The Owl Bar", addr: "6363 Dallas Pkwy", price: "$$", rating: "4.8", phone: "(972) 292-9988", crowd: "high", color: "bg-orange-500" },
    { name: "Kinzo", addr: "14111 King Rd", price: "$$", rating: "4.8", phone: "(214) 784-5785", crowd: "high", color: "bg-orange-500" },
    { name: "Sportz BAR", addr: "14111 King Rd", price: "$$", rating: "4.8", phone: "(469) 583-4261", crowd: "mod", color: "bg-amber-500" },
  ];
  return (
    <div className="pb-20 bg-slate-50 min-h-full">
      <div className="bg-white pt-8 pb-3 px-3 sticky top-0 z-10 border-b border-slate-200 shadow-sm">
        <div className="flex justify-between items-center">
          <h2 className="font-bold text-base text-slate-900 flex items-center gap-2">
            <div className="p-1 bg-fuchsia-100 rounded-lg"><Coffee className="w-3.5 h-3.5 text-fuchsia-600" /></div>
            Lounges & Bars
          </h2>
          <span className="bg-green-100 text-green-700 text-[9px] font-bold px-2 py-1 rounded-full flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div> 8 open
          </span>
        </div>
      </div>
      <div className="p-3 space-y-2">
        {venues.map((v, i) => (
          <div key={i} className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100">
            <div className="flex justify-between items-start mb-1">
              <div className="font-bold text-slate-800 flex items-center gap-2 text-xs">
                <div className={`w-2 h-2 rounded-full ${v.color}`}></div>{v.name}
              </div>
              <div className="text-slate-400 font-bold text-[10px]">{v.price}</div>
            </div>
            <div className="text-[10px] text-slate-500 ml-4 mb-2 flex items-start gap-1">
              <MapPin className="w-3 h-3 mt-[1px] shrink-0 text-slate-400" /> {v.addr}, Frisco
            </div>
            <div className="ml-4 flex items-center justify-between bg-blue-50/50 text-blue-700 px-2 py-2 rounded-xl mb-2 border border-blue-100">
              <div className="flex items-center gap-1.5 text-[11px] font-medium"><Phone className="w-3 h-3" /> {v.phone}</div>
              <span className="text-[8px] uppercase font-bold text-blue-500 bg-blue-100 px-1.5 py-0.5 rounded">Call</span>
            </div>
            <div className="ml-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500">Bar &bull; &#9733; {v.rating}</span>
                <span className={`${v.crowd === 'high' ? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-amber-100 text-amber-700'} text-[8px] font-bold px-1.5 py-0.5 rounded uppercase`}>
                  {v.crowd === 'high' ? 'high crowd' : 'moderate'}
                </span>
              </div>
              <button className="bg-blue-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-full shadow flex items-center gap-1">
                <Navigation className="w-3 h-3" /> Go
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BriefingScreen() {
  return (
    <div className="pb-20 bg-slate-50 min-h-full">
      <div className="bg-gradient-to-br from-blue-600 to-violet-600 pt-8 pb-14 px-4 text-white rounded-b-[2rem] shadow-md">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 p-2 rounded-xl"><FileText className="w-5 h-5 text-white" /></div>
          <div>
            <h2 className="font-bold text-base leading-tight">Daily Strategy Report</h2>
            <p className="text-[10px] text-blue-200 mt-0.5">Generated for your shift</p>
          </div>
        </div>
      </div>
      <div className="p-3 space-y-3 -mt-8 relative z-10">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
          <h3 className="text-[9px] font-bold text-slate-500 mb-3 uppercase tracking-widest flex items-center gap-2"><Cloud className="w-3 h-3" /> 4-Hour Forecast</h3>
          <div className="flex justify-between items-center text-center px-1">
            {['7 PM','8 PM','9 PM','10 PM'].map((t, i) => (
              <div key={i} className="flex flex-col items-center">
                <div className="text-[10px] text-slate-500 mb-2 font-medium">{t}</div>
                <Cloud className={`w-5 h-5 mb-2 ${i > 1 ? 'text-slate-300' : 'text-slate-400'}`} />
                <div className="font-bold text-xs text-slate-800">74&deg;</div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border-l-4 border-l-orange-500 border border-slate-100 p-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-orange-100 text-orange-700 text-[8px] font-bold px-2 py-1 rounded-bl-xl uppercase">High Impact</div>
          <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2 mb-2"><Car className="w-3.5 h-3.5 text-orange-500" /> Traffic</h3>
          <p className="text-[11px] text-slate-600 leading-relaxed">Heavy congestion. <strong className="text-orange-600 bg-orange-50 px-1 rounded">32 incidents</strong> active. Delays on I-35E S and DNT.</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
          <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2 mb-3"><Plane className="w-3.5 h-3.5 text-blue-500" /> Airports</h3>
          <div className="space-y-2">
            <div className="border border-red-100 bg-red-50/30 rounded-xl p-3">
              <div className="flex justify-between items-start mb-1"><div className="font-bold text-xs text-slate-900">DFW</div><span className="bg-red-100 text-red-700 text-[8px] font-bold px-2 py-0.5 rounded">BUSY</span></div>
              <p className="text-[11px] text-slate-700 mt-2 bg-white p-2 rounded border border-red-50">40+ flights delayed.</p>
            </div>
            <div className="border border-amber-100 bg-amber-50/30 rounded-xl p-3">
              <div className="flex justify-between items-start mb-1"><div className="font-bold text-xs text-slate-900">DAL</div><span className="bg-amber-100 text-amber-700 text-[8px] font-bold px-2 py-0.5 rounded">MODERATE</span></div>
              <p className="text-[11px] text-slate-700 mt-2 bg-white p-2 rounded border border-amber-50">Not optimal for staging.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MapScreen() {
  return (
    <div className="h-full flex flex-col bg-slate-100 pb-14">
      <div className="bg-white pt-8 pb-3 px-3 shrink-0 shadow-sm z-10 relative border-b border-slate-200">
        <div className="flex justify-between items-center">
          <div className="font-bold text-base text-slate-900 flex items-center gap-2">
            <div className="p-1 bg-green-100 rounded-lg"><Map className="w-3.5 h-3.5 text-green-600" /></div>Strategic Map
          </div>
          <div className="bg-slate-100 px-2 py-1 rounded-full text-[10px] text-slate-600 font-medium">Frisco, TX</div>
        </div>
      </div>
      <div className="relative flex-1 bg-[#eef0e8] overflow-hidden">
        <div className="absolute top-0 bottom-0 left-1/3 w-4 bg-white rotate-12 opacity-80"></div>
        <div className="absolute top-1/4 bottom-0 left-1/2 w-5 bg-yellow-100 -rotate-12 opacity-90 border-x border-yellow-200"></div>
        <div className="absolute top-1/2 left-0 right-0 h-4 bg-white -rotate-6 opacity-80"></div>
        <div className="absolute top-0 bottom-0 left-[55%] w-1.5 bg-orange-500/40 -rotate-12 blur-[1px]"></div>
        <div className="absolute top-1/3 bottom-1/3 left-[55%] w-1.5 bg-red-500/60 -rotate-12 blur-[1px]"></div>
        <div className="absolute top-4 left-4 bg-white rounded-xl shadow-lg flex overflow-hidden text-[10px] font-bold border border-slate-200">
          <button className="px-3 py-2 bg-white text-slate-900 border-r border-slate-200">Map</button>
          <button className="px-3 py-2 bg-slate-50 text-slate-500">Satellite</button>
        </div>
        <div className="absolute top-[35%] left-[40%] flex flex-col items-center">
          <div className="bg-violet-600 text-white p-2 rounded-full shadow-lg border-2 border-white z-10"><MapPin className="w-4 h-4" /></div>
          <div className="w-0 h-0 border-l-[8px] border-r-[8px] border-t-[10px] border-l-transparent border-r-transparent border-t-violet-600 -mt-1"></div>
        </div>
        <div className="absolute top-[60%] right-[30%] flex flex-col items-center scale-90">
          <div className="bg-orange-500 text-white p-1.5 rounded-full shadow-lg border-2 border-white z-10 animate-pulse"><TrendingUp className="w-4 h-4" /></div>
        </div>
        <div className="absolute top-[50%] right-[35%] flex flex-col items-center scale-75 opacity-80">
          <div className="bg-orange-500 text-white p-1.5 rounded-full shadow-lg border-2 border-white z-10"><TrendingUp className="w-4 h-4" /></div>
        </div>
        <div className="absolute top-[75%] left-[25%]">
          <div className="w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-lg relative">
            <div className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-75"></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IntelScreen() {
  return (
    <div className="pb-20 bg-amber-50/30 min-h-full">
      <div className="bg-gradient-to-br from-blue-600 to-violet-600 pt-8 pb-5 px-4 text-white text-center shadow-md z-10 relative">
        <h2 className="font-bold text-base">Market Intelligence</h2>
        <p className="text-[10px] text-blue-200 mt-1">Location-aware insights & tools</p>
      </div>
      <div className="p-3 space-y-3 mt-2">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <div className="font-bold text-xs text-slate-800">Demand Rhythm</div>
            <div className="bg-slate-100 text-slate-600 text-[9px] px-2 py-1 rounded font-bold">Thu</div>
          </div>
          <div className="flex items-end gap-[3px] h-24 border-b border-slate-100 pb-2">
            {[2,3,5,8,12,15,10,8,12,20,25,22,18,12,8,5].map((h, i) => (
              <div key={i} className={`flex-1 rounded-t-sm ${h > 18 ? 'bg-orange-400' : h > 10 ? 'bg-amber-300' : 'bg-green-300'}`} style={{ height: `${(h/25)*100}%` }}></div>
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-slate-400 mt-2 font-medium"><span>12a</span><span>6a</span><span>12p</span><span>6p</span></div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div className="font-bold text-xs text-slate-800 mb-3">Strategic Principles</div>
          <div className="bg-green-50/50 border border-green-200 rounded-xl p-3">
            <div className="flex justify-between items-center mb-2">
              <div className="font-bold text-green-800 text-xs flex items-center gap-2">The "Sniper"</div>
              <span className="bg-green-500 text-white text-[8px] font-bold px-2 py-0.5 rounded-full uppercase">Best</span>
            </div>
            <div className="text-[10px] text-green-700 mb-2 font-medium">Best for Sprawl Cities & Airports</div>
            <ul className="text-[11px] text-slate-600 space-y-1.5 pl-4 list-disc marker:text-green-500 leading-tight">
              <li>Decline short trips (under $10).</li>
              <li>Position in wealthy suburbs at 4 AM.</li>
              <li>Use Destination Filters to return to hub.</li>
            </ul>
          </div>
        </div>
        <div className="bg-slate-900 text-white p-4 rounded-xl shadow-lg border border-slate-800">
          <div className="font-bold text-xs flex items-center gap-2 mb-1"><AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Deadhead Calculator</div>
          <div className="text-[10px] text-slate-400 mb-4">Should I take this trip?</div>
          <div>
            <div className="flex justify-between text-[9px] text-slate-400 mb-2 uppercase tracking-wider font-bold"><span>Trip Duration</span><span className="text-white">45 mins</span></div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden"><div className="w-1/2 h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full"></div></div>
          </div>
          <button className="w-full bg-white text-slate-900 py-2 rounded-lg font-bold text-xs mt-4 shadow-sm">Analyze Trip</button>
        </div>
      </div>
    </div>
  );
}

function TranslateScreen() {
  return (
    <div className="h-full flex flex-col bg-white pb-14">
      <div className="h-[45%] bg-slate-900 text-white p-5 flex flex-col items-center justify-center rotate-180 border-b-[8px] border-blue-500">
        <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(37,99,235,0.4)]"><Mic className="w-6 h-6 text-white" /></div>
        <p className="text-xl font-bold mb-2 text-center">Tap the mic to speak.</p>
        <p className="text-sm text-slate-400 text-center">Your driver is using a translator.</p>
        <Globe className="w-6 h-6 text-slate-700 mt-6 opacity-50" />
      </div>
      <div className="bg-blue-50 text-blue-800 text-[10px] font-bold px-4 py-2 flex items-center justify-center gap-2 border-b border-blue-100 shadow-sm z-10">
        <span className="bg-white px-2 py-0.5 rounded shadow-sm">EN</span>
        <ChevronRight className="w-3 h-3 text-blue-400" />
        <Globe className="w-3 h-3 text-blue-500" />
        <span>Auto-detecting...</span>
      </div>
      <div className="flex-1 p-4 flex flex-col items-center justify-center bg-slate-50">
        <div className="bg-white w-full rounded-2xl p-5 shadow-sm border border-slate-200 text-center flex flex-col items-center">
          <Globe className="w-8 h-8 text-slate-300 mb-3" />
          <h3 className="font-bold text-slate-800 mb-2 text-base">Rider Translation</h3>
          <p className="text-[12px] text-slate-500 max-w-[200px] mb-6 leading-relaxed">Tap the mic. Rider sees translated text on the top half.</p>
          <button className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-200 text-sm"><Mic className="w-4 h-4" /> Speak English</button>
        </div>
      </div>
    </div>
  );
}

function ConciergeScreen() {
  return (
    <div className="pb-20 bg-slate-50 min-h-full">
      <div className="bg-gradient-to-br from-blue-600 to-violet-600 pt-8 pb-10 px-4 text-white text-center rounded-b-[2rem] shadow-md">
        <h2 className="font-bold text-base">In-Car Concierge</h2>
        <p className="text-[10px] text-blue-200 mt-1">Elevate the rider experience</p>
      </div>
      <div className="p-3 -mt-6 relative z-10 space-y-3">
        <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-4 text-center">
          <div className="flex justify-center mb-3">
            <div className="bg-teal-50 text-teal-600 px-3 py-1 rounded-full text-[9px] font-bold flex items-center gap-1.5 uppercase border border-teal-100">
              <QrCode className="w-3 h-3" /> Your Concierge QR
            </div>
          </div>
          <p className="text-[11px] text-slate-600 mb-4 leading-relaxed px-2">Passengers scan for your custom venue recommendations.</p>
          <div className="bg-white p-3 rounded-2xl border-2 border-slate-100 shadow-sm inline-block mb-4 ring-4 ring-slate-50">
            <svg width="100%" height="100%" viewBox="0 0 21 21" shapeRendering="crispEdges" className="w-24 h-24">
              <path fill="#0f172a" d="M0,0 h7v7 h-7z M1,1 v5h5 v-5z M2,2 h3v3 h-3z" />
              <path fill="#0f172a" d="M14,0 h7v7 h-7z M15,1 v5h5 v-5z M16,2 h3v3 h-3z" />
              <path fill="#0f172a" d="M0,14 h7v7 h-7z M1,15 v5h5 v-5z M2,16 h3v3 h-3z" />
              <path fill="#0f172a" d="M8,0h2v1h-2z M11,0h1v2h-1z M13,0h1v1h-1z M8,2h1v2h-1z M10,2h3v1h-3z M13,3h1v2h-1z M8,5h2v1h-2z M11,4h1v2h-1z M8,7h6v1h-6z M15,8h6v1h-6z M0,8h6v1h-6z M8,9h1v1h-1z M10,9h2v1h-2z M13,9h1v2h-1z M15,10h2v1h-2z M18,10h3v1h-3z M0,10h2v1h-2z M3,10h3v1h-3z M8,11h2v2h-2z M11,11h1v2h-1z M13,12h2v1h-2z M16,12h1v1h-1z M18,12h3v1h-3z M0,12h3v1h-3z M4,12h2v2h-2z M8,14h2v1h-2z M11,14h1v1h-1z M13,14h1v2h-1z M15,14h2v1h-2z M18,14h1v1h-1z M20,14h1v2h-1z M8,16h1v2h-1z M10,16h2v1h-2z M13,16h1v1h-1z M15,16h1v2h-1z M17,16h2v1h-2z M20,16h1v1h-1z M8,19h2v1h-2z M11,18h2v1h-2z M14,18h1v1h-1z M16,18h2v1h-2z M19,18h2v1h-2z M8,20h1v1h-1z M10,20h3v1h-3z M14,20h2v1h-2z M17,20h1v1h-1z M19,20h2v1h-2z" />
            </svg>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button className="border-2 border-slate-200 text-slate-700 py-2 rounded-xl text-[12px] font-bold hover:bg-slate-50">Copy Link</button>
            <button className="bg-slate-100 text-slate-700 py-2 rounded-xl text-[12px] font-bold hover:bg-slate-200">Regenerate</button>
          </div>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-slate-500 font-bold mb-2 uppercase tracking-wider">Passenger view:</p>
          <div className="bg-slate-900 rounded-2xl p-4 text-left shadow-xl border border-slate-800">
            <div className="flex items-center gap-3 mb-3 border-b border-slate-800 pb-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white flex items-center justify-center font-bold text-sm shadow-lg">M</div>
              <div><div className="text-white text-xs font-bold">Melody</div><div className="text-slate-400 text-[10px]">Your Driver</div></div>
            </div>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              <strong className="text-white text-xs block mb-2">Drinks & Entertainment:</strong>
              <span className="block mb-1">&bull; <strong className="text-white">Truck Yard:</strong> Outdoor venue, food trucks, tiki bar.</span>
              <span className="block">&bull; <strong className="text-white">Red Phone Booth:</strong> Speakeasy in Grandscape.</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
