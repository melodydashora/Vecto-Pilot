# Intel Tab Architecture: Market Intelligence System

## Executive Summary

The Intel Tab provides rideshare drivers with actionable market intelligence based on economic gravity theory. It answers the critical question: **"Where does demand flow in my market?"** by integrating research data on market structures, deadhead risk, and algorithmic mechanics.

This document covers the complete architecture—from research theory to database schema to UI presentation.

---

## Table of Contents

1. [The Gravity Model Theory](#1-the-gravity-model-theory)
2. [Database Architecture](#2-database-architecture)
3. [API Endpoints](#3-api-endpoints)
4. [Client Architecture](#4-client-architecture)
5. [Intelligence Categories](#5-intelligence-categories)
6. [AI Coach Integration](#6-ai-coach-integration)
7. [Adding New Intelligence](#7-adding-new-intelligence)
8. [Research Foundation](#8-research-foundation)

---

## 1. The Gravity Model Theory

### Core Concept

Rideshare markets are not defined by city limits—they're defined by **economic gravity**. A "Core City" holds "Satellite Municipalities" in its operational sphere, just like planets hold moons.

```
┌─────────────────────────────────────────────────────────────────┐
│                    THE GRAVITY MODEL                             │
│                                                                  │
│                         ★ CORE                                   │
│                        (Dallas)                                  │
│                          │                                       │
│                ┌─────────┼─────────┐                            │
│                │         │         │                            │
│           ◐ Satellite  ◐ Satellite  ◐ Satellite                 │
│           (Plano)     (Irving)    (Frisco)                      │
│                │                   │                            │
│                └─────────┬─────────┘                            │
│                          │                                       │
│                     ○ Rural                                      │
│                    (Denton)                                      │
│                                                                  │
│   Legend:                                                        │
│   ★ Core - High density, constant demand                        │
│   ◐ Satellite - Moderate, directional risk                      │
│   ○ Rural - Low density, high deadhead risk                     │
└─────────────────────────────────────────────────────────────────┘
```

### Region Types Explained

| Type | Demand | Risk Level | Strategy |
|------|--------|------------|----------|
| **Core** | High density, constant | Low | Accept most rides, focus on volume |
| **Satellite** | Moderate, directional | Medium | Favor rides toward Core, use Area Preferences |
| **Rural** | Low, event-dependent | High | Be selective, only accept premium fares |

### The Deadhead Equation

True profitability accounts for unpaid return miles:

```
True Profit = Fare - (Return Miles × Cost/Mile) - (Return Time × Opportunity Cost)

Example:
- Fare: $35 for 20mi ride to Rural area
- Return: 20mi, 30min, no rides
- Cost/mile: $0.30, Opportunity: $20/hr

Calculation:
$35 - ($0.30 × 20) - ($10) = $19 actual profit
```

### Key Insight: DMA Correlation

Uber's market definitions closely follow Nielsen's **Designated Market Areas** (DMAs)—TV market boundaries. If two cities share local TV news, they likely share a rideshare market.

---

## 2. Database Architecture

### 2.1 platform_data Table (Enhanced)

The `platform_data` table stores per-city market information:

```javascript
// shared/schema.js - platform_data table
export const platform_data = pgTable("platform_data", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Platform and location
  platform: text("platform").notNull(),        // 'uber', 'lyft'
  country: text("country").notNull(),
  country_code: text("country_code"),
  region: text("region"),                       // State name
  city: text("city").notNull(),

  // Market structure (NEW)
  market: text("market"),                       // Market name (legacy)
  market_anchor: text("market_anchor"),         // Core city controlling this location
  region_type: text("region_type"),             // 'Core', 'Satellite', 'Rural'

  // Status
  is_active: boolean("is_active").default(true),

  // Timestamps
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});
```

**Data Population:**
- 1,092 US cities mapped to market anchors
- Covers 50 states + DC
- Source: `scripts/load-market-research.js`

### 2.2 market_intelligence Table

The `market_intelligence` table stores actionable intelligence:

```javascript
// shared/schema.js - market_intelligence table
export const market_intelligence = pgTable("market_intelligence", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Market identification
  market: text("market").notNull(),             // 'Los Angeles', 'Universal'
  market_slug: text("market_slug").notNull(),   // 'los-angeles', 'universal'

  // Platform scope
  platform: text("platform").default('both'),   // 'uber', 'lyft', 'both'

  // Intelligence classification
  intel_type: text("intel_type").notNull(),     // See section 5
  intel_subtype: text("intel_subtype"),         // For zones: 'honey_hole', etc.

  // Content
  title: text("title").notNull(),
  summary: text("summary"),                     // 1-2 sentence summary
  content: text("content").notNull(),           // Full content (markdown)

  // Geographic context (for zone intelligence)
  neighborhoods: jsonb("neighborhoods"),        // Array of neighborhood names
  boundaries: jsonb("boundaries"),              // Lat/lng polygon

  // Temporal context (for timing intelligence)
  time_context: jsonb("time_context"),

  // Categorization
  tags: jsonb("tags").default('[]'),
  priority: integer("priority").default(50),    // 1-100, higher = more important

  // AI Coach integration
  coach_can_cite: boolean("coach_can_cite").default(true),
  coach_priority: integer("coach_priority").default(50),

  // Quality indicators
  confidence: integer("confidence").default(75), // 0-100
  source: text("source"),                        // 'research', 'driver_report', etc.

  // Versioning
  version: integer("version").default(1),
  is_active: boolean("is_active").default(true),
  is_verified: boolean("is_verified").default(false),

  // Timestamps
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
  effective_date: timestamp("effective_date"),
  expiration_date: timestamp("expiration_date"),
  created_by: text("created_by"),
});
```

**Key Indexes:**
```sql
idx_market_intelligence_market_slug       -- For market-specific queries
idx_market_intelligence_intel_type        -- For type filtering
idx_market_intelligence_coach_cite        -- For AI Coach lookups
idx_market_intelligence_market_type_active -- Composite for common queries
idx_market_intelligence_tags              -- GIN index for tag search
```

---

## 3. API Endpoints

### 3.1 Market Lookup

```
GET /api/intelligence/lookup?city={city}&state={state}
```

**Purpose:** Look up market position for a given city.

**Response:**
```javascript
{
  "found": true,
  "city": "Plano",
  "state": "Texas",
  "market": "Dallas-Fort Worth",
  "market_anchor": "Dallas-Fort Worth",
  "region_type": "Satellite",
  "deadhead_risk": {
    "level": "medium",
    "score": 50,
    "description": "Moderate risk - rides toward Dallas-Fort Worth are safer",
    "advice": "Use Area Preferences to favor Core-bound rides"
  },
  "market_cities": [
    { "city": "Dallas", "region_type": "Core" },
    { "city": "Fort Worth", "region_type": "Core" },
    { "city": "Plano", "region_type": "Satellite" },
    // ... more cities
  ]
}
```

**Implementation:** `server/api/intelligence/index.js:138-220`

### 3.2 Market Structure

```
GET /api/intelligence/market-structure/{anchor}
```

**Purpose:** Get detailed breakdown of a market's city structure.

**Response:**
```javascript
{
  "market_anchor": "Dallas-Fort Worth",
  "total_cities": 45,
  "breakdown": {
    "core": 4,
    "satellite": 28,
    "rural": 13
  },
  "cities": {
    "core": ["Dallas", "Fort Worth", "Arlington", "Irving"],
    "satellite": ["Plano", "Frisco", "McKinney", "Denton", ...],
    "rural": ["Waxahachie", "Weatherford", ...]
  }
}
```

**Implementation:** `server/api/intelligence/index.js:222-280`

### 3.3 Get Intelligence

```
GET /api/intelligence?market_slug={slug}&type={intel_type}&platform={platform}
```

**Purpose:** Retrieve intelligence items for display.

**Query Parameters:**
- `market_slug` - Filter by market (optional, includes 'universal')
- `type` - Filter by intel_type (optional)
- `platform` - Filter by platform (optional)
- `active_only` - Only active items (default: true)

**Response:**
```javascript
{
  "items": [
    {
      "id": "uuid",
      "market": "Universal",
      "title": "The Gravity Model: How Markets Really Work",
      "summary": "Core cities hold satellite municipalities...",
      "content": "Full markdown content...",
      "intel_type": "algorithm",
      "priority": 100,
      "tags": ["strategy", "fundamentals"],
      "confidence": 95
    },
    // ... more items
  ],
  "total": 22
}
```

**Implementation:** `server/api/intelligence/index.js:45-136`

---

## 4. Client Architecture

### 4.1 useMarketIntelligence Hook

**Location:** `client/src/hooks/useMarketIntelligence.ts`

**Purpose:** Fetches and manages market intelligence state.

```typescript
interface UseMarketIntelligenceReturn {
  // Intelligence items
  intelligence: MarketIntelligence[];
  isLoading: boolean;
  error: Error | null;

  // Market position data
  marketAnchor: string | null;
  regionType: 'Core' | 'Satellite' | 'Rural' | null;
  deadheadRisk: DeadheadRisk | null;
  marketCities: MarketCity[];
  isMarketLookupLoading: boolean;

  // Actions
  refetch: () => Promise<void>;
  fetchMarketLookup: (city: string, state: string) => Promise<void>;
}
```

**Key Features:**
- Auto-fetches intelligence on mount
- Fetches market lookup when city/state changes
- Filters by market slug and platform
- Caches results with React Query

### 4.2 RideshareIntelTab Component

**Location:** `client/src/components/RideshareIntelTab.tsx`

**Structure:**
```
RideshareIntelTab
├── Header: Market name + stats badges
├── Your Market Position Card
│   ├── Region Type Badge (Core/Satellite/Rural)
│   ├── Deadhead Risk Indicator
│   └── Strategic Advice
├── Cities in Your Market (Collapsible)
│   ├── Core Cities (green badges)
│   ├── Satellite Cities (amber badges)
│   └── Rural Cities (red badges)
├── Universal Intelligence Cards
│   ├── Algorithm Mechanics
│   ├── Strategy Guides
│   └── Zone Intelligence
└── Market-Specific Intelligence Cards
    └── (Filtered by user's market)
```

**Color Coding:**
```typescript
const regionTypeColors = {
  Core: 'bg-green-100 text-green-800',
  Satellite: 'bg-amber-100 text-amber-800',
  Rural: 'bg-red-100 text-red-800',
};

const deadheadColors = {
  low: 'text-green-600',
  medium: 'text-amber-600',
  high: 'text-red-600',
};
```

---

## 5. Intelligence Categories

### 5.1 intel_type Values

| Type | Description | Example |
|------|-------------|---------|
| `algorithm` | Platform mechanics | Upfront Pricing, Heatmaps, Area Preferences |
| `strategy` | Driver strategies | Ant vs Sniper, Deadhead Equation |
| `zone` | Geographic zones | Honey Holes, Dead Zones, Danger Zones |
| `timing` | Time-based patterns | Optimal Driving Windows |
| `regulatory` | Legal/regulatory | Local laws, permit requirements |
| `airport` | Airport-specific | Queue rules, pickup procedures |
| `safety` | Safety information | High-risk areas, precautions |
| `vehicle` | Vehicle requirements | Inspection rules, age limits |
| `general` | General information | Greenlight Hubs, DMA Correlation |

### 5.2 intel_subtype Values (for zone type)

| Subtype | Description |
|---------|-------------|
| `honey_hole` | High-demand zones with good returns |
| `dead_zone` | Minimal demand, high deadhead risk |
| `danger_zone` | Areas requiring caution (economic/safety) |
| `safe_corridor` | Reliable demand routes |
| `caution_zone` | Variable demand, situational |

### 5.3 Current Intelligence Inventory

```
Universal Intelligence: 14 items
├── Algorithm: 5 (Gravity Model, Upfront Pricing, Area Preferences, Heatmaps, Long Pickup)
├── Strategy: 3 (Region Types, Ant vs Sniper, Deadhead Equation)
├── Zone: 3 (Honey Holes, Dead Zones, Danger Zones)
├── Timing: 1 (Optimal Driving Windows)
└── General: 2 (Greenlight Hubs, DMA Correlation)

Market-Specific Intelligence: 8 items
├── Los Angeles: 1 (LA vs Inland Empire split)
├── San Francisco: 1 (Bay Area amalgamation)
├── Phoenix: 1 (Unified grid system)
├── Dallas-Fort Worth: 1 (Dual core dynamics)
├── Miami: 1 (South Florida + Keys separation)
├── Birmingham: 1 (Alabama tri-polar state)
├── Atlanta: 1 (ITP/OTP divide)
└── Houston: 1 (Sprawl challenges)
```

---

## 6. AI Coach Integration

### 6.1 Intelligence Citation

The AI Coach can cite market intelligence when advising drivers:

```javascript
// When coach needs context, query high-priority intelligence
const coachContext = await db
  .select()
  .from(market_intelligence)
  .where(and(
    eq(market_intelligence.coach_can_cite, true),
    or(
      eq(market_intelligence.market_slug, 'universal'),
      eq(market_intelligence.market_slug, userMarketSlug)
    ),
    eq(market_intelligence.is_active, true)
  ))
  .orderBy(desc(market_intelligence.coach_priority))
  .limit(5);
```

### 6.2 Coach Priority Levels

| Priority | When Coach Should Cite |
|----------|------------------------|
| 90-100 | Always relevant (fundamentals) |
| 70-89 | Contextually relevant (specific situations) |
| 50-69 | Occasionally relevant (supplementary) |
| < 50 | Rarely cited (reference only) |

### 6.3 Example Coach Response

```
Coach: "Based on your position in Plano, you're in a Satellite market.
The Gravity Model tells us that rides toward Dallas are safer—you'll
have higher return demand. Your deadhead risk right now is MEDIUM.

I'd recommend enabling Area Preferences to favor Core-bound rides,
especially during this time of day."
```

---

## 7. Adding New Intelligence

### 7.1 Via Seeding Script

**Location:** `scripts/seed-market-intelligence.js`

```javascript
const newIntel = {
  market: 'Los Angeles',           // Market name or 'Universal'
  market_slug: 'los-angeles',      // Lowercase, hyphenated
  intel_type: 'strategy',          // See section 5.1
  intel_subtype: null,             // For zone types only
  title: 'Short Title',
  summary: '1-2 sentence summary',
  content: `Full markdown content...`,
  priority: 80,                    // 1-100
  confidence: 85,                  // 0-100
  source: 'research',              // 'research', 'driver_report', etc.
  coach_can_cite: true,
  coach_priority: 80,
  tags: ['tag1', 'tag2'],
  neighborhoods: ['Area1', 'Area2'], // Optional, for zone types
};
```

### 7.2 Via API (Future)

```
POST /api/intelligence
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "market_slug": "austin",
  "intel_type": "zone",
  "intel_subtype": "honey_hole",
  "title": "South Congress District",
  "content": "...",
  "neighborhoods": ["SoCo", "South Austin"],
  "priority": 75
}
```

### 7.3 Intelligence Quality Guidelines

**Good Intelligence:**
- Actionable (driver can do something with it)
- Specific (names locations, times, patterns)
- Verified (from research or multiple sources)
- Current (not outdated)

**Bad Intelligence:**
- Vague ("sometimes there's demand downtown")
- Obvious ("surge means more money")
- Unverified (single anecdote)
- Time-sensitive without date

---

## 8. Research Foundation

### 8.1 Research Source

**Primary Source:** `platform-data/uber/research-findings/research-intel.txt`

This file contains:
- 1,092 US city-to-market mappings
- Region type classifications (Core/Satellite/Rural)
- Market anchor assignments
- Source references for each classification

### 8.2 Data Loading Pipeline

```
research-intel.txt (CSV format)
        │
        ▼
scripts/load-market-research.js
        │
        ▼
platform_data table
(market_anchor, region_type columns populated)
        │
        ▼
scripts/seed-market-intelligence.js
        │
        ▼
market_intelligence table
(22 intelligence items seeded)
```

### 8.3 Key Research Findings

1. **Gravity Model Validity:** Market boundaries follow economic gravity, not administrative boundaries.

2. **DMA Correlation:** Uber markets closely track Nielsen TV market areas (~95% overlap).

3. **Greenlight Hub Indicator:** Hub location = market center of gravity.

4. **Dual/Multi-Core Markets:** Some markets (DFW, LA) have multiple cores with different dynamics.

5. **Micro-Markets:** Some isolated areas (Florida Keys, Flagstaff) operate independently despite geographic proximity.

6. **Upfront Pricing Impact:** When drivers see destinations, market boundaries "harden" as drivers avoid cross-market rides.

---

## 9. AI Coach Integration (Extended)

### 9.1 Coach Data Access

The AI Coach now has full access to market intelligence via `CoachDAL`:

```javascript
// In coach-dal.js
async getMarketIntelligence(city, state, platform = 'both') {
  // Returns: { marketPosition, intelligence }
  // marketPosition: { market_anchor, region_type, deadhead_risk }
  // intelligence: Array of coach-citable intel items
}

async getUserNotes(userId, limit = 20) {
  // Returns: Array of user-specific notes from previous conversations
}

async saveUserNote(noteData) {
  // Saves a new note about the user
}
```

### 9.2 User Intel Notes Table

```sql
CREATE TABLE user_intel_notes (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(user_id),
  snapshot_id UUID REFERENCES snapshots(snapshot_id),
  note_type TEXT NOT NULL DEFAULT 'insight',  -- preference, insight, tip, feedback, pattern
  category TEXT,                               -- timing, location, strategy, vehicle, earnings, safety
  title TEXT,
  content TEXT NOT NULL,
  context TEXT,                                -- What prompted this note
  market_slug TEXT,
  neighborhoods JSONB,
  importance INTEGER DEFAULT 50,               -- 1-100
  confidence INTEGER DEFAULT 80,
  times_referenced INTEGER DEFAULT 0,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  is_pinned BOOLEAN DEFAULT false,
  source_message_id TEXT,
  created_by TEXT DEFAULT 'ai_coach',
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### 9.3 Coach Note Commands

The AI Coach can save notes using a special syntax in its responses:

```
[SAVE_NOTE: {"type": "preference", "title": "Prefers evening shifts", "content": "Driver mentioned they prefer working 6pm-2am", "importance": 75}]
```

Note types:
- `preference`: Driving preferences (times, areas, goals)
- `insight`: Learned insights about their situation
- `tip`: Personalized tips discovered during conversation
- `feedback`: Feedback on coach advice effectiveness
- `pattern`: Patterns noticed in questions/behavior

### 9.4 Notes API Endpoints

```
POST /api/chat/notes       - Save a coach note
GET /api/chat/notes        - Get user's notes
DELETE /api/chat/notes/:id - Delete a note (soft delete)
```

### 9.5 Context Flow

```
User Message
     │
     ▼
┌─────────────────────────────────────────┐
│         CoachDAL.getCompleteContext()   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ Parallel Fetch:                  │   │
│  │ - getHeaderSnapshot()            │   │
│  │ - getLatestStrategy()            │   │
│  │ - getComprehensiveBriefing()     │   │
│  │ - getSmartBlocks()               │   │
│  │ - getFeedback()                  │   │
│  │ - getVenueData()                 │   │
│  │ - getActions()                   │   │
│  └─────────────────────────────────┘   │
│                  │                      │
│                  ▼                      │
│  ┌─────────────────────────────────┐   │
│  │ Second Fetch (needs city/state): │   │
│  │ - getMarketIntelligence()        │   │
│  │ - getUserNotes()                 │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
     │
     ▼
formatContextForPrompt() → System Prompt with:
  - Location & Time Context
  - Strategy
  - Briefing
  - Smart Blocks
  - Market Intelligence ← NEW
  - User Notes ← NEW
     │
     ▼
Gemini 3.0 Pro with Google Search
     │
     ▼
Response (may include [SAVE_NOTE:...])
```

---

## Related Documentation

- [Driver Intelligence System](driver-intelligence-system.md) - 9-second decision problem
- [Strategy Framework](strategy-framework.md) - TRIAD pipeline
- [Database Schema](database-schema.md) - Full schema reference
- [API Reference](api-reference.md) - Complete API documentation

---

## Quick Reference

### File Locations

| Component | Path |
|-----------|------|
| Platform Data Schema | `shared/schema.js:platform_data` |
| Intelligence Schema | `shared/schema.js:market_intelligence` |
| Intelligence API | `server/api/intelligence/index.js` |
| Market Lookup Logic | `server/api/intelligence/index.js:getDeadheadRisk()` |
| Intel Hook | `client/src/hooks/useMarketIntelligence.ts` |
| Intel Tab UI | `client/src/components/RideshareIntelTab.tsx` |
| Research Loader | `scripts/load-market-research.js` |
| Intelligence Seeder | `scripts/seed-market-intelligence.js` |

### Common Queries

```sql
-- Get all cities in a market
SELECT city, region_type FROM platform_data
WHERE market_anchor = 'Dallas-Fort Worth'
ORDER BY region_type, city;

-- Get intelligence for coach context
SELECT title, content, coach_priority
FROM market_intelligence
WHERE coach_can_cite = true
  AND (market_slug = 'universal' OR market_slug = 'dallas-fort-worth')
  AND is_active = true
ORDER BY coach_priority DESC
LIMIT 5;

-- Market structure breakdown
SELECT market_anchor, region_type, COUNT(*)
FROM platform_data
WHERE market_anchor IS NOT NULL
GROUP BY market_anchor, region_type
ORDER BY market_anchor, region_type;
```

---

*Document created: December 2024*
*Last updated: December 2024*
*Author: Vecto Pilot Architecture Team*
