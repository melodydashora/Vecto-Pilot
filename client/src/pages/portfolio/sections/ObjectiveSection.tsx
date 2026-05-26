import { motion } from 'framer-motion';

export default function ObjectiveSection() {
  return (
    <section className="px-6 py-20 lg:py-28">
      <motion.div
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-3xl mx-auto"
      >
        <h2 className="text-sm font-bold uppercase tracking-widest text-violet-400 mb-6">
          The Short Version
        </h2>
        <div className="space-y-5 text-lg leading-relaxed text-neutral-300">
          <p>
            I run{' '}
            <span className="text-neutral-100 font-medium">Dashora LLC</span> from
            Dallas–Fort Worth, splitting my time between enterprise consulting and
            building Vecto Pilot — an AI-powered rideshare platform where I&rsquo;ve
            logged{' '}
            <span className="text-neutral-100 font-medium">
              750+ hours of pair-programming with Claude Code
            </span>
            , proving that a solo builder with the right AI tooling can ship software
            that competes with funded teams.
          </p>
          <p>
            Before going independent I spent twenty years inside organizations like
            NASA, GE, Verizon, and Blue Cross Blue Shield — gathering requirements,
            building data pipelines, standing up PMO systems, and shipping through
            compliance frameworks that don&rsquo;t forgive shortcuts.
          </p>
          <p className="text-neutral-400">
            Currently finishing a B.E. in Biomedical Engineering at UNT. I treat
            documentation like a first-class engineering artifact — 95 folder-level
            READMEs and 9,500+ lines of architecture docs that aren&rsquo;t checked
            boxes, they&rsquo;re the memory that lets one person operate at enterprise
            scale.
          </p>
        </div>
      </motion.div>
    </section>
  );
}
