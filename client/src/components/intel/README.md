# Intel Components (`client/src/components/intel/`)

## Purpose

Market intelligence and strategy visualization components for the rideshare intel feature.

## Files

| File | LOC | Purpose |
|------|-----|---------|
| `DeadheadCalculator.tsx` | ~250 | Interactive calculator for trip worthiness |
| `StrategyCards.tsx` | ~350 | Ant vs Sniper strategy comparison cards |
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

## Dependencies

- `@/components/ui/*` - Card, Badge, Button, Slider, Select
- `@/hooks/useMarketIntelligence` - Intelligence data types
- `lucide-react` - Icons

## Connections

- **Data from:** `../../hooks/useMarketIntelligence.ts`
- **Types from:** `../../types/` (IntelligenceItem, MarketArchetype, ZoneSubtype)
- **Used by:** `../../pages/co-pilot/IntelPage.tsx` (planned)

## See Also

- [`../../hooks/useMarketIntelligence.ts`](../../hooks/README.md) - Data hook
- [`../RideshareIntelTab.tsx`](../README.md) - Parent intel component
