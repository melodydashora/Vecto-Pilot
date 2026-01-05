# Rules & Patterns from Completed Work

**Auto-generated from reviewed implementations. These are actionable rules derived from real fixes.**

---

## Table of Contents

1. [Database Lookup Patterns](#database-lookup-patterns)
2. [Session Architecture Rules](#session-architecture-rules)
3. [AI Model Configuration](#ai-model-configuration)
4. [API Design Patterns](#api-design-patterns)
5. [Frontend Hook Patterns](#frontend-hook-patterns)
6. [Documentation Sync Rules](#documentation-sync-rules)

---

## Database Lookup Patterns

### Rule: Use Dedicated Lookup Tables for O(1) Access

**Source:** US Market Cities Implementation (2026-01-05)

**Problem:** JSONB arrays require full scans for lookups
**Solution:** Create dedicated mapping tables with proper indexes

```sql
-- GOOD: Dedicated lookup table
CREATE TABLE us_market_cities (
  id SERIAL PRIMARY KEY,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  market_name TEXT NOT NULL,
  region_type TEXT DEFAULT 'Satellite'  -- Core/Satellite/Rural
);
CREATE INDEX idx_city_state ON us_market_cities(LOWER(city), LOWER(state));

-- BAD: JSONB array scan
SELECT * FROM markets WHERE city_aliases @> '["Frisco"]'::jsonb;
```

**When to Apply:** Any time you need to look up a value and return related data (city→market, user→org, etc.)

---

### Rule: Use Flexible Pattern Matching for Name Variations

**Source:** Dallas-Fort Worth Market Resolution (2026-01-05)

**Problem:** Data sources use different names ("Dallas" vs "Dallas-Fort Worth" vs "DFW")
**Solution:** Use LIKE patterns with wildcards

```sql
-- GOOD: Flexible matching handles naming variations
SELECT * FROM market_intelligence
WHERE LOWER(market) LIKE '%dallas%';
-- Matches: "Dallas", "Dallas-Fort Worth", "DFW-Dallas"

-- BAD: Exact match fails on variations
SELECT * FROM market_intelligence
WHERE market = 'Dallas';
-- Misses: "Dallas-Fort Worth"
```

---

## Session Architecture Rules

### Rule: Three-Table Session Pattern

**Source:** Session Architecture Implementation (2026-01-05)

| Table | Purpose | Lifecycle |
|-------|---------|-----------|
| `driver_profiles` | **Identity** - who you are | Forever (created at signup) |
| `users` | **Session** - who's online now | Temporary (login → logout/TTL) |
| `snapshots` | **Activity** - what you did when | Forever (historical record) |

**Key Columns for Session Management:**
```sql
-- users table
session_start_at TIMESTAMP  -- Hard limit anchor (2 hours max)
last_active_at TIMESTAMP    -- Sliding window anchor (60 min inactivity)
```

**Session Expiry Logic:**
```javascript
const HARD_LIMIT_MS = 2 * 60 * 60 * 1000;    // 2 hours from session_start_at
const SLIDING_WINDOW_MS = 60 * 60 * 1000;     // 60 min from last_active_at

const isExpired =
  (now - session_start_at) > HARD_LIMIT_MS ||
  (now - last_active_at) > SLIDING_WINDOW_MS;
```

---

### Rule: Highlander Session Pattern

**Source:** Session Architecture Implementation (2026-01-05)

**Rule:** One session per user. New login invalidates all existing sessions.

```javascript
// On new login
await db.update(users)
  .set({
    session_token: null,  // Invalidate old session
    session_start_at: null
  })
  .where(eq(users.driver_profile_id, profileId));

// Then create new session
await db.insert(users).values({
  driver_profile_id: profileId,
  session_token: newToken,
  session_start_at: new Date()
});
```

---

### Rule: Lazy Session Cleanup

**Source:** Session Architecture Implementation (2026-01-05)

**Pattern:** Clean up expired sessions on every auth check instead of using cron jobs.

```javascript
// In requireAuth middleware
async function requireAuth(req, res, next) {
  // 1. Check if session valid
  const session = await getSession(req.headers.authorization);

  if (isExpired(session)) {
    // 2. Lazy cleanup - delete expired session
    await db.delete(users).where(eq(users.id, session.id));
    return res.status(401).json({ error: 'Session expired' });
  }

  // 3. Extend sliding window
  await db.update(users)
    .set({ last_active_at: new Date() })
    .where(eq(users.id, session.id));

  next();
}
```

---

## AI Model Configuration

### Rule: Use Model Registry, Not Hardcoded Model Names

**Source:** Event Validator Documentation Sync (2026-01-04)

```javascript
// GOOD: Use model registry
import { getModelConfig } from './model-registry.js';
const config = getModelConfig('event_validator');
await callModel(config.model, { system, user });

// BAD: Hardcoded model name
await callGemini('gemini-2.5-pro', { system, user });
```

**Why:** Models change. Claude replaced Gemini for event validation because Gemini returned outdated schedules.

---

### Rule: Document Model Changes in LESSONS_LEARNED.md

**Source:** Event Validator Documentation Sync (2026-01-04)

When changing AI models, document:
1. **What changed** (old model → new model)
2. **Why** (specific failure case that prompted change)
3. **When** (date of change)

```markdown
## AI Model: Event Validator Change (2026-01-04)
- **Changed:** Gemini 2.5 Pro → Claude Opus 4.5
- **Why:** Gemini returned outdated/incorrect event schedules
- **File:** server/lib/ai/event-schedule-validator.js
```

---

## API Design Patterns

### Rule: Single Endpoint for Related Data

**Source:** Intel Tab City→Market Resolution (2026-01-05)

**Problem:** Multiple sequential API calls add latency and complexity
**Solution:** Combine related lookups into single endpoint

```javascript
// GOOD: Single endpoint returns lookup + data
GET /api/intelligence/for-location?city=Frisco&state=TX
// Returns: { location, market, intelligence }

// BAD: Multiple sequential calls
GET /api/intelligence/lookup?city=Frisco&state=TX  // → { market_slug }
GET /api/intelligence/market/dallas                 // → { intelligence }
```

**Trade-off:** Larger response payload vs reduced latency and simpler client code.

---

### Rule: Dropdown + "Other" Pattern for Constrained Input

**Source:** Market Signup Dropdown (2026-01-05)

**Problem:** Free-text input creates data quality issues
**Solution:** Dropdown with predefined options + "Other" for edge cases

```typescript
// Frontend
const markets = await fetch('/api/intelligence/markets-dropdown');
// Returns: { markets: ["Abilene", "Dallas", ...], total: 243 }

// Add "Other" option
markets.push({ value: '__OTHER__', label: '➕ Other (add new market)' });

// When "Other" selected, show free-text input
if (selectedMarket === '__OTHER__') {
  // POST /api/intelligence/add-market with custom market
}
```

---

## Frontend Hook Patterns

### Rule: Single useMemo for Related Array Processing

**Source:** useMarketIntelligence Infinite Loop Fix (2026-01-02)

**Problem:** Multiple useMemos with array dependencies cause infinite re-renders
**Solution:** Bundle all array processing in ONE useMemo

```typescript
// GOOD: Single useMemo with stable dependency
const processedData = useMemo(() => {
  const EMPTY: Item[] = [];
  const getByType = (type: string) => data?.by_type?.[type] || EMPTY;

  return {
    zones: getByType('zone'),
    strategies: getByType('strategy'),
    // ... all derived arrays
  };
}, [data]); // Single stable dependency from React Query

// BAD: Multiple useMemos with array dependencies
const zones = useMemo(() => data?.zones || [], [data?.zones]);
const strategies = useMemo(() => data?.strategies || [], [data?.strategies]);
// Each useMemo triggers on array reference change → infinite loop
```

---

### Rule: Use .length as Dependency for Defensive Memoization

**Source:** RideshareIntelTab Loop Fix (2026-01-02)

When receiving arrays from hooks, use `.length` as dependency:

```typescript
// GOOD: Length dependency is stable
const zones = useMemo(() => rawZones || [], [rawZones?.length]);

// BAD: Array reference changes every render
const zones = useMemo(() => rawZones || [], [rawZones]);
```

---

## Documentation Sync Rules

### Rule: Update README.md When Modifying Files in a Folder

**Source:** CLAUDE.md Development Process Rules

Every folder has a README.md. When you modify files:
1. Check if the README lists that file
2. Update the file table if needed
3. Add any new design decisions

```markdown
// Example: After adding new endpoint to server/api/intelligence/
// Update server/api/intelligence/README.md:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/for-location` | GET | **NEW** City→Market lookup with intel |
```

---

### Rule: Log Changes to review-queue/pending.md

**Source:** Change Analyzer System

After completing work, append a summary:

```markdown
## 2026-01-05: Feature Name

### Summary
One-line description of what was done.

### Files Modified
| File | Change |
|------|--------|
| `path/to/file.js` | Description |

### Status: COMPLETED
```

---

### Rule: Move Completed Work to reviewed-queue/

**Source:** This document creation process (2026-01-05)

When work is reviewed and complete:
1. Extract actionable rules to `docs/reviewed-queue/RULES_FROM_COMPLETED_WORK.md`
2. Move session summaries to `docs/reviewed-queue/YYYY-MM-DD-summary.md`
3. Delete completed items from `docs/review-queue/pending.md`

---

## Appendix: Source Sessions

| Date | Session | Key Implementations |
|------|---------|---------------------|
| 2026-01-05 | US Market Cities | 723 city→market mapping, signup dropdown, intel tab fix |
| 2026-01-05 | Session Architecture | Three-table pattern, sliding window, Highlander rule |
| 2026-01-04 | Event Validator Sync | Model registry pattern, documentation sync |
| 2026-01-02 | Intel Tab Enhancement | Market Command Center, demand patterns API |
| 2026-01-02 | AI Coach Fixes | Event deactivation, date/time awareness |
| 2026-01-01 | Zone Intelligence | Crowd-sourced zone learning from conversations |
