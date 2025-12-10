# Pages (`client/src/pages/`)

## Purpose

Page-level components that represent full screens/routes.

## Files

| File | Purpose |
|------|---------|
| `co-pilot.tsx` | Main dashboard (1700+ LOC) |

## co-pilot.tsx

The main application page that orchestrates:
- Strategy display and polling
- Briefing tab (weather, traffic, events, news)
- Smart blocks (venue recommendations)
- AI Coach chat
- Map view
- Feedback modals
- Tab navigation

### Structure

```tsx
<co-pilot>
  ├── GreetingBanner      // Holiday/greeting
  ├── TabContent          // Active tab content
  │   ├── StrategyTab     // AI strategy
  │   ├── BriefingTab     // Events, traffic, news
  │   ├── VenuesTab       // Smart blocks
  │   ├── MapTab          // Interactive map
  │   └── DonationTab     // Donations
  ├── CoachChat           // AI assistant
  └── BottomTabNavigation // Tab switcher
</co-pilot>
```

### Size Note

At 1700+ LOC, this is the largest component. Consider refactoring into smaller feature modules in the future.

## Connections

- **Uses:** Most components from `../components/`
- **Hooks:** `useBriefingQueries`, `useEnrichmentProgress`
- **Context:** LocationContext for GPS data
- **APIs:** `/api/blocks-fast`, `/api/strategy/*`, `/api/briefing/*`
