> **Last Verified:** 2026-01-09

# Client Source (`client/src/`)

## Purpose

React frontend for Vecto Pilot. TypeScript, TailwindCSS, Radix UI components.

## Structure

```
src/
├── App.tsx              # App root with RouterProvider
├── routes.tsx           # React Router configuration
├── main.tsx             # Entry point
├── layouts/             # Layout components
│   └── CoPilotLayout.tsx    # Shared layout with conditional GlobalHeader
├── pages/co-pilot/      # Route-based page components
│   ├── StrategyPage.tsx     # AI strategy + Smart Blocks (~600 LOC)
│   ├── VenueManagerPage.tsx # Premium venue listings (renamed 2026-01-09)
│   ├── BriefingPage.tsx     # Weather, traffic, news, events
│   ├── MapPage.tsx          # Venue + event map
│   ├── IntelPage.tsx        # Rideshare intel
│   ├── AboutPage.tsx        # Donation/about (no GlobalHeader)
│   ├── PolicyPage.tsx       # Privacy policy (linked from About)
│   └── SettingsPage.tsx     # User settings and preferences
├── contexts/            # React contexts
│   ├── location-context-clean.tsx   # GPS, weather, snapshots
│   └── co-pilot-context.tsx         # Shared strategy/blocks state
├── components/          # UI components (includes ui/ with shadcn primitives)
├── hooks/               # Custom React hooks
├── lib/                 # Utilities
├── types/               # TypeScript types
├── features/            # Feature modules
├── utils/               # Utility helpers
└── _future/             # Staging for future features
```

## Route Structure

| Route | Page | Purpose |
|-------|------|---------|
| `/co-pilot/strategy` | StrategyPage | AI strategy + Smart Blocks + Coach |
| `/co-pilot/bars` | VenueManagerPage | Premium venue listings |
| `/co-pilot/briefing` | BriefingPage | Weather, traffic, news, events |
| `/co-pilot/map` | MapPage | Interactive venue map |
| `/co-pilot/intel` | IntelPage | Rideshare intel |
| `/co-pilot/about` | AboutPage | Donation/about (no header) |
| `/co-pilot/policy` | PolicyPage | Privacy policy |
| `/co-pilot/settings` | SettingsPage | User settings and preferences |

## Key Components

| File | Purpose |
|------|---------|
| `layouts/CoPilotLayout.tsx` | Shared layout with conditional GlobalHeader |
| `contexts/co-pilot-context.tsx` | Strategy, blocks, SSE state |
| `components/GlobalHeader.tsx` | Weather, location, time |
| `components/CoachChat.tsx` | AI chat + voice |
| `components/BriefingTab.tsx` | Events, traffic, news |
| `components/BarsMainTab.tsx` | Premium bars sidebar (renamed from BarTab.tsx) |
| `components/BarsDataGrid.tsx` | Venue data table (renamed from BarsTable.tsx) |
| `contexts/location-context-clean.tsx` | GPS, weather, snapshots |

## Data Flow

```
LocationContext (GPS, weather, AQ)
    ↓
App.tsx (RouterProvider)
    ↓
CoPilotLayout (shared layout + CoPilotContext)
    ├── GlobalHeader (conditional - hidden on /about)
    ├── <Outlet /> (renders current route page)
    └── BottomTabNavigation (uses React Router)

CoPilotContext (shared state)
    ├── strategyData, blocksData (React Query)
    ├── persistentStrategy, immediateStrategy
    ├── SSE subscriptions
    └── enrichmentProgress
```

## Entry Point

- `main.tsx` - Production entry

## Build

```bash
npm run dev:client   # Vite dev server
npm run build        # Production build
npm run typecheck    # Type checking
npm run lint         # ESLint
```

## Connections

- **Fetches from:** `/api/*` endpoints
- **State management:** React Context + react-query
- **Styling:** TailwindCSS + shadcn/ui

## See Also

- `components/README.md` - Component organization
- `hooks/README.md` - Custom hooks
- `contexts/README.md` - Context providers
- `_future/README.md` - Future features staging
