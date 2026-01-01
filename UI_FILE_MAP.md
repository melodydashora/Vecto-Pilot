# UI_FILE_MAP.md - Component, API, and Event Mapping

**Last Updated:** 2025-12-27 UTC

This document provides a complete mapping of UI components to their source files, API calls, events, and identifies orphaned/redundant files.

---

## TABLE OF CONTENTS

1. [Active UI Components](#active-ui-components)
2. [API Call Mapping](#api-call-mapping)
3. [Custom Events Flow](#custom-events-flow)
4. [Component Import Tree](#component-import-tree)
5. [Orphaned Files (Candidates for Removal)](#orphaned-files-candidates-for-removal)
6. [Potentially Redundant Files (Needs Review)](#potentially-redundant-files-needs-review)
7. [File Quick Reference](#file-quick-reference)

---

## ACTIVE UI COMPONENTS

### Entry Points

| File | Purpose | Status |
|------|---------|--------|
| `client/src/main.tsx` | React app entry point | ✅ Active |
| `client/src/App.tsx` | Root component with RouterProvider | ✅ Active |
| `client/src/routes.tsx` | React Router configuration | ✅ Active |

### Layouts

| File | Purpose | Status |
|------|---------|--------|
| `client/src/layouts/CoPilotLayout.tsx` | Shared layout with conditional GlobalHeader | ✅ Active |

### Pages (Route-Based)

| File | Purpose | Route | Status |
|------|---------|-------|--------|
| `client/src/pages/co-pilot/StrategyPage.tsx` | AI strategy + Smart Blocks + Coach | `/co-pilot/strategy` | ✅ Active |
| `client/src/pages/co-pilot/BarsPage.tsx` | Premium venue listings | `/co-pilot/bars` | ✅ Active |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Weather, traffic, news, events | `/co-pilot/briefing` | ✅ Active |
| `client/src/pages/co-pilot/MapPage.tsx` | Interactive venue map | `/co-pilot/map` | ✅ Active |
| `client/src/pages/co-pilot/IntelPage.tsx` | Rideshare intelligence | `/co-pilot/intel` | ✅ Active |
| `client/src/pages/co-pilot/AboutPage.tsx` | Donation/about (no GlobalHeader) | `/co-pilot/about` | ✅ Active |
| `client/src/pages/co-pilot/PolicyPage.tsx` | Privacy policy | `/co-pilot/policy` | ✅ Active |
| `client/src/pages/co-pilot/index.tsx` | Barrel export | N/A | ✅ Active |
| `client/src/pages/SafeScaffold.tsx` | Fallback error scaffold | N/A | ✅ Active |

### Core Components

| File | Purpose | Used By | Status |
|------|---------|---------|--------|
| `GlobalHeader.tsx` | Location, time, weather display | CoPilotLayout.tsx | ✅ Active |
| `CoachChat.tsx` | AI chat + voice interface | StrategyPage.tsx | ✅ Active |
| `BriefingTab.tsx` | Weather, traffic, news, events | BriefingPage.tsx | ✅ Active |
| `FeedbackModal.tsx` | Venue/strategy feedback dialogs | StrategyPage.tsx | ✅ Active |
| `SmartBlocksStatus.tsx` | Pipeline loading status | StrategyPage.tsx | ✅ Active |
| `BarsTable.tsx` | Venue table display | BarsPage.tsx | ✅ Active |
| `MapTab.tsx` | Interactive map view | MapPage.tsx | ✅ Active |
| `DonationTab.tsx` | Donation/support section | AboutPage.tsx | ✅ Active |
| `InstructionsTab.tsx` | How-to instructions | DonationTab.tsx | ✅ Active |
| `EventsComponent.tsx` | Event cards display | BriefingTab.tsx | ✅ Active |
| `ErrorBoundary.tsx` | React error boundary | App.tsx | ✅ Active |

### Co-Pilot Sub-Components

| File | Purpose | Used By | Status |
|------|---------|---------|--------|
| `co-pilot/BottomTabNavigation.tsx` | Tab navigation bar (React Router) | CoPilotLayout.tsx | ✅ Active |
| `co-pilot/GreetingBanner.tsx` | Welcome/holiday greeting | StrategyPage.tsx | ✅ Active |

### Strategy Components

| File | Purpose | Used By | Status |
|------|---------|---------|--------|
| `strategy/_future/` | Staged strategy components | - | ⏳ Future |

Note: Legacy strategy components (SmartBlocks.tsx, StrategyCoach.tsx, ConsolidatedStrategyComp.tsx) have been removed or moved to `_future/`.

### Contexts

| File | Purpose | Status |
|------|---------|--------|
| `contexts/location-context-clean.tsx` | GPS, weather, AQ, snapshot management | ✅ Active (Core) |
| `contexts/co-pilot-context.tsx` | Shared strategy, blocks, SSE state for all pages | ✅ Active (Core) |

### Hooks

| File | Purpose | Used By | Status |
|------|---------|---------|--------|
| `hooks/use-toast.ts` | Toast notifications | Multiple components | ✅ Active |
| `hooks/use-mobile.tsx` | Mobile detection | UI sidebar | ✅ Active |
| `hooks/useBriefingQueries.ts` | Briefing data queries | BriefingPage.tsx | ✅ Active |
| `hooks/useEnrichmentProgress.ts` | Dynamic progress tracking with timing | StrategyPage.tsx | ✅ Active |
| `hooks/useStrategyPolling.ts` | Strategy fetching with SSE + caching | co-pilot-context.tsx | ✅ Active |
| `hooks/useStrategyLoadingMessages.ts` | Rotating loading messages + time remaining | StrategyPage.tsx | ✅ Active |
| `hooks/useVenueLoadingMessages.ts` | Venue enrichment loading messages | StrategyPage.tsx | ✅ Active |
| `hooks/useTTS.ts` | Text-to-speech with OpenAI | CoachChat.tsx | ✅ Active |
| `hooks/useStrategy.ts` | Legacy strategy hook | ⚠️ Review - may be unused |

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
| `types/app.d.ts` | App type declarations | ✅ Active |
| `types/shims.d.ts` | Module shims | ✅ Active |

### Utilities

| File | Purpose | Status |
|------|---------|--------|
| `utils/co-pilot-helpers.ts` | Auth, logging, helpers | ✅ Active |

### Engine

| File | Purpose | Status |
|------|---------|--------|
| `_future/engine/reflectionEngine.ts` | Reflection/learning engine | ⏳ Staged for future |

### Future Functionality (Staged for Later)

| File | Purpose | Status |
|------|---------|--------|
| `_future/user-settings/vehicleTiers.ts` | Vehicle tier selection for driver profiles | ⏳ Waiting for auth |
| `_future/user-settings/driver.ts` | Driver profile types (vehicle, preferences) | ⏳ Waiting for auth |
| `_future/user-settings/location.ts` | Location preference types (home base, areas) | ⏳ Waiting for auth |
| `_future/user-settings/performance.ts` | Performance tracking types (earnings, ratings) | ⏳ Waiting for auth |
| `_future/user-settings/settings.ts` | User settings types (notifications, display) | ⏳ Waiting for auth |

See `client/src/_future/README.md` for activation instructions.

---

## API CALL MAPPING

### Location & Auth APIs

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/location/resolve` | GET | location-context-clean.tsx | GPS → Address resolution (Plus Code filtered) |
| `/api/location/geocode/reverse` | GET | (internal) | Coords → Address + place_id (rate limited, Plus Code filtered) |
| `/api/location/geocode/forward` | GET | (internal) | Address → Coords + place_id (rate limited, Plus Code filtered) |
| `/api/location/weather` | GET | location-context-clean.tsx | Weather data |
| `/api/location/airquality` | GET | location-context-clean.tsx | Air quality data |
| `/api/location/snapshot` | POST | location-context-clean.tsx | Save snapshot to DB |
| `/api/auth/token` | POST | location-context-clean.tsx | Get JWT token |
| `/api/users/me` | GET | GlobalHeader.tsx | Fresh user location from DB |

### Strategy & Blocks APIs

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/blocks-fast` | POST | co-pilot-context.tsx | Trigger TRIAD pipeline |
| `/api/blocks-fast` | GET | co-pilot-context.tsx | Fetch generated blocks |
| `/api/blocks/strategy/:id` | GET | co-pilot-context.tsx | Fetch strategy content |
| `/api/strategy/:snapshotId` | GET | co-pilot-context.tsx | Fetch strategy status |
| `/api/snapshot/:id` | GET | co-pilot-context.tsx | Fetch snapshot data |

### Briefing APIs

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/briefing/weather/:id` | GET | useBriefingQueries.ts | Weather briefing |
| `/api/briefing/traffic/:id` | GET | useBriefingQueries.ts | Traffic conditions |
| `/api/briefing/rideshare-news/:id` | GET | useBriefingQueries.ts | Rideshare news |
| `/api/briefing/events/:id` | GET | useBriefingQueries.ts | Local events |
| `/api/briefing/school-closures/:id` | GET | useBriefingQueries.ts | School closures |

### Chat & Voice APIs

| Endpoint | Method | Called By | Purpose | Auth |
|----------|--------|-----------|---------|------|
| `/api/chat/:snapshotId/message` | POST (SSE) | CoachChat.tsx | Text chat streaming | Yes |
| `/api/realtime/token` | POST | CoachChat.tsx | Voice API token | **Yes** |
| `/api/tts` | POST | co-pilot.tsx | Text-to-speech | **Yes** |

### Feedback & Actions APIs

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/feedback/venue` | POST | FeedbackModal.tsx | Venue feedback |
| `/api/feedback/strategy` | POST | FeedbackModal.tsx | Strategy feedback |
| `/api/feedback/app` | POST | FeedbackModal.tsx | App feedback |
| `/api/actions` | POST | co-pilot.tsx | Log user actions |
| `/api/closed-venue-reasoning` | POST | co-pilot.tsx | AI reasoning for closed venues |

### Other APIs

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/geocode/reverse` | GET | (unused in client) | Reverse geocoding |
| `/api/timezone` | GET | (unused in client) | Timezone lookup |

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
└─────────────────────────────────────────────────────────────────┘
```

### Event Reference

| Event Name | Dispatched By | Listeners | Payload |
|------------|---------------|-----------|---------|
| `vecto-snapshot-saved` | location-context-clean.tsx | GlobalHeader, CoPilotContext | `{ snapshotId, holiday, is_holiday }` |
| `vecto-strategy-cleared` | location-context-clean.tsx | (internal) | `{}` |
| `vecto-manual-refresh` | GlobalHeader.tsx | location-context-clean | `{}` |
| `vecto-location-refreshed` | GlobalHeader.tsx | (none) | `{}` |

---

## COMPONENT IMPORT TREE

```
main.tsx
└── App.tsx
    ├── RouterProvider (routes.tsx)
    └── routes.tsx
        └── CoPilotLayout.tsx (shared layout)
            ├── LocationProvider (location-context-clean.tsx)
            ├── CoPilotProvider (co-pilot-context.tsx)
            │   ├── useStrategyPolling.ts (SSE + caching)
            │   └── Strategy/Blocks queries
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
            │   │   └── GreetingBanner.tsx
            │   ├── BarsPage.tsx (/co-pilot/bars)
            │   │   └── BarsTable.tsx
            │   ├── BriefingPage.tsx (/co-pilot/briefing)
            │   │   ├── useBriefingQueries.ts
            │   │   └── BriefingTab.tsx → EventsComponent.tsx
            │   ├── MapPage.tsx (/co-pilot/map)
            │   │   └── MapTab.tsx
            │   ├── IntelPage.tsx (/co-pilot/intel)
            │   ├── AboutPage.tsx (/co-pilot/about)
            │   │   └── DonationTab.tsx → InstructionsTab.tsx
            │   └── PolicyPage.tsx (/co-pilot/policy)
            └── BottomTabNavigation.tsx (React Router navigation)
```

---

## ORPHANED FILES (CANDIDATES FOR REMOVAL)

### Already Cleaned Up (Dec 2025)

The following orphaned files have been removed:
- ~~`client/src/services/locationService.ts`~~ - DELETED
- ~~`client/src/services/geocodeService.ts`~~ - DELETED
- ~~`client/src/main-simple.tsx`~~ - DELETED
- ~~`client/src/lib/prompt/baseline.ts`~~ - DELETED
- ~~`client/src/components/strategy/SmartBlocks.tsx`~~ - DELETED
- ~~`client/src/components/strategy/StrategyCoach.tsx`~~ - DELETED
- ~~`client/src/hooks/useDwellTracking.ts`~~ - DELETED

### Remaining Items to Review

| File | Reason | Recommendation |
|------|--------|----------------|
| `client/src/hooks/useStrategy.ts` | May be legacy, check usage | **REVIEW** |
| `client/src/components/_future/MarketIntelligenceBlocks.tsx` | Staged for future | Keep in _future |

---

## POTENTIALLY REDUNDANT FILES (NEEDS REVIEW)

### Client-Side

| File | Issue | Action |
|------|-------|--------|
| `_future/MarketIntelligenceBlocks.tsx` | Staged for future activation | Keep in _future |
| `_future/engine/reflectionEngine.ts` | Staged for Phase 17 | Keep in _future |

### Server-Side (Needs Separate Review)

| File | Issue | Action |
|------|-------|--------|
| `server/lib/ai/llm-router-v2.js` | Used by health endpoint | Keep - provides LLM status |
| `server/lib/strategy/strategy-generator.js` | Entry point for pipeline | Keep - routes to parallel |
| `server/api/research/vector-search.js` | Limited usage | Review for removal |
| `server/api/research/research.js` | Limited usage | Review for removal |

---

## FILE QUICK REFERENCE

### UI Features → Files

| Feature | Files |
|---------|-------|
| **GPS & Location** | `location-context-clean.tsx`, `GlobalHeader.tsx` |
| **Weather Display** | `GlobalHeader.tsx` (reads from context), `BriefingTab.tsx` |
| **Strategy Generation** | `co-pilot-context.tsx` (triggers), blocks-fast API |
| **Venue Blocks** | `StrategyPage.tsx`, `BarsTable.tsx`, `SmartBlocksStatus.tsx` |
| **AI Chat** | `CoachChat.tsx` |
| **Voice Chat** | `CoachChat.tsx` (OpenAI Realtime) |
| **Briefing Tab** | `BriefingPage.tsx`, `BriefingTab.tsx`, `EventsComponent.tsx` |
| **Feedback** | `FeedbackModal.tsx` |
| **Holiday Banner** | `GreetingBanner.tsx`, `GlobalHeader.tsx` |
| **Tab Navigation** | `BottomTabNavigation.tsx` (React Router) |
| **Route Layout** | `CoPilotLayout.tsx`, `routes.tsx` |

### API Routes → Backend Files

| Route Pattern | Backend File |
|---------------|--------------|
| `/api/location/*` | `server/api/location/location.js` |
| `/api/blocks-fast` | `server/api/strategy/blocks-fast.js` |
| `/api/strategy/*` | `server/api/strategy/strategy.js` |
| `/api/briefing/*` | `server/api/briefing/briefing.js` |
| `/api/chat` | `server/api/chat/chat.js` |
| `/api/realtime/*` | `server/api/chat/realtime.js` |
| `/api/feedback/*` | `server/api/feedback/feedback.js` |
| `/api/actions` | `server/api/feedback/actions.js` |
| `/api/auth/*` | `server/api/auth/auth.js` |
| `/api/tts` | `server/api/chat/tts.js` |

---

## SUMMARY

### Active Files Count
- **Entry Points**: 3 (main.tsx, App.tsx, routes.tsx)
- **Layouts**: 1 (CoPilotLayout.tsx)
- **Pages**: 13 (8 co-pilot pages + 5 auth pages + SafeScaffold)
- **Core Components**: 13
- **Sub-Components**: 8 (co-pilot, intel, auth)
- **Strategy Components**: 0 active (legacy moved to _future)
- **Hooks**: 13 active
- **Contexts**: 3 (location-context-clean, co-pilot-context, auth-context)
- **Libraries**: 3 active
- **Types**: 4 active
- **Utilities**: 1
- **Future/Staged**: 10+ files in `_future/`

### Cleanup Status (Dec 2025)

**Completed Cleanup:**
- ✅ `services/` folder - DELETED
- ✅ `main-simple.tsx` - DELETED
- ✅ `lib/prompt/baseline.ts` - DELETED
- ✅ Legacy strategy components - DELETED
- ✅ `hooks/useDwellTracking.ts` - DELETED
- ✅ Orphaned types moved to `_future/user-settings/`

**Remaining Review:**
- `hooks/useStrategy.ts` - May be unused, verify before removal
