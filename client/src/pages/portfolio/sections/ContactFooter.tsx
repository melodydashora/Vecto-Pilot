import { motion } from 'framer-motion';
import { Download, Github, Linkedin, Mail } from 'lucide-react';

const LINKS = [
  { href: 'https://linkedin.com/in/melodydashora', icon: Linkedin, label: 'LinkedIn' },
  { href: 'https://github.com/melodydashora/Vecto-Pilot', icon: Github, label: 'GitHub' },
  { href: 'mailto:melodydashora@gmail.com', icon: Mail, label: 'Email' },
];

export default function ContactFooter() {
  return (
    <footer className="px-6 pt-20 pb-12 lg:pt-28 lg:pb-16 border-t border-neutral-800">
      <div className="max-w-3xl mx-auto text-center">
        {/* Resume download */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="text-sm font-bold uppercase tracking-widest text-violet-400 mb-6">
            Get in Touch
          </h2>
          <a
            href="/portfolio/melody-dashora-resume.docx"
            download
            className="inline-flex items-center gap-3 px-8 py-4 rounded-full bg-violet-600 text-white text-lg font-bold hover:bg-violet-500 transition-colors duration-300 shadow-xl shadow-violet-600/25 active:scale-[0.98]"
          >
            <Download className="w-5 h-5" />
            Download Resume
          </a>
        </motion.div>

        {/* Link pills */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="mt-8 flex flex-wrap justify-center gap-3"
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
        </motion.div>

        {/* Credit */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-14 text-xs text-neutral-600"
        >
          &copy; {new Date().getFullYear()} Melody Dashora &middot; Built with Claude
          Code, Gemini &amp; GPT
        </motion.p>
      </div>
    </footer>
  );
}
