# Strategy Pipeline Audit - 2026-01-10

**Source:** GPT-5.2 Analysis + Claude Opus 4.5 Verification
**Status:** ALL 5 ISSUES VERIFIED

---

## Verified Issues Summary

| Issue | Severity | Status | Fix Priority |
|-------|----------|--------|--------------|
| 1. Wrong error message | LOW | VERIFIED | P2 |
| 2. SSE trigger broken | HIGH | VERIFIED | **P0** |
| 3. Advisory lock leak | HIGH | VERIFIED | **P0** |
| 4. Status enum drift | MEDIUM | VERIFIED | P1 |
| 5. Block mapper inconsistency | MEDIUM | PARTIALLY FIXED | P1 |

---

## Issue 1: GET `/blocks-fast` Error Message is Wrong

**Location:** `server/api/strategy/blocks-fast.js:345`

**Current (Wrong):**
```javascript
message: 'Waiting for consolidated strategy to complete'
```

**Reality:** `isStrategyReady()` checks `strategy_for_now`, NOT `consolidated_strategy`

**Evidence:**
```javascript
// server/lib/strategy/strategy-utils.js:84
const ready = Boolean(strategyRow.strategy_for_now);
```

**Fix Required:**
```javascript
message: 'Waiting for immediate strategy to complete'
```

---

## Issue 2: `strategy_ready` SSE Never Fires for NOW Strategy (CRITICAL)

**Location:** `migrations/20251209_fix_strategy_notify.sql:21`

**Current Trigger Condition:**
```sql
IF NEW.status = 'ok' AND NEW.consolidated_strategy IS NOT NULL THEN
```

**Problem:**
- Immediate pipeline writes `strategy_for_now`, NOT `consolidated_strategy`
- `consolidated_strategy` stays NULL in the NOW flow
- **SSE `strategy_ready` NEVER fires for the main use case!**

**Impact:**
- UI falls back to 2s polling loop
- Extra redundant requests
- "strategy-ready" event path is effectively dead

**Fix Options:**
1. **Preferred:** Change trigger to fire when `strategy_for_now` becomes non-null:
   ```sql
   IF NEW.status IN ('ok', 'pending_blocks') AND NEW.strategy_for_now IS NOT NULL THEN
   ```
2. **Alternative:** Explicitly call `pg_notify('strategy_ready', snapshotId)` after saving `strategy_for_now`

---

## Issue 3: Advisory Lock Implementation Can Leak (CRITICAL)

**Location:** `server/api/strategy/blocks-fast.js:66-93`

**Problem:** Code uses session-level locks but comment claims transaction-scoped:

**Comment (line 26):**
```javascript
// Updated 2026-01-05: Replaced in-memory Map with pg_advisory_xact_lock
```

**Actual Code (line 68):**
```javascript
sql`SELECT pg_try_advisory_lock(hashtext(${snapshotId})) as acquired`
```

**Why This is Bad:**
- With connection pooling, acquire and release can hit **different sessions**
- Lock might not be released
- Other requests can hang forever
- Causes "why is SmartBlocks stuck" behavior

**Fix Required:**
Switch to transaction-scoped locks inside `db.transaction(...)`:
```javascript
sql`SELECT pg_try_advisory_xact_lock(hashtext(${snapshotId})) as acquired`
```

---

## Issue 4: Status Enum Drift

**Schema Comments:**
- `strategies.status`: `pending|ok|failed`
- `block_jobs.status`: `pending|running|succeeded|failed`
- `triad_jobs.status`: `queued|running|ok|error`

**Code Actually Uses:**
- `running` (line 493)
- `complete` (multiple places)
- `pending_blocks` (line 505)

**Evidence (line 505):**
```javascript
if (existingStrategy && ['complete', 'ok', 'pending_blocks'].includes(existingStrategy.status))
```

**Impact:**
- Inconsistent UI states
- Wrong dedupe decisions
- "Should generate blocks but didn't" bugs

**Fix Required:**
Define single shared enum:
```javascript
export const STRATEGY_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  OK: 'ok',
  FAILED: 'failed',
  ERROR: 'error'
} as const;
```

---

## Issue 5: Block Mappers Have Inconsistent Fields (PARTIALLY FIXED)

**Fixed:**
- `content-blocks.js` now uses `toApiBlock()` transformer (2026-01-10)

**Still Broken:**
- `blocks-fast.js:271` uses `c.features?.isOpen` without snake_case fallback

**Code (line 271):**
```javascript
isOpen: c.features?.isOpen,
```

**Fix Required:**
```javascript
isOpen: c.features?.isOpen ?? c.features?.is_open ?? c.isOpen ?? c.is_open ?? null,
```

Or better: use the same `toApiBlock()` transformer.

---

## Redundant Call Paths Currently Active

1. **Polling:** `/api/blocks/strategy/:snapshotId` every 2s
2. **SSE invalidations:**
   - `strategy_ready` → refetch `/api/blocks/strategy` (BROKEN - never fires)
   - `blocks_ready` → refetch `/api/blocks-fast`

**Current Reality:** Polling dominates because `strategy_ready` never fires.

---

## Surgical Fix Order

1. **P0:** Fix `strategy_ready` signaling for `strategy_for_now` (trigger or explicit NOTIFY)
2. **P0:** Fix advisory locks → transaction-scoped xact locks
3. **P1:** Unify status enum and normalize status usage
4. **P1:** Unify block mapping across endpoints (normalize `isOpen`)
5. **P2:** Fix error message text

---

## Related Files

| File | Role |
|------|------|
| `server/api/strategy/blocks-fast.js` | Main generation endpoint |
| `server/api/strategy/content-blocks.js` | Polling endpoint |
| `server/lib/strategy/strategy-utils.js` | `isStrategyReady()` function |
| `migrations/20251209_fix_strategy_notify.sql` | SSE trigger |
| `server/validation/transformers.js` | Block transformer |

---

## Tags

#audit #strategy #sse #advisory-locks #status-enum #blocks #verified
