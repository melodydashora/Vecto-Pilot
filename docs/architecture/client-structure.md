Here is the updated documentation reflecting the code changes in `CoachChat.tsx`. The description for `CoachChat.tsx` has been updated to include "persistent history" as the code now utilizes the `useChatPersistence` hook.

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

### UI Primitives (`components/ui/`)

46 shadcn/ui components including Button, Card, Dialog, Tabs, Toast, etc.