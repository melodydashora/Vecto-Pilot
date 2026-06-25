import { useEffect } from 'react';
import HeroSection from './sections/HeroSection';
import ObjectiveSection from './sections/ObjectiveSection';
import ProjectsSection from './sections/ProjectsSection';
import ContactFooter from './sections/ContactFooter';

export default function PortfolioPage() {
  useEffect(() => {
    document.title = 'Portfolio — Melody Dashora';
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 selection:bg-violet-500/30">
      <HeroSection />
      <ObjectiveSection />
      <ProjectsSection />
      <ContactFooter />
    </div>
  );
}
