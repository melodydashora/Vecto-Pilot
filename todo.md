# Technical Debt & Incomplete Features Analysis

> Generated: 2025-12-29
> Status: Pending Review

---

## Summary

| Category | Count | Priority |
|----------|-------|----------|
| Incomplete Features | 3 | High |
| Dead Code | 8 | Medium |
| Lint Fixes | 1 | Low |

---

## Incomplete Features (Requires Design Decision)

### 1. Block Selection Route Builder

**Files:**
- [`client/src/pages/co-pilot/StrategyPage.tsx`](client/src/pages/co-pilot/StrategyPage.tsx)

**Status:** Feature is 90% implemented but never wired to UI

**What Exists:**
| Component | Location | Status |
|-----------|----------|--------|
| `selectedBlocks` state | Line 74 | Working |
| `toggleBlockSelection()` function | Lines 160-183 | Implemented, never called |
| `buildRoute()` function | Lines 185-201 | Implemented |
| Selection controls UI | Lines 217-249 | Shows when `selectedBlocks.size > 0` |
| Block cards | Lines 446-716 | Missing onClick handler |

**What's Missing:**
- Block cards have no `onClick` to call `toggleBlockSelection(index)`
- No visual indication of selected state on cards
- No checkbox or selection affordance in card UI

**Code Analysis:**
```typescript
// Line 160-183: Function exists but is never called
const toggleBlockSelection = (blockIndex: number) => {
  const block = blocks[blockIndex];
  if (!block) return;
  // ... full implementation exists
};

// Lines 446-716: Card has no onClick
<Card
  key={index}
  className={`border-2 shadow-md...`}  // No selected state styling
  data-testid={`block-${index}`}
  // onClick={() => toggleBlockSelection(index)}  // MISSING!
>
```

**To Complete This Feature:**
1. Add `onClick={() => toggleBlockSelection(index)}` to Card component (line ~448)
2. Add selected state styling: `${selectedBlocks.has(index) ? 'ring-2 ring-blue-500' : ''}`
3. Consider adding a checkbox in the card header
4. Test the full flow: select blocks → see controls → build route

**Alternative: Remove Feature:**
1. Remove `selectedBlocks` state (line 74)
2. Remove `toggleBlockSelection` function (lines 160-183)
3. Remove `buildRoute` function (lines 185-201)
4. Remove `clearSelections` function (lines 203-209)
5. Remove selection controls UI (lines 217-249)
6. Remove `dwellTimers` state and related IntersectionObserver code

---

### 2. Closed Venue Reasoning Enrichment

**Files:**
- [`client/src/contexts/co-pilot-context.tsx`](client/src/contexts/co-pilot-context.tsx)

**Status:** State exists, read logic exists, but population logic is missing

**What Exists:**
| Component | Location | Status |
|-----------|----------|--------|
| `enrichedReasonings` state | Line 83 | Created, always empty |
| `setEnrichedReasonings` setter | Line 83 | Never called |
| Read logic in blocks mapping | Lines 366-375 | Tries to read from empty map |

**Code Analysis:**
```typescript
// Line 83: State created but setter never used
const [enrichedReasonings, setEnrichedReasonings] = useState<Map<string, string>>(new Map());

// Lines 366-375: Reads from map that's always empty
const blocks = (blocksData?.blocks || []).map(block => {
  if (!block.isOpen && !block.closed_venue_reasoning) {
    const key = `${block.name}-${block.coordinates.lat}-${block.coordinates.lng}`;
    const reasoning = enrichedReasonings.get(key);  // Always undefined!
    if (reasoning) {
      return { ...block, closed_venue_reasoning: reasoning };
    }
  }
  return block;
});
```

**Original Intent:**
When a venue is closed but the backend didn't provide a `closed_venue_reasoning`, the client was supposed to:
1. Detect the missing reasoning
2. Fetch/generate one (perhaps via AI endpoint)
3. Store in `enrichedReasonings` map
4. Display in UI

**Backend Already Provides:**
- [`server/api/strategy/blocks-fast.js:218`](server/api/strategy/blocks-fast.js) sends `closed_venue_reasoning: c.closed_reasoning`
- This client enrichment may have been a fallback that became unnecessary

**To Complete This Feature:**
1. Add a `useEffect` that detects closed venues without reasoning
2. Call an API endpoint to generate reasoning
3. Store results via `setEnrichedReasonings`

**Alternative: Remove Feature:**
1. Remove `enrichedReasonings` state (line 83)
2. Simplify blocks mapping to not check enrichedReasonings (lines 366-375)

---

### 3. Strategy Progress Phase Caps

**Files:**
- [`client/src/hooks/useEnrichmentProgress.ts`](client/src/hooks/useEnrichmentProgress.ts)

**Status:** Constant defined but never used in calculations

**What Exists:**
```typescript
// Lines 60-71: Defined but never referenced
const STRATEGY_CARD_CAPS: Record<PipelinePhase, number> = {
  starting: 100,
  resolving: 100,
  analyzing: 100,
  immediate: 100,
  venues: 100,
  routing: 100,
  places: 100,
  verifying: 100,
  enriching: 100,
  complete: 100
};
```

**Original Intent:**
Cap the strategy progress display at certain percentages per phase (e.g., don't show 100% until actually complete). The constant exists but `calculateDynamicProgress()` doesn't use it.

**To Complete This Feature:**
1. Apply caps in `calculateDynamicProgress()` function
2. Use `Math.min(calculatedProgress, STRATEGY_CARD_CAPS[currentPhase])`

**Alternative: Remove:**
1. Delete lines 60-71

---

## Dead Code (Safe to Remove)

### 4. Unused Imports in auth-context.tsx

**File:** [`client/src/contexts/auth-context.tsx`](client/src/contexts/auth-context.tsx)

**Lines:** 6, 8

**Issue:** `User` and `DriverVehicle` are imported but never directly used. They're referenced via `AuthState` which already includes them.

```typescript
// Line 5-13: Remove User and DriverVehicle from import
import type {
  User,           // REMOVE - used via AuthState
  DriverProfile,
  DriverVehicle,  // REMOVE - used via AuthState
  AuthState,
  LoginCredentials,
  RegisterData,
  AuthApiResponse
} from '@/types/auth';
```

**Fix:**
```typescript
import type {
  DriverProfile,
  AuthState,
  LoginCredentials,
  RegisterData,
  AuthApiResponse
} from '@/types/auth';
```

---

### 5. Unused Imports in co-pilot-context.tsx

**File:** [`client/src/contexts/co-pilot-context.tsx`](client/src/contexts/co-pilot-context.tsx)

**Line:** 4

**Issue:** `useCallback` imported but never used

```typescript
// Line 4: Remove useCallback
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
```

**Fix:**
```typescript
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
```

---

### 6. Unused State Variables in co-pilot-context.tsx

**File:** [`client/src/contexts/co-pilot-context.tsx`](client/src/contexts/co-pilot-context.tsx)

**Issues:**

| Variable | Line | Problem |
|----------|------|---------|
| `strategySnapshotId` | 76 | Set in 3 places, never read |
| `lastStatusRef` | 86 | Assigned, never updated or read |

```typescript
// Line 76: Set but never read
const [strategySnapshotId, setStrategySnapshotId] = useState<string | null>(null);
// Used at lines 168, 182, 262 but the value is never consumed

// Line 86: Never used
const lastStatusRef = useRef<'idle' | 'ready' | 'paused'>('idle');
```

**Fix:** Either:
- Remove both if not needed
- Or implement the intended functionality (expose `strategySnapshotId` in context value)

---

### 7. Unused Import in useEnrichmentProgress.ts

**File:** [`client/src/hooks/useEnrichmentProgress.ts`](client/src/hooks/useEnrichmentProgress.ts)

**Line:** 5

**Issue:** `useCallback` imported but never used

```typescript
// Line 5: Remove useCallback
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
```

**Fix:**
```typescript
import { useState, useEffect, useMemo, useRef } from 'react';
```

---

### 8. Unused Variable in ResetPasswordPage.tsx

**File:** [`client/src/pages/auth/ResetPasswordPage.tsx`](client/src/pages/auth/ResetPasswordPage.tsx)

**Line:** 34

**Issue:** `navigate` is assigned but success flow uses `<Link>` component instead

```typescript
// Line 34: Assigned but never used
const navigate = useNavigate();

// Line 106-114: Success uses <Link> not navigate()
<Link to="/auth/sign-in">
  <Button>Sign In</Button>
</Link>
```

**Fix Options:**
1. Remove: `const navigate = useNavigate();`
2. Or prefix: `const _navigate = useNavigate();` (if keeping for future)
3. Or use: Replace `<Link>` with `navigate('/auth/sign-in')` after timeout

---

### 9. Unused Imports in StrategyPage.tsx

**File:** [`client/src/pages/co-pilot/StrategyPage.tsx`](client/src/pages/co-pilot/StrategyPage.tsx)

**Lines:** 12, 21, 38

**Issues:**

| Import | Line | Status |
|--------|------|--------|
| `TrendingUp` | 12 | Icon never used in JSX |
| `Filter` | 21 | Icon never used in JSX |
| `queryClient` | 38 | Assigned but never called |

```typescript
// Lines 9-22: Remove TrendingUp and Filter
import {
  MapPin,
  Navigation,
  TrendingUp,  // REMOVE
  Clock,
  // ...
  Filter       // REMOVE
} from 'lucide-react';

// Line 38: Remove if not needed
const queryClient = useQueryClient();  // Never used
```

---

## Lint Fixes

### 10. @ts-ignore in calendar.tsx

**File:** [`client/src/components/ui/calendar.tsx`](client/src/components/ui/calendar.tsx)

**Line:** 3

**Issue:** ESLint requires `@ts-expect-error` instead of `@ts-ignore`

```typescript
// Line 3: Current
// @ts-ignore - react-day-picker v9 type compatibility issue

// Fix:
// @ts-expect-error - react-day-picker v9 type compatibility issue
```

**Why:** `@ts-expect-error` will error if the type issue is fixed, preventing stale suppressions.

---

## Action Items Checklist

### High Priority (Incomplete Features)
- [ ] Decide: Complete or remove block selection feature in StrategyPage.tsx
- [ ] Decide: Complete or remove enrichedReasonings in co-pilot-context.tsx
- [ ] Decide: Use or remove STRATEGY_CARD_CAPS in useEnrichmentProgress.ts

### Medium Priority (Dead Code Cleanup)
- [ ] Remove unused imports from auth-context.tsx (User, DriverVehicle)
- [ ] Remove useCallback from co-pilot-context.tsx
- [ ] Remove/fix strategySnapshotId and lastStatusRef in co-pilot-context.tsx
- [ ] Remove useCallback from useEnrichmentProgress.ts
- [ ] Fix navigate in ResetPasswordPage.tsx
- [ ] Remove TrendingUp, Filter, queryClient from StrategyPage.tsx

### Low Priority (Lint)
- [ ] Change @ts-ignore to @ts-expect-error in calendar.tsx

---

## Commands to Verify Fixes

```bash
# Run type checker
npm run typecheck

# Run linter
npm run lint

# Run both
npm run lint && npm run typecheck
```

---

## Related Documentation

- [LESSONS_LEARNED.md](LESSONS_LEARNED.md) - Add findings after resolution
- [docs/review-queue/pending.md](docs/review-queue/pending.md) - Track review status
