# Vecto Pilot - Rules and Requirements

**Version:** 2.0
**Created:** January 2, 2026
**Purpose:** Single source of truth for repository cleanup, rules extracted from code comments, and implementation requirements.

---

## Table of Contents

1. [Terminology (Lexicon Fixes)](#1-terminology-lexicon-fixes)
2. [Page & Tab Structure](#2-page--tab-structure)
3. [Component Inventory](#3-component-inventory)
4. [Opened Bars Tab Specification](#4-opened-bars-tab-specification)
5. [Header Table Specification](#5-header-table-specification)
6. [Rules Extracted from Code Comments](#6-rules-extracted-from-code-comments)
7. [JSON Parsing Requirements](#7-json-parsing-requirements)
8. [Caching Policy](#8-caching-policy)
9. [Identified Duplicates](#9-identified-duplicates)
10. [Database Tables Reference](#10-database-tables-reference)
11. [File Workflow Map](#11-file-workflow-map)
12. [Implementation Phases](#12-implementation-phases)

---

## 1. Terminology (Lexicon Fixes)

### Problem

LEXICON.md defines "SmartBlocks" but the codebase uses inconsistent terms. The Replit agent was asked to update documentation but did not.

### Current → Standard Mapping

| Current Term | Where Used | **Standardized Term** |
|--------------|------------|----------------------|
| SmartBlocks, Smart Blocks, smart blocks | LEXICON.md, comments | **Strategy Venue Cards** |
| blocks | `blocks-fast.js` response | **Strategy Venue Cards** |
| BarsTable | Component name | **StrategyVenuesDisplay** |
| BarTab | Component name | **OpenedBarsTab** |
| Venues (tab label) | UI | **Opened Bars** |
| blocks-fast | API endpoint | Keep as `/api/blocks-fast` |
| ranking_candidates | DB table | Keep (internal) |
| nearby_venues | DB table | Keep (for Opened Bars) |

### Files to Update

1. `LEXICON.md` - Update all "SmartBlocks" → "Strategy Venue Cards"
2. `client/src/components/BarsTable.tsx` → Rename to `StrategyVenuesDisplay.tsx`
3. `client/src/components/BarTab.tsx` → Rename to `OpenedBarsTab.tsx`
4. `client/src/components/SmartBlocksStatus.tsx` → Rename to `StrategyCardsStatus.tsx`
5. `client/src/pages/co-pilot.tsx` → Update tab label "Venues" → "Opened Bars"
6. All README files referencing these components

---

## 2. Page & Tab Structure

### Landing Page: Strategy Tab

**Status:** ✅ Already implemented
**Location:** `co-pilot.tsx:88` - `activeTab = 'strategy'` default

### Tab Layout (Bottom Navigation)

```
┌─────────────────────────────────────────────────────────────┐
│ Strategy │ Opened Bars │ Briefing │ Map │ Donation │        │
└─────────────────────────────────────────────────────────────┘
     ↑            ↑
  DEFAULT    RENAMED from "Venues"
```

### Tab Separation Rule

**Each tab MUST be completely independent:**
- Own data fetching (no shared queries between tabs)
- Own component tree (no cross-tab component sharing)
- Own loading states
- No UI changes when switching - just show/hide

---

## 3. Component Inventory

### Strategy Tab Components

| Component | File | Purpose | Data Source |
|-----------|------|---------|-------------|
| GreetingBanner | `co-pilot/GreetingBanner.tsx` | Holiday greeting | `snapshot.holiday` |
| Strategy Card | Inline in `co-pilot.tsx` | Current strategy text | `strategies.strategy_for_now` |
| StrategyVenuesDisplay | `BarsTable.tsx` (rename) | Venue cards from pipeline | `ranking_candidates` |
| SmartBlocksStatus | `SmartBlocksStatus.tsx` | Pipeline progress | SSE events |
| CoachChat | `CoachChat.tsx` | AI chat | `/api/chat` |

### Opened Bars Tab Components

| Component | File | Purpose | Data Source |
|-----------|------|---------|-------------|
| OpenedBarsTab | `BarTab.tsx` (rename) | Independent bar list | `nearby_venues` |

### Briefing Tab Components

| Component | File | Purpose | Data Source |
|-----------|------|---------|-------------|
| BriefingTab | `BriefingTab.tsx` | Events, traffic, weather | `briefings` table |
| EventsComponent | `EventsComponent.tsx` | Event list | `briefings.events` |

### Header Components (NEW)

| Component | File | Purpose | Data Source |
|-----------|------|---------|-------------|
| SnapshotHeader | CREATE NEW | Context header | `snapshots` table |

---

## 4. Opened Bars Tab Specification

### Data Source

**Table:** `nearby_venues`
**Endpoint:** `/api/venues/nearby`
**Independence:** Fetches independently of strategy pipeline

### Required Fields Only

| Display Name | DB Column | Type | Notes |
|--------------|-----------|------|-------|
| **QTY** | COUNT(*) WHERE `is_open = true` | integer | Header count |
| **Name** | `name` | text | Venue name |
| **Ranked** | `expense_level` | text | `$` to `$$$$` |
| **Is Open** | `is_open` | boolean | **Filter to TRUE only** |
| **Coords** | `lat`, `lng` | doublePrecision | For navigation |
| **Address** | `address` | text | Full street address |
| **City** | `city` | text | From DB or coords lookup |
| **State** | `state` | text | From DB or coords lookup |
| **Hours** | `hours_today` | text | Today's operating hours |
| **Phone** | `phone` | text | Contact number |

### Filter Rule

```sql
SELECT * FROM nearby_venues
WHERE snapshot_id = :snapshotId
  AND is_open = true
ORDER BY expense_rank DESC, name ASC;
```

### Removed Fields (Not Displayed)

- `crowd_level` - Remove
- `rideshare_potential` - Remove
- `closing_soon` - Remove (implied by hours)
- `minutes_until_close` - Remove
- All ML training fields - Keep in DB, don't display

---

## 5. Header Table Specification

### Purpose

Display snapshot context at the top of the page. **Nothing driver-specific** - purely contextual data from the snapshot.

### Data Sources

**Primary:** `snapshots` table
**Secondary:** `users` table (if needed)

### Required Fields

| Display Name | DB Column | Table | Type | Example |
|--------------|-----------|-------|------|---------|
| **Captured** | `created_at` | snapshots | timestamp | "Jan 2, 2026 3:45 PM" |
| **AQI** | `air.aqi` | snapshots (JSONB) | integer | "42" |
| **Weather** | `weather.conditions` | snapshots (JSONB) | text | "Partly Cloudy, 68°F" |
| **Location** | `city`, `state` | snapshots | text | "Dallas, TX" |
| **Daypart** | `day_part_key` | snapshots | text | "afternoon" |
| **DOW** | `dow` | snapshots | integer | Display as "Thursday" |

### Component: SnapshotHeader.tsx (CREATE)

```tsx
interface SnapshotHeaderProps {
  snapshotId: string;
}

// Fields from snapshot
interface HeaderData {
  capturedAt: string;      // formatted from created_at
  aqi: number | null;      // from snapshot.air?.aqi
  weather: string | null;  // from snapshot.weather?.conditions + tempF
  location: string;        // `${city}, ${state}`
  daypart: string;         // day_part_key
  dow: string;             // formatted from dow (0=Sun → "Sunday")
}
```

### UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│ 📍 Dallas, TX │ 🕐 Thu 3:45 PM │ 🌤️ Partly Cloudy 68° │ AQI 42 │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Rules Extracted from Code Comments

### CRITICAL Rules (Must Follow)

#### 6.1 Location Rules

```javascript
// server/api/location/snapshot.js:71
// NEVER send raw coords to strategists - they can't reverse geocode

// docs - GPS-first, no IP fallback, no default locations
// Coordinates from Google APIs or DB, never from AI
```

**Rule:** Always resolve coordinates to `formatted_address` before passing to any LLM.

#### 6.2 Venue Timezone Rules

```javascript
// server/lib/venue/venue-enrichment.js:557
// CRITICAL: Calculate isOpen ourselves using snapshot timezone (don't trust Google's openNow)

// client/src/components/BarsTable.tsx:13
// NOTE: isOpen is calculated server-side using the correct venue timezone
// Client-side recalculation was removed because browser timezone != venue timezone
```

**Rule:** Never recalculate `isOpen` on the client. Trust server's timezone-aware calculation.

#### 6.3 Model Parameter Rules

```javascript
// server/lib/ai/adapters/index.js:45
// GPT-5.2 and o1 models don't support temperature - pass undefined

// WRONG: { reasoning: { effort: "medium" } }
// CORRECT: { reasoning_effort: "medium", max_completion_tokens: 32000 }
```

**Rule:** GPT-5.2 uses `reasoning_effort` (flat), not nested `reasoning.effort`. No temperature.

#### 6.4 Event Validation Rules

```javascript
// server/lib/briefing/event-schedule-validator.js:110,145,193
// CRITICAL: When validation API fails, KEEP events as unvalidated (not filtered out)
// CRITICAL: On any error, KEEP events as unvalidated (not filtered out)
```

**Rule:** Never filter out events on validation failure. Keep them unvalidated.

#### 6.5 Venue Enrichment Rules

```javascript
// server/lib/venue/venue-enrichment.js:159
// CRITICAL: Always preserve GPT-5 coords even if enrichment fails

// server/lib/venue/venue-enrichment.js:466
// CRITICAL: Add retry logic for transient Google API failures (5xx, 429)
```

**Rule:** Original LLM coordinates are authoritative. Google enrichment is supplementary.

#### 6.6 Database Rules

```javascript
// server/lib/strategy/strategy-generator-parallel.js:172
// CRITICAL: Use onConflictDoNothing to preserve the FIRST insert with model_name

// server/lib/strategy/strategy-generator-parallel.js:228
// CRITICAL: Set phase='starting' on insert to avoid NULL phase race condition
```

**Rule:** Database operations must handle race conditions. First write wins.

#### 6.7 Snapshot Linking Rules

```javascript
// All data MUST link to snapshot_id:
// - strategies.snapshot_id -> AI outputs
// - briefings.snapshot_id -> Real-time data
// - rankings.snapshot_id -> Venue sessions
// - ranking_candidates.snapshot_id -> Individual venues
// - actions.snapshot_id -> User behavior
// - nearby_venues.snapshot_id -> ML training
```

**Rule:** Every data record requires `snapshot_id` for ML training correlation.

### NOTE Rules (Context)

```javascript
// server/lib/venue/enhanced-smart-blocks.js:61
// NOTE: Briefing is now OPTIONAL - blocks generation proceeds even without briefing

// server/lib/briefing/briefing-service.js:2097
// NOTE: Event validation disabled - Gemini handles event discovery directly

// client/src/components/SmartBlocksStatus.tsx:39
// ALWAYS show progress bars - don't hide them
```

### NEVER Rules

```javascript
// LESSONS_LEARNED.md:811
// NEVER trust client-provided user_id

// server/api/location/snapshot.js:71
// NEVER send raw coords to strategists
```

---

## 7. JSON Parsing Requirements

### Current Problem

LLM outputs are stored as JSONB blobs and parsed in multiple places (server AND client), leading to:
- Duplicate parsing logic
- Inconsistent error handling
- Difficult auditing

### Required Behavior

**Parse Once on Server, Store in Proper Tables**

### JSONB Columns Requiring Server-Side Parsing

| Column | Table | Current Parsing | Required Change |
|--------|-------|-----------------|-----------------|
| `events` | briefings | `JSON.parse` in briefing-service.js | ✅ Already server-side |
| `traffic_conditions` | briefings | Direct access | Store in `traffic_zones` table |
| `weather_current` | briefings | Direct access | ✅ JSONB is appropriate |
| `features` | ranking_candidates | Direct property access | ✅ JSONB is appropriate |
| `business_hours` | ranking_candidates | String parsing in BarsTable | Parse server-side, store structured |

### Client-Side JSON.parse Locations to Review

```
client/src/utils/co-pilot-helpers.ts:59,85 - SSE event parsing (acceptable)
client/src/components/CoachChat.tsx:124,344 - WebSocket message parsing (acceptable)
client/src/components/strategy/_future/ConsolidatedStrategyComp.tsx:82 - Parse strategy text (review needed)
```

### Audit Trail Benefit

By parsing to proper tables:
1. SQL queries instead of JSON path expressions
2. Each event/venue has its own row with timestamps
3. Database constraints for deduplication
4. Structured data for ML training

---

## 8. Caching Policy

### Snapshots: NO CLIENT CACHE

**Requirement:** Snapshots should NOT be cached.

**Current Caching Locations Found:**

| Location | Type | Key Pattern |
|----------|------|-------------|
| localStorage | Strategy text | `vecto_persistent_strategy` |
| localStorage | Snapshot ID | `vecto_strategy_snapshot_id` |
| React Query | Snapshot data | `['snapshot', snapshotId]` |
| React Query | Strategy data | `['strategy', snapshotId]` |
| React Query | Blocks data | `['blocks', snapshotId]` |

**Required Changes:**

```typescript
// React Query config for snapshots - NO CACHE
const { data } = useQuery({
  queryKey: ['snapshot', snapshotId],
  queryFn: fetchSnapshot,
  staleTime: 0,           // Always stale
  gcTime: 0,              // Don't keep in garbage collection
  refetchOnMount: 'always' // Always refetch on mount
});

// Remove localStorage persistence
localStorage.removeItem('vecto_persistent_strategy');
localStorage.removeItem('vecto_strategy_snapshot_id');
```

### Appropriate Caching (Keep)

| Data | Location | Duration | Reason |
|------|----------|----------|--------|
| Device ID | localStorage | Permanent | Identity |
| Auth Token | localStorage | Session | Authentication |
| coords_cache | DB table | Long-term | Expensive API calls |
| places_cache | DB table | 24 hours | Business hours |
| Bar Tab venues | React Query | 5 min staleTime | Already correct |

---

## 9. Identified Duplicates

### Confirmed NOT Duplicates (Different Purpose)

| Component A | Component B | Difference |
|-------------|-------------|------------|
| `BarsTable.tsx` | `BarTab.tsx` | BarsTable shows strategy pipeline venues; BarTab is independent Gemini search |
| `SmartBlocks.tsx` (_future) | `MarketIntelligenceBlocks.tsx` (_future) | Different data models (briefing vs staging areas) |

### Actual Duplicates/Redundancy

| Issue | Files | Resolution |
|-------|-------|------------|
| Location hooks | Previously cleaned | ✅ Already resolved per LESSONS_LEARNED.md |
| Strategy text parsing | `co-pilot.tsx`, `useStrategyPolling.ts` | Consolidate to single hook |
| Snapshot event handlers | Multiple components listen to `vecto-snapshot-saved` | Document as intentional (event-driven architecture) |

### Files in `_future/` Folders (Staging)

These are NOT duplicates - they are staged for future implementation:
- `client/src/components/_future/MarketIntelligenceBlocks.tsx`
- `client/src/components/strategy/_future/SmartBlocks.tsx`
- `client/src/components/strategy/_future/ConsolidatedStrategyComp.tsx`
- `client/src/_future/engine/reflectionEngine.ts`

---

## 10. Database Tables Reference

### Strategy Tab Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `snapshots` | Point-in-time context | `snapshot_id`, `city`, `state`, `weather`, `air`, `day_part_key`, `dow` |
| `strategies` | AI strategy output | `snapshot_id`, `strategy_for_now`, `consolidated_strategy`, `minstrategy` |
| `rankings` | Venue set metadata | `ranking_id`, `snapshot_id`, `session_id` |
| `ranking_candidates` | Individual venues | `snapshot_id`, `name`, `address`, `features`, `isOpen` |
| `briefings` | Events, traffic, weather | `snapshot_id`, `events`, `traffic_conditions` |

### Opened Bars Tab Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `nearby_venues` | Independent bar search | `snapshot_id`, `name`, `is_open`, `expense_level`, `phone`, `hours_today` |

### Header Table Source

| Table | Fields Used |
|-------|-------------|
| `snapshots` | `created_at`, `air.aqi`, `weather.conditions`, `weather.tempF`, `city`, `state`, `day_part_key`, `dow` |

---

## 11. File Workflow Map

### Strategy Tab Workflow

```
User opens app
    ↓
location-context-clean.tsx (get GPS)
    ↓
POST /api/location/resolve (create snapshot)
    ↓
Dispatch: vecto-snapshot-saved event
    ↓
co-pilot.tsx receives event
    ↓
POST /api/blocks-fast (trigger TRIAD pipeline)
    ↓
┌─────────────────────────────────────────┐
│ TRIAD Pipeline (strategy-generator.js) │
├─────────────────────────────────────────┤
│ Phase 1: Strategist + Briefer (parallel)│
│ Phase 2: Consolidator (sequential)      │
│ Phase 3: Venue Planner (sequential)     │
│ Phase 4: Google APIs enrichment         │
└─────────────────────────────────────────┘
    ↓
SSE events to SmartBlocksStatus.tsx
    ↓
GET /api/blocks-fast (poll for results)
    ↓
Display in StrategyVenuesDisplay.tsx
```

### Opened Bars Tab Workflow

```
User switches to Opened Bars tab
    ↓
BarTab.tsx useQuery fires
    ↓
GET /api/venues/nearby?lat=X&lng=Y
    ↓
venue-intelligence.js (Gemini search)
    ↓
Store in nearby_venues table
    ↓
Return to client, display
```

### Key Files per Workflow

**Strategy Tab:**
- `client/src/pages/co-pilot.tsx` - Main orchestrator
- `client/src/contexts/location-context-clean.tsx` - GPS + snapshot creation
- `server/api/strategy/blocks-fast.js` - Pipeline trigger
- `server/lib/strategy/strategy-generator-parallel.js` - Execution
- `server/lib/venue/venue-enrichment.js` - Google API enrichment
- `client/src/components/BarsTable.tsx` - Venue display

**Opened Bars Tab:**
- `client/src/components/BarTab.tsx` - Self-contained
- `server/api/venue/venue-intelligence.js` - Gemini search

---

## 12. Implementation Phases

### Phase 1: Terminology & Component Renames

- [ ] Update `LEXICON.md` - "SmartBlocks" → "Strategy Venue Cards"
- [ ] Rename `BarsTable.tsx` → `StrategyVenuesDisplay.tsx`
- [ ] Rename `BarTab.tsx` → `OpenedBarsTab.tsx`
- [ ] Rename `SmartBlocksStatus.tsx` → `StrategyCardsStatus.tsx`
- [ ] Update all imports in `co-pilot.tsx`
- [ ] Update tab label "Venues" → "Opened Bars"
- [ ] Update all README files

### Phase 2: Header Table Component

- [ ] Create `client/src/components/SnapshotHeader.tsx`
- [ ] Fetch from `/api/location/snapshot/:id` or use context
- [ ] Display: Captured, AQI, Weather, Location, Daypart, DOW
- [ ] Add to `co-pilot.tsx` above tabs
- [ ] Style to match existing UI

### Phase 3: Opened Bars Tab Simplification

- [ ] Modify `OpenedBarsTab.tsx` to show only required fields
- [ ] Add filter: `is_open === true` only
- [ ] Add QTY count header
- [ ] Remove: crowd_level, rideshare_potential, closing_soon
- [ ] Keep: name, expense_level, is_open, lat/lng, address, city, state, hours_today, phone

### Phase 4: Remove Snapshot Caching

- [ ] Remove `localStorage.setItem('vecto_persistent_strategy', ...)`
- [ ] Remove `localStorage.setItem('vecto_strategy_snapshot_id', ...)`
- [ ] Update React Query config for snapshots: `staleTime: 0, gcTime: 0`
- [ ] Test that fresh data loads on each visit

### Phase 5: JSON Parsing Consolidation

- [ ] Audit all `JSON.parse` calls in client code
- [ ] Move business_hours parsing to server in blocks-fast.js
- [ ] Ensure events are fully parsed before storing in briefings
- [ ] Add proper error handling for malformed JSON

### Phase 6: Documentation Sync

- [ ] Update `CLAUDE.md` with new component names
- [ ] Update `client/src/components/README.md`
- [ ] Update `ARCHITECTURE.md` if structure changes
- [ ] Archive this document in `docs/architecture/`

---

## Summary of Key Rules

1. **GPS-first** - No IP fallback, no default locations
2. **Never raw coords to LLMs** - Always provide formatted_address
3. **Trust server isOpen** - Don't recalculate timezone on client
4. **GPT-5.2 quirks** - Use `reasoning_effort`, no temperature
5. **Keep events on failure** - Don't filter out unvalidated events
6. **Snapshot_id everywhere** - All data links to snapshot for ML
7. **No snapshot caching** - Fresh data on each request
8. **Parse JSON once** - Server-side, store in proper tables
9. **Components named uniquely** - No ambiguous naming

---

**Document Status:** Ready for implementation
**Next Step:** Begin Phase 1 (Terminology & Component Renames)
