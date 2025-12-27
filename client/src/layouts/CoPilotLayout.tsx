// client/src/layouts/CoPilotLayout.tsx
// Shared layout for all co-pilot pages with bottom navigation
// GlobalHeader is shared across all pages except About (static page)

import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import GlobalHeader from '@/components/GlobalHeader';
import { BottomTabNavigation } from '@/components/co-pilot/BottomTabNavigation';
import { CoPilotProvider } from '@/contexts/co-pilot-context';
import { Toaster } from '@/components/ui/toaster';

export default function CoPilotLayout() {
  const location = useLocation();

  // Don't show GlobalHeader on static pages (About/Donation)
  const isStaticPage = location.pathname === '/co-pilot/about';

  return (
    <CoPilotProvider>
      <div className="min-h-screen bg-gray-50">
        {/* GlobalHeader is shared except on static pages */}
        {!isStaticPage && <GlobalHeader />}

        <main className={isStaticPage ? 'pb-24' : 'main-content-with-header pb-24'}>
          <Outlet />
        </main>

        <BottomTabNavigation />
        <Toaster />
      </div>
    </CoPilotProvider>
  );
}
