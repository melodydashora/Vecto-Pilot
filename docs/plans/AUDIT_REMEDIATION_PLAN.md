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

## Approval Request

**Melody:** Please review this plan and confirm:

1. ✅ Agree with P0 priority order?
2. ✅ Agree with agent security approach (env-gate + auth)?
3. ✅ Agree with timezone error approach (return 400)?
4. ✅ Approve proceeding with Phase 1 implementation?

**Awaiting:** "All tests passed" confirmation to proceed.
