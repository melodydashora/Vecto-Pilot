# Deprecated Features

Historical record of removed features. **Do not re-implement these.**

## Why This Document Exists

Claude and other AI assistants may suggest patterns that were intentionally removed. This document explains what was deprecated and WHY, preventing regression.

---

## Multi-Model Router with Fallback/Hedging

**Status:** DEPRECATED (October 2025)

**What it was:** Router that tried multiple models and used fallbacks if one failed.

**Why removed:** Single-path orchestration is more reliable and auditable. When a model fails, we want to know immediately rather than silently degrading.

**Files removed:**
- `server/lib/llm-router-v2.js`
- `tools/debug/test-v2-router.mjs`

**Replacement:** TRIAD pipeline with explicit model roles.

---

## Perplexity Integration

**Status:** REMOVED (December 2024)

**What it was:** Perplexity API for real-time research.

**Why removed:** Migrated to Gemini 3 Pro with Google Search grounding. Better accuracy, lower cost, integrated with our existing Gemini infrastructure.

**Files removed:**
- `server/lib/adapters/perplexity-adapter.js`
- `server/lib/perplexity-research.js`
- `server/lib/external/perplexity-api.js`

**Replacement:** Gemini 3.0 Pro with Google Search tool.

---

## Global JSON Body Parsing

**Status:** DEPRECATED (November 2025)

**What it was:** `app.use(express.json())` at global level.

**Why removed:** Per-route validation prevents HTML error pages and enables custom size limits. Global parser caused issues with client abort errors.

**Replacement:** Per-route JSON parsing:
```javascript
app.use('/api', express.json({ limit: '1mb' }));
app.use('/agent', express.json({ limit: '1mb' }));
```

---

## React.StrictMode in Production

**Status:** REMOVED (December 2025)

**What it was:** `<React.StrictMode>` wrapper in `main.tsx`.

**Why removed:** Double-rendering caused duplicate API calls and GPS refreshes.

**File changed:** `client/src/main.tsx`

---

## Index-Based Merge for Venues

**Status:** DEPRECATED (October 2025)

**What it was:** Merging venue data by array index position.

**Why removed:** Fragile - if order changed, wrong venues got merged.

**Replacement:** Key-based merge using `place_id` or `name` as stable identifiers.

**File:** `server/lib/venue/enhanced-smart-blocks.js`

---

## Client GPS Overwrite of Venue Coordinates

**Status:** DEPRECATED (October 2025)

**What it was:** Client could override server-provided venue coordinates.

**Why removed:** Server truth is authoritative. Google APIs provide verified coordinates.

**File:** `client/src/pages/co-pilot.tsx`

---

## formatBriefingContext() Summarization

**Status:** REPLACED (December 2025)

**What it was:** Function that converted JSON to truncated text summaries.

**Why removed:** Summarization lost critical details like street names and closure times.

**Replacement:** Raw JSON passed directly to models:
```javascript
// OLD - Lost details
const briefingContext = formatBriefingContext(briefingRow);

// NEW - Preserves all data
const trafficData = parseJsonField(briefingRow?.traffic_conditions);
// ${JSON.stringify(trafficData, null, 2)}
```

---

## Fallback/Stub Data in Briefing Service

**Status:** REMOVED (December 2025)

**What it was:** Returning placeholder data if Gemini API failed.

**Why removed:** Fail-fast architecture - if API fails, we want to know, not silently degrade.

**Replacement:** Throw errors, let pipeline fail visibly:
```javascript
// OLD
if (!result.ok) return { summary: 'Data unavailable...' };

// NEW
if (!result.ok) throw new Error(`Gemini API failed: ${result.error}`);
```

---

## Development-Only Cache Clearing

**Status:** FIXED (December 2025)

**What it was:** Cache expiry only ran in development mode.

**Why removed:** Production served stale briefing data indefinitely.

**Replacement:** TTL-based cache in ALL environments:
```javascript
function isBriefingStale(briefing, ttlMinutes = 30) {
  const ageMinutes = (now - briefing.updated_at) / (1000 * 60);
  return ageMinutes > ttlMinutes;
}
```

---

## Dead Library Files (18 files)

**Status:** DELETED (December 2025)

Files with zero imports, replaced by newer implementations:

- `server/lib/blocks-queue.js` - Unused async processing
- `server/lib/blocks-jobs.js` - Unused job queue
- `server/lib/triad-orchestrator.js` - Deprecated orchestration
- `server/lib/exploration.js`, `explore.js` - Unused
- `server/lib/scoring-engine.js` → `enhanced-smart-blocks.js`
- `server/lib/driveTime.js` → `venue-enrichment.js`
- `server/lib/venue-generator.js` → `tactical-planner.js`
- `server/lib/persist-ranking.js` → `enhanced-smart-blocks.js`

---

## Unused Frontend Hooks (13 files)

**Status:** DELETED (December 2025)

Hooks that called non-existent backend endpoints:

- `useGestureTracker.ts` → `/api/gesture/*` (never existed)
- `usePreviewContext.ts` → `/api/preview/event` (never existed)
- `useAuth.ts` → `/api/auth/*`, `/api/login` (wrong endpoints)
- `useProfile.ts`, `useVectoPilotProfile.ts` → `/api/user/*` (never existed)
- `useGeoPosition.ts`, `use-geolocation.tsx` - Duplicates
- Various utils that were never imported

---

## SmartBlock Naming Confusion

**Status:** RENAMED (December 2025)

**What it was:**
- `SmartBlock.tsx` - Generic content renderer
- `SmartBlocks.tsx` - Domain-specific driver briefing

**Why renamed:** Both used "Smart" + "Block" but served different purposes.

**Replacement:**
- `ContentBlock.tsx` - Generic content renderer
- `MarketIntelligenceBlocks.tsx` - Driver briefing data

---

## Strategy-First Polling

**Status:** REPLACED (December 2025)

**What it was:** Client polling for strategy completion.

**Why replaced:** SSE provides real-time notifications, reducing unnecessary polling.

**Replacement:** `useStrategyPolling.ts` with SSE subscription for `strategy_ready` events.

---

## Test Snapshot Artifacts

**Status:** DELETED (December 2025)

**What:** 1,637 files in `data/context-snapshots/` (6.4MB)

**Why:** Test artifacts from development, not needed for runtime.

---

## If You See These Patterns

**DO NOT:**
- Re-implement multi-model fallbacks
- Add global JSON parsing
- Use index-based merging
- Allow client to override server coordinates
- Add stub/placeholder data for API failures
- Create development-only behavior

**INSTEAD:**
- Use single-path TRIAD pipeline
- Use per-route JSON parsing
- Use key-based merging (place_id/name)
- Trust server as source of truth
- Fail fast and visibly
- Same behavior in dev and production

## See Also

- [Decisions](decisions.md) - Why we made these choices
- [Constraints](constraints.md) - Current architectural rules
- [LESSONS_LEARNED.md](/LESSONS_LEARNED.md) - Historical issues
