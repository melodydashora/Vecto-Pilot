// client/src/layouts/CoPilotLayout.tsx
// Shared layout for all co-pilot pages with bottom navigation
// GlobalHeader and saved-setup review are shared across all co-pilot pages.
// NOTE: CoPilotProvider is now in App.tsx to persist across route changes

import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import GlobalHeader from '@/components/GlobalHeader';
import { BottomTabNavigation } from '@/components/co-pilot/BottomTabNavigation';
import { Toaster } from '@/components/ui/toaster';
import { useLocation } from '@/contexts/location-context-clean';
import { useRunSetup } from '@/contexts/run-setup-context';
import RunSetupSummary from '@/components/co-pilot/RunSetupSummary';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export default function CoPilotLayout() {
  const setup = useRunSetup();
  const location = useLocation();
  const navigate = useNavigate();
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
        <Dialog open={setup.reviewOpen && location.locationRequested === true} onOpenChange={open => { if (!open) setup.dismissReview(); }}>
          <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl">
            <DialogTitle>Ready for your session?</DialogTitle>
            <DialogDescription className="sr-only">Continue with Preference or Change Preferences for this session. Start Strategy from its component when ready.</DialogDescription>
            <RunSetupSummary />
          </DialogContent>
        </Dialog>
        <div>
          {setup.view === 'editor' && <div className="container mx-auto max-w-2xl px-4 py-3">
            <p className="text-sm text-muted-foreground">Start your next Strategy after saving your changes. Your current results stay available.</p>
            <Button variant="outline" className="mt-2 min-h-11 h-auto whitespace-normal py-2" disabled={setup.saving} onClick={() => { setup.reviewSetup(true); navigate('/co-pilot/strategy'); }}>Discard changes and review preferences</Button>
          </div>}
          <Outlet />
        </div>
      </main>

      <BottomTabNavigation />
      <Toaster />
    </div>
  );
}
