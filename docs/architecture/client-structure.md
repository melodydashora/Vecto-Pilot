The documentation for `CoachChat.tsx` is already accurate regarding the features visible in the code (persistent history, file upload, Coach memory/notes). However, I will provide the clean markdown content to remove the conversational preamble present in the "Current Documentation" input.


## Components (`client/src/components/`)

### Core Components

| Component | Purpose |
|-----------|---------|
| `GlobalHeader.tsx` | GPS status, refresh button |
| `CoachChat.tsx` | AI Chat interface with persistent history, file upload, and Coach memory (notes/preferences) |
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

### UI Primitives (`components