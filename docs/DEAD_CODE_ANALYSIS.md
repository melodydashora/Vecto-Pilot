# Dead Code & Import Analysis Report

**Generated:** 2026-01-16
**Tool Used:** knip v5.81.0, ts-prune, manual investigation
**Status:** For review - DO NOT DELETE code, document disconnects first

---

## Table of Contents

1. [Critical Issues: Unresolved Imports](#1-critical-issues-unresolved-imports)
2. [Dead Entry Point: index.js](#2-dead-entry-point-indexjs)
3. [Unused Exports Analysis](#3-unused-exports-analysis)
4. [Duplicate Exports](#4-duplicate-exports)
5. [Unused Files Summary](#5-unused-files-summary)
6. [Recommendations](#6-recommendations)

---

## 1. Critical Issues: Unresolved Imports

These are **broken imports** that will cause runtime errors if the code paths are executed.

### 1.1 Missing Middleware Files (index.js:103-104)

| Import Path | Status | Location |
|-------------|--------|----------|
| `./server/middleware/logging.js` | **DOES NOT EXIST** | `index.js:103` |
| `./server/middleware/security.js` | **DOES NOT EXIST** | `index.js:104` |

**Context:**
The `index.js` file is a secondary SDK server (Eidolon Enhanced SDK) running on port 3102. It attempts to import `loggingMiddleware` and `securityMiddleware` from files that don't exist.

**Existing Middleware Files:**
```
server/middleware/
├── auth.js
├── bot-blocker.js
├── correlation-id.js
├── error-handler.js
├── idempotency.js
├── learning-capture.js
├── metrics.js
├── rate-limit.js
├── require-snapshot-ownership.js
├── timeout.js
├── validate.js
└── validation.js
```

**Analysis:**
- `logging.js` and `security.js` were likely planned but never created
- The main entry point (`gateway-server.js`) does NOT use these imports
- The `index.js` file appears to be a **legacy/abandoned** SDK server

**Intended Connection:**
- `loggingMiddleware` likely intended: Request logging similar to what `gateway-server.js` does inline
- `securityMiddleware` likely intended: Security headers, CORS, rate limiting

**Related Files:**
- `gateway-server.js` - Main entry point (works correctly)
- `server/bootstrap/routes.js` - Route mounting (uses different patterns)
- `sdk-embed.js` - Another SDK entry point (may be related)

---

### 1.2 Wrong Import Path: strategy-triggers.js

| File | Line | Import Path | Actual Location |
|------|------|-------------|-----------------|
| `server/lib/location/validation-gates.js` | 202 | `./strategy-triggers.js` | `server/lib/strategy/strategy-triggers.js` |

**Code:**
```javascript
// Line 202 in validation-gates.js
const { detectStrategyTrigger } = require('./strategy-triggers.js');
```

**Correct Import:**
```javascript
const { detectStrategyTrigger } = require('../strategy/strategy-triggers.js');
```

**Analysis:**
- The file `strategy-triggers.js` exists at `server/lib/strategy/strategy-triggers.js`
- The import uses a relative path `./` which looks in `server/lib/location/`
- This is a **path error** - the function exists but the import path is wrong

**Why This Exists:**
The comment on line 201 says: "Import will be done at runtime to avoid circular dependencies"
This suggests the import was added hastily to break a circular dependency and the path wasn't verified.

**Related Files:**
- `server/lib/strategy/strategy-triggers.js` - The actual file (exports `detectStrategyTrigger`)
- `server/lib/location/README.md:110` - Documents this dependency correctly
- `server/lib/strategy/README.md` - Should document strategy-triggers

---

### 1.3 Wrong Import Path: providers/briefing.js

| File | Line | Import Path | Actual Location |
|------|------|-------------|-----------------|
| `server/lib/strategy/strategy-generator-parallel.js` | 261 | `./providers/briefing.js` | `server/lib/ai/providers/briefing.js` |

**Code:**
```javascript
// Line 261 in strategy-generator-parallel.js
const { runBriefing } = await import('./providers/briefing.js');
```

**Correct Import:**
```javascript
const { runBriefing } = await import('../ai/providers/briefing.js');
```

**Analysis:**
- The `providers/` folder is under `server/lib/ai/providers/`, not `server/lib/strategy/providers/`
- This dynamic import will fail at runtime when the code path is executed

**Why This Exists:**
This is in a function `runSimpleStrategyPipeline` which appears to be a simplified strategy pipeline. The function is exported but flagged as "unused" by knip, suggesting it may be dead code or a work-in-progress feature.

**Related Files:**
- `server/lib/ai/providers/briefing.js` - The actual briefing provider
- `server/lib/ai/providers/consolidator.js` - Related consolidator provider
- `server/lib/strategy/status-constants.js` - Used in the same file

---

### 1.4 Missing Test Dependency: db/client.js

| File | Line | Import Path | Actual Location |
|------|------|-------------|-----------------|
| `tests/schema-validation.test.js` | 6 | `../server/db/client.js` | Does not exist |

**Code:**
```javascript
// Line 6 in schema-validation.test.js
import pool from '../server/db/client.js';
```

**Possible Fixes:**
```javascript
// Option 1: Use pool.js
import { getSharedPool } from '../server/db/pool.js';

// Option 2: Use connection-manager.js
import { pool } from '../server/db/connection-manager.js';

// Option 3: Use drizzle.js (recommended pattern)
import { db } from '../server/db/drizzle.js';
```

**Analysis:**
The database folder structure:
```
server/db/
├── connection-manager.js   # Has pool export
├── db-client.js            # Has query functions
├── drizzle.js              # Drizzle ORM connection
├── drizzle-lazy.js         # Lazy loading version
└── pool.js                 # Pool management
```

There is no `client.js` - the test file references a non-existent file.

**Why This Exists:**
This test file was likely created when the database structure was different. The file was renamed or refactored, and this test wasn't updated.

**Related Files:**
- `server/db/pool.js` - Exports `getSharedPool` and `default`
- `server/db/connection-manager.js` - Exports `pool`, `query`, `default`
- `shared/schema.js` - The Drizzle schema being validated

---

## 2. Dead Entry Point: index.js

### Overview

The root `index.js` file is a **secondary SDK server** that is NOT the main entry point.

| Property | Value |
|----------|-------|
| **Main Entry** | `gateway-server.js` (per `package.json`) |
| **index.js Purpose** | Eidolon Enhanced SDK server on port 3102 |
| **Status** | **DEAD CODE** - Has broken imports, may never be executed |

### Evidence

1. **package.json confirms gateway-server.js is main:**
   ```json
   "main": "gateway-server.js",
   "start": "NODE_ENV=production node gateway-server.js",
   "dev": "NODE_ENV=development node gateway-server.js",
   ```

2. **index.js has broken imports that would crash on startup:**
   - `./server/middleware/logging.js` - doesn't exist
   - `./server/middleware/security.js` - doesn't exist

3. **No references to index.js in startup scripts**

### Purpose Analysis

The file header says:
```javascript
// BOOT PROOF — must appear in supervisor logs (ESM version)
```

And later:
```javascript
const PORT = Number(getArg('port') || process.env.EIDOLON_PORT || process.env.SDK_PORT || 3102);
```

**Intended Use:**
This appears to be a standalone SDK server that was meant to run separately from the main gateway, possibly for:
- Claude Desktop / MCP integration
- Workspace agent functionality
- SDK embed endpoints

**Related Files:**
- `sdk-embed.js` - Another SDK entry point
- `server/agent/` - Agent functionality
- `server/eidolon/` - Eidolon SDK code

### Recommendation

**DO NOT DELETE** - Instead:
1. Determine if this SDK server is needed
2. If needed, fix the broken imports
3. If not needed, mark as deprecated with comment explaining history

---

## 3. Unused Exports Analysis

knip detected **67 unused exports** and ts-prune detected **212 unused exports**. Many are intentional (public API, future use), but some indicate disconnect.

### 3.1 High-Value Unused Exports (Likely Dead Code)

These exports are in critical files but never imported anywhere:

| Export | File | Analysis |
|--------|------|----------|
| `runSimpleStrategyPipeline` | `strategy-generator-parallel.js:212` | Has broken import, likely abandoned WIP |
| `runConsolidator` | `consolidator.js:770` | 43KB file, this function may be superseded |
| `UnifiedAIManager` | `unified-ai-capabilities.js:102` | Class exported but never instantiated externally |
| `CoachDAL` | `coach-dal.js:42` | Data access layer class, may be unused |

### 3.2 Intentionally Unused (Public API Pattern)

These are likely intentionally exported for external use or future features:

| Category | Examples | Reason |
|----------|----------|--------|
| **Status Constants** | `STRATEGY_READY_STATUSES`, `JOB_STATUS` | Public API for consumers |
| **Validation Helpers** | `validateWeather`, `validateTraffic` | Utility library pattern |
| **Logging Utilities** | `logAICall`, `logVenue`, `logDB` | Debug/observability helpers |
| **Coordinate Utilities** | `parseCoordKey`, `isValidCoordKey` | Public utility functions |

### 3.3 Barrel Export Issues

Some index files re-export but those re-exports are never used:

| File | Unused Re-exports |
|------|-------------------|
| `server/lib/venue/hours/index.js` | `WEEKDAY_KEYS`, `closedDay`, `twentyFourHourDay`, etc. |
| `server/lib/venue/hours/parsers/index.js` | All parser re-exports |
| `server/lib/location/index.js` | Multiple utility re-exports |

**Why This Happens:**
Barrel exports (`index.js` that re-exports from submodules) are common but consumers often import directly from the source file instead.

---

## 4. Duplicate Exports

These files export the same functionality under multiple names:

| File | Duplicates | Analysis |
|------|------------|----------|
| `server/db/pool.js` | `getSharedPool` and `default` | Named + default export pattern |
| `server/lib/location/coords-key.js` | `coordsKey`, `makeCoordsKey`, `getCoordsKey`, `generateCoordKey` | 4 names for same function! |
| `server/lib/venue/hours/evaluator.js` | `getOpenStatus` and `default` | Named + default export pattern |
| `server/lib/venue/venue-utils.js` | `calculateIsOpenFromHoursTextMap` and `calculateIsOpen` | Possibly different functions or aliases |

### coords-key.js Deep Dive

This file has **4 different export names** for coordinate key functions:

```javascript
// All of these may do the same thing:
export { coordsKey }
export { makeCoordsKey }
export const getCoordsKey = coordsKey;
export const generateCoordKey = coordsKey;
export default coordsKey;
```

**Why This Exists:**
Historical refactoring where the function was renamed multiple times, but old names were kept for backwards compatibility.

**Recommendation:**
Standardize on `makeCoordsKey` (per CLAUDE.md import pattern) and deprecate others.

---

## 5. Unused Files Summary

knip detected **301 unused files**. Categories:

### 5.1 Intentionally Unused (Future Features)

| Path Pattern | Count | Purpose |
|--------------|-------|---------|
| `client/src/_future/` | 6 | Staged future features |
| `client/src/components/_future/` | 1 | Future UI components |
| `client/src/components/strategy/_future/` | 3 | Future strategy components |

### 5.2 shadcn/ui Component Library

| Path | Count | Purpose |
|------|-------|---------|
| `client/src/components/ui/*.tsx` | 46 | UI primitives, used on-demand |

These are **not dead code** - they're a component library. Components are used as needed.

### 5.3 Scripts (CLI Tools)

| Path Pattern | Count | Purpose |
|--------------|-------|---------|
| `scripts/*.js` | 16 | Development/maintenance scripts |
| `server/scripts/*.js` | 15 | Server-side scripts |
| `tools/*.js` | 3 | Research/utility tools |

These are **CLI tools**, not library code. They're invoked directly, not imported.

### 5.4 Test Files

| Path Pattern | Count | Purpose |
|--------------|-------|---------|
| `tests/**/*.js` | 9 | Test suites |

Test files are invoked by test runner, not imported.

### 5.5 Potentially Dead Code

| File | Analysis | Recommendation |
|------|----------|----------------|
| `client/src/App.tsx` | Not imported, may be legacy | Investigate |
| `client/src/App.css` | Not imported | Likely legacy |
| `agent-ai-config.js` | 3 exports, none used | May be config placeholder |
| `server/lib/ai/index.js` | Empty or minimal barrel | Remove if empty |
| `server/lib/index.js` | Empty or minimal barrel | Remove if empty |

---

## 6. Recommendations

### Priority 1: Fix Broken Imports (CRITICAL)

These will cause runtime errors:

| Fix | File | Action |
|-----|------|--------|
| 1 | `server/lib/location/validation-gates.js:202` | Change `./strategy-triggers.js` to `../strategy/strategy-triggers.js` |
| 2 | `server/lib/strategy/strategy-generator-parallel.js:261` | Change `./providers/briefing.js` to `../ai/providers/briefing.js` |
| 3 | `tests/schema-validation.test.js:6` | Change `../server/db/client.js` to `../server/db/pool.js` |

### Priority 2: Resolve index.js Status

Decide on `index.js`:

1. **If SDK server is needed:**
   - Create `server/middleware/logging.js` with request logging
   - Create `server/middleware/security.js` with security headers
   - Or update imports to use existing middleware

2. **If SDK server is not needed:**
   - Add deprecation comment at top of file
   - Track in `docs/review-queue/pending.md`

### Priority 3: Standardize Coordinate Key Exports

In `server/lib/location/coords-key.js`:
- Keep `makeCoordsKey` as the canonical name (matches CLAUDE.md)
- Add deprecation comments to aliases
- Update all imports to use `makeCoordsKey`

### Priority 4: Clean Up Barrel Exports

Review these index files and remove unused re-exports:
- `server/lib/venue/hours/index.js`
- `server/lib/location/index.js`
- `server/lib/venue/index.js`

### DO NOT Delete

Per user request, do NOT delete any code. Instead:
1. Add `// @deprecated` comments with explanation
2. Track in this document
3. Clean up in dedicated refactoring session

---

## Appendix: Full Unused Exports List

<details>
<summary>Click to expand (67 exports from knip)</summary>

```
agent-ai-config.js: AGENT_AI_CONFIG, EIDOLON_CONFIG, ASSISTANT_CONFIG
server/agent/agent-override-llm.js: agentAsk
server/agent/config-manager.js: getEnvValue
server/agent/enhanced-context.js: storeCrossThreadMemory, storeAgentMemory, getCrossThreadMemory, getAgentMemory
server/api/coach/schema.js: default
server/api/coach/validate.js: eventReactivationSchema, newsDeactivationSchema, default
server/api/health/health.js: healthRoutes
server/bootstrap/workers.js: spawnChild, getChildren
server/config/validate-env.js: validateEnvironment
server/db/connection-manager.js: pool, query, default
server/db/db-client.js: closeListenClient, subscribeToChannel
server/db/pool.js: default
server/eidolon/memory/pg.js: memoryCompact
server/jobs/change-analyzer-job.js: runAnalysis, default
server/jobs/event-sync-job.js: stopEventSyncJob
server/jobs/triad-worker.js: startConsolidationListener, processTriadJobs
server/lib/ai/adapters/index.js: isVertexAIAvailable, getVertexAIStatus
server/lib/ai/coach-dal.js: CoachDAL
server/lib/ai/model-registry.js: MODEL_ROLES, LEGACY_ROLE_MAP, PROVIDERS, FALLBACK_ENABLED_ROLES, getProviderForModel, resolveRoleName, getRolesByTable, MODEL_QUIRKS, hasQuirk, getLLMStatus
server/lib/ai/providers/consolidator.js: runConsolidator
server/lib/ai/unified-ai-capabilities.js: UnifiedAIManager
server/lib/auth/password.js: generateSessionToken
server/lib/auth/sms.js: formatPhoneE164, sendPhoneVerificationSMS, sendSMS
server/lib/briefing/briefing-service.js: [multiple exports]
server/lib/capabilities.js: hasCap, isShellAllowed
server/lib/change-analyzer/file-doc-mapping.js: FILE_TO_DOC_MAP, default
server/lib/events/pipeline/validateEvent.js: filterInvalidEventsLegacy
server/lib/external/faa-asws.js: getMajorUSAirports
server/lib/external/perplexity-api.js: [multiple exports]
server/lib/external/routes-api.js: predictDriveMinutesWithTraffic
server/lib/external/semantic-search.js: [multiple exports]
server/lib/external/serper-api.js: serperSearch, searchEventsWithSerper
server/lib/external/streetview-api.js: getVenueStreetView, batchCheckStreetView
server/lib/location/address-validation.js: ValidationVerdict, isAddressDeliverable, default
server/lib/location/coords-key.js: parseCoordKey, isValidCoordKey, generateCoordKey, default
server/lib/location/geo.js: haversineKm, haversineDistanceKm
server/lib/location/geocode.js: getTimezoneForCoords
server/lib/location/validation-gates.js: [multiple exports]
server/lib/location/weather-traffic-validator.js: validateWeather, validateTraffic
server/lib/notifications/email-alerts.js: sendTestEmail
server/lib/strategy/providers.js: assertStrategies, getStrategyProvider
server/lib/strategy/status-constants.js: [multiple exports]
server/lib/strategy/strategy-generator-parallel.js: runSimpleStrategyPipeline
server/lib/strategy/strategy-utils.js: [multiple exports]
server/lib/traffic/tomtom.js: fetchRawTrafficExtended, getTomTomTrafficForCity
server/lib/venue/district-detection.js: [multiple exports]
server/lib/venue/hours/evaluator.js: default
server/lib/venue/hours/index.js: [multiple exports]
server/lib/venue/hours/normalized-types.js: createInterval
server/lib/venue/hours/parsers/*.js: default exports
server/lib/venue/venue-*.js: [various exports]
server/logger/workflow.js: [multiple logging utilities]
server/middleware/auth.js: SYSTEM_AGENT_USER_ID, AGENT_SECRET_HEADER
server/middleware/learning-capture.js: learningMiddleware, captureError
server/middleware/validate.js: validate, validateParams
server/middleware/validation.js: default
server/scripts/sync-events.mjs: [search function exports]
server/util/eta.js: roadDistanceMeters, etaMinutes, estimateNow
server/util/uuid.js: isValidUUID, requireUUID
server/validation/schemas.js: [validation schemas]
```

</details>

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-16 | Claude Code | Initial analysis |

