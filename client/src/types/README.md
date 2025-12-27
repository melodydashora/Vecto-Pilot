# Types (`client/src/types/`)

## Purpose

TypeScript type definitions for the frontend application.

## Files

| File | Purpose |
|------|---------|
| `app.d.ts` | Global app type declarations |
| `co-pilot.ts` | Co-Pilot feature types (SmartBlock, Strategy, Briefing) |
| `shims.d.ts` | Module shims for non-TS imports |

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

## Usage

```typescript
import type { SmartBlock, Strategy } from '@/types/co-pilot';
```

## Connections

- **Used by:** `co-pilot.tsx`, `SmartBlocksStatus.tsx`, `BarsTable.tsx`
- **Matches:** Server response shapes from `/api/strategy/*` endpoints
