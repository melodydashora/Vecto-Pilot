# Components (`client/src/components/`)

## Purpose

React UI components organized by feature area.

## Structure

```
components/
├── GlobalHeader.tsx       # Header: location, weather, time
├── CoachChat.tsx          # AI Strategy Coach with voice
├── BriefingTab.tsx        # Events, traffic, news, weather
├── BarsTable.tsx          # Venue table display
├── MapTab.tsx             # Interactive map
├── DonationTab.tsx        # Donation section
├── InstructionsTab.tsx    # How-to instructions
├── FeedbackModal.tsx      # Feedback dialogs
├── SmartBlocksStatus.tsx  # Loading/status display
├── EventsComponent.tsx    # Events list
├── ErrorBoundary.tsx      # Error boundary wrapper
├── co-pilot/              # Co-pilot sub-components
├── strategy/              # Strategy display components
├── _future/               # Future components (not imported)
└── ui/                    # shadcn/ui primitives (46 files)
```

## Active Components

| Component | LOC | Used By |
|-----------|-----|---------|
| `GlobalHeader.tsx` | 488 | App.tsx |
| `CoachChat.tsx` | 535 | co-pilot.tsx |
| `BriefingTab.tsx` | 466 | co-pilot.tsx |
| `BarsTable.tsx` | 400 | co-pilot.tsx |
| `MapTab.tsx` | 237 | co-pilot.tsx |
| `DonationTab.tsx` | 396 | co-pilot.tsx |
| `InstructionsTab.tsx` | 428 | DonationTab.tsx |
| `FeedbackModal.tsx` | 236 | co-pilot.tsx |
| `SmartBlocksStatus.tsx` | 158 | co-pilot.tsx |
| `EventsComponent.tsx` | 200 | BriefingTab.tsx |

## Sub-folders

- `co-pilot/` - Co-pilot page sub-components (tabs, banners)
- `strategy/` - Strategy display (some orphaned)
- `_future/` - Not imported, waiting for implementation
- `ui/` - 46 shadcn/ui primitives (button, card, dialog, etc.)

## Connections

- **State from:** `../contexts/location-context-clean.tsx`
- **Data from:** `../hooks/useBriefingQueries.ts`, API calls
- **Rendered by:** `../pages/co-pilot.tsx`

## Key Implementation Details

### BarsTable.tsx - Real-time Open/Closed Status

The `BarsTable` component calculates venue open/closed status in **real-time** using `calculateIsOpenNow()`:

```typescript
// Calculates if venue is open based on hours string and user's current time
const isOpen = calculateIsOpenNow(todayHours) ?? bar.isOpen;
```

**Why real-time calculation?** The server-side `isOpen` value is calculated once during venue enrichment and cached. If a user views a strategy generated hours ago, the cached value would be stale. Client-side calculation ensures accuracy.

**Supports:**
- Standard hours: `9:00 AM - 5:00 PM`
- Overnight hours: `5:00 PM - 2:00 AM` (handles midnight crossover)
- Falls back to server-cached `bar.isOpen` if parsing fails

## See Also

- `co-pilot/README.md` - Sub-component details
- `strategy/README.md` - Strategy components
- `_future/README.md` - Staging area
