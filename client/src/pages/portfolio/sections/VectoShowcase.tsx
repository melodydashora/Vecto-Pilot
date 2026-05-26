import { motion } from 'framer-motion';
import {
  Navigation, Coffee, FileText, BarChart2, Languages, QrCode,
  Map, Smartphone, Cloud, Thermometer, Car, MapPin, Star,
  TrendingUp, Zap, Clock,
} from 'lucide-react';

const STATS = [
  { value: '8', label: 'AI Models', icon: Zap },
  { value: '4', label: 'Providers', icon: Cloud },
  { value: '31', label: 'Specialized Roles', icon: Star },
  { value: '70+', label: 'DB Tables', icon: BarChart2 },
  { value: '750+', label: 'Hours Pair-Programmed', icon: Clock },
  { value: '95', label: 'Folder-Level READMEs', icon: FileText },
];

const FEATURES = [
  { icon: Navigation, label: 'Real-Time Strategy', color: 'text-violet-400' },
  { icon: Coffee, label: 'Venue Intelligence', color: 'text-fuchsia-400' },
  { icon: FileText, label: 'Daily Briefing', color: 'text-slate-400' },
  { icon: Map, label: 'Strategic Map', color: 'text-green-400' },
  { icon: BarChart2, label: 'Market Intel', color: 'text-amber-400' },
  { icon: Languages, label: 'Live Translation', color: 'text-blue-400' },
  { icon: QrCode, label: 'In-Car Concierge', color: 'text-teal-400' },
];

const VENUES = [
  { name: 'Legacy West', dist: '0.8mi', time: '3min', grade: 'A+', event: 'Live Music @ Legacy Hall' },
  { name: 'The Star', dist: '1.2mi', time: '5min', grade: 'A', event: null },
  { name: 'Dr Pepper Ballpark', dist: '2.1mi', time: '7min', grade: 'B+', event: 'RoughRiders vs Express' },
  { name: 'Toyota Music Factory', dist: '12.3mi', time: '18min', grade: 'B', event: null },
];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

export default function VectoShowcase() {
  return (
    <section className="relative px-6 py-24 lg:py-32 overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-violet-600/[0.04] rounded-full blur-[140px] pointer-events-none" />

      <div className="relative z-10 max-w-6xl mx-auto">
        {/* Heading */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-400 text-sm font-semibold mb-4">
            <Smartphone className="w-4 h-4" />
            Flagship Project
          </div>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight mb-4">
            Vecto Pilot
          </h2>
          <p className="text-lg text-neutral-400 max-w-2xl mx-auto leading-relaxed">
            A free, AI-powered rideshare intelligence platform that helps drivers pick smarter
            staging locations. Users report earning 30–40% more per hour.
          </p>
        </motion.div>

        {/* Stats */}
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-60px' }}
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-16"
        >
          {STATS.map(({ value, label, icon: Icon }) => (
            <motion.div
              key={label}
              variants={item}
              className="text-center p-4 rounded-xl border border-neutral-800 bg-neutral-900/60"
            >
              <Icon className="w-5 h-5 text-violet-400 mx-auto mb-2" />
              <div className="text-2xl font-extrabold bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
                {value}
              </div>
              <div className="text-xs text-neutral-500 font-medium mt-1">{label}</div>
            </motion.div>
          ))}
        </motion.div>

        {/* Dashboard mock */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          <div className="absolute -inset-4 bg-violet-500/[0.06] rounded-3xl blur-2xl pointer-events-none" />
          <div className="relative rounded-2xl border border-neutral-800 bg-neutral-900/90 overflow-hidden shadow-2xl">
            {/* Browser chrome */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-neutral-800 bg-neutral-950/80">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-rose-500/70" />
                <div className="w-3 h-3 rounded-full bg-amber-500/70" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/70" />
              </div>
              <div className="flex-1 mx-8">
                <div className="bg-neutral-800 rounded-md px-3 py-1 text-xs text-neutral-500 font-mono text-center max-w-xs mx-auto">
                  vecto-pilot.com/co-pilot/strategy
                </div>
              </div>
              <div className="w-12" />
            </div>

            {/* App header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800 bg-gradient-to-r from-violet-950/50 to-blue-950/50">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-violet-600 rounded-lg flex items-center justify-center">
                  <Navigation className="w-4 h-4 text-white" />
                </div>
                <span className="font-bold text-sm text-neutral-200">Vecto Pilot&trade;</span>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-neutral-200">9:36 PM</div>
                <div className="text-[10px] text-neutral-500">Friday &middot; Frisco, TX</div>
              </div>
            </div>

            {/* Dashboard content */}
            <div className="p-4 md:p-6 grid grid-cols-1 md:grid-cols-5 gap-4">
              {/* Strategy (spans 3 cols) */}
              <div className="md:col-span-3 space-y-4">
                <div className="rounded-xl bg-amber-950/30 border border-amber-900/40 p-4">
                  <div className="flex items-center gap-2 text-amber-400 font-bold text-xs mb-3">
                    <MapPin className="w-3.5 h-3.5" /> WHERE TO BE NOW
                  </div>
                  <div className="space-y-2 text-sm text-neutral-300 leading-relaxed">
                    <p><strong className="text-neutral-100">GO:</strong> Legacy West &amp; The Star. Position near the entertainment district.</p>
                    <p><strong className="text-neutral-100">AVOID:</strong> I-35E southbound — heavy post-game congestion on DNT.</p>
                    <p><strong className="text-neutral-100">WHY:</strong> Stars just let out at AAC. Restaurant-district riders are your highest-value targets for the next 90 minutes.</p>
                  </div>
                </div>

                {/* Venues */}
                <div className="rounded-xl bg-neutral-800/50 border border-neutral-800 p-4">
                  <div className="flex items-center gap-2 text-violet-400 font-bold text-xs mb-3">
                    <Coffee className="w-3.5 h-3.5" /> TOP VENUES
                  </div>
                  <div className="space-y-2">
                    {VENUES.map((v, i) => (
                      <div key={v.name} className="flex items-center justify-between text-sm py-1.5 border-b border-neutral-800/60 last:border-0">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-neutral-500 font-mono text-xs w-4">{i + 1}.</span>
                          <div className="min-w-0">
                            <span className="text-neutral-200 font-medium">{v.name}</span>
                            {v.event && (
                              <div className="text-[10px] text-emerald-400/80 truncate">
                                &bull; {v.event}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-xs">
                          <span className="text-neutral-500">{v.dist}</span>
                          <span className="text-neutral-500">{v.time}</span>
                          <span className={`font-bold ${v.grade.startsWith('A') ? 'text-emerald-400' : 'text-blue-400'}`}>
                            {v.grade}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Sidebar (spans 2 cols) */}
              <div className="md:col-span-2 space-y-4">
                {/* Weather */}
                <div className="rounded-xl bg-neutral-800/50 border border-neutral-800 p-4">
                  <div className="flex items-center gap-2 text-blue-400 font-bold text-xs mb-3">
                    <Thermometer className="w-3.5 h-3.5" /> CONDITIONS
                  </div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-3xl font-extrabold text-neutral-100">78°</span>
                    <span className="text-sm text-neutral-400">Clear</span>
                  </div>
                  <div className="text-xs text-neutral-500 space-y-1">
                    <div>Wind: 5 mph S</div>
                    <div>Humidity: 42%</div>
                  </div>
                </div>

                {/* Traffic */}
                <div className="rounded-xl bg-neutral-800/50 border border-neutral-800 p-4">
                  <div className="flex items-center gap-2 text-amber-400 font-bold text-xs mb-3">
                    <Car className="w-3.5 h-3.5" /> TRAFFIC
                  </div>
                  <div className="space-y-2 text-xs text-neutral-400">
                    <div className="flex items-center justify-between">
                      <span>DNT Corridor</span>
                      <span className="text-amber-400 font-semibold">Moderate</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>I-35E South</span>
                      <span className="text-rose-400 font-semibold">Heavy</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>SH-121</span>
                      <span className="text-emerald-400 font-semibold">Light</span>
                    </div>
                  </div>
                </div>

                {/* Events */}
                <div className="rounded-xl bg-neutral-800/50 border border-neutral-800 p-4">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs mb-3">
                    <TrendingUp className="w-3.5 h-3.5" /> EVENTS
                  </div>
                  <div className="space-y-2 text-xs text-neutral-400">
                    <div className="flex items-start gap-2">
                      <span className="text-rose-400 text-[10px] font-semibold bg-rose-400/10 px-1.5 py-0.5 rounded shrink-0">ENDING</span>
                      <span>Stars vs Avalanche @ AAC</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-400 text-[10px] font-semibold bg-emerald-400/10 px-1.5 py-0.5 rounded shrink-0">LIVE</span>
                      <span>Live Music @ Legacy Hall</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Feature badges */}
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-40px' }}
          className="flex flex-wrap justify-center gap-3 mt-10"
        >
          {FEATURES.map(({ icon: Icon, label, color }) => (
            <motion.div
              key={label}
              variants={item}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-neutral-800 bg-neutral-900/60 text-sm"
            >
              <Icon className={`w-4 h-4 ${color}`} />
              <span className="text-neutral-300 font-medium">{label}</span>
            </motion.div>
          ))}
        </motion.div>

        {/* Architecture callout */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6 }}
          className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          {[
            {
              title: 'TRIAD Pipeline',
              desc: 'Claude reasons, Gemini briefs with live search grounding, GPT scores and ranks. Three models, one coherent strategy.',
            },
            {
              title: 'Model-Agnostic Adapters',
              desc: 'Any model routes through any provider. Hedged routing with circuit breakers — one provider down, zero user impact.',
            },
            {
              title: 'Snapshot Architecture',
              desc: 'Every recommendation traces to the exact real-time data that produced it. Full auditability, ML-training ready.',
            },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 hover:border-violet-500/30 transition-colors duration-300"
            >
              <h3 className="text-sm font-bold text-violet-400 mb-2">{card.title}</h3>
              <p className="text-sm text-neutral-400 leading-relaxed">{card.desc}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
