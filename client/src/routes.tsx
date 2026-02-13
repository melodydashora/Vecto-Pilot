// client/src/routes.tsx
// React Router configuration for co-pilot pages and authentication

import { createBrowserRouter, Navigate } from 'react-router-dom';
import CoPilotLayout from '@/layouts/CoPilotLayout';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import StrategyPage from '@/pages/co-pilot/StrategyPage';
// 2026-01-09: Renamed from BarsPage for disambiguation
import VenueManagerPage from '@/pages/co-pilot/VenueManagerPage';
import BriefingPage from '@/pages/co-pilot/BriefingPage';
import MapPage from '@/pages/co-pilot/MapPage';
import IntelPage from '@/pages/co-pilot/IntelPage';
import AboutPage from '@/pages/co-pilot/AboutPage';
import PolicyPage from '@/pages/co-pilot/PolicyPage';
import SettingsPage from '@/pages/co-pilot/SettingsPage';
import {
  SignInPage,
  SignUpPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  TermsPage,
} from '@/pages/auth';
import { UberCallbackPage } from '@/pages/auth/uber/Callback';
import { GoogleCallbackPage } from '@/pages/auth/google/Callback';
import AuthRedirect from '@/components/auth/AuthRedirect';

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
    // 2026-02-03: Public privacy policy for OAuth providers (Uber requires public access)
    path: '/policy',
    element: <PolicyPage />,
  },
  
  // 2026-02-03: Uber OAuth Callback (Must be public/handled specially)
  {
    path: '/auth/uber/callback',
    element: (
      <ProtectedRoute>
        <UberCallbackPage />
      </ProtectedRoute>
    ),
  },

  // 2026-02-13: Google OAuth Callback (PUBLIC - user is NOT authenticated when arriving from Google)
  {
    path: '/auth/google/callback',
    element: <GoogleCallbackPage />,
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
        path: 'map',
        element: <MapPage />,
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
        path: 'settings',
        element: <SettingsPage />,
      },
    ],
  },
]);
