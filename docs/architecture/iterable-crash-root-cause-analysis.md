# Root Cause Analysis: "(intermediate value) is not iterable"

**Date:** 2026-04-04
**Error:** `[BRIEFING 2/3 - Briefing|Events] Briefing failed for 4ec07144: (intermediate value) is not iterable`
**Call chain:** `blocks-fast.js:688 → briefing.js:52 → generateAndStoreBriefing() → generateBriefingInternal()`

---

## What "(intermediate value) is not iterable" means

In V8, this error occurs when code tries to destructure or iterate over a non-iterable value that is the **result of an expression** (not a named variable). Triggers:
- `const [a, b] = someFunc()` where `someFunc()` returns `null`, `undefined`, or a plain object
- `for (const x of someFunc())` same
- `[...someFunc()]` same

If it were a named variable, the error would say `"foo is not iterable"`.

---

## CONFIRMED Root Causes Found

### RC-1: `db.execute()` array destructuring (FIXED in commit dabaec22)

**File:** `server/lib/briefing/briefing-service.js` (line 2320, introduced by H-4 advisory lock fix)
**Pattern:**
```javascript
// BROKEN (original H-4 code):
const [lockResult] = await db.execute(
    sql`SELECT pg_try_advisory_lock(hashtext(${snapshotId})) as acquired`
);
```
**Root cause:** `drizzle-orm/node-postgres` `db.execute()` returns `QueryResult { rows: [...], rowCount, ... }` — a plain object, NOT an array. Array destructuring on it throws "(intermediate value) is not iterable".
**Fix:** Changed to `const lockQueryResult = await db.execute(...)` then `lockQueryResult.rows?.[0]?.acquired`.
**Evidence:** blocks-fast.js:94-97 uses the same `db.execute()` call and accesses `.rows[0]`.

### RC-2: Consolidator nested destructuring (FIXED in commit 31dcff7d)

**File:** `server/lib/ai/providers/consolidator.js` (line 781)
**Pattern:**
```javascript
const [[strategyRow], [briefingRow]] = await Promise.all([
    db.select().from(strategies)...,
    db.select().from(briefings)...
]);
```
**Root cause:** Nested array destructuring. The outer `Promise.all` returns `[array1, array2]` (safe). The inner `[strategyRow]` destructures `array1` which SHOULD be an array from Drizzle `.select()`. However, if a Drizzle query returns something unexpected (e.g., during connection pool exhaustion or timeout), the inner destructuring fails.
**Fix:** Changed to safe indexed access: `const strategyRow = strategyRows?.[0]`.
**Note:** This is in the consolidator path (post-briefing), not the briefing path itself. BUT it's in the same `blocks-fast.js` TRIAD pipeline, so errors here would be logged similarly.

---

## Investigated and Cleared (Not Root Causes)

### All `for...of` loops in briefing-service.js

| Line | Code | Source of iterable | Verdict |
|------|------|-------------------|---------|
| 232 | `for (const event of events)` | Function parameter | SAFE — guarded by `if (!events \|\| events.length === 0) return` at line 165 |
| 372 | `for (const result of categoryResults)` | `Promise.all` result | SAFE — always array |
| 382 | `for (const event of result.items \|\| [])` | Object property | SAFE — `\|\| []` guard |
| 646 | `for (const line of lines)` | `str.split('\n')` | SAFE — split always returns array |
| 1024 | `for (const result of categoryResults)` | `Promise.all` result | SAFE — always array |
| 1031 | `for (const event of result.items \|\| [])` | Object property | SAFE — `\|\| []` guard |
| 1225 | `for (const event of validatedEvents)` | `validateEventsHard().valid` | SAFE — always returns `{ valid: [] }` |
| 2256 | `for (const item of items)` | Function parameter | SAFE — guarded by `if (!Array.isArray(items))` |

### All array destructuring in briefing-service.js

| Line | Code | Source | Verdict |
|------|------|--------|---------|
| 104 | `const [marketResult] = await db.select()...` | Drizzle select | SAFE — always returns array |
| 1510 | `const [currentRes, forecastRes] = await Promise.all([fetch(), fetch()])` | Promise.all of fetch | SAFE — fetch returns Response, Promise.all returns array |
| 2498 | `[weather, traffic, events, airport, news] = await Promise.all([...])` | Promise.all | SAFE — always array |

### All spread operations

| Line | Code | Verdict |
|------|------|---------|
| 380 | `allCitations.push(...result.citations)` | SAFE — inside `if (result.citations)` guard |
| 458 | `[...closures.filter(), ...accidents.filter()]` | SAFE — filter always returns array |
| 2273 | `[...seenWords].filter()` | SAFE — Set is iterable |

### Event pipeline functions (normalizeEvent.js, validateEvent.js, hashEvent.js, geocodeEvent.js)

All checked — no unguarded destructuring on expression results.

### AI adapters (gemini-adapter.js, anthropic-adapter.js, openai-adapter.js, vertex-adapter.js)

All checked — no vulnerable patterns.

### Hedged router (hedged-router.js)

All `for...of` loops iterate over `Map` instances — always iterable.

### TomTom traffic module (tomtom.js)

All `for...of` loops guarded by `if (x && x.length > 0)` checks.

---

## Type Guard Assertions Added (commit 12020272)

Instead of silently degrading, we now throw with diagnostic messages:
```javascript
if (!Array.isArray(eventsItems)) {
    throw new Error(`BRIEFING BUG: eventsResult.items is ${typeof eventsItems}...`);
}
```

If the crash recurs, the error message will tell us EXACTLY which fetch function returned the wrong type.

---

## Conclusion

**RC-1 (db.execute destructuring) was the primary crash.** It was introduced by the H-4 advisory lock fix during this session and fixed 30 minutes later. The server needs to be restarted with the fixed code.

**RC-2 (consolidator nested destructuring) is a latent risk** in the same TRIAD pipeline. Fixed proactively.

**All other code paths are safe.** The type guard assertions will catch any future regressions with clear diagnostic messages instead of the cryptic "(intermediate value) is not iterable".

---

## If Crash Recurs After Fix

If the error appears again after restarting with the fixed code, the type guards will produce a message like:
```
BRIEFING BUG: eventsResult.items is undefined (...), expected array. Fix fetchEventsForBriefing return value.
```

This pinpoints exactly which function to investigate.
