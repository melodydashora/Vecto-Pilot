import { motion } from 'framer-motion';
import { Github, Linkedin, Mail, Download, MapPin, ChevronDown } from 'lucide-react';

const LINKS = [
  { href: 'https://linkedin.com/in/melodydashora', icon: Linkedin, label: 'LinkedIn' },
  { href: 'https://github.com/melodydashora/Vecto-Pilot', icon: Github, label: 'GitHub' },
  { href: 'mailto:melodydashora@gmail.com', icon: Mail, label: 'Email' },
];

const fade = (delay: number) => ({
  initial: { opacity: 0, y: 24 } as const,
  animate: { opacity: 1, y: 0 } as const,
  transition: { duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] as const },
});

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center px-6 py-24 overflow-hidden">
      {/* Ambient background glows */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-violet-600/[0.07] rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-600/[0.05] rounded-full blur-[100px] translate-y-1/3 -translate-x-1/4 pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto w-full">
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">

          {/* ── Photo with animated gradient ring ── */}
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="shrink-0"
          >
            <div className="relative group">
              {/* Outer glow ring (blurred) */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
                className="absolute -inset-2 rounded-full blur-md opacity-40 group-hover:opacity-75 transition-opacity duration-700"
                style={{ background: 'conic-gradient(from 0deg, #8b5cf6, #3b82f6, #06b6d4, #8b5cf6)' }}
              />
              {/* Inner sharp ring */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
                className="absolute -inset-[3px] rounded-full opacity-60 group-hover:opacity-100 transition-opacity duration-700"
                style={{ background: 'conic-gradient(from 0deg, #8b5cf6, #3b82f6, #06b6d4, #8b5cf6)' }}
              />
              {/* Photo */}
              <img
                src="/portfolio/melody.jpeg"
                alt="Melody Dashora"
                className="relative w-44 h-44 lg:w-56 lg:h-56 rounded-full object-cover border-[3px] border-neutral-950 grayscale-[30%] group-hover:grayscale-0 transition-all duration-700"
              />
            </div>
          </motion.div>

          {/* ── Text content ── */}
          <div className="text-center lg:text-left flex-1 min-w-0">
            <motion.h1
              {...fade(0.15)}
              className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight"
            >
              Melody Dashora
            </motion.h1>

            <motion.p
              {...fade(0.3)}
              className="mt-3 text-xl md:text-2xl font-semibold bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent"
            >
              I build things that work.
            </motion.p>

            <motion.div
              {...fade(0.4)}
              className="mt-2 flex items-center gap-1.5 justify-center lg:justify-start text-sm text-neutral-500"
            >
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span>Full-Stack Product Architect · AI Solutions Builder · Dallas–Fort Worth</span>
            </motion.div>

            <motion.p
              {...fade(0.5)}
              className="mt-6 text-base md:text-lg text-neutral-400 leading-relaxed max-w-2xl"
            >
              Twenty years shipping enterprise platforms for NASA, GE, Verizon, and
              Blue Cross Blue Shield — then I started building my own.{' '}
              <span className="text-neutral-300">Vecto Pilot</span> is a production AI
              platform I architected solo: 8 frontier models across 4 providers, 31 specialized
              roles, and a resilience layer that keeps the product running when any single
              provider goes down. 750+ hours of AI-pair-programming with Claude Code, proving
              one builder can ship enterprise-grade software when human judgment guides
              AI execution.
            </motion.p>

            {/* Links + resume download */}
            <motion.div
              {...fade(0.65)}
              className="mt-8 flex flex-wrap gap-3 justify-center lg:justify-start"
            >
              {LINKS.map(({ href, icon: Icon, label }) => (
                <a
                  key={label}
                  href={href}
                  target={href.startsWith('mailto:') ? undefined : '_blank'}
                  rel={href.startsWith('mailto:') ? undefined : 'noopener noreferrer'}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border border-neutral-700 text-neutral-300 hover:border-violet-500/70 hover:text-violet-300 transition-colors duration-300"
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </a>
              ))}
              <a
                href="/portfolio/melody-dashora-resume.docx"
                download
                className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold bg-violet-600 text-white hover:bg-violet-500 transition-colors duration-300 shadow-lg shadow-violet-600/20"
              >
                <Download className="w-4 h-4" />
                Resume
              </a>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.6 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <ChevronDown className="w-6 h-6 text-neutral-600" />
        </motion.div>
      </motion.div>
    </section>
  );
}
