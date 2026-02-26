## Components (`client/src/components/`)

### Core Components

| Component | Purpose |
|-----------|---------|
| `GlobalHeader.tsx` | Real-time location & context (weather, time), snapshot status, refresh controls, and logout |
| `CoachChat.tsx` | AI Chat interface with persistent history, file upload, strategy context, and Coach memory (notes/preferences) |
| `BriefingTab.tsx` | Dashboard for driver intelligence including Strategy, Weather, Traffic, Airports, News, School Closures, and Events |
| `DonationTab.tsx` | About/Donation view with development stats & instructions |
| `InstructionsTab.tsx` | "How to Use" guide (embedded in DonationTab) |
| `StrategyHistoryPanel.tsx` | Strategy history sidebar |

### Briefing Components (`client/src/components/briefing/`)

| Component | Purpose |
|-----------|---------|
| `StrategyCard.tsx` | Displays consolidated strategy and critical briefings |
| `WeatherCard.tsx` | Current weather conditions |
| `TrafficCard.tsx` | Traffic incidents and conditions |
| `NewsCard.tsx` | Local news updates |
| `AirportCard.tsx` | Airport delays and status |
| `SchoolClosuresCard.tsx` | School closure information |

### Concierge Components (`components/concierge/`)

| Component | Purpose |
|-----------|---------|
| `EventsExplorer.tsx` | Venue/Event search (DB-first) with quick filters. Splits results for list & map. |
| `ConciergeMap.tsx` | Lightweight, on-demand Google Map displaying passenger location, venues, and events with custom SVG markers. Saves bandwidth for mobile. |

### Strategy Components (`components/strategy/`)

| Component | Purpose |
|-----------|---------|
| `StrategyDisplay.tsx` | Main strategy view |
| `VenueCard.tsx` | Individual venue recommendation |
| `StagingInfo.tsx` | Staging location display |

## Hooks (`client/src/hooks/`)

| Hook | Purpose |
|------|---------|
| `useMarketIntelligence.ts` | Fetches market-specific intelligence (zones, strategies, safety) from `/api/intelligence`. Auto-detects market from location and handles market archetypes (Sprawl, Dense, Party). |
| `useBriefingQueries.ts` | Manages parallel data fetching for the Briefing tab (weather, traffic, news, airports, school closures, events). |
| `useMemory.ts` | Manages Coach memory operations (fetch, add, delete user notes and preferences). |