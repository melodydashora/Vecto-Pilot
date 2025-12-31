// client/src/routes.tsx
// React Router configuration for co-pilot pages and authentication

import { createBrowserRouter, Navigate } from 'react-router-dom';
import CoPilotLayout from '@/layouts/CoPilotLayout';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import StrategyPage from '@/pages/co-pilot/StrategyPage';
import BarsPage from '@/pages/co-pilot/BarsPage';
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

export const router = createBrowserRouter([
  // ═══════════════════════════════════════════════════════════════════════════
  // Root - Redirects to Sign In (landing page)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    path: '/',
    element: <Navigate to="/auth/sign-in" replace />,
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
        element: <BarsPage />,
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
