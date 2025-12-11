# Client Source (`client/src/`)

## Purpose

React frontend for Vecto Pilot. TypeScript, TailwindCSS, Radix UI components.

## Structure

```
src/
├── App.tsx              # App root with routing
├── main.tsx             # Entry point
├── components/          # UI components (includes ui/ with shadcn primitives)
├── pages/               # Page components
├── contexts/            # React contexts (location)
├── hooks/               # Custom React hooks
├── lib/                 # Utilities
├── types/               # TypeScript types
├── features/            # Feature modules
├── utils/               # Utility helpers
└── _future/             # Staging for future features
```

## Key Components

| File | Purpose |
|------|---------|
| `pages/co-pilot.tsx` | Main dashboard (1700+ LOC) |
| `components/GlobalHeader.tsx` | Weather, location, time |
| `components/CoachChat.tsx` | AI chat + voice |
| `components/BriefingTab.tsx` | Events, traffic, news |
| `components/BarTab.tsx` | Premium bars sidebar |
| `contexts/location-context-clean.tsx` | GPS, weather, snapshots |

## Data Flow

```
LocationContext (GPS, weather, AQ)
    ↓
App.tsx (routing)
    ↓
co-pilot.tsx (main dashboard)
    ├── GlobalHeader (location display)
    ├── BriefingTab (briefing data)
    ├── CoachChat (AI interaction)
    └── Smart Blocks (venue recommendations)
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
