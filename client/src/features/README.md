# Features (`client/src/features/`)

## Purpose

Feature-based organization for complex UI features. Each feature folder contains all related components, hooks, and utilities.

## Structure

```
features/
├── strategy/           # Strategy display and generation
│   └── README.md
└── README.md
```

## Philosophy

Features are self-contained modules that:
- Have their own components, hooks, and types
- Can be imported from a single entry point
- Minimize cross-feature dependencies

## Adding New Features

1. Create folder: `features/<feature-name>/`
2. Add components, hooks, types as needed
3. Create `index.ts` for clean exports
4. Add README documenting the feature

## Existing Features

### strategy/ (Staged)
Strategy display components - currently in `_future/` staging:
- `StrategyCoach.tsx` - Strategy coach UI
- `ConsolidatedStrategyComp.tsx` - Strategy display

Note: Strategy components were moved to `components/strategy/_future/` pending integration.

## Connections

- **Used by:** `../pages/co-pilot.tsx`
- **Imports from:** `../hooks/*`, `../utils/*`
