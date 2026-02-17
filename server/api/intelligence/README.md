> **Last Verified:** 2026-01-06

# Market Intelligence API

Provides access to market-specific intelligence data for rideshare drivers.

## Overview

The market intelligence system stores actionable insights about specific markets including:

- **Zone information** - Honey holes, danger zones, dead zones
- **Regulatory context** - Prop 22, TLC rules, local regulations
- **Strategy advice** - Time-based strategies, positioning
- **Safety information** - High-risk areas, warnings
- **Algorithm mechanics** - Advantage Mode, utilization, lockouts
- **Airport strategies** - Queue management, rematch rules

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/intelligence` | List all intelligence with filters |
| GET | `/api/intelligence/markets` | List markets with intelligence counts |
| GET | `/api/intelligence/markets-dropdown` | **NEW** Get all 243 markets for signup dropdown |
| GET | `/api/intelligence/for-location` | Get intel for a city → market lookup |
| GET | `/api/intelligence/market/:slug` | Get all intelligence for a market |
| GET | `/api/intelligence/coach/:market` | Get AI Coach context for a market |
| GET | `/api/intelligence/staging-areas` | Get staging areas from ranking_candidates |
| GET | `/api/intelligence/:id` | Get specific intelligence item |
| POST | `/api/intelligence` | Create new intelligence |
| POST | `/api/intelligence/add-market` | **NEW** Add new market (from "Other" selection) |
| PUT | `/api/intelligence/:id` | Update intelligence item |
| DELETE | `/api/intelligence/:id` | Soft delete (deactivate) item |

## Signup Market Dropdown (2026-01-05)

The `/api/intelligence/markets-dropdown` endpoint provides a clean list of 243 US markets for signup forms.

### Why a Dropdown?

Free-text market input creates problems:
- "Dallas" vs "Ft Worth" vs "Ft. Worth" vs "Dallas-Fort Worth" vs "DFW"
- Typos, abbreviations, inconsistent naming
- No way to validate user's market

**Solution:** Dropdown with all markets + "Other" option for new markets.

### Usage

```http
GET /api/intelligence/markets-dropdown
```

### Response

```json
{
  "markets": ["Abilene", "Akron", "Albuquerque", ..., "Youngstown"],
  "total": 243,
  "hint": "Add 'Other' as final option in dropdown. If selected, show free-text input for new market."
}
```

### Adding New Markets (When "Other" Selected)

```http
POST /api/intelligence/add-market
Content-Type: application/json

{
  "market_name": "New City",
  "city": "New City",
  "state": "State Name",
  "state_abbr": "ST"
}
```

Response:
```json
{
  "success": true,
  "message": "New market added",
  "market_name": "New City",
  "already_existed": false
}
```

---

## City → Market Lookup (2026-01-05)

The `/api/intelligence/for-location` endpoint uses the `market_cities` table to map any city to its rideshare market. This enables:

- **"Frisco, TX → Dallas market"** - Suburbs resolve to their metro market
- **Market-level intel aggregation** - Intel written for "Dallas" applies to all 21 cities in the Dallas market
- **Region type context** - Know if user is in a Core city or Satellite

### Usage

```http
GET /api/intelligence/for-location?city=Frisco&state=TX
GET /api/intelligence/for-location?city=Frisco&state=Texas
```

### Response

```json
{
  "location": {
    "input_city": "Frisco",
    "input_state": "TX",
    "resolved_market": "Dallas",
    "region_type": "Satellite",
    "full_state": "Texas",
    "state_abbr": "TX"
  },
  "market": {
    "name": "Dallas",
    "total_cities": 21,
    "core_cities": ["Dallas"],
    "satellite_cities_sample": ["Frisco", "Plano", "McKinney", "Richardson", "Irving", ...]
  },
  "intel_count": 5,
  "insights_count": 0,
  "by_type": { "strategy": [...], "zone": [...] },
  "intelligence": [...],
  "market_insights": [...]
}
```

### Related Tables

| Table | Purpose |
|-------|---------|
| `market_cities` | Maps 700+ cities to their market anchors (2026-02-17: renamed from `us_market_cities` with FK to `markets`) |
| `market_intel` | Simplified market-level insights (new) |
| `market_intelligence` | Rich intel with zones, neighborhoods, tags |

## Query Parameters

### GET /api/intelligence

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| market | string | - | Filter by market slug (e.g., "los-angeles") |
| platform | string | - | Filter by platform: uber, lyft, both |
| type | string | - | Filter by intel_type |
| subtype | string | - | Filter by intel_subtype (for zones) |
| active | boolean | true | Filter by is_active |
| coach | boolean | - | Filter by coach_can_cite |
| search | string | - | Search in title/content |
| limit | number | 50 | Max results (max: 200) |
| offset | number | 0 | Pagination offset |
| sort | string | priority | Sort by: priority, confidence, created_at |

## Intelligence Types

| Type | Description |
|------|-------------|
| regulatory | Local laws, Prop 22, TLC rules |
| strategy | Driving strategies, optimization tips |
| zone | Geographic zones with subtypes |
| timing | Time-based advice |
| airport | Airport queue strategies |
| safety | Safety warnings, risk areas |
| algorithm | Platform algorithm mechanics |
| vehicle | Vehicle recommendations |
| general | General advice |

### Zone Subtypes

| Subtype | Description |
|---------|-------------|
| honey_hole | High-demand, profitable areas |
| danger_zone | Safety risk areas |
| dead_zone | Low-demand areas |
| safe_corridor | Recommended safe routes |
| caution_zone | Areas requiring awareness |

## AI Coach Integration

The `/api/intelligence/coach/:market` endpoint provides formatted context for the AI Coach:

```javascript
// Request
GET /api/intelligence/coach/los-angeles?platform=uber

// Response
{
  "market": "los-angeles",
  "intel_count": 15,
  "context": [
    {
      "type": "regulatory",
      "title": "Prop 22 Active Time Maximization",
      "insight": "LA operates under Prop 22 which guarantees...",
      "priority": 90,
      "confidence": 95
    }
  ]
}
```

## Creating Intelligence

```javascript
// POST /api/intelligence
{
  "market": "Los Angeles",
  "market_slug": "los-angeles",
  "platform": "uber",
  "intel_type": "zone",
  "intel_subtype": "honey_hole",
  "title": "Westside Traffic Maximization",
  "summary": "Santa Monica and Venice offer optimal Prop 22 conditions",
  "content": "Full detailed intelligence...",
  "neighborhoods": ["Santa Monica", "Venice", "Beverly Hills"],
  "tags": ["prop22", "traffic", "active-time"],
  "priority": 85,
  "confidence": 90,
  "source": "research",
  "coach_can_cite": true
}
```

## Database Schema

See `shared/schema.js` for the `market_intelligence` table definition.

Key fields:
- `market` / `market_slug` - Market identification
- `intel_type` / `intel_subtype` - Classification
- `title` / `summary` / `content` - Intelligence content
- `neighborhoods` / `boundaries` - Geographic context
- `priority` / `confidence` - Importance ratings
- `coach_can_cite` / `coach_priority` - AI Coach integration
- `is_active` / `is_verified` - Status flags

## Populating Data

Use the parser script to extract intelligence from research documents:

```bash
# Dry run - preview without database insert
node server/scripts/parse-market-research.js --dry-run

# Live run - insert into database
node server/scripts/parse-market-research.js

# Parse specific file
node server/scripts/parse-market-research.js --file=platform-data/uber/research-findings/gemini-findings.txt
```

## Files

| File | Purpose |
|------|---------|
| `index.js` | API routes |
| `README.md` | This documentation |
