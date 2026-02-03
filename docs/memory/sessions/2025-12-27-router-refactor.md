# Session Notes: 2025-12-27

## Session Summary
Major refactor of the co-pilot page from a monolithic 1700-line component into React Router-based pages with shared context.

---

## Changes Made

### 1. React Router Implementation

**New Route Structure:**
```
/                         → Redirects to /co-pilot/strategy
/co-pilot                 → Redirects to /co-pilot/strategy
/co-pilot/strategy        → StrategyPage (AI strategy + blocks + coach)
/co-pilot/bars            → BarsPage (premium venue listings)
/co-pilot/briefing        → BriefingPage (weather, traffic, news, events)
/co-pilot/map             → MapPage (venue + event map)
/co-pilot/intel           → IntelPage (rideshare intel)
/co-pilot/about           → AboutPage (donation/about) - NO GlobalHeader
```

### 2. Files Created

| File | Purpose |
|------|---------|
| `client/src/routes.tsx` | React Router configuration |
| `client/src/layouts/CoPilotLayout.tsx` | Shared layout with conditional GlobalHeader |
| `client/src/contexts/co-pilot-context.tsx` | Centralized state for all co-pilot pages |
| `client/src/pages/co-pilot/StrategyPage.tsx` | Main strategy page (~600 lines) |
| `client/src/pages/co-pilot/BarsPage.tsx` | Wrapper for BarTab component |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Wrapper for BriefingTab |
| `client/src/pages/co-pilot/MapPage.tsx` | Wrapper for MapTab |
| `client/src/pages/co-pilot/IntelPage.tsx` | Wrapper for RideshareIntelTab |
| `client/src/pages/co-pilot/AboutPage.tsx` | Wrapper for DonationTab |
| `client/src/pages/co-pilot/index.tsx` | Barrel export |

### 3. Files Modified

| File | Change |
|------|--------|
| `client/src/App.tsx` | Now uses `RouterProvider` instead of direct component rendering |
| `client/src/components/co-pilot/BottomTabNavigation.tsx` | Uses `useNavigate`/`useLocation` instead of callback props |

### 4. Files Deleted

| File | Reason |
|------|--------|
| `client/src/pages/co-pilot.tsx` | Replaced by individual page components |
| `client/src/components/co-pilot/TabContent.tsx` | No longer needed with router |

### 5. Tab Rename

- Changed "Venues" tab to "Bars" with Wine icon and purple color scheme

---

## Technical Decisions

### Why React Router?
- **URL-based navigation**: Each tab now has its own URL, enabling bookmarks, browser history, and deep linking
- **Code splitting potential**: Each page can be lazy-loaded in the future
- **Clearer separation of concerns**: Each page manages its own local state

### CoPilotContext Design
The context provides shared state that was previously duplicated:
- Snapshot lifecycle management
- Strategy queries (React Query)
- Blocks queries (React Query)
- SSE subscriptions for real-time updates
- Enrichment progress tracking

### GlobalHeader Conditional Rendering
- `CoPilotLayout` uses `useLocation()` to check current path
- GlobalHeader is hidden on `/co-pilot/about` (static page)
- Manual refresh from GlobalHeader affects entire app through LocationContext

---

## Issues Encountered

### 1. Geolocation in Replit Preview
**Problem:** Replit's preview pane is a sandboxed iframe that cannot access browser geolocation.

**Discovery Process:**
1. Added debug logging to `getGeoPosition()`
2. Found geolocation was hanging (no success/error callback)
3. Replit displayed "Cookie Restrictions in Preview" warning
4. Confirmed it's a Replit platform limitation, not code issue

**Resolution:** User must open app in new tab for GPS to work. Added manual 5-second timeout to prevent indefinite hanging.

**File Modified:** `client/src/contexts/location-context-clean.tsx`

### 2. Branch Divergence (from previous session)
The branch `copilot/improve-slow-code-efficiency` was 200+ commits behind main. Merged main into branch to get correct co-pilot.tsx version.

---

## Documentation Updates Completed

All READMEs have been updated to reflect the React Router refactor:

| Document | Update Made |
|----------|-------------|
| `README.md` (root) | Updated file structure to show router-based pages |
| `client/README.md` | Added routes.tsx, layouts/, pages/co-pilot/ structure |
| `client/src/README.md` | Complete rewrite with Route Structure table and new Data Flow |
| `scripts/README.md` | Updated script listing with current files |
| `docs/README.md` | Added route pages and layouts to Client section |
| `docs/architecture/README.md` | Added Route pages and Layouts to folder index |
| `docs/architecture/client-structure.md` | Added PolicyPage, fixed Wouter → React Router v6 |

### Route Added: PolicyPage

A Privacy Policy page was added (`/co-pilot/policy`) accessible via link from AboutPage:
- `client/src/pages/co-pilot/PolicyPage.tsx` - Privacy policy content
- Not a tab in navigation - only linked from About page footer
- Fixed malformed JSX issues (duplicate closing tags)

---

## Questions for User

1. Should we add lazy loading (React.lazy) for the page components?
2. Should the About page have a simplified header instead of none?
3. Do you want to keep the old co-pilot.tsx as a reference or fully delete it?

---

## Next Session Recommendations

1. ~~Update CLAUDE.md with new client architecture~~ ✅ Done
2. Add route-based code splitting for performance
3. Consider adding error boundaries per-route
4. Review and clean up old documentation in `docs/melswork/needs-updating/`
