# Client Structure

Frontend organization for Vecto Pilot. React 18 + TypeScript + Vite.

## Directory Overview

```
client/
├── src/
│   ├── pages/                  # Route pages
│   ├── components/             # UI components
│   │   ├── co-pilot/           # Co-pilot specific
│   │   ├── strategy/           # Strategy display
│   │   └── ui/                 # shadcn/ui primitives (46 components)
│   ├── contexts/               # React contexts
│   ├── hooks/                  # Custom hooks
│   ├── features/               # Feature modules
│   │   └── strategy/           # Strategy feature
│   ├── lib/                    # Core utilities
│   ├── types/                  # TypeScript types
│   ├── utils/                  # Feature helpers
│   └── _future/                # Staged future features
│       └── engine/             # Reflection engine (Phase 17)
└── README.md
```

## Folder READMEs

Every folder has a README.md explaining its purpose.

### Top-Level Client Folders

| Folder | README | Purpose |
|--------|--------|---------|
| `client/` | [README](../../client/README.md) | Client overview |
| `client/src/` | [README](../../client/src/README.md) | Source overview |

### Component Folders

| Folder | README | Purpose |
|--------|--------|---------|
| `components/` | [README](../../client/src/components/README.md) | Components index |
| `components/co-pilot/` | [README](../../client/src/components/co-pilot/README.md) | Co-pilot specific |
| `components/strategy/` | [README](../../client/src/components/strategy/README.md) | Strategy display |
| `components/ui/` | [README](../../client/src/components/ui/README.md) | shadcn/ui primitives |

### Feature & Logic Folders

| Folder | README | Purpose |
|--------|--------|---------|
| `contexts/` | [README](../../client/src/contexts/README.md) | React contexts |
| `hooks/` | [README](../../client/src/hooks/README.md) | Custom hooks |
| `features/` | [README](../../client/src/features/README.md) | Feature modules |
| `features/strategy/` | [README](../../client/src/features/strategy/README.md) | Strategy feature |
| `lib/` | [README](../../client/src/lib/README.md) | Core utilities |
| `types/` | [README](../../client/src/types/README.md) | TypeScript types |
| `utils/` | [README](../../client/src/utils/README.md) | Feature helpers |
| `pages/` | [README](../../client/src/pages/README.md) | Route pages |

### Future/Staged Features

| Folder | README | Purpose |
|--------|--------|---------|
| `_future/` | [README](../../client/src/_future/README.md) | Staged features |
| `_future/engine/` | [README](../../client/src/_future/engine/README.md) | Reflection engine |

## Key Pages (`client/src/pages/`)

| Page | Route | Purpose |
|------|-------|---------|
| `co-pilot.tsx` | `/` | Main dashboard (1700+ LOC) |
| `history.tsx` | `/history` | Strategy history |
| `settings.tsx` | `/settings` | User settings |

**Note:** `co-pilot.tsx` is the main page containing tabs for Strategy, Venues, Briefing, and Chat.

## Components (`client/src/components/`)

### Core Components

| Component | Purpose |
|-----------|---------|
| `GlobalHeader.tsx` | GPS status, refresh button |
| `CoachChat.tsx` | AI Chat interface with file upload |
| `BriefingTab.tsx` | Weather, traffic, news, events display |
| `StrategyHistoryPanel.tsx` | Strategy history sidebar |

### Strategy Components (`components/strategy/`)

| Component | Purpose |
|-----------|---------|
| `StrategyDisplay.tsx` | Main strategy view |
| `VenueCard.tsx` | Individual venue recommendation |
| `StagingInfo.tsx` | Staging location display |

### UI Primitives (`components/ui/`)

46 shadcn/ui components including Button, Card, Dialog, Tabs, Toast, etc.

## Contexts (`client/src/contexts/`)

| Context | Purpose |
|---------|---------|
| `location-context-clean.tsx` | **Single source of truth for location & weather** |

**Critical:** `location-context-clean.tsx` manages:
- GPS coordinates
- Resolved address
- Weather data
- Token storage
- `isLocationResolved` flag (gates downstream queries)

## Hooks (`client/src/hooks/`)

### Data Fetching Hooks

| Hook | Purpose |
|------|---------|
| `useBriefingQueries.ts` | Fetches weather, traffic, news, events |
| `useStrategyPolling.ts` | Strategy polling with SSE |
| `useStrategy.ts` | Strategy state management |
| `useEnrichmentProgress.ts` | Tracks briefing progress |

### UI Hooks

| Hook | Purpose |
|------|---------|
| `useStrategyLoadingMessages.ts` | Strategy loading messages |
| `useVenueLoadingMessages.ts` | Venue loading messages |
| `useTTS.ts` | Text-to-speech with OpenAI |
| `use-toast.ts` | Toast notifications |
| `use-mobile-detect.ts` | Device detection |

## Data Flow

### Location Resolution
```
Browser GPS → LocationContext
    → /api/location/resolve
    → Sets isLocationResolved = true
    → Downstream queries enabled (venues, strategy)
```

### Strategy Loading
```
LocationContext (isLocationResolved)
    → POST /api/blocks-fast
    → useStrategyPolling (SSE subscription)
    → strategy_ready event
    → GET /api/strategy/:snapshotId
    → Display in StrategyDisplay
```

### Briefing Data
```
LocationContext (snapshotId)
    → useBriefingQueries (parallel fetch)
        → /api/briefing/weather/:snapshotId
        → /api/briefing/traffic/:snapshotId
        → /api/briefing/events/:snapshotId
        → /api/briefing/news/:snapshotId
    → BriefingTab displays data
```

## Venue Open/Closed Logic

**Server-side:** `isOpen` calculated during enrichment using venue's timezone via `Intl.DateTimeFormat`. Stored in `ranking_candidates.features.isOpen`.

**Client-side:** Trusts server value in `BarsTable.tsx`:
```javascript
const isOpen = bar.isOpen;  // Trust server's timezone-aware calculation
```

**Why client trusts server:** Server uses venue's timezone (e.g., "America/Chicago") for accurate calculation. Client-side recalculation was removed because browser timezone ≠ venue timezone, which caused late-night venues to incorrectly show as closed.

## localStorage Keys

| Key | Purpose |
|-----|---------|
| `vecto_persistent_strategy` | Cached strategy data |
| `vecto_strategy_snapshot_id` | Current snapshot ID |
| `token` | JWT authentication token |

**Behavior:** Strategy persists across sessions. Clears on manual refresh or location change.

## Import Patterns

```typescript
// Components
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

// Hooks
import { useStrategy } from '@/hooks/useStrategy';
import { useBriefingQueries } from '@/hooks/useBriefingQueries';

// Context
import { useLocation } from '@/contexts/location-context-clean';

// Utils
import { formatTime, getDaypartGreeting } from '@/utils/co-pilot-helpers';
```

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **TanStack Query v5** - Data fetching
- **Wouter** - Routing
- **shadcn/ui** - Component library
- **Tailwind CSS** - Styling

## See Also

- [Server Structure](server-structure.md) - Backend organization
- [API Reference](api-reference.md) - Endpoint documentation
- [Auth System](auth-system.md) - JWT flow
