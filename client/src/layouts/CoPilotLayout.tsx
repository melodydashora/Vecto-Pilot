// client/src/layouts/CoPilotLayout.tsx
// Shared layout for all co-pilot pages with bottom navigation
// GlobalHeader is shared across all pages except About (static page)
// NOTE: CoPilotProvider is now in App.tsx to persist across route changes

import React from 'react';
import { Outlet } from 'react-router-dom';
import GlobalHeader from '@/components/GlobalHeader';
import { BottomTabNavigation } from '@/components/co-pilot/BottomTabNavigation';
import { Toaster } from '@/components/ui/toaster';

export default function CoPilotLayout() {
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
        <Outlet />
      </main>

      <BottomTabNavigation />
      <Toaster />
    </div>
  );
}
