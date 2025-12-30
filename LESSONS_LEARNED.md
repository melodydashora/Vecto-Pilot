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
  model: "gpt-5.1",
  messages: [...],
  reasoning: { effort: "medium" },  // Use this instead of temperature
  max_completion_tokens: 32000,     // NOT max_tokens
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

### Gemini 3 Pro Preview (Google)

**CORRECT:**
```javascript
{
  model: "gemini-3-pro-preview",
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
1. Round coordinates to 4 decimals (~11m precision) for cache key
2. Store full 6 decimal precision (~11cm) for data
3. On cache hit: Return cached city/state/timezone (skip API calls)
4. On cache miss: Call Google APIs, store result

**Saves:** ~$0.005 per repeat lookup

### Common Schema Mistakes

1. **Not adding indexes** - Always index foreign keys and frequently queried columns
2. **Using wrong types** - Use JSONB for complex objects, not TEXT
3. **Missing timestamps** - Always include `created_at`, `updated_at`

---

## Frontend Pitfalls

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

### localStorage Behavior

**Current Behavior:**
- Strategy data persists across sessions
- Clears only on manual refresh or location change

**Previous Bug:** Strategy cleared on every mount (caused unnecessary regeneration)

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

**Last Updated**: December 30, 2025
**Maintained By**: Development Team
