// client/src/pages/welcome/PublicDonatePage.tsx
// 2026-05-15: Public donate page reachable from the /welcome iPad kiosk's farewell QR.
// Uses Vecto Pilot brand colors (blue-600 → violet-600 gradient, gold accents).
// Reuses the existing Square link from /co-pilot/donate and the cost data.
//
// PUBLIC route, no auth. Riders scan the QR on the farewell slide and land here.

import { Heart, DollarSign, Sparkles, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

const SQUARE_DONATE_URL = 'https://square.link/u/6PbBaNCi?src=sheet';

// ── Operating costs (sourced from /co-pilot/donate Out-of-Pocket Expenses) ─
const COSTS = [
  { label: 'Claude Opus (Strategy + Reasoning)', amount: '$800+/mo' },
  { label: 'Gemini 3.1 Pro (Briefing + Events)',  amount: '$500+/mo' },
  { label: 'GPT-5 (Tactical Consolidation)',      amount: '$700+/mo' },
  { label: 'Google Maps + Places API',            amount: '$200+/mo' },
  { label: 'OpenAI Realtime Voice',               amount: '$150+/mo' },
  { label: 'Cloud Hosting + Database',            amount: '$120+/mo' },
];

// ── Future scope — placeholder bullets, Melody to refine ─────────────────
const FUTURE_SCOPE = [
  'Driver app expansion — multi-platform tactical guidance for Lyft, DoorDash, and Instacart',
  'Multi-language rider concierge (Spanish, Vietnamese, Mandarin)',
  'Real-time event surge prediction with hyperlocal traffic intelligence',
  'Driver wellness — break reminders, fatigue detection, earnings goal tracking',
  'Open-source community driver intel network — crowd-sourced safe staging spots',
];

export default function PublicDonatePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Hero */}
      <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-violet-700 text-white">
        <div className="max-w-4xl mx-auto px-5 py-10 md:px-8 md:py-16">
          <Link
            to="/welcome"
            className="inline-flex items-center gap-2 text-blue-100 hover:text-white text-sm md:text-base mb-6 transition-colors"
          >
            <ArrowLeft size={16} /> Back to welcome
          </Link>
          <div className="flex items-start gap-4 md:gap-6">
            <div className="p-3 md:p-4 rounded-2xl bg-white/15 backdrop-blur-sm shrink-0">
              <Heart className="w-8 h-8 md:w-12 md:h-12" fill="currentColor" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl md:text-5xl font-extrabold mb-2 md:mb-4 leading-tight">
                Help Keep Vecto Pilot Alive
              </h1>
              <p className="text-blue-100 text-sm md:text-lg mb-5 md:mb-8 leading-relaxed">
                Vecto Pilot is built and maintained by a single rideshare driver to help other
                drivers earn more, drive safer, and get families home. Your support directly
                covers the AI APIs, hosting, and tools that keep this running.
              </p>
              <a
                href={SQUARE_DONATE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 md:gap-3 bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-bold px-6 md:px-8 py-3 md:py-4 rounded-full shadow-xl transition-transform hover:scale-105 active:scale-95 text-base md:text-xl"
              >
                <Heart size={20} /> Donate via Square
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Operating costs */}
      <section className="max-w-4xl mx-auto px-5 py-8 md:px-8 md:py-12">
        <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-6">
          <DollarSign className="w-6 h-6 md:w-7 md:h-7 text-blue-600" />
          <h2 className="text-xl md:text-3xl font-bold text-slate-900">What it costs to run</h2>
        </div>
        <div className="bg-white rounded-2xl shadow-md border border-blue-100 p-5 md:p-8 space-y-3 md:space-y-4">
          {COSTS.map(c => (
            <div key={c.label} className="flex justify-between items-center pb-2 md:pb-3 border-b border-slate-100 last:border-b-0 last:pb-0">
              <span className="text-slate-700 text-sm md:text-base">{c.label}</span>
              <span className="font-mono font-semibold text-blue-700 text-sm md:text-base shrink-0 ml-3">
                {c.amount}
              </span>
            </div>
          ))}
          <div className="flex justify-between items-center pt-3 md:pt-4 border-t-2 border-blue-200 mt-2">
            <span className="font-bold text-slate-900 text-base md:text-lg">Roughly per month</span>
            <span className="font-mono font-bold text-violet-700 text-base md:text-lg">$2,470+</span>
          </div>
        </div>
        <p className="text-xs md:text-sm text-slate-500 mt-3 md:mt-4 italic">
          Costs scale with usage. Heavy briefing days or high event-discovery volume can push the AI bill higher.
        </p>
      </section>

      {/* Future scope */}
      <section className="max-w-4xl mx-auto px-5 pb-10 md:px-8 md:pb-16">
        <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-6">
          <Sparkles className="w-6 h-6 md:w-7 md:h-7 text-violet-600" />
          <h2 className="text-xl md:text-3xl font-bold text-slate-900">What's coming next</h2>
        </div>
        <div className="bg-white rounded-2xl shadow-md border border-violet-100 p-5 md:p-8">
          <ul className="space-y-3 md:space-y-4">
            {FUTURE_SCOPE.map(f => (
              <li key={f} className="flex gap-3 md:gap-4 text-slate-700 text-sm md:text-base">
                <span className="w-2 h-2 mt-2 rounded-full bg-gradient-to-br from-blue-600 to-violet-600 shrink-0" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA repeat */}
      <section className="max-w-4xl mx-auto px-5 pb-12 md:px-8 md:pb-16 text-center">
        <a
          href={SQUARE_DONATE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 md:gap-3 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white font-bold px-6 md:px-10 py-3 md:py-5 rounded-full shadow-xl transition-transform hover:scale-105 active:scale-95 text-base md:text-xl"
        >
          <Heart size={20} fill="currentColor" /> Donate via Square
        </a>
        <p className="text-xs md:text-sm text-slate-500 mt-3 md:mt-4">
          Every dollar helps keep this running. Thank you. 💙
        </p>
      </section>
    </div>
  );
}
