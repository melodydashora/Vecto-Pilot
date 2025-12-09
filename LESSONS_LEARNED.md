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
4. **DO NOT add temperature to GPT-5.1 or o1 models** - They don't support it (causes 400 errors)
5. **DO NOT use `thinking_budget` for Gemini** - Use `thinkingConfig.thinkingLevel` (nested structure)
6. **DO NOT skip enrichment steps** - Smart Blocks require Google Places/Routes/Geocoding enrichment
7. **DO NOT store secrets in code** - Use environment variables only

### ALWAYS DO

1. **ALWAYS check existing code first** - This repo has accumulated duplicate implementations
2. **ALWAYS use the adapter pattern** - Call models via `server/lib/adapters/index.js`
3. **ALWAYS link data to snapshot_id** - Snapshots are the central ML connector
4. **ALWAYS test after changes** - Run `npm run lint && npm run typecheck && npm run build`
5. **ALWAYS update documentation** - Keep MODEL.md, ARCHITECTURE.md current

---

## AI Model Configuration

### GPT-5.1 (OpenAI)

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
    },
    responseMimeType: "application/json"  // For structured outputs
  },
  tools: [{ google_search: {} }]  // For real-time data
}
```

**WRONG (causes errors):**
```javascript
{
  thinking_budget: 8000,    // DEPRECATED - doesn't work
  thinking_level: "high",   // WRONG - must be nested in thinkingConfig
}
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
- `server/lib/adapters/index.js` - Model dispatcher
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
- **Claude**: Best for strategic reasoning
- **Gemini**: Native Google Search for real-time data
- **GPT-5.1**: Best for structured outputs and immediate actions
- **Perplexity**: Best for current events/holidays

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
| Model dispatch | `server/lib/adapters/index.js` |
| Strategy providers | `server/lib/providers/*.js` |
| Schema definition | `shared/schema.js` |
| Location context | `client/src/contexts/location-context-clean.tsx` |
| Main UI | `client/src/pages/co-pilot.tsx` |

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection |
| `OPENAI_API_KEY` | GPT-5.1 + Voice |
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

### Issue: GPT-5.1 API Rejects Temperature
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

---

**Last Updated**: December 9, 2025
**Maintained By**: Development Team
