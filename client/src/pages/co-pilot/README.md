> **Last Verified:** 2026-01-06

# Co-Pilot Pages (`client/src/pages/co-pilot/`)

## Purpose

Route-based page components for the co-pilot section of Vecto Pilot.

## Structure

```
co-pilot/
├── StrategyPage.tsx     # AI strategy + Smart Blocks + Coach (~800 LOC)
├── BarsPage.tsx         # Premium venue listings
├── BriefingPage.tsx     # Weather, traffic, news, events
├── MapPage.tsx          # Interactive venue + event map
├── IntelPage.tsx        # Rideshare platform intelligence
├── SettingsPage.tsx     # User profile settings
├── AboutPage.tsx        # Donation/about (no GlobalHeader)
├── PolicyPage.tsx       # Privacy policy
└── index.tsx            # Barrel exports
```

## Route Mapping

| Route | Page Component | Purpose |
|-------|----------------|---------|
| `/co-pilot/strategy` | StrategyPage | AI-powered driving strategy with Smart Blocks |
| `/co-pilot/bars` | BarsPage | Premium venue listings with open/closed status |
| `/co-pilot/briefing` | BriefingPage | Weather, traffic, news, and local events |
| `/co-pilot/map` | MapPage | Interactive map with venue and event markers |
| `/co-pilot/intel` | IntelPage | Rideshare platform coverage data |
| `/co-pilot/settings` | SettingsPage | User profile settings (via gear icon) |
| `/co-pilot/about` | AboutPage | Donation info (no header shown) |
| `/co-pilot/policy` | PolicyPage | Privacy policy |

## Page Components

### StrategyPage (~800 LOC)
The main page - displays:
- AI-generated driving strategy (immediate + daily)
- Smart Blocks (venue recommendations)
- AI Strategy Coach chat interface
- Loading states with progress indicators

Uses:
- `useCoPilot()` for strategy/blocks state
- `CoachChat` for AI chat
- `SmartBlocksStatus` for loading states

### BarsPage
Premium venue listings with:
- Distance and rating information
- Open/closed status (timezone-aware)
- Price range indicators

Uses:
- `BarsTable` for venue display
- `BarTab` for sidebar

### BriefingPage
Real-time briefing with:
- Weather conditions and forecasts
- Traffic conditions
- Local news
- Events with "Discover Events" button

Uses:
- `BriefingTab` component
- `useBriefingQueries()` hook
- `EventsComponent` for event listings

### MapPage
Interactive Google Map showing:
- Driver location (blue marker)
- Strategy venues (red/orange/yellow by grade)
- Bar markers (green = open, red = closing soon)
- Event markers (purple)

Uses:
- `MapTab` component
- Google Maps API integration

### IntelPage
Rideshare platform intelligence:
- Uber/Lyft market coverage
- City-level data
- Surge patterns (when available)

Uses:
- `RideshareIntelTab` component
- `usePlatformData()` hook

### SettingsPage
User profile settings:
- **Personal Info** - Name (read-only), Nickname (editable), Phone
- **Base Location** - Home address with geocoding
- **Vehicle** - Year, Make, Model, Seatbelts
- **Rideshare Platforms** - Uber/Lyft/Private with Uber tier selection

Uses:
- `useAuth()` for profile data
- `react-hook-form` with zod validation
- `updateProfile()` for saving changes
- Toast notifications for feedback

Access via gear icon in GlobalHeader.

### AboutPage
Donation/about page:
- **No GlobalHeader** - special layout
- Donation links
- Instructions

Uses:
- `DonationTab` component

### PolicyPage
Privacy policy linked from AboutPage.

## Layout

All pages except AboutPage use:
- `CoPilotLayout` wrapper
- `GlobalHeader` (weather, location, time)
- `BottomTabNavigation` (tab bar)

AboutPage uses a custom layout with no header.

## Connections

- **Context:** `../contexts/co-pilot-context.tsx`, `../contexts/location-context-clean.tsx`
- **Components:** `../components/*`
- **Hooks:** `../hooks/*`
- **Router:** `../routes.tsx`

## Adding New Pages

1. Create `NewPage.tsx` in this folder
2. Export from `index.tsx`
3. Add route in `../routes.tsx`
4. Add tab to `BottomTabNavigation` if needed
