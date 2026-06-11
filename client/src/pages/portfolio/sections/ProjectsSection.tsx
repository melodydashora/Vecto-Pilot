import { motion, type Variants } from 'framer-motion';
import {
  ExternalLink, Zap, Cloud, Star, BarChart2, Clock,
  FileText, Rocket, Building2, Shield,
} from 'lucide-react';

const VECTO_STATS = [
  { value: '8', label: 'LLM Models', icon: Zap },
  { value: '4', label: 'Providers', icon: Cloud },
  { value: '31', label: 'Specialized Roles', icon: Star },
  { value: '70+', label: 'DB Tables', icon: BarChart2 },
  { value: '750+', label: 'Hours w/ Claude Code', icon: Clock },
  { value: '95', label: 'Folder READMEs', icon: FileText },
];

const VECTO_DETAILS = [
  'TRIAD pipeline: Claude reasons, Gemini briefs with live Google Search grounding, GPT scores and ranks',
  'Model-agnostic adapter pattern with hedged routing and circuit breakers — zero downtime on provider outages',
  'Snapshot → Strategy → Smart Blocks pipeline with full data lineage for every recommendation',
  'Real-time SSE streaming for live strategy updates and AI Coach responses',
  'Siri Shortcuts integration: photograph a ride offer, get an ACCEPT/REJECT in under 2 seconds',
  'Privacy-first: 60-minute session TTL, cascading deletes, no persistent driver tracking',
];

const PAST_WORK = [
  {
    icon: Rocket,
    org: 'NASA Langley Research Center',
    role: 'Directorate Intern',
    period: '2019',
    highlight:
      'Built a Python integration hub that mapped millions of SAP ERP transactions to Deltek Cobra EVMS datasets in under 2 minutes — replacing a 6-week manual cycle. Designed compliance architectures for post-quantum cryptographic resilience (NIST FIPS 204/205).',
    tags: ['Python', 'Pandas', 'SQLAlchemy', 'SAP', 'EVMS'],
  },
  {
    icon: Building2,
    org: 'InfoVision · Verizon GTS',
    role: 'Senior Business Analyst PMO',
    period: '2021–2022',
    highlight:
      'Stood up multi-tiered PMO systems for Verizon\'s Emerging Technology division, cutting project delivery time by 40%. Trained 100+ team members on Smartsheet-driven project management and reporting.',
    tags: ['Smartsheet', 'WorkApps', 'PMO', 'Enterprise'],
  },
  {
    icon: Shield,
    org: 'Strive Consulting · BCBS',
    role: 'Senior Business Systems Analyst',
    period: '2019',
    highlight:
      'Resolved third-party integration bottlenecks by mapping API connections across MuleSoft and e-Gateway flows. Integrated Office 365 with Jira and SharePoint to streamline cross-team delivery.',
    tags: ['MuleSoft', 'API', 'Jira', 'Integration'],
  },
];

// 2026-06-11: type as framer-motion Variants so the cubic-bezier ease literal is
// contextually typed to the 4-tuple Easing type (a bare number[] is not assignable).
const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const fadeItem: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

export default function ProjectsSection() {
  return (
    <section className="px-6 py-20 lg:py-28 bg-neutral-900/40">
      <div className="max-w-5xl mx-auto">
        {/* ── Section heading ── */}
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-sm font-bold uppercase tracking-widest text-violet-400 mb-12"
        >
          Projects &amp; Experience
        </motion.h2>

        {/* ══════════════ Vecto Pilot ══════════════ */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6 }}
          className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-6 md:p-8 lg:p-10 mb-16"
        >
          {/* Header row */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-semibold mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </div>
              <h3 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-1">
                Vecto Pilot
              </h3>
              <p className="text-neutral-400">
                AI rideshare strategy assistant — free, open-source, production-grade.
              </p>
            </div>
            <a
              href="https://vectopilot.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border border-neutral-700 text-neutral-300 hover:border-violet-500/70 hover:text-violet-300 transition-colors duration-300 shrink-0 self-start"
            >
              vectopilot.com <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* Stats */}
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-40px' }}
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8"
          >
            {VECTO_STATS.map(({ value, label, icon: Icon }) => (
              <motion.div
                key={label}
                variants={fadeItem}
                className="text-center p-3 rounded-xl border border-neutral-800 bg-neutral-900/60"
              >
                <Icon className="w-4 h-4 text-violet-400 mx-auto mb-1.5" />
                <div className="text-xl font-extrabold bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
                  {value}
                </div>
                <div className="text-[10px] text-neutral-500 font-medium mt-0.5">{label}</div>
              </motion.div>
            ))}
          </motion.div>

          {/* Technical details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
            {VECTO_DETAILS.map((detail) => (
              <div key={detail} className="flex items-start gap-2 text-sm text-neutral-400">
                <span className="text-violet-500 mt-1 shrink-0">&bull;</span>
                <span>{detail}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* ══════════════ Past Work ══════════════ */}
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-60px' }}
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          {PAST_WORK.map(({ icon: Icon, org, role, period, highlight, tags }) => (
            <motion.div
              key={org}
              variants={fadeItem}
              className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-5 hover:border-violet-500/30 transition-colors duration-300 flex flex-col"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
                  <Icon className="w-4.5 h-4.5 text-violet-400" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-neutral-200 truncate">{org}</h4>
                  <p className="text-xs text-neutral-500">
                    {role} &middot; {period}
                  </p>
                </div>
              </div>
              <p className="text-sm text-neutral-400 leading-relaxed flex-1">{highlight}</p>
              <div className="flex flex-wrap gap-1.5 mt-4">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
