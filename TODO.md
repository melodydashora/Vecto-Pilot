# Vecto Pilot - Codebase TODOs

This document is a compiled list of all `TODO` comments extracted from the source code. 

## Backend (`server/`)

### Authentication & Auth
- **`server/api/auth/auth.js`** (Line 1832)
  - `Implement full Apple Sign In with passport-apple`

### Venue Intelligence
- **`server/lib/venue/venue-intelligence.js`** (Line 393)
  - `(2026-04-16): Bars tab does not compute beyond_deadhead. The strategy pipeline sets this flag via tactical-planner.js, but the Bars pipeline is independent. Decision pending...`
- **`server/lib/venue/venue-address-validator.js`** (Line 161)
  - `Implement when we have a metro-area bounding box table.`

### Semantic Search & Vector DB
- **`server/lib/external/semantic-search.js`**
  - (Line 9) `Integrate with actual OpenAI text-embedding-3-small when budget allows`
  - (Line 54) `Implement vector storage when upsertDoc is available`
  - (Line 90) `Implement vector storage when upsertDoc is available`
  - (Line 110) `Implement knnSearch when available`
  - (Line 128) `Implement knnSearch when available`
  - (Line 144) `Implement actual vector storage (Pinecone, pgvector, etc.)`
  - (Line 153) `Implement actual vector search`

### ML Health & Assistant Memory
- **`server/api/health/ml-health.js`** 
  - (Line 8) `Import recallContext and searchMemory when available`
  - (Line 149) `Get architecture and deployment memories when recallContext is available`
  - (Line 238) `Implement recallContext when available`
  - (Line 271) `Implement searchMemory when available`
- **`server/middleware/learning-capture.js`** (Line 36)
  - `Store in assistant_memory when rememberContext is available`

### Auth Hardening (deferred 2026-05-13)
- **`server/agent/enhanced-context.js`** (Lines 27, 39) — `TODO(auth-hardening Item 6): wrapper delegates ...`
- **`server/agent/thread-context.js`** (Line 120) — `TODO(auth-hardening Item 6): silent writer`
- **`server/lib/ai/context/enhanced-context-base.js`** (Lines 385, 426) — `TODO(auth-hardening Item 6): silent writer/reader`
- **`server/api/health/logs.js`** (Line 164) — `TODO(auth-hardening Item 7, preserve-as-designed): /viewer`
- **`server/api/hooks/translate.js`** (Line 25) — `TODO(auth-hardening Item 7): treatment (B), symmetric`
- **`server/middleware/auth.js`** (Line 316) — `TODO (Phase 2 sunset target): replace ?token= query-param fallback`

---

## Frontend (`client/`)

### Components & UI
- **`client/src/components/ErrorBoundary.tsx`** (Line 71)
  - `Send to error tracking service`
- **`client/src/pages/co-pilot/StrategyPage.tsx`** (Line 859)
  - `Add upCount/downCount to toApiBlock() when feedback aggregation is implemented.`

## Bugs & Technical Debt (Found via "BUG" / "DEPRECATED")

### Known Bugs
- **`server/middleware/learning-capture.js`** (Line 41)
  - `Flag missing userId as bug, don't mask with 'anonymous'`
- **`client/src/contexts/location-context-clean.tsx`** (Line 370)
  - `BUG: enrichLocation called without auth! Aborting to prevent 401 loop.`

### Deprecations to Clean Up
- **`client/src/hooks/useStrategyPolling.ts`**
  - This entire hook is marked as `DEPRECATED - 2026-01-15` and should be removed.
- **`server/api/strategy/blocks-fast.js`** (Line 120)
  - `DEPRECATED: Session-level locks - kept for reference only`

### Future Features
- **`client/src/_future/user-settings/vehicleTiers.ts`** (Line 7)
  - `Connect to user profile settings modal`

### Workarounds & Technical Debt (Found via Script)
- **`scripts/db-detox.js`** (Line 411)
  - `Must clean up FK references (venue_metrics, ranking_candidates) first` (Blocks deduplication)
- **`server/lib/ai/adapters/gemini-adapter.js`** (Line 81)
  - `WORKAROUND: The @google/genai SDK prioritizes GOOGLE_API_KEY from env over the apiKey passed in constructor`
- **`server/lib/ai/model-registry.js`** (Line 425)
  - `This is a TEMPORARY fallback - Claude remains the primary model`
