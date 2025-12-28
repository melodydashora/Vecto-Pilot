# Pending Documentation Review

Items flagged by the Change Analyzer for human-AI validation.

---

## How to Use This File

1. Review each flagged item below
2. Check if the referenced doc needs updating
3. Update the doc if needed
4. Change status from `PENDING` to `REVIEWED`
5. Optionally move to `resolved.md`

## Status Legend

| Status | Meaning |
|--------|---------|
| `PENDING` | Needs review |
| `REVIEWED` | Reviewed, doc updated |
| `REVIEWED - No change` | Reviewed, no update needed |
| `DEFERRED` | Will review later |

---

## 2025-12-28 Session: Map Features

**Session Date:** 2025-12-28
**Branch:** main
**Status:** REVIEWED

### Changes Implemented

- [x] Bar markers on map (green=open, red=closing soon)
- [x] Multi-day event support (date range filtering)
- [x] SmartBlocks two-pass filtering (Grade A/B, spacing preferred)
- [x] Package lockfile regenerated

### Documentation Updated

- [x] `docs/memory/sessions/2025-12-28-map-features.md` - Full session notes
- [x] `client/src/components/README.md` - MapTab bar markers docs
- [x] `docs/review-queue/2025-12-28.md` - Clean analysis

### Pending Action (User)

Database migration fix required:
```sql
-- Run in Supabase SQL Editor (Dev database)
DROP INDEX IF EXISTS idx_events_dedupe;
CREATE UNIQUE INDEX idx_events_dedupe ON events_facts USING btree (
  COALESCE(venue_place_id, ''::text),
  lower(event_title),
  start_time,
  end_time
);
```

---

## 2025-12-27 Session: Router Refactor

**Session Date:** 2025-12-27
**Branch:** copilot/improve-slow-code-efficiency
**Status:** REVIEWED

### Major Refactor: React Router Implementation

Refactored the monolithic co-pilot.tsx (1700+ lines) into a router-based architecture.

#### Files Created
- [x] `client/src/routes.tsx` - React Router configuration
- [x] `client/src/layouts/CoPilotLayout.tsx` - Shared layout with conditional GlobalHeader
- [x] `client/src/contexts/co-pilot-context.tsx` - Centralized state for all pages
- [x] `client/src/pages/co-pilot/StrategyPage.tsx` - Main strategy page
- [x] `client/src/pages/co-pilot/BarsPage.tsx` - Venue listings
- [x] `client/src/pages/co-pilot/BriefingPage.tsx` - Weather, traffic, news
- [x] `client/src/pages/co-pilot/MapPage.tsx` - Interactive map
- [x] `client/src/pages/co-pilot/IntelPage.tsx` - Rideshare intel
- [x] `client/src/pages/co-pilot/AboutPage.tsx` - About/donation (no header)

#### Route Structure
```
/                         → Redirects to /co-pilot/strategy
/co-pilot                 → Redirects to /co-pilot/strategy
/co-pilot/strategy        → StrategyPage (AI + blocks + coach)
/co-pilot/bars            → BarsPage (venue listings)
/co-pilot/briefing        → BriefingPage (weather, traffic, news)
/co-pilot/map             → MapPage (interactive map)
/co-pilot/intel           → IntelPage (rideshare intel)
/co-pilot/about           → AboutPage (no GlobalHeader)
```

---

## High Priority Items (Deferred)

| Doc | Reason | Status |
|-----|--------|--------|
| `docs/architecture/database-schema.md` | Schema changes | DEFERRED |
| `docs/preflight/database.md` | Schema changes | DEFERRED |
| `docs/architecture/client-structure.md` | Router refactor | DEFERRED |

---

## Resolved Items

All items from previous sessions have been consolidated. See daily logs in `docs/review-queue/YYYY-MM-DD.md` for historical details.
