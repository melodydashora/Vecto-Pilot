// client/src/pages/welcome/slides.tsx
// 2026-05-15: Slide content + per-kind renderers for the public /welcome iPad kiosk.
// All slides are full-viewport (h-screen w-screen) and designed for landscape iPad.

import { useState, type FC, type ReactNode } from 'react';
import {
  Coffee, Wind, Plug, Zap, HeartPulse, Car, Star, ShieldCheck, BadgeCheck,
  TrendingDown, Quote, Snowflake,
} from 'lucide-react';

// ── Theme tokens — 2026-05-15: re-skinned from the PDF cream/burgundy/navy
// palette to Vecto Pilot brand (blue / violet / amber) so the welcome page
// matches the rest of the app (LandingPage, GlobalHeader, /co-pilot routes).
// Token names kept the same so all 22 slides re-skin automatically without
// per-slide edits — just the hex values change here.
export const T = {
  navy:     '#1e40af',  // blue-800   (was #1f2238 deep ink)
  navyDeep: '#172554',  // blue-950   (was #13152b near-black)
  cream:    '#f8fafc',  // slate-50   (was #f7f2ec warm cream)
  rose:     '#a78bfa',  // violet-400 (was #d99696 dusty rose)
  burgundy: '#1d4ed8',  // blue-700   (was #7a4a5e wine)
  slate:    '#475569',  // slate-600  (kept neutral; was #4b556d)
  terracotta:'#f59e0b', // amber-500  (was #c47c5e terracotta — now gold accent)
  cardCream:'#eff6ff',  // blue-50    (was #fdf9f3 cream — now soft blue card bg)
};

// ── Slide registry: order defines navigation ──────────────────────────────
export const SLIDE_KEYS = [
  'hero',
  'autismNote',
  'stats',
  'toc',
  'defining',
  'housekeeping',
  'vehicleReqs',
  'driverReqs',
  'didYouKnow',
  'uberXLComfort',
  'uberXXL',
  'taxisVs',
  'earnings',
  'ratingsMatter',
  'starsMilitary',
  'aiCoPilot',
  'quizIntro',
  'quizDoors',
  'quizExperience',
  'quizStars',
  'quizMilitary',
  'scoreboard',
  'farewell',
] as const;
export type SlideKey = typeof SLIDE_KEYS[number];

// ── Quiz state contract ───────────────────────────────────────────────────
export interface QuizSlideProps {
  selected: string | null;
  onAnswer: (id: SlideKey, choice: string, isCorrect: boolean) => void;
}

// ── Shared layout primitives ──────────────────────────────────────────────
const SlideShell: FC<{
  theme: 'navy' | 'cream' | 'gradient';
  children: ReactNode;
  align?: 'center' | 'start';
}> = ({ theme, children, align = 'start' }) => {
  const bg =
    theme === 'navy'
      ? { backgroundColor: T.navy, color: T.cream }
      : theme === 'cream'
      ? { backgroundColor: T.cream, color: T.navyDeep }
      : { background: `linear-gradient(135deg, ${T.navyDeep} 0%, ${T.burgundy} 70%, ${T.rose} 100%)`, color: T.cream };
  return (
    <div
      className={`h-full w-full flex flex-col ${align === 'center' ? 'items-center justify-center' : 'justify-center'} px-5 py-6 md:px-16 md:py-14 overflow-y-auto md:overflow-hidden`}
      style={bg}
    >
      {children}
    </div>
  );
};

const TitleBlock: FC<{ eyebrow?: string; title: string; sub?: string; underline?: 'rose' | 'navy' }> = ({
  eyebrow, title, sub, underline = 'rose'
}) => (
  <div className="mb-4 md:mb-8 max-w-5xl">
    {eyebrow && (
      <div className="text-xs md:text-xl uppercase tracking-[0.2em] mb-2 md:mb-3 opacity-80" style={{ color: T.burgundy }}>
        {eyebrow}
      </div>
    )}
    <h1 className="font-serif font-bold text-3xl md:text-7xl leading-tight">{title}</h1>
    <div
      className="h-1 w-20 md:w-32 mt-3 md:mt-5"
      style={{ backgroundColor: underline === 'rose' ? T.rose : T.navy }}
    />
    {sub && <p className="text-lg md:text-3xl mt-3 md:mt-5 opacity-85">{sub}</p>}
  </div>
);

// ── 1. Hero ───────────────────────────────────────────────────────────────
// 2026-05-15: HONK button added. Tapping shakes the slide container + plays
// a 2-tone horn (via onHonk callback wired from WelcomePage).
export const SlideHero: FC<{ onHonk?: () => void }> = ({ onHonk }) => (
  <SlideShell theme="gradient" align="center">
    <div className="text-center animate-[fadeUp_900ms_ease-out]">
      <div className="relative inline-block mb-6 md:mb-12">
        <div
          className="text-7xl md:text-[10rem] leading-none drop-shadow-2xl"
          style={{ filter: 'drop-shadow(0 0 30px rgba(217,150,150,0.6))' }}
        >
          ❤️
        </div>
        <Car
          className="absolute -bottom-3 md:-bottom-6 left-1/2 -translate-x-1/2 w-16 h-16 md:w-[120px] md:h-[120px]"
          strokeWidth={1.5}
          style={{ color: T.cream }}
        />
      </div>
      <div className="h-1 w-24 md:w-40 mx-auto mb-3 md:mb-6" style={{ backgroundColor: T.rose }} />
      <h1 className="font-serif font-black text-4xl md:text-8xl tracking-tight">WELCOME TO MY CAR</h1>
      <p className="text-lg md:text-3xl mt-3 md:mt-6 italic opacity-90">Your guide to a great ride experience</p>
      {onHonk && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onHonk(); }}
          className="mt-6 md:mt-10 inline-flex items-center gap-2 md:gap-3 px-5 md:px-8 py-3 md:py-4 rounded-full text-lg md:text-2xl font-bold transition-transform hover:scale-105 active:scale-95 shadow-2xl"
          style={{ backgroundColor: '#facc15', color: '#1a1a2e' }}
        >
          📢 HONK HORN
        </button>
      )}
      <p className="text-sm md:text-xl mt-6 md:mt-10 opacity-70">Tap anywhere · say "next" · swipe →</p>
    </div>
  </SlideShell>
);

// ── 1b. A Note from Your Driver (autism disclosure — slide #2, sets the tone) ─
// 2026-05-15: promoted from "card #3 inside Housekeeping" to a dedicated full-bleed slide.
export const SlideAutismNote: FC = () => (
  <SlideShell theme="navy" align="center">
    <div className="text-center max-w-4xl animate-[fadeUp_900ms_ease-out]">
      <div className="text-5xl md:text-7xl mb-4 md:mb-8" aria-hidden>💛</div>
      <div className="h-1 w-20 md:w-32 mx-auto mb-4 md:mb-8" style={{ backgroundColor: T.terracotta }} />
      <div className="font-serif text-lg md:text-3xl italic opacity-80 mb-3 md:mb-6">A note from your driver</div>
      <h1 className="font-serif font-bold text-3xl md:text-6xl leading-tight mb-5 md:mb-10" style={{ color: T.cream }}>
        I have autism.
      </h1>
      <p className="text-lg md:text-3xl leading-relaxed opacity-90 mb-3 md:mb-6">
        I may not always pick up on social cues — so please communicate your needs directly.
      </p>
      <p className="text-base md:text-2xl leading-relaxed opacity-75">
        Tell me if you're cold, want quiet, want music, or anything else. I'll do my best to make your ride exactly how you want it.
      </p>
    </div>
  </SlideShell>
);

// ── 2. Stats ──────────────────────────────────────────────────────────────
export const SlideStats: FC = () => {
  const big = [
    { value: '4.98', label: 'Star Rating', sub: 'out of 5.0 stars' },
    { value: '5,200+', label: 'Total Trips', sub: 'rides completed' },
  ];
  const small = [
    { value: '< 1%', label: 'Cancellation Rate', sub: 'industry leading' },
    { value: '95%',  label: 'Acceptance Rate', sub: 'always ready to drive' },
    { value: '98%',  label: 'Satisfaction',    sub: 'happy passengers' },
  ];
  return (
    <SlideShell theme="navy">
      <TitleBlock eyebrow="Verified Uber driver statistics" title="My Current Stats" />
      <div className="grid grid-cols-2 gap-3 md:gap-6 mb-3 md:mb-6">
        {big.map(s => (
          <div key={s.label} className="rounded-2xl p-4 md:p-10" style={{ backgroundColor: T.burgundy }}>
            <div className="font-serif font-bold text-3xl md:text-7xl">{s.value}</div>
            <div className="text-base md:text-2xl font-semibold mt-1 md:mt-3">{s.label}</div>
            <div className="text-sm md:text-xl opacity-80 mt-1 md:mt-2">{s.sub}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 md:gap-6">
        {small.map(s => (
          <div key={s.label} className="rounded-2xl p-3 md:p-8" style={{ backgroundColor: T.slate }}>
            <div className="font-serif font-bold text-2xl md:text-5xl">{s.value}</div>
            <div className="text-sm md:text-xl font-semibold mt-1 md:mt-2">{s.label}</div>
            <div className="text-xs md:text-base opacity-80 mt-1" style={{ color: T.rose }}>{s.sub}</div>
          </div>
        ))}
      </div>
    </SlideShell>
  );
};

// ── 3. TOC ────────────────────────────────────────────────────────────────
export const SlideTOC: FC<{ onJump: (key: SlideKey) => void }> = ({ onJump }) => {
  const items: { num: string; title: string; sub: string; tone: string; key: SlideKey }[] = [
    { num: '01', title: 'Defining the Ride', sub: 'What rideshare is and how it works',  tone: T.burgundy,   key: 'defining' },
    { num: '02', title: 'Housekeeping Rules', sub: 'Guidelines for a comfortable ride',  tone: T.slate,       key: 'housekeeping' },
    { num: '03', title: 'Star Ratings',       sub: 'How the rating system works',         tone: T.burgundy,   key: 'ratingsMatter' },
    { num: '04', title: 'Tips & Etiquette',   sub: 'Making the most of your experience', tone: T.terracotta, key: 'didYouKnow' },
    { num: '05', title: 'Additional Help',    sub: 'Resources and support options',       tone: T.burgundy,   key: 'farewell' },
  ];
  return (
    <SlideShell theme="cream">
      <TitleBlock eyebrow="Here's what we'll cover" title="What is Ride Share?" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-6 mt-3 md:mt-4">
        {items.map(it => (
          <button
            key={it.num}
            onClick={() => onJump(it.key)}
            className="rounded-2xl p-4 md:p-7 text-left transition-transform hover:scale-105 active:scale-95 bg-white shadow-lg border-l-8 md:min-h-[180px]"
            style={{ borderLeftColor: it.tone }}
          >
            <div className="flex items-start gap-3 md:gap-4">
              <div
                className="w-10 h-10 md:w-14 md:h-14 rounded-full flex items-center justify-center text-white font-serif font-bold text-lg md:text-2xl shrink-0"
                style={{ backgroundColor: it.tone }}
              >
                {it.num}
              </div>
              <div>
                <div className="font-serif font-bold text-xl md:text-3xl" style={{ color: T.navyDeep }}>{it.title}</div>
                <div className="text-base md:text-xl mt-1 md:mt-2 opacity-75">{it.sub}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </SlideShell>
  );
};

// ── 4. Defining the Ride ──────────────────────────────────────────────────
export const SlideDefining: FC = () => (
  <SlideShell theme="cream">
    <TitleBlock eyebrow="What is ride sharing?" title="Defining the Ride" />
    <ul className="space-y-4 md:space-y-7 text-base md:text-3xl max-w-6xl mt-3 md:mt-4">
      <li className="flex gap-3 md:gap-5">
        <span className="mt-2 md:mt-3 w-2 h-2 md:w-3 md:h-3 rounded-full shrink-0" style={{ backgroundColor: T.burgundy }} />
        <span>Ride sharing is a transportation service where users request rides from nearby drivers using an app like <b>Uber</b> or <b>Lyft</b>.</span>
      </li>
      <li className="flex gap-3 md:gap-5">
        <span className="mt-2 md:mt-3 w-2 h-2 md:w-3 md:h-3 rounded-full shrink-0" style={{ backgroundColor: T.burgundy }} />
        <span>Platforms <b style={{ color: T.burgundy }}>don't pay drivers</b> for their car, equipment, cleaning, amenities, or gas — and can take up to <b style={{ color: T.burgundy }}>75% of the fare</b>.</span>
      </li>
      <li className="flex gap-3 md:gap-5">
        <span className="mt-2 md:mt-3 w-2 h-2 md:w-3 md:h-3 rounded-full shrink-0" style={{ backgroundColor: T.burgundy }} />
        <span>Drivers are everyday people — parents, business owners, full-time workers — who maintain their own vehicles and rely on the platform and tips.</span>
      </li>
      <li className="flex gap-3 md:gap-5">
        <span className="mt-2 md:mt-3 w-2 h-2 md:w-3 md:h-3 rounded-full shrink-0" style={{ backgroundColor: T.burgundy }} />
        <span>Star ratings are <b style={{ color: T.burgundy }}>two-way</b> — even a 4-star rating can mean removal from the platform for both drivers and riders.</span>
      </li>
    </ul>
  </SlideShell>
);

// ── 5. Make Yourself Comfortable (merged Housekeeping + Amenities) ────────
// 2026-05-15: autism card extracted to its own slide (SlideAutismNote). Remaining
// housekeeping rules (Food, Noise) combined with the 5 amenities. Amenities are
// tap-to-expand accordion buttons — satisfies the "no idle motion unless clickable" rule.
export const SlideHousekeeping: FC = () => {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // 2026-05-15: photo paths point to client/public/welcome-assets/*. Until the
  // file is saved, the <img>'s onError handler swaps to a "save your photo here"
  // placeholder so the slide degrades gracefully.
  const [photoErrors, setPhotoErrors] = useState<Record<string, boolean>>({});

  const rules = [
    { title: 'Food & Drinks', body: 'Please keep coffee lids on and avoid eating food in the car.',                                  tone: T.burgundy },
    { title: 'Noise & Calls', body: 'Let me know if you need quiet time or plan to make calls. Use headphones when possible.',       tone: T.slate },
  ];

  const amenities = [
    { icon: Coffee,     title: 'Mints',                body: 'Right outer pocket of the seatback organizer in front of you. Help yourself!',                                                                                                photo: '/welcome-assets/seatback-organizer.jpg' },
    { icon: Wind,       title: 'Cabin Air Control',    body: 'Rear climate panel with temperature, fan speed, and AUTO mode — independent from the front cabin.',                                                                            photo: '/welcome-assets/cabin-air-control.jpg' },
    { icon: Plug,       title: 'Headrest Chargers',    body: 'One on the driver headrest and one on the passenger headrest — right in front of you. Lightning (iPhone), USB-C, and Micro-USB.',                                              photo: '/welcome-assets/headrest-charger.jpg' },
    { icon: Zap,        title: 'Console Power',        body: 'Two USB-C ports plus a 115V household outlet on the back of the center console — for laptops and anything with a wall plug.',                                                  photo: '/welcome-assets/cabin-air-control.jpg' },
    { icon: HeartPulse, title: 'Motion-Sickness Bags', body: 'Center flap pocket of the seatback organizer — medical grade, discreet, ready if you need one. No questions asked.',                                                            photo: '/welcome-assets/seatback-organizer.jpg' },
  ];

  return (
    <SlideShell theme="navy">
      <TitleBlock eyebrow="Settle in" title="Make Yourself Comfortable" />

      <div className="text-xs md:text-sm uppercase tracking-widest opacity-60 mb-2 md:mb-3 mt-1">House Rules</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-5 mb-4 md:mb-6">
        {rules.map(r => (
          <div
            key={r.title}
            className="rounded-2xl p-3 md:p-5 border-l-8"
            style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderLeftColor: r.tone }}
          >
            <div className="font-serif font-bold text-lg md:text-2xl">{r.title}</div>
            <div className="text-sm md:text-lg mt-1 opacity-85 leading-snug">{r.body}</div>
          </div>
        ))}
      </div>

      <div className="text-xs md:text-sm uppercase tracking-widest opacity-60 mb-2 md:mb-3">Amenities — tap to expand</div>
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 md:gap-4">
        {amenities.map((a, i) => {
          const isExpanded = expandedId === i;
          const startClass = i === 3 ? 'md:col-start-2' : '';
          return (
            <button
              key={a.title}
              type="button"
              onClick={() => setExpandedId(isExpanded ? null : i)}
              className={`md:col-span-2 ${startClass} rounded-2xl p-3 md:p-5 text-left transition-all border-t-4 ${
                isExpanded
                  ? 'bg-white/15 ring-2 scale-[1.02]'
                  : 'bg-white/[0.04] hover:bg-white/[0.08] active:scale-95'
              }`}
              style={{ borderTopColor: T.rose, ...(isExpanded ? { boxShadow: `0 0 0 2px ${T.rose}` } : {}) }}
              aria-expanded={isExpanded}
            >
              <div className="flex items-center gap-2 md:gap-3">
                <a.icon size={24} className="md:hidden" strokeWidth={1.5} style={{ color: T.rose }} />
                <a.icon size={32} className="hidden md:block" strokeWidth={1.5} style={{ color: T.rose }} />
                <div className="font-serif font-bold text-base md:text-xl">{a.title}</div>
              </div>
              <div
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  isExpanded ? 'max-h-[28rem] mt-2 md:mt-3 opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <div className="text-sm md:text-base opacity-90 leading-relaxed">{a.body}</div>
                {a.photo && !photoErrors[a.photo] ? (
                  <img
                    src={a.photo}
                    alt={a.title}
                    loading="lazy"
                    className="mt-3 rounded-xl w-full max-h-40 md:max-h-56 object-cover"
                    onError={() => setPhotoErrors(prev => ({ ...prev, [a.photo!]: true }))}
                  />
                ) : a.photo ? (
                  <div
                    className="mt-3 p-3 rounded-xl border-2 border-dashed text-center text-xs md:text-sm opacity-70"
                    style={{ borderColor: T.rose }}
                  >
                    📸 Save photo at <code className="font-mono">{a.photo}</code>
                  </div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </SlideShell>
  );
};

// ── 6. Vehicle Requirements ───────────────────────────────────────────────
export const SlideVehicleReqs: FC = () => {
  const items = [
    { bold: '4 Doors Minimum',  rest: 'All vehicles must have at least four doors for passenger safety and convenience.' },
    { bold: 'Good Condition',   rest: 'No cosmetic damage, clean interior, and all safety features fully functional.' },
    { bold: 'Model Year',       rest: 'Must be 16 years old or newer (varies by market).' },
    { bold: 'AC & Seatbelts',   rest: 'Working air conditioning and seatbelts for every passenger are required.' },
  ];
  return (
    <SlideShell theme="cream">
      <TitleBlock eyebrow="UberX minimum standards" title="Vehicle Requirements" />
      <ul className="space-y-3 md:space-y-6 text-sm md:text-2xl max-w-6xl mt-3 md:mt-4">
        {items.map(i => (
          <li key={i.bold} className="flex gap-3 md:gap-5">
            <span className="mt-2 md:mt-3 w-2 h-2 md:w-3 md:h-3 rounded-full shrink-0" style={{ backgroundColor: T.navyDeep }} />
            <span><b className="text-base md:text-3xl">{i.bold}</b> <span className="opacity-75">— {i.rest}</span></span>
          </li>
        ))}
      </ul>
    </SlideShell>
  );
};

// ── 8. Driver Requirements ────────────────────────────────────────────────
export const SlideDriverReqs: FC = () => {
  const items = [
    { bold: 'Age 25+',          rest: 'Drivers must be at least 25 years old.' },
    { bold: 'Valid License',    rest: 'At least 1 year of licensed driving history (3 years if under 25).' },
    { bold: 'Background Check', rest: 'Clean driving record and criminal background screening required.' },
    { bold: 'Insurance & Registration', rest: 'Valid auto insurance and vehicle registration.' },
    { bold: 'No Experience Needed', rest: 'No commercial driving license or taxi experience required.' },
  ];
  return (
    <SlideShell theme="navy">
      <TitleBlock eyebrow="Steps and qualifications to get started" title="Driver Requirements" />
      <ul className="space-y-3 md:space-y-5 text-sm md:text-2xl max-w-6xl mt-3 md:mt-4">
        {items.map(i => (
          <li key={i.bold} className="flex gap-3 md:gap-5">
            <span className="mt-2 md:mt-3 w-2 h-2 md:w-3 md:h-3 rounded-full shrink-0" style={{ backgroundColor: T.rose }} />
            <span><b className="text-base md:text-3xl">{i.bold}</b> <span className="opacity-80">— {i.rest}</span></span>
          </li>
        ))}
      </ul>
    </SlideShell>
  );
};

// ── 9. Did You Know — 90% don't tip ───────────────────────────────────────
export const SlideDidYouKnow: FC = () => (
  <SlideShell theme="cream" align="center">
    <div className="w-full max-w-6xl">
      <div className="font-serif font-black text-2xl md:text-6xl mb-2" style={{ color: T.navyDeep }}>
        DID YOU KNOW?
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-10 mt-4 md:mt-10 items-stretch">
        <div className="rounded-3xl p-5 md:p-12 flex flex-col justify-center" style={{ backgroundColor: T.burgundy, color: T.cream }}>
          <div className="font-serif font-black text-5xl md:text-9xl leading-none">90%</div>
          <div className="text-lg md:text-3xl mt-3 md:mt-6">of UberX drivers do not get tipped</div>
          <div className="text-sm md:text-xl mt-3 md:mt-6 italic" style={{ color: T.rose }}>A small tip goes a long way!</div>
        </div>
        <div
          className="rounded-3xl p-5 md:p-12 flex flex-col justify-center text-center"
          style={{ backgroundColor: T.cardCream, color: T.navyDeep, border: `2px solid ${T.rose}` }}
        >
          <Quote className="mx-auto w-12 h-12 md:w-20 md:h-20 opacity-70" strokeWidth={1.5} style={{ color: T.rose }} />
          <p className="text-base md:text-2xl mt-3 md:mt-6 italic leading-relaxed">
            Whether it's a 2010 Toyota Camry or a brand-new car, both can provide UberX rides. Tips are <b style={{ color: T.burgundy }}>always</b> appreciated!
          </p>
        </div>
      </div>
    </div>
  </SlideShell>
);

// ── 10. UberXL & Comfort ──────────────────────────────────────────────────
export const SlideUberXLComfort: FC = () => {
  const items = [
    { bold: 'UberXL',         rest: 'Must seat 6–7+ passengers, 16 years or newer.' },
    { bold: 'Comfort',        rest: 'Midsize or larger, 10 years or newer with extra legroom.' },
    { bold: '4 Doors Required', rest: 'All premium tiers require four-door vehicles.' },
    { bold: 'No Cosmetic Damage', rest: 'Clean interior and exterior with no visible damage.' },
    { bold: 'Higher Earnings', rest: 'Premium tiers earn higher per-trip rates.' },
  ];
  return (
    <SlideShell theme="navy">
      <TitleBlock eyebrow="Premium tier vehicle requirements" title="UberXL & Comfort" />
      <ul className="space-y-3 md:space-y-5 text-sm md:text-2xl max-w-6xl mt-3 md:mt-4">
        {items.map(i => (
          <li key={i.bold} className="flex gap-3 md:gap-5">
            <span className="mt-2 md:mt-3 w-2 h-2 md:w-3 md:h-3 rounded-full shrink-0" style={{ backgroundColor: T.rose }} />
            <span><b className="text-base md:text-3xl">{i.bold}</b> <span className="opacity-80">— {i.rest}</span></span>
          </li>
        ))}
      </ul>
    </SlideShell>
  );
};

// ── 11. UberXXL eligible vehicles ─────────────────────────────────────────
export const SlideUberXXL: FC = () => {
  const vehicles = [
    'Cadillac Escalade ESV', 'Chevrolet Suburban', 'Chevrolet Express (12-15)',
    'Chrysler Pacifica', 'Dodge Grand Caravan', 'Ford Expedition EL / MAX',
    'Ford Transit (12-15)', 'GMC Yukon XL / Denali XL', 'Honda Odyssey',
    'Kia Carnival / Sedona', 'Mercedes-Benz Sprinter', 'Nissan NV (12)',
    'Toyota Sienna',
  ];
  return (
    <SlideShell theme="cream">
      <TitleBlock eyebrow="Approved models for the largest ride tier" title="UberXXL Eligible Vehicles" />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-4 max-w-6xl mt-3 md:mt-4">
        {vehicles.map(v => (
          <div key={v} className="bg-white rounded-xl px-3 py-2 md:px-5 md:py-4 shadow-sm flex items-center gap-2 md:gap-3 border-l-4" style={{ borderLeftColor: T.rose }}>
            <Car className="w-5 h-5 md:w-7 md:h-7 shrink-0" style={{ color: T.burgundy }} />
            <span className="text-xs md:text-xl" style={{ color: T.navyDeep }}>{v}</span>
          </div>
        ))}
      </div>
    </SlideShell>
  );
};

// ── 12. Taxis Then vs Ride-Share Now ──────────────────────────────────────
export const SlideTaxisVs: FC = () => {
  const left = [
    'Long waits — no tracking, had to call or hail',
    'Manual dispatch — phone or curbside only',
    'High fares & medallions — costly licenses',
    'Cash-based, no card before swipe terminals',
  ];
  const right = [
    'On-demand booking — real-time tracking & matching',
    'Smart routing — GPS + algorithms for faster rides',
    'Lower costs — no medallions, fewer fees',
    'Driver flexibility — transparent pricing and ratings',
  ];
  return (
    <SlideShell theme="cream">
      <TitleBlock eyebrow="Then vs Now" title="Taxis vs. Ride-Share" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-8 mt-3 md:mt-4">
        <div className="rounded-2xl p-4 md:p-8" style={{ backgroundColor: '#fff5d6' }}>
          <div className="font-serif font-bold text-lg md:text-3xl mb-2 md:mb-4" style={{ color: '#a07000' }}>🚖 Taxis in the Past</div>
          <ul className="space-y-2 md:space-y-3 text-sm md:text-xl">
            {left.map(t => <li key={t} className="flex gap-2 md:gap-3"><span style={{color:'#a07000'}}>•</span>{t}</li>)}
          </ul>
        </div>
        <div className="rounded-2xl p-4 md:p-8" style={{ backgroundColor: '#e6f0ff' }}>
          <div className="font-serif font-bold text-lg md:text-3xl mb-2 md:mb-4" style={{ color: '#1e4f99' }}>📱 Modern Ride-Share</div>
          <ul className="space-y-2 md:space-y-3 text-sm md:text-xl">
            {right.map(t => <li key={t} className="flex gap-2 md:gap-3"><span style={{color:'#1e4f99'}}>•</span>{t}</li>)}
          </ul>
        </div>
      </div>
      <div className="mt-4 md:mt-6 text-center text-base md:text-2xl">
        And the best part? It's still <b style={{ color: T.burgundy }}>less than half</b> the cost of a traditional taxi.
      </div>
    </SlideShell>
  );
};

// ── 13. Earnings Breakdown ────────────────────────────────────────────────
export const SlideEarnings: FC = () => {
  // 2026-05-15: condensed from 8 rows to 4 (per updated deck). Sum = $21.47 → $8.53 profit.
  const rows = [
    { val: '$8.11', label: 'Gas & Maintenance',     w: 80 },
    { val: '$4.84', label: 'Depreciation',          w: 50 },
    { val: '$4.77', label: 'Insurance & Tolls',     w: 48 },
    { val: '$3.75', label: 'Misc Operating Costs',  w: 38 },
  ];
  return (
    <SlideShell theme="cream">
      <TitleBlock eyebrow="Why drivers depend on tips" title="Ride-Share Driver Profit" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-10 mt-3 md:mt-4">
        <div>
          <div className="flex items-baseline gap-3 md:gap-6 mb-2 md:mb-3">
            <div>
              <div className="font-serif font-bold text-3xl md:text-6xl" style={{ color: T.navyDeep }}>$30.00</div>
              <div className="text-xs md:text-base opacity-70">After platform's cut</div>
            </div>
            <div className="text-2xl md:text-5xl opacity-30">|</div>
            <div>
              <div className="font-serif font-bold text-3xl md:text-6xl" style={{ color: T.burgundy }}>$8.53</div>
              <div className="text-xs md:text-base opacity-70">Driver profit · 28-mile ride</div>
            </div>
          </div>
          <div className="space-y-2 mt-3 md:mt-6">
            {rows.map(r => (
              <div key={r.label} className="flex items-center gap-2 md:gap-3">
                <div className="font-mono text-sm md:text-lg w-16 md:w-20 shrink-0" style={{ color: T.navyDeep }}>{r.val}</div>
                <div className="flex-1 h-6 md:h-8 bg-white rounded relative overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${r.w}%`, backgroundColor: T.rose }} />
                  <span className="absolute inset-0 flex items-center px-2 md:px-3 text-xs md:text-base" style={{ color: T.navyDeep }}>{r.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col justify-center">
          <TrendingDown className="mb-3 md:mb-6 w-12 h-12 md:w-20 md:h-20" style={{ color: T.burgundy }} />
          <p className="text-sm md:text-2xl leading-relaxed">
            For a typical <b>28-mile airport trip</b>, a driver profits approximately <b style={{ color: T.burgundy }}>$8.53 per trip</b>.
          </p>
          <p className="text-sm md:text-2xl leading-relaxed mt-2 md:mt-4">
            This is even less when factoring in the <b style={{ color: T.burgundy }}>unpaid pickup trip</b>.
          </p>
          <p className="text-sm md:text-2xl leading-relaxed mt-2 md:mt-4 italic opacity-80">
            Low ratings for things outside a driver's control can cost them platform access.
          </p>
        </div>
      </div>
    </SlideShell>
  );
};

// ── 14. Why Ratings Matter More ───────────────────────────────────────────
export const SlideRatingsMatter: FC = () => {
  const items = [
    { bold: 'Special background checks', rest: 'allow drivers to take military families to and from their base.' },
    { bold: 'Without eligibility',        rest: 'drivers can only drop families at the security gate — they walk to their barracks.' },
    { bold: 'Lose platform access',       rest: 'low ratings for missed turns, traffic, or subjective issues can deactivate a driver.' },
    { bold: '4 stars is bad',             rest: 'anything less than 5 stars for a safe A-to-B ride should be reserved for serious issues.' },
  ];
  return (
    <SlideShell theme="cream">
      <TitleBlock eyebrow="Special driver eligibility" title="Why Ratings Matter More" />
      <ul className="space-y-3 md:space-y-6 text-sm md:text-2xl max-w-6xl mt-3 md:mt-4">
        {items.map(i => (
          <li key={i.bold} className="flex gap-3 md:gap-5">
            <Star className="shrink-0 mt-1 md:mt-2 w-5 h-5 md:w-7 md:h-7" style={{ color: T.burgundy }} fill={T.burgundy} />
            <span><b style={{ color: T.burgundy }}>{i.bold}</b> <span className="opacity-80">— {i.rest}</span></span>
          </li>
        ))}
      </ul>
    </SlideShell>
  );
};

// ── 15. Stars Matter — Military families ──────────────────────────────────
export const SlideStarsMilitary: FC = () => (
  <SlideShell theme="cream" align="center">
    <div className="text-center max-w-5xl">
      <ShieldCheck className="mx-auto mb-3 md:mb-6 w-16 h-16 md:w-[100px] md:h-[100px]" style={{ color: T.burgundy }} />
      <h2 className="font-serif font-black text-2xl md:text-6xl" style={{ color: T.navyDeep }}>STAR RATINGS MATTER</h2>
      <div className="font-serif text-lg md:text-4xl mt-2 md:mt-4" style={{ color: T.burgundy }}>Your driver is not a chauffeur.</div>
      <div className="h-1 w-20 md:w-32 mx-auto my-4 md:my-8" style={{ backgroundColor: T.rose }} />
      <p className="text-sm md:text-2xl leading-relaxed opacity-85">
        Drivers with special clearance help reunite military families with their loved ones on base. A low rating can take that ability away — affecting the families who depend on those drivers.
      </p>
      <p className="text-sm md:text-2xl mt-3 md:mt-6 italic" style={{ color: T.burgundy }}>
        Only 5 stars means your driver met the standard.
      </p>
    </div>
  </SlideShell>
);

// ── 15b. AI Co-Pilot (Gemini via server proxy) ────────────────────────────
// 2026-05-15: Calls POST /api/welcome-ai/icebreaker and /ask (public, server-side
// proxy — GEMINI_API_KEY never leaves the server). 3-attempt exponential backoff
// on 5xx + network errors. Inputs capped at 500 chars.
async function fetchWelcomeAI(
  path: '/api/welcome-ai/icebreaker' | '/api/welcome-ai/ask',
  body?: object,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data?.ok) return { ok: true, text: String(data.text || '') };
      if (r.status >= 500 && attempt < 2) {
        await new Promise(res => window.setTimeout(res, (2 ** attempt) * 500));
        continue;
      }
      return { ok: false, error: data?.error || `HTTP ${r.status}` };
    } catch {
      if (attempt < 2) {
        await new Promise(res => window.setTimeout(res, (2 ** attempt) * 500));
        continue;
      }
      return { ok: false, error: 'Network error — check your connection.' };
    }
  }
  return { ok: false, error: 'Unexpected error.' };
}

export const SlideAICoPilot: FC = () => {
  const [iceText, setIceText] = useState<string | null>(null);
  const [iceLoading, setIceLoading] = useState(false);
  const [iceError, setIceError] = useState<string | null>(null);

  const [chatInput, setChatInput] = useState('');
  const [chatText, setChatText] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const onIcebreaker = async () => {
    setIceLoading(true); setIceError(null); setIceText(null);
    const r = await fetchWelcomeAI('/api/welcome-ai/icebreaker');
    if (r.ok && r.text) setIceText(r.text);
    else setIceError(r.error || 'Unknown error');
    setIceLoading(false);
  };

  const onAsk = async () => {
    const q = chatInput.trim();
    if (!q) return;
    setChatLoading(true); setChatError(null); setChatText(null);
    const r = await fetchWelcomeAI('/api/welcome-ai/ask', { question: q });
    if (r.ok && r.text) setChatText(r.text);
    else setChatError(r.error || 'Unknown error');
    setChatLoading(false);
  };

  return (
    <SlideShell theme="navy">
      <TitleBlock eyebrow="Powered by Gemini AI" title="AI Co-Pilot" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6 mt-2">
        <div className="rounded-2xl p-4 md:p-6 border border-white/10" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
          <div className="flex items-center gap-2 md:gap-3 mb-2">
            <Snowflake className="w-6 h-6 md:w-8 md:h-8" style={{ color: T.rose }} />
            <div className="font-serif font-bold text-lg md:text-2xl">Break the Ice</div>
          </div>
          <div className="text-sm md:text-lg opacity-80 mb-3 md:mb-4">Generate a friendly conversation starter you can use right now.</div>
          <button
            type="button"
            onClick={onIcebreaker}
            disabled={iceLoading}
            className="w-full py-2 md:py-3 rounded-xl text-base md:text-lg font-bold transition-transform active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ backgroundColor: T.rose, color: T.navyDeep }}
          >
            {iceLoading ? '⏳ Thinking…' : iceText ? '✨ Generate Another' : '✨ Generate Starter'}
          </button>
          {iceText && (
            <div className="mt-3 md:mt-4 p-3 md:p-4 rounded-xl text-base md:text-lg italic" style={{ backgroundColor: 'rgba(217,150,150,0.12)', borderLeft: `4px solid ${T.rose}` }}>
              &ldquo;{iceText}&rdquo;
            </div>
          )}
          {iceError && (
            <div className="mt-3 md:mt-4 p-3 rounded-xl text-sm md:text-base" style={{ backgroundColor: 'rgba(255,80,80,0.12)', color: '#ffc8c8' }}>
              {iceError}
            </div>
          )}
        </div>

        <div className="rounded-2xl p-4 md:p-6 border border-white/10" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
          <div className="flex items-center gap-2 md:gap-3 mb-2">
            <Quote className="w-6 h-6 md:w-8 md:h-8" style={{ color: T.rose }} />
            <div className="font-serif font-bold text-lg md:text-2xl">Ask the Driver</div>
          </div>
          <div className="text-sm md:text-lg opacity-80 mb-3 md:mb-4">Type a question — etiquette, rideshare rules, anything reasonable.</div>
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !chatLoading) onAsk(); }}
            maxLength={500}
            placeholder='e.g., "Can I roll the window down?"'
            className="w-full rounded-xl px-3 md:px-4 py-2 md:py-3 text-base md:text-lg mb-2 md:mb-3 outline-none focus:ring-2"
            style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: T.cream, border: '1px solid rgba(255,255,255,0.15)' }}
          />
          <button
            type="button"
            onClick={onAsk}
            disabled={chatLoading || !chatInput.trim()}
            className="w-full py-2 md:py-3 rounded-xl text-base md:text-lg font-bold transition-transform active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ backgroundColor: T.burgundy, color: T.cream }}
          >
            {chatLoading ? '⏳ Asking…' : '🤖 Ask AI'}
          </button>
          {chatText && (
            <div className="mt-3 md:mt-4 p-3 md:p-4 rounded-xl text-base md:text-lg" style={{ backgroundColor: 'rgba(217,150,150,0.12)', borderLeft: `4px solid ${T.rose}` }}>
              <div className="font-bold text-sm md:text-base mb-1" style={{ color: T.rose }}>Driver says:</div>
              {chatText}
            </div>
          )}
          {chatError && (
            <div className="mt-3 md:mt-4 p-3 rounded-xl text-sm md:text-base" style={{ backgroundColor: 'rgba(255,80,80,0.12)', color: '#ffc8c8' }}>
              {chatError}
            </div>
          )}
        </div>
      </div>
    </SlideShell>
  );
};

// ── 16. Quiz Intro ────────────────────────────────────────────────────────
export const SlideQuizIntro: FC = () => (
  <SlideShell theme="gradient" align="center">
    <div className="text-center animate-[fadeUp_700ms_ease-out]">
      <div className="w-20 h-20 md:w-40 md:h-40 mx-auto rounded-full flex items-center justify-center mb-4 md:mb-8" style={{ backgroundColor: T.rose }}>
        <span className="text-5xl md:text-9xl font-serif font-black text-white">?</span>
      </div>
      <h1 className="font-serif font-black text-4xl md:text-8xl">QUIZ TIME!</h1>
      <p className="text-lg md:text-3xl mt-3 md:mt-6 opacity-90">Think you were paying attention?</p>
      <p className="text-lg md:text-3xl opacity-90">Let's find out with a quick challenge.</p>
      <p className="text-sm md:text-xl mt-5 md:mt-10 opacity-70">4 questions · tap your answer · say "A", "B", "true", or "false"</p>
    </div>
  </SlideShell>
);

// ── Quiz primitive (shared) ───────────────────────────────────────────────
const QuizFrame: FC<{
  eyebrow: string;
  prompt: ReactNode;
  selected: string | null;
  correctChoice: string;
  explanation: string;
  children: ReactNode;
}> = ({ eyebrow, prompt, selected, correctChoice, explanation, children }) => {
  const answered = selected !== null;
  const isCorrect = answered && selected === correctChoice;
  return (
    <SlideShell theme="cream" align="center">
      <div className="w-full max-w-6xl">
        <div className="text-xs md:text-xl uppercase tracking-[0.2em] md:tracking-[0.3em] mb-2 md:mb-3 opacity-60" style={{ color: T.burgundy }}>
          {eyebrow}
        </div>
        <div className="font-serif font-bold text-2xl md:text-5xl text-center mb-6 md:mb-12 leading-tight" style={{ color: T.navyDeep }}>
          {prompt}
        </div>
        {children}
        {answered && (
          <div
            className="mt-5 md:mt-10 rounded-2xl p-4 md:p-7 text-center text-base md:text-2xl border-2 animate-[fadeUp_400ms_ease-out]"
            style={{
              backgroundColor: isCorrect ? '#e8f5e8' : '#fdecec',
              borderColor:     isCorrect ? '#4a7c4a' : '#c0392b',
              color:           isCorrect ? '#2d5a2d' : '#7a2a1c',
            }}
          >
            <b>{isCorrect ? '✓ Correct! ' : '✗ Not quite — '}</b>{explanation}
          </div>
        )}
      </div>
    </SlideShell>
  );
};

// ── 17. Quiz: Doors ───────────────────────────────────────────────────────
export const SlideQuizDoors: FC<QuizSlideProps> = ({ selected, onAnswer }) => {
  const choices = [
    { letter: 'A', text: '2 Doors', tone: T.slate },
    { letter: 'B', text: '4 Doors', tone: T.burgundy },
    { letter: 'C', text: '6 Doors', tone: T.slate },
  ];
  const correct = 'B';
  return (
    <QuizFrame
      eyebrow="Trivia · Question 1 of 4"
      prompt="How many doors must an UberX vehicle have?"
      selected={selected}
      correctChoice={correct}
      explanation="4 doors is the minimum requirement for UberX — for passenger safety and convenience."
    >
      <div className="grid grid-cols-3 gap-3 md:gap-6">
        {choices.map(c => {
            const isPicked = selected === c.letter;
            const isRight  = selected !== null && c.letter === correct;
            return (
              <button
                key={c.letter}
                disabled={selected !== null}
                onClick={() => onAnswer('quizDoors', c.letter, c.letter === correct)}
                className={`rounded-2xl p-4 md:p-10 text-center transition-all active:scale-95 ${isPicked ? 'ring-4 scale-105' : 'hover:scale-105'} ${selected !== null && !isPicked && !isRight ? 'opacity-40' : ''}`}
                style={{
                  backgroundColor: isRight ? '#4a7c4a' : isPicked ? '#c0392b' : c.tone,
                  color: T.cream,
                  boxShadow: isPicked ? '0 0 0 4px rgba(217,150,150,0.5)' : undefined,
                }}
              >
                <div className="font-serif font-black text-4xl md:text-7xl">{c.letter}</div>
                <div className="text-lg md:text-3xl mt-2 md:mt-3">{c.text}</div>
              </button>
          );
        })}
      </div>
    </QuizFrame>
  );
};

// ── 18. Quiz: Driver Experience (T/F) ─────────────────────────────────────
export const SlideQuizExperience: FC<QuizSlideProps> = ({ selected, onAnswer }) => {
  const correct = 'FALSE';
  return (
    <QuizFrame
      eyebrow="True or False · Question 2 of 4"
      prompt={<span className="italic">"Drivers need customer service experience to drive for Uber."</span>}
      selected={selected}
      correctChoice={correct}
      explanation="No customer service or job experience is required. Anyone 25+ with a valid license and clean record can apply."
    >
      <div className="grid grid-cols-2 gap-3 md:gap-8">
        {['TRUE','FALSE'].map(opt => {
            const isPicked = selected === opt;
            const isRight  = selected !== null && opt === correct;
            return (
              <button
                key={opt}
                disabled={selected !== null}
                onClick={() => onAnswer('quizExperience', opt, opt === correct)}
                className={`rounded-2xl py-6 md:py-16 transition-all active:scale-95 ${isPicked ? 'ring-4 scale-105' : 'hover:scale-105'} ${selected !== null && !isPicked && !isRight ? 'opacity-40' : ''}`}
                style={{
                  backgroundColor: isRight ? '#4a7c4a' : isPicked ? '#c0392b' : opt === 'TRUE' ? T.slate : T.burgundy,
                  color: T.cream,
                }}
              >
                <div className="font-serif font-black text-3xl md:text-7xl">{opt}</div>
              </button>
          );
        })}
      </div>
    </QuizFrame>
  );
};

// ── 19. Quiz: Myth vs Fact (Stars) ────────────────────────────────────────
export const SlideQuizStars: FC<QuizSlideProps> = ({ selected, onAnswer }) => {
  const correct = 'A'; // "4 stars is good" is the myth
  const options = [
    { letter: 'A' as const, label: '"4 stars is still a good rating for my driver"', tone: '#9c7a87', kind: 'MYTH?' },
    { letter: 'B' as const, label: '"Only 5 stars means my driver met the standard"', tone: T.burgundy, kind: 'FACT?' },
  ];
  const renderBtn = (c: (typeof options)[number]) => {
    const isPicked = selected === c.letter;
    const isRight  = selected !== null && c.letter === correct;
    const isWrongPicked = selected !== null && !isPicked && !isRight;
    return (
      <button
        key={c.letter}
        disabled={selected !== null}
        onClick={() => onAnswer('quizStars', c.letter, c.letter === correct)}
        className={`rounded-2xl p-4 md:p-10 transition-all active:scale-95 ${isPicked ? 'ring-4 scale-105' : 'hover:scale-105'} ${isWrongPicked ? 'opacity-40' : ''}`}
        style={{
          backgroundColor: isRight ? '#4a7c4a' : isPicked && !isRight ? '#c0392b' : c.tone,
          color: T.cream,
        }}
      >
        <div className="text-sm md:text-xl uppercase tracking-wider opacity-80 mb-2 md:mb-3">{c.kind}</div>
        <div className="text-base md:text-2xl leading-snug">{c.label}</div>
      </button>
    );
  };
  return (
    <QuizFrame
      eyebrow="Myth vs. Fact · Question 3 of 4"
      prompt="Which statement is the MYTH?"
      selected={selected}
      correctChoice={correct}
      explanation='"4 stars is still a good rating" is a MYTH. Even 4 stars is considered bad and can cost a driver platform access — especially for special programs like military base eligibility.'
    >
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 md:gap-6 items-center">
        {renderBtn(options[0])}
        <div className="w-12 h-12 md:w-20 md:h-20 rounded-full flex items-center justify-center font-serif font-bold text-base md:text-2xl mx-auto" style={{ backgroundColor: T.navyDeep, color: T.cream }}>
          VS
        </div>
        {renderBtn(options[1])}
      </div>
    </QuizFrame>
  );
};

// ── 20. Quiz: Military Base (T/F) ─────────────────────────────────────────
export const SlideQuizMilitary: FC<QuizSlideProps> = ({ selected, onAnswer }) => {
  const correct = 'FALSE';
  return (
    <QuizFrame
      eyebrow="True or False · Question 4 of 4"
      prompt={<span className="italic">"Any Uber driver can pick up and drop off passengers on a military base."</span>}
      selected={selected}
      correctChoice={correct}
      explanation="Drivers need special eligibility — often military family members with base clearance and high ratings — to take riders all the way onto base."
    >
      <div className="grid grid-cols-2 gap-3 md:gap-8">
        {['TRUE','FALSE'].map(opt => {
            const isPicked = selected === opt;
            const isRight  = selected !== null && opt === correct;
            return (
              <button
                key={opt}
                disabled={selected !== null}
                onClick={() => onAnswer('quizMilitary', opt, opt === correct)}
                className={`rounded-2xl py-6 md:py-16 transition-all active:scale-95 ${isPicked ? 'ring-4 scale-105' : 'hover:scale-105'} ${selected !== null && !isPicked && !isRight ? 'opacity-40' : ''}`}
                style={{
                  backgroundColor: isRight ? '#4a7c4a' : isPicked ? '#c0392b' : opt === 'TRUE' ? T.slate : T.burgundy,
                  color: T.cream,
                }}
              >
                <div className="font-serif font-black text-3xl md:text-7xl">{opt}</div>
              </button>
          );
        })}
      </div>
    </QuizFrame>
  );
};

// ── 21. Scoreboard ────────────────────────────────────────────────────────
export const SlideScoreboard: FC<{ correctCount: number; total: number }> = ({ correctCount, total }) => {
  const dots = ['Vehicle Doors', 'Driver Experience', 'Star Ratings', 'Military Base'];
  const message =
    correctCount === total ? "You're a rideshare pro! 🏆" :
    correctCount >= 3      ? 'Great job — almost perfect!' :
    correctCount >= 2      ? 'Nice work — you learned something!' :
                             "Hey, you tried! Keep learning.";
  return (
    <SlideShell theme="cream" align="center">
      <div className="text-center max-w-5xl">
        <div className="text-4xl md:text-7xl mb-2 md:mb-4">🏆</div>
        <h1 className="font-serif font-black text-3xl md:text-7xl" style={{ color: T.burgundy }}>How Did You Do?</h1>
        <div className="grid grid-cols-4 gap-2 md:gap-6 mt-6 md:mt-12">
          {dots.map((d, i) => {
            const lit = i < correctCount;
            return (
              <div key={d} className="flex flex-col items-center">
                <div
                  className="w-12 h-12 md:w-24 md:h-24 rounded-full flex items-center justify-center font-serif font-bold text-xl md:text-4xl transition-transform"
                  style={{
                    backgroundColor: lit ? T.burgundy : '#cfc6bd',
                    color: lit ? T.cream : T.navyDeep,
                    transform: lit ? 'scale(1.05)' : 'scale(0.95)',
                  }}
                >
                  {i + 1}
                </div>
                <div className="text-xs md:text-base mt-2 md:mt-3 opacity-80">{d}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-6 md:mt-12 rounded-2xl py-3 px-5 md:py-6 md:px-10 inline-block" style={{ backgroundColor: T.navyDeep, color: T.cream }}>
          <div className="font-serif font-bold text-2xl md:text-4xl">{correctCount}/{total}</div>
          <div className="text-base md:text-xl mt-1">{message}</div>
        </div>
        <div className="mt-4 md:mt-8 text-base md:text-2xl opacity-80" style={{ color: T.navyDeep }}>
          <BadgeCheck className="inline mr-2 w-5 h-5 md:w-7 md:h-7" style={{ color: T.burgundy }} />
          Remember: 5 stars is the only "good" rating!
        </div>
      </div>
    </SlideShell>
  );
};

// ── 22. Farewell — handled by WelcomePage (renders QR triptych) ───────────
// (We export a placeholder here for symmetry — the actual QR card lives in WelcomePage.tsx)
export const SlideFarewell: FC<{ children?: ReactNode }> = ({ children }) => (
  <SlideShell theme="gradient" align="center">{children}</SlideShell>
);

// ── Renderer registry ─────────────────────────────────────────────────────
export interface SlideRenderContext {
  onJump: (key: SlideKey) => void;
  onHonk?: () => void; // wires the Hero's HONK button → container shake + horn in WelcomePage
  quiz: {
    selected: Partial<Record<SlideKey, string>>;
    onAnswer: (id: SlideKey, choice: string, isCorrect: boolean) => void;
    correctCount: number;
  };
  // The farewell slide renders QR codes — those live in WelcomePage so this is a slot.
  farewellNode: ReactNode;
}

export function renderSlide(key: SlideKey, ctx: SlideRenderContext) {
  switch (key) {
    case 'hero':            return <SlideHero onHonk={ctx.onHonk} />;
    case 'autismNote':      return <SlideAutismNote />;
    case 'stats':           return <SlideStats />;
    case 'toc':             return <SlideTOC onJump={ctx.onJump} />;
    case 'defining':        return <SlideDefining />;
    case 'housekeeping':    return <SlideHousekeeping />;
    case 'vehicleReqs':     return <SlideVehicleReqs />;
    case 'driverReqs':      return <SlideDriverReqs />;
    case 'didYouKnow':      return <SlideDidYouKnow />;
    case 'uberXLComfort':   return <SlideUberXLComfort />;
    case 'uberXXL':         return <SlideUberXXL />;
    case 'taxisVs':         return <SlideTaxisVs />;
    case 'earnings':        return <SlideEarnings />;
    case 'ratingsMatter':   return <SlideRatingsMatter />;
    case 'starsMilitary':   return <SlideStarsMilitary />;
    case 'aiCoPilot':       return <SlideAICoPilot />;
    case 'quizIntro':       return <SlideQuizIntro />;
    case 'quizDoors':       return <SlideQuizDoors selected={ctx.quiz.selected.quizDoors ?? null} onAnswer={ctx.quiz.onAnswer} />;
    case 'quizExperience':  return <SlideQuizExperience selected={ctx.quiz.selected.quizExperience ?? null} onAnswer={ctx.quiz.onAnswer} />;
    case 'quizStars':       return <SlideQuizStars selected={ctx.quiz.selected.quizStars ?? null} onAnswer={ctx.quiz.onAnswer} />;
    case 'quizMilitary':    return <SlideQuizMilitary selected={ctx.quiz.selected.quizMilitary ?? null} onAnswer={ctx.quiz.onAnswer} />;
    case 'scoreboard':      return <SlideScoreboard correctCount={ctx.quiz.correctCount} total={4} />;
    case 'farewell':        return <SlideFarewell>{ctx.farewellNode}</SlideFarewell>;
  }
}
