# Intel Components (`client/src/components/intel/`)

## Purpose

Market intelligence and strategy visualization components for the rideshare intel feature.

## Files

| File | LOC | Purpose |
|------|-----|---------|
| `DeadheadCalculator.tsx` | ~280 | Universal trip worthiness calculator |
| `DemandRhythmChart.tsx` | ~350 | Weekly hourly demand visualization (Recharts) |
| `MarketBoundaryGrid.tsx` | ~360 | Core/Satellite/Rural zone grid visualization |
| `MarketDeadheadCalculator.tsx` | ~420 | Market-specific deadhead calculator with real cities |
| `StrategyCards.tsx` | ~350 | Ant vs Sniper strategy comparison cards |
| `TacticalStagingMap.tsx` | ~735 | Mission-based tactical map with AI planning |
| `ZoneCards.tsx` | ~300 | Zone intelligence display (honey holes, danger zones) |

## Components

### DeadheadCalculator

Interactive tool to calculate whether a long trip is worth taking.

**Factors considered:**
- Trip duration (minutes)
- Destination type (city, suburb, rural)
- Surge level (1x, 1.5x, 2.5x)
- Deadhead risk (return trip without passenger)

**Verdicts:**
- `accept` - Trip is profitable
- `borderline` - Close call, use judgment
- `decline` - Not worth the deadhead risk

### StrategyCards

Displays the two primary rideshare driving strategies:

| Strategy | Best For | Key Tactics |
|----------|----------|-------------|
| **Ant** | Dense metros, weekend quests | Accept everything under 15 min, stay in core |
| **Sniper** | Sprawl cities, airport runs | Cherry-pick high-value rides, avoid dead zones |

Shows recommendation badge based on market archetype.

### ZoneCards

Displays market zones as color-coded cards:

| Zone Type | Color | Description |
|-----------|-------|-------------|
| Honey Hole | Green | High-demand, profitable areas |
| Danger Zone | Red | Safety risks, avoid |
| Dead Zone | Gray | Low demand, waste of time |
| Safe Corridor | Blue | Recommended routes |
| Caution Zone | Amber | Requires awareness |

### DemandRhythmChart

Interactive Recharts bar chart showing hourly demand patterns by day of week.

**Features:**
- **Day Selector** - Buttons to switch between Mon-Sun
- **Hourly Bars** - 24 bars (0-23) colored by demand intensity
- **Peak Indicators** - Reference line at 70% threshold
- **Strategy Insight Card** - Day-specific advice with recommended zones
- **Archetype Defaults** - Falls back to sprawl/dense/party patterns

**Color Scale:**

| Demand | Color | Threshold |
|--------|-------|-----------|
| Peak | Red | 90%+ |
| High | Orange | 70-89% |
| Moderate | Yellow | 50-69% |
| Low | Green | 30-49% |
| Very Low | Gray | <30% |

**Props:**

```typescript
interface DemandRhythmChartProps {
  archetype: 'sprawl' | 'dense' | 'party';
  marketSlug?: string;
  city?: string;
  marketPatterns?: DemandPatterns;  // Override with market-specific data
}
```

**Data Sources:**
- Primary: `/api/intelligence/demand-patterns/:marketSlug`
- Fallback: `ARCHETYPE_DEMAND_PATTERNS` from `@/types/demand-patterns`

---

### MarketBoundaryGrid

CSS grid visualization showing Core/Satellite/Rural zones for the user's market.

**Features:**
- **Zone Breakdown Bar** - Progress bar showing zone distribution
- **Current Position Banner** - Highlights driver's current city and zone
- **Zone Detail Panel** - Click zone tabs for risk info and advice
- **Cities Grid** - All market cities grouped by zone type
- **Deadhead Risk Matrix** - Quick-reference grid for zone transitions

**Zone Types:**

| Zone | Color | Risk | Description |
|------|-------|------|-------------|
| Core | Green | Low | High demand, optimal positioning |
| Satellite | Amber | Medium | Worth it for surge, plan return |
| Rural | Red | High | Avoid unless 2x+ surge |

**Props:**

```typescript
interface MarketBoundaryGridProps {
  currentCity: string | null;
  marketAnchor: string | null;
  regionType: 'Core' | 'Satellite' | 'Rural' | null;
  marketCities: Array<{ city: string; region: string; region_type: string }>;
  marketStats: { total_cities: string; core_count: string; satellite_count: string; rural_count: string } | null;
  isLoading?: boolean;
}
```

**Data Sources:**
- `useMarketIntelligence().marketCities` - From `/api/intelligence/lookup`
- `useMarketIntelligence().marketStats` - Aggregated zone counts

---

### MarketDeadheadCalculator

Market-specific deadhead risk calculator using actual cities from the user's market.

**Features:**
- **City Dropdowns** - Real cities grouped by zone (🟢 Core, 🟡 Satellite, 🔴 Rural)
- **"Use Current" Button** - Auto-fills origin with driver's GPS location
- **Zone-to-Zone Risk** - Calculates based on `calculateDeadheadRisk()` function
- **Color-Coded Verdict** - Low/Medium/High/Extreme risk badges
- **Strategic Advice** - Context-aware tips for each zone transition

**Risk Levels:**

| Level | Surge Needed | Description |
|-------|--------------|-------------|
| Low | Any fare OK | Safe zone transition |
| Medium | 1.5x+ recommended | Moderate risk |
| High | 2x+ required | High deadhead potential |
| Extreme | 3x+ or decline | Rural-to-Rural trap |

**Props:**

```typescript
interface MarketDeadheadCalculatorProps {
  currentCity: string | null;
  currentRegionType: 'Core' | 'Satellite' | 'Rural' | null;
  marketCities: Array<{ city: string; region: string; region_type: string }>;
  marketAnchor: string | null;
}
```

**Complements:** The universal `DeadheadCalculator` which uses generic destination types.

---

### TacticalStagingMap

Interactive Google Maps component for mission-based tactical staging.

**Features:**
- **Mission Selector** - Dropdown to select events or airports as targets
- **Google Maps** - Standard map with traffic layer overlay
- **Zone Markers** - Green (staging), Red (avoid), Purple (mission), Blue (driver)
- **AI Tactical Plan** - Button triggers Gemini 3.0 Pro for real-time zone analysis
- **Navigation** - "GO" button opens Google Maps with directions

**Marker Types:**

| Marker | Color | Purpose |
|--------|-------|---------|
| Driver | Blue | Current driver location |
| Mission | Purple | Selected event or airport |
| Staging | Green | Recommended staging areas |
| Avoid | Red | Areas to avoid (traffic, construction) |

**Data Sources:**
- Events from `useBriefingQueries().eventsData`
- Airports from `useBriefingQueries().airportData`
- Staging zones from `ranking_candidates` table
- AI tactical zones from `/api/strategy/tactical-plan`

**Props:**

```typescript
interface TacticalStagingMapProps {
  snapshotId: string;
  driverLat: number;
  driverLng: number;
  timezone?: string;
  events?: EventMission[];
  airports?: AirportMission[];
  trafficContext?: { congestionLevel?: string; incidents?: unknown[]; };
}
```

## Dependencies

- `@/components/ui/*` - Card, Badge, Button, Slider, Select
- `@/hooks/useMarketIntelligence` - Intelligence data types
- `@/types/tactical-map` - TypeScript interfaces for tactical map
- `@/types/demand-patterns` - TypeScript interfaces for demand patterns
- `lucide-react` - Icons
- `recharts` - Chart library (via ChartContainer from ui/chart)
- `Google Maps JavaScript API` - Direct script loading (via `TacticalStagingMap`)

## Connections

- **Data from:** `../../hooks/useMarketIntelligence.ts`, `../../hooks/useBriefingQueries.ts`
- **Types from:** `../../types/` (IntelligenceItem, MarketArchetype, ZoneSubtype, tactical-map.ts, demand-patterns.ts)
- **API endpoints:**
  - `/api/intelligence/staging-areas`
  - `/api/intelligence/lookup`
  - `/api/intelligence/demand-patterns/:marketSlug`
  - `/api/strategy/tactical-plan`
- **Used by:** `../../pages/co-pilot/IntelPage.tsx`, `../RideshareIntelTab.tsx`

## See Also

- [`../../hooks/useMarketIntelligence.ts`](../../hooks/README.md) - Data hook
- [`../RideshareIntelTab.tsx`](../README.md) - Parent intel component
