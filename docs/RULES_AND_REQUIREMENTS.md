# Vecto Pilot - Rules and Requirements Document

**Created:** December 23, 2025
**Purpose:** Consolidate all rules, identify terminology issues, document duplicates, and define the desired state for repository cleanup.

---

## Table of Contents

1. [Terminology Consolidation (Lexicon Issues)](#1-terminology-consolidation-lexicon-issues)
2. [Current State Analysis](#2-current-state-analysis)
3. [Desired State Requirements](#3-desired-state-requirements)
4. [Critical Rules (Extracted from Code Comments)](#4-critical-rules-extracted-from-code-comments)
5. [Identified Duplicates](#5-identified-duplicates)
6. [Data Flow Requirements](#6-data-flow-requirements)
7. [Component Naming Standards](#7-component-naming-standards)
8. [Database Table Usage](#8-database-table-usage)
9. [JSON Parsing Requirements](#9-json-parsing-requirements)
10. [Caching Policy](#10-caching-policy)
11. [Implementation Checklist](#11-implementation-checklist)

---

## 1. Terminology Consolidation (Lexicon Issues)

### Current Inconsistencies

| Current Term(s) | Defined In | Actual Usage | **Standardized Term** |
|-----------------|------------|--------------|----------------------|
| SmartBlocks, Smart Blocks, smart blocks | LEXICON.md | `blocks-fast.js`, `ranking_candidates` table | **Strategy Venue Cards** |
| blocks, venue blocks | Code comments | Same as above | **Strategy Venue Cards** |
| blocks-fast | API endpoint | `/api/blocks-fast` | **Strategy Cards API** |
| BarsTable | Component | Shows venues from strategy pipeline | **StrategyVenuesTable** |
| BarTab | Component | Shows venues from `/api/venues/nearby` | **OpenedBarsTab** |
| venues tab | UI label | `activeTab === 'venues'` | **Opened Bars** |
| Strategist | LEXICON.md | Claude - strategic overview | **Strategist** (keep) |
| Briefer | LEXICON.md | Gemini - events/traffic/news | **Briefer** (keep) |
| Consolidator | LEXICON.md | GPT-5.2 - immediate strategy | **Consolidator** (keep) |

### Required Terminology Updates

1. **LEXICON.md Updates:**
   - "Smart Blocks" → "Strategy Venue Cards"
   - Add clarification that `blocks-fast.js` generates Strategy Venue Cards
   - Add "Opened Bars" as the venues tab terminology

2. **Code Updates:**
   - `SmartBlocksStatus.tsx` → rename to `StrategyCardsStatus.tsx`
   - `BarsTable.tsx` → rename to `StrategyVenuesTable.tsx` (shows strategy pipeline venues)
   - `BarTab.tsx` → rename to `OpenedBarsTab.tsx` (independent venue discovery)

3. **UI Label Updates:**
   - Tab label "Venues" → "Opened Bars"

---

## 2. Current State Analysis

### Tab Structure (Current)

```
Bottom Navigation:
├── Strategy (activeTab === 'strategy') ← DEFAULT landing page ✓
├── Venues (activeTab === 'venues') ← Should be "Opened Bars"
├── Briefing (activeTab === 'briefing')
├── Map (activeTab === 'map')
└── Donation (activeTab === 'donation')
```

### Strategy Tab Components (Current)

```
Strategy Tab:
├── GreetingBanner (holiday detection)
├── Selection Controls (selected blocks)
├── Current Strategy Card (strategy_for_now from GPT-5.2)
├── Smart Blocks Header (metadata)
├── BarsTable (shows isOpen venues from strategy pipeline) ← DUPLICATE CONCERN
├── Blocks List (venue cards with full details)
├── AI Strategy Coach (chat)
└── SmartBlocksStatus (pipeline progress)
```

### Venues Tab Components (Current)

```
Venues Tab:
└── BarTab (independent query to /api/venues/nearby)
    └── Fetches from nearby_venues table
    └── Independent of strategy pipeline
```

### Data Sources

| Component | Data Source | Database Table |
|-----------|-------------|----------------|
| Strategy Card | `/api/blocks-fast` | `strategies.strategy_for_now` |
| Strategy Venue Cards | `/api/blocks-fast` | `ranking_candidates` |
| BarsTable | From blocks prop (strategy pipeline) | `ranking_candidates.features.isOpen` |
| BarTab (Venues) | `/api/venues/nearby` | `nearby_venues` |
| Header Info | From snapshot | `snapshots` |

---

## 3. Desired State Requirements

### 3.1 Landing Page: Strategy Tab

**Requirement:** Strategy tab is the landing page.
**Status:** ✅ Already implemented (`activeTab = 'strategy'` default in co-pilot.tsx:88)

### 3.2 Venues Tab → "Opened Bars"

**Requirement:** Rename and simplify the Venues tab.

**New Tab Name:** "Opened Bars"

**Required Fields Only:**
| Field | Source Column | Description |
|-------|---------------|-------------|
| QTY | Count of `is_open === true` | Number of open bars |
| Name | `nearby_venues.name` | Venue name |
| Ranked | `nearby_venues.expense_level` | Price tier ($-$$$$) |
| Is Open | `nearby_venues.is_open` | Boolean (filter to TRUE only) |
| Coords | `nearby_venues.lat`, `nearby_venues.lng` | Location |
| Address | `nearby_venues.address` | Full address |
| City/State | From coords lookup | Derived from coordinates |
| Hours | `nearby_venues.hours_today` | Today's hours |
| Phone | `nearby_venues.phone` | Contact number |

**Filter Rule:** Only show venues where `is_open === true`

### 3.3 Header Table (New Component)

**Requirement:** Create a header table component showing snapshot context.

**Component Name:** `SnapshotHeaderTable`

**Data Source:** `snapshots` table + `users` table (via snapshot)

**Fields:**
| Field | Source | Description |
|-------|--------|-------------|
| Captured Time | `snapshots.created_at` | When snapshot was taken |
| AQI | `snapshots.air.aqi` | Air quality index |
| Weather | `snapshots.weather.description` | Weather conditions |
| Location | `snapshots.city` / `snapshots.state` | City, State |
| Daypart | `snapshots.day_part_key` | morning/afternoon/evening/night |
| DOW | `snapshots.dow` | Day of week (0=Sun, 6=Sat) |

**Not Included:** Driver-specific data (this is snapshot context only)

### 3.4 Tab Separation

**Requirement:** Each tab should be completely separate with no shared state.

**Current Issue:** BarsTable component appears in Strategy tab but displays venue data that could overlap with Venues tab.

**Solution:**
1. Strategy Tab: Remove BarsTable component OR rename to make purpose clear
2. Opened Bars Tab: Only shows `nearby_venues` data (independent query)
3. Components should have unique, descriptive names

---

## 4. Critical Rules (Extracted from Code Comments)

### 4.1 Location Rules

```
// CRITICAL: LLMs cannot reverse geocode - always provide formatted_address
// CRITICAL: GPS-first - no IP fallback, no default locations
// Coordinates from Google APIs or DB, never from AI
// location-context-clean.tsx is the single weather source
```

**Rule:** Never send raw coordinates to LLMs. Always resolve to `formatted_address` before passing to AI.

### 4.2 Model Parameter Rules

```javascript
// GPT-5.2 and o1 models don't support temperature - pass undefined
// CRITICAL: Use reasoning_effort, NOT reasoning: { effort: ... }
// WRONG: { reasoning: { effort: "medium" } }
// CORRECT: { model: "gpt-5.2", reasoning_effort: "medium", max_completion_tokens: 32000 }
```

**Rule:** Always check MODEL.md before using AI model parameters.

### 4.3 Venue Open/Closed Status

```javascript
// NOTE: isOpen is calculated server-side using the correct venue timezone
// Client-side recalculation was removed because browser timezone != venue timezone
// Server calculates isOpen in venue-enrichment.js using Intl.DateTimeFormat with snapshot timezone
```

**Rule:** Never recalculate `isOpen` on the client. Trust the server's timezone-aware calculation.

### 4.4 Event Validation

```javascript
// CRITICAL: When validation API fails, KEEP events as unvalidated (not filtered out)
// CRITICAL: When validation fails, KEEP events as unvalidated (not filtered out)
// CRITICAL: On any error, KEEP events as unvalidated (not filtered out)
```

**Rule:** Event validation failures should result in events being kept, not filtered out.

### 4.5 Briefing Data

```javascript
// NOTE: Briefing is now OPTIONAL - blocks generation proceeds even without briefing content
// NOTE: Event validation disabled - Gemini handles event discovery directly
```

**Rule:** Strategy generation should not fail if briefing is unavailable.

### 4.6 Database Operations

```javascript
// CRITICAL: Always preserve GPT-5 coords even if enrichment fails
// CRITICAL: Add retry logic for transient Google API failures (5xx, 429)
// CRITICAL: Use onConflictDoNothing to preserve the FIRST insert with model_name
// CRITICAL: Set phase='starting' on insert to avoid NULL phase race condition
```

**Rule:** Database operations should be idempotent and handle race conditions.

### 4.7 Venue Enrichment

```javascript
// CRITICAL: Calculate isOpen ourselves using snapshot timezone (don't trust Google's openNow)
// CRITICAL: Use timezone for accurate time-based venue filtering
```

**Rule:** Use venue's timezone for all time-sensitive calculations, not browser or server timezone.

### 4.8 Snapshot Linking

```javascript
// All data MUST link to snapshot_id:
// - strategies.snapshot_id -> AI outputs
// - briefings.snapshot_id -> Real-time data
// - rankings.snapshot_id -> Venue sessions
// - ranking_candidates.snapshot_id -> Individual venues
// - actions.snapshot_id -> User behavior
```

**Rule:** Every data record must have a `snapshot_id` foreign key for ML training correlation.

---

## 5. Identified Duplicates

### 5.1 Venue Display Components

| Component | Purpose | Data Source | Status |
|-----------|---------|-------------|--------|
| `BarsTable.tsx` | Shows bars from strategy pipeline | `blocks` prop | KEEP - rename to `StrategyVenuesTable` |
| `BarTab.tsx` | Shows nearby bars (independent) | `/api/venues/nearby` | KEEP - rename to `OpenedBarsTab` |

**Resolution:** These are NOT duplicates - they serve different purposes. Rename for clarity.

### 5.2 Location Hooks (Previously Deleted)

Per LESSONS_LEARNED.md, these were already cleaned up:
- ~~`useGeoPosition.ts`~~ - Deleted, replaced by location-context-clean
- ~~`use-geolocation.tsx`~~ - Deleted, duplicate
- ~~`use-enhanced-geolocation.tsx`~~ - Deleted, duplicate

### 5.3 Strategy Files

| File | Purpose | Status |
|------|---------|--------|
| `strategy-generator.js` (root) | Worker process spawned by gateway | KEEP |
| `server/lib/strategy/strategy-generator.js` | Pipeline logic | KEEP |
| `server/lib/strategy/strategy-generator-parallel.js` | Parallel execution | KEEP |

**These are NOT duplicates** - root file spawns the worker, lib files contain logic.

### 5.4 Potential Redundancy in Terminology

- `blocks-fast.js` endpoint generates what LEXICON calls "Smart Blocks"
- The endpoint is at `/api/blocks-fast` but returns `blocks` array
- Consider renaming response field to `strategyVenueCards` for clarity

---

## 6. Data Flow Requirements

### 6.1 Current Flow (Strategy Tab)

```
GPS Coordinates
    ↓
/api/location/resolve (creates snapshot)
    ↓
snapshot_id dispatched via custom event
    ↓
POST /api/blocks-fast (triggers TRIAD pipeline)
    ↓
Parallel: Briefer + Holiday Detector
    ↓
Sequential: Immediate Strategy (GPT-5.2)
    ↓
Sequential: Venue Planner (GPT-5.2)
    ↓
Sequential: Google APIs (Routes, Places)
    ↓
Store in: strategies, briefings, rankings, ranking_candidates
    ↓
Return blocks + strategy to client
```

### 6.2 Current Flow (Opened Bars Tab)

```
GPS Coordinates + City/State
    ↓
/api/venues/nearby (independent query)
    ↓
Gemini search for nearby venues
    ↓
Store in: nearby_venues (ML training data)
    ↓
Return venues to client
```

### 6.3 Required Change: JSON Parsing to DB

**Current Issue:** Some LLM outputs are stored as raw JSON blobs and parsed client-side.

**Required Behavior:** Parse JSON outputs on server and store in respective database columns.

**Tables Affected:**
| LLM Output | Current Storage | Required Storage |
|------------|-----------------|------------------|
| Events | `briefings.events` (JSONB) | Parse and store in `discovered_events` or `venue_events` |
| Traffic | `briefings.traffic_conditions` (JSONB) | Parse and store in `traffic_zones` |
| Weather | `briefings.weather_current` (JSONB) | Already correct (JSONB is appropriate) |
| Venue details | `ranking_candidates.features` (JSONB) | Extract key fields to columns |

---

## 7. Component Naming Standards

### 7.1 Naming Convention

```
[Feature][Type].tsx

Examples:
- StrategyCard.tsx (Strategy tab - main card)
- StrategyVenuesTable.tsx (Strategy tab - venue list)
- OpenedBarsTab.tsx (Opened Bars tab - full component)
- SnapshotHeaderTable.tsx (Header - snapshot context)
- BriefingTab.tsx (Briefing tab - full component)
- MapTab.tsx (Map tab - full component)
```

### 7.2 Required Renames

| Current Name | New Name | Reason |
|--------------|----------|--------|
| `BarsTable.tsx` | `StrategyVenuesTable.tsx` | Clarify it's strategy venues, not independent bars |
| `BarTab.tsx` | `OpenedBarsTab.tsx` | Match "Opened Bars" tab name |
| `SmartBlocksStatus.tsx` | `StrategyCardsStatus.tsx` | Align with terminology |
| Tab label "Venues" | "Opened Bars" | Per user requirement |

---

## 8. Database Table Usage

### 8.1 Core Tables for Strategy Flow

| Table | Purpose | Linked Via |
|-------|---------|------------|
| `snapshots` | Point-in-time context | `snapshot_id` (PK) |
| `strategies` | AI-generated strategy text | `snapshot_id` (FK) |
| `briefings` | Events, traffic, weather data | `snapshot_id` (FK) |
| `rankings` | Venue recommendation sets | `snapshot_id` (FK) |
| `ranking_candidates` | Individual venue details | `ranking_id` (FK), `snapshot_id` |

### 8.2 Tables for Opened Bars Flow

| Table | Purpose | Linked Via |
|-------|---------|------------|
| `nearby_venues` | ML training data for bars | `snapshot_id` (FK) |

### 8.3 Tables for Header Display

| Table | Purpose | Fields Used |
|-------|---------|-------------|
| `snapshots` | Snapshot context | `created_at`, `air`, `weather`, `city`, `state`, `day_part_key`, `dow` |
| `coords_cache` | Location identity | `city`, `state` (via `coord_key`) |

---

## 9. JSON Parsing Requirements

### 9.1 Current State

LLM outputs are often stored as JSONB and parsed on multiple occasions:
- Server stores raw JSON in `briefings.events`
- Client fetches and parses in React components
- Other server endpoints re-fetch and re-parse

### 9.2 Required State

**Parse Once, Store Properly:**

```javascript
// Example: Events from Briefer (Gemini)
// BEFORE: Store raw JSON
await db.update(briefings).set({ events: rawJsonFromGemini });

// AFTER: Parse and store in proper tables
const parsedEvents = JSON.parse(rawJsonFromGemini);
for (const event of parsedEvents) {
  await db.insert(discovered_events).values({
    title: event.title,
    venue_name: event.venue,
    event_date: event.date,
    // ... other fields
  });
}
await db.update(briefings).set({
  events: parsedEvents  // Also keep in briefings for quick access
});
```

### 9.3 Audit Trail Benefits

By parsing to proper tables:
1. **Better querying:** SQL queries vs JSON parsing
2. **Audit trail:** Each event has its own row with timestamps
3. **Deduplication:** Can use database constraints
4. **ML training:** Structured data for model training

---

## 10. Caching Policy

### 10.1 No Snapshot Caching

**Requirement:** Snapshots should NOT be cached client-side.

**Current Issue:** Some snapshot data may be cached in:
- React Query cache
- localStorage (strategy data)

**Required Behavior:**
```typescript
// React Query config for snapshots
const { data } = useQuery({
  queryKey: ['snapshot', snapshotId],
  queryFn: fetchSnapshot,
  staleTime: 0,        // Always stale
  gcTime: 0,           // Don't keep in cache
  refetchOnMount: true // Always refetch
});
```

### 10.2 Appropriate Caching

| Data Type | Cache Strategy | Reason |
|-----------|---------------|--------|
| Snapshots | No cache | Fresh data required |
| Strategy text | Session only | May regenerate |
| Briefing data | 5 min staleTime | Changes slowly |
| Coords cache | Long-term (DB) | Address resolution expensive |
| Places cache | 24 hours | Business hours rarely change |

---

## 11. Implementation Checklist

### Phase 1: Terminology & Naming

- [ ] Update LEXICON.md with corrected terminology
- [ ] Rename `BarsTable.tsx` → `StrategyVenuesTable.tsx`
- [ ] Rename `BarTab.tsx` → `OpenedBarsTab.tsx`
- [ ] Rename `SmartBlocksStatus.tsx` → `StrategyCardsStatus.tsx`
- [ ] Update tab label "Venues" → "Opened Bars" in BottomTabNavigation
- [ ] Update all references to renamed components

### Phase 2: Header Table Component

- [ ] Create `SnapshotHeaderTable.tsx` component
- [ ] Add to Strategy tab layout
- [ ] Fields: Captured Time, AQI, Weather, Location, Daypart, DOW
- [ ] Style to match existing UI

### Phase 3: Opened Bars Tab Simplification

- [ ] Simplify OpenedBarsTab to show only required fields
- [ ] Filter to only show `is_open === true` venues
- [ ] Add QTY count of open venues
- [ ] Remove unnecessary fields/complexity

### Phase 4: JSON Parsing

- [ ] Audit all JSONB columns in briefings table
- [ ] Implement server-side parsing for events
- [ ] Store parsed events in `discovered_events` table
- [ ] Update client to read from parsed tables

### Phase 5: Caching Cleanup

- [ ] Remove localStorage for strategy/snapshot data
- [ ] Update React Query config for snapshots (no caching)
- [ ] Verify briefing data uses appropriate staleTime

### Phase 6: Documentation Update

- [ ] Update CLAUDE.md with new terminology
- [ ] Update component READMEs
- [ ] Update ARCHITECTURE.md if structure changes
- [ ] Add this document to docs/architecture/

---

## Summary

This document captures the current state, desired state, and implementation path for consolidating the Vecto Pilot repository. The key changes are:

1. **Terminology:** Standardize on "Strategy Venue Cards" instead of "Smart Blocks"
2. **Tab naming:** "Venues" → "Opened Bars"
3. **Component clarity:** Rename components to reflect their purpose
4. **Header table:** New component for snapshot context
5. **JSON parsing:** Parse LLM outputs server-side, store in proper tables
6. **No snapshot caching:** Fresh data on each request
7. **Audit trail:** Better tracking through proper database storage

---

**Document Status:** DRAFT - Awaiting review and approval before implementation.
