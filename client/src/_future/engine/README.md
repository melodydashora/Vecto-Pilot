# Future Engine (`client/src/_future/engine/`)

## Purpose

Learning and reflection engine for Phase 17 (not yet integrated).

## Files

| File | Purpose |
|------|---------|
| `reflectionEngine.ts` | User interaction learning system |

## reflectionEngine.ts

Tracks user interactions, trip patterns, and feedback to:
- Identify problematic zones (repeatedly low ratings)
- Find high-performing smart blocks
- Analyze idle times by location zone
- Generate personalized suggestions

### Features (When Activated)

```typescript
import { reflectionEngine } from './engine/reflectionEngine';

// Record user interaction
reflectionEngine.record({
  timestamp: new Date().toISOString(),
  smartBlock: 'downtown-evening',
  idleTime: 45,
  tripDuration: 15,
  driverMode: 'commercial',
  locationZone: 'Financial District',
  resultRating: 4
});

// Get suggestions based on patterns
const suggestions = reflectionEngine.getSuggestions();
// ["Focus on these high-performers: downtown-evening, airport-morning"]
```

## Activation Requirements

1. Integrate with co-pilot.tsx to record interactions
2. Add UI for optional rating prompts
3. Display suggestions in GreetingBanner or dedicated section
4. Consider privacy implications of local storage

## Status

**Phase 17** - Waiting for core features to stabilize before integration.
