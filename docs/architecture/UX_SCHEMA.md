# UX_SCHEMA.md — UI/UX Component Architecture

> **Canonical reference** for React component hierarchy, routing, shared components, design system, layout, and interaction patterns.
> Last updated: 2026-04-10

## Supersedes
- `docs/architecture/client-structure.md` — Client-side structure overview (expanded here)
- `docs/architecture/frontend-optimization.md` — Build optimization, PWA, code splitting (absorbed into Sections 4-7)

---

## Table of Contents

1. [Provider Hierarchy](#1-provider-hierarchy)
2. [Page Routing](#2-page-routing)
3. [Bottom Tab Navigation](#3-bottom-tab-navigation)
4. [Layout Architecture](#4-layout-architecture)
5. [Shared Components (Shadcn/ui)](#5-shared-components-shadcnui)
6. [Design System and Tokens](#6-design-system-and-tokens)
7. [Loading States](#7-loading-states)
8. [Error Boundaries](#8-error-boundaries)
9. [Modal System](#9-modal-system)
10. [Current State](#10-current-state)
11. [Known Gaps](#11-known-gaps)
12. [TODO — Hardening Work](#12-todo--hardening-work)

---

## 1. Provider Hierarchy

**File:** `client/src/App.tsx`

```
ErrorBoundary
  └─ QueryClientProvider (React Query)
       └─ AuthProvider (token, isAuthenticated, login/logout)
            └─ LocationProvider (GPS, coords, city, weather, snapshot)
                 └─ CoPilotProvider (strategy, blocks, briefing, SSE)
                      └─ RouterProvider (React Router)
```

**QueryClient defaults:**
- `retry: 1`
- `staleTime: 5 * 60 * 1000` (5 min)
- `gcTime: 30 * 60 * 1000` (30 min)
- `refetchOnWindowFocus: false` (prevents refetch when switching apps)

---

## 2. Page Routing

**File:** `client/src/routes.tsx`

### Public Pages

| Path | Component | Purpose |
|------|-----------|---------|
| `/auth/sign-in` | SignInPage | Email/password login |
| `/auth/sign-up` | SignUpPage | Registration |
| `/auth/forgot-password` | ForgotPasswordPage | Password reset request |
| `/auth/reset-password` | ResetPasswordPage | Reset confirmation |
| `/auth/google/callback` | GoogleCallbackPage | Google OAuth return |
| `/auth/uber/callback` | UberCallbackPage | Uber OAuth return |
| `/auth/terms` | TermsPage | Terms of service |
| `/policy` | PolicyPage | Privacy policy |
| `/demo` | LandingPage | Feature showcase |
| `/c/:token` | PublicConciergePage | Passenger concierge (QR scan) |

### Authenticated Pages (Co-Pilot)

All wrapped in `CoPilotLayout` — require auth.

| Path | Component | Tab |
|------|-----------|-----|
| `/co-pilot/strategy` | StrategyPage | Strategy (default) |
| `/co-pilot/bars` | VenueManagerPage | Lounges & Bars |
| `/co-pilot/briefing` | BriefingPage | Briefing |
| `/co-pilot/map` | MapPage | Map |
| `/co-pilot/intel` | IntelPage | Intel |
| `/co-pilot/translate` | TranslationPage | Translate |
| `/co-pilot/concierge` | ConciergePage | Concierge |
| `/co-pilot/settings` | SettingsPage | (hamburger) |
| `/co-pilot/schedule` | SchedulePage | (hamburger) |
| `/co-pilot/about` | AboutPage | (hamburger) |
| `/co-pilot/donate` | DonatePage | (hamburger) |
| `/co-pilot/help` | HelpPage | (hamburger) |

### Root Redirect

`/` → AuthRedirect: authenticated → `/co-pilot/strategy`, unauthenticated → `/auth/sign-in`

---

## 3. Bottom Tab Navigation

**File:** `client/src/components/co-pilot/BottomTabNavigation.tsx`

7 tabs, fixed bottom, color-coded:

| Tab | Icon | Color | Path |
|-----|------|-------|------|
| Strategy | Sparkles | Blue | /co-pilot/strategy |
| Lounges & Bars | Wine | Purple | /co-pilot/bars |
| Briefing | MessageSquare | Indigo | /co-pilot/briefing |
| Map | Map | Green | /co-pilot/map |
| Intel | Target | Amber | /co-pilot/intel |
| Translate | Languages | Sky | /co-pilot/translate |
| Concierge | QrCode | Teal | /co-pilot/concierge |

Active tab: icon color + background color + bottom border. Bars tab has animated green pulse indicator.

---

## 4. Layout Architecture

**File:** `client/src/layouts/CoPilotLayout.tsx`

```html
<div class="min-h-screen bg-gray-50">
  <GlobalHeader />          <!-- Location, weather, AQI, snapshot status -->
  <main class="main-content-with-header pb-24">
    <Outlet />              <!-- Page content -->
  </main>
  <BottomTabNavigation />   <!-- Fixed bottom tabs -->
  <Toaster />               <!-- Toast notifications -->
</div>
```

### GlobalHeader

Shows: city/state, weather temp + conditions, AQI badge, snapshot status. Updates reactively from LocationContext.

---

## 5. Shared Components (Shadcn/ui)

**Directory:** `client/src/components/ui/`

40+ Shadcn/ui components including: button, card, dialog, input, textarea, label, select, checkbox, radio-group, toggle, tabs, skeleton, progress, alert, alert-dialog, avatar, badge, breadcrumb, carousel, chart, collapsible, command, context-menu, drawer, dropdown-menu, form, hover-card, input-otp, menubar, navigation-menu, pagination, popover, resizable, scroll-area, separator, sheet, sidebar.

### Key Custom Components

| Component | File | Purpose |
|-----------|------|---------|
| `RideshareCoach.tsx` | components/ | Full chat interface with streaming, notes, voice |
| `CriticalError.tsx` | components/ | Full-screen error for unrecoverable states |
| `FeedbackModal.tsx` | components/ | Venue/strategy/app feedback (1-5 stars + comment) |
| `GlobalHeader.tsx` | components/ | Location + weather bar |
| `SmartBlocksPipeline.tsx` | components/Strategy/ | Venue recommendation cards |
| `BarsMainTab.tsx` | components/ | Bar discovery list |
| `MapTab.tsx` | components/ | Google Maps with markers |

---

## 6. Design System and Tokens

**File:** `tailwind.config.js`

### CSS Variable Color System (HSL)

```css
--background, --foreground
--primary, --primary-foreground
--secondary, --secondary-foreground
--muted, --muted-foreground
--accent, --accent-foreground
--destructive, --destructive-foreground
--border, --input, --ring
--radius (border radius base)
```

### Dark Mode

Supported via `class` strategy (`.dark` on `<html>`). Toggle available.

### Tailwind Content Paths

- `./client/index.html`
- `./client/src/**/*.{ts,tsx,js,jsx}`
- `./shared/**/*.{ts,tsx,js,jsx}`

---

## 7. Loading States

### Skeleton Component

```tsx
<div className="animate-pulse rounded-md bg-muted" />
```

### Progress Bar

`useEnrichmentProgress` hook provides 0–100% progress with phase-aware timing. Animated smoothly (250ms intervals, 30% step).

### React Query Loading

- `isLoading`: True on first fetch (shows skeleton)
- `isFetching`: True on background refetch (no skeleton, smooth transition)
- Pattern: Use `refetchQueries` not `invalidateQueries` to avoid loading flash

---

## 8. Error Boundaries

**File:** `client/src/components/ErrorBoundary.tsx`

- React Class Component with `getDerivedStateFromError()` + `componentDidCatch()`
- Fallback UI: "Something went wrong" + Try Again + Reload Page buttons
- Dev mode: Expandable error details section

### CriticalError

**File:** `client/src/components/CriticalError.tsx`

Full-screen error for unrecoverable states (snapshot missing, snapshot incomplete). Triggered by `setCriticalError()` in CoPilotContext.

---

## 9. Modal System

### Shadcn Dialog

```tsx
<Dialog open={isOpen} onOpenChange={handleClose}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Title</DialogTitle>
      <DialogDescription>Description</DialogDescription>
    </DialogHeader>
    {/* Content */}
    <DialogFooter>
      <Button variant="outline">Cancel</Button>
      <Button>Submit</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### FeedbackModal

Three types: venue, strategy, app. Each submits to different endpoint. Includes sentiment selection (thumbs up/down), optional comment (1000 char limit), character counter. Closes immediately for UX, submits in background.

---

## 10. Current State

| Area | Status |
|------|--------|
| Provider hierarchy (Auth→Location→CoPilot) | Working |
| 7-tab navigation (color-coded) | Working |
| GlobalHeader (location + weather) | Working |
| Shadcn/ui component library | Working (40+ components) |
| Dark mode | Implemented (class strategy) |
| Error boundary | Working |
| Critical error screen | Working |
| Feedback modal | Working |
| Skeleton loading states | Working |
| Progress bar (pipeline phases) | Working |

---

## 11. Known Gaps

1. **No component storybook** — No isolated component documentation or visual testing.
2. **No responsive breakpoint testing** — Mobile-first design assumed but not systematically verified.
3. **No accessibility audit** — ARIA labels, keyboard navigation, screen reader support not verified.
4. **No animation system** — Animations are ad-hoc Tailwind classes, no design system tokens for motion.
5. **Toast notification inconsistency** — Some operations use toasts, others use inline messages.

---

## 12. TODO — Hardening Work

- [ ] **Add Storybook** — Component catalog for design review and testing
- [ ] **Accessibility audit** — WCAG 2.1 AA compliance check
- [ ] **Responsive testing** — Verify all pages at 320px, 375px, 768px, 1024px
- [ ] **Animation tokens** — Standardize transition durations and easing curves
- [ ] **Consistent toast usage** — All mutations should use toast for success/error feedback

---

## Key Files

| File | Purpose |
|------|---------|
| `client/src/App.tsx` | Root provider hierarchy |
| `client/src/routes.tsx` | Page routing |
| `client/src/layouts/CoPilotLayout.tsx` | Main layout |
| `client/src/components/co-pilot/BottomTabNavigation.tsx` | Tab navigation |
| `client/src/components/ErrorBoundary.tsx` | Error boundary |
| `client/src/components/ui/` | 40+ Shadcn/ui components |
| `tailwind.config.js` | Design tokens |
