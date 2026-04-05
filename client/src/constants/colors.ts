// client/src/constants/colors.ts
// Shared color palette for the application.
//
// 2026-04-05: Extracted from existing UI patterns.
// Import these constants instead of hardcoding hex values.

export const COLORS = {
  // Primary gradient (purple → blue)
  primary: {
    purple: '#7C3AED',
    blue: '#2563EB',
    gradient: 'linear-gradient(135deg, #7C3AED, #2563EB)',
    gradientTailwind: 'from-purple-600 to-blue-600',
  },

  // Accent
  accent: '#3B82F6',

  // Backgrounds
  background: {
    primary: '#FFFFFF',
    card: 'rgba(255, 255, 255, 0.8)', // semi-transparent with backdrop blur
    dark: '#0F172A', // slate-900 (rider panel, dark mode)
  },

  // Text
  text: {
    primary: '#111827',   // gray-900
    secondary: '#6B7280', // gray-500
    muted: '#9CA3AF',     // gray-400
    inverse: '#FFFFFF',
  },

  // Status
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
} as const;

// Tailwind class helpers for common patterns
export const TW = {
  primaryGradient: 'bg-gradient-to-r from-purple-600 to-blue-600',
  primaryGradientText: 'bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent',
  cardBlur: 'bg-white/80 backdrop-blur-sm',
} as const;
