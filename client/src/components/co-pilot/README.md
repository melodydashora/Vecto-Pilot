# Co-Pilot Sub-Components (`client/src/components/co-pilot/`)

## Purpose

Sub-components extracted from the main co-pilot page for better organization.

## Files

| File | Purpose |
|------|---------|
| `BottomTabNavigation.tsx` | Tab switcher (Strategy, Briefing, Map, etc.) |
| `GreetingBanner.tsx` | Holiday/greeting banner display |

## Usage

```tsx
import { BottomTabNavigation } from './co-pilot/BottomTabNavigation';
import { GreetingBanner } from './co-pilot/GreetingBanner';

// In co-pilot.tsx
<GreetingBanner holiday={holiday} />
<BottomTabNavigation activeTab={tab} onTabChange={setTab} />
```

## GreetingBanner Logic

```
holiday = 'none' or falsy → Time-based greeting ("Good morning, driver!")
holiday = 'Happy Holidays' → "Happy Happy Holidays!" banner
holiday = 'Christmas' → "Happy Christmas!" banner
```

## Connections

- **Used by:** `../pages/co-pilot.tsx`
- **Data from:** `holiday` prop (from LocationContext/API)
