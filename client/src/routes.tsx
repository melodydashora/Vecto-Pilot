// client/src/routes.tsx
// React Router configuration for co-pilot pages and authentication

import { createBrowserRouter, Navigate } from 'react-router-dom';
import CoPilotLayout from '@/layouts/CoPilotLayout';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import StrategyPage from '@/pages/co-pilot/StrategyPage';
// 2026-04-25 (Phase A, Pass 1): Coach now has its own route.
import CoachPage from '@/pages/co-pilot/CoachPage';
// 2026-01-09: Renamed from BarsPage for disambiguation
import VenueManagerPage from '@/pages/co-pilot/VenueManagerPage';
import BriefingPage from '@/pages/co-pilot/BriefingPage';
// 2026-04-26 PHASE B: MapPage removed — the map now lives only inside StrategyPage.
// /co-pilot/map route deleted; bottom-nav Map tab deleted in BottomTabNavigation.tsx.
import IntelPage from '@/pages/co-pilot/IntelPage';
import AboutPage from '@/pages/co-pilot/AboutPage';
import PolicyPage from '@/pages/co-pilot/PolicyPage';
import SettingsPage from '@/pages/co-pilot/SettingsPage';
import TranslationPage from '@/pages/co-pilot/TranslationPage';
// 2026-04-05: Hamburger menu pages
import SchedulePage from '@/pages/co-pilot/SchedulePage';
import DonatePage from '@/pages/co-pilot/DonatePage';
import HelpPage from '@/pages/co-pilot/HelpPage';
import {
  SignInPage,
  SignUpPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  TermsPage,
} from '@/pages/auth';
// 2026-05-23 (Path B): Uber callback handled entirely server-side at
// GET /api/auth/uber/callback (server/api/auth/uber.js). No client-side
// landing page; the server handler 302s directly to the post-OAuth destination.
import { GoogleCallbackPage } from '@/pages/auth/google/Callback';
import AuthRedirect from '@/components/auth/AuthRedirect';
import ConciergePage from '@/pages/co-pilot/ConciergePage';
import PublicConciergePage from '@/pages/concierge/PublicConciergePage';
import LandingPage from '@/pages/landing/LandingPage';
// 2026-05-15: Public iPad kiosk "Welcome to My Car" — passenger-education flow with quiz + QR triptych.
import WelcomePage from '@/pages/welcome/WelcomePage';
// 2026-05-15: Public donate page reached from the welcome farewell QR (square.link CTA + cost breakdown + future scope).
import PublicDonatePage from '@/pages/welcome/PublicDonatePage';

export const router = createBrowserRouter([
  // ═══════════════════════════════════════════════════════════════════════════
  // Root - Smart redirect based on auth state
  // - Authenticated users → /co-pilot/strategy
  // - Unauthenticated users → /auth/sign-in
  // ═══════════════════════════════════════════════════════════════════════════
  {
    path: '/',
    element: <AuthRedirect />,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Public Routes (no authentication required)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    // 2026-05-23: Uber verification requires the privacy policy at the canonical /privacy URL.
    // /policy retained as an alias so existing in-app links (AboutPage, GoogleCallback) stay valid.
    path: '/privacy',
    element: <PolicyPage />,
  },
  {
    path: '/policy',
    element: <PolicyPage />,
  },
  
  // 2026-05-23 (Path B): No client-side /auth/uber/callback route. Uber redirects
  // to the server endpoint GET /api/auth/uber/callback (server/api/auth/uber.js),
  // which exchanges the code, encrypts tokens, persists to uber_connections, and
  // 302s the browser directly to the post-OAuth destination. Removed the prior
  // client landing page (Callback.tsx) and its client-side code-exchange helper
  // (uberAuth.ts) — both depended on a /api/auth/uber/exchange server endpoint
  // that does not exist. Path A (asymmetric-key JWT) deferred to a follow-up sprint.

  // 2026-02-13: Google OAuth Callback (PUBLIC - user is NOT authenticated when arriving from Google)
  {
    path: '/auth/google/callback',
    element: <GoogleCallbackPage />,
  },

  // 2026-02-13: Public Concierge page (passengers scan driver's QR code)
  {
    path: '/c/:token',
    element: <PublicConciergePage />,
  },

  // 2026-04-02: Public landing/demo page — interactive feature showcase
  {
    path: '/demo',
    element: <LandingPage />,
  },

  // 2026-05-15: Public in-car iPad kiosk experience — passenger education + QR triptych.
  // No auth required: iPad mounted in the car points to /welcome and the rider can interact without signing in.
  {
    path: '/welcome',
    element: <WelcomePage />,
  },

  // 2026-05-15: Public donate page (reached from welcome farewell QR). No auth.
  {
    path: '/welcome/support',
    element: <PublicDonatePage />,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Public Auth Routes (no layout)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    path: '/auth/sign-in',
    element: <SignInPage />,
  },
  {
    path: '/auth/sign-up',
    element: <SignUpPage />,
  },
  {
    path: '/auth/forgot-password',
    element: <ForgotPasswordPage />,
  },
  {
    path: '/auth/reset-password',
    element: <ResetPasswordPage />,
  },
  {
    path: '/auth/terms',
    element: <TermsPage />,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Main App Routes (with CoPilotLayout) - PROTECTED
  // All co-pilot routes require authentication
  // ═══════════════════════════════════════════════════════════════════════════
  {
    path: '/co-pilot',
    element: (
      <ProtectedRoute>
        <CoPilotLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="/co-pilot/strategy" replace />,
      },
      {
        path: 'strategy',
        element: <StrategyPage />,
      },
      {
        path: 'bars',
        element: <VenueManagerPage />,
      },
      {
        path: 'briefing',
        element: <BriefingPage />,
      },
      {
        path: 'intel',
        element: <IntelPage />,
      },
      {
        path: 'about',
        element: <AboutPage />,
      },
      {
        path: 'policy',
        element: <PolicyPage />,
      },
      {
        path: 'concierge',
        element: <ConciergePage />,
      },
      {
        // 2026-04-25 (Phase A, Pass 1): dedicated Coach surface
        path: 'coach',
        element: <CoachPage />,
      },
      {
        path: 'settings',
        element: <SettingsPage />,
      },
      {
        // 2026-03-16: Real-time rider translation for FIFA World Cup
        path: 'translate',
        element: <TranslationPage />,
      },
      // 2026-04-05: Hamburger menu pages
      {
        path: 'schedule',
        element: <SchedulePage />,
      },
      {
        path: 'donate',
        element: <DonatePage />,
      },
      {
        path: 'help',
        element: <HelpPage />,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Catch-all — redirect unknown paths to root
  // 2026-04-09: Replit's preview proxy can leak the port number into the URL
  // path (e.g., "/5000"), causing React Router to crash with no matching route.
  // This catch-all redirects any unmatched path back to "/" gracefully.
  // ═══════════════════════════════════════════════════════════════════════════
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
