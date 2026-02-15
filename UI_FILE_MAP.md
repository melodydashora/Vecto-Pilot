
# UI_FILE_MAP.md - Component, API, and Event Mapping

**Last Updated:** 2026-02-15 UTC

This document provides a complete mapping of UI components to their source files, API calls, events, and identifies orphaned/redundant files.

---

## TABLE OF CONTENTS

1. [Active UI Components](#active-ui-components)
2. [API Call Mapping](#api-call-mapping)
3. [Custom Events Flow](#custom-events-flow)
4. [Component Import Tree](#component-import-tree)
5. [Authentication Flow](#authentication-flow)
6. [File Quick Reference](#file-quick-reference)

---

## ACTIVE UI COMPONENTS

### Entry Points

| File | Purpose | Status |
|------|---------|--------|
| `client/src/main.tsx` | React app entry point | ✅ Active |
| `client/src/App.tsx` | Root component with AuthProvider, CoPilotProvider, RouterProvider | ✅ Active |
| `client/src/routes.tsx` | React Router configuration (20 routes) | ✅ Active |

### Providers & Contexts

| File | Purpose | Status |
|------|---------|--------|
| `client/src/contexts/auth-context.tsx` | Authentication state, JWT tokens, user profile | ✅ Active (Core) |
| `client/src/contexts/co-pilot-context.tsx` | Shared strategy, blocks, SSE state for all pages | ✅ Active (Core) |
| `client/src/contexts/location-context-clean.tsx` | GPS, weather, AQ, snapshot management (two-phase UI update) | ✅ Active (Core) |

### Layouts

| File | Purpose | Status |
|------|---------|--------|
| `client/src/layouts/CoPilotLayout.tsx` | Shared layout with conditional GlobalHeader + BottomTabNavigation | ✅ Active |

### Co-Pilot Pages (Protected Routes)

| File | Purpose | Route | Status |
|------|---------|-------|--------|
| `client/src/pages/co-pilot/StrategyPage.tsx` | AI strategy + Smart Blocks + Coach | `/co-pilot/strategy` | ✅ Active |
| `client/src/pages/co-pilot/BarsPage.tsx` | Premium venue listings ($$ and above, open only) | `/co-pilot/bars` | ✅ Active |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Weather, traffic, news, events briefing | `/co-pilot/briefing` | ✅ Active |
| `client/src/pages/co-pilot/MapPage.tsx` | Interactive venue map with bars + events | `/co-pilot/map` | ✅ Active |
| `client/src/pages/co-pilot/IntelPage.tsx` | Rideshare intelligence (deadhead, zones, strategy cards) | `/co-pilot/intel` | ✅ Active |
| `client/src/pages/co-pilot/AboutPage.tsx` | Donation/about (no GlobalHeader) | `/co-pilot/about` | ✅ Active |
| `client/src/pages/co-pilot/PolicyPage.tsx` | Privacy policy | `/co-pilot/policy` | ✅ Active |
| `client/src/pages/co-pilot/SettingsPage.tsx` | User profile + vehicle settings | `/co-pilot/settings` | ✅ Active |
| `client/src/pages/co-pilot/OmniPage.tsx` | Omni-Presence signal terminal | `/co-pilot/omni` | ✅ Active (Level 4) |
| `client/src/pages/co-pilot/index.tsx` | Barrel export | N/A | ✅ Active |

### Auth Pages (Public Routes)

| File | Purpose | Route | Status |
|------|---------|-------|--------|
| `client/src/pages/auth/SignInPage.tsx` | Email/password sign in | `/auth/sign-in` | ✅ Active |
| `client/src/pages/auth/SignUpPage.tsx` | User registration with vehicle info | `/auth/sign-up` | ✅ Active |
| `client/src/pages/auth/ForgotPasswordPage.tsx` | Password reset request | `/auth/forgot-password` | ✅ Active |
| `client/src/pages/auth/ResetPasswordPage.tsx` | Password reset with code | `/auth/reset-password` | ✅ Active |
| `client/src/pages/auth/TermsPage.tsx` | Terms of service | `/auth/terms` | ✅ Active |
| `client/src/pages/auth/GoogleCallbackPage.tsx` | Google OAuth code exchange | `/auth/google/callback` | ✅ Active |
| `client/src/pages/auth/UberCallbackPage.tsx` | Uber OAuth code exchange | `/auth/uber/callback` | ✅ Active |
| `client/src/pages/auth/index.ts` | Barrel export | N/A | ✅ Active |

### Auth Components

| File | Purpose | Used By | Status |
|------|---------|---------|--------|
| `client/src/components/auth/AuthRedirect.tsx` | Smart redirect (/ → /co-pilot or /auth) | routes.tsx | ✅ Active |
| `client/src/components/auth/ProtectedRoute.tsx` | Auth wrapper for protected routes | routes.tsx | ✅ Active |

### Core Components

| File | Purpose | Used By | Status |
|------|---------|---------|--------|
| `GlobalHeader.tsx` | Location, time, weather display | CoPilotLayout.tsx | ✅ Active |
| `CoachChat.tsx` | AI chat + voice interface (GPT-5.2) | StrategyPage.tsx | ✅ Active |
| `BriefingTab.tsx` | Weather, traffic, news, events | BriefingPage.tsx | ✅ Active |
| `FeedbackModal.tsx` | Venue/strategy feedback dialogs | StrategyPage.tsx | ✅ Active |
| `SmartBlocksStatus.tsx` | Pipeline loading status with progress bar | StrategyPage.tsx | ✅ Active |
| `BarsTable.tsx` | Venue table display with open/closing status | BarsPage.tsx, StrategyPage.tsx | ✅ Active |
| `MapTab.tsx` | Interactive map view with venues, bars, events | MapPage.tsx | ✅ Active |
| `DonationTab.tsx` | Donation/support section | AboutPage.tsx | ✅ Active |
| `InstructionsTab.tsx` | How-to instructions | DonationTab.tsx | ✅ Active |
| `EventsComponent.tsx` | Event cards display | BriefingTab.tsx | ✅ Active |
| `ErrorBoundary.tsx` | React error boundary | App.tsx | ✅ Active |
| `BarTab.tsx` | Bar listings with filters | BarsPage.tsx | ✅ Active |
| `RideshareIntelTab.tsx` | Market intelligence display | IntelPage.tsx | ✅ Active |

### Omni-Presence Components (Level 4)

| File | Purpose | Used By | Status |
|------|---------|---------|--------|
| `client/src/components/omni/SignalTerminal.tsx` | Real-time offer analysis display | OmniPage.tsx | ✅ Active (Level 4) |
| `client/src/components/omni/OfferCard.tsx` | Individual offer display card | SignalTerminal.tsx | ✅ Active (Level 4) |
| `client/src/components/omni/DecisionBadge.tsx` | ACCEPT/REJECT badge with reasoning | OfferCard.tsx | ✅ Active (Level 4) |

### Co-Pilot Sub-Components

| File | Purpose | Used By | Status |
|------|---------|---------|--------|
| `co-pilot/BottomTabNavigation.tsx` | Tab navigation bar (React Router) | CoPilotLayout.tsx | ✅ Active |
| `co-pilot/GreetingBanner.tsx` | Welcome/holiday greeting | StrategyPage.tsx | ✅ Active |

### Intel Sub-Components

| File | Purpose | Used By | Status |
|------|---------|---------|--------|
| `intel/DeadheadCalculator.tsx` | Distance-based deadhead risk calculator | RideshareIntelTab.tsx | ✅ Active |
| `intel/ZoneCards.tsx` | Zone intelligence cards | RideshareIntelTab.tsx | ✅ Active |
| `intel/StrategyCards.tsx` | Strategy tip cards | RideshareIntelTab.tsx | ✅ Active |

### Hooks

| File | Purpose | Used By | Status |
|------|---------|---------|--------|
| `hooks/use-toast.ts` | Toast notifications | Multiple components | ✅ Active |
| `hooks/use-mobile.tsx` | Mobile detection | UI sidebar | ✅ Active |
| `hooks/useBriefingQueries.ts` | Briefing data queries (6 endpoints) | BriefingPage.tsx | ✅ Active |
| `hooks/useEnrichmentProgress.ts` | Dynamic progress tracking with timing | StrategyPage.tsx | ✅ Active |
| `hooks/useStrategyPolling.ts` | Strategy fetching with SSE + caching | co-pilot-context.tsx | ✅ Active |
| `hooks/useStrategyLoadingMessages.ts` | Rotating loading messages + time remaining | StrategyPage.tsx | ✅ Active |
| `hooks/useVenueLoadingMessages.ts` | Venue enrichment loading messages | StrategyPage.tsx | ✅ Active |
| `hooks/useTTS.ts` | Text-to-speech with OpenAI | CoachChat.tsx | ✅ Active |
| `hooks/useBarsQuery.ts` | Bar listings query | BarsPage.tsx | ✅ Active |
| `hooks/useMemory.ts` | Memory persistence utilities | Multiple | ✅ Active |
| `hooks/useMarketIntelligence.ts` | Market intelligence queries | IntelPage.tsx | ✅ Active |
| `hooks/usePlatformData.ts` | Platform data queries (countries, markets, etc.) | SettingsPage.tsx | ✅ Active |
| `hooks/useChatPersistence.ts` | Chat history persistence | CoachChat.tsx | ✅ Active |

### Tests

| File | Purpose | Status |
|------|---------|--------|
| `tests/BriefingPageEvents.test.tsx` | Unit tests for BriefingPage data binding | ✅ Active |
| `tests/BriefingTabIntegration.test.tsx` | Integration tests for event filtering logic | ✅ Active |
| `tests/useChatPersistence.test.tsx` | Unit tests for chat persistence hook | ✅ Active |
| `jest.client.config.js` | Client-side Jest configuration | ✅ Active |

### Libraries

| File | Purpose | Status |
|------|---------|--------|
| `lib/utils.ts` | Utility functions (cn) | ✅ Active |
| `lib/daypart.ts` | Time classification | ✅ Active |
| `lib/queryClient.ts` | React Query client + apiRequest | ✅ Active |

### Types

| File | Purpose | Status |
|------|---------|--------|
| `types/co-pilot.ts` | Co-pilot types (SmartBlock, etc.) | ✅ Active |
| `types/auth.ts` | Auth types (User, AuthState, etc.) | ✅ Active |
| `types/app.d.ts` | App type declarations | ✅ Active |
| `types/shims.d.ts` | Module shims | ✅ Active |

### Utilities

| File | Purpose | Status |
|------|---------|--------|
| `utils/co-pilot-helpers.ts` | Auth headers, logging, helpers | ✅ Active |

### Future Functionality (Staged for Later)

| File | Purpose | Status |
|------|---------|--------|
| `_future/engine/reflectionEngine.ts` | Reflection/learning engine | ⏳ Staged |
| `_future/user-settings/vehicleTiers.ts` | Vehicle tier selection | ⏳ Staged |
| `_future/user-settings/driver.ts` | Driver profile types | ⏳ Staged |
| `_future/user-settings/location.ts` | Location preference types | ⏳ Staged |
| `_future/user-settings/performance.ts` | Performance tracking types | ⏳ Staged |
| `_future/user-settings/settings.ts` | User settings types | ⏳ Staged |
| `components/_future/MarketIntelligenceBlocks.tsx` | Advanced venue blocks | ⏳ Staged |
| `components/strategy/_future/*` | Legacy strategy components | ⏳ Archived |

---

## API CALL MAPPING

### Auth APIs

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/auth/sign-up` | POST | SignUpPage.tsx | Create new user account |
| `/api/auth/sign-in` | POST | SignInPage.tsx | Authenticate user, get tokens |
| `/api/auth/verify-email` | POST | (email link) | Verify email address |
| `/api/auth/refresh` | POST | auth-context.tsx | Refresh access token |
| `/api/auth/forgot-password` | POST | ForgotPasswordPage.tsx | Request password reset |
| `/api/auth/reset-password` | POST | ResetPasswordPage.tsx | Reset password with code |
| `/api/auth/sign-out` | POST | auth-context.tsx | Sign out user |
| `/api/auth/profile` | GET | auth-context.tsx | Get current user profile |
| `/api/auth/profile` | PUT | SettingsPage.tsx | Update user profile |

### Location & Snapshot APIs

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/location/resolve` | GET | location-context-clean.tsx | GPS → Address resolution (market timezone fast-path) |
| `/api/location/ip` | GET | location-context-clean.tsx | IP-based fallback |
| `/api/location/weather` | GET | location-context-clean.tsx | Weather data |
| `/api/location/airquality` | GET | location-context-clean.tsx | Air quality data |
| `/api/snapshot` | POST | location-context-clean.tsx | Save snapshot to DB |
| `/api/snapshot/:id` | GET | co-pilot-context.tsx | Fetch snapshot data |
| `/api/users/me` | GET | GlobalHeader.tsx | Fresh user location from DB |

### Strategy & Blocks APIs

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/blocks-fast` | POST | co-pilot-context.tsx | Trigger TRIAD pipeline |
| `/api/blocks-fast` | GET | co-pilot-context.tsx | Fetch generated blocks |
| `/api/blocks/strategy/:id` | GET | co-pilot-context.tsx | Fetch strategy content |
| `/api/strategy/:snapshotId` | GET | co-pilot-context.tsx | Fetch strategy status |
| `/api/strategy/events` | SSE | co-pilot-context.tsx | Real-time strategy updates |

### Briefing APIs

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/briefing/weather/:id` | GET | useBriefingQueries.ts | Weather briefing |
| `/api/briefing/traffic/:id` | GET | useBriefingQueries.ts | Traffic conditions |
| `/api/briefing/rideshare-news/:id` | GET | useBriefingQueries.ts | Rideshare news |
| `/api/briefing/events/:id` | GET | useBriefingQueries.ts | Local events |
| `/api/briefing/school-closures/:id` | GET | useBriefingQueries.ts | School closures |
| `/events` | SSE | useBriefingQueries.ts | Real-time briefing updates |

### Chat & Voice APIs

| Endpoint | Method | Called By | Purpose | Auth |
|----------|--------|-----------|---------|------|
| `/api/chat/:snapshotId/message` | POST (SSE) | CoachChat.tsx | Text chat streaming | ✅ Required |
| `/api/realtime/token` | POST | CoachChat.tsx | Voice API token | ✅ Required |
| `/api/tts` | POST | CoachChat.tsx | Text-to-speech | ✅ Required |

### Venue APIs

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/venues/nearby` | GET | BarsPage.tsx, MapPage.tsx | Bar listings with hours |
| `/api/venue/events` | GET | MapPage.tsx | Venue-specific events |
| `/api/closed-venue-reasoning` | POST | StrategyPage.tsx | AI reasoning for closed venues |

### Feedback & Actions APIs

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/feedback/venue` | POST | FeedbackModal.tsx | Venue feedback |
| `/api/feedback/strategy` | POST | FeedbackModal.tsx | Strategy feedback |
| `/api/feedback/app` | POST | FeedbackModal.tsx | App feedback |
| `/api/actions` | POST | StrategyPage.tsx | Log user actions |

### Platform Data APIs

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/platform/countries-dropdown` | GET | SettingsPage.tsx | Countries dropdown |
| `/api/platform/regions-dropdown` | GET | SettingsPage.tsx | States/provinces dropdown |
| `/api/platform/markets-dropdown` | GET | SettingsPage.tsx | Markets dropdown |
| `/api/platform/lookup` | GET | IntelPage.tsx | City market lookup |

### Vehicle Data APIs

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/vehicle/years` | GET | SettingsPage.tsx | Vehicle years dropdown |
| `/api/vehicle/makes` | GET | SettingsPage.tsx | Vehicle makes dropdown |
| `/api/vehicle/models` | GET | SettingsPage.tsx | Vehicle models dropdown |

### Intelligence APIs

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/intelligence/coach/:market` | GET | IntelPage.tsx | Market intelligence for coach |
| `/api/intelligence/lookup` | GET | IntelPage.tsx | City → market mapping |

### Omni-Presence / Hooks APIs (Level 4)

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/hooks/analyze-offer` | POST | iOS Siri Shortcut | Analyze ride offer from OCR text |
| `/api/hooks/signals` | GET | SignalTerminal.tsx | Fetch recent intercepted signals |
| `/api/hooks/signals/stream` | SSE | SignalTerminal.tsx | Real-time signal updates |
| `/api/hooks/signal/:id/override` | PUT | OfferCard.tsx | Override AI decision |

---

## CUSTOM EVENTS FLOW

```
┌─────────────────────────────────────────────────────────────────┐
│                      EVENT FLOW DIAGRAM                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  LocationContext                                                 │
│       │                                                          │
│       ├──► dispatch: vecto-snapshot-saved                        │
│       │         │                                                │
│       │         ├──► GlobalHeader (listens)                      │
│       │         │         └── Updates holiday display            │
│       │         │                                                │
│       │         └──► CoPilotContext (listens)                    │
│       │                   └── Triggers POST /api/blocks-fast     │
│       │                                                          │
│       └──► dispatch: vecto-strategy-cleared                      │
│                   └── Clears localStorage strategy               │
│                                                                  │
│  GlobalHeader                                                    │
│       │                                                          │
│       ├──► dispatch: vecto-manual-refresh                        │
│       │         └── User clicked refresh button                  │
│       │                                                          │
│       └──► dispatch: vecto-location-refreshed                    │
│                   └── Refresh completed                          │
│                                                                  │
│  AuthContext                                                     │
│       │                                                          │
│       ├──► dispatch: vecto-auth-changed                          │
│       │         └── User signed in/out                           │
│       │                                                          │
│       └──► dispatch: vecto-profile-updated                       │
│                   └── Profile edited                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Event Reference

| Event Name | Dispatched By | Listeners | Payload |
|------------|---------------|-----------|---------|
| `vecto-snapshot-saved` | location-context-clean.tsx | GlobalHeader, CoPilotContext | `{ snapshotId, holiday, is_holiday }` |
| `vecto-strategy-cleared` | location-context-clean.tsx | (internal) | `{}` |
| `vecto-manual-refresh` | GlobalHeader.tsx | location-context-clean | `{}` |
| `vecto-location-refreshed` | GlobalHeader.tsx | (none) | `{}` |
| `vecto-auth-changed` | auth-context.tsx | App.tsx, routes | `{ isAuthenticated }` |
| `vecto-profile-updated` | auth-context.tsx | SettingsPage | `{ profile }` |

---

## COMPONENT IMPORT TREE

```
main.tsx
└── App.tsx
    ├── AuthProvider (auth-context.tsx)
    ├── CoPilotProvider (co-pilot-context.tsx)
    │   ├── useStrategyPolling.ts (SSE + caching)
    │   └── Strategy/Blocks queries
    ├── QueryClientProvider (React Query)
    └── RouterProvider (routes.tsx)
        ├── / → AuthRedirect (smart routing)
        ├── /auth/* → Public auth pages (no layout)
        │   ├── SignInPage.tsx
        │   ├── SignUpPage.tsx
        │   ├── ForgotPasswordPage.tsx
        │   ├── ResetPasswordPage.tsx
        │   └── TermsPage.tsx
        └── /co-pilot/* → ProtectedRoute → CoPilotLayout
            ├── LocationProvider (location-context-clean.tsx)
            ├── GlobalHeader.tsx (conditional - hidden on /about)
            │   ├── LocationContext
            │   ├── use-toast.ts
            │   └── lib/daypart.ts
            ├── <Outlet /> (renders current page)
            │   ├── StrategyPage.tsx (/co-pilot/strategy)
            │   │   ├── CoPilotContext (strategy, blocks)
            │   │   ├── useEnrichmentProgress.ts
            │   │   ├── useStrategyLoadingMessages.ts
            │   │   ├── useVenueLoadingMessages.ts
            │   │   ├── FeedbackModal.tsx
            │   │   ├── CoachChat.tsx → useTTS.ts
            │   │   ├── SmartBlocksStatus.tsx
            │   │   ├── BarsTable.tsx
            │   │   └── GreetingBanner.tsx
            │   ├── BarsPage.tsx (/co-pilot/bars)
            │   │   ├── useBarsQuery.ts
            │   │   └── BarTab.tsx → BarsTable.tsx
            │   ├── BriefingPage.tsx (/co-pilot/briefing)
            │   │   ├── useBriefingQueries.ts
            │   │   └── BriefingTab.tsx → EventsComponent.tsx
            │   ├── MapPage.tsx (/co-pilot/map)
            │   │   ├── useBarsQuery.ts
            │   │   ├── useActiveEventsQuery.ts
            │   │   └── MapTab.tsx
            │   ├── IntelPage.tsx (/co-pilot/intel)
            │   │   ├── useMarketIntelligence.ts
            │   │   └── RideshareIntelTab.tsx
            │   │       ├── DeadheadCalculator.tsx
            │   │       ├── ZoneCards.tsx
            │   │       └── StrategyCards.tsx
            │   ├── AboutPage.tsx (/co-pilot/about)
            │   │   └── DonationTab.tsx → InstructionsTab.tsx
            │   ├── PolicyPage.tsx (/co-pilot/policy)
            │   ├── SettingsPage.tsx (/co-pilot/settings)
            │   │   └── usePlatformData.ts
            │   └── OmniPage.tsx (/co-pilot/omni) [Level 4]
            │       └── SignalTerminal.tsx
            │           ├── OfferCard.tsx
            │           └── DecisionBadge.tsx
            └── BottomTabNavigation.tsx (React Router navigation)
```

---

## AUTHENTICATION FLOW

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. User visits / → AuthRedirect.tsx                             │
│     ├── If authenticated → redirect to /co-pilot/strategy       │
│     └── If not authenticated → redirect to /auth/sign-in        │
│                                                                  │
│  2. User signs up → SignUpPage.tsx                               │
│     ├── POST /api/auth/sign-up                                   │
│     ├── Email verification sent                                  │
│     └── Auto sign-in after verification                          │
│                                                                  │
│  3. User signs in → SignInPage.tsx                               │
│     ├── POST /api/auth/sign-in                                   │
│     ├── Receive access_token (15min) + refresh_token (7d)        │
│     ├── Store in AuthContext (memory + localStorage)             │
│     └── Redirect to /co-pilot/strategy                           │
│                                                                  │
│  4. Protected routes → ProtectedRoute.tsx                        │
│     ├── Check AuthContext.isAuthenticated                        │
│     ├── If false → redirect to /auth/sign-in                     │
│     └── If true → render children                                │
│                                                                  │
│  5. API calls → utils/co-pilot-helpers.ts                        │
│     ├── getAuthHeader() adds Authorization: Bearer {token}       │
│     └── Backend middleware verifies JWT                          │
│                                                                  │
│  6. Token refresh → auth-context.tsx                             │
│     ├── When access_token expires (15min)                        │
│     ├── POST /api/auth/refresh with refresh_token                │
│     ├── Receive new access_token                                 │
│     └── Update AuthContext state                                 │
│                                                                  │
│  7. Sign out → auth-context.tsx                                  │
│     ├── POST /api/auth/sign-out                                  │
│     ├── Clear tokens from memory + localStorage                  │
│     ├── Dispatch vecto-auth-changed event                        │
│     └── Redirect to /auth/sign-in                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## FILE QUICK REFERENCE

### UI Features → Files

| Feature | Files |
|---------|-------|
| **Authentication** | `auth-context.tsx`, `AuthRedirect.tsx`, `ProtectedRoute.tsx`, auth pages |
| **GPS & Location** | `location-context-clean.tsx` (two-phase UI), `GlobalHeader.tsx` |
| **Weather Display** | `GlobalHeader.tsx`, `BriefingTab.tsx` |
| **Strategy Generation** | `co-pilot-context.tsx`, blocks-fast API |
| **Venue Blocks** | `StrategyPage.tsx`, `BarsTable.tsx`, `SmartBlocksStatus.tsx` |
| **AI Chat** | `CoachChat.tsx` (GPT-5.2 text) |
| **Voice Chat** | `CoachChat.tsx` (OpenAI Realtime) |
| **Briefing Tab** | `BriefingPage.tsx`, `BriefingTab.tsx`, `EventsComponent.tsx` |
| **Map View** | `MapPage.tsx`, `MapTab.tsx` |
| **Intelligence** | `IntelPage.tsx`, `RideshareIntelTab.tsx`, intel components |
| **Settings** | `SettingsPage.tsx`, `usePlatformData.ts` |
| **Omni-Presence** | `OmniPage.tsx`, `SignalTerminal.tsx`, `OfferCard.tsx` [Level 4] |
| **Feedback** | `FeedbackModal.tsx` |
| **Holiday Banner** | `GreetingBanner.tsx`, `GlobalHeader.tsx` |
| **Tab Navigation** | `BottomTabNavigation.tsx` (React Router) |
| **Route Layout** | `CoPilotLayout.tsx`, `routes.tsx` |

### API Routes → Backend Files

| Route Pattern | Backend File |
|---------------|--------------|
| `/api/auth/*` | `server/api/auth/auth.js` |
| `/api/location/*` | `server/api/location/location.js` |
| `/api/snapshot/*` | `server/api/location/snapshot.js` |
| `/api/blocks-fast` | `server/api/strategy/blocks-fast.js` |
| `/api/strategy/*` | `server/api/strategy/strategy.js` |
| `/api/briefing/*` | `server/api/briefing/briefing.js` |
| `/api/chat/*` | `server/api/chat/chat.js` |
| `/api/realtime/*` | `server/api/chat/realtime.js` |
| `/api/feedback/*` | `server/api/feedback/feedback.js` |
| `/api/actions` | `server/api/feedback/actions.js` |
| `/api/tts` | `server/api/chat/tts.js` |
| `/api/venues/*` | `server/api/venue/venue-intelligence.js` |
| `/api/platform/*` | `server/api/platform/index.js` |
| `/api/vehicle/*` | `server/api/vehicle/vehicle.js` |
| `/api/intelligence/*` | `server/api/intelligence/index.js` |
| `/api/hooks/*` | `server/api/hooks/analyze-offer.js` [Level 4] |

---

## SUMMARY

### Active Files Count
- **Entry Points**: 3 (main.tsx, App.tsx, routes.tsx)
- **Providers**: 3 (AuthProvider, CoPilotProvider, LocationProvider)
- **Layouts**: 1 (CoPilotLayout.tsx)
- **Pages**: 14 (9 co-pilot + 5 auth)
- **Core Components**: 13+
- **Sub-Components**: 11+ (co-pilot, intel, auth, omni)
- **Hooks**: 13 active
- **Libraries**: 3 active
- **Types**: 4 active
- **Utilities**: 1
- **Future/Staged**: 10+ files in `_future/`

### Cleanup Status (Feb 2026)

**Completed:**
- ✅ Auth system fully integrated
- ✅ Route-based architecture with React Router
- ✅ CoPilotContext persists across routes
- ✅ Protected routes with JWT authentication
- ✅ Settings page with profile editing
- ✅ Platform data integration for dropdowns
- ✅ Level 4 Architecture: Omni-Presence / Siri Interceptor

**Active Features:**
- ✅ 9 co-pilot pages (strategy, bars, briefing, map, intel, about, policy, settings, omni)
- ✅ 5 auth pages (sign-in, sign-up, forgot, reset, terms)
- ✅ Real-time updates via SSE
- ✅ Smart Blocks with NOW strategy (top 3 Grade A, ≥1mi apart)
- ✅ AI Coach with text + voice
- ✅ Market intelligence system
- ✅ Siri Interceptor (headless client integration via iOS Shortcuts)

---

**End of UI File Map**
