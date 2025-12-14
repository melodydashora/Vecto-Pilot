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
└── ui/                    # shadcn/ui primitives (48 files)
```

## Active Components

| Component | LOC | Used By |
|-----------|-----|---------|
| `GlobalHeader.tsx` | 488 | App.tsx |
| `CoachChat.tsx` | 535 | co-pilot.tsx |
| `BriefingTab.tsx` | 466 | co-pilot.tsx |
| `BarsTable.tsx` | 400 | co-pilot.tsx |
| `BarTab.tsx` | 400 | co-pilot.tsx |
| `MapTab.tsx` | 237 | co-pilot.tsx |
| `DonationTab.tsx` | 396 | co-pilot.tsx |
| `InstructionsTab.tsx` | 428 | DonationTab.tsx |
| `FeedbackModal.tsx` | 236 | co-pilot.tsx |
| `SmartBlocksStatus.tsx` | 158 | co-pilot.tsx |
| `EventsComponent.tsx` | 200 | BriefingTab.tsx |

## Sub-folders

- [`co-pilot/`](co-pilot/README.md) - Co-pilot page sub-components (tabs, banners)
- [`strategy/`](strategy/README.md) - Strategy display (some orphaned)
- [`_future/`](_future/README.md) - Not imported, waiting for implementation
- [`ui/`](ui/README.md) - 48 shadcn/ui primitives (button, card, dialog, etc.)

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

### EventsComponent.tsx - Event Display with Navigation

Displays events grouped by category (concerts, sports, festivals, etc.) with:

- **Event times**: Start and end times (e.g., "7:00 PM - 10:00 PM")
- **Venue/address display**: Venue name with address
- **Impact badges**: HIGH/MEDIUM/LOW with color coding
- **Navigation button**: Opens Google Maps directions to event

```typescript
// Opens Google Maps with coordinates or address
const openNavigation = (event: Event) => {
  if (event.latitude && event.longitude) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${event.latitude},${event.longitude}`);
  } else if (event.address) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(event.address)}`);
  }
};
```

### MapTab.tsx - Interactive Map with Event Markers

Google Maps integration with:

- **Driver location** (blue marker)
- **Venue recommendations** (red/orange/yellow by grade)
- **Event markers** (purple) with click popups showing:
  - Event title with category icon
  - Venue name
  - Start/End times
  - Impact badge
  - Navigate to Event button

```typescript
// Events with coordinates appear as purple markers
events={eventsData?.events?.map(e => ({
  title: e.title,
  venue: e.venue,
  event_time: e.event_time,
  event_end_time: e.event_end_time,
  latitude: e.latitude,
  longitude: e.longitude,
  impact: e.impact,
  subtype: e.subtype
}))}
```

### BriefingTab.tsx - Discover Events Button

On-demand event discovery button:

```typescript
// Triggers comprehensive event discovery (all 6 AI models)
const discoverEvents = async () => {
  await fetch(`/api/briefing/discover-events/${snapshotId}?daily=true`, { method: 'POST' });
};
```

## See Also

- [co-pilot/README.md](co-pilot/README.md) - Sub-component details
- [strategy/README.md](strategy/README.md) - Strategy components
- [ui/README.md](ui/README.md) - Shadcn/ui component library
- [_future/README.md](_future/README.md) - Staging area
- [Event Discovery Architecture](../../../docs/architecture/event-discovery.md)
