> **Last Verified:** 2026-01-06

# Types (`client/src/types/`)

## Purpose

TypeScript type definitions for the frontend application.

## Files

| File | Purpose |
|------|---------|
| `app.d.ts` | Global app type declarations |
| `auth.ts` | Authentication types (User, Profile, Vehicle, login/register request/response) |
| `co-pilot.ts` | Co-Pilot feature types (SmartBlock, Strategy, Briefing) |
| `demand-patterns.ts` | Demand rhythm chart types (DemandPatterns, MarketArchetype, zone logic) |
| `shims.d.ts` | Module shims for non-TS imports |
| `tactical-map.ts` | Tactical Staging Map types (Mission, TacticalZone, API responses) |

## Key Types

### SmartBlock (co-pilot.ts)
```typescript
interface SmartBlock {
  id: string;
  type: 'header' | 'paragraph' | 'list' | 'cta' | 'divider';
  order: number;
  text?: string;
  items?: string[];
  // ... type-specific fields
}
```

### Strategy Types
```typescript
interface Strategy {
  snapshot_id: string;
  minstrategy?: string;
  consolidated_strategy?: string;
  strategy_for_now?: string;
}
```

### Demand Patterns Types (demand-patterns.ts)
```typescript
// Market archetypes for demand patterns
type MarketArchetype = 'sprawl' | 'dense' | 'party';

// Region types for zone logic
type RegionType = 'Core' | 'Satellite' | 'Rural';

// Deadhead risk levels
type DeadheadRiskLevel = 'low' | 'medium' | 'high' | 'extreme';

// Day patterns with hourly demand (0-100) and strategic insight
interface DayPattern {
  hours: number[];  // 24 values, one per hour
  insight: string;
  peakPeriods?: string[];
  recommendedZones?: string[];
}

// Helper function to calculate deadhead risk
function calculateDeadheadRisk(from: RegionType, to: RegionType): DeadheadRiskLevel;
```

### Tactical Map Types (tactical-map.ts)
```typescript
// Mission types for events and airports
interface Mission {
  id: string;
  type: 'event' | 'airport';
  name: string;
  lat: number;
  lng: number;
}

// Tactical zone (staging or avoid)
interface TacticalZone {
  id: string;
  type: 'staging' | 'avoid';
  name: string;
  lat: number;
  lng: number;
  source: 'ranking_candidates' | 'ai_tactical' | 'traffic_data' | 'fallback';
}

// API response for tactical plan
interface TacticalPlanResponse {
  success: boolean;
  stagingZones: TacticalZone[];
  avoidZones: TacticalZone[];
  strategy: string;
}
```

## Usage

```typescript
import type { SmartBlock, Strategy } from '@/types/co-pilot';
import type { EventMission, AirportMission, TacticalZone } from '@/types/tactical-map';
import type { MarketArchetype, RegionType, DemandPatterns } from '@/types/demand-patterns';
import { calculateDeadheadRisk, ARCHETYPE_DEMAND_PATTERNS } from '@/types/demand-patterns';
```

## Connections

- **Used by:** `co-pilot.tsx`, `SmartBlocksStatus.tsx`, `BarsTable.tsx`, `TacticalStagingMap.tsx`, `DemandRhythmChart.tsx`, `MarketBoundaryGrid.tsx`, `MarketDeadheadCalculator.tsx`
- **Matches:** Server response shapes from `/api/strategy/*` and `/api/intelligence/*` endpoints
