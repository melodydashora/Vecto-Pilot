# MARKET_INTELLIGENCE.md — Market Intelligence System

> **Canonical reference** for market data sources, intelligence storage, how MI feeds into strategy and coach, and the intelligence API.
> Last updated: 2026-04-10

## Supersedes
- `docs/architecture/driver-intelligence-system.md` — Previous intel overview (expanded here)
- `docs/architecture/intel-tab-architecture.md` — Gravity Model, market cities, intel types (absorbed into Sections 3-6)
- `docs/architecture/google-cloud-apis.md` — Google Cloud API usage (Maps, Places, Routes, Weather covered across VENUES.md, MAP.md, FEASIBILITY.md)

---

## Table of Contents

1. [What Is Market Intelligence?](#1-what-is-market-intelligence)
2. [Data Sources](#2-data-sources)
3. [Database Schema](#3-database-schema)
4. [Intelligence API Routes](#4-intelligence-api-routes)
5. [How MI Feeds Into Strategy and Coach](#5-how-mi-feeds-into-strategy-and-coach)
6. [Demand Forecasting and Archetype Patterns](#6-demand-forecasting-and-archetype-patterns)
7. [Data Freshness](#7-data-freshness)
8. [Current State](#8-current-state)
9. [Known Gaps](#9-known-gaps)
10. [TODO — Hardening Work](#10-todo--hardening-work)

---

## 1. What Is Market Intelligence?

Market Intelligence (MI) is the knowledge layer that gives the Rideshare Coach and strategy engine understanding of **how rideshare markets work** — beyond what's in the current snapshot. This includes:

- Market structure (Core vs Satellite cities, Gravity Model)
- Algorithm mechanics (Upfront Pricing, Area Preferences)
- Zone knowledge (honey holes, dead zones, danger zones)
- Timing patterns (surge windows, demand curves by daypart)
- Platform-specific rules (Uber vs Lyft differences)
- Safety information (dangerous areas, road hazards)
- Airport strategies (staging lots, peak times)

---

## 2. Data Sources

| Source | How Collected | Stored In |
|--------|---------------|-----------|
| Research data | Manual ETL from `platform-data/` files | `market_intelligence`, `platform_data` |
| Rideshare Coach conversations | Coach saves via `[MARKET_INTEL]` action tags | `market_intelligence` |
| Driver reports | Coach saves via `[ZONE_INTEL]` action tags | `zone_intelligence` |
| System observations | Coach saves via `[SYSTEM_NOTE]` action tags | `coach_system_notes` |
| Venue discovery | SmartBlocks pipeline + concierge search | `venue_catalog` |
| Market admin | POST `/api/intelligence` | `market_intelligence` |

**No direct Uber/Lyft API integration** for surge or demand data. Surge prediction is based on pattern analysis and event correlation, not live API feeds.

---

## 3. Database Schema

### `market_intelligence` Table

**File:** `shared/schema.js`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | Intel identifier |
| `market` | text | Market name (e.g., "Dallas-Fort Worth") |
| `market_slug` | text | URL-safe (e.g., "dallas-fort-worth-tx") |
| `platform` | text (default 'both') | uber / lyft / both |
| `intel_type` | text | regulatory / strategy / zone / timing / airport / safety / algorithm / vehicle / general |
| `intel_subtype` | text | For zones: honey_hole / danger_zone / dead_zone / safe_corridor / caution_zone |
| `title` | text | Short title |
| `summary` | text | Brief summary |
| `content` | text | Full markdown content |
| `neighborhoods` | jsonb | Array of neighborhood names |
| `boundaries` | jsonb | Geographic polygon or description |
| `time_context` | jsonb | `{days: ['mon','tue'], hours: [8,9,10], seasonal: 'high_season'}` |
| `tags` | jsonb (default '[]') | Searchable tags (GIN indexed) |
| `priority` | integer (1-100) | Higher = more important |
| `confidence` | integer (1-100) | Trust level |
| `source` | text | 'research' / 'ai_coach' / 'driver_report' / 'official' |
| `coach_can_cite` | boolean | Whether Coach can reference this |
| `coach_priority` | integer | Priority for Coach retrieval |
| `is_active`, `is_verified` | boolean | Active + human-verified flags |
| `version` | integer | Incremented on update |
| `effective_date`, `expiry_date` | timestamp | Validity window |

**Indexes:** `(market_slug, intel_type, is_active)`, GIN on `tags`

### `platform_data` Table

| Column | Type | Purpose |
|--------|------|---------|
| `platform` | text | uber / lyft |
| `country`, `region`, `city`, `market` | text | Geographic hierarchy |
| `surge_definition` | text | How surge triggers |
| `payout_structure` | text | Earnings calculation |
| `vehicle_requirements` | jsonb | Required specs |
| `driver_incentives` | jsonb | Bonuses, quests |
| `surge_mechanics` | jsonb | Pricing mechanics |

### `market_cities` Table

| Column | Type | Purpose |
|--------|------|---------|
| `market_name` | text | "Dallas-Fort Worth" |
| `city` | text | "Frisco", "Dallas" |
| `state`, `state_abbr` | text | "Texas", "TX" |
| `region_type` | text | "Core" / "Satellite" |

---

## 4. Intelligence API Routes

**File:** `server/api/intelligence/index.js` (1,400+ lines)

### Public (No Auth)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/intelligence/markets-dropdown` | Market list for signup dropdown |
| `POST /api/intelligence/add-market` | Add new market during signup |

### Authenticated (requireAuth)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/intelligence` | List intel with filters (market, platform, type, search) |
| `GET /api/intelligence/markets` | All markets with intel counts |
| `GET /api/intelligence/for-location?city=&state=` | Resolve city → market + intel |
| `GET /api/intelligence/market/:slug` | All intel for specific market |
| `GET /api/intelligence/coach/:market` | Coach-optimized intel (high priority, citable) |
| `GET /api/intelligence/:id` | Single intel item |
| `POST /api/intelligence` | Create new intel |
| `PUT /api/intelligence/:id` | Update intel |
| `GET /api/intelligence/staging-areas?snapshotId=` | Staging zones from ranking_candidates |

---

## 5. How MI Feeds Into Strategy and Coach

### Coach Injection

**File:** `server/lib/ai/rideshare-coach-dal.js` → `getMarketIntelligence(city, state, platform)`

1. Resolves market via `platform_data` table (city → market_slug)
2. Queries `market_intelligence` where `market_slug` matches AND `is_active = true`
3. Includes universal intel (applies to all markets)
4. Groups by `intel_type`
5. Orders by `coach_priority DESC`
6. Returns `{ marketPosition, intelligence[] }`

Injected into Coach system prompt as **MARKET INTELLIGENCE** section with knowledge base grouped by type.

### Strategy Injection

Strategy generation (`consolidator.js`) receives briefing data which includes events, traffic, and weather — but does NOT directly receive market_intelligence. The Coach has full MI access; strategy gets it indirectly through the briefing pipeline.

### Zone Intelligence Injection

**File:** `rideshare-coach-dal.js` → `getZoneIntelligence(marketSlug)`

Returns active zones for the driver's market, injected into Coach context. Enables coach to say: "Avoid Deep Ellum after 2am — multiple drivers report dead zone."

---

## 6. Demand Forecasting and Archetype Patterns

### Archetype System

**File:** `server/api/intelligence/index.js` (lines 1182–1300+)

Markets are classified into archetypes with default demand curves:

| Archetype | Example | Peak Pattern |
|-----------|---------|-------------|
| `sprawl` | Dallas-Fort Worth | Morning + evening commute, event-driven weekends |
| `dense_city` | Manhattan | Steady all-day, nightlife peaks |
| `airport_centric` | Denver | Airport terminal-driven, flight schedule peaks |
| `evening_suburbs` | Scottsdale | Evening dining + nightlife heavy |

Each archetype provides hour-by-hour demand scores (0–100) per day of week, recommended zones, and strategic insights.

### Surge Prediction

**Current approach:** Pattern-based, not real-time API.
- Event correlation: If large event ends at 10 PM, predict surge at 10:15 PM near venue
- Time patterns: Historical demand curves by daypart and day-of-week
- Weather impact: Bad weather → higher demand (deterministic, computed in briefing)

**No live Uber/Lyft surge API integration.** Surge data only comes from driver reports via offer intelligence and Coach conversations.

---

## 7. Data Freshness

| Mechanism | How It Works |
|-----------|-------------|
| `expiry_date` field | Intel marked stale after date |
| `effective_date` field | When intel became valid |
| `is_verified` flag | Human-verified vs AI-generated |
| `version` tracking | Incremented on each update |
| `last_reported_at` (zones) | Most recent driver report timestamp |
| `confidence_score` (zones) | Increases with more driver reports |

**No automatic TTL cleanup.** Data persists indefinitely until manually marked `is_active = false`.

---

## 8. Current State

| Area | Status |
|------|--------|
| Market resolution (city → market) | Working |
| Intelligence CRUD API | Working |
| Coach MI injection | Working — grouped by type, ordered by priority |
| Zone intelligence (crowd-sourced) | Working — Coach creates via action tags |
| Platform data | Working — pre-loaded for major markets |
| Staging areas API | Working — from ranking_candidates |
| Archetype demand patterns | Working — default curves for known archetypes |

---

## 9. Known Gaps

1. **No live surge API** — Surge prediction is pattern-based, not real-time. No Uber/Lyft API integration for live surge data.
2. **No ETL pipeline automation** — Market data is manually loaded from `platform-data/` files. No scheduled refresh.
3. **No data quality scoring** — Old intel with high confidence is weighted the same as fresh intel.
4. **MI not directly in strategy prompt** — Strategy gets briefing data but not market_intelligence directly.
5. **No geographic queries** — Intelligence queried by market_slug (text match), not spatial proximity.
6. **Zone confidence can only increase** — No mechanism to decrease confidence when zones are reported as stale.
7. **markets-dropdown endpoint lacks auth** — Public endpoint, potential information leakage.

---

## 10. TODO — Hardening Work

- [ ] **Integrate live surge API** — If Uber/Lyft expose surge data, feed it into MI
- [ ] **Automate ETL pipeline** — Scheduled refresh of platform_data from official sources
- [ ] **Time-decay confidence** — Decrease zone confidence_score if no reports in 30 days
- [ ] **Inject MI into strategy prompt** — Direct market intelligence in strategy generation, not just via Coach
- [ ] **Spatial queries for MI** — Add PostGIS or coordinate-based lookups
- [ ] **Add auth to markets-dropdown** — Require at least optionalAuth
- [ ] **Data quality dashboard** — Show freshness, confidence distribution, verification rates

---

## Key Files

| File | Purpose |
|------|---------|
| `server/api/intelligence/index.js` | All intelligence routes (1,400+ lines) |
| `server/lib/ai/rideshare-coach-dal.js` | MI → Coach injection |
| `shared/schema.js` | market_intelligence, zone_intelligence, platform_data, market_cities |
