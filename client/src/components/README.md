> **Last Verified:** 2026-01-15

# Components (`client/src/components/`)

## Purpose

React UI components organized by feature area.

## Structure

```
components/
├── GlobalHeader.tsx       # Header: location, weather, time
├── CriticalError.tsx      # Blocking error modal (FAIL HARD pattern)
├── CoachChat.tsx          # AI Strategy Coach with voice
├── BriefingTab.tsx        # Events, traffic, news, weather
├── BarsTable.tsx          # Venue table display
├── BarTab.tsx             # Premium bars sidebar
├── MapTab.tsx             # Interactive map
├── DonationTab.tsx        # Donation section
├── InstructionsTab.tsx    # How-to instructions
├── FeedbackModal.tsx      # Feedback dialogs
├── RideshareIntelTab.tsx  # Rideshare platform intelligence
├── SmartBlocksStatus.tsx  # Loading/status display
├── EventsComponent.tsx    # Events list
├── ErrorBoundary.tsx      # Error boundary wrapper
├── auth/                  # Authentication components
├── co-pilot/              # Co-pilot sub-components
├── intel/                 # Market intelligence components
├── strategy/              # Strategy display components
├── _future/               # Future components (not imported)
└── ui/                    # shadcn/ui primitives (48 files)
```

## Active Components

| Component | LOC | Used By |
|-----------|-----|---------|
| `GlobalHeader.tsx` | 488 | CoPilotLayout.tsx |
| `CriticalError.tsx` | 142 | co-pilot-context.tsx |
| `CoachChat.tsx` | 535 | StrategyPage.tsx |
| `BriefingTab.tsx` | 466 | BriefingPage.tsx |
| `BarsTable.tsx` | 400 | BarsPage.tsx |
| `BarTab.tsx` | 400 | BarsPage.tsx |
| `MapTab.tsx` | 237 | MapPage.tsx |
| `DonationTab.tsx` | 396 | AboutPage.tsx |
| `InstructionsTab.tsx` | 428 | DonationTab.tsx |
| `FeedbackModal.tsx` | 236 | StrategyPage.tsx |
| `RideshareIntelTab.tsx` | 800 | IntelPage.tsx |
| `SmartBlocksStatus.tsx` | 158 | StrategyPage.tsx |
| `EventsComponent.tsx` | 200 | BriefingTab.tsx |

## Sub-folders

- [`auth/`](auth/README.md) - Authentication components (ProtectedRoute)
- [`co-pilot/`](co-pilot/README.md) - Co-pilot page sub-components (tabs, banners)
- [`intel/`](intel/README.md) - Market intelligence components (DeadheadCalculator, ZoneCards)
- [`strategy/`](strategy/README.md) - Strategy display (some orphaned)
- [`_future/`](_future/README.md) - Not imported, waiting for implementation
- [`ui/`](ui/README.md) - 48 shadcn/ui primitives (button, card, dialog, etc.)

## Connections

- **State from:** `../contexts/location-context-clean.tsx`, `../contexts/co-pilot-context.tsx`
- **Data from:** `../hooks/useBriefingQueries.ts`, API calls
- **Rendered by:** `../pages/co-pilot/*.tsx`

## Key Implementation Details

### CriticalError.tsx - Blocking Error Modal (FAIL HARD Pattern)

**Added:** 2026-01-15

Full-screen blocking modal that replaces the entire dashboard when the app enters an unrecoverable state. Part of the "FAIL HARD" pattern - never show partial/degraded UI with missing critical data.

**Error Types:**
| Type | When Triggered | User Message |
|------|----------------|--------------|
| `snapshot_missing` | Snapshot fetch returns 4xx/5xx | "Session Data Missing" |
| `snapshot_incomplete` | Snapshot missing city or timezone | "Incomplete Location Data" |
| `location_failed` | GPS resolution times out (30s) | "Location Resolution Failed" |
| `auth_failed` | Session expired or invalid | "Authentication Required" |
| `unknown` | Catch-all for unexpected errors | "Something Went Wrong" |

**Usage:**
```typescript
// In co-pilot-context.tsx
const [criticalError, setCriticalError] = useState<{
  type: CriticalErrorType;
  message?: string;
  details?: string;
} | null>(null);

// When error detected, set criticalError
if (snapshotError) {
  setCriticalError({ type: 'snapshot_missing', message: snapshotError.message });
}

// Provider renders CriticalError INSTEAD of children when error set
if (criticalError) {
  return (
    <CriticalError
      type={criticalError.type}
      message={criticalError.message}
      onRetry={handleClearError}
    />
  );
}
```

**Actions Available:**
- **Try Again**: Calls `onRetry` callback (clears error state and allows fresh retry)
- **Sign Out & Start Fresh**: Clears localStorage/sessionStorage and redirects to `/`

**Key Principle:** If critical data is missing, the app cannot function correctly. Showing "Unknown Location" or empty strategies just delays failure and confuses debugging. FAIL HARD = show blocking modal, force user to retry.

**See Also:** `LESSONS_LEARNED.md` > "FAIL HARD Pattern for Critical Data"

### BarsTable.tsx - Venue Open/Closed Status

The `BarsTable` component displays venue open/closed status from the server:

```typescript
// Trust server's timezone-aware calculation
const isOpen = bar.isOpen;
```

**Why trust server value?** The server calculates `isOpen` using the venue's timezone via `Intl.DateTimeFormat` (e.g., "America/Chicago"). Client-side recalculation was removed because browser timezone ≠ venue timezone, which caused late-night venues to incorrectly show as closed in production.

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

### MapTab.tsx - Interactive Map with Venue, Bar & Event Markers

Google Maps integration with multiple marker layers:

**Marker Layers:**
- **Driver location** (blue marker)
- **Strategy venues** (red/orange/yellow by value grade A/B/C)
- **Bar markers** ($$+ only, open bars only):
  - 🟢 Green = Open bar
  - 🔴 Red = Closing soon (last call opportunity!)
  - *(Closed bars are hidden)*
- **Event markers** (purple) - today's events only

**Bar Filtering (MapPage.tsx):**
- Only shows bars with $$ and above (`expense_rank >= 2`)
- Only shows OPEN bars (`is_open === true`)
- Fetched from `/api/venues/nearby` endpoint
- Separate from strategy blocks (different data source)

**Event Filtering:**
- Only shows events happening TODAY with valid times
- Supports multi-day events (checks if today is within date range)

```typescript
// Bar markers with open/closing status
bars={filteredBars}  // $$+ only

// Events with coordinates appear as purple markers
// 2026-01-10: Use symmetric field names (event_start_date, event_start_time)
events={eventsData?.events?.map(e => ({
  title: e.title,
  venue: e.venue,
  event_start_date: e.event_start_date,
  event_end_date: e.event_end_date,  // Multi-day support
  event_start_time: e.event_start_time,
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
