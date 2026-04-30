// client/src/layouts/CoPilotLayout.tsx
// Shared layout for all co-pilot pages with bottom navigation
// GlobalHeader is shared across all pages except About (static page)
// NOTE: CoPilotProvider is now in App.tsx to persist across route changes

import React from 'react';
<<<<<<< HEAD
import { Outlet, useLocation } from 'react-router-dom';
=======
import { Outlet } from 'react-router-dom';
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
import GlobalHeader from '@/components/GlobalHeader';
import { BottomTabNavigation } from '@/components/co-pilot/BottomTabNavigation';
import { Toaster } from '@/components/ui/toaster';

export default function CoPilotLayout() {
<<<<<<< HEAD
  const location = useLocation();

  // Don't show GlobalHeader on static pages (About/Donation)
  const isStaticPage = location.pathname === '/co-pilot/about';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* GlobalHeader is shared except on static pages */}
      {!isStaticPage && <GlobalHeader />}

      <main className={isStaticPage ? 'pb-24' : 'main-content-with-header pb-24'}>
=======
  // 2026-04-05: Removed isStaticPage exclusion — ALL co-pilot pages get the GlobalHeader
  // so users can navigate back from hamburger menu pages (About, Help, Donate, etc.)
  return (
    <div className="min-h-screen bg-gray-50">
      {/* 2026-04-16: WCAG 2.4.1 skip link — hidden until keyboard-focused */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:rounded focus:shadow-lg"
      >
        Skip to main content
      </a>
      <GlobalHeader />

      <main id="main-content" className="main-content-with-header pb-24">
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
        <Outlet />
      </main>

      <BottomTabNavigation />
      <Toaster />
    </div>
  );
}
