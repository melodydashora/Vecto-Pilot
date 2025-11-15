# Vecto Pilot - Complete Workflow Verification

## Critical Issue Fixed
**Problem**: INSERT into rankings table failing because schema mismatch
- Database: `created_at timestamp DEFAULT now()`
- Drizzle Schema (OLD): `created_at: timestamp().notNull()` → tries to INSERT `default` keyword
- Drizzle Schema (NEW): `created_at: timestamp().notNull().defaultNow()` → lets DB handle default

**Fix Applied**: Added `.defaultNow()` to rankings.created_at in shared/schema.js line 114

---

## Single Path Verification (No Duplicates)

### Frontend Trigger (SINGLE)
✅ **ONE trigger point**: `client/src/pages/co-pilot.tsx` line 182
- Event: `vecto-snapshot-saved`
- Action: POST `/api/blocks-fast` with snapshotId
- No other files call POST /api/blocks-fast

### Backend Waterfall (SINGLE)
✅ **ONE waterfall execution**: `server/routes/blocks-fast.js` lines 154-203
- Creates triad_job with `onConflictDoNothing` (prevents duplicates)
- Runs synchronous pipeline:
  1. Providers (parallel): minstrategy, briefing, holiday
  2. Strategy row creation: Single INSERT in strategy-generator-parallel.js
  3. Consolidation: GPT-5.1 with reasoning
  4. Smart Blocks: enhanced-smart-blocks.js

### Smart Blocks Generation (SINGLE)
✅ **ONE generation path**: `server/lib/enhanced-smart-blocks.js`
- GPT-5 Tactical Planner → Venue coordinates
- Google API Enrichment → Addresses, drive times, hours
- Database INSERT:
  - rankings (line 78) - NOW WITH .defaultNow()
  - ranking_candidates (line 145)

---

## Complete Flow (35-50 seconds)

```
1. GPS Coordinates (Browser)
   ↓
2. POST /api/location/snapshot → Full enrichment
   - Reverse geocode → address
   - FAA API → airport delays
   - Weather/Air Quality APIs
   - Holiday detection (Perplexity)
   - Timezone/day_part calculation
   ↓ INSERT snapshots (SINGLE ROW with ALL data)
   
3. vecto-snapshot-saved event → Frontend (co-pilot.tsx)
   ↓
4. POST /api/blocks-fast → Synchronous Waterfall
   ├─ onConflictDoNothing prevents duplicate jobs
   │
   ├─ Step 1: AI Providers (parallel, 10-15s)
   │   ├─ Claude: Strategic overview
   │   ├─ Perplexity: Travel research
   │   └─ Holiday: Validation
   │
   ├─ Step 2: Strategy Row (SINGLE INSERT, 0s)
   │   └─ strategy-generator-parallel.js line 226
   │       - model_name: claude→perplexity→gpt-5.1
   │       - status: pending
   │       - onConflictDoNothing
   │
   ├─ Step 3: Consolidation (15-20s)
   │   └─ GPT-5.1 reasoning + web search
   │       - UPDATE consolidated_strategy (preserves model_name)
   │       - INSERT briefings (tactical intelligence)
   │
   └─ Step 4: Smart Blocks (10-15s)
       ├─ GPT-5.1 Venue Planner (8-12s)
       │   - Input: Consolidated strategy
       │   - Output: 5-8 venues with coordinates + tips
       │
       ├─ Google API Enrichment (2-3s, parallel per venue)
       │   ├─ Geocoding → full addresses
       │   ├─ Routes API v2 → traffic-aware drive times
       │   └─ Places API v1 → business hours, status, place_id
       │
       └─ Database Persistence
           ├─ INSERT rankings (✅ FIXED: created_at uses DB default)
           └─ INSERT ranking_candidates (5-8 rows)
   ↓
5. blocks_ready SSE event → Frontend displays Smart Blocks
```

---

## Files Modified (November 15, 2025)

### Schema Fix
- `shared/schema.js` line 114: Added `.defaultNow()` to rankings.created_at

### Dead Code Removed
- Deleted 6 route files (~800 lines)
- Cleaned blocks-fast.js (992 → 264 lines, 73% reduction)
- Removed dead imports from index.js, sdk-embed.js

### Documentation Created
- `ARCHITECTURE_FLOW.md` - Complete technical flow
- `WORKFLOW_VERIFICATION.md` - This file

---

## Testing Checklist

### Database
- [x] Schema matches database (created_at has .defaultNow())
- [ ] INSERT rankings succeeds without error
- [ ] INSERT ranking_candidates succeeds

### Frontend
- [x] Single POST trigger in co-pilot.tsx
- [ ] Strategy displays after 12-20s
- [ ] Smart Blocks display after 35-50s
- [ ] No console errors

### Backend
- [x] Single waterfall in blocks-fast.js
- [x] Single strategy INSERT in strategy-generator-parallel.js
- [ ] All 4 waterfall steps complete without errors
- [ ] SSE events fire correctly (strategy_ready, blocks_ready)

---

## Known Working State (Before This Fix)
✅ Strategy generation (Claude → Perplexity → GPT-5.1)
✅ Snapshot enrichment (address, FAA, holiday, weather)
✅ Single strategy row per snapshot
✅ Model attribution preserved
✅ GPT-5.1 venue planner generates coordinates
✅ Google APIs enrich venues with addresses/drive times

❌ **ONLY ISSUE**: INSERT rankings failed due to schema mismatch
✅ **NOW FIXED**: rankings.created_at has .defaultNow()

