Based on the provided code changes for `client/src/components/CoachChat.tsx`, the component now accepts `strategy`, `snapshot`, and `strategyReady` props, indicating it is context-aware regarding the current strategy session and environment (weather, location, etc.). The documentation has been updated to reflect this "strategy context".


## Components (`client/src/components/`)

### Core Components

| Component | Purpose |
|-----------|---------|
| `GlobalHeader.tsx` | GPS status, refresh button |
| `CoachChat.tsx` | AI Chat interface with persistent history, file upload, strategy context, and Coach memory (notes/preferences) |
| `BriefingTab.tsx` | Weather, traffic, news, events display |
| `DonationTab.tsx` | About/Donation view with development stats & instructions |
| `InstructionsTab.tsx` | "How to Use" guide (embedded in DonationTab) |
| `StrategyHistoryPanel.tsx` | Strategy history sidebar |

### Concierge Components (`components/concierge/`)

| Component | Purpose |
|-----------|---------|
| `EventsExplorer.tsx` | Venue/Event search (DB-first) with quick filters. Splits results for list & map. |

### Strategy Components (`components/strategy/`)

| Component | Purpose |
|-----------|---------|
| `StrategyDisplay.tsx` | Main strategy view |
| `VenueCard.tsx` | Individual venue recommendation |
| `StagingInfo.tsx` | Staging location display |