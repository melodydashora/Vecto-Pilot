# Single Contract Plan - API Response Normalization

**Created:** 2026-01-10
**Status:** ACTIVE
**Goal:** Eliminate casing drift between server and client

---

## Executive Summary

The codebase has **contract drift** where:
- **PostgreSQL/Drizzle** uses `snake_case` (e.g., `strategy_for_now`)
- **TypeScript types** expect `camelCase` (e.g., `strategyForNow`)
- **Server responses** are inconsistent (some snake, some camel)
- **Client code** has fallback chains to handle both

This plan creates a **single canonical contract** where all API responses use camelCase.

---

## Architecture

```
DB (snake_case) → Transformers → API Response (camelCase) → Client Types
     ↓                                    ↓
strategy_for_now  ──────────────→  strategyForNow
consolidated_strategy  ──────────→  consolidated
ranking_id  ───────────────────→  rankingId
path_taken  ────────────────────→  pathTaken
```

---

## Current State Audit

### Response Paths Returning snake_case

| File | Line | Field(s) | Used By |
|------|------|----------|---------|
| `blocks-fast.js` | 376-379 | `consolidated_strategy`, `strategy_for_now` | GET/POST blocks |
| `blocks-fast.js` | 442 | `ranking.ranking_id` | Success response |
| `blocks-fast.js` | 545-549 | `strategy.strategy_for_now`, `consolidated_strategy` | Cache hit path |
| `blocks-fast.js` | 681-685 | Same as above | Full pipeline path |
| `blocks-fast.js` | 704-706 | Same as above | Fallback path |

### Existing Transformers (Already Correct)

| Transformer | Location | Converts |
|-------------|----------|----------|
| `toApiBlock()` | `transformers.js:120` | Block DB row → camelCase |
| `toApiBlocksResponse()` | `transformers.js:188` | Full response → camelCase |
| `toApiStrategyPolling()` | `transformers.js:213` | Strategy polling → camelCase |

### Client Fallback Chains (Should Be Removed After Fix)

| File | Line | Current | After Fix |
|------|------|---------|-----------|
| `co-pilot-context.tsx` | 443 | `data.strategy_for_now \|\| data.briefing?.strategy_for_now` | Just `data.strategy.strategyForNow` |
| `co-pilot-context.tsx` | 444 | `data.pathTaken ?? data.path_taken` | Just `data.pathTaken` |

---

## Implementation Plan

### Phase 1: Normalize blocks-fast.js Response Paths

**Goal:** All `res.json()` calls use `toApiBlocksResponse()` or camelCase

#### 1.1 Fix briefing object (line 376-379)

```javascript
// BEFORE
const briefing = strategyRow ? {
  consolidated_strategy: strategyRow.consolidated_strategy || null,
  strategy_for_now: strategyRow.strategy_for_now || null
} : null;

// AFTER
const briefing = strategyRow ? {
  consolidated: strategyRow.consolidated_strategy || null,
  strategyForNow: strategyRow.strategy_for_now || null
} : null;
```

#### 1.2 Fix strategy object (multiple locations)

```javascript
// BEFORE (lines 546-549, 681-685, 704-706)
strategy: {
  strategy_for_now: existingStrategy.strategy_for_now || '',
  consolidated: existingStrategy.consolidated_strategy || ''
}

// AFTER
strategy: {
  strategyForNow: existingStrategy.strategy_for_now || '',
  consolidated: existingStrategy.consolidated_strategy || ''
}
```

#### 1.3 Fix ranking_id references

```javascript
// BEFORE (lines 442, 545)
rankingId: ranking.ranking_id

// Already correct - just verify all paths use this format
```

### Phase 2: Add Response Schemas (Zod Validation)

Create canonical response schemas in `server/validation/response-schemas.js`:

```javascript
import { z } from 'zod';

export const BlocksResponseSchema = z.object({
  ok: z.boolean().optional(),
  status: z.enum(['pending', 'running', 'ok', 'pending_blocks', 'failed']),
  reason: z.string().optional(),
  snapshotId: z.string(),
  blocks: z.array(SmartBlockSchema),
  rankingId: z.string().optional(),
  strategy: z.object({
    strategyForNow: z.string(),
    consolidated: z.string()
  }).optional(),
  pathTaken: z.string().optional(),
  timing: TimingSchema.optional(),
  audit: z.record(z.unknown()).optional()
});
```

### Phase 3: Remove Client Fallback Chains

After server is normalized, remove fallbacks:

```typescript
// BEFORE
pathTaken: data.pathTaken ?? data.path_taken,
strategy: data.strategy_for_now || data.briefing?.strategy_for_now,

// AFTER
pathTaken: data.pathTaken,
strategy: data.strategy?.strategyForNow,
```

---

## Parallel Request Behavior (Documented)

### Why Triad/Bars/Briefing Logs Interleave

The server correctly handles **parallel requests**:

| Request | Trigger | Behavior |
|---------|---------|----------|
| **Strategy (Triad)** | `POST /api/blocks-fast` | Checks cache first → returns immediately if cached |
| **Bars (Map/List)** | `GET /api/venues/nearby` | Independent Google Places search |
| **Briefing (Events)** | Background refresh | Updates DB for next request |

**Key Insight:** When Strategy is cached, it short-circuits and returns immediately WITHOUT waiting for Briefing. The dependency rule is only enforced during **fresh generation**.

### Cache Staleness Consideration

Currently, cached rankings are trusted until session expires. Optional enhancement:

```javascript
// In blocks-fast.js, before returning cached blocks:
const briefingAge = Date.now() - ranking.created_at.getTime();
if (briefingAge > 30 * 60 * 1000) { // 30 minutes
  // Trigger background refresh but still return cached blocks
  runBriefing(snapshotId).catch(err =>
    console.warn('[blocks-fast] Background briefing refresh failed', err)
  );
}
```

**Recommendation:** Not blocking. Current behavior is correct for performance.

---

## Verification Commands

```bash
# Check for remaining snake_case in blocks-fast responses
grep -n "strategy_for_now\|consolidated_strategy\|ranking_id" server/api/strategy/blocks-fast.js

# Check client fallback chains
grep -n "path_taken\|strategy_for_now" client/src/

# Verify transformers are used
grep -n "toApiBlocksResponse\|toApiBlock" server/api/strategy/
```

---

## Success Criteria

1. [ ] All `blocks-fast.js` responses return camelCase
2. [ ] No client fallback chains needed (removed)
3. [ ] Zod schemas validate all response paths
4. [ ] TypeScript types match API responses exactly
5. [ ] No runtime casing conversions needed

---

## Related Documents

| Document | Purpose |
|----------|---------|
| `DOC_DISCREPANCIES.md` | D-023 to D-026 (UI casing fixes) |
| `CONSOLIDATED_CLEANUP_2026-01-10.md` | Full cleanup plan |
| `server/validation/transformers.js` | Existing transformers |
| `client/src/types/co-pilot.ts` | Client type definitions |
