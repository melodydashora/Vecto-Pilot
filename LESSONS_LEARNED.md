# Lessons Learned - Vecto Pilot Development

**For Replit AI Agents: Critical Knowledge Base**

This document captures historical issues, pitfalls, and best practices discovered during Vecto Pilot development. Review this before making changes to avoid repeating past mistakes.

---

## Table of Contents

1. [Critical Rules](#critical-rules)
2. [AI Model Configuration](#ai-model-configuration)
3. [Database & Schema](#database--schema)
4. [Frontend Pitfalls](#frontend-pitfalls)
5. [Backend Patterns](#backend-patterns)
6. [File Organization](#file-organization)
7. [Common Bugs & Fixes](#common-bugs--fixes)
8. [Testing Checklist](#testing-checklist)

---

## Critical Rules

### DO NOT

1. **DO NOT delete files without verifying they are unused** - Always grep for imports/requires first
2. **DO NOT create duplicate implementations** - Search for existing code before writing new
3. **DO NOT use deprecated model parameters** - Check MODEL.md for current API specs
4. **DO NOT add temperature to GPT-5.2 or o1 models** - They don't support it (causes 400 errors)
5. **DO NOT use `thinking_budget` for Gemini** - Use `thinkingConfig.thinkingLevel` (nested structure)
6. **DO NOT skip enrichment steps** - Smart Blocks require Google Places/Routes/Geocoding enrichment
7. **DO NOT store secrets in code** - Use environment variables only
8. **DO NOT add location fallbacks** - This is a GLOBAL app. No `|| 'Frisco'`, no `|| 'America/Chicago'`, no hardcoded airports. If data is missing, return an error - don't mask the bug with defaults. See CLAUDE.md "NO FALLBACKS" rule.
9. **DO NOT use graceful error handling or silent failures** - Errors should surface with clear messages. Never use `console.debug` to hide errors. Never return `null` to silently succeed. If something fails, throw an error or log with `console.error`. Fix the ROOT CAUSE instead of masking symptoms. (Added 2026-01-06)
10. **DO NOT omit callback functions from useEffect deps without using the ref pattern** - If an effect calls a callback (like `refreshGPS`), you have two options: (A) include it in deps, OR (B) use a ref pattern if adding to deps causes infinite loops. The ref pattern: `const fnRef = useRef(fn)`, then `useEffect(() => { fnRef.current = fn }, [fn])`, then call `fnRef.current?.()` in your effect. This avoids stale closures while preventing "Maximum update depth exceeded" errors. See "Auth Loop on Login" section for full pattern. (Added 2026-01-07)
11. **DO NOT create new objects inline when passing to hooks/components** - Example: `useHook({ coords: { lat: x, lng: y } })` creates a new object reference every render → infinite re-renders. Instead, pass existing refs: `useHook({ coords })` or memoize: `useMemo(() => ({ lat: x, lng: y }), [x, y])`. (Added 2026-01-07)

### ALWAYS DO

1. **ALWAYS check existing code first** - This repo has accumulated duplicate implementations
2. **ALWAYS use the adapter pattern** - Call models via `server/lib/ai/adapters/index.js`
3. **ALWAYS link data to snapshot_id** - Snapshots are the central ML connector
4. **ALWAYS test after changes** - Run `npm run lint && npm run typecheck && npm run build`
5. **ALWAYS update documentation** - Keep MODEL.md, ARCHITECTURE.md current

---

## AI Model Configuration

### GPT-5.2 (OpenAI)

**CORRECT:**
```javascript
{
  model: "gpt-5.2",
  messages: [...],
  reasoning_effort: "medium",      // Top-level, NOT nested under reasoning
  max_completion_tokens: 32000,    // NOT max_tokens
}
```

**WRONG (causes 400 errors):**
```javascript
{
  temperature: 0.7,         // NOT supported
  max_tokens: 1000,         // DEPRECATED - use max_completion_tokens
  top_p: 0.95,             // NOT supported
}
```

### GPT-5-search-api (OpenAI Web Search)

**Added 2026-01-05: For web search, use the dedicated `gpt-5-search-api` model.**

OpenAI's web search capability requires a dedicated search model, NOT `gpt-5.2` with a tool.

**CORRECT:**
```javascript
{
  model: "gpt-5-search-api",  // Dedicated search model
  messages: [...],
  max_completion_tokens: 8192,
  web_search_options: {
    search_context_size: "medium",  // low, medium, high
    user_location: {
      type: "approximate",
      approximate: { country: "US" }
    }
  }
  // NOTE: NO reasoning_effort - not supported by search model!
}
```

**WRONG (causes 400 errors):**
```javascript
{
  model: "gpt-5.2",                    // WRONG - use gpt-5-search-api
  tools: [{ type: "web_search_preview" }],  // WRONG - not a tool
  reasoning_effort: "medium",          // WRONG - not supported by search model
}
```

**Key differences from regular GPT-5.2:**
- Model ID: `gpt-5-search-api` (not `gpt-5.2`)
- Web search via `web_search_options` (not tools array)
- `reasoning_effort` is NOT supported
- Response includes `annotations` array with URL citations

### Gemini 3 Pro Preview (Google)

**CRITICAL: Model IDs must include `-preview` suffix!**
```javascript
// WRONG - causes 404 error
model: "gemini-3-pro"     // NOT VALID!
model: "gemini-3-flash"   // NOT VALID!

// CORRECT - include -preview suffix
model: "gemini-3-pro-preview"
model: "gemini-3-flash-preview"
```

**CRITICAL: Thinking uses tokens from maxOutputTokens budget!**
```javascript
// WRONG - causes "MAX_TOKENS, parts: 0" (thinking consumed all tokens)
{
  thinkingConfig: { thinkingLevel: "HIGH" },
  maxOutputTokens: 2048  // TOO LOW with HIGH thinking!
}

// CORRECT - use 8192+ when thinking is HIGH
{
  thinkingConfig: { thinkingLevel: "HIGH" },
  maxOutputTokens: 8192  // Enough for thinking + response
}

// Alternative: Use LOW thinking for simpler tasks
{
  thinkingConfig: { thinkingLevel: "LOW" },
  maxOutputTokens: 2048  // OK with LOW thinking
}
```

**CORRECT:**
```javascript
{
  model: "gemini-3-pro-preview",  // NOTE: Must include -preview suffix!
  contents: [...],
  generationConfig: {
    thinkingConfig: {
      thinkingLevel: "HIGH"    // Must be nested in thinkingConfig
      // IMPORTANT: Gemini 3 Pro only supports LOW or HIGH (MEDIUM is Flash-only!)
    },
    responseMimeType: "application/json"  // For structured outputs
  },
  tools: [{ google_search: {} }]  // For real-time data
  // NOTE: Do NOT include safetySettings - see below
}
```

**WRONG (causes errors):**
```javascript
{
  thinking_budget: 8000,    // DEPRECATED - doesn't work
  thinking_level: "high",   // WRONG - must be nested in thinkingConfig
}
```

**CRITICAL: Include ALL safetySettings categories with BLOCK_NONE**

When using Gemini, you MUST include ALL 5 safety categories with `BLOCK_NONE` to prevent failures on sensitive content (e.g., traffic incidents with injuries):

```javascript
// CORRECT - ALL categories with BLOCK_NONE
safetySettings: [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
]

// WRONG - missing categories will still block content
safetySettings: [
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
]
```

### Claude Sonnet 4.5 (Anthropic)

**CORRECT:**
```javascript
{
  model: "claude-sonnet-4-5-20250929",
  messages: [...],
  max_tokens: 64000,
  temperature: 0.7,
  system: "..."
}
```

---

## Database & Schema

### Snapshot-Centric Architecture

All data MUST link to `snapshot_id`:
- `strategies.snapshot_id` -> AI outputs
- `briefings.snapshot_id` -> Real-time data
- `rankings.snapshot_id` -> Venue sessions
- `ranking_candidates.snapshot_id` -> Individual venues
- `actions.snapshot_id` -> User behavior

**Why?** Enables ML training by correlating all data points to a moment in time.

### Coords Cache (coords_cache table)

**Purpose:** Eliminate duplicate Google API calls

**How it works:**
1. Round coordinates to 6 decimals (~11cm precision) for cache key
2. Store full 6 decimal precision for consistency
3. On cache hit: Return cached city/state/timezone (skip API calls)
4. On cache miss: Call Google APIs, store result

**Saves:** ~$0.005 per repeat lookup

**FIXED (Jan 2026):** snapshot.js was using 4-decimal precision while location.js used 6-decimal. This caused cache misses. Now both use 6-decimal precision for consistent cache hits.

### Global Markets Table (markets table)

**Purpose:** Skip Google Timezone API for known rideshare markets

**How it works:**
1. lookupMarketTimezone() checks markets table BEFORE calling Google API
2. Matches city via primary_city or city_aliases (3,333 suburbs/neighborhoods)
3. Returns pre-stored IANA timezone if found

**Coverage:** 140 markets (69 US + 71 international) with 67 US airport codes

**Saves:** ~200-300ms + $0.005 per request for known markets

### Common Schema Mistakes

1. **Not adding indexes** - Always index foreign keys and frequently queried columns
2. **Using wrong types** - Use JSONB for complex objects, not TEXT
3. **Missing timestamps** - Always include `created_at`, `updated_at`

---

## Frontend Pitfalls

### Context Provider Value Not Memoized (2026-01-06) - CRITICAL

**Problem:** "Maximum update depth exceeded" errors causing infinite render loops and app freeze

**Root Cause:**
```jsx
// WRONG - Creates new object on every render
<LocationContext.Provider
  value={{
    currentCoords,
    city,
    state,
    ...
  }}
>
```

Every render creates a new object reference for `value`. All context consumers detect "change" (different object reference) and re-render. If any consumer triggers state that causes the provider to re-render, you get an infinite loop.

**Fix:**
```jsx
// CORRECT - Memoize the value object
const contextValue = useMemo(() => ({
  currentCoords,
  city,
  state,
  ...
}), [currentCoords, city, state, ...]);

<LocationContext.Provider value={contextValue}>
```

**Files Changed:**
- `client/src/contexts/location-context-clean.tsx` - Added useMemo for context value

**Why this didn't affect CoPilotContext initially:**
CoPilotContext already had `useMemo` (line 460). LocationContext was missing it.

**UPDATE 2026-01-06:** CoPilotContext WAS affected - see "Derived Values in useMemo Dependencies" below.

### Derived Values in useMemo Dependencies (2026-01-06) - CRITICAL

**Problem:** "Maximum update depth exceeded" errors even though context value was memoized with `useMemo`

**Root Cause:** A derived value using `.map()` was in the `useMemo` dependency array:

```javascript
// WRONG - .map() creates NEW array on every render
const blocks = (blocksData?.blocks || []).map(block => {
  // ... transform block ...
  return block;
});

// Even with useMemo, `blocks` changes reference every render!
const value = useMemo(() => ({
  blocks,  // NEW reference every render → useMemo recalculates
  // ...
}), [blocks, ...]);  // blocks is "different" every time → infinite loop
```

**Why this happens:**
1. `.map()` ALWAYS returns a new array reference, even if contents are identical
2. React's dependency comparison uses `Object.is()` which checks reference equality
3. New reference → useMemo runs → new context value → consumers re-render → repeat

**Fix:** Wrap derived values in their own `useMemo`:

```javascript
// CORRECT - Memoize the derived value too
const blocks = useMemo(() => {
  return (blocksData?.blocks || []).map(block => {
    // ... transform block ...
    return block;
  });
}, [blocksData?.blocks, enrichedReasonings]);  // Only recalc when source data changes

const value = useMemo(() => ({
  blocks,  // Now stable reference!
  // ...
}), [blocks, ...]);
```

**Files Changed:**
- `client/src/contexts/co-pilot-context.tsx` - Added useMemo for `blocks` array (line 413-424)

**Key Insight:** Having `useMemo` on the context value is necessary but not sufficient. ALL array/object values in the dependency array must ALSO be memoized to prevent false "change" detections.

### Excessive Console Logs in Components (2026-01-06)

**Problem:** BriefingPage had hundreds of console.log entries in browser, making debugging difficult and slowing performance

**Root Cause:**
- Debug `console.log()` statements inside the component body run on EVERY render
- React Query causes re-renders when data updates (even if unchanged)
- Each re-render triggered logs like `[BriefingPage] 📊 Data status: {...}`

**Why it happened:**
- Debug logs added during development were never removed
- Inline object creation in logs (e.g., `{ traffic: ... }`) creates new objects every render
- Using `useCoPilot()` for only one value still subscribes to entire context

**Fix:**
1. Move debug logs to `useEffect` with proper dependencies
2. Use refs to track previous values and only log when they actually change
3. Wrap page component in `React.memo()` to prevent parent re-renders from cascading

**Pattern to follow:**
```typescript
// WRONG - logs on every render
function Page() {
  console.log('[Page] rendering', data);  // ❌ Fires hundreds of times
  return <div>...</div>;
}

// CORRECT - logs only when value changes
function Page() {
  const prevDataRef = useRef(null);
  useEffect(() => {
    if (data !== prevDataRef.current) {
      prevDataRef.current = data;
      console.log('[Page] data changed:', data);  // ✅ Fires once per change
    }
  }, [data]);
  return <div>...</div>;
}
export default memo(Page);  // ✅ Prevent parent re-renders
```

**Files Changed:**
- `client/src/pages/co-pilot/BriefingPage.tsx`: Removed inline logs, added effect-based logging, wrapped in memo

### Duplicate GPS Enrichment (Issue #6)

**Problem:** App calls location API twice on load

**Root Cause:**
- `useEffect` triggers on `coords` dependency
- `refreshGPS()` updates coords on mount
- Updated coords trigger useEffect again

**Fix:** Add `isInitialMount` ref to skip duplicate enrichment

### Duplicate Snapshot Creation (Issue #7)

**Problem:** Two snapshots created in rapid succession

**Root Cause:** Same as Issue #6 - duplicate enrichment creates duplicate snapshots

**Impact:**
- Wasted AI calls (first waterfall abandoned)
- Higher API costs
- Confusing UI state

### Auth Token Key Mismatch (Dec 2025)

**Problem:** AI Coach chat returning "unauthorized - invalid or expired token" in production

**Root Cause:**
- `auth-context.tsx` stores tokens with key: `vectopilot_auth_token`
- `CoachChat.tsx`, `GlobalHeader.tsx`, `co-pilot-helpers.ts` were reading from: `vecto_auth_token`
- The keys are similar but NOT the same - easy typo to miss

**Why it worked in dev but failed in prod:**
- Dev environments may have had both keys populated from earlier testing
- Production users only have tokens from the login flow (correct key)
- Reading from wrong key returned `null` or old invalid token

**Fix:** Ensure ALL components use the same token key: `vectopilot_auth_token`

**Prevention:**
- Export `TOKEN_KEY` constant from auth-context and import it everywhere
- Never hardcode localStorage keys - use a central constant

### localStorage Behavior & Strategy Persistence (2026-01-06 P3-A Fix)

**Current Behavior:**
- Strategy data persists across sessions
- Clears only on manual refresh or snapshot ID change

**Previous Bug (Fixed 2026-01-06):** Strategy cleared on every mount in TWO places:
1. `useStrategyPolling.ts` - `useEffect(() => { localStorage.removeItem(...) }, [])`
2. `co-pilot-context.tsx` - `if (prevSnapshotIdRef.current === null) { localStorage.removeItem(...) }`

**Why This Was Bad:**
- User switches to Uber/Lyft app → returns → component remounts → strategy clears → 35-50s regeneration
- OS kills tab for memory → user reopens → full reload → strategy clears → regeneration
- The original "fix" for 49-min-old strategies was too aggressive (blanket clear instead of TTL check)

**The Correct Approach:**
- Only clear on: manual refresh, snapshot ID change, or logout
- On mount: restore from localStorage IF stored snapshotId matches current snapshotId
- If snapshotId differs, the snapshot-change effect handles the clear

**Key Insight:** A 10-minute-old strategy is FINE if the snapshot hasn't changed. Same snapshot = same driver position + time context.

### Snapshot Ownership Error Cooling Off (2026-01-06)

**Problem:** Briefing tab shows blank data for 60 seconds after an ownership error, even after a new valid snapshot is created

**Root Cause:**
1. When a 404 ownership error occurs, `useBriefingQueries` enters a 60-second "cooling off" state
2. The cooling off was designed to prevent infinite refresh loops
3. BUT when LocationContext triggers a GPS refresh and creates a NEW snapshot, the cooling off doesn't exit early
4. Result: Queries remain disabled for the full 60 seconds, showing blank briefing data

**Why the ownership error happens:**
- Snapshot belongs to a different user (e.g., after re-login with different account)
- Session expired and user re-authenticated with a fresh session
- Client has stale snapshot ID cached from before the session change

**Solution:**
1. Track which snapshot ID caused the cooling off error (`coolingOffSnapshotId`)
2. Listen for `vecto-snapshot-saved` events (fired when new snapshot is created)
3. When a NEW (different) snapshot arrives, exit cooling off immediately
4. Continue normal 60-second timeout if same snapshot or no new snapshot

**Code Pattern:**
```typescript
// Track which snapshot caused cooling off
let coolingOffSnapshotId: string | null = null;

// Exit early when new snapshot arrives
function exitCoolingOffForNewSnapshot(newSnapshotId: string) {
  if (!isInCoolingOff) return;
  if (newSnapshotId === coolingOffSnapshotId) return; // Same snapshot, don't exit

  // Different snapshot = problem is resolved
  isInCoolingOff = false;
  coolingOffSnapshotId = null;
}
```

**Files Changed:**
- `client/src/hooks/useBriefingQueries.ts`: Added early exit from cooling off when new snapshot arrives

### Auth Loop on Login (2026-01-07) - CRITICAL

**Problem:** User signs in successfully, app loads briefly, then immediately redirects back to sign-in page

**Actual Root Cause (FOUND 2026-01-07):** The Location API (`server/api/location/location.js`) was **overwriting session_id with null** in the users table!

```javascript
// THE BUG (lines 547-550, 847):
const sessionId = req.query.session_id || null;  // ← Defaults to NULL
// ...
await db.update(users).set({
  session_id: sessionId,  // ← OVERWRITES auth session with NULL!
  // ...
});
```

**Why this killed the session:**
1. Login creates new session → `session_id = 4e9f3e34`
2. Location API runs → takes session_id from query params → **null** (not provided)
3. Location API updates users table → `session_id = null` (overwrites login's value!)
4. All subsequent requests → requireAuth checks session_id → finds null → returns 401
5. Client receives 401 → dispatches auth error → logout → redirect to sign-in

**The Fix:** Remove `session_id` from Location API's users table updates. `session_id` must only be managed by:
- Login endpoint (sets new UUID)
- Logout endpoint (sets null)
- Auth middleware TTL checks (sets null on expiry)

**Contributing Factor (client-side):** Session restore in LocationContext ran BEFORE auth finished loading and set `isLocationResolved = true`, which gates downstream queries. The queries fired while auth was still loading → got 401 → dispatched auth error → logout → redirect to sign-in.

**The Race Condition:**
```
1. Login succeeds → token stored in localStorage
2. Navigate to main app → providers mount fresh
3. AuthProvider: isLoading: true, calls fetchProfile(token) [async]
4. LocationProvider: restore effect runs IMMEDIATELY ([] deps, not gated on auth)
5. Restore sets isLocationResolved = true  ← BUG
6. Briefing queries see valid snapshotId → fire request
7. Auth hasn't finished loading → isAuthenticated still false
8. getAuthHeader() reads token from localStorage → MIGHT work
9. If anything returns 401 → dispatchAuthError() → logout → back to sign-in
```

**Why This is Wrong:**
- Session restore effect has empty deps `[]` so it runs before ANY other effect
- `isLocationResolved` gates downstream API queries (bars, briefing, etc.)
- Setting it during restore enabled queries before auth context was ready
- Even if token exists in localStorage, auth state (`isLoading`, `isAuthenticated`, `user`) wasn't populated

**Fix (Three parts):**

1. **Don't set `isLocationResolved` during restore** - only restore display data (city, weather, etc.)
   ```typescript
   // WRONG - runs before auth loads
   useEffect(() => {
     // restore from sessionStorage...
     if (data.snapshotId && data.city) {
       setIsLocationResolved(true);  // ← Triggers queries too early!
     }
   }, []);  // Empty deps = runs immediately
   ```

2. **Set `isLocationResolved` in the auth-gated GPS effect** - this only runs after auth is verified
   ```typescript
   // CORRECT - waits for auth to complete
   useEffect(() => {
     if (authLoading) return;  // Wait for auth
     if (!user?.userId || !token) return;  // Require authenticated user

     if (lastSnapshotId && currentCoords && city) {
       // Auth is verified, now safe to enable queries
       setIsLocationResolved(true);
       // Dispatch event with reason: 'resume'
       window.dispatchEvent(new CustomEvent('vecto-snapshot-saved', {
         detail: { snapshotId: lastSnapshotId, ..., reason: 'resume' }
       }));
     }
   }, [authLoading, user?.userId, token, lastSnapshotId, ...]);
   ```

3. **CRITICAL: Use ref pattern for callbacks in effects** - avoid stale closures WITHOUT infinite loops
   ```typescript
   // WRONG v1 - refreshGPS is captured once, never updated → stale closure
   useEffect(() => {
     refreshGPS(false);  // Uses stale enrichLocation with null token!
   }, [authLoading, user?.userId, token]);  // ← Missing refreshGPS

   // WRONG v2 - Adding refreshGPS to deps causes INFINITE LOOP!
   // refreshGPS → enrichLocation → token changes → refreshGPS recreated → effect re-runs → loop
   useEffect(() => {
     refreshGPS(false);
   }, [authLoading, user?.userId, token, refreshGPS]);  // ← Causes Maximum update depth exceeded!

   // CORRECT - Use ref pattern: ref is kept in sync separately
   const refreshGPSRef = useRef<(force?: boolean) => Promise<void>>();

   // Keep ref always pointing to latest refreshGPS
   useEffect(() => {
     refreshGPSRef.current = refreshGPS;
   }, [refreshGPS]);

   // Use ref to call latest version without adding to deps
   useEffect(() => {
     if (authLoading) return;
     if (!user?.userId || !token) return;
     refreshGPSRef.current?.(false);  // Always calls latest version
   }, [authLoading, user?.userId, token]);  // ← No refreshGPS = no infinite loop
   ```

   **Why the ref pattern works:**
   - The sync effect (`refreshGPSRef.current = refreshGPS`) runs whenever refreshGPS changes
   - The GPS effect uses `refreshGPSRef.current` which is always the latest
   - But `refreshGPSRef` itself never changes (refs are stable) so no infinite loop

   **Why adding refreshGPS to deps causes infinite loop:**
   - `token` loads → `enrichLocation` recreates (token in deps)
   - `enrichLocation` changes → `refreshGPS` recreates (enrichLocation in deps)
   - `refreshGPS` changes → GPS effect re-runs
   - Effect calls `refreshGPS()` → state updates → renders
   - Rinse and repeat = Maximum update depth exceeded

**Key Insight:** Context restore effects with empty deps run BEFORE auth loads. Any flags that gate API queries must only be set in effects that are gated on auth state (`!authLoading && user && token`).

**Pattern to Follow:**
- Restore: Only restore DISPLAY state (city, weather, coords) for immediate UI rendering
- API Queries: Gate on both data (`snapshotId`) AND auth (`!authLoading && user`)
- If you need to gate queries on a flag, only set that flag after auth is verified

**Files Changed:**
- `server/api/location/location.js` (THE ACTUAL FIX):
  - **Removed `session_id: sessionId` from users table UPDATE** (line 847)
  - **Removed `session_id: sessionId` from users table INSERT** (line 896)
  - Session_id must only be managed by login/logout/auth middleware, NOT location API
- `client/src/contexts/co-pilot-context.tsx` (infinite loop fix):
  - **Fixed inline object creation causing infinite loop** (line 466)
  - Changed `coords: coords ? { latitude: ..., longitude: ... } : null` to `coords: coords`
  - Creating new objects inline in hook calls breaks React's reference comparison
- `client/src/contexts/location-context-clean.tsx` (contributing fix):
  - Removed `setIsLocationResolved(true)` from restore effect
  - Added proper resume handling in auth-gated GPS effect
  - Added `refreshGPSRef` ref pattern to avoid both stale closures AND infinite loops
  - Added safeguard in `enrichLocation` to abort if called without auth

### React Query Patterns

**CORRECT:**
```typescript
const { data } = useQuery({
  queryKey: ['strategy', snapshotId],
  queryFn: () => fetchStrategy(snapshotId),
  enabled: !!snapshotId,  // Don't fetch without ID
});
```

**WRONG:**
```typescript
// Missing enabled check - causes premature fetches
const { data } = useQuery({
  queryKey: ['strategy', snapshotId],
  queryFn: () => fetchStrategy(snapshotId),
});
```

### Progress Bar Accuracy (Dec 2025)

**Problem:** Progress bar was stuck at 55% during strategy generation

**Root Cause:**
- Hardcoded phase-to-percentage mapping (e.g., `immediate: 55%`)
- No sub-phase progress tracking
- 3-second polling interval meant progress only updated on phase changes

**Solution:** Dynamic time-based progress calculation:
1. Backend tracks `phase_started_at` timestamp in `strategies` table
2. Backend returns `timing` metadata in polling response:
   - `phase_started_at`: When current phase started
   - `phase_elapsed_ms`: How long current phase has been running
   - `expected_durations`: Expected time for each phase
3. Frontend calculates progress based on:
   - Completed phases (sum of their expected durations)
   - Current phase progress (elapsed / expected, capped at 95%)
4. Frontend updates locally every 500ms for smooth progress animation
5. Time remaining displayed (e.g., "~30 seconds remaining")

**Files Changed:**
- `server/lib/strategy/strategy-utils.js`: Added `PHASE_EXPECTED_DURATIONS`, `phase_started_at` tracking
- `server/api/strategy/content-blocks.js`: Returns `timing` metadata in response
- `server/api/briefing/events.js`: Added `phaseEmitter` for SSE phase_change events
- `client/src/hooks/useEnrichmentProgress.ts`: Dynamic progress calculation
- `client/src/hooks/useStrategyLoadingMessages.ts`: Added `timeRemaining` output
- `client/src/pages/co-pilot.tsx`: Displays time remaining in UI

### Location Race Condition (Issue Dec 2025)

**Problem:** Bar Tab venues showing "Unknown" city because query fires before location resolved

**Root Cause:**
- GPS coords available immediately from browser
- `locationContext.city` populated AFTER `/api/location/resolve` completes
- Query `enabled` checked only `coords.latitude/longitude`, not city
- `coords` type is `{latitude, longitude}` only - city/state are SEPARATE context properties

**Fix (Two-part):**
1. **Client:** Use `isLocationResolved` flag to gate downstream queries
   ```typescript
   enabled: !!(coords?.latitude && coords?.longitude && locationContext?.isLocationResolved)
   ```
2. **Server:** Add users table lookup BEFORE coords_cache to reuse resolved addresses
   - If same device_id + coords within 100m → return cached city/state (no API call)
   - Users table = source of truth for resolved location identity

**Key Insight:** Don't access `coords.city` - it doesn't exist. Use `locationContext.city` instead.

### SSE Duplicate Broadcasts (Issue Dec 2025)

**Problem:** Loading bar keeps flashing, UI receives same SSE event multiple times (23x observed in prod)

**Root Cause (TWO issues):**

1. **Client-side:** Each call to `subscribeBriefingReady()` created a NEW `EventSource` connection
2. **Server-side:** Each SSE endpoint added its own `dbClient.on('notification', handler)` to the SAME shared PostgreSQL client - 23 connections = 23 handlers all firing for ONE notification

**Fix 1 - Client Singleton:**
```typescript
// client/src/utils/co-pilot-helpers.ts
const sseConnections: Map<string, SSESubscription> = new Map();

function subscribeSSE(endpoint, eventName, callback) {
  let sub = sseConnections.get(key);
  if (!sub) {
    sub = { eventSource: new EventSource(endpoint), subscribers: new Set() };
    sseConnections.set(key, sub);
  }
  sub.subscribers.add(callback);
  return () => { /* unsubscribe logic */ };
}
```

**Fix 2 - Server Notification Dispatcher:**
```javascript
// server/db/db-client.js
const channelSubscribers = new Map(); // channel -> Set of callbacks
let notificationHandlerAttached = false;

export async function subscribeToChannel(channel, callback) {
  // ONE LISTEN per channel, ONE notification handler total
  if (!channelSubscribers.has(channel)) {
    await client.query(`LISTEN ${channel}`);
  }
  channelSubscribers.get(channel).add(callback);

  // Single handler dispatches to all subscribers
  if (!notificationHandlerAttached) {
    client.on('notification', (msg) => {
      channelSubscribers.get(msg.channel)?.forEach(cb => cb(msg.payload));
    });
    notificationHandlerAttached = true;
  }
  return async () => { /* unsubscribe logic */ };
}
```

**Key Insights:**
1. SSE connections should be singletons at both client AND server levels
2. PostgreSQL LISTEN/NOTIFY sends ONE notification, but having N handlers on one client = N callbacks
3. Use a dispatcher pattern: ONE listener, dispatch to N subscribers

**Files Changed:**
- `client/src/utils/co-pilot-helpers.ts`: Client singleton SSE manager
- `server/db/db-client.js`: Server notification dispatcher (`subscribeToChannel`)
- `server/api/strategy/strategy-events.js`: Use dispatcher instead of direct handlers

---

## Backend Patterns

### Model Adapter Pattern

**Always use:**
```javascript
import { callModel } from './adapters/index.js';

const result = await callModel('strategist', {
  system: 'Your system prompt',
  user: 'User message'
});
```

**Never call APIs directly** - The adapter handles:
- Model selection from environment
- Parameter normalization
- Error handling
- Provider-specific quirks

### Strategy Waterfall Order

```
1. Parallel: minstrategy + briefing + holiday_checker
2. Sequential: consolidator (needs briefing data)
3. Sequential: immediate strategy (needs consolidated)
4. Sequential: venue_planner (needs strategy context)
```

**Why sequential after parallel?** Each phase needs outputs from previous phase.

### Error Handling Pattern

```javascript
try {
  const result = await callModel('briefer', { system, user });
  if (!result.ok) {
    console.error(`[briefer] Failed: ${result.error}`);
    return { ok: false, error: result.error };
  }
  return { ok: true, output: result.output };
} catch (error) {
  console.error(`[briefer] Exception:`, error);
  return { ok: false, error: error.message };
}
```

---

## File Organization

### Files That ARE Used (Do Not Delete)

- `client/src/contexts/location-context-clean.tsx` - Main location provider
- `server/lib/ai/adapters/index.js` - Model dispatcher
- `strategy-generator.js` (root) - Worker process spawned by gateway
- `server/lib/drizzle-lazy.js` - Used by chat-context.js

### Files That Were Deleted (Redundant)

**Client hooks (deleted):**
- `useGeoPosition.ts` - Replaced by location-context-clean
- `use-geolocation.tsx` - Duplicate
- `use-enhanced-geolocation.tsx` - Duplicate

**Client utils (deleted):**
- `buildPrompt.ts`, `buildContext.ts` - Never used
- `tripStateManager.ts`, `gpsManager.ts` - Replaced

**Server lib (deleted):**
- `perplexity-adapter.js` - Perplexity calls removed
- `venue-discovery.js`, `venue-event-research.js` - Replaced by briefing-service
- `model-retry.js`, `transient-retry.js` - Built into adapters now

### Check Before Creating New Files

1. Search for existing implementation: `grep -r "functionName" server/`
2. Check if similar file exists: `ls server/lib/ | grep keyword`
3. Review LEXICON.md for existing patterns

---

## Common Bugs & Fixes

### Bug: "Cannot reach database"

**Causes:**
1. `DATABASE_URL` not set
2. Network connectivity issues
3. SSL required but not configured

**Fix:**
```bash
# Add SSL for external databases
DATABASE_URL=postgresql://...?sslmode=require
```

### Bug: "Connection pool exhausted"

**Cause:** Too many instances with too many connections

**Fix:**
```bash
# For autoscale deployments
PG_MAX=2        # Fewer connections per instance
PG_MIN=0
PG_IDLE_TIMEOUT_MS=30000
```

### Bug: "500 Internal Server Error" from type mismatch in DB writes

**Cause:** Writing a STRING to an INTEGER column (e.g., `error_code: 'immediate_failed'` when `error_code` is INTEGER)

**Symptoms:**
- Server crashes with 500 error
- PostgreSQL error: `invalid input syntax for type integer: "some_string"`
- Hard to debug because the error message doesn't mention the column name

**Fix:**
1. Check the schema (`shared/schema.js`) for column types
2. `error_code` is INTEGER - use `error_message` (TEXT) for string details
3. Pattern: `error_message: \`prefix: ${error.message}\`.slice(0, 500)`

**Example (WRONG):**
```javascript
await db.update(strategies).set({
  error_code: 'immediate_failed',  // BAD: error_code is INTEGER!
});
```

**Example (CORRECT):**
```javascript
await db.update(strategies).set({
  error_message: `immediate_failed: ${error.message}`.slice(0, 500),
});
```

### Bug: Login/Logout/Session Expiry destroys all user data (CASCADE DELETE → RESTRICT blocks)

**Added: 2026-01-05, Updated: 2026-01-06**

**Symptom (original):** User signs up successfully, logs in, but subsequent requests fail with "No session found". Database shows 0 profiles, 0 credentials.

**Symptom (2026-01-06):** Session expiry (2-hour limit or 60-min inactivity) logs error but user is NOT signed out:
```
🔑 [AUTH 1/1] ⚠️ Session exceeded 2-hour limit for user 9216b521 - deleting
[auth] Session check failed: Failed query: delete from "users" where "users"."user_id" = $1
```

**Root Cause (original - CASCADE):** The schema had CASCADE delete rules on foreign keys, so DELETE from users destroyed all related data.

**Root Cause (2026-01-06 - RESTRICT):** Schema was changed from CASCADE to RESTRICT to prevent data loss:
```sql
driver_profiles.user_id → users.user_id → RESTRICT
auth_credentials.user_id → users.user_id → RESTRICT
coach_conversations.user_id → users.user_id → RESTRICT
news_deactivations.user_id → users.user_id → RESTRICT
```

The auth middleware session expiry code STILL tried to DELETE, but PostgreSQL blocked it due to RESTRICT. The error was caught silently and the request continued as authenticated!

**Location:** `server/middleware/auth.js` lines 89, 96 (before fix)

**Fix:** Use UPDATE to clear session fields instead of DELETE:
```javascript
// Login: Check if users row exists, UPDATE if yes, INSERT if no
const existingUser = await db.query.users.findFirst({...});
if (existingUser) {
  await db.update(users).set({...}).where(eq(users.user_id, profile.user_id));
} else {
  await db.insert(users).values({...});
}

// Logout AND Session Expiry: Clear session instead of DELETE
await db.update(users).set({
  session_id: null,
  current_snapshot_id: null,
  updated_at: new Date()
});
```

**Also check:** If session_id is null (logged out), return 401 to require re-login.

**Key Lesson:**
1. Always check FK constraints (CASCADE/RESTRICT) in schema before DELETE operations
2. When FK rules change, audit ALL code paths that might delete from that table
3. Catch blocks that "allow request to proceed" on DB errors can mask critical bugs

---

### Bug: Events not showing on Briefing tab (timezone parsing)

**Added: 2026-01-06**

**Symptom:** Events exist in `discovered_events` table and show in AI Coach/Strategy, but the `/api/briefing/events/:snapshotId` endpoint returns 0 events (or fewer than expected).

**Root Cause:** The `getEventEndTime()` function had two issues:
1. Didn't look for `event_end_time` field (the actual field name in `discovered_events`)
2. When parsing `event_end_date: "2026-01-06"`, JavaScript's `new Date("2026-01-06")` returns **midnight UTC**
3. In Central Time, midnight UTC = 6:00 PM **previous day**
4. Events appeared "stale" (ended in the past) even though they hadn't happened yet!

**Location:** `server/lib/strategy/strategy-utils.js` - `getEventEndTime()` function

**Fix:** Updated `getEventEndTime()` to:
1. Accept a `timezone` parameter like `getEventStartTime()` does
2. Properly combine `event_end_date` + `event_end_time` with timezone conversion
3. For date-only fields, use 11:59 PM in the event timezone (end of day) not midnight UTC
4. Handle single-day events with `event_date` + `event_end_time` (no `event_end_date`)

**Key Lesson:**
1. **NEVER use `new Date("YYYY-MM-DD")`** for date-only strings - it returns midnight UTC
2. When filtering events by time, always use the event's timezone, not server time
3. When adding time filtering, test with events in different timezones than the server

---

### Bug: "401 Unauthorized" from AI APIs

**Causes:**
1. API key expired
2. Wrong key format
3. Rate limited

**Fix:** Check each API key individually:
```bash
# Test OpenAI
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
  https://api.openai.com/v1/models

# Test Anthropic
curl -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  https://api.anthropic.com/v1/messages
```

### Bug: SmartBlocks stuck in "limbo"

**Cause:** Strategy complete but rankings missing

**Fix:** Gate 2 in blocks-fast.js auto-triggers generation when detected

### Bug: Gemini not using Google Search

**Cause:** Missing `tools` parameter

**Fix:**
```javascript
{
  tools: [{ google_search: {} }],  // Must explicitly enable
  // ...
}
```

**Verify:** Check `groundingMetadata` in response

### Bug: AI Coach event deactivation silently failing

**Cause:** Interface mismatch between chat.js and coach-dal.js

The AI Coach emits:
```
[DEACTIVATE_EVENT: {"event_title": "Event Name", "reason": "outdated"}]
```

chat.js passes `event_title` but coach-dal.js expected `event_id`. Since no `event_id` was provided, deactivations silently returned null.

**Symptoms:**
- Events marked as outdated by AI Coach still appear after refresh
- Console logs show: `[CoachDAL] deactivateEvent: missing required fields`
- No error returned to user

**Fix (2026-01-02):** Updated `coachDAL.deactivateEvent()` to support title-based lookup:
1. Accepts both `event_id` and `event_title` parameters
2. If only `event_title` provided, searches active events for matching title
3. Uses exact match first, then partial match fallback
4. Once found, sets `is_active = false` on the discovered_events table

**Note:** News deactivation uses a different approach (hash-based matching via `news_deactivations` table) because news is regenerated by AI each time. Events use in-place deactivation because they persist in `discovered_events`.

### Bug: AI Coach doesn't know the user's current date/time

**Cause:** The Coach received no date/time context, leading to incorrect assumptions about whether events have ended.

**Symptoms:**
- Coach deactivates events that haven't happened yet
- Coach says "that event was yesterday" when it's actually today
- Date confusion when user is in a different timezone than the server

**Example:** User in America/Chicago at 11:45 PM on Jan 1st. Server runs in UTC where it's already Jan 2nd. Coach thinks it's Jan 2nd and deactivates events that are "today" for the user.

**Fix (2026-01-02):**
1. Extract user's timezone from `clientSnapshot.timezone` in the request body
2. Compute user's local date/time using `Intl.DateTimeFormat` with their timezone
3. Add it prominently to the system prompt:
   ```
   **⏰ CURRENT DATE & TIME (User's Local Time):**
   **Wednesday, January 1, 2026 at 11:45 PM** (America/Chicago)
   ```
4. Added `[REACTIVATE_EVENT: {...}]` action for undoing mistaken deactivations

**Key insight:** Always compute user-facing times in the USER's timezone, not the server's. The client already sends `snapshot.timezone` from GPS resolution - use it!

### Bug: UI not showing strategy text (blocks appear but no strategy)

**Cause:** API response missing `strategy` object

**Symptom:** SmartBlocks (venues) display correctly but strategy text area is empty

**Fix:** Ensure all success paths in `blocks-fast.js` include the strategy object:
```javascript
return res.json({
  status: 'ok',
  blocks: [...],
  strategy: {
    strategy_for_now: strategyRow?.strategy_for_now || '',
    consolidated: strategyRow?.consolidated_strategy || '',
    min: strategyRow?.minstrategy || ''
  }
});
```

**Lesson:** API endpoints must return consistent response shapes. When adding new data to responses, update ALL success paths, not just the main one.

### Bug: Venues showing "Open Now" when closed (or vice versa)

**Cause:** Stale `isOpen` value from server-side calculation

**Symptoms:**
- Venue shows "Open Now" but hours are "5:00 PM - 2:00 AM" and it's 10 AM
- Open/closed status doesn't match displayed business hours

**Root Cause:** The server calculates `isOpen` once during venue enrichment (`venue-enrichment.js`). If user views the strategy hours later, the cached value is stale.

**Fix (implemented):**
1. **Server** (`blocks-fast.js`): Access `isOpen` from correct path:
   ```javascript
   isOpen: c.features?.isOpen,  // ✓ Correct - features JSONB column
   // NOT: c.business_hours?.isOpen  // ✗ Wrong - business_hours is a string
   ```

2. **Client** (`BarsTable.tsx`): Real-time recalculation:
   ```typescript
   const isOpen = calculateIsOpenNow(todayHours) ?? bar.isOpen;
   ```

**Lesson:** Time-sensitive status values should be calculated client-side using the user's current time, not cached from server-side generation. The `businessHours` string provides the data; the client calculates the current state.

### Bug: Progress bar stuck at 63% then jumps to 100% (Dec 2025)

**Cause:** Expected phase durations didn't match actual pipeline timing

**Root Cause:**
- The `venues` phase (GPT-5.2 tactical planner) takes 20-30 seconds
- But expected duration was set to 4000ms
- Progress calculation was: `completedDuration / totalDuration`
- At 63%, the bar was at end of 'immediate' phase, waiting for 'venues'
- When 'venues' finally completed after 25s, progress jumped to 100%

**Fix:** Update expected durations to match reality:
```javascript
// OLD (wrong)
venues: 4000,    // GPT-5.2 venue planner

// NEW (correct)
venues: 25000,   // GPT-5.2 tactical planner - SLOWEST step (20-30s)
verifying: 12000, // Gemini verification (was 4000)
routing: 3000,   // Routes API (was 5000)
places: 2000,    // Places lookup (was 6000)
```

**Files Changed:**
- `client/src/hooks/useEnrichmentProgress.ts`: Updated DEFAULT_EXPECTED_DURATIONS
- `server/lib/strategy/strategy-utils.js`: Updated PHASE_EXPECTED_DURATIONS

**Lesson:** Progress bar durations must be tuned to actual pipeline timings. The GPT-5.2 tactical planner is the slowest step (~25s), not the enrichment APIs (~5s total).

### Bug: ZodError action validation failing (Dec 2025)

**Cause:** Client sending action types not in validation schema

**Symptoms:**
```
[validation] ZodError: action=Invalid option: expected one of "view"|"dwell"|"click"...
```

**Root Cause:** The action validation schema only had 6 action types, but client sends 15+:
- `blocks_viewed`, `block_dwell`, `block_selected`, `block_deselected`
- `navigate_google_maps`, `navigate_apple_maps`
- `strategy_viewed`, `feedback_submitted`, `refresh_requested`

**Fix:** Add all client action types to `server/middleware/validation.js`:
```javascript
action: z.enum([
  'view', 'dwell', 'click', 'block_clicked', 'dismiss', 'navigate',
  'blocks_viewed', 'block_dwell', 'block_selected', 'block_deselected',
  'navigate_google_maps', 'navigate_apple_maps', 'strategy_viewed',
  'feedback_submitted', 'refresh_requested'
]).nullish(),
```

**Lesson:** When adding new client analytics events (logAction), remember to add them to the server validation schema too.

### Bug: No model configured for role: haiku (Dec 2025)

**Cause:** `venue-intelligence.js` calls `callModel('haiku')` but `STRATEGY_HAIKU` env var not set

**Fix:** Add to environment:
```bash
STRATEGY_HAIKU=claude-3-5-haiku-20241022
```

**Lesson:** When adding a new model role in code, always add the corresponding `STRATEGY_*` environment variable.

### Feature: Event Deduplication for Discovery (Dec 2025)

**Problem:** Discovered events table accumulated 15+ variations of same event:
- "Christmas in the Square"
- "Christmas in the Square (lights show)"
- "Christmas in the Square (daily)"

**Solution:** Semantic deduplication via GPT-5.2:
1. Before discovery, fetch existing events from DB
2. Pass existing events to LLM prompt
3. Ask LLM to skip events that are semantically the same

**Key Code (`sync-events.mjs`):**
```javascript
const existingEvents = await fetchExistingEvents(db, city, state, startDate, endDate);
const prompt = buildEventPrompt(city, state, date, lat, lng, existingEvents);
```

**Deduplication Rules in Prompt:**
- Same venue + date + event type (different wording) = DUPLICATE
- Same venue + date + DIFFERENT time = NOT duplicate (different shows)

**Lesson:** Hash-based deduplication (exact match) isn't enough for LLM-discovered data. Use semantic deduplication by passing existing data back to the LLM.

### Bug: SmartBlocks progress stuck at 72% with static message (Dec 2025)

**Cause:** Two issues combined:
1. `useVenueLoadingMessages.ts` was missing phases: `routing`, `places`, `verifying`
2. `SmartBlocksStatus.tsx` showed static "Enrichment beginning..." instead of dynamic phase messages

**Symptoms:**
- Progress bar stuck at 72% for extended periods
- Message shows "Enrichment beginning..." even deep into SmartBlocks phase
- No indication of what pipeline step is running (routing, places, verifying)

**Root Cause:**
The SmartBlocks pipeline has these phases: `venues → routing → places → verifying → complete`
But the `useVenueLoadingMessages` hook only had messages for `venues` and `enriching` (legacy).
When `routing`/`places`/`verifying` phases fired, it fell back to default `venues` messages.

**Fix:**
1. Added phase-specific messages to `useVenueLoadingMessages.ts`:
   ```javascript
   routing: [
     { icon: '🚗', text: 'Calling Google Routes API for drive times...' },
     { icon: '📊', text: 'Calculating distance from your location...' },
   ],
   places: [
     { icon: '📍', text: 'Looking up venue details from Places API...' },
     { icon: '🕐', text: 'Fetching business hours and ratings...' },
   ],
   verifying: [
     { icon: '🔍', text: 'Gemini verifying event information...' },
     { icon: '✅', text: 'Cross-checking venue details...' },
   ],
   ```

2. Updated `SmartBlocksStatus.tsx` to use dynamic messages:
   ```javascript
   // OLD: Static text
   ? 'Enrichment beginning...'

   // NEW: Dynamic phase-specific message
   ? `${venueMessages.badge}: ${venueMessages.text}`
   ```

**Files Changed:**
- `client/src/hooks/useVenueLoadingMessages.ts`: Added routing, places, verifying phases
- `client/src/components/SmartBlocksStatus.tsx`: Use dynamic phase messages

**Lesson:** UI loading messages should reflect backend pipeline phases exactly. When adding new pipeline phases, update the corresponding frontend message hooks.

### Bug: All venues showing same event badge (Dec 2025)

**Cause:** Event matching was too loose - partial address matching matched all venues in a city

**Symptoms:**
- All 5 SmartBlocks venues show "🎫 Event: Emerson Christmas Concert"
- Even venues at different addresses (Main St, Oak St, El Dorado Pkwy) show same event

**Root Cause:**
The `event-matcher.js` used loose address matching:
```javascript
// OLD: Too loose - "frisco" matches all Frisco addresses
const addressMatch = eventAddress.includes(venueAddress) || venueAddress.includes(eventAddress);
```
After normalizing addresses, city names like "frisco" would match ALL venues in that city.

**Fix:** Strict address matching requiring BOTH street number AND street name:
```javascript
// NEW: Requires "6991" + "main" to both match
function addressesMatchStrictly(addr1, addr2) {
  const num1 = extractStreetNumber(addr1);  // "6991"
  const num2 = extractStreetNumber(addr2);
  if (num1 !== num2) return false;  // Numbers must match

  const street1 = extractStreetName(addr1);  // "main"
  const street2 = extractStreetName(addr2);
  return street1 === street2 || street1.includes(street2);
}
```

**File Changed:** `server/lib/venue/event-matcher.js`

**Lesson:** Address matching for event correlation must be strict. Require specific street number + street name, not just partial city/neighborhood matching. Log each match for debugging.

### Bug: Phase updates not visible during SmartBlocks (stuck at 72%) (Dec 2025)

**Cause:** Polling only triggered during `pending` status, not `pending_blocks`

**Symptoms:**
- Progress bar stuck at 72% showing "Tactical Planner: Building venue recommendation list..."
- Never shows routing/places/verifying phases
- Jumps straight from 72% to 100%

**Root Cause:**
The `useStrategyPolling.ts` hook had this logic:
```javascript
// OLD: Only polls during 'pending', stops for 'pending_blocks'
refetchInterval: (query) => {
  const status = query.state.data?.status;
  return status === 'pending' ? 15000 : false;  // Blocks phase is 'pending_blocks'!
}
```
Once strategy completed (status='pending_blocks'), polling stopped at 15 seconds instead of continuing to poll for phase updates.

**Fix:** Poll fast during both 'pending' AND 'pending_blocks':
```javascript
// NEW: Fast 2s polling during any generation phase
refetchInterval: (query) => {
  const status = query.state.data?.status;
  if (status === 'pending' || status === 'pending_blocks') {
    return 2000; // Fast polling during generation
  }
  return false;
}
```

**File Changed:** `client/src/hooks/useStrategyPolling.ts`

**Lesson:** When adding new status codes (like 'pending_blocks'), update all polling/SSE logic to handle them. Status codes control polling behavior.

### Bug: Variable not defined error from nested try block scope (Dec 2025)

**Error:** `snapshotHistoryInfo is not defined` in AI Coach chat endpoint

**Cause:** Variable declared inside nested try block but used outside its scope

**Root Cause:**
JavaScript block scoping means variables declared with `let` inside a `try` block are not accessible outside that block:
```javascript
// WRONG - variable not accessible outside try block
try {
  // Some async operations...
  try {
    let snapshotHistoryInfo = '';  // Declared inside nested try
    // ... processing
  } catch (e) {
    // handle error
  }
} catch (e) {
  // handle error
}

// ERROR: snapshotHistoryInfo is not defined here!
const message = `Context: ${snapshotHistoryInfo}`;
```

**Fix:** Declare variables at the outer scope level:
```javascript
// CORRECT - variable accessible everywhere in function
let contextInfo = '';
let fullContext = null;
let snapshotHistoryInfo = '';  // Declared at outer scope

try {
  try {
    snapshotHistoryInfo = '...';  // Assign inside nested try
  } catch (e) {
    // handle error
  }
} catch (e) {
  // handle error
}

// Works! Variable was declared at accessible scope
const message = `Context: ${snapshotHistoryInfo}`;
```

**File Changed:** `server/api/chat/chat.js`

**Lesson:** When adding variables to complex try/catch flows, declare them at the outermost scope where they'll be used. Block scoping in JavaScript means nested declarations aren't accessible to outer code.

---

## News Freshness Filtering (Jan 2026)

### Problem
News was showing as "0 items" even though Gemini returned 4 news articles. The `filterFreshNews` function was filtering to **TODAY only**, but the LLM was returning news from the last 7 days.

### Root Cause
Two-stage filtering was too strict:
1. **Stage 1** (`filterRecentNews`): At storage time, keeps news from last 7 days ✅
2. **Stage 2** (`filterFreshNews`): At display time, keeps only TODAY's news ❌ Too strict!

### Solution (2026-01-05)

1. **Expanded freshness window from "today only" to "last 3 days"**
   - `isNewsFresh()` replaces `isNewsFromToday()`
   - News from yesterday is still relevant (roadwork, construction, etc.)
   - Configurable via `NEWS_FRESHNESS_DAYS = 3`

2. **Updated LLM prompts to prioritize TODAY's news**
   - Prompt now says "Search for news published TODAY"
   - Includes fallback: "If no news from today, include yesterday's"
   - Requires publication dates: "If you cannot determine the publication date, DO NOT include that article"
   - Added reason field: `{"items": [], "reason": "No rideshare-relevant news found for market today"}`

3. **Emphasized driver relevance**
   - Prompt lists what matters to drivers: traffic, events, policy changes
   - Each summary must explain HOW it affects rideshare drivers
   - Allows market-level search (metro area, not just city)

### Files Changed
- `server/lib/strategy/strategy-utils.js` - `isNewsFresh()`, `filterFreshNews()`
- `server/lib/briefing/briefing-service.js` - Gemini & Claude news prompts

---

## Known Issues / Future Work

### Market Data Quality (Dec 2025)

**Issue:** Users signing up from countries without pre-seeded platform data can enter free-text market names, which will cause data quality issues:
- Misspellings (e.g., "Dalls" instead of "Dallas")
- Non-standard names (e.g., "DFW" vs "Dallas-Fort Worth")
- Made-up markets
- Inconsistent formatting

**Current State:**
- `countries` table has 196 countries (ISO 3166-1 standard)
- 60 countries have pre-seeded market data from `platform_data` table
- Users in other countries enter market names manually via text input

**Future Solutions:**
1. Add autocomplete/typeahead with fuzzy matching to suggest existing markets
2. Add a "market_aliases" table to normalize variations (DFW → Dallas-Fort Worth)
3. Use geocoding to validate market names against real cities
4. Admin review queue for new market entries
5. Expand `platform_data` coverage to more countries over time

**Files Involved:**
- `server/api/platform/index.js` - countries-dropdown, markets-dropdown endpoints
- `client/src/pages/auth/SignUpPage.tsx` - conditional dropdown/text input rendering
- `shared/schema.js` - countries table schema

### Bug: Events not showing in briefing UI (Timezone Parsing)

**Added:** 2026-01-05

**Cause:** Server runs in UTC, but event times like "3:30 PM" are stored as local strings. When parsed without timezone context, they were interpreted as UTC.

**Symptoms:**
- Events discovered by the AI appear in the database
- But the Briefing tab shows "No events found"
- Evening events (e.g., 7 PM local time) show up correctly in the morning
- Morning/afternoon events never show up

**Root Cause:**
```javascript
// OLD (WRONG) - Parses "3:30 PM" as UTC, which is 9:30 AM in CST
const eventTime = new Date(`${event_date}T${parsed_time}:00`);

// This means a 3:30 PM CST event becomes 3:30 PM UTC = 9:30 AM CST
// If it's currently 10 AM CST, the event appears to have already passed!
```

**Fix:** Created `createDateInTimezone()` helper that properly interprets local times:
```javascript
function createDateInTimezone(year, month, day, hours, minutes, timezone) {
  // Uses Intl.DateTimeFormat to calculate UTC offset for the timezone
  // Returns a Date object that correctly represents 3:30 PM in CST
}

// Updated all filterFreshEvents() calls to pass snapshot.timezone
const freshEvents = filterFreshEvents(allEvents, new Date(), snapshot.timezone);
```

**Files Changed:**
- `server/lib/strategy/strategy-utils.js` - Added timezone-aware event filtering
- `server/api/briefing/briefing.js` - Pass timezone to filterFreshEvents()

**Key Insight:** When storing local times as strings (e.g., "3:30 PM"), you MUST also store/pass the timezone to correctly convert back to UTC for comparisons. Never assume the server's timezone matches the user's.

---

## Testing Checklist

### Before Every PR

```bash
# 1. Lint check
npm run lint

# 2. Type check
npm run typecheck

# 3. Build test
npm run build

# 4. Start server (verify no crashes)
npm run dev
```

### After AI Model Changes

1. Test each model endpoint individually
2. Verify correct parameters are sent (check MODEL.md)
3. Check response parsing handles new format
4. Verify error handling for rate limits

### After Database Schema Changes

1. Run `npm run db:push`
2. Test affected queries
3. Verify indexes exist
4. Check foreign key constraints

### After Frontend Changes

1. Test on mobile viewport
2. Verify GPS permission flow
3. Check localStorage behavior
4. Test loading states

---

## Historical Context

### Why Multiple AI Models?

Each model has strengths:
- **Claude**: Best for strategic reasoning, web search fallback
- **Gemini**: Native Google Search grounding for real-time events, news, traffic, airport data
- **GPT-5.2/5.2**: Best for structured outputs and immediate tactical actions
- **TomTom**: Real-time traffic data (primary traffic source)

**Note (Dec 2024):** Perplexity was replaced with Gemini 3 Pro Preview (with Google Search tool) as the primary briefing provider. Claude web search serves as fallback when Gemini fails.

### Why Snapshot-Centric?

Enables ML training by:
1. Linking all data to a point in time
2. Correlating driver actions with recommendations
3. Measuring strategy effectiveness
4. Building feedback loops

### Why Split Cache Strategy?

- Daily data (events, news) doesn't change frequently
- Traffic data changes constantly
- Split caching reduces API costs while keeping traffic fresh

---

## Quick Reference

### Key Files to Know

| Purpose | File |
|---------|------|
| Main entry | `gateway-server.js` |
| Model dispatch | `server/lib/ai/adapters/index.js` |
| Strategy providers | `server/lib/ai/providers/*.js` |
| Schema definition | `shared/schema.js` |
| Location context | `client/src/contexts/location-context-clean.tsx` |
| Main UI | `client/src/pages/co-pilot.tsx` |

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection |
| `OPENAI_API_KEY` | GPT-5.2 + Voice |
| `GEMINI_API_KEY` | Gemini 3 Pro |
| `ANTHROPIC_API_KEY` | Claude Sonnet |
| `PERPLEXITY_API_KEY` | Holiday detection |
| `GOOGLE_MAPS_API_KEY` | Places/Routes/Geocoding |

---

## Security Best Practices

### JWKS / RS256 Authentication

Production uses RS256 asymmetric JWT authentication:

**Key Files:**
- `keys/private.pem` - RSA private key (NEVER commit!)
- `keys/public.pem` - RSA public key
- `public/.well-known/jwks.json` - Public JWKS file

**Token Generation:**
```bash
node scripts/sign-token.mjs <user_id> [tenant_id]
```

**Key Rotation:** Every 90 days

**Neon Database Integration:**
1. Deploy app to get public URL
2. Register JWKS in Neon: Settings > Authentication
3. Add JWKS URL: `https://<domain>/.well-known/jwks.json`
4. Apply SQL helpers: `psql "$DATABASE_URL_UNPOOLED" -f migrations/004_jwt_helpers.sql`

### Authentication Requirements

All POST/PATCH/DELETE routes MUST have `requireAuth` middleware:
```javascript
router.post('/endpoint', requireAuth, async (req, res) => {
  const userId = req.auth?.userId;  // Extract from JWT, NOT from body
  // ...
});
```

### User Data Isolation

**CORRECT:**
```javascript
// Always filter by authenticated user
const snapshot = await db.select().from(snapshots)
  .where(
    eq(snapshots.snapshot_id, snapshotId) &&
    eq(snapshots.user_id, req.auth.userId)  // REQUIRED
  );
```

**WRONG:**
```javascript
// NEVER trust client-provided user_id
user_id: req.body.user_id  // SECURITY VULNERABILITY
```

### Secrets Management

- **NEVER** expose `*_SECRET` keys to frontend (no `VITE_*_SECRET`)
- Keep OAuth secrets server-side only
- Use backend proxy for third-party API calls

### Ownership Enforcement (TODO: Implement with User Auth)

**Status:** PENDING - Requires user authentication system

When user auth is implemented, the following ownership checks MUST be added:

**1. Chat Snapshot Ownership**
- `server/api/chat/chat.js`: `POST /:snapshotId/message`
- Before allowing chat messages, verify:
  ```javascript
  const snapshot = await db.select().from(snapshots)
    .where(and(
      eq(snapshots.snapshot_id, snapshotId),
      eq(snapshots.user_id, req.auth.userId)  // ADD THIS CHECK
    ));
  if (!snapshot.length) return res.status(403).json({ error: 'Access denied' });
  ```

**2. Strategy Access Ownership**
- `server/api/strategy/blocks-fast.js`: `GET /`
- Verify user owns the snapshot before returning strategy data

**3. Feedback & Actions Ownership**
- `server/api/feedback/`: All endpoints should verify snapshot ownership

**4. RLS Policy Updates (Neon Database)**
- Current RLS policies are permissive when `user_id IS NULL`
- Once user auth exists, update policies to require authenticated user:
  ```sql
  -- CURRENT (permissive):
  USING (user_id = auth.user_id() OR user_id IS NULL)

  -- UPDATE TO (strict):
  USING (user_id = auth.user_id())
  ```

**Why Deferred:** Without a login/signup flow, there's no authenticated user session to enforce ownership against. Implementing ownership checks now would break the app.

**Security Fixes Already Applied (Dec 2025):**
- ✅ `/api/tts`: Added `requireAuth` (prevents unauthenticated API cost abuse)
- ✅ `/api/realtime/token`: Added `requireAuth` (prevents unauthenticated OpenAI token minting)
- ✅ `/api/auth/token`: Blocked in production (prevents arbitrary user impersonation)
- ✅ Agent server legacy endpoints: Added bearer auth middleware (15+ endpoints)

---

## Cloud Run / Autoscale Deployment

### Boot Time Requirements

Cloud Run requires health endpoints to respond in <100ms during boot.

**Critical Fixes Applied:**
1. **No blocking code before `server.listen()`** - assertStrategies() moved to post-listen
2. **Lazy DB pool** - No connections until first query
3. **Event loop monitoring** - Pause tasks if lag >200ms
4. **Background worker disabled** on autoscale instances

### Environment Variables for Autoscale

```bash
# Auto-detected or set manually
K_SERVICE=vecto-pilot           # Set by Cloud Run
CLOUD_RUN_AUTOSCALE=1           # Manual override
FAST_BOOT=1                     # Skip cache warmup

# Database tuning for autoscale
PG_MAX=2                        # Small pool per instance
PG_MIN=0                        # Lazy connect
PG_IDLE_TIMEOUT_MS=10000        # 10s idle timeout
```

### HTTP Server Tuning

```javascript
server.keepAliveTimeout = 65000;  // Slightly > Cloud Run's 60s
server.headersTimeout = 66000;
```

---

## Query Conventions

### Sorting Standard

**Always use `created_at DESC`** (newest first) for debugging interfaces:

```javascript
// ✅ CORRECT - Newest first for debugging
.orderBy(desc(snapshots.created_at))

// ❌ AVOID - Unless reviewing historical data
.orderBy(asc(snapshots.created_at))
```

**Why?** Incident response needs latest entries immediately visible.

---

## Movement Detection

### Threshold: 500 meters

Strategy regeneration triggers when driver moves >500m from last snapshot.

```javascript
// server/lib/strategy-triggers.js
const COORD_DELTA_THRESHOLD_KM = 0.5;  // 500m = 0.5km
```

**Previous Bug:** Threshold was 3.2km (2 miles) - far too slow for real-time guidance.

---

## Time Windowing

Strategy validity is limited to 60 minutes max:

```javascript
// Fields in strategies table
valid_window_start: new Date(),
valid_window_end: new Date(Date.now() + 60 * 60 * 1000),  // +60 min
strategy_timestamp: new Date()
```

Validation gates check:
- Location freshness (≤2 minutes since geocode)
- Strategy freshness (≤120 seconds since generation)
- Window not expired

---

## Resolved Historical Issues

### Issue: GPT-5.2 API Rejects Temperature
- **Error:** `Unsupported value: 'temperature' does not support 0.2`
- **Fix:** Removed temperature, use `reasoning.effort` instead
- **Status:** RESOLVED

### Issue: Connection Pool Exhaustion (Replit)
- **Cause:** Pool size 35 too high for Replit Postgres
- **Fix:** Reduced to max=10, idle timeout=30s
- **Status:** RESOLVED

### Issue: Health Checks Failing During Boot
- **Cause:** Blocking operations before server.listen()
- **Fix:** Post-listen yielded ladder pattern
- **Status:** RESOLVED

### Issue: 1,643 API Calls in 6 Hours
- **Cause:** Aggressive 2-second polling on /api/users/me
- **Fix:** Set `refetchInterval: false`
- **Status:** RESOLVED

### Issue: Events Filtered Out by EventValidator (Dec 11, 2025)
- **Cause:** Claude EventValidator returned prose instead of JSON, causing all events to be marked as "Parse error" and filtered out
- **Fix:** Disabled EventValidator entirely - Gemini handles event discovery, Claude is fallback only
- **Status:** RESOLVED

### Issue: Duplicate Briefing API Calls (Dec 11, 2025)
- **Cause:** Both `snapshot.js` and `strategy-generator-parallel.js` called `generateAndStoreBriefing`, causing double Gemini API calls for traffic/events
- **Fix:** Database-driven deduplication using NULL fields as triggers:
  - INSERT placeholder row with NULL fields = "generation in progress"
  - Check for populated fields < 60s old = skip regeneration
  - `getOrGenerateBriefing` returns null if placeholder < 2 min old
- **Status:** RESOLVED

### Issue: News/School Closures Not Populating (Dec 11, 2025)
- **Cause:** Cache lookup query was finding our own placeholder row (with NULL news) instead of cached data from other snapshots
- **Fix:** Updated cache query to exclude current snapshotId AND exclude rows with NULL news
- **Status:** RESOLVED

### Issue: Snapshot Missing formatted_address (Dec 11, 2025)
- **Cause:** `snapshot.js` relied on request body for resolved data, not looking up users table
- **Fix:** If resolved data missing from request, lookup users table → coords_cache as fallback
- **Status:** RESOLVED

### Issue: LLMs Receiving Raw Coords Instead of Addresses (Dec 11, 2025)
- **Cause:** Strategy pipeline was not passing full snapshot row to providers - they had to fetch from DB
- **Fix:** Pass full snapshot row through entire chain:
  - `snapshot.js` → `generateStrategyForSnapshot(id, { snapshot })`
  - `generateMultiStrategy({ snapshot })`
  - `runMinStrategy(id, { snapshot })`
  - `runBriefing(id, { snapshot })`
- **Key Rule:** **LLMs cannot reverse geocode** - always provide `formatted_address`
- **Status:** RESOLVED

---

## Location Data Flow (Critical)

```
coords_cache.formatted_address  ← Google API resolution
       ↓
users.formatted_address         ← Populated from coords_cache
       ↓
snapshots.formatted_address     ← Populated from users (or coords_cache fallback)
       ↓
strategy pipeline               ← Full snapshot row passed through
       ↓
LLM prompt                      ← "LOCATION: 1753 Saddle Tree Rd, Frisco, TX"
```

**NEVER send raw coordinates to LLMs** - they cannot determine addresses.

---

## Stable Implementations (DO NOT CHANGE)

### Traffic Briefing System - STABLE (Dec 2025)

**⚠️ DO NOT MODIFY without very good reason - this implementation is working perfectly.**

The traffic briefing system combines TomTom real-time data with Claude analysis:

**Data Flow:**
```
TomTom Traffic API → Raw incidents with priority scoring
       ↓
analyzeTrafficWithClaude() → Human-readable briefing
       ↓
BriefingTab.tsx → Collapsible UI
```

**Backend (`briefing-service.js`):**
- `analyzeTrafficWithClaude()` - Sends prioritized TomTom data to Claude Opus 4.5
- Returns structured JSON: `briefing`, `keyIssues`, `avoidAreas`, `driverImpact`
- Uses 2048 max_tokens for comprehensive analysis

**Traffic Briefing Format (3-4 sentences):**
1. Overall congestion level and incident count
2. Which specific corridors/highways are worst affected and delays
3. Secondary impacts and alternative routes
4. Time-sensitive info (rush hour ending, event traffic clearing)

**Frontend (`BriefingTab.tsx`):**
- Traffic card shows full briefing (not just summary)
- Key Issues section highlights top problems
- Active Incidents are **collapsible** (collapsed by default)
- Driver Impact section shows earnings/routing effect

**Key Implementation Details:**
```javascript
// Server returns these fields:
{
  briefing: "3-4 sentence comprehensive traffic overview",
  keyIssues: ["Issue 1 with road name", "Issue 2", "Issue 3"],
  avoidAreas: ["Road to avoid: reason"],
  driverImpact: "How this affects rideshare operations",
  incidents: [...],  // Top 10 prioritized
  incidentsCount: 146  // Total count for header
}
```

**Why It Works:**
- TomTom provides accurate real-time data
- Claude analyzes and produces driver-focused briefing
- UI shows essential info upfront, details on demand
- Collapsed incidents save screen space while remaining accessible

**DO NOT:**
- Change the prompt structure without testing extensively
- Remove fields (frontend depends on them)
- Reduce max_tokens (briefing quality will suffer)
- Make incidents expanded by default (too much UI space)

---

## 15. No Cache for Strategies (December 2025)

### Problem
The app was restoring 49-minute-old cached strategies from localStorage on app start, making the progress bar run quickly across without actually generating fresh data.

### Root Cause
This is a **real-time rideshare intelligence app**. Cached strategies are useless for drivers - they need live data about current traffic, events, and surge pricing.

### Critical Rule

**NEVER CACHE STRATEGIES. ALWAYS GENERATE FRESH.**

The entire value proposition of this app is real-time intelligence. A strategy from even 15 minutes ago could have completely wrong traffic conditions, ended events, or missed surge opportunities.

### What Was Wrong
1. localStorage was persisting `vecto_persistent_strategy` and restoring it on mount
2. React Query `staleTime` was allowing cached strategy data
3. Old snapshots were being reused instead of creating fresh ones

### The Fix
1. Remove localStorage restoration of old strategies in `co-pilot-context.tsx`
2. Always trigger fresh snapshot creation on app start
3. Strategy data should never be cached between sessions

### Remember
- Driver earnings depend on **real-time** data
- A 10-minute-old strategy could cost the driver money
- The progress bar should show **actual** pipeline work, not fake animation over cached data
- Fresh GPS → Fresh Snapshot → Fresh Strategy → Fresh Blocks (every time)

---

## 16. Progress Bar SSE Subscription (December 2025)

### Problem
Progress bar was stuck at 7 seconds / not progressing in sync with backend logs. Backend showed phases changing rapidly (resolving → analyzing → immediate → venues...) but UI progress bar didn't move.

### Root Cause
Frontend was only polling `/api/blocks/strategy` every 3 seconds to get phase data. With phases changing faster than 3 seconds, the progress bar couldn't keep up.

### The Fix
Subscribe to SSE `/events/phase` endpoint for real-time phase_change events:

```typescript
// co-pilot-helpers.ts
export function subscribePhaseChange(callback: (data) => void): () => void {
  const eventSource = new EventSource('/events/phase');
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    callback(data);  // { snapshot_id, phase, phase_started_at, expected_duration_ms }
  };
  return () => eventSource.close();
}

// co-pilot-context.tsx
useEffect(() => {
  const unsubscribe = subscribePhaseChange((data) => {
    if (data.snapshot_id === lastSnapshotId) {
      queryClient.invalidateQueries({ queryKey: ['/api/blocks/strategy', lastSnapshotId] });
    }
  });
  return unsubscribe;
}, [lastSnapshotId]);
```

### Remember
- Backend emits `phase_change` events at `/events/phase` with timing metadata
- Frontend must subscribe to SSE for real-time progress, polling is too slow
- Query invalidation on SSE triggers immediate re-fetch with fresh phase data

---

## 17. Duplicate Snapshot Issue (December 2025)

### Problem
Two snapshots are being created simultaneously, causing race conditions and duplicate pipeline runs.

### Root Cause
- One snapshot is cached in memory for speed
- One snapshot lands in the database
- Both trigger pipeline runs independently

### Correct Flow (TO BE IMPLEMENTED)

```
GPS → Create ONE snapshot in DB (single insert)
    → Trigger pipeline with snapshot_id only (no memory data)
    → Pipeline writes to: strategies, briefings, rankings tables
    → Frontend WAITS for briefing != null
    → Frontend FETCHES from DB (single source of truth)
```

### Key Principles
1. **Database is the single source of truth** - no memory caching
2. **One snapshot per GPS update** - not two
3. **Frontend waits for DB** - doesn't use passed memory data
4. **Memory caching removed once users sign up** - user_id provides persistence

### Files to Harden
- `client/src/contexts/location-context-clean.tsx` - Remove memory caching
- `client/src/contexts/co-pilot-context.tsx` - Fetch from DB only
- `server/api/location/index.js` - Single snapshot creation point

### Documentation
See: `docs/architecture/progress-bar-and-snapshot-flow.md`

---

## 18. SSE vs Polling Decision History (December 2025)

### Timeline
1. **Nov 4**: SSE implemented for real-time updates
2. **Nov 25**: SSE reverted to polling (undocumented issues)
3. **Dec 30**: SSE re-implemented with documentation

### The Truth
SSE is the **correct approach** for real-time progress. The Nov 25 revert was due to implementation bugs, not a fundamental problem with SSE.

### What Was Wrong Before
- SSE timeouts (connection drops)
- Race conditions (not SSE's fault - snapshot duplication)
- Lack of documentation on why it was reverted

### Current Implementation
```typescript
// Subscribe to /events/phase SSE endpoint
subscribePhaseChange((data) => {
  if (data.snapshot_id === lastSnapshotId) {
    queryClient.invalidateQueries({ queryKey: ['/api/blocks/strategy', lastSnapshotId] });
  }
});
```

### Remember
- SSE is correct for real-time progress
- Document WHY before reverting any approach
- Test in production-like environment, not just dev

---

## 19. Duplicate Snapshot/Pipeline Fix (December 2025)

### The Problem
Two pipeline runs were occurring for each GPS update:
1. SessionStorage restored OLD snapshot_id → triggered waterfall for OLD snapshot
2. GPS fetch created NEW snapshot → triggered SECOND waterfall

### Root Cause Analysis

**Issue 1: Dual Waterfall Triggers**
`co-pilot-context.tsx` had TWO triggers for `/api/blocks-fast`:
- `useEffect` watching `locationContext?.lastSnapshotId` (line 95-122)
- Event handler for `vecto-snapshot-saved` (line 127-150)
Both could fire for the same snapshot = duplicate pipeline runs.

**Issue 2: SessionStorage Restored Old Snapshot ID**
`location-context-clean.tsx` restored `lastSnapshotId` from sessionStorage:
```typescript
if (data.snapshotId) setLastSnapshotId(data.snapshotId); // PROBLEM!
```
This OLD snapshot_id triggered waterfalls for stale data.

### The Fix

**1. Added Waterfall Deduplication**
```typescript
// co-pilot-context.tsx
const waterfallTriggeredRef = useRef<Set<string>>(new Set());

// Before triggering waterfall:
if (waterfallTriggeredRef.current.has(snapshotId)) {
  console.log("⏭️ Skipping duplicate waterfall");
  return;
}
waterfallTriggeredRef.current.add(snapshotId);
```

**2. Removed Snapshot ID Restoration**
```typescript
// location-context-clean.tsx - NOW RESTORES DISPLAY DATA ONLY
// DO NOT restore snapshot_id - always create fresh snapshots!
// if (data.snapshotId) setLastSnapshotId(data.snapshotId); // REMOVED!
if (data.city) setCity(data.city);  // Display data OK
if (data.weather) setWeather(data.weather);  // Display data OK
```

### Key Principles
1. **One pipeline run per snapshot** - use deduplication ref
2. **Never restore snapshot_id from cache** - always create fresh
3. **Display data can be cached** - city, weather for immediate UX
4. **GPS always fetches fresh** - don't skip based on cached snapshot_id

### Files Modified
- `client/src/contexts/co-pilot-context.tsx` - Added `waterfallTriggeredRef` deduplication
- `client/src/contexts/location-context-clean.tsx` - Removed snapshot_id restoration

---

## 20. Screen Flashing Fix (December 2025)

### Problem
Screens were flashing in production - UI elements would briefly disappear and reappear during data updates.

### Root Causes Identified
1. **Context value not memoized**: `CoPilotContext.Provider` received a new `value` object on every render, causing all children (StrategyPage, BarsPage, BriefingPage) to re-render
2. **Aggressive query invalidation**: SSE events called `invalidateQueries()` which clears cache immediately → `isLoading=true` → UI shows loading state → flash
3. **Binary loading states**: Components used `{isLoading ? <Skeleton /> : <Content />}` which completely replaced UI

### The Fix

**1. Memoized Context Value**
```typescript
// co-pilot-context.tsx
const value: CoPilotContextValue = useMemo(() => ({
  coords,
  city: locationContext?.city || null,
  // ... all other properties
}), [coords, city, /* dependencies */]);
```

**2. Use refetchQueries Instead of invalidateQueries**
```typescript
// OLD - causes flash
queryClient.invalidateQueries({ queryKey: [...] });

// NEW - keeps existing data visible during fetch
queryClient.refetchQueries({
  queryKey: [...],
  type: 'active'
});
```

**3. Loading Overlay Pattern**
Instead of replacing content with skeleton:
- Show existing content with subtle "Updating..." badge overlay
- Only show skeleton on INITIAL load (no data yet)

### Key Insight
- `invalidateQueries`: Immediately marks cache as stale → `isLoading` becomes true → UI shows loading state → flash
- `refetchQueries`: Fetches in background → `isFetching` is true but `isLoading` stays false → existing data remains visible → smooth transition

### Files Modified
- `client/src/contexts/co-pilot-context.tsx` - Memoized context value, changed to refetchQueries
- `client/src/pages/co-pilot/StrategyPage.tsx` - Added transitions, loading overlay pattern
- `client/src/hooks/useStrategyPolling.ts` - Changed invalidateQueries to refetchQueries

---

## 21. Don't Add Auth to Critical Public Endpoints (December 30, 2025)

### Problem
Production screens were flashing. Initial investigation showed "User mismatch" logs, leading to an attempted fix that made things worse.

### What Went Wrong

**Attempted Fix (WRONG):** Added `optionalAuth` middleware to `/api/location/resolve` to ensure authenticated users get correct user_id on snapshots.

**Why It Failed:**
1. `optionalAuth` **rejects requests with invalid tokens** (returns 401)
2. If browser has stale token in localStorage, location resolution **fails completely**
3. Location resolution is a **critical path** - must work for ALL users, regardless of auth state
4. Result: Chrome with stale token couldn't resolve location at all

**Additional Issues:**
- Client-side `useMemo` changes included function references (`refetchBlocks`, `refetchBars`) in dependency array
- These functions recreate on every render, defeating memoization
- Could have caused MORE re-renders instead of fewer

### The Real Cause
The original "flashing" on one specific phone was likely a **browser cache/permission issue**, not a code bug:
- Phone wasn't prompting for GPS permission (stale permission state)
- Other devices (iPad) worked fine
- After clearing cache on phone, it still had issues due to the broken "fix"

### Lesson Learned
1. **Don't add auth checks to critical public endpoints** - Location resolution must work for everyone
2. **Don't include function references in useMemo deps** unless they're wrapped in useCallback
3. **When debugging production issues, check the simple things first** - browser cache, permissions, stale data
4. **If something worked before and broke after changes, revert the changes first**

### Files Affected (then reverted)
- `server/api/location/location.js` - optionalAuth added then reverted
- `client/src/contexts/co-pilot-context.tsx` - useMemo changes reverted
- `client/src/hooks/useStrategyPolling.ts` - invalidate→refetch changes reverted

---

## 22. Missing Event Listener Pattern (December 31, 2025)

### Problem
Production app completely broken - GPS times out even after permission granted. User accepts geolocation permission, but app never recovers and 5-second timeout fires.

### Root Cause
An event dispatch/listen pair was broken during refactoring:
1. `useBriefingQueries.ts` dispatches `snapshot-ownership-error` event when server returns 404 (stale snapshot)
2. `location-context-clean.tsx` **was supposed to have a listener** that catches this and calls `refreshGPS()`
3. **The listener was removed** during previous edits, but the dispatcher remained
4. Result: Event fires into void → app never recovers → GPS timeout → app frozen

### The Fix
Added the missing event listener back to `location-context-clean.tsx`:
```javascript
useEffect(() => {
  const handleOwnershipError = () => {
    console.warn('🚨 [LocationContext] Snapshot ownership error - clearing and refreshing');
    setLastSnapshotId(null);
    clearSnapshotStorage();
    lastEnrichmentCoordsRef.current = null;
    refreshGPS();
  };

  window.addEventListener('snapshot-ownership-error', handleOwnershipError);
  return () => window.removeEventListener('snapshot-ownership-error', handleOwnershipError);
}, [refreshGPS]);
```

### Pattern to Remember
**When adding `dispatchEvent()`, ALWAYS verify `addEventListener()` exists**

Event dispatch/listen pairs:
- `dispatchEvent(new CustomEvent('X'))` needs `addEventListener('X', handler)`
- Both sides must be reviewed together during refactoring
- Search for event name across codebase before removing either side

### Files Involved
- `client/src/hooks/useBriefingQueries.ts:33-36` - Dispatches event
- `client/src/contexts/location-context-clean.tsx` - Listener was missing (now restored)

### Lesson Learned
1. Event systems are bidirectional - don't edit one side without checking the other
2. When GPS "times out after permission granted", check for broken recovery paths
3. Search for the event name across the codebase before removing event-related code

---

## 23. Screen Flashing Fix - December 31, 2025 (Round 2)

### Problem
Screen flashing in production with console logs showing:
- `[BriefingQuery] Weather failed: 404`
- Massive re-render loop (repeated `Br` → `gy` → `Br` call stack pattern)
- Error: `["/api/briefing/weather","ae2b45ac-67a2-4a0f-8cce-8a30bb418263"]`

### Root Causes Identified

**1. Weather query missing 404 handler**
Unlike traffic/news/airport, weather endpoint didn't dispatch ownership error on 404:
```javascript
// BEFORE (BUG): Weather returned undefined on 404, didn't stop retries
if (!response.ok) {
  return undefined;  // No ownership error dispatch!
}

// AFTER (FIX): Now matches traffic/news/airport pattern
if (response.status === 404) {
  dispatchSnapshotOwnershipError();
  return { weather: null, _ownershipError: true };
}
```

**2. Weather endpoint making fresh API calls every time**
Weather endpoint called `fetchWeatherConditions()` directly instead of reading cached data:
```javascript
// BEFORE (BUG): Always fetches fresh - excessive API calls
const freshWeather = await fetchWeatherConditions({ snapshot });

// AFTER (FIX): Read from briefings table first (like traffic does)
const briefing = await getBriefingBySnapshotId(snapshot_id);
if (briefing?.weather_current) {
  return { weather: { current: briefing.weather_current, forecast: briefing.weather_forecast } };
}
// Only fetch fresh if no cached data
```

**3. Context value not memoized**
`CoPilotContext.Provider` received new object every render → all children re-render:
```javascript
// BEFORE (BUG): New object every render
const value = { coords, city, ... };

// AFTER (FIX): Memoized - same object if deps unchanged
const value = useMemo(() => ({ coords, city, ... }), [deps]);
```

**4. SSE handlers using invalidateQueries instead of refetchQueries**
```javascript
// BEFORE (BUG): Clears cache → isLoading=true → flash
queryClient.invalidateQueries({ queryKey: [...] });

// AFTER (FIX): Background fetch, existing data stays visible
queryClient.refetchQueries({ queryKey: [...], type: 'active' });
```

### Files Changed
- `client/src/hooks/useBriefingQueries.ts` - Added 404 handler to weather/events/school-closures
- `client/src/contexts/co-pilot-context.tsx` - Memoized context value, changed SSE to refetchQueries
- `server/api/briefing/briefing.js` - Weather endpoint now reads from cached briefing first

### How to Verify Fix in Production
1. Open browser console
2. Navigate to the app
3. Watch for:
   - ✅ No repeated `Weather failed: 404` logs
   - ✅ Single `Weather: returning cached data` log (not multiple fresh fetches)
   - ✅ No massive re-render stack traces
   - ✅ Smooth UI transitions (no flash when SSE events fire)

### Trade-off: refetchQueries vs invalidateQueries
- `invalidateQueries`: Clears cache immediately → shows loading state → can flash
- `refetchQueries`: Keeps old data visible → fetches in background → smooth but briefly shows stale data

We chose `refetchQueries` because:
1. The "stale" data is only stale for milliseconds during refetch
2. Flashing is worse UX than briefly showing previous data
3. For SSE events, we're updating the SAME snapshot, not switching locations

### If Flashing Returns
Check these in order:
1. Is weather returning 404? → Check if snapshot exists in DB
2. Is weather making fresh API calls? → Look for "fetching fresh" logs (should be rare)
3. Are SSE handlers using invalidateQueries? → Should use refetchQueries
4. Is context value memoized? → Check useMemo in co-pilot-context.tsx

---

## Registration & Profile System (Dec 2025)

### Registration Data Structure Mismatch

**Problem:** Registration failing silently - vehicle data not saved, Uber tiers all false

**Root Cause:**
- Client (SignUpPage.tsx) sends **flat** field names: `vehicleYear`, `vehicleMake`, `uberBlack`, etc.
- Server (auth.js) originally expected **nested** objects: `vehicle.year`, `vehicle.make`, `uberTiers.uberBlack`, etc.
- This mismatch meant all vehicle and tier data was `undefined`

**Fix:** Server now accepts BOTH formats and normalizes:
```javascript
// Normalize vehicle: support both nested and flat formats
const normalizedVehicle = vehicle || {
  year: vehicleYear,
  make: vehicleMake,
  model: vehicleModel,
  seatbelts: seatbelts || 4
};

// Normalize uber tiers: support both nested and flat formats
const normalizedUberTiers = uberTiers || {
  uberBlack: uberBlack || false,
  uberXXL: uberXxl || false,   // Note: case mapping
  uberComfort: uberComfort || false,
  uberX: uberX || false,
  uberXShare: uberXShare || false
};
```

**Prevention:**
- When building forms, check what the API endpoint expects
- Server should be flexible about input formats when reasonable
- Add validation error messages that surface field names

### GET /me Response Structure Mismatch

**Problem:** After login, `state.profile` and `state.vehicle` always null in auth context

**Root Cause:**
- Auth context expected: `{ user: {...}, profile: {...}, vehicle: {...} }`
- GET /me returned: Flat object with all fields at root level
- `data.profile` was undefined → `state.profile = null`

**Fix:** Restructure GET /me response to match expected interface:
```javascript
res.json({
  user: { userId, email },
  profile: { id, firstName, lastName, nickname, ... },
  vehicle: { id, year, make, model, seatbelts, ... }
});
```

**Prevention:**
- TypeScript interfaces should define API response shapes
- When auth context expects specific structure, verify endpoint returns it
- Test auth flow end-to-end, not just individual endpoints

### Import Path Conventions

**Problem:** Build failed with "Could not load @/hooks/use-toast"

**Root Cause:**
- shadcn/ui templates use `use-toast.ts` (kebab-case)
- This codebase uses `useToast.ts` (camelCase)
- Easy to copy-paste wrong import path

**Fix:** Use correct path: `import { useToast } from '@/hooks/useToast'`

**Prevention:**
- Check existing imports in similar files before adding new ones
- Run `npm run build` after adding new imports
- Glob for file existence: `ls client/src/hooks/*toast*`

### Geocoding Pattern for Profile Updates

**Implementation:** When address fields change on profile update, re-geocode to update home coordinates.

**Key Design Decisions:**
1. **Non-blocking:** Geocoding failures don't fail the profile update
2. **Smart detection:** Only geocode when address fields actually change
3. **Complete address:** Merge updated fields with existing profile data for full address

```javascript
if (addressFieldsChanged) {
  const addressToGeocode = {
    address1: updates.address1 || profile.address_1,
    city: updates.city || profile.city,
    // ... merge all address fields
  };

  try {
    const geocodeResult = await geocodeAddress(addressToGeocode);
    if (geocodeResult) {
      profileUpdates.home_lat = geocodeResult.lat;
      profileUpdates.home_lng = geocodeResult.lng;
      // ...
    }
  } catch (geoErr) {
    // Non-fatal - log and continue
    console.warn('[auth] Re-geocoding failed:', geoErr.message);
  }
}
```

---

## Form UX Patterns (Dec 2025)

### Natural Tab Order for Address Fields

**Problem:** State/Province was before City, making tab flow unnatural

**Context:** Users typically think of addresses as: Street → City → State → ZIP. Having State first forced users to tab backward or use the mouse.

**Fix:** Swap the order in the grid:
```jsx
<div className="grid grid-cols-2 gap-4">
  {/* City first, then State - natural address flow */}
  <FormField name="city" ... />
  <FormField name="stateTerritory" ... />
</div>
```

**Key Insight:** Form tab order follows DOM order. Visually, fields appear left-to-right, so left field (City) should be first in the code.

### Autocomplete Pattern for Vehicle Model

**Problem:** Model dropdown was slow to filter after selecting Make, and users couldn't type a custom model if theirs wasn't in the database

**Solution:** Replace Select dropdown with autocomplete input that:
1. Allows free text typing
2. Shows filtered suggestions in a popover
3. Warns (doesn't block) if the value doesn't match a known model

**Implementation:**
```jsx
<Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
  <PopoverTrigger asChild>
    <Input
      value={field.value}
      onChange={(e) => {
        field.onChange(e.target.value);
        setModelInputValue(e.target.value);
      }}
      onFocus={() => setModelPopoverOpen(true)}
    />
  </PopoverTrigger>
  <PopoverContent>
    <Command>
      <CommandList>
        {filteredModels.slice(0, 10).map(model => (
          <CommandItem onSelect={() => field.onChange(model.name)}>
            {model.name}
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  </PopoverContent>
</Popover>
{/* Soft warning - doesn't block submission */}
{!isModelKnown && (
  <div className="text-amber-400 text-xs">
    <AlertTriangle /> Model not in our database - please verify spelling
  </div>
)}
```

**Key Components Used:**
- `Popover` + `PopoverContent` - Container for suggestions
- `Command` + `CommandList` + `CommandItem` - Searchable list from shadcn/ui
- `Input` instead of `Select` - Allows free text entry

**Benefits:**
1. Users can type to filter faster than scrolling
2. Custom models (new cars, rare vehicles) are still accepted
3. Soft warning helps catch typos without blocking

---

## 24. Schema Column Mismatch in Drizzle ORM (December 31, 2025)

### Problem
Production error: `TypeError: Cannot convert undefined or null to object` in `orderSelectedFields` when querying `driver_profiles` table.

### Root Cause
Added new columns to the `getDriverProfile` query that **don't exist in the schema**:
```javascript
// WRONG - These columns don't exist in driver_profiles schema!
uber_eligible: driver_profiles.uber_eligible,
lyft_eligible: driver_profiles.lyft_eligible,
prefers_short_trips: driver_profiles.prefers_short_trips,
weekly_hours_target: driver_profiles.weekly_hours_target,
// ... etc
```

When Drizzle tries to build the query with `undefined` columns, it crashes with a cryptic error about `Object.entries()` on null/undefined.

### The Fix
Only select columns that actually exist in the schema:
```javascript
// CORRECT - Use actual schema columns
rideshare_platforms: driver_profiles.rideshare_platforms,  // JSON array ['uber', 'lyft']
elig_economy: driver_profiles.elig_economy,  // boolean
elig_xl: driver_profiles.elig_xl,  // boolean
pref_pet_friendly: driver_profiles.pref_pet_friendly,  // boolean
// ... etc
```

### Prevention Rules
1. **ALWAYS check `shared/schema.js` before adding new column selections**
2. **Column names you imagine ≠ column names that exist**
3. When error mentions `orderSelectedFields` or `Object.entries`, suspect undefined columns
4. Run `grep -A 50 "driver_profiles = pgTable" shared/schema.js` to see actual columns

### Symptom Mapping
| Error Message | Likely Cause |
|---------------|--------------|
| `Cannot convert undefined or null to object` | Selecting undefined column |
| `orderSelectedFields` in stack | Drizzle building query with bad columns |
| Error in `utils.js:53` | Schema mismatch in select() |

### Files Involved
- `server/lib/ai/coach-dal.js` - The query with wrong columns
- `shared/schema.js` - The source of truth for column names

---

## 25. Authentication Security Upgrade: optionalAuth → requireAuth (December 31, 2025)

### Background
Originally the app supported anonymous users (device-only, no account). This led to complex middleware:
- `optionalAuth` - Validates token if present, allows anonymous if not
- `requireSnapshotOwnership` - Complex logic for authenticated vs anonymous ownership

### Problem
With GPS gating now requiring sign-in, `optionalAuth` was redundant:
1. **Unnecessary complexity** - Two code paths for auth (anonymous + authenticated)
2. **Verbose logging** - Every request logged 5+ lines of debug output
3. **Weaker security** - Routes accepted requests without tokens

### The Fix
Upgraded all snapshot-based routes from `optionalAuth` to `requireAuth`:

```javascript
// BEFORE (complex, verbose)
router.get('/weather/:snapshotId', optionalAuth, requireSnapshotOwnership, async (req, res) => {
  // optionalAuth: Token present? Validate. Missing? Allow as anonymous.
  // requireSnapshotOwnership: Complex auth.userId vs anonymous logic
});

// AFTER (simple, strict)
router.get('/weather/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  // requireAuth: No token? 401 immediately. Invalid token? 401.
  // requireSnapshotOwnership: Just check user_id === snapshot.user_id
});
```

### Files Changed
| File | Routes Updated |
|------|----------------|
| `server/api/briefing/briefing.js` | 8 routes (weather, traffic, events, etc.) |
| `server/api/location/snapshot.js` | GET /:snapshotId |
| `server/api/strategy/blocks-fast.js` | GET /, POST / |
| `server/api/strategy/content-blocks.js` | GET /strategy/:snapshotId |
| `server/api/chat/chat.js` | POST / |
| `server/middleware/require-snapshot-ownership.js` | Simplified, removed verbose logging |

### Logging Reduction
**Before:** Every request generated 5+ lines:
```
[optionalAuth] /weather/fd3d890d... - token: present
[optionalAuth] ✅ Token verified for user e41bf400
[requireSnapshotOwnership] 🔍 Checking snapshot: fd3d890d
[requireSnapshotOwnership]   - auth.userId: e41bf400
[requireSnapshotOwnership]   - snapshot.user_id: e41bf400
[requireSnapshotOwnership]   - snapshot.city: Frisco
[requireSnapshotOwnership] ✅ User ownership verified
```

**After:** Success = silent. Only errors are logged:
```
[snapshotOwnership] ❌ User mismatch: auth=e41bf400 vs snapshot=abc12345
```

### Prevention Rules
1. When ALL users must be signed in, use `requireAuth` not `optionalAuth`
2. Log errors, not successes (success is the expected path)
3. Anonymous user support should be a conscious architectural decision, not a default

### Benefits
- **Simpler security model**: One rule - "must be signed in"
- **Cleaner logs**: Only see auth messages when something goes wrong
- **Faster debugging**: No more sifting through success logs to find the error
- **Stricter security**: No request proceeds without valid auth

---

## 26. Venue Cache for Event Deduplication (January 1, 2026)

### Problem
Events discovered by multiple LLMs (GPT-5.2, Gemini, Claude, Perplexity) had:
1. **Inconsistent coordinates** - Same venue with slightly different lat/lng from each model
2. **Duplicate events** - "AT&T Stadium" vs "at&t stadium" vs "ATT Stadium" treated as different
3. **Repeated geocoding** - Same venue geocoded on every discovery run
4. **No venue→event linking** - SmartBlocks couldn't flag "event tonight at this bar"

### Solution: Venue Cache with Normalized Names

Created `venue_cache` table that stores venues with:
- **Normalized names** for fuzzy matching ("AT&T Stadium" → "att stadium")
- **Full precision coordinates** (15+ decimals, not 4-decimal coord_cache)
- **Foreign key linking** `discovered_events.venue_id` → `venue_cache.id`

### Implementation

**1. Normalization Algorithm:**
```javascript
// "The Rustic" → "rustic"
// "AT&T Stadium" → "att stadium"
function normalizeVenueName(name) {
  return name
    .toLowerCase()
    .replace(/^the\s+/i, '')     // Remove "The"
    .replace(/&/g, ' and ')      // AT&T → att
    .replace(/[^\w\s]/g, '')     // Remove punctuation
    .replace(/\s+/g, ' ')        // Collapse whitespace
    .trim();
}
```

**2. Event Discovery Flow (sync-events.mjs):**
```
LLM Search → geocodeMissingCoordinates()
           → processEventsWithVenueCache()  ← NEW
              ├── lookupVenueFuzzy() - find existing venue
              ├── findOrCreateVenue() - create if new
              └── Update event with precise coords + venue_id
           → storeEvents() - insert with venue_id FK
```

**3. Benefits:**
| Benefit | Before | After |
|---------|--------|-------|
| Coordinates | 4-decimal (~11m) | 15+ decimal (sub-meter) |
| Matching | Hash-based exact | Normalized fuzzy |
| Geocoding | Every discovery run | Once per venue |
| Event→Venue | None | FK relationship |

### Key Files
- `shared/schema.js` - `venue_cache` table, `venue_id` in discovered_events
- `server/lib/venue/venue-cache.js` - lookup, insert, update utilities
- `server/scripts/sync-events.mjs` - `processEventsWithVenueCache()` integration

### Future Use: SmartBlocks "Event Tonight" Flag
With venue_id linking events to venues, SmartBlocks can now:
1. Get venue's place_id or normalized name from ranking_candidates
2. Look up venue in venue_cache
3. Join to discovered_events where venue_id matches
4. Check if any events are active today
5. Display "🎫 Event: [Name]" badge on matching venues

### Prevention Rules
1. **Normalize before comparing** - Never compare raw venue names
2. **Use venue_cache, not coord_cache** for venues - venue_cache has full precision + hours + type
3. **Link events to venues** - Always populate venue_id when inserting events

---

**Last Updated**: January 2, 2026
**Maintained By**: Development Team
