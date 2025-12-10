# UI_FILE_MAP.md - Component, API, and Event Mapping

**Last Updated:** 2025-12-10 UTC

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
| `client/src/App.tsx` | Root component with providers | ✅ Active |

### Pages

| File | Purpose | Route | Status |
|------|---------|-------|--------|
| `client/src/pages/co-pilot.tsx` | Main Co-Pilot dashboard | `/` | ✅ Active |
| `client/src/pages/SafeScaffold.tsx` | Fallback error scaffold | N/A | ✅ Active |

### Core Components

| File | Purpose | Used By | Status |
|------|---------|---------|--------|
| `GlobalHeader.tsx` | Location, time, weather display | App.tsx | ✅ Active |
| `CoachChat.tsx` | AI chat + voice interface | co-pilot.tsx | ✅ Active |
| `BriefingTab.tsx` | Weather, traffic, news, events | co-pilot.tsx | ✅ Active |
| `FeedbackModal.tsx` | Venue/strategy feedback dialogs | co-pilot.tsx | ✅ Active |
| `SmartBlocksStatus.tsx` | Pipeline loading status | co-pilot.tsx | ✅ Active |
| `BarsTable.tsx` | Venue table display | co-pilot.tsx | ✅ Active |
| `MapTab.tsx` | Interactive map view | co-pilot.tsx | ✅ Active |
| `DonationTab.tsx` | Donation/support section | co-pilot.tsx | ✅ Active |
| `InstructionsTab.tsx` | How-to instructions | DonationTab.tsx | ✅ Active |
| `EventsComponent.tsx` | Event cards display | BriefingTab.tsx | ✅ Active |
| `ErrorBoundary.tsx` | React error boundary | App.tsx | ✅ Active |
| `MarketIntelligenceBlocks.tsx` | Market intelligence display | co-pilot.tsx (aliased as unused) | ⚠️ Imported but unused |

### Co-Pilot Sub-Components

| File | Purpose | Used By | Status |
|------|---------|---------|--------|
| `co-pilot/BottomTabNavigation.tsx` | Tab navigation bar | co-pilot.tsx | ✅ Active |
| `co-pilot/GreetingBanner.tsx` | Welcome/holiday greeting | co-pilot.tsx | ✅ Active |

### Strategy Components

| File | Purpose | Used By | Status |
|------|---------|---------|--------|
| `strategy/ConsolidatedStrategyComp.tsx` | Strategy display | co-pilot.tsx (aliased as unused) | ⚠️ Imported but unused |
| `strategy/SmartBlocks.tsx` | Smart blocks display | NONE | ❌ Orphaned |
| `strategy/StrategyCoach.tsx` | Strategy coach UI | NONE | ❌ Orphaned |

### Contexts

| File | Purpose | Status |
|------|---------|--------|
| `contexts/location-context-clean.tsx` | GPS, weather, AQ, snapshot management | ✅ Active (Core) |

### Hooks

| File | Purpose | Used By | Status |
|------|---------|---------|--------|
| `hooks/use-toast.ts` | Toast notifications | Multiple components | ✅ Active |
| `hooks/use-mobile.tsx` | Mobile detection | UI sidebar | ✅ Active |
| `hooks/useBriefingQueries.ts` | Briefing data queries | co-pilot.tsx | ✅ Active |
| `hooks/useEnrichmentProgress.ts` | Progress tracking | co-pilot.tsx | ✅ Active |
| `hooks/useStrategy.ts` | Strategy polling | strategy/* components | ⚠️ Used by orphaned files |
| `hooks/useDwellTracking.ts` | Venue dwell time tracking | NONE | ❌ Orphaned |

### Libraries

| File | Purpose | Status |
|------|---------|--------|
| `lib/utils.ts` | Utility functions (cn) | ✅ Active |
| `lib/daypart.ts` | Time classification | ✅ Active |
| `lib/queryClient.ts` | React Query client + apiRequest | ✅ Active |
| `lib/prompt/baseline.ts` | Prompt templates | ❌ Orphaned |

### Services

| File | Purpose | Status |
|------|---------|--------|
| `services/geocodeService.ts` | Geocoding service | ❌ Orphaned |
| `services/locationService.ts` | Location service | ❌ Orphaned |

### Types

| File | Purpose | Status |
|------|---------|--------|
| `types/co-pilot.ts` | Co-pilot types (SmartBlock, etc.) | ✅ Active |
| `types/driver.ts` | Driver types | ❌ Orphaned |
| `types/location.ts` | Location types | ❌ Orphaned |
| `types/performance.ts` | Performance types | ❌ Orphaned |
| `types/settings.ts` | Settings types | ❌ Orphaned |

### Utilities

| File | Purpose | Status |
|------|---------|--------|
| `utils/co-pilot-helpers.ts` | Auth, logging, helpers | ✅ Active |

### Engine

| File | Purpose | Status |
|------|---------|--------|
| `engine/reflectionEngine.ts` | Reflection/learning engine | ⚠️ Defined but needs review |

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
| `/api/blocks-fast` | POST | co-pilot.tsx | Trigger TRIAD pipeline |
| `/api/blocks-fast` | GET | co-pilot.tsx | Fetch generated blocks |
| `/api/blocks/strategy/:id` | GET | co-pilot.tsx | Fetch strategy content |
| `/api/strategy/:snapshotId` | GET | co-pilot.tsx | Fetch strategy status |
| `/api/snapshot/:id` | GET | co-pilot.tsx | Fetch snapshot data |

### Briefing APIs

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/briefing/weather/:id` | GET | useBriefingQueries.ts | Weather briefing |
| `/api/briefing/traffic/:id` | GET | useBriefingQueries.ts | Traffic conditions |
| `/api/briefing/rideshare-news/:id` | GET | useBriefingQueries.ts | Rideshare news |
| `/api/briefing/events/:id` | GET | useBriefingQueries.ts | Local events |
| `/api/briefing/school-closures/:id` | GET | useBriefingQueries.ts | School closures |

### Chat & Voice APIs

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/chat` | POST (SSE) | CoachChat.tsx | Text chat streaming |
| `/api/realtime/token` | GET | CoachChat.tsx | Voice API token |

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
| `/api/tts` | POST | co-pilot.tsx | Text-to-speech |
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
│       │         └──► co-pilot (listens)                          │
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
| `vecto-snapshot-saved` | location-context-clean.tsx | GlobalHeader, co-pilot | `{ snapshotId, holiday, is_holiday }` |
| `vecto-strategy-cleared` | location-context-clean.tsx | (internal) | `{}` |
| `vecto-manual-refresh` | GlobalHeader.tsx | location-context-clean | `{}` |
| `vecto-location-refreshed` | GlobalHeader.tsx | (none) | `{}` |

---

## COMPONENT IMPORT TREE

```
main.tsx
└── App.tsx
    ├── LocationProvider (location-context-clean.tsx)
    ├── Toaster (ui/toaster.tsx)
    ├── GlobalHeader.tsx
    │   ├── LocationContext
    │   ├── use-toast.ts
    │   └── lib/daypart.ts
    ├── ErrorBoundary.tsx
    └── CoPilot (co-pilot.tsx)
        ├── useLocation (location-context-clean)
        ├── useBriefingQueries.ts
        ├── useEnrichmentProgress.ts
        ├── co-pilot-helpers.ts
        ├── FeedbackModal.tsx
        ├── CoachChat.tsx
        ├── SmartBlocksStatus.tsx
        ├── BarsTable.tsx
        ├── BriefingTab.tsx
        │   └── EventsComponent.tsx
        ├── MapTab.tsx
        ├── DonationTab.tsx
        │   └── InstructionsTab.tsx
        ├── BottomTabNavigation.tsx
        └── GreetingBanner.tsx
```

---

## ORPHANED FILES (CANDIDATES FOR REMOVAL)

These files exist but are **not imported anywhere** in the codebase:

### High Confidence - Safe to Remove

| File | Reason | Recommendation |
|------|--------|----------------|
| `client/src/services/locationService.ts` | Not imported anywhere | **DELETE** |
| `client/src/main-simple.tsx` | Alternate entry point, not used | **DELETE** |
| `client/src/lib/prompt/baseline.ts` | Not imported anywhere | **DELETE** |

### Medium Confidence - Review Before Removing

| File | Reason | Recommendation |
|------|--------|----------------|
| `client/src/components/strategy/SmartBlocks.tsx` | Not imported, uses orphaned hook | **REVIEW** - may be legacy |
| `client/src/components/strategy/StrategyCoach.tsx` | Not imported, uses orphaned hook | **REVIEW** - may be legacy |
| `client/src/hooks/useDwellTracking.ts` | Not imported anywhere | **REVIEW** - intended feature? |
| `client/src/hooks/useStrategy.ts` | Only used by orphaned files | **REVIEW** - remove with strategy/* |

---

## POTENTIALLY REDUNDANT FILES (NEEDS REVIEW)

These files are imported but may be duplicates or unused code paths:

### Client-Side

| File | Issue | Action |
|------|-------|--------|
| `MarketIntelligenceBlocks.tsx` | Imported as `_MarketIntelligenceBlocks` (unused alias) | Review if needed |
| `strategy/ConsolidatedStrategyComp.tsx` | Imported as `_ConsolidatedStrategyComp` (unused alias) | Review if needed |
| `engine/reflectionEngine.ts` | Has 3 references but functionality unclear | Review purpose |

### Server-Side (Needs Separate Review)

| File | Issue | Action |
|------|-------|--------|
| `server/lib/ai/llm-router-v2.js` | Deprecated per ARCHITECTURE.md | Review for removal |
| `server/lib/strategy/strategy-generator.js` | Parallel version exists | Review if still needed |
| `server/api/research/vector-search.js` | No imports found | Review for removal |
| `server/api/research/research.js` | Limited usage | Review for removal |

---

## FILE QUICK REFERENCE

### UI Features → Files

| Feature | Files |
|---------|-------|
| **GPS & Location** | `location-context-clean.tsx`, `GlobalHeader.tsx` |
| **Weather Display** | `GlobalHeader.tsx` (reads from context), `BriefingTab.tsx` |
| **Strategy Generation** | `co-pilot.tsx` (triggers), blocks-fast API |
| **Venue Blocks** | `co-pilot.tsx`, `BarsTable.tsx`, `SmartBlocksStatus.tsx` |
| **AI Chat** | `CoachChat.tsx` |
| **Voice Chat** | `CoachChat.tsx` (OpenAI Realtime) |
| **Briefing Tab** | `BriefingTab.tsx`, `EventsComponent.tsx` |
| **Feedback** | `FeedbackModal.tsx` |
| **Holiday Banner** | `GreetingBanner.tsx`, `GlobalHeader.tsx` |
| **Tab Navigation** | `BottomTabNavigation.tsx` |

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
- **Pages**: 2
- **Core Components**: 12
- **Sub-Components**: 2
- **Strategy Components**: 1 active, 2 orphaned
- **Hooks**: 4 active, 2 orphaned
- **Contexts**: 1
- **Libraries**: 3 active, 1 orphaned
- **Services**: 0 active, 2 orphaned
- **Types**: 1 active, 4 orphaned
- **Utilities**: 1

### Cleanup Recommendations

1. **Immediate Deletion** (3 files):
   - `services/locationService.ts`
   - `main-simple.tsx`
   - `lib/prompt/baseline.ts`

2. **Review Then Delete** (4 files):
   - `strategy/SmartBlocks.tsx`
   - `strategy/StrategyCoach.tsx`
   - `hooks/useDwellTracking.ts`
   - `hooks/useStrategy.ts`

3. **Review Purpose** (3 files):
   - `MarketIntelligenceBlocks.tsx`
   - `strategy/ConsolidatedStrategyComp.tsx`
   - `engine/reflectionEngine.ts`
