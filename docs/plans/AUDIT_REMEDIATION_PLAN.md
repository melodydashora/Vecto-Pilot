# Audit Remediation Plan

**Created:** 2026-01-06
**Author:** Master Architect (AI)
**Status:** AWAITING APPROVAL
**Approval Required From:** Melody (human developer)

---

## Executive Summary

Comprehensive audit identified 15+ issues across security, code quality, and product features. This plan addresses all findings in priority order (P0 → P1 → P2).

**Core Principle Being Addressed:**
> The user asks one simple question: **"Where do I go to make $500 today and still get home?"**
> The app must **pre-collect + pre-consolidate** everything needed so the AI can answer **without interrogating the driver** every time they stop.

---

## Phase 1: P0 - Security & Global Behavior (TODAY)

### P0-A: Secure /agent Endpoints

**Problem:** `/agent` routes are mounted WITHOUT authentication. The `updateEnvFile()` endpoint can modify environment variables - this is a critical security vulnerability.

**Files Affected:**
- `server/agent/embed.js` (line 10)
- `server/agent/routes.js` (lines 250-258)
- `server/bootstrap/routes.js` (lines 113-128)

**Fix Approach:**
1. Add `AGENT_ENABLED=false` by default (opt-in only)
2. Add `requireAuth` middleware to agent routes
3. Add IP allowlist check (configurable via `AGENT_ALLOWED_IPS`)
4. In production, don't mount agent routes at all unless explicitly enabled

**Implementation:**
```javascript
// server/agent/embed.js - Add at top
import { requireAuth } from '../middleware/auth.js';

// Add gating before mount
if (process.env.AGENT_ENABLED !== 'true') {
  console.log('[agent embed] ⚠️ Agent disabled (AGENT_ENABLED !== true)');
  return;
}

// Add auth to routes
app.use(basePath, requireAuth, agentRoutes);
```

**Test Cases:**
- [ ] Agent routes return 401 without auth token
- [ ] Agent routes return 403 without AGENT_ENABLED=true
- [ ] Agent routes work in dev with proper auth + env flag

---

### P0-B: Remove Timezone Fallback

**Problem:** `chat.js:357` has `|| 'America/Chicago'` which violates the global NO FALLBACKS rule.

**File:** `server/api/chat/chat.js` (line 357)

**Current Code:**
```javascript
const userTimezone = clientSnapshot?.timezone || 'America/Chicago'; // Fallback only if no snapshot
```

**Fixed Code:**
```javascript
// CRITICAL: Timezone MUST come from snapshot. If missing, return error.
const userTimezone = clientSnapshot?.timezone;
if (!userTimezone) {
  return res.status(400).json({
    error: 'TIMEZONE_REQUIRED',
    message: 'Location snapshot with timezone required for coach. Please enable GPS.',
    code: 'missing_timezone'
  });
}
```

**Test Cases:**
- [ ] Chat returns 400 with `TIMEZONE_REQUIRED` when no snapshot provided
- [ ] Chat works correctly when snapshot has timezone
- [ ] Client handles the error gracefully and prompts for GPS

---

### P0-C: Remove Hardcoded 'TX' from Voice Instructions

**Problem:** `CoachChat.tsx:326` hardcodes "TX" in voice chat instructions.

**File:** `client/src/components/CoachChat.tsx` (line 326)

**Current Code:**
```javascript
instructions: `You are an AI companion for rideshare drivers in ${context.city || 'unknown'}, TX.
```

**Fixed Code:**
```javascript
instructions: `You are an AI companion for rideshare drivers in ${context.city || 'an unknown city'}, ${context.state || ''}.
```

**Test Cases:**
- [ ] Voice chat shows correct state from context
- [ ] Voice chat doesn't show ", " when state is missing

---

### P0-D: Remove DFW/Frisco Market Worldview from Coach Prompt

**Problem:** The coach system prompt bakes in market-specific assumptions (DFW, Frisco, etc.) which violates the global app principle.

**File:** `server/api/chat/chat.js` (search for "DFW" or "Frisco" in systemPrompt)

**Fix Approach:**
- Replace hardcoded market references with dynamic `${marketContext}` pulled from snapshot/briefing
- Use market_intelligence table data for market-specific advice

**Test Cases:**
- [ ] Coach prompt doesn't contain hardcoded city/state names
- [ ] Market context is pulled dynamically from snapshot

---

### P0-E: Disable Sensitive Logging

**Problem:** Multiple files log sensitive data:
- `server/lib/ai/adapters/index.js` - logs message previews
- `server/api/chat/chat.js` - logs user ID and message text
- `CoachChat.tsx` - logs realtime token substrings

**Files Affected:**
- `server/lib/ai/adapters/index.js`
- `server/api/chat/chat.js` (multiple console.log statements)
- `client/src/components/CoachChat.tsx` (line 305)

**Fix Approach:**
1. Replace `console.log` with structured logger that redacts by default
2. Log only: message IDs, sizes, timing, status codes
3. In production, set `LOG_LEVEL=warn`

**Test Cases:**
- [ ] No message content appears in production logs
- [ ] No tokens or API keys appear in logs
- [ ] Debugging info still available in dev mode

---

## Phase 2: P1 - Code Quality & Maintainability

### P1-A: Refactor Coach Chat to Adapter Pattern

**Problem:** `chat.js` calls Gemini API directly via `fetch()` (lines 689-718) instead of using the adapter pattern required by CLAUDE.md.

**Current Code (lines 689-718):**
```javascript
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:streamGenerateContent...`
);
```

**Fixed Approach:**
1. Add `COACH_CHAT` role to model registry
2. Update adapter to support streaming for chat
3. Replace direct fetch with `callModel('COACH_CHAT', { system, user, stream: true })`

**Files Affected:**
- `server/api/chat/chat.js`
- `server/lib/ai/adapters/index.js`
- `server/lib/ai/model-registry.js`
- `server/lib/ai/models-dictionary.js`

**Test Cases:**
- [ ] Coach chat uses adapter, not direct API calls
- [ ] Streaming still works correctly
- [ ] Web search tool still functions

---

### P1-B: Replace Action Regex with JSON Envelope

**Problem:** `parseActions()` uses regex that can truncate JSON and fail on braces inside strings.

**Current Code (lines 35-41):**
```javascript
const patterns = [
  { type: 'note', regex: /\[SAVE_NOTE:\s*(\{[^}]+\})\]/g, key: 'notes' },
  // ...
];
```

**Fixed Approach:**
1. Require model to return structured JSON envelope
2. Parse with JSON.parse, validate with Zod
3. Reject malformed responses gracefully

**New Format:**
```json
{
  "response": "AI response text here...",
  "actions": [
    { "type": "SAVE_NOTE", "data": { "title": "...", "content": "..." } }
  ]
}
```

**Test Cases:**
- [ ] Actions with nested braces parse correctly
- [ ] Malformed JSON doesn't crash
- [ ] Old format gracefully degrades (temporary backward compat)

---

### P1-C: Reduce Client Payload

**Problem:** Client sends giant payloads (strategy, blocks, full context) to chat endpoint.

**Current:** Client sends everything including full blocks array.

**Fixed:** Client sends only IDs, server rebuilds context via CoachDAL.

**Files Affected:**
- `client/src/components/CoachChat.tsx` (send function)
- `server/api/chat/chat.js` (already uses CoachDAL, just needs client changes)

**Test Cases:**
- [ ] Chat payload under 10KB
- [ ] Server correctly resolves full context from IDs

---

### P1-D: Fix coords_cache Precision Documentation

**Problem:** Docs say 4 decimals, code uses 6 decimals.

**Files Affected:**
- `docs/architecture/constraints.md` (or wherever precision is documented)
- Verify: `server/lib/location/*.js` uses toFixed(6)

**Fix:** Update docs to match code (6 decimals).

---

## Phase 3: P2 - Product Features (Dispatch Primitives)

### P2-A: Add driver_goals Schema

**Purpose:** Enable "make $500 today" type queries.

**Schema:**
```javascript
export const driver_goals = pgTable('driver_goals', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: text('user_id').notNull(),
  goal_type: text('goal_type').notNull(), // 'earnings', 'trips', 'hours'
  target_amount: numeric('target_amount'),
  deadline: timestamp('deadline'),
  urgency: text('urgency').default('normal'), // 'low', 'normal', 'high'
  is_active: boolean('is_active').default(true),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
});
```

---

### P2-B: Add driver_tasks Schema

**Purpose:** Enable "car wash before 4:30" type constraints.

**Schema:**
```javascript
export const driver_tasks = pgTable('driver_tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: text('user_id').notNull(),
  title: text('title').notNull(),
  due_at: timestamp('due_at'),
  location: text('location'), // address or place_id
  duration_minutes: integer('duration_minutes'),
  is_hard_stop: boolean('is_hard_stop').default(false),
  is_complete: boolean('is_complete').default(false),
  created_at: timestamp('created_at').defaultNow(),
});
```

---

### P2-C: Add safe_zones Schema

**Purpose:** Enable "stay inside safe boundary" constraints.

**Schema:**
```javascript
export const safe_zones = pgTable('safe_zones', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: text('user_id').notNull(),
  zone_name: text('zone_name').notNull(),
  zone_type: text('zone_type').notNull(), // 'safe', 'avoid', 'prefer'
  geometry: text('geometry'), // GeoJSON polygon
  neighborhoods: text('neighborhoods').array(), // Alternative: list of neighborhood names
  risk_level: integer('risk_level'), // 1-5
  notes: text('notes'),
  is_active: boolean('is_active').default(true),
  created_at: timestamp('created_at').defaultNow(),
});
```

---

### P2-D: Implement Saturation-Aware Recommendation

**Purpose:** Avoid overcrowding hotspots when many drivers ask for recommendations.

**Approach:**
1. Track staging suggestions per H3 cell + time window
2. Diversify top picks across active drivers
3. Add `suggested_count` to ranking_candidates

**Files Affected:**
- `server/lib/venue/venue-enrichment.js`
- `shared/schema.js` (add tracking table)
- New: `server/lib/strategy/saturation-tracker.js`

---

### P2-E: Create AI Change Protocol Doc

**Purpose:** Prevent future regressions via CI checks.

**Contents:**
1. NO FALLBACKS check (grep for `|| 'default'` patterns)
2. Adapter-only LLM calls check (grep for direct API imports)
3. coords_cache precision check (grep for toFixed)

**Location:** `docs/preflight/ai-change-protocol.md`

---

## Test Plan

### P0 Tests (Must Pass Before Merge)
- [ ] `/agent` returns 401 without auth
- [ ] `/agent` returns 403 when AGENT_ENABLED !== 'true'
- [ ] Chat returns 400 when timezone missing
- [ ] No hardcoded state/city in voice instructions
- [ ] No message content in production logs

### P1 Tests
- [ ] Coach uses `callModel()` not direct fetch
- [ ] Action parsing handles nested JSON
- [ ] Client payload < 10KB

### P2 Tests
- [ ] driver_goals table created and accessible
- [ ] driver_tasks table created and accessible
- [ ] safe_zones table created and accessible
- [ ] Saturation tracking diversifies recommendations

---

## Implementation Order

1. **P0-A: Agent Security** (CRITICAL - do first)
2. **P0-B, P0-C, P0-D: Remove Fallbacks/Hardcodes** (same PR)
3. **P0-E: Logging** (separate PR, quick)
4. **P1-A: Adapter Refactor** (requires careful testing)
5. **P1-B: JSON Parsing** (can be done in parallel)
6. **P1-C, P1-D: Cleanup** (quick wins)
7. **P2-*: Schema + Features** (after P0/P1 stable)

---

---

## Phase 4: P3 - Redundancy & "Why Does It Rerun When I Switch Apps?"

> **Root Cause Analysis by Melody (2026-01-06)**
> This section documents the findings from investigating why the app regenerates strategy when users switch between apps (Uber/Lyft) and return.

### P3-A: Strategy Being Cleared on Mount (TWO PLACES)

**Problem:** Strategy is still being cleared on mount in two places, which directly forces regeneration.

**Violation Found:**
- `useStrategyPolling.ts` - clears strategy localStorage on first mount (`localStorage.removeItem(...)`)
- `co-pilot-context.tsx` - also clears strategy localStorage on first mount

This contradicts the intended behavior in LESSONS_LEARNED.md ("Previous Bug: Strategy cleared on every mount…") and **absolutely causes** "switch to Uber → come back → app refreshes → strategy regenerates" if the browser tab was discarded and reloaded.

**Files Affected:**
- `client/src/hooks/useStrategyPolling.ts`
- `client/src/contexts/co-pilot-context.tsx`

**Fix Direction:**
1. Remove "clear on mount" entirely from both files
2. Only clear strategy artifacts on:
   - **manual refresh** (`vecto-manual-refresh` event)
   - **meaningful location change** (new snapshot id)
   - **explicit logout**

**Test Cases:**
- [ ] Strategy persists across app switches (tab not killed)
- [ ] Strategy persists across tab restore (OS killed tab but user returns)
- [ ] Strategy clears on manual refresh button
- [ ] Strategy clears on logout

---

### P3-B: Reload Nukes In-Memory State (OS Tab Kill)

**Problem:** QueryClient defaults are already set to "stick around" (no auto refetch + infinite freshness), so normal tab navigation inside the SPA shouldn't rerun work. But when you "switch apps" on mobile:
1. **OS kills the webview/tab** → full reload
2. In-memory React Query cache is gone
3. Contexts re-mount
4. Snapshot + strategy triggers fire again
5. P3-A mount-clears make this worse

**Fix Direction - Add "Resume Session" Path:**

1. Persist *only the minimum* to resume:
   - `lastSnapshotId`
   - `lastUpdatedAt`
   - `resumeAllowedUntil` timestamp (TTL)

2. On boot, if within TTL and user is still authenticated:
   - Reuse `lastSnapshotId`
   - **Do NOT create a new snapshot**
   - Skip strategy generation

3. Only create a new snapshot on:
   - Manual refresh spinner
   - Logout
   - TTL expired

**DB-Authoritative Alternative:**
Use the user record as source-of-truth instead of client "cache":
- `/api/users/me` or `/api/auth/me` patterns already exist
- Add/extend endpoint to return `{ current_snapshot_id, snapshot_created_at, coords_hash }`
- Reuse that when app reloads

**Files Affected:**
- `client/src/contexts/location-context-clean.tsx` (snapshot creation logic)
- `client/src/contexts/co-pilot-context.tsx` (strategy trigger logic)
- `server/api/auth/auth.js` (add current_snapshot_id to /me response)

**Test Cases:**
- [ ] App resumes with existing snapshot within TTL
- [ ] App creates new snapshot after TTL expires
- [ ] App creates new snapshot on manual refresh
- [ ] Coach is usable immediately on resume (no waiting for strategy)

---

### P3-C: Bars + BarTab Still Contain "Unknown/Timezone Fallback" Patterns

**Problem:** Both `useBarsQuery` and `BarTab` fall back to `"Unknown"` city and browser timezone.

**Violation Found:**
- Contexts README says downstream queries must be gated by `isLocationResolved`
- "No fallbacks", "must wait for this flag" rule exists
- LESSONS_LEARNED explicitly calls out the "Unknown city" race condition

**Files Affected:**
- `client/src/hooks/useBarsQuery.ts`
- `client/src/components/BarTab.tsx` (or similar)

**Fix Direction:**
1. Delete the `"Unknown"` / browser-timezone fallback behavior
2. Hard gate bars on `isLocationResolved === true`
3. Require `city/state/timeZone` from LocationContext
4. If missing, that's a bug → surface error, don't patch

**Test Cases:**
- [ ] Bars tab shows loading state until isLocationResolved
- [ ] Bars tab never shows "Unknown" city
- [ ] Browser timezone is never used as fallback

---

### P3-D: CoPilot Pipeline Needs "Reason" for Resume Support

**Problem:** When `vecto-snapshot-saved` fires, CoPilotContext triggers POST `/api/blocks-fast`. That's great for first run, but bad on "resume" (returning user shouldn't wait for full strategy regeneration).

**Fix Direction:**
1. When dispatching `vecto-snapshot-saved`, include a reason in event detail:
   ```javascript
   // client/src/contexts/location-context-clean.tsx
   window.dispatchEvent(new CustomEvent('vecto-snapshot-saved', {
     detail: { snapshotId, reason: 'init' | 'manual_refresh' | 'resume' }
   }));
   ```

2. CoPilotContext triggers `/api/blocks-fast` only for `init` or `manual_refresh`, NOT `resume`

3. Coach remains usable with last-known strategy + snapshot context on resume

**Files Affected:**
- `client/src/contexts/location-context-clean.tsx` (event dispatch)
- `client/src/contexts/co-pilot-context.tsx` (event listener)

**Test Cases:**
- [ ] Resume doesn't trigger /api/blocks-fast
- [ ] Manual refresh triggers /api/blocks-fast
- [ ] Init triggers /api/blocks-fast
- [ ] Coach works immediately on resume with cached strategy

---

## Phase 5: P4 - Optimizations & Redundancy Cleanup

### P4-A: Stop Writing Strategy to localStorage If Not Restoring

**Problem:** Strategy is set to localStorage in multiple places, but "clear-on-mount" prevents persistence anyway. This is inconsistent.

**Fix Direction - Pick One:**
- **Option A (Preferred):** No localStorage strategy at all. Use React Query + server as truth.
- **Option B:** sessionStorage with TTL + explicit clear on manual refresh only.

**Files Affected:**
- `client/src/hooks/useStrategyPolling.ts`
- `client/src/contexts/co-pilot-context.tsx`

---

### P4-B: Quarantine Old/Duplicate Hooks

**Problem:** UI_FILE_MAP explicitly calls out `_future/` staging files and legacy components. If a hook isn't in the import tree, it may be accidentally reused.

**Fix Direction:**
- Audit all hooks in `client/src/hooks/`
- Move unused hooks to `client/src/hooks/_deprecated/`
- Add README in deprecated folder explaining why

---

### P4-C: Fix Hardcoded Timezone Bug in CoPilotContext

**Problem:** `co-pilot-context.tsx` sets `timezone: 'America/Chicago'` in blocks state, poisoning downstream logic outside that zone.

**File:** `client/src/contexts/co-pilot-context.tsx`

**Fix:** Remove hardcoded timezone, use snapshot.timezone only.

---

### P4-D: Single Query Key + Strict Gating for Bars

**Problem:** Shared query key pattern is good, but placeholder city/tz should be removed.

**Fix:** Rely on `isLocationResolved` entirely, no placeholders.

---

### P4-E: Prevent Cross-Snapshot Cooldown Bugs in Briefing

**Problem:** Snapshot-ownership cooling-off edge case exists. Fix pattern documented but not applied consistently to all 6 briefing endpoints.

**Fix:** Apply "exit on new snapshot" logic consistently to ALL briefing queries, not just one.

---

### P4-F: Centralize Identifiers (Prevent Token Key Mismatch)

**Problem:** Near-identical keys have broken prod before. Need single source of truth for:
- Storage keys (token, device id, snapshot id)
- Custom event names
- Query keys
- API route strings

**Fix:** Create constants files:
- `client/src/constants/storageKeys.ts`
- `client/src/constants/events.ts`
- `client/src/constants/queryKeys.ts`
- `client/src/constants/apiRoutes.ts`

---

## Phase 6: Naming Conventions Ruleset (Drop-In Spec)

### 6.1 Files & Folders

| Type | Convention | Examples |
|------|------------|----------|
| React components/pages | `PascalCase.tsx` | `StrategyPage.tsx`, `GlobalHeader.tsx` |
| Hooks | `usePascalThing.ts` | `useBriefingQueries.ts`, `useStrategyPolling.ts` |
| Contexts | `kebab-case-context.tsx` | `auth-context.tsx`, `co-pilot-context.tsx` |
| Utilities | `kebab-case.ts` with domain prefix | `co-pilot-helpers.ts`, `briefing-helpers.ts` |
| Server routes | Mirror URL shape, `kebab-case.js` | `/api/blocks-fast` → `blocks-fast.js` |

### 6.2 Storage Keys

**Rule:** One prefix, one constant file, no raw strings.

**Prefix:** `vectopilot_`

**File:** `client/src/constants/storageKeys.ts`
```typescript
export const STORAGE_KEYS = {
  AUTH_TOKEN: 'vectopilot_auth_token',
  DEVICE_ID: 'vectopilot_device_id',  // rename from 'vecto_device_id'
  LAST_SNAPSHOT_ID: 'vectopilot_last_snapshot_id',
  SESSION_RESUME_UNTIL: 'vectopilot_session_resume_until',
} as const;
```

### 6.3 Custom Events

**Rule:** `vecto-<domain>-<action>` lowercase kebab-case.

**File:** `client/src/constants/events.ts`
```typescript
export const EVENTS = {
  SNAPSHOT_SAVED: 'vecto-snapshot-saved',
  MANUAL_REFRESH: 'vecto-manual-refresh',
  LOCATION_CHANGED: 'vecto-location-changed',
} as const;
```

### 6.4 React Query Keys

**Rule:** Factory functions, never ad-hoc arrays.

**File:** `client/src/constants/queryKeys.ts`
```typescript
export const queryKeys = {
  strategy: (snapshotId: string) => ['strategy', snapshotId] as const,
  blocksFast: (snapshotId: string) => ['blocks-fast', snapshotId] as const,
  barsNearby: (params: { lat: number; lng: number; city: string }) =>
    ['bars-nearby', params] as const,
};
```

### 6.5 API Route Strings

**Rule:** No inline `"/api/..."` outside a single file.

**File:** `client/src/constants/apiRoutes.ts`
```typescript
export const API_ROUTES = {
  BLOCKS_FAST: '/api/blocks-fast',
  STRATEGY: (id: string) => `/api/strategy/${id}`,
  BRIEFING: {
    WEATHER: (snapshotId: string) => `/api/briefing/weather/${snapshotId}`,
    TRAFFIC: (snapshotId: string) => `/api/briefing/traffic/${snapshotId}`,
  },
};
```

### 6.6 Types, Variables, and Database

| Type | Convention | Examples |
|------|------------|----------|
| Types/interfaces | `PascalCase` | `StrategyResponse`, `BriefingData` |
| Functions/vars | `camelCase` | `loadContext`, `snapshotId` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_RETRIES`, `DEFAULT_TIMEOUT` |
| DB tables/columns | `snake_case` | `driver_goals`, `created_at` |
| Zod schemas | `PascalCaseSchema` | `SnapshotRequestSchema` |

---

## Phase 7: Documentation Workflow

### Create `docs/CHANGE_WORKFLOW.md`

Required pre-read list before any code changes:

1. `CLAUDE.md` - NO FALLBACKS / GPS-first rules / NO SILENT FAILURES
2. `UI_FILE_MAP.md` - Import tree + API mapping
3. `LESSONS_LEARNED.md` - Known footguns (token keys, SSE duplication)
4. `docs/architecture/constraints.md` - Polling/caching constraints

---

## The Most Direct Path to UX Goal

**Goal:** "Don't rerun unless refresh/logout"

### Immediate Fixes (In Order):
1. **Remove strategy-clearing on mount** (both useStrategyPolling + co-pilot-context)
2. **Add resume mode** (don't create new snapshot if resuming) + pass `reason` in `vecto-snapshot-saved`
3. **Only trigger `/api/blocks-fast` on init/manual_refresh**, not resume
4. **Enforce "no fallbacks" in bars** by deleting `"Unknown"`/tz fallbacks and relying on `isLocationResolved`

---

## Implementation Order (Updated)

### Already Completed (2026-01-06):
- ✅ P0-A: Agent Security
- ✅ P0-B, P0-C, P0-D: Remove Fallbacks/Hardcodes
- ✅ P0-E: Logging
- ✅ P1-A: Adapter Refactor
- ✅ P1-B: JSON Parsing
- ✅ P1-C, P1-D: Cleanup
- ✅ P2-*: Schema + Features (dispatch primitives)

### Next Up:
1. **P3-A: Remove mount-clearing** (CRITICAL - causes redundant regeneration)
2. **P3-B: Add resume mode** (requires P3-A first)
3. **P3-C: Fix bars fallbacks** (quick win)
4. **P3-D: Add reason to snapshot event** (enables smart resume)
5. **P4-*: Optimizations** (after P3 stable)
6. **P5-*: Naming conventions** (after P4 stable)

---

## Approval Request

**Melody:** Please review this plan and confirm:

1. ✅ Agree with P0 priority order?
2. ✅ Agree with agent security approach (env-gate + auth)?
3. ✅ Agree with timezone error approach (return 400)?
4. ✅ Approve proceeding with Phase 1 implementation?

**Awaiting:** "All tests passed" confirmation to proceed.
